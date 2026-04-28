// TCNet inbound message handler — bridge-core.js 에서 추출 (Phase 5.5).
// 모든 TCNet UDP 패킷을 받아서 OptIn/APP/MetadataRequest/Data(MixerData) 디스패치.
// 동작 보존: 입력 → 출력 동일.
//
// dep 은 명시적 주입 — `mk*` 빌더와 TC 상수는 deps 객체로 받음.
'use strict';

// SECURITY: TCNet UDP 는 인증 없이 임의 송신자가 패킷 보낼 수 있어
//   임의 name 을 키로 하는 자동 등록이 무한 메모리 증가로 이어질 수 있음.
//   cap 도달 시 lastSeen 가장 오래된 entry 부터 evict 후에 신규 등록.
const TCNET_MAX_NODES = 32;
const TCNET_NODE_TTL_MS = 30000;

// 신규 노드 등록 직전 cap/TTL 강제 — bridge-core 의 _startListenerPortRx 에서도 재사용.
function registerTCNetNode(core, key, entry){
  const nodes = core.nodes;
  // 이미 존재하면 update 만 (cap 영향 없음).
  if(nodes[key]){ Object.assign(nodes[key], entry); return false; }
  // cap 도달 시: 먼저 stale (TTL 초과) entry 제거, 그래도 차면 LRU evict.
  const keys = Object.keys(nodes);
  if(keys.length >= TCNET_MAX_NODES){
    const now = Date.now();
    let staleEvicted = 0;
    for(const k of keys){
      if(now - (nodes[k]?.lastSeen||0) > TCNET_NODE_TTL_MS){
        delete nodes[k];
        staleEvicted++;
      }
    }
    if(Object.keys(nodes).length >= TCNET_MAX_NODES){
      // LRU: 가장 오래된 lastSeen 제거.
      let oldestKey = null, oldestSeen = Infinity;
      for(const k of Object.keys(nodes)){
        const ls = nodes[k]?.lastSeen||0;
        if(ls < oldestSeen){ oldestSeen = ls; oldestKey = k; }
      }
      if(oldestKey) delete nodes[oldestKey];
    }
  }
  nodes[key] = entry;
  return true; // newly registered
}

