// TCNet outbound senders — bridge-core.js 에서 추출 (Phase 5.6).
// 모든 broadcast/unicast 송신 + DATA cycle + Artwork chunking.
// 동작 보존: 송신 경로/순서/throttle 동일.
//
// deps: { TC, mkLowResArtwork, mkDataMeta, mkDataMetrics, mkOptIn, mkStatus,
//          getAllInterfaces } — 모듈 자체에 import 안 하고 호출자가 주입.
'use strict';

const NODE_FRESH_MS = 15000; // discovered Arena 노드 신선도 (lastSeen 차이)

// broadcast 모드: txSocket 으로 broadcastAddr + 모든 NIC + 자기 IP + loopback.
// unicast 모드: discovered Arena 노드 IP 만 (allIfaces 옵션 시 모든 NIC × 모든 IP).
function send(core, deps, buf, port){
  const { getAllInterfaces } = deps;
  if(!core.running||!core.txSocket) return;
  // ── Unicast mode: only send to discovered Arena nodes ──
  if(core.tcnetUnicast && !core.isLocalMode){
    const sent=new Set();
    for(const node of Object.values(core.nodes)){
      if(Date.now()-node.lastSeen > NODE_FRESH_MS || sent.has(node.ip)) continue;
      sent.add(node.ip);
      try{ core.txSocket.send(buf, 0, buf.length, port, node.ip); }catch(_){}
    }
    if(core.tcnetAllIfaces){
      for(const iface of getAllInterfaces()){
        if(iface.internal) continue;
        for(const ip of sent){
          try{ core.txSocket.send(buf, 0, buf.length, port, ip); }catch(_){}
        }
      }
    }
    try{ core.txSocket.send(buf, 0, buf.length, port, '127.0.0.1'); }catch(_){}
    return;
  }
  // ── Broadcast mode (default) ──
  try{ core.txSocket.send(buf, 0, buf.length, port, core.broadcastAddr); }catch(_){}
  if(!core.isLocalMode){
    if(!core.tcnetBindAddr || core.tcnetBindAddr==='auto' || core.tcnetBindAddr==='0.0.0.0'){
      const sent=new Set([core.broadcastAddr]);
      for(const iface of getAllInterfaces()){
        if(!iface.internal && iface.broadcast && !sent.has(iface.broadcast)){
          sent.add(iface.broadcast);
          try{ core.txSocket.send(buf, 0, buf.length, port, iface.broadcast); }catch(_){}
        }
      }
    } else if(core.broadcastAddr!=='255.255.255.255'){
      try{ core.txSocket.send(buf, 0, buf.length, port, '255.255.255.255'); }catch(_){}
    }
    // dataSocket (bound 0.0.0.0)로 나머지 인터페이스 브로드캐스트 — DJM 이 link-local 에서도 TCNet 수신.
    if(core._dataSocket){
      const mainBC=core.broadcastAddr;
      for(const iface of getAllInterfaces()){
        if(!iface.internal && iface.broadcast && iface.broadcast!==mainBC && iface.broadcast!=='127.255.255.255'){
          try{ core._dataSocket.send(buf, 0, buf.length, port, iface.broadcast); }catch(_){}
        }
      }
    }
    if(core.localAddr){
      try{ core.txSocket.send(buf, 0, buf.length, port, core.localAddr); }catch(_){}
    }
    try{ core.txSocket.send(buf, 0, buf.length, port, '127.0.0.1'); }catch(_){}
  }
}

// Unicast — DATA 응답 송신용 (dedicated _dataSocket 우선).
function uc(core, buf, port, ip){
  if(!core.running||!ip||!port) return;
  const sock = core._dataSocket || core.txSocket;
  if(!sock) return;
  try{ sock.send(buf, 0, buf.length, port, ip); }catch(_){}
}

// 알려진 모든 Arena 노드에 unicast (port 지정).
function sendToArenas(core, buf, port){
  if(!core.running||!core.txSocket) return;
  for(const node of Object.values(core.nodes)){
    if(Date.now()-node.lastSeen > NODE_FRESH_MS) continue;
    try{ core.txSocket.send(buf, 0, buf.length, port, node.ip); }catch(_){}
  }
}

// 각 Arena 의 listener port (lPort) 로 송신 + loopback fallback.
function sendToArenasLPort(core, buf){
  if(!core.running||!core.txSocket) return;
  for(const node of Object.values(core.nodes)){
    if(Date.now()-node.lastSeen > NODE_FRESH_MS) continue;
    if(!node.lPort) continue;
    try{ core.txSocket.send(buf, 0, buf.length, node.lPort, node.ip); }catch(_){}
    if(!core.isLocalMode){try{ core.txSocket.send(buf, 0, buf.length, node.lPort, '127.0.0.1'); }catch(_){}}
  }
}

