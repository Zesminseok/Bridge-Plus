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

// PERF: hot path 최적화 — case-insensitive 'BRIDGE' prefix check 를
//   uppercase 문자열 생성 없이 byte 비교로 (60+/sec UDP).
//   ('B'|0x20)='b' = 0x62, 'R'=0x72, 'I'=0x69, 'D'=0x64, 'G'=0x67, 'E'=0x65.
const _BRIDGE_LOWER = [0x62, 0x72, 0x69, 0x64, 0x67, 0x65];
function _startsWithBridgeCI(msg, offset){
  if(msg.length < offset + 6) return false;
  for(let i=0;i<6;i++){
    if((msg[offset+i] | 0x20) !== _BRIDGE_LOWER[i]) return false;
  }
  return true;
}

// PERF: 이름 8바이트 추출 — slice→toString→replace→trim 4회 allocation 회피.
//   NUL 또는 공백까지만 ASCII 로 직접 디코드.
function _readName8(msg, offset){
  let end = offset + 8;
  for(let i=offset;i<end;i++){
    const c = msg[i];
    if(c === 0 || c === 0x20){ end = i; break; }
  }
  return msg.toString('ascii', offset, end);
}

// PERF: MixerData VU 배열 6개를 매 패킷마다 새로 할당하지 않도록
//   per-core scratch 으로 재사용. core._mixerVuScratch 가 없으면 lazy init.
function _getMixerScratch(core){
  let s = core._mixerVuScratch;
  if(!s){
    s = core._mixerVuScratch = {
      chAudio: new Array(6).fill(0),
      chFader: new Array(6).fill(0),
      chCueA:  new Array(6).fill(0),
      chCueB:  new Array(6).fill(0),
      chXfAssign: new Array(6).fill(0),
    };
  }
  return s;
}