// 상위 호출자가 socket / state / event callback 모두 core 에 두므로 단일 함수만 export.
// deps: { TC, mkDataMeta, mkDataMetrics, mkAppResp }
function handleTCNetMsg(core, deps, msg, rinfo, label){
  const { TC, mkDataMeta, mkDataMetrics, mkAppResp } = deps;

  if(msg.length<TC.H) return;
  if(msg[4]!==0x54||msg[5]!==0x43||msg[6]!==0x4E) return;
  // 1차 방어: Node ID 일치 → 자기 자신이 보낸 패킷 (NNAME 변경에도 견고)
  if(msg[0]===TC.NID[0] && msg[1]===TC.NID[1]) return;
  const type = msg[7];
  const name = msg.slice(8,16).toString('ascii').replace(/\0/g,'').trim();
  // 2차 방어: 이름 prefix (역호환 + 다른 Bridge 인스턴스 방지)
  if(name.toUpperCase().startsWith('BRIDGE')) return;
  // 3차 방어: 송신 포트가 우리 소켓이면 loop
  if(core._ownPorts && core._ownPorts.has(rinfo.port) &&
     (rinfo.address===core.localAddr || rinfo.address==='127.0.0.1')) return;

  if(type===TC.OPTIN){
    const body = msg.slice(TC.H);
    const lPort = body.length>=4 ? body.readUInt16LE(2) : 0;
    const vendor = body.length>=40 ? body.slice(8,24).toString('ascii').replace(/\0/g,'').trim() : '';
    const device = body.length>=40 ? body.slice(24,40).toString('ascii').replace(/\0/g,'').trim() : '';
    const key = name+'@'+rinfo.address;
    const isNew = registerTCNetNode(core, key, {name,vendor,device,type:msg[17],ip:rinfo.address,port:rinfo.port,lPort,lastSeen:Date.now()});
    if(isNew) console.log(`[${label}] OptIn: ${name}@${rinfo.address} lPort=${lPort} vendor=${vendor}`);
    core.onNodeDiscovered?.(core.nodes[key]);
  }
  // Auto-register non-Bridge nodes that send any TCNet packet (Arena may skip OptIn)
  if(type!==TC.OPTIN && !name.toUpperCase().startsWith('BRIDGE')){
    const key = name+'@'+rinfo.address;
    if(!core.nodes[key]){
      const isNew = registerTCNetNode(core, key, {name,vendor:'',device:'',type:msg[17],ip:rinfo.address,port:rinfo.port,lPort:rinfo.port,lastSeen:Date.now()});
      if(isNew){
        console.log(`[${label}] auto-register ${name}@${rinfo.address} lPort=${rinfo.port}`);
        core.onNodeDiscovered?.(core.nodes[key]);
      }
    } else {
      core.nodes[key].lastSeen = Date.now();
    }
  }
  if(type===TC.APP){
    if(!core._lPortDbg)core._lPortDbg={};
    if(!core._lPortDbg['txapp_'+rinfo.address]){core._lPortDbg['txapp_'+rinfo.address]=true;console.log(`[${label}] APP from ${name} → ${rinfo.address}:${rinfo.port}`);}
    const body = msg.slice(TC.H);
    const lPort = body.length>=22 ? body.readUInt16LE(20) : rinfo.port;
    const key = name+'@'+rinfo.address;
    if(core.nodes[key]) core.nodes[key].lPort = lPort || rinfo.port;
    try{ core.txSocket?.send(mkAppResp(core.listenerPort),0,62,rinfo.port,rinfo.address); }catch(_){}
  }
  // 0x14 MetadataRequest — Arena asks for track metadata on a layer
  // body: [dataType, layer(1-based)]; reply with requested Data payload.
  if(type===0x14){
    const body = msg.slice(TC.H);
    const reqType = body.length>=1 ? body[0] : 0;
    const layerReq = body.length>=2 ? body[1] : 0;  // 1-based
    const li = layerReq - 1;
    const layerData = (li >= 0 && li < core.layers.length) ? core.layers[li] : null;
    const faderVal = core.faders ? (core.faders[li] || 0) : 0;
    if(reqType===TC.DT_META){
      core._uc(mkDataMeta(layerReq, layerData), rinfo.port, rinfo.address);
    }else if(reqType===TC.DT_METRICS){
      core._uc(mkDataMetrics(layerReq, layerData, faderVal), rinfo.port, rinfo.address);
    }else{
      core._uc(mkDataMeta(layerReq, layerData), rinfo.port, rinfo.address);
      core._uc(mkDataMetrics(layerReq, layerData, faderVal), rinfo.port, rinfo.address);
    }
  }
  // 0xC8 Data Packet — parse incoming MixerData (DataType 150) for VU meters
  // Audio Level = real-time channel VU (0-255, pulses with music)
  if(type===TC.DATA && msg.length>=TC.H+2){
    const body = msg.slice(TC.H);
    const dataType = body[0];
    if(dataType===TC.DT_MIXER && body.length>=246){
      // Master Audio Level: body+37 (byte 61), Master Fader: body+38 (byte 62)
      const masterAudio = body[37];
      const masterFader = body[38];
      // Cross Fader: body+75 (byte 99)
      const xfader = body[75];
      // Per-channel blocks: body offset = 101 + ch*24 (byte 125 + ch*24), 6 channels max
      const chAudio=[],chFader=[],chCueA=[],chCueB=[],chXfAssign=[];
      for(let ch=0;ch<6;ch++){
        const off=101+ch*24;
        chAudio.push(off+1<body.length?body[off+1]:0);
        chFader.push(off+2<body.length?body[off+2]:0);
        chCueA.push(off+11<body.length?body[off+11]:0);
        chCueB.push(off+12<body.length?body[off+12]:0);
        chXfAssign.push(off+13<body.length?body[off+13]:0);
      }
      // Throttled log: once every 2s
      const now=Date.now();
      if(!core._tcMixerLogAt||now-core._tcMixerLogAt>2000){
        core._tcMixerLogAt=now;
        try{console.log(`[TCNet] MixerData from=${rinfo.address} masterAudio=${masterAudio} chAudio=[${chAudio}] cueA=[${chCueA}] xfAssign=[${chXfAssign}]`);}catch(_){}
      }
      core.onTCMixerVU?.({masterAudio,masterFader,xfader,chAudio,chFader,chCueA,chCueB,chXfAssign,from:rinfo.address});
    }
  }
}

module.exports = { handleTCNetMsg, registerTCNetNode, TCNET_MAX_NODES, TCNET_NODE_TTL_MS };