// DATA 패킷 — _dataSocket 으로 Arena lPort + DATA port 브로드캐스트 fallback.
function sendDataToArenas(core, deps, buf){
  const { TC } = deps;
  const sock = core._dataSocket || core.txSocket;
  if(!core.running || !sock) return;
  for(const node of Object.values(core.nodes)){
    if(Date.now()-node.lastSeen > NODE_FRESH_MS) continue;
    if(!node.lPort) continue;
    try{ sock.send(buf, 0, buf.length, node.lPort, node.ip); }catch(_){}
    if(!core.isLocalMode){try{ sock.send(buf, 0, buf.length, node.lPort, '127.0.0.1'); }catch(_){}}
  }
  try{ sock.send(buf, 0, buf.length, TC.P_DATA, core.broadcastAddr); }catch(_){}
}

// LowResArtwork (0xCC) 패킷 — JPEG 을 MTU-safe chunk 로 분할.
function sendArtwork(core, deps, layerIdx, jpegBuf){
  const { mkLowResArtwork } = deps;
  if(!jpegBuf || !core.running) return;
  const packets = mkLowResArtwork(layerIdx, jpegBuf);
  for(const pkt of packets){
    sendDataToArenas(core, deps, pkt);
  }
}

// 새 노드 합류 시 모든 저장된 artwork 재전송 — UDP 손실 방지 50ms stagger.
function resendAllArtwork(core, deps){
  if(!core.running) return;
  let count = 0;
  for(let i = 0; i < 8; i++){
    const buf = core._virtualArt[i];
    if(buf && buf.length > 100){  // skip BLANK_JPEG
      setTimeout(()=>sendArtwork(core, deps, i + 1, buf), count * 50);
      count++;
    }
  }
  if(count > 0) console.log(`[TCNet-ART] resending ${count} artwork(s) to new node`);
}

// DATA cycle (24 packets): Phase 1 (0-7) Metrics, Phase 2 (8-15) Meta, Phase 3 (16-23) Metrics.
// 빈 layer skip; Meta 패킷은 trackId+names 기반 cache.
function sendDataCycle(core, deps){
  const { mkDataMeta, mkDataMetrics } = deps;
  if(!core.running) return;
  const idx = core._dataLayerIdx;
  let pkt;
  if(idx < 8){
    const layerIdx = idx + 1, li = idx;
    const layerData = core.layers[li] || null;
    if(!layerData){core._dataLayerIdx=(idx+1)%24;return;}
    const faderVal = core.faders ? (core.faders[li] || 0) : 0;
    pkt = mkDataMetrics(layerIdx, layerData, faderVal);
  } else if(idx < 16){
    const layerIdx = (idx - 8) + 1, li = layerIdx - 1;
    const layerData = core.layers[li] || null;
    if(!layerData){core._dataLayerIdx=(idx+1)%24;return;}
    const metaKey = `${layerData.trackId||0}_${layerData.trackName||''}_${layerData.artistName||''}`;
    if(core._metaCache && core._metaCache[li] && core._metaCache[li].key === metaKey){
      pkt = core._metaCache[li].pkt;
    } else {
      pkt = mkDataMeta(layerIdx, layerData);
      if(!core._metaCache) core._metaCache = new Array(8).fill(null);
      core._metaCache[li] = {key:metaKey, pkt};
    }
  } else {
    const layerIdx = (idx - 16) + 1, li = layerIdx - 1;
    const layerData = core.layers[li] || null;
    if(!layerData){core._dataLayerIdx=(idx+1)%24;return;}
    const faderVal = core.faders ? (core.faders[li] || 0) : 0;
    pkt = mkDataMetrics(layerIdx, layerData, faderVal);
  }
  sendDataToArenas(core, deps, pkt);
  core._dataLayerIdx = (idx + 1) % 24;
  core.packetCount++;
}

function sendOptIn(core, deps){
  const { mkOptIn, TC } = deps;
  const n = Math.max(1, Object.keys(core.nodes).length + 1);
  const pkt = mkOptIn(core.listenerPort, Math.floor((Date.now()-core.startTime)/1000), n);
  send(core, deps, pkt, TC.P_BC);
  sendToArenas(core, pkt, TC.P_BC);
  sendToArenasLPort(core, pkt);
}

function sendStatus(core, deps){
  const { mkStatus, TC } = deps;
  const pkt = mkStatus(core.listenerPort, core.devices, core.layers, core.faders, core.hwMode);
  send(core, deps, pkt, TC.P_BC);
  sendToArenas(core, pkt, TC.P_BC);
  sendToArenasLPort(core, pkt);
}

module.exports = {
  send, uc, sendToArenas, sendToArenasLPort, sendDataToArenas,
  sendArtwork, resendAllArtwork, sendDataCycle, sendOptIn, sendStatus,
  NODE_FRESH_MS,
};