// 신규 노드 등록 직전 cap/TTL 강제 — bridge-core 의 _startListenerPortRx 에서도 재사용.
// PERF: nodes 멤버십이 바뀌면 core._nodesGen 을 증가 — virtual-deck 등 consumer 가
//   캐시 무효화 신호로 활용 (Object.values(nodes) 매 호출 회피).
function registerTCNetNode(core, key, entry){
  const nodes = core.nodes;
  // 이미 존재하면 update 만 (cap 영향 없음 + gen 안 올림 — IP/이름 등 stable 식별자는 그대로).
  if(nodes[key]){ Object.assign(nodes[key], entry); return false; }
  // cap 도달 시: 먼저 stale (TTL 초과) entry 제거, 그래도 차면 LRU evict.
  const keys = Object.keys(nodes);
  let evicted = 0;
  if(keys.length >= TCNET_MAX_NODES){
    const now = Date.now();
    for(const k of keys){
      if(now - (nodes[k]?.lastSeen||0) > TCNET_NODE_TTL_MS){
        delete nodes[k];
        evicted++;
      }
    }
    if(Object.keys(nodes).length >= TCNET_MAX_NODES){
      // LRU: 가장 오래된 lastSeen 제거.
      let oldestKey = null, oldestSeen = Infinity;
      for(const k of Object.keys(nodes)){
        const ls = nodes[k]?.lastSeen||0;
        if(ls < oldestSeen){ oldestSeen = ls; oldestKey = k; }
      }
      if(oldestKey){ delete nodes[oldestKey]; evicted++; }
    }
  }
  nodes[key] = entry;
  core._nodesGen = (core._nodesGen|0) + 1 + evicted;
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
  // 2차 방어: 'BRIDGE' prefix CI byte check — name 문자열 생성 없이 reject.
  if(_startsWithBridgeCI(msg, 8)) return;
  // 3차 방어: 송신 포트가 우리 소켓이면 loop
  if(core._ownPorts && core._ownPorts.has(rinfo.port) &&
     (rinfo.address===core.localAddr || rinfo.address==='127.0.0.1')) return;
  // PERF: name 추출은 위 빠른 reject 후에 — 통과한 패킷에 대해서만 한 번.
  const name = _readName8(msg, 8);

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
  // BRIDGE prefix 는 진입부에서 이미 reject — 추가 체크 불필요.
  if(type!==TC.OPTIN){
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
    // PERF: body slice 회피 — msg 직접 read.
    const lPort = msg.length>=TC.H+22 ? msg.readUInt16LE(TC.H+20) : rinfo.port;
    const key = name+'@'+rinfo.address;
    if(core.nodes[key]) core.nodes[key].lPort = lPort || rinfo.port;
    try{ core.txSocket?.send(mkAppResp(core.listenerPort),0,62,rinfo.port,rinfo.address); }catch(_){}
  }
  // 0x14 MetadataRequest — Arena asks for track metadata on a layer
  // body: [dataType, layer(1-based)]; reply with requested Data payload.
  if(type===0x14){
    // PERF: body slice 회피 — msg 직접 read.
    const reqType = msg.length>=TC.H+1 ? msg[TC.H] : 0;
    const layerReq = msg.length>=TC.H+2 ? msg[TC.H+1] : 0;  // 1-based
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
    // PERF: body slice 회피 — msg 직접 offset 읽기.
    const dataType = msg[TC.H];
    if(dataType===TC.DT_MIXER && msg.length>=TC.H+246){
      // Master Audio Level: body+37 (byte 61), Master Fader: body+38 (byte 62)
      const masterAudio = msg[TC.H+37];
      const masterFader = msg[TC.H+38];
      // Cross Fader: body+75 (byte 99)
      const xfader = msg[TC.H+75];
      // PERF: per-core scratch 배열 재사용 — push() 매 패킷 할당 회피.
      const sc = _getMixerScratch(core);
      // Per-channel blocks: msg offset = TC.H + 101 + ch*24, 6 channels max
      for(let ch=0;ch<6;ch++){
        const off=TC.H+101+ch*24;
        sc.chAudio[ch]    = off+1<msg.length?msg[off+1]:0;
        sc.chFader[ch]    = off+2<msg.length?msg[off+2]:0;
        sc.chCueA[ch]     = off+11<msg.length?msg[off+11]:0;
        sc.chCueB[ch]     = off+12<msg.length?msg[off+12]:0;
        sc.chXfAssign[ch] = off+13<msg.length?msg[off+13]:0;
      }
      // Throttled log: once every 2s
      const now=Date.now();
      if(!core._tcMixerLogAt||now-core._tcMixerLogAt>2000){
        core._tcMixerLogAt=now;
        try{console.log(`[TCNet] MixerData from=${rinfo.address} masterAudio=${masterAudio} chAudio=[${sc.chAudio}] cueA=[${sc.chCueA}] xfAssign=[${sc.chXfAssign}]`);}catch(_){}
      }
      // 호출자가 array 를 mutate 하지 않는다는 가정 — bridge-core 의 onTCMixerVU 는 read-only 사용.
      core.onTCMixerVU?.({masterAudio,masterFader,xfader,chAudio:sc.chAudio,chFader:sc.chFader,chCueA:sc.chCueA,chCueB:sc.chCueB,chXfAssign:sc.chXfAssign,from:rinfo.address});
    }
  }
}

// lPort RX 전용 핸들러 — listener port socket 에 도착하는 OPTIN/APP/0x14.
// 차이점 vs handleTCNetMsg:
//   - log prefix '[TCNet] lPort ...' (메인 RX 와 구분)
//   - 신규 노드 등록 시 500ms 지연 후 artwork 재전송 (새로 들어온 Arena 동기화)
//   - DT_MIXER (0xC8) 분기 없음 — lPort 에는 안 옴
function handleTCNetLPortMsg(core, deps, msg, rinfo){
  const { TC, mkDataMeta, mkDataMetrics, mkAppResp } = deps;

  if(msg.length<TC.H) return;
  if(msg[4]!==0x54||msg[5]!==0x43||msg[6]!==0x4E) return;
  if(msg[0]===TC.NID[0] && msg[1]===TC.NID[1]) return;
  const type = msg[7];
  if(_startsWithBridgeCI(msg, 8)) return;
  if(core._ownPorts && core._ownPorts.has(rinfo.port) &&
     (rinfo.address===core.localAddr || rinfo.address==='127.0.0.1')) return;
  const name = _readName8(msg, 8);

  // Only log first occurrence of each type from each source
  const lk = name+type;
  if(!core._lPortDbg) core._lPortDbg = {};
  if(!core._lPortDbg[lk]){
    core._lPortDbg[lk] = true;
    try{ console.log(`[TCNet] lPort ${name} type=0x${type.toString(16)} from ${rinfo.address}:${rinfo.port}`); }catch(_){}
  }

  if(type===TC.OPTIN){
    const body = msg.slice(TC.H);
    const lPort = body.length>=4 ? body.readUInt16LE(2) : 0;
    const vendor = body.length>=40 ? body.slice(8,24).toString('ascii').replace(/\0/g,'').trim() : '';
    const device = body.length>=40 ? body.slice(24,40).toString('ascii').replace(/\0/g,'').trim() : '';
    const key = name+'@'+rinfo.address;
    const isNew = registerTCNetNode(core, key, {name,vendor,device,type:msg[17],ip:rinfo.address,port:rinfo.port,lPort,lastSeen:Date.now()});
    if(isNew){
      console.log(`[TCNet] lPort OptIn: ${name}@${rinfo.address} lPort=${lPort} vendor=${vendor} device=${device}`);
      setTimeout(()=>core._resendAllArtwork(), 500);
    }
    core.onNodeDiscovered?.(core.nodes[key]);
  }
  // Register any Arena-like node even without OptIn (Arena sends APP/0x1e/0x14 but NOT OptIn)
  if(type!==TC.OPTIN){
    const key = name+'@'+rinfo.address;
    if(!core.nodes[key]){
      const isNew = registerTCNetNode(core, key, {name,vendor:'',device:'',type:msg[17],ip:rinfo.address,port:rinfo.port,lPort:rinfo.port,lastSeen:Date.now()});
      if(isNew){
        console.log(`[TCNet] lPort auto-register ${name}@${rinfo.address} lPort=${rinfo.port} (from type=0x${type.toString(16)})`);
        setTimeout(()=>core._resendAllArtwork(), 500);
        core.onNodeDiscovered?.(core.nodes[key]);
      }
    } else {
      core.nodes[key].lastSeen = Date.now();
    }
  }
  if(type===TC.APP){
    const lPort = msg.length>=TC.H+22 ? msg.readUInt16LE(TC.H+20) : rinfo.port;
    const key = name+'@'+rinfo.address;
    if(core.nodes[key]) core.nodes[key].lPort = lPort || rinfo.port;
    if(!core._lPortDbg['app_'+rinfo.address]){
      core._lPortDbg['app_'+rinfo.address] = true;
      console.log(`[TCNet] lPort APP from ${name} → ${rinfo.address}:${rinfo.port} lPort=${lPort}`);
    }
    try{ core.txSocket?.send(mkAppResp(core.listenerPort),0,62,rinfo.port,rinfo.address); }catch(_){}
  }
  if(type===0x14){
    // PERF: msg.slice(TC.H) 회피 — 직접 read.
    const layerReq = msg.length>=TC.H+1 ? msg[TC.H] : 0;  // 1-based (lPort 변형: layerReq=byte0, reqType=byte1)
    const reqType = msg.length>=TC.H+2 ? msg[TC.H+1] : 0;
    const li = layerReq - 1;
    const layerData = (li >= 0 && li < core.layers.length) ? core.layers[li] : null;
    const metaPkt = mkDataMeta(layerReq, layerData);
    core._uc(metaPkt, rinfo.port, rinfo.address);
    const faderVal = core.faders ? (core.faders[li] || 0) : 0;
    const metricsPkt = mkDataMetrics(layerReq, layerData, faderVal);
    core._uc(metricsPkt, rinfo.port, rinfo.address);
  }
}

module.exports = { handleTCNetMsg, handleTCNetLPortMsg, registerTCNetNode, TCNET_MAX_NODES, TCNET_NODE_TTL_MS };
