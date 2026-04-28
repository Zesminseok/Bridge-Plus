'use strict';
/**
 * BridgeCore — TCNet v3.5 node + Pro DJ Link receiver
 *
 * Sends OptIn(0x02) + Status(0x05) + TIME(0xFE) on TCNet ports.
 * Receives CDJ status and DJM meter data via Pro DJ Link (UDP 50001/50002).
 * Packet layouts recovered from live traffic and device behavior.
 */
const dgram = require('dgram');
const net   = require('net');
const os    = require('os');
const path  = require('path');
const fs    = require('fs');

// 디버그 로그 — Desktop 우선, CloudStorage 동기화 폴더면 tmpdir 폴백.
// freeze 회피: ① console.log 사용 안 함 ② Desktop 이 CloudStorage 로 redirect 되어 있으면 skip.
function _resolveDbgLogPath(){
  const home = os.homedir();
  // CloudStorage(Dropbox/iCloud/OneDrive) 동기화 폴더는 write 마다 동기화 → freeze 유발. 회피.
  const isCloudSynced = (p) => {
    try{
      const real = fs.realpathSync(path.dirname(p));
      return /CloudStorage|Dropbox|iCloud|com~apple~CloudDocs|OneDrive/.test(real);
    }catch(_){ return false; }
  };
  // 1순위: Desktop (사용자 접근성). 동기화 폴더이거나 실패하면 tmpdir 로 폴백.
  const candidates = [
    path.join(home, 'Desktop', 'bridge-debug.log'),
    path.join(home, '바탕 화면', 'bridge-debug.log'),
    path.join(os.tmpdir(), 'bridge-debug.log'),
  ];
  for(const p of candidates){
    try{
      const dir = path.dirname(p);
      fs.mkdirSync(dir, { recursive: true });
      // CloudStorage 동기화 폴더는 skip
      if(isCloudSynced(p)) continue;
      fs.writeFileSync(p, '');
      return p;
    }catch(_){}
  }
  return null;
}
const _DBG_LOG_PATH = _resolveDbgLogPath();
let _dbgLogInited = false;
let _dbgLogQueue = [];
let _dbgLogFlushScheduled = false;
function _dbgLogFlush(){
  if(!_DBG_LOG_PATH || _dbgLogQueue.length===0){ _dbgLogFlushScheduled=false; return; }
  const chunk = _dbgLogQueue.join('');
  _dbgLogQueue = [];
  fs.appendFile(_DBG_LOG_PATH, chunk, ()=>{ _dbgLogFlushScheduled=false; });
}
function _dbgLog(msg){
  // console.log 제거 — Electron production 빌드에서 stdout 파이프 버퍼 풀(64KB) 시 동기 블록 → UI freeze.
  if(!_DBG_LOG_PATH) return;
  try{
    if(!_dbgLogInited){
      // 초기 헤더 비동기 write — sync 사용 안 함.
      _dbgLogQueue.push(`=== BRIDGE+ debug log — started ${new Date().toISOString()} ===\nlog path: ${_DBG_LOG_PATH}\n`);
      _dbgLogInited = true;
    }
    _dbgLogQueue.push(`[${new Date().toISOString()}] ${msg}\n`);
    if(!_dbgLogFlushScheduled){
      _dbgLogFlushScheduled = true;
      setImmediate(_dbgLogFlush);
    }
  }catch(_){}
}

// ─────────────────────────────────────────────
// TCNet 상수
// ─────────────────────────────────────────────
// TCNet 상수/STATE/P1 매핑 → tcnet/packets.js (Phase 4.10 modularization)
const {
  TC, STATE, toTCNetState, P1_TO_STATE, P1_NAME,
  u32, clamp8, buildHdr,
  mkOptIn, mkStatus, mkTime, mkAppResp, mkMetadataResp,
  mkDataMetrics, mkMixerData, mkDataMeta, mkNotification, mkLowResArtwork,
} = require('./tcnet/packets');

// PDJL 패킷 빌더 → pdjl/packets.js (Phase 4.8 modularization)
const {
  PDJL,
  pdjlBridgeAnnounceId,
  pdjlIdentityByteFromMac,
  buildPdjlBridgeHelloPacket,
  buildPdjlBridgeClaimPacket,
  buildPdjlBridgeKeepalivePacket,
  buildDjmSubscribePacket,
  buildDbServerKeepalivePacket,
  buildBridgeNotifyPacket,
  hasPDJLMagic,
  readPDJLNameField,
} = require('./pdjl/packets');

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────
// _seq / u32 / clamp8 / _writeUtf32LE / buildHdr → tcnet/packets.js (위 require)

// Network helpers → pdjl/network.js (Phase 4.18 modularization).
// (이전 _hwPortMap state + _getHWPortMap 등 모두 module-local 로 이동)
const _NET = require('./pdjl/network');
const _getHWPortMap = _NET._getHWPortMap;
const getAllInterfaces = _NET.getAllInterfaces;
const interfaceSignature = _NET.interfaceSignature;
const sanitizeInterfaceSelection = _NET.sanitizeInterfaceSelection;
const detectBroadcastFor = _NET.detectBroadcastFor;
const pdjlBroadcastTargets = _NET.pdjlBroadcastTargets;

// hasPDJLMagic / readPDJLNameField → pdjl/packets.js (위 require 로 가져옴)
// TCNet 패킷 빌더 mk* (mkOptIn~mkLowResArtwork) → tcnet/packets.js (Phase 4.10)

// ─────────────────────────────────────────────
// Pro DJ Link parser
// ─────────────────────────────────────────────
// parsePDJL → pdjl/parser.js (Phase 4.9)
const { parsePDJL } = require('./pdjl/parser');
// dbserver protocol pure helpers → pdjl/dbserver.js (Phase 4.11 + 5.3a parser/IO)
const _DB = require('./pdjl/dbserver');
const _DBIO = require('./pdjl/dbserver-io');
// TCP session pool → bridge/dbserver-pool.js (Phase 5.3b)
const { DbServerPool } = require('./bridge/dbserver-pool');
// dbserver client request methods → bridge/dbserver-client.js (Phase 5.3c)
const _dbcli = require('./bridge/dbserver-client');
// dbserver orchestrator → bridge/dbserver-orchestrator.js (Phase 5.4)
const _dborch = require('./bridge/dbserver-orchestrator');
const _vd = require('./bridge/virtual-deck');

// BLANK_JPEG → bridge/virtual-deck.js (Phase 5.2). 두 모듈에서 중복 로드 방지.
const BLANK_JPEG = _vd.BLANK_JPEG;

// nxs2BeatCountToMs / shouldKeepPredictedBeatAnchor → bridge/beat-anchor.js (Phase 5.1)
const { nxs2BeatCountToMs, shouldKeepPredictedBeatAnchor } = require('./bridge/beat-anchor');

// BridgeCore
// ─────────────────────────────────────────────
class BridgeCore {
  constructor(opts={}){
    this.tcnetBindAddr  = opts.tcnetIface||null;
    this.pdjlBindAddr   = opts.pdjlIface||null;
    this._requestedName = opts.nodeName||null;
    this.broadcastAddr = 'auto';

    this.isLocalMode   = (opts.tcnetIface==='127.0.0.1');

    this.tcnetMode = opts.tcnetMode || 'auto';  // 'auto' | 'server' | 'client'
    this.tcnetUnicast   = !!opts.tcnetUnicast;
    this.tcnetAllIfaces = !!opts.tcnetAllIfaces;

    this.listenerPort  = 0;  // dynamically assigned on start()
    this.txSocket      = null;
    this.rxSocket      = null;
    this.lPortSocket   = null;  // listener port RX socket
    this.pdjlSocket    = null;
    this._ownPorts     = new Set();  // local ports of our sockets — drop self-loop packets
    this.pdjlPort      = null;
    this.startTime     = Date.now();
    this.running       = false;
    this.packetCount   = 0;
    this._timers       = [];

    this.layers  = new Array(8).fill(null);   // 8 layers (1-8)
    this.hwMode  = new Array(8).fill(false);
    this.nodes   = {};
    this.devices = {};
    this.faders  = [255,255,255,255];  // 페이더 기본값 100% — 실 0x39 도착 시 덮어씀
    this.onAir   = [0,0,0,0];  // DJM Channels-On-Air flags
    this._hasRealFaders = false;
    this._djmMixer = null;  // last parsed DJM 0x39 mixer state
    this._tcAcc = new Array(8).fill(null);

    this.onNodeDiscovered = null;
    this.onCDJStatus      = null;
    this.onDJMStatus      = null;
    this.onDJMMeter       = null;
    this.onDeviceList     = null;
    this.onWaveformPreview = null;  // (playerNum, {seg, pts, wfType}) => {}
    this.onWaveformDetail  = null;  // (playerNum, {pts, wfType:'detail'}) => {}
    this.onCuePoints       = null;  // (playerNum, [{name, type, time, colorId}]) => {}
    this.onBeatGrid        = null;  // (playerNum, {beats:[{beatInBar,bpm,timeMs}], baseBpm}) => {}
    this.onSongStructure   = null;  // (playerNum, {phrases:[{timeMs,kind,label,color,beat}], endMs, mood}) => {}
    this.onAlbumArt       = null;   // (playerNum, jpegBuffer) => {}
    this._artCache = {};  // trackId -> {playerNum, jpegBase64}
    this._beatGrids = {};   // playerNum -> [{beatInBar, bpm, timeMs}]
    this._bgTrackLen = {}; // playerNum -> estimated track length ms (beat grid last beat + interval)
    this._dbConns  = {};  // ip -> net.Socket
    // TCP session pool (Phase 5.3b) — `${ip}|${spoofPlayer}` 별 single socket 재사용.
    this._dbPool = new DbServerPool({ DB: _DB, DBIO: _DBIO });
    this._virtualArt = {};  // slot -> Buffer (JPEG data for virtual deck artwork)
    this._dbSrv = null;  // virtual dbserver (TCP 12523 emulation)
    this._lastVdbTrackId = 0;  // last trackId from 0x2002 (cross-connection fallback)
    this._logRate = {};
    this._djmSeenTypes = new Set();
  }

  _shouldLogRate(key, intervalMs=3000, summary=null){
    const now = Date.now();
    const prev = this._logRate[key];
    if(!prev){
      this._logRate[key] = { time: now, summary };
      return true;
    }
    if(summary!=null && prev.summary!==summary){
      this._logRate[key] = { time: now, summary };
      return true;
    }
    if((now - prev.time) >= intervalMs){
      this._logRate[key] = { time: now, summary: summary!=null ? summary : prev.summary };
      return true;
    }
    return false;
  }

  _resolveBroadcast(){
    if(this.isLocalMode){ this.localAddr=null; return '127.0.0.1'; }
    // detect own IP for unicast — prefer non-link-local (main LAN where Resolume lives)
    this.localAddr = null;
    let fallbackAddr = null;
    for(const iface of getAllInterfaces()){
      if(!iface.internal && iface.address!=='127.0.0.1'){
        if(!iface.address.startsWith('169.254.')){
          this.localAddr = iface.address;
          break;
        } else if(!fallbackAddr) fallbackAddr = iface.address;
      }
    }
    if(!this.localAddr) this.localAddr = fallbackAddr;
    if(this.tcnetBindAddr && this.tcnetBindAddr!=='auto' && this.tcnetBindAddr!=='0.0.0.0'){
      this.localAddr = this.tcnetBindAddr;
    }
    const bc = detectBroadcastFor(this.tcnetBindAddr);
    console.log(`[TCNet] resolve: bindAddr=${this.tcnetBindAddr||'auto'} localAddr=${this.localAddr} bc=${bc}`);
    return bc;
  }

  async start(){
    this.broadcastAddr = this._resolveBroadcast();

    if(!this._nameSet){
      const existingNames = new Set(Object.values(this.nodes).map(n=>n.name));
      const req = this._requestedName;
      if(req && req.endsWith('%%')){
        // Auto-number: find available slot with custom prefix
        const prefix = req.slice(0,-2);
        let found = prefix+'01';
        for(let n=1; n<=99; n++){
          const cand = prefix + String(n).padStart(2,'0');
          if(!existingNames.has(cand)){ found=cand; break; }
        }
        TC.NNAME = found.slice(0,8);
      } else if(req && req.trim()){
        TC.NNAME = req.trim().slice(0,8);
      } else {
        // Default auto-numbering with 'Bridge' prefix
        let suffix='01';
        for(let n=1; n<=8; n++){
          const candidate='Bridge'+String(n).padStart(2,'0');
          if(!existingNames.has(candidate)){ suffix=String(n).padStart(2,'0'); break; }
        }
        TC.NNAME = 'Bridge'+suffix;
      }
      this._nameSet = true;
      console.log(`[TCNet] name=${TC.NNAME}`);
    }

    // TCNet mode: Auto/Server → 0x02 (Server), Client → 0x04
    if(this.tcnetMode === 'client'){
      TC.NTYPE = 0x04;  // Client
    } else {
      TC.NTYPE = 0x02;  // Server
    }
    console.log(`[TCNet] mode=${this.tcnetMode} NodeType=0x${TC.NTYPE.toString(16)}`);

    // TX socket — binds to ephemeral port on P_BC (60000)
    this.txSocket = dgram.createSocket({type:'udp4', reuseAddr:true});
    this.txSocket.on('error', ()=>{});

    await new Promise((res,rej)=>{
      let attempts = 0;
      const tryBind = port => {
        if(++attempts > 3){
          console.warn('[TCNet] TX bind failed after 3 attempts, falling back to 127.0.0.1');
          this.txSocket.bind(0, '127.0.0.1', ()=>{ res(); });
          return;
        }
        const onErr = ()=>{
          this.txSocket.removeAllListeners('error');
          this.txSocket.on('error',()=>{});
          tryBind(0);
        };
        this.txSocket.once('error', onErr);
        this.txSocket.bind(port, this.isLocalMode?'127.0.0.1':(this.tcnetBindAddr||undefined), ()=>{
          this.txSocket.removeListener('error', onErr);
          if(!this.isLocalMode) this.txSocket.setBroadcast(true);
          try{this._ownPorts.add(this.txSocket.address().port);}catch(_){}
          res();
        });
      };
      tryBind(0);
    });

    // Arena sends MetadataRequest(0x14) to Bridge's txSocket source port
    this.txSocket.on('message',(msg,rinfo)=>this._handleTCNetMsg(msg, rinfo, 'tx-RX'));

    // Dedicated DATA socket — DATA/Metrics/Meta use a separate ephemeral port
    this._dataSocket = dgram.createSocket({type:'udp4', reuseAddr:true});
    this._dataSocket.on('error',()=>{});
    await new Promise(r=>this._dataSocket.bind(0, this.isLocalMode?'127.0.0.1':undefined, r));
    try{this._ownPorts.add(this._dataSocket.address().port);}catch(_){}
    console.log(`[TCNet] DATA socket bound to port ${this._dataSocket.address().port}`);

    this.running = true; this.startTime = Date.now();

    await this._startListenerPortRx();

    // Transmission rates used by the current timing model:
    //   OptIn: ~1/sec, Status: ~6/sec, TIME: ~30/sec, DATA: ~6/sec per layer
    this._sendOptIn();
    this._sendStatus();
    this._dataLayerIdx = 0;
    const notifyPkt = mkNotification();
    this._send(notifyPkt, TC.P_BC);
    this._sendToArenasLPort(notifyPkt);

    const t1 = setInterval(()=>this._sendOptIn(), 1000);
    const t2 = setInterval(()=>this._sendStatus(), 170);
    const t3 = setInterval(()=>{
      const timePkt = mkTime(this.layers, Date.now()-this.startTime, this.faders);
      this._send(timePkt, TC.P_TIME);
      this._sendToArenas(timePkt, TC.P_TIME);
      this._sendToArenasLPort(timePkt);
      this.packetCount++;
    }, 33);
    // DATA packets cycle through layers: MetricsData + MetaData per layer
    // Sent via dedicated _dataSocket (separate from txSocket)
    const t4 = setInterval(()=>this._sendDataCycle(), 170);
    // Mixer Data (Type 150) — fader levels to Arena at 10fps (on-air is binary, no need for 60fps)
    const t5 = setInterval(()=>{
      if(!this.running) return;
      const djm = Object.values(this.devices).find(d=>d.type==='DJM');
      const pkt = mkMixerData(this.faders, djm?.name, this._djmMixer);
      this._sendDataToArenas(pkt);
    }, 100);

    this._timers = [t1, t2, t3, t4, t5];
    this._startTCNetRx();

    // Start PDJL receiver in all modes
    await this._startPDJLRx();
    if(!this.isLocalMode){
      if(this._shouldDelayWinAutoPdjl()){
        console.log('[PDJL] Windows auto mode: delaying announce until remote PDJL device is detected');
      }else{
        this._startPDJLAnnounce();
      }
    }
    this._startVirtualDbServer();

    const nid = TC.NID[1].toString(16)+TC.NID[0].toString(16);
    console.log(`[TCNet] mode=${this.isLocalMode?'LOCAL(127.0.0.1)':'NETWORK'} bc=${this.broadcastAddr} localIP=${this.localAddr||'none'}`);
    console.log(`[TCNet] NodeID=0x${nid}, NodeType=0x${TC.NTYPE.toString(16)}, lPort=${this.listenerPort}, name=${TC.NNAME}`);
    console.log('[TCNet] Sending: OptIn(1s) + Status(170ms) + TIME(33ms) + DATA(170ms)');
    console.log(`[TCNet] Triple-send: broadcast + localIP(${this.localAddr}) + 127.0.0.1`);
    return this;
  }

  setTCNetUnicast(unicast, allIfaces){
    this.tcnetUnicast   = !!unicast;
    this.tcnetAllIfaces = !!allIfaces;
    console.log(`[TCNet] unicast=${this.tcnetUnicast} allIfaces=${this.tcnetAllIfaces}`);
  }

  stop(){
    if(!this.running && !this.txSocket) return; // already stopped
    // Send OptOut BEFORE setting running=false (otherwise _send() is a no-op)
    // OptOut = header(24B) + body(4B): nodeCount(u16LE) + listenerPort(u16LE)
    try{
      const b=Buffer.alloc(TC.H+4);
      buildHdr(TC.OPTOUT).copy(b,0);
      b.writeUInt16LE(2, TC.H);                    // nodeCount
      b.writeUInt16LE(this.listenerPort||0, TC.H+2); // listenerPort
      // Send via normal _send (covers broadcastAddr + 255.255.255.255 + localAddr + 127.0.0.1)
      for(let i=0;i<5;i++) this._send(b,TC.P_BC);
      // Also send to ALL network interfaces' broadcast addresses (covers WiFi, LAN, etc.)
      const allIfaces = getAllInterfaces().filter(i=>!i.internal&&i.broadcast);
      for(const iface of allIfaces){
        for(let i=0;i<3;i++){
          try{this.txSocket.send(b,0,b.length,TC.P_BC,iface.broadcast);}catch(_){}
          // Also hit the DATA port since Arena may track nodes via P_DATA listener
          try{this.txSocket.send(b,0,b.length,TC.P_DATA,iface.broadcast);}catch(_){}
        }
      }
      // Also send directly to each known Arena's listener port (unicast)
      for(const[,n] of Object.entries(this.nodes||{})){
        if(n.lPort&&n.ip){
          for(let i=0;i<2;i++){
            try{this.txSocket.send(b,0,b.length,n.lPort,n.ip);}catch(_){}
            try{this.txSocket.send(b,0,b.length,TC.P_BC,n.ip);}catch(_){}
            try{this.txSocket.send(b,0,b.length,TC.P_DATA,n.ip);}catch(_){}
          }
        }
      }
      // Also emit via dataSocket (bound to P_DATA 60002) — Arena listens here for data msgs
      if(this._dataSocket){
        try{
          for(let i=0;i<3;i++){
            this._dataSocket.send(b,0,b.length,TC.P_BC,this.broadcastAddr||'255.255.255.255');
            this._dataSocket.send(b,0,b.length,TC.P_DATA,this.broadcastAddr||'255.255.255.255');
          }
        }catch(_){}
      }
      console.log(`[BridgeCore] sent OptOut on ${allIfaces.length} ifaces + ${Object.keys(this.nodes||{}).length} nodes`);
    }catch(e){console.warn('[BridgeCore] OptOut error:',e.message);}
    this.running = false;
    // clear all intervals and timeouts
    this._timers.forEach(t=>{clearInterval(t);clearTimeout(t);}); this._timers=[];
    // 이름있는 PDJL 타이머는 _timers 와 분리 관리 (rebindPDJL 마다 개별 clear). stop() 에서도 명시 정리.
    for(const _k of ['_djmRetryTimer','_pdjlAnnTimer','_djmSubTimer','_bridgeNotifyTimer','_djmWatchTimer']){
      if(this[_k]){ try{clearInterval(this[_k]);}catch(_){} try{clearTimeout(this[_k]);}catch(_){} this[_k]=null; }
    }
    // Delay socket close by 100ms to let OptOut UDP packets flush from OS buffer
    const closeSockets=()=>{
      const sockets = [this.txSocket,this.rxSocket,this._loRxSocket,this._ipRxSocket,this.lPortSocket,this._dataSocket];
      // _pdjlAnnSock 더블 close 가드 — 클리어 전에 snapshot 후 비교 (이전엔 비운 array 에 includes → 항상 false → 더블 close).
      const _pdjlSnap = this._pdjlSockets ? [...this._pdjlSockets] : null;
      if(this._pdjlSockets) this._pdjlSockets.forEach(s=>sockets.push(s));
      else if(this.pdjlSocket) sockets.push(this.pdjlSocket);
      sockets.forEach(s=>{try{s?.close();}catch(_){}});
      this.txSocket=null; this.rxSocket=null; this._loRxSocket=null;
      this._ipRxSocket=null; this.lPortSocket=null; this._dataSocket=null; this.pdjlSocket=null;
      try{this._ownPorts?.clear();}catch(_){}
      this._pdjlSockets=[];
      // _pdjlAnnSock 가 snapshot 안에 없을 때만 close (snap 안에 있으면 이미 위 forEach 에서 close 됨).
      if(this._pdjlAnnSock && !(_pdjlSnap && _pdjlSnap.includes(this._pdjlAnnSock))){
        try{this._pdjlAnnSock.close();}catch(_){}
      }
      this._pdjlAnnSock=null;
      this._pdjlAnnTxSock=null;
      try{this._dbKaSock?.close();}catch(_){}
      this._dbKaSock=null;
      try{this._djmSubSock?.close();}catch(_){}
      this._djmSubSock=null;
      console.log('[BridgeCore] sockets closed');
    };
    // 250ms gives OS UDP buffer ample time to flush all OptOut bursts before socket close
    setTimeout(closeSockets, 250);
    // close virtual dbserver
    try{this._dbSrv?.close();}catch(_){}
    try{this._dbSrvProto?.close();}catch(_){}
    this._dbSrv=null;this._dbSrvProto=null;
    // close dbserver TCP connections
    for(const [k,s] of Object.entries(this._dbConns)){
      try{s.removeAllListeners();s.destroy();}catch(_){}
    }
    this._dbConns={};
    this._dbCleanupSessions();
    // stop DJM capture if active
    if(this._djmCapture) this.stopDJMCapture();
    // remove all callbacks to prevent post-stop activity
    this.onNodeDiscovered=null; this.onCDJStatus=null; this.onDJMStatus=null;
    this.onDJMMeter=null; this.onDeviceList=null; this.onWaveformPreview=null; this.onWaveformDetail=null; this.onCuePoints=null; this.onBeatGrid=null; this.onSongStructure=null;
    this.onAlbumArt=null; this.onTrackMetadata=null;
    console.log('[BridgeCore] stop: all sockets and connections closed');
  }

  // ── Raw Packet Capture (ALL PDJL traffic for protocol analysis) ──
  startDJMCapture(filePath){
    this._djmCaptureStream=fs.createWriteStream(filePath,{flags:'a'});
    this._djmCapture=true;
    // Write header with known device info
    const devInfo=JSON.stringify(this.devices);
    this._djmCaptureStream.write(`# PDJL Raw Capture started ${new Date().toISOString()} devices=${devInfo}\n`);
    console.log(`[CAPTURE] ALL PDJL packet capture started → ${filePath}`);
    return filePath;
  }
  stopDJMCapture(){
    this._djmCapture=false;
    if(this._djmCaptureStream){this._djmCaptureStream.end();this._djmCaptureStream=null;}
    console.log('[CAPTURE] packet capture stopped');
  }

  // ── Live rebind: TCNet interface ──
  async rebindTCNet(newAddr){
    if(!this.running) return;
    const prev = this.tcnetBindAddr;
    this.tcnetBindAddr = newAddr||null;
    this.isLocalMode = (newAddr==='127.0.0.1');
    this.broadcastAddr = this._resolveBroadcast();
    console.log(`[TCNet] rebind ${prev||'auto'} → ${newAddr||'auto'}  bc=${this.broadcastAddr}`);

    // 1) Close TX socket + rebind
    try{ this.txSocket?.close(); }catch(_){}
    this.txSocket = dgram.createSocket({type:'udp4', reuseAddr:true});
    this.txSocket.on('error',()=>{});
    await new Promise((res)=>{
      let attempts=0;
      const tryBind = port => {
        if(++attempts>3){ this.txSocket.bind(0,'127.0.0.1',()=>res()); return; }
        this.txSocket.once('error',()=>{ this.txSocket.removeAllListeners('error'); this.txSocket.on('error',()=>{}); tryBind(0); });
        this.txSocket.bind(port, this.isLocalMode?'127.0.0.1':(this.tcnetBindAddr||undefined), ()=>{
          this.txSocket.removeAllListeners('error'); this.txSocket.on('error',()=>{});
          if(!this.isLocalMode) try{this.txSocket.setBroadcast(true);}catch(_){}
          res();
        });
      };
      tryBind(0);
    });
    this.txSocket.on('message',(msg,rinfo)=>this._handleTCNetMsg(msg, rinfo, 'tx-RX'));

    // 2) Close listener port + rebind
    try{ this.lPortSocket?.close(); }catch(_){}
    this.lPortSocket = null;
    await this._startListenerPortRx();

    // 3) Close RX sockets + rebind
    try{ this.rxSocket?.close(); }catch(_){}
    try{ this._loRxSocket?.close(); }catch(_){}
    try{ this._ipRxSocket?.close(); }catch(_){}
    this.rxSocket=null; this._loRxSocket=null; this._ipRxSocket=null;
    this._startTCNetRx();

    console.log(`[TCNet] rebind complete — lPort=${this.listenerPort}`);
  }

  // 원격 IP 와 같은 서브넷에 속한 로컬 인터페이스를 찾음.
  // PDJL 장비(CDJ/DJM) 주소를 받아 서브넷 매칭으로 올바른 인터페이스 식별.
  _findLocalIfaceForRemote(remoteIp){
    if(!remoteIp) return null;
    const parts = remoteIp.split('.').map(Number);
    if(parts.length !== 4 || parts.some(n=>!(n>=0&&n<=255))) return null;
    for(const iface of getAllInterfaces()){
      if(iface.internal || !iface.netmask || !iface.address) continue;
      if(iface.address==='127.0.0.1') continue;
      const iIP = iface.address.split('.').map(Number);
      const mask = iface.netmask.split('.').map(Number);
      if(iIP.length!==4 || mask.length!==4) continue;
      let match = true;
      for(let i=0;i<4;i++){
        if((iIP[i] & mask[i]) !== (parts[i] & mask[i])){ match = false; break; }
      }
      if(match) return iface;
    }
    return null;
  }

  _isLinkLocalIp(ip){
    return typeof ip==='string' && ip.startsWith('169.254.');
  }

  _pickAutoPdjlIface(){
    const ifaces = getAllInterfaces().filter(iface=>!iface.internal && iface.address && iface.address!=='127.0.0.1');
    if(!ifaces.length) return null;
    if(process.platform==='win32'){
      const linkLocal = ifaces.find(iface=>this._isLinkLocalIp(iface.address));
      if(linkLocal) return linkLocal;
    }
    if(this.localAddr){
      const localMatch = ifaces.find(iface=>iface.address===this.localAddr);
      if(localMatch) return localMatch;
    }
    return ifaces[0] || null;
  }

  _shouldDelayWinAutoPdjl(){
    return process.platform==='win32'
      && (!this.pdjlBindAddr || this.pdjlBindAddr==='auto' || this.pdjlBindAddr==='0.0.0.0');
  }

  // 원격 장비(CDJ/DJM) 최초 발견 시 해당 서브넷과 매칭되는 로컬 인터페이스로 자동 전환.
  // 사용자가 수동으로 인터페이스를 선택한 경우 무시. 한 번 매칭되면 _autoPdjlLocked 로 중복 전환 방지.
  async handleInterfacesChanged(ifaces){
    if(!this.running) return;
    console.log(`[NET] interfaces changed (${(ifaces||[]).length} ifaces) — refreshing PDJL`);
    if(!this.pdjlBindAddr || this.pdjlBindAddr==='auto' || this.pdjlBindAddr==='0.0.0.0'){
      if(this._shouldDelayWinAutoPdjl()) return;
      this._startPDJLAnnounce();
    }
  }

  _autoSelectPdjlForRemote(remoteIp){
    if(!this.running || this.isLocalMode) return;
    if(this.pdjlBindAddr && this.pdjlBindAddr!=='auto' && this.pdjlBindAddr!=='0.0.0.0') return;
    if(this._autoPdjlLocked) return;
    const iface = this._findLocalIfaceForRemote(remoteIp);
    if(!iface) return;
    if(this._currentPdjlIP === iface.address){
      this._autoPdjlLocked = true;
      console.log(`[PDJL] auto: iface ${iface.address} already matches remote ${remoteIp} — locked`);
      return;
    }
    console.log(`[PDJL] auto-detect: remote ${remoteIp} matches iface ${iface.name}(${iface.address}) — switching from ${this._currentPdjlIP||'none'}`);
    this._autoPdjlLocked = true;
    // 현재 keepalive/join 사이클 흔들지 않도록 약간 지연 후 재바인드
    setTimeout(()=>{
      if(!this.running) return;
      this.rebindPDJL(iface.address).catch(e=>console.warn('[PDJL] auto rebind failed:',e.message));
    }, 100);
  }

  // ── Live rebind: Pro DJ Link interface ──
  async rebindPDJL(newAddr){
    if(!this.running) return;
    const prev = this.pdjlBindAddr;
    this.pdjlBindAddr = newAddr||null;
    this._dbCleanupSessions();
    // 명시적 auto/empty 로 되돌아가면 자동 선택 잠금 해제 → 재-자동감지 가능
    if(!newAddr || newAddr==='auto' || newAddr==='0.0.0.0'){
      this._autoPdjlLocked = false;
    }
    console.log(`[PDJL] rebind ${prev||'auto'} → ${newAddr||'auto'}`);
    // Invalidate delayed join/subscribe callbacks from the previous PDJL session.
    this._pdjlAnnounceSession = (this._pdjlAnnounceSession||0) + 1;
    this._joinCompleted = false;
    for(const key of ['_djmRetryTimer','_djmSubTimer','_djmWatchTimer','_bridgeNotifyTimer']){
      if(this[key]){ try{clearInterval(this[key]);}catch(_){} this[key]=null; }
    }
    this._joinInProgress=false;
    this._djmJoinPending=false;
    if(this._djmSubSock){ try{this._djmSubSock.close();}catch(_){} this._djmSubSock=null; }
    this._djmSubSockReady=false;

    // Close existing PDJL sockets
    if(this._pdjlAnnSock && !this._pdjlSockets?.includes(this._pdjlAnnSock)){
      try{this._pdjlAnnSock.close();}catch(_){}
    }
    this._pdjlAnnSock=null;
    this._pdjlAnnTxSock=null;
    if(this._pdjlSockets){ this._pdjlSockets.forEach(s=>{try{s.close();}catch(_){}}); }
    else if(this.pdjlSocket){ try{this.pdjlSocket.close();}catch(_){} }
    this._pdjlSockets=[]; this.pdjlSocket=null; this.pdjlPort=null;
    // Clear PDJL announce timer
    if(this._pdjlAnnTimer){ clearInterval(this._pdjlAnnTimer); this._pdjlAnnTimer=null; }

    await this._startPDJLRx();
    if(!this.isLocalMode){
      if(this._shouldDelayWinAutoPdjl()){
        console.log('[PDJL] Windows auto mode: waiting for remote PDJL after rebind reset');
      }else{
        this._startPDJLAnnounce();
      }
    }
    console.log(`[PDJL] rebind complete — port=${this.pdjlPort}`);
  }

  // ── Live change: TCNet mode ──
  setTCNetMode(mode){
    if(!this.running) return;
    const prev = this.tcnetMode;
    this.tcnetMode = mode||'auto';
    if(mode==='client') TC.NTYPE = 0x04;
    else TC.NTYPE = 0x02;
    console.log(`[TCNet] mode ${prev} → ${mode} NodeType=0x${TC.NTYPE.toString(16)}`);
  }

  /**
   * Send to broadcast + own IP unicast + 127.0.0.1
   * (covers Arena on same machine regardless of which interface it binds to)
   */
  _send(buf, port){
    if(!this.running||!this.txSocket) return;
    // ── Unicast mode: only send to discovered Arena nodes ──
    if(this.tcnetUnicast && !this.isLocalMode){
      const sent=new Set();
      for(const node of Object.values(this.nodes)){
        if(Date.now()-node.lastSeen > 15000 || sent.has(node.ip)) continue;
        sent.add(node.ip);
        try{ this.txSocket.send(buf, 0, buf.length, port, node.ip); }catch(_){}
      }
      // allIfaces: also send unicast to each node IP from every NIC
      if(this.tcnetAllIfaces){
        for(const iface of getAllInterfaces()){
          if(iface.internal) continue;
          for(const ip of sent){
            try{ this.txSocket.send(buf, 0, buf.length, port, ip); }catch(_){}
          }
        }
      }
      try{ this.txSocket.send(buf, 0, buf.length, port, '127.0.0.1'); }catch(_){}
      return;
    }
    // ── Broadcast mode (default) ──
    try{ this.txSocket.send(buf, 0, buf.length, port, this.broadcastAddr); }catch(_){}
    if(!this.isLocalMode){
      if(!this.tcnetBindAddr || this.tcnetBindAddr==='auto' || this.tcnetBindAddr==='0.0.0.0'){
        const sent=new Set([this.broadcastAddr]);
        for(const iface of getAllInterfaces()){
          if(!iface.internal && iface.broadcast && !sent.has(iface.broadcast)){
            sent.add(iface.broadcast);
            try{ this.txSocket.send(buf, 0, buf.length, port, iface.broadcast); }catch(_){}
          }
        }
      } else if(this.broadcastAddr!=='255.255.255.255'){
        try{ this.txSocket.send(buf, 0, buf.length, port, '255.255.255.255'); }catch(_){}
      }
      // dataSocket (bound 0.0.0.0)로 나머지 인터페이스 브로드캐스트 — DJM이 link-local에서도 TCNet 수신하도록
      if(this._dataSocket){
        const mainBC=this.broadcastAddr;
        for(const iface of getAllInterfaces()){
          if(!iface.internal && iface.broadcast && iface.broadcast!==mainBC && iface.broadcast!=='127.255.255.255'){
            try{ this._dataSocket.send(buf, 0, buf.length, port, iface.broadcast); }catch(_){}
          }
        }
      }
      if(this.localAddr){
        try{ this.txSocket.send(buf, 0, buf.length, port, this.localAddr); }catch(_){}
      }
      try{ this.txSocket.send(buf, 0, buf.length, port, '127.0.0.1'); }catch(_){}
    }
  }
  _uc(buf, port, ip){
    if(!this.running||!ip||!port) return;
    // Use dedicated _dataSocket for DATA responses
    const sock = this._dataSocket || this.txSocket;
    if(!sock) return;
    try{ sock.send(buf, 0, buf.length, port, ip); }catch(_){}
  }

  /** Unicast to all known Arena nodes at the given port. */
  _sendToArenas(buf, port){
    if(!this.running||!this.txSocket) return;
    for(const node of Object.values(this.nodes)){
      if(Date.now()-node.lastSeen > 15000) continue;
      try{ this.txSocket.send(buf, 0, buf.length, port, node.ip); }catch(_){}
    }
  }

  /** Send to each Arena's listener port (lPort from OptIn body[2-3]). */
  _sendToArenasLPort(buf){
    if(!this.running||!this.txSocket) return;
    for(const node of Object.values(this.nodes)){
      if(Date.now()-node.lastSeen > 15000) continue;
      if(!node.lPort) continue;
      try{ this.txSocket.send(buf, 0, buf.length, node.lPort, node.ip); }catch(_){}
      if(!this.isLocalMode){try{ this.txSocket.send(buf, 0, buf.length, node.lPort, '127.0.0.1'); }catch(_){}}
    }
  }

  /** Send DATA packets via dedicated _dataSocket to Arena lPort. */
  _sendDataToArenas(buf){
    const sock = this._dataSocket || this.txSocket;
    if(!this.running || !sock) return;
    for(const node of Object.values(this.nodes)){
      if(Date.now()-node.lastSeen > 15000) continue;
      if(!node.lPort) continue;
      try{ sock.send(buf, 0, buf.length, node.lPort, node.ip); }catch(_){}
      if(!this.isLocalMode){try{ sock.send(buf, 0, buf.length, node.lPort, '127.0.0.1'); }catch(_){}}
    }
    // Also broadcast on DATA port as fallback
    try{ sock.send(buf, 0, buf.length, TC.P_DATA, this.broadcastAddr); }catch(_){}
  }

  /** Send LowResArtwork (0xCC) packets for a layer. Splits JPEG into MTU-safe chunks. */
  _sendArtwork(layerIdx, jpegBuf){
    if(!jpegBuf || !this.running) return;
    const packets = mkLowResArtwork(layerIdx, jpegBuf);
    for(const pkt of packets){
      this._sendDataToArenas(pkt);
    }
  }

  /** Re-send all stored artwork to all connected nodes.
   *  Called when a new node joins (e.g., Arena reconnects) to ensure artwork is up-to-date. */
  _resendAllArtwork(){
    if(!this.running) return;
    let count = 0;
    for(let i = 0; i < 8; i++){
      const buf = this._virtualArt[i];
      if(buf && buf.length > 100){  // skip BLANK_JPEG
        // Stagger sends to avoid UDP packet loss (50ms between layers)
        setTimeout(()=>this._sendArtwork(i + 1, buf), count * 50);
        count++;
      }
    }
    if(count > 0) console.log(`[TCNet-ART] resending ${count} artwork(s) to new node`);
  }

  /**
   * DATA cycle (24 packets): Phase 1 (0-7) MetricsData per layer,
   * Phase 2 (8-15) MetaData per layer, Phase 3 (16-23) MetricsData again.
   * Empty layers are skipped; MetaData is cached by trackId+names.
   */
  _sendDataCycle(){
    if(!this.running) return;

    const idx = this._dataLayerIdx;
    let pkt;

    if(idx < 8){
      const layerIdx = idx + 1, li = idx;
      const layerData = this.layers[li] || null;
      if(!layerData){this._dataLayerIdx=(idx+1)%24;return;}
      const faderVal = this.faders ? (this.faders[li] || 0) : 0;
      pkt = mkDataMetrics(layerIdx, layerData, faderVal);
    } else if(idx < 16){
      const layerIdx = (idx - 8) + 1, li = layerIdx - 1;
      const layerData = this.layers[li] || null;
      if(!layerData){this._dataLayerIdx=(idx+1)%24;return;}
      // cache MetaData packet by track identity; rebuild only when track changes
      const metaKey = `${layerData.trackId||0}_${layerData.trackName||''}_${layerData.artistName||''}`;
      if(this._metaCache && this._metaCache[li] && this._metaCache[li].key === metaKey){
        pkt = this._metaCache[li].pkt;
      } else {
        pkt = mkDataMeta(layerIdx, layerData);
        if(!this._metaCache) this._metaCache = new Array(8).fill(null);
        this._metaCache[li] = {key:metaKey, pkt};
      }
    } else {
      const layerIdx = (idx - 16) + 1, li = layerIdx - 1;
      const layerData = this.layers[li] || null;
      if(!layerData){this._dataLayerIdx=(idx+1)%24;return;}
      const faderVal = this.faders ? (this.faders[li] || 0) : 0;
      pkt = mkDataMetrics(layerIdx, layerData, faderVal);
    }

    // Send via dedicated _dataSocket
    this._sendDataToArenas(pkt);

    this._dataLayerIdx = (idx + 1) % 24;
    this.packetCount++;
  }

  _sendOptIn(){
    const n = Math.max(1, Object.keys(this.nodes).length + 1);
    const pkt = mkOptIn(this.listenerPort, Math.floor((Date.now()-this.startTime)/1000), n);
    this._send(pkt, TC.P_BC);
    this._sendToArenas(pkt, TC.P_BC);
    this._sendToArenasLPort(pkt);
  }

  _sendStatus(){
    const pkt = mkStatus(this.listenerPort, this.devices, this.layers, this.faders, this.hwMode);
    this._send(pkt, TC.P_BC);
    this._sendToArenas(pkt, TC.P_BC);
    this._sendToArenasLPort(pkt);
  }

  // ── TCNet 메시지 핸들러 (공통) ────────────────
  _handleTCNetMsg(msg, rinfo, label){
    if(msg.length<TC.H) return;
    if(msg[4]!==0x54||msg[5]!==0x43||msg[6]!==0x4E) return;
    // 1차 방어: Node ID 일치 → 자기 자신이 보낸 패킷 (NNAME 변경에도 견고)
    if(msg[0]===TC.NID[0] && msg[1]===TC.NID[1]) return;
    const type = msg[7];
    const name = msg.slice(8,16).toString('ascii').replace(/\0/g,'').trim();
    // 2차 방어: 이름 prefix (역호환 + 다른 Bridge 인스턴스 방지)
    if(name.toUpperCase().startsWith('BRIDGE')) return;
    // 3차 방어: 송신 포트가 우리 소켓이면 loop
    if(this._ownPorts && this._ownPorts.has(rinfo.port) &&
       (rinfo.address===this.localAddr || rinfo.address==='127.0.0.1')) return;

    if(type===TC.OPTIN){
      const body = msg.slice(TC.H);
      const lPort = body.length>=4 ? body.readUInt16LE(2) : 0;
      const vendor = body.length>=40 ? body.slice(8,24).toString('ascii').replace(/\0/g,'').trim() : '';
      const device = body.length>=40 ? body.slice(24,40).toString('ascii').replace(/\0/g,'').trim() : '';
      const key = name+'@'+rinfo.address;
      const isNew = !this.nodes[key];
      this.nodes[key] = {name,vendor,device,type:msg[17],ip:rinfo.address,port:rinfo.port,lPort,lastSeen:Date.now()};
      if(isNew) console.log(`[${label}] OptIn: ${name}@${rinfo.address} lPort=${lPort} vendor=${vendor}`);
      this.onNodeDiscovered?.(this.nodes[key]);
    }
    // Auto-register non-Bridge nodes that send any TCNet packet (Arena may skip OptIn)
    if(type!==TC.OPTIN && !name.toUpperCase().startsWith('BRIDGE')){
      const key = name+'@'+rinfo.address;
      if(!this.nodes[key]){
        this.nodes[key] = {name,vendor:'',device:'',type:msg[17],ip:rinfo.address,port:rinfo.port,lPort:rinfo.port,lastSeen:Date.now()};
        console.log(`[${label}] auto-register ${name}@${rinfo.address} lPort=${rinfo.port}`);
        this.onNodeDiscovered?.(this.nodes[key]);
      } else {
        this.nodes[key].lastSeen = Date.now();
      }
    }
    if(type===TC.APP){
      if(!this._lPortDbg)this._lPortDbg={};
      if(!this._lPortDbg['txapp_'+rinfo.address]){this._lPortDbg['txapp_'+rinfo.address]=true;console.log(`[${label}] APP from ${name} → ${rinfo.address}:${rinfo.port}`);}
      const body = msg.slice(TC.H);
      const lPort = body.length>=22 ? body.readUInt16LE(20) : rinfo.port;
      const key = name+'@'+rinfo.address;
      if(this.nodes[key]) this.nodes[key].lPort = lPort || rinfo.port;
      try{ this.txSocket?.send(mkAppResp(this.listenerPort),0,62,rinfo.port,rinfo.address); }catch(_){}
    }
    // 0x14 MetadataRequest — Arena asks for track metadata on a layer
    // body: [dataType, layer(1-based)]; reply with requested Data payload.
    if(type===0x14){
      const body = msg.slice(TC.H);
      const reqType = body.length>=1 ? body[0] : 0;
      const layerReq = body.length>=2 ? body[1] : 0;  // 1-based
      const li = layerReq - 1;  // convert to 0-indexed
      const layerData = (li >= 0 && li < this.layers.length) ? this.layers[li] : null;
      // MetaReq logs suppressed (too frequent)
      const faderVal = this.faders ? (this.faders[li] || 0) : 0;
      if(reqType===TC.DT_META){
        this._uc(mkDataMeta(layerReq, layerData), rinfo.port, rinfo.address);
      }else if(reqType===TC.DT_METRICS){
        this._uc(mkDataMetrics(layerReq, layerData, faderVal), rinfo.port, rinfo.address);
      }else{
        this._uc(mkDataMeta(layerReq, layerData), rinfo.port, rinfo.address);
        this._uc(mkDataMetrics(layerReq, layerData, faderVal), rinfo.port, rinfo.address);
      }
      // MetaResp log suppressed (too frequent, causes FPS drop)
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
          chAudio.push(off+1<body.length?body[off+1]:0);     // Audio Level (VU, 0-255)
          chFader.push(off+2<body.length?body[off+2]:0);     // Fader Level (position)
          chCueA.push(off+11<body.length?body[off+11]:0);    // CUE A (0=off, 1=on)
          chCueB.push(off+12<body.length?body[off+12]:0);    // CUE B (0=off, 1=on)
          chXfAssign.push(off+13<body.length?body[off+13]:0);// Crossfader Assign (0=THRU,1=A,2=B)
        }
        // Throttled log: once every 2s
        const now=Date.now();
        if(!this._tcMixerLogAt||now-this._tcMixerLogAt>2000){
          this._tcMixerLogAt=now;
          try{console.log(`[TCNet] MixerData from=${rinfo.address} masterAudio=${masterAudio} chAudio=[${chAudio}] cueA=[${chCueA}] xfAssign=[${chXfAssign}]`);}catch(_){}
        }
        this.onTCMixerVU?.({masterAudio,masterFader,xfader,chAudio,chFader,chCueA,chCueB,chXfAssign,from:rinfo.address});
      }
    }
  }

  // ── TCNet RX ────────────────────────────────
  /**
   * Three RX sockets to handle all receive paths on macOS:
   * 1) 0.0.0.0 — external broadcast + unicast
   * 2) 127.0.0.1 — loopback
   * 3) local IP — unicast to own IP (macOS WiFi broadcast loopback workaround)
   */
  _startTCNetRx(){
    // 1) main RX socket (0.0.0.0)
    const sock = dgram.createSocket({type:'udp4', reuseAddr:true});
    this.rxSocket = sock;
    sock.on('message',(msg,rinfo)=>this._handleTCNetMsg(msg, rinfo, 'TCNet'));
    sock.on('error',(e)=>{ console.warn(`[TCNet] RX error: ${e.message}`); });

    const bindAddr = this.isLocalMode ? '127.0.0.1' : (this.tcnetBindAddr||undefined);
    const bindRx = addr => {
      sock.removeAllListeners('error');
      sock.on('error',(e)=>{
        if(e.code==='EADDRNOTAVAIL' && addr!=='0.0.0.0'){
          console.warn(`[TCNet] RX bind ${addr} unavailable, fallback to 0.0.0.0`);
          bindRx('0.0.0.0');
          return;
        }
        console.warn(`[TCNet] RX error: ${e.message}`);
      });
      sock.bind(TC.P_BC, addr==='0.0.0.0'?undefined:addr, ()=>{
        console.log(`[TCNet] RX bound to ${addr||'0.0.0.0'}:${TC.P_BC}`);
        if(!this.isLocalMode){ try{ sock.addMembership('224.0.0.1'); }catch(_){} }
      });
    };
    bindRx(bindAddr);

    // 2) loopback RX socket (network mode only)
    if(!this.isLocalMode){
      const loSock = dgram.createSocket({type:'udp4', reuseAddr:true});
      this._loRxSocket = loSock;
      loSock.on('message',(msg,rinfo)=>this._handleTCNetMsg(msg, rinfo, 'lo-RX'));
      loSock.on('error',(e)=>{ console.warn(`[TCNet] loopback RX error: ${e.message}`); });
      loSock.bind(TC.P_BC, '127.0.0.1', ()=>{
        console.log(`[TCNet] loopback RX on 127.0.0.1:${TC.P_BC}`);
      });

      // 3) own IP RX socket (unicast from self)
      if(this.localAddr){
        const ipSock = dgram.createSocket({type:'udp4', reuseAddr:true});
        this._ipRxSocket = ipSock;
        ipSock.on('message',(msg,rinfo)=>this._handleTCNetMsg(msg, rinfo, 'ip-RX'));
        ipSock.on('error',(e)=>{ console.warn(`[TCNet] IP RX error: ${e.message}`); });
        ipSock.bind(TC.P_BC, this.localAddr, ()=>{
          console.log(`[TCNet] IP RX on ${this.localAddr}:${TC.P_BC}`);
        });
      }
    }
  }

  /**
   * Listener port RX socket — Arena sends OptIn/APP here.
   * Binds to port 0 so the OS assigns a random port (stored in this.listenerPort).
   */
  async _startListenerPortRx(){
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({type:'udp4', reuseAddr:true});
      this.lPortSocket = sock;
      sock.on('message',(msg,rinfo)=>{
        if(msg.length<TC.H) return;
        if(msg[4]!==0x54||msg[5]!==0x43||msg[6]!==0x4E) return;
        // NID + ownPorts + name 3중 방어 (TCNet 패킷 loop 차단)
        if(msg[0]===TC.NID[0] && msg[1]===TC.NID[1]) return;
        const type = msg[7];
        const name = msg.slice(8,16).toString('ascii').replace(/\0/g,'').trim();
        if(name.toUpperCase().startsWith('BRIDGE')) return;
        if(this._ownPorts && this._ownPorts.has(rinfo.port) &&
           (rinfo.address===this.localAddr || rinfo.address==='127.0.0.1')) return;

        // Only log first occurrence of each type from each source
        const lk=name+type;
        if(!this._lPortDbg)this._lPortDbg={};
        if(!this._lPortDbg[lk]){this._lPortDbg[lk]=true;try{console.log(`[TCNet] lPort ${name} type=0x${type.toString(16)} from ${rinfo.address}:${rinfo.port}`);}catch(_){}}

        if(type===TC.OPTIN){
          const body = msg.slice(TC.H);
          const lPort = body.length>=4 ? body.readUInt16LE(2) : 0;
          const vendor = body.length>=40 ? body.slice(8,24).toString('ascii').replace(/\0/g,'').trim() : '';
          const device = body.length>=40 ? body.slice(24,40).toString('ascii').replace(/\0/g,'').trim() : '';
          const key = name+'@'+rinfo.address;
          const isNew = !this.nodes[key];
          this.nodes[key] = {name,vendor,device,type:msg[17],ip:rinfo.address,port:rinfo.port,lPort,lastSeen:Date.now()};
          if(isNew){
            console.log(`[TCNet] lPort OptIn: ${name}@${rinfo.address} lPort=${lPort} vendor=${vendor} device=${device}`);
            // Re-send artwork to newly connected node (delayed to allow node registration)
            setTimeout(()=>this._resendAllArtwork(), 500);
          }
          this.onNodeDiscovered?.(this.nodes[key]);
        }
        // Register any Arena-like node even without OptIn (Arena sends APP/0x1e/0x14 but NOT OptIn)
        if(type!==TC.OPTIN && !name.toUpperCase().startsWith('BRIDGE')){
          const key = name+'@'+rinfo.address;
          if(!this.nodes[key]){
            this.nodes[key] = {name,vendor:'',device:'',type:msg[17],ip:rinfo.address,port:rinfo.port,lPort:rinfo.port,lastSeen:Date.now()};
            console.log(`[TCNet] lPort auto-register ${name}@${rinfo.address} lPort=${rinfo.port} (from type=0x${type.toString(16)})`);
            setTimeout(()=>this._resendAllArtwork(), 500);
            this.onNodeDiscovered?.(this.nodes[key]);
          } else {
            this.nodes[key].lastSeen = Date.now();
          }
        }
        if(type===TC.APP){
          const body = msg.slice(TC.H);
          const lPort = body.length>=22 ? body.readUInt16LE(20) : rinfo.port;
          const key = name+'@'+rinfo.address;
          if(this.nodes[key]) this.nodes[key].lPort = lPort || rinfo.port;
          if(!this._lPortDbg['app_'+rinfo.address]){this._lPortDbg['app_'+rinfo.address]=true;console.log(`[TCNet] lPort APP from ${name} → ${rinfo.address}:${rinfo.port} lPort=${lPort}`);}
          try{ this.txSocket?.send(mkAppResp(this.listenerPort),0,62,rinfo.port,rinfo.address); }catch(_){}
        }
        if(type===0x14){
          const body = msg.slice(TC.H);
          const layerReq = body[0]||0;  // 1-based
          const reqType = body[1]||0;
          const li = layerReq - 1;  // 0-indexed
          const layerData = (li >= 0 && li < this.layers.length) ? this.layers[li] : null;
          // MetaReq logs suppressed (too frequent)
          const metaPkt = mkDataMeta(layerReq, layerData);
          this._uc(metaPkt, rinfo.port, rinfo.address);
          const faderVal = this.faders ? (this.faders[li] || 0) : 0;
          const metricsPkt = mkDataMetrics(layerReq, layerData, faderVal);
          this._uc(metricsPkt, rinfo.port, rinfo.address);
          // MetaResp log suppressed (too frequent);
        }
      });
      sock.on('error',(e)=>{
        console.warn(`[TCNet] lPort error: ${e.message}`);
        // Fallback to 127.0.0.1 if bind address unavailable
        if(e.code==='EADDRNOTAVAIL'){
          sock.removeAllListeners('error');
          sock.on('error',(e2)=>{console.warn(`[TCNet] lPort fallback error: ${e2.message}`);reject(e2);});
          sock.bind(0, '127.0.0.1', ()=>{
            this.listenerPort = sock.address().port;
            try{this._ownPorts.add(this.listenerPort);}catch(_){}
            console.log(`[TCNet] listener port ${this.listenerPort} (fallback 127.0.0.1)`);
            resolve();
          });
          return;
        }
        reject(e);
      });

      const bindAddr = this.isLocalMode ? '127.0.0.1' : (this.tcnetBindAddr||undefined);
      // bind to port 0 — OS assigns a dynamic port
      sock.bind(0, bindAddr, ()=>{
        this.listenerPort = sock.address().port;
        try{this._ownPorts.add(this.listenerPort);}catch(_){}
        console.log(`[TCNet] listener port ${this.listenerPort}`);
        resolve();
      });
    });
  }

  // ── Pro DJ Link RX ──────────────────────────
  /**
   * Pro DJ Link RX — listens on both 50001 and 50002:
   *   50002: CDJ status (0x0A), DJM faders (0x39)
   *   50001: DJM On-Air (0x03), CDJ beats (0x0B), DJM metering (0x58)
   */
  async _startPDJLRx(){
    this._pdjlSockets = [];
    // [2026-04-19] 포트별 소켓 맵 추가 — 포트 50000 바인드 실패 시
    // _pdjlSockets[1] 이 엉뚱한 포트 소켓으로 미끄러지는 문제 차단
    this._pdjlSocketByPort = {};
    // macOS: ALL PDJL ports bind to INADDR_ANY (0.0.0.0)
    // to receive both broadcast and unicast packets from CDJs and DJMs.
    // Binding 50002 to specific IP blocks DJM mixer status packets from other interfaces.
    // Standard PDJL ports + extra Pioneer ports (fader data might arrive on unknown port)
    const autoPdjlIface = (process.platform==='win32' && !this._shouldDelayWinAutoPdjl())
      ? this._pickAutoPdjlIface()
      : null;
    const winBindIp = process.platform==='win32'
      ? ((this.pdjlBindAddr && this.pdjlBindAddr!=='auto' && this.pdjlBindAddr!=='0.0.0.0') ? this.pdjlBindAddr : (autoPdjlIface?.address || undefined))
      : undefined;
    for(const port of [50000, 50001, 50002, 50003, 50004]){
      try{
        const sock = dgram.createSocket({type:'udp4', reuseAddr:true});
        const bindAddr = process.platform==='win32' ? winBindIp : undefined;
        await new Promise((res,rej)=>{
          sock.on('error',rej);
          sock.bind(port, bindAddr, ()=>{ try{sock.setBroadcast(true);}catch(_){} res(); });
        });
        sock.on('message',(msg,rinfo)=>this._onPDJL(msg,rinfo));
        sock.on('error',()=>{});
        this._pdjlSockets.push(sock);
        this._pdjlSocketByPort[port] = sock;
        if(!this.pdjlSocket){ this.pdjlSocket = sock; this.pdjlPort = port; }
        console.log(`[PDJL] UDP ${port} active (${bindAddr||'0.0.0.0'})`);
      }catch(e){ console.warn(`[PDJL] port ${port} fail: ${e.message}`); }
    }
    if(this._pdjlSockets.length===0) console.warn('[PDJL] all ports failed');
  }

  // Pro DJ Link keep-alive announcement on 50000
  // CDJs only send status to devices they see on the network
  _startPDJLAnnounce(){
    const annSession = (this._pdjlAnnounceSession = (this._pdjlAnnounceSession||0) + 1);
    const liveSession = () => this.running && this._pdjlAnnounceSession===annSession;
    // 이전 세션의 join state 리셋 — handleInterfacesChanged 등으로 재호출될 때
    // 이전 세션의 _joinInProgress=true 가 남아 새 세션의 _bridgeJoin 을
    // 차단해 Hello/Claim 이 전혀 송신 안 되는 버그 방지.
    this._joinCompleted = false;
    this._joinInProgress = false;
    if(this._pdjlAnnTimer){ try{clearInterval(this._pdjlAnnTimer);}catch(_){} this._pdjlAnnTimer=null; }
    if(this._djmSubTimer){ try{clearTimeout(this._djmSubTimer);}catch(_){} this._djmSubTimer=null; }
    // Determine the "primary" IP to embed in the PDJL keepalive packet.
    // CDJs use this IP to identify us on the network.
    // Priority: 1) pdjlBindAddr (user selected), 2) localAddr, 3) any available (including link-local)
    let pdjlIP=null, pdjlMAC='00:00:00:00:00:00';

    // 1) User explicitly selected PDJL interface — use it directly (even 169.254.x.x)
    if(this.pdjlBindAddr && this.pdjlBindAddr!=='auto' && this.pdjlBindAddr!=='0.0.0.0'){
      pdjlIP = this.pdjlBindAddr;
      for(const iface of getAllInterfaces()){
        if(iface.address===pdjlIP){ pdjlMAC=iface.mac||pdjlMAC; break; }
      }
    }
    // 2) Automatic interface selection.
    // Windows: prefer link-local PDJL adapters first to avoid starting on the
    // wrong 192.168/10.x NIC and racing the DJM registration before rebind.
    if(!pdjlIP){
      const autoIface = this._pickAutoPdjlIface();
      if(autoIface){
        pdjlIP = autoIface.address;
        pdjlMAC = autoIface.mac || pdjlMAC;
      }
    }
    if(!pdjlIP){ console.warn('[PDJL] no interface found for keep-alive'); return; }
    // auto-select 비교용 현재 IP 저장. 장비 발견 시 서브넷 매칭으로 교체 판단.
    this._currentPdjlIP = pdjlIP;

    // Collect ALL non-internal broadcast addresses so every subnet (including Arena's) receives the keepalive
    const allBCs = pdjlBroadcastTargets(pdjlIP);
    console.log(`[PDJL] announcing IP=${pdjlIP} MAC=${pdjlMAC} → ${allBCs.join(',')}:50000`);

    const macBytes=pdjlMAC.split(':').map(h=>parseInt(h,16));
    const ipParts=pdjlIP.split('.').map(Number);

    const spoofPlayer=5;

    // annSock: hello/claim/keepalive 송신용 소켓.
    // macOS: port 50000 RX 소켓(0.0.0.0) 공유 — BSD 커널이 라우팅 테이블로
    //        올바른 NIC 자동 선택하므로 문제 없음.
    // Windows: 0.0.0.0 바인드 소켓에서 브로드캐스트 송신 시 기본 경로 NIC로만
    //          나감. Pioneer LINK 포트가 별도 이더넷(예: 169.254.x, 192.168.x)
    //          이면 패킷이 DJM에 도달 못함. 전용 TX 소켓을 pdjlIP에 바인드해야 함.
    //          (참조: ProDJLinkInput.h:375-416 "PLATFORM-SPECIFIC binding")
    if(process.platform==='win32'){
      this._pdjlAnnSock = this._pdjlSocketByPort?.[50000] || this._pdjlSockets?.[0] || null;
      if(!this._pdjlAnnSock){
        const s=dgram.createSocket({type:'udp4',reuseAddr:true});
        s.on('error',()=>{});
        s.bind(50000, pdjlIP, ()=>{ try{s.setBroadcast(true);}catch(_){} });
        this._pdjlAnnSock = s;
      }
    } else {
      // [2026-04-19] 인덱스 하드코딩 제거 — 포트 50000 바인드 실패 시에도 안전
      // Mac: 0.0.0.0:50000 RX 소켓 그대로 사용 (broadcast RX 유지). TX 시 OS 가
      //      default route 결정 — link-local 통신은 link-local 인터페이스로 자동.
      this._pdjlAnnSock = this._pdjlSocketByPort?.[50000] || this._pdjlSockets?.[0] || null;
      if(!this._pdjlAnnSock){
        const s=dgram.createSocket({type:'udp4',reuseAddr:true});
        s.on('error',()=>{});
        s.bind(0,()=>{ try{s.setBroadcast(true);}catch(_){} });
        this._pdjlAnnSock=s;
      }
    }
    // DJM subscribe socket. Use a fixed source port for 0x57/0x55 traffic.
    if(this._djmSubSock && this._djmSubSock!==this._pdjlSocketByPort?.[50001]){ try{this._djmSubSock.close();}catch(_){} }
    this._djmSubSockReady=false;
    if(process.platform==='win32'){
      this._djmSubSock=this._pdjlSocketByPort?.[50001] || null;
      if(this._djmSubSock){
        console.log(`[PDJL] DJM subscribe socket active ${pdjlIP}:50001`);
      }else{
        console.warn('[PDJL] DJM subscribe socket unavailable on 50001');
      }
    }else{
      this._djmSubSock=dgram.createSocket({type:'udp4',reuseAddr:true});
      this._djmSubSock.on('error',e=>console.warn('[PDJL] DJM sub socket error:',e.message));
      this._djmSubSock.on('message',(msg,rinfo)=>{
        if(!liveSession()) return;
        this._onPDJL(msg, rinfo);
      });
      try{
        this._djmSubSock.bind(50006, pdjlIP, ()=>{
          this._djmSubSockReady=true;
          console.log(`[PDJL] DJM subscribe socket active ${pdjlIP}:50006`);
        });
      }catch(e){
        console.warn('[PDJL] DJM sub socket bind failed:',e.message);
      }
    }

    const sendAnn=()=>{
      if(!liveSession()||!this._pdjlAnnSock) return;
      const pkt=buildPdjlBridgeKeepalivePacket(pdjlIP, pdjlMAC, spoofPlayer);
      for(const bc of allBCs){
        try{this._pdjlAnnSock.send(pkt,0,pkt.length,50000,bc);}catch(_){}
      }
    };
    // Build a claim(0x02) packet embedding the given interface's IP
    const _buildClaim=(seqN)=>{
      return buildPdjlBridgeClaimPacket(pdjlIP, pdjlMAC, seqN, spoofPlayer);
    };

    const _bridgeJoin=()=>{
      if(!liveSession()||!this._pdjlAnnSock) return;
      if(this._joinCompleted) return;
      if(this._joinInProgress){
        return;
      }
      this._joinInProgress = true;
      // Bridge join 시퀀스 (Pioneer pcap 매칭):
      //   Hello(0x0A) × 14 @ 110ms 간격 = 1540ms (pcap 타이밍과 일치)
      //   Claim(0x02) × 22 @ 150ms 간격 = 3300ms
      //   keepalive는 join 완료 후 시작
      //
      // 기존 2/11 카운트는 DJM이 bridge joining 상태로 인식 못 해
      // 0x39 송신 거부하는 것으로 확인 (/tmp/ours.pcapng 분석 결과).
      const HELLO_GAP = 110, CLAIM_GAP = 150, HELLO_N = 14, CLAIM_N = 22;
      const helloEnd = HELLO_GAP*HELLO_N; // 1540ms
      for(let h=0;h<HELLO_N;h++){
        setTimeout(()=>{
          if(!liveSession()||!this._pdjlAnnSock) return;
          const p=buildPdjlBridgeHelloPacket(spoofPlayer);
          for(const bc of allBCs){try{this._pdjlAnnSock.send(p,0,p.length,50000,bc);}catch(_){}}
        }, h*HELLO_GAP);
      }
      for(let n=1;n<=CLAIM_N;n++){
        setTimeout(()=>{
          if(!liveSession()||!this._pdjlAnnSock) return;
          const cp = _buildClaim(n);
          for(const bc of allBCs){
            try{this._pdjlAnnSock.send(cp,0,cp.length,50000,bc);}catch(_){}
          }
          if(n===CLAIM_N){
            setTimeout(()=>{
              if(!liveSession()) return;
              this._joinInProgress=false;
              this._joinCompleted=true;
              console.log('[PDJL] bridge join sequence complete');
              // join 완료 직후 54B keepalive 즉시 시작 (DJM identity 등록용)
              // 0x57 subscribe는 54B 후 3초 대기 필요 — setTimeout(sendDjmSub, 9700) 에서 처리
              try{ sendAnn(); }catch(_){}
            }, 500);
          }
        }, helloEnd + (n-1)*CLAIM_GAP);
      }
    };

    _bridgeJoin();
    // Periodic DJM reconnect: if DJM is known but hasn't sent 0x39 mixer data yet
    const _djmRetryT = setInterval(()=>{
      if(!liveSession()) return;
      if(this.devices['djm'] && !this._hasRealFaders && !this._joinInProgress){
        const hasAnyDjmStream = !!this._lastDjmOnair03 || !!this._lastDjmMeter58;
        if(hasAnyDjmStream){
          console.log('[PDJL] DJM stream active but no 0x39 yet — keeping subscribe active');
        }
      }
    }, 20000);
    this._djmRetryTimer=_djmRetryT;
    // _timers.push 제거 — 이름있는 timer 는 rebindPDJL 마다 개별 clear 되므로 _timers[] 에 누적시키면 stale handle leak.
    console.log(`[PDJL] annSock ready (shared=${!!this._pdjlSockets?.[0]}) ip=${pdjlIP} allBCs=[${allBCs.join(',')}]`);

    // 95B dbserver keepalive — UNICAST to CDJs only (not broadcast!)
    // CDJ-3000이 "PIONEER DJ CORP" / "PRODJLINK BRIDGE" 문자열을 검증하므로 필수
    // CRITICAL: DJM must NOT see this packet (player=5 conflicts with bridge player=0xF9)
    this._dbKaSock = dgram.createSocket({type:'udp4',reuseAddr:true});
    this._dbKaSock.on('error',()=>{});
    this._dbKaSock.bind(0, pdjlIP, ()=>{});
    const _dbKeepaliveSocket = this._dbKaSock;
    const sendDbKeepalive=()=>{
      const pkt=buildDbServerKeepalivePacket(pdjlIP, pdjlMAC, spoofPlayer, process.platform);
      // Unicast to each CDJ only (not DJM!)
      for(const[k,dev] of Object.entries(this.devices)){
        if(dev.type==='CDJ'&&dev.ip){
          try{_dbKeepaliveSocket.send(pkt,0,pkt.length,50000,dev.ip);}catch(_){}
        }
      }
    };

    // keepalive는 bridge join 완료 후에 시작 (병렬 전송 금지 — CDJ 거부 방지)
    // join 총 소요: hello(600ms) + claim(5500ms) + 500ms buffer ≈ 6.6초
    if(this._pdjlAnnTimer) clearInterval(this._pdjlAnnTimer);
    setTimeout(()=>{
      if(!liveSession()) return;
      sendAnn();
      sendDbKeepalive();
      this._pdjlAnnTimer=setInterval(()=>{
        if(!liveSession()) return;
        sendAnn();sendDbKeepalive();
      },1500);
      // _timers.push 제거 — _pdjlAnnTimer 는 rebindPDJL/stop 에서 개별 clear (line 703, 1212).
      console.log('[PDJL] keepalive loop started (post-join)');
    }, 6700);

    // DJM subscribe (0x57) — 반드시 전송해야 DJM이 0x39 fader data를 보냄
    // 전송 대상: DJM IP, 포트 50001 / 주기: 2초 / 첫 전송: keepalive 후 3초 딜레이
    const buildSubPkts=()=>{
      return [buildDjmSubscribePacket(process.platform)];
    };
    const sendBridgeNotifyToAll=()=>{
      if(!liveSession()) return;
      const pkt = buildBridgeNotifyPacket(spoofPlayer);
      const notifySock = this._djmSubSockReady
        ? this._djmSubSock
        : (this._pdjlSocketByPort?.[50002] || this._pdjlAnnSock);
      if(!notifySock) return;
      for(const [, dev] of Object.entries(this.devices||{})){
        if(dev?.type!=='CDJ' || !dev.ip) continue;
        try{
          notifySock.send(pkt,0,pkt.length,50002,dev.ip);
        }catch(_){}
      }
    };
    const sendDjmSub=()=>{
      if(!liveSession()) return;
      const djmIp=this.devices?.['djm']?.ip;
      if(!djmIp){ return; }
      const pkts=buildSubPkts();
      // port 50001 소켓 우선 사용 (DJM이 선호하는 소스 포트)
      const subSocks = process.platform==='win32'
        ? [this._pdjlSocketByPort?.[50001]].filter(Boolean)
        : this._djmSubSockReady
        ? [this._djmSubSock]
        : [
            this._pdjlSocketByPort?.[50001],
            this._pdjlSocketByPort?.[50000],
            this._pdjlSocketByPort?.[50002],
            this._pdjlSockets?.[0],
            this._pdjlAnnSock,
          ].filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).slice(0,1);
      if(!subSocks.length){ console.warn('[PDJL] 0x57: no socket available'); return; }
      const srcs=[];
      const masksSent=[];
      for(const subSock of subSocks){
        for(const pkt of pkts){
          try{
            subSock.send(pkt,0,pkt.length,50001,djmIp);
            const local=(()=>{try{return subSock.address();}catch(_){return null;}})();
            const src=local?`${local.address}:${local.port}`:'unknown';
            if(!srcs.includes(src)) srcs.push(src);
            const mask=`0x${pkt[33].toString(16)}`;
            if(!masksSent.includes(mask)) masksSent.push(mask);
          }catch(e){ console.warn('[PDJL] 0x57 send error:',e.message); }
        }
      }
      if(srcs.length){
        this._djmSubCount = (this._djmSubCount||0)+1;
        if(this._djmSubCount===1||this._djmSubCount%10===0){
          console.log(`[PDJL] 0x57 subscribe #${this._djmSubCount} ${srcs.join(',')} → ${djmIp}:50001 mask=${masksSent.join('/')} hasRealFaders=${this._hasRealFaders}`);
        }
      }
    };
    // 타이밍 설계: join 완료(≈6.6s) → keepalive 시작 → 추가 3s 뒤 첫 subscribe (경합 방지)
    // Pioneer 공식 브리지는 0x57 을 단 1번만 보냄 (pcap 확정, 0424_.pcapng).
    // 반복 subscribe 는 DJM 상태를 교란할 수 있어 제거. 15초 뒤 0x39/0x58 모두
    // 미수신일 때만 1회 재시도 fallback.
    setTimeout(sendDjmSub, 9700);
    const _subRetryT = setTimeout(()=>{
      if(!liveSession()) return;
      if(this._hasRealFaders) return;
      if(this._djmMeterCount>0) return;
      console.log('[PDJL] 0x57 no response — single retry');
      sendDjmSub();
    }, 25000);
    this._djmSubTimer=_subRetryT;
    // _timers.push 제거 — rebindPDJL 에서 _djmSubTimer 개별 clear.
    const _notifyTimer=setInterval(()=>{ if(!liveSession()) return; sendBridgeNotifyToAll(); },2000);
    this._bridgeNotifyTimer=_notifyTimer;
    // _timers.push 제거 — rebindPDJL 에서 _bridgeNotifyTimer 개별 clear.

    // DJM freshness watchdog — lastSeen >10s 이면 연결 해제로 간주하고 모든 믹서 상태 초기화
    // (UI는 onDeviceList 빈 DJM + hasRealFaders:false 를 받으면 defaults 로 복귀)
    const _djmWatch=setInterval(()=>{
      if(!liveSession()) return;
      const djm=this.devices['djm'];
      if(!djm) return;
      const now=Date.now();
      if(now-djm.lastSeen > 10000){
        console.log(`[DJM] lastSeen=${now-djm.lastSeen}ms — 연결 해제로 간주, 상태 초기화`);
        delete this.devices['djm'];
        this._hasRealFaders=false;
        this._djmMixer=null;
        this.faders=[255,255,255,255];
        this.onAir=[0,0,0,0];
        this._djmSubCount=0;
        this._djmSeenTypes.clear();
        this._nonPdjlDjm=null;
        this.onDJMStatus?.({channel:this.faders, onAir:this.onAir, eq:[], vuLevel:[0,0,0,0,0,0],
          xfader:null, masterLvl:null, hpCueCh:null, hasRealFaders:false});
        this.onDeviceList?.(this.devices);
      }
    },2000);
    this._djmWatchTimer=_djmWatch;
    // _timers.push 제거 — rebindPDJL 에서 _djmWatchTimer 개별 clear.

    // Virtual CDJ status broadcast every 500ms — keeps Arena updated on virtual decks
    // Real CDJs broadcast status packets ~every 500ms; Arena stops querying if it stops seeing them
    const vt=setInterval(()=>{
      for(let i=0;i<8;i++){
        const layer=this.layers[i];
        if(!this.hwMode[i] && layer?.trackId){
          this._sendVirtualCDJStatus(i+1, layer.trackId, layer.bpm||128);
        }
      }
    },500);
    this._timers.push(vt);
  }

  _onPDJL(msg, rinfo){
    const hasMagic = hasPDJLMagic(msg);
    const typeByte = msg.length>10 ? msg[10] : 0;
    const nameField = readPDJLNameField(msg);
    const djmIp = this.devices['djm']?.ip;
    const isDjmSource = (djmIp && rinfo.address===djmIp) || nameField.includes('DJM');
    if(isDjmSource){
      const seenKey = `0x${typeByte.toString(16).padStart(2,'0')}`;
      if(!this._djmSeenTypes.has(seenKey)){
        this._djmSeenTypes.add(seenKey);
        const hex = msg.slice(0, Math.min(32, msg.length)).toString('hex');
        try{
          console.log(`[DJM-RAW] type=${seenKey} len=${msg.length} src=${rinfo.address}:${rinfo.port} magic=${hasMagic?'yes':'no'} hex=${hex}`);
        }catch(_){}
      }
    }
    // ── BROAD CAPTURE: record ALL packets from ALL sources BEFORE any parsing ──
    // This captures non-PDJL-magic packets too (unknown DJM protocols, etc.)
    if(this._djmCapture && this._djmCaptureStream){
      const ts=Date.now();
      const type=typeByte;
      const name=(hasMagic&&nameField)?nameField:'?';
      const hex=msg.toString('hex');
      const magic=hasMagic?'pdjl':'RAW';
      try{this._djmCaptureStream.write(`${ts} ${rinfo.address}:${rinfo.port} ${magic} type=0x${type.toString(16).padStart(2,'0')} len=${msg.length} name=${name} ${hex}\n`);}catch(_){}
    }
    // hot-path 최적화: 위에서 이미 계산된 hasMagic/nameField 를 hint 로 전달
    // (parser 내부 중복 계산 회피 — string alloc/decode 절감, ~500 pkt/s).
    const p = parsePDJL(msg, { hasMagic, nameField });
    // Log first occurrence of each packet type per source — skip CDJ status (too noisy)
    if(!this._pdjlDbg) this._pdjlDbg={};
    const dbgK=rinfo.address+':'+msg[10];
    if(!this._pdjlDbg[dbgK]){
      this._pdjlDbg[dbgK]=true;
      const kind=p?.kind||'null';
      if(kind!=='cdj'&&kind!=='precise_pos'&&kind!=='beat'&&kind!=='cdj_wf'){
        try{console.log(`[PDJL] type=0x${msg[10]?.toString(16)} from ${rinfo.address} len=${msg.length} kind=${kind}`);}catch(_){}
      }
    }
    // Non-PDJL packet (no magic) from known DJM IP — could be unknown mixer protocol
    if(!p){
      if(djmIp&&rinfo.address===djmIp){
        if(!this._nonPdjlDjm)this._nonPdjlDjm={};
        const nk=msg.length+'_'+msg[0];
        if(!this._nonPdjlDjm[nk]){
          this._nonPdjlDjm[nk]=true;
          console.log(`[DJM-NONPDJL] ip=${rinfo.address} port=${rinfo.port} len=${msg.length} first16=${msg.slice(0,16).toString('hex')}`);
        }
      }
      return;
    }
    // Skip own packets (bridge spoofed device)
    if(p.name==='BRIDGE+'||p.name==='TCS-SHOWKONTROL'||rinfo.address==='127.0.0.1') return;
    if(p.kind==='cdj'){
      const li = p.playerNum-1;
      const key = `cdj${p.playerNum}`;
      if(!this.devices[key]){
        this.devices[key]={type:'CDJ',playerNum:p.playerNum,name:p.name,ip:rinfo.address,lastSeen:Date.now()};
        console.log(`[PDJL] CDJ P${p.playerNum}(${p.name})@${rinfo.address}`);
        this.onDeviceList?.(this.devices);
        // 자동 모드일 때 CDJ 서브넷과 매칭되는 인터페이스로 전환
        this._autoSelectPdjlForRemote(rinfo.address);
      } else this.devices[key].lastSeen=Date.now();
      this.devices[key].state=p;
      if(this.hwMode[li]){
        const beatPhase = Math.max(0, (p.beatInBar - 1)) * 64;

        let acc = this._tcAcc[li];
        const trackChanged = !acc || acc.trackId !== p.trackId;
        let timecodeMs = 0;

        if(trackChanged){
          this._tcAcc[li] = { prevBn: p.beatNum, elapsedMs: 0, trackId: p.trackId, dbgCount:0, metaRequested:false, initPos:0 };
          // 새 트랙에 이전 캐시 적용 금지: beat grid / 길이 / 정밀 위치 모두 무효화
          // (dbserver 응답이 오기 전까지 stale 값으로 timecodeMs 계산하면 UI가 점프로 인식)
          if(this._beatGrids) delete this._beatGrids[p.playerNum];
          if(this._bgTrackLen) delete this._bgTrackLen[p.playerNum];
          if(this._precisePos) delete this._precisePos[p.playerNum];
          if(this._wfTrackLen) delete this._wfTrackLen[p.playerNum];
          if(this._cuePoints) delete this._cuePoints[p.playerNum];
          // NXS2 한정: 트랙 변경 시 cuePos/totalLength stale 잔존 명시적 초기화
          if(p.isNXS2){
            if(this._cuePosMs) this._cuePosMs[p.playerNum] = 0;
            if(this.layers[li]) this.layers[li].totalLength = 0;
          }
          // Clear artwork on track change — push blank JPEG to Arena to replace stale art
          this._virtualArt[li] = BLANK_JPEG;
          if(this.layers[li]){
            this.layers[li].trackName = '';
            this.layers[li].artistName = '';
            if(this._metaCache?.[li]) this._metaCache[li] = null;
          }
          this.onAlbumArt?.(p.playerNum, null);
          this._sendArtwork(li + 1, BLANK_JPEG);  // TCNet LowResArtwork clear
          // Auto-request metadata — must query the SOURCE device's dbserver (Link Export)
          if(p.trackId>0 && p.hasTrack){
            this._tcAcc[li].metaRequested = true;
            // Find source device IP: trackDeviceId tells us which player owns the media.
            const srcDev = this.devices['cdj'+p.trackDeviceId];
            const medSrc = this._mediaSources?.[p.trackDeviceId];
            // NXS2 USB direct: trackDeviceId 가 자기 자신(p.playerNum) 일 때 fallback 도 자기 IP 로
            const selfDev = this.devices['cdj'+p.playerNum];
            const _ip = srcDev?.ip || medSrc?.ip
              || (p.trackDeviceId===p.playerNum ? selfDev?.ip : null)
              || rinfo?.address;
            const _slot=p.slot||3, _tid=p.trackId, _pn=p.playerNum, _tt=p.trackType||1;
            const _srcLbl = srcDev ? 'cdj'+p.trackDeviceId
              : medSrc ? 'mediaSrc '+medSrc.name
              : (p.trackDeviceId===p.playerNum ? 'self('+p.playerNum+')' : 'rinfo');
            _dbgLog(`[META] P${_pn} tid=${_tid} trackDevId=${p.trackDeviceId} slot=${_slot} tt=${_tt} → ip=${_ip} (src=${_srcLbl}) NXS2=${!!p.isNXS2}`);
            setTimeout(()=>this.requestMetadata(_ip, _slot, _tid, _pn, true, _tt), this._dbReady?100:3000);
            this._dbReady = true;
          }
        } else if(acc && !acc.metaRequested && p.trackId>0 && p.hasTrack){
          acc.metaRequested = true;
          const srcDev = this.devices['cdj'+p.trackDeviceId];
          const _ip = srcDev?.ip
            || this._mediaSources?.[p.trackDeviceId]?.ip
            || rinfo?.address;
          this.requestMetadata(_ip, p.slot||3, p.trackId, p.playerNum, false, p.trackType||1);
        }
        // ── Track length (권위 순위) ──
        //  1) 웨이브폼 디테일 길이 × 1/150 — rekordbox 분석 원본 (ms 정밀, ±6.67ms)
        //  2) Beat-grid: last beat timeMs + one interval
        //  3) trackBeats × 60/bpm
        //  4) 0x0b 정수 초 × 1000 (.000)
        //  5) 이전 layer 값
        // 기타 구현들은 trackLenSec(uint32 초)만 사용 → 소수점 없음
        // 본 브리지는 waveform-detail(150 pts/sec) 로 ms 정밀도까지 복원 (자체 최적화)
        const prevLayerLen = this.layers[li]?.totalLength || 0;
        const ppLen = this._precisePos?.[p.playerNum]?.trackLengthSec;
        const ppLenMs = ppLen ? Math.round(ppLen * 1000) : 0;
        const wfLen = this._wfTrackLen?.[p.playerNum] || 0;
        const bgEstLen = this._bgTrackLen?.[p.playerNum] || 0;
        const beatBasedLen = nxs2BeatCountToMs(p.trackBeats, p.bpmTrack);
        // wfLen 이 ppLenMs 와 ±3초 이내면 신뢰 (rekordbox 분석 완료 상태)
        const wfSane = wfLen > 0 && (ppLenMs === 0 || Math.abs(wfLen - ppLenMs) < 3000);
        const _msPrecise = wfSane ? wfLen
          : (bgEstLen>0 && ppLenMs>0 && Math.abs(bgEstLen-ppLenMs)<3000) ? bgEstLen
          : (beatBasedLen>0 && ppLenMs>0 && Math.abs(beatBasedLen-ppLenMs)<3000) ? beatBasedLen
          : (wfLen > 0 && ppLenMs === 0) ? wfLen
          : (bgEstLen > 0 && ppLenMs === 0) ? bgEstLen
          : 0;
        const totalLenMs = p.isNXS2
          ? (wfSane ? wfLen : (bgEstLen || beatBasedLen || wfLen || prevLayerLen))
          : (_msPrecise || wfLen || bgEstLen || beatBasedLen || ppLenMs || prevLayerLen);

        // ── CDJ-2000NXS2 timecode path ──
        // No compatible type 0x0b precise_pos — prefer real 0x48 fraction when present,
        // otherwise anchor on beat-grid/beatNum and interpolate by effective pitch.
        const pp = this._precisePos?.[p.playerNum];
        const hasPrecise = pp && (Date.now()-pp.time)<500;

        const isEnded = (p.p1 === 0x0D || p.p1 === 0x11); // End / Ended p1 states

        if(!p.isNXS2 && hasPrecise){
          // ── CDJ-3000: direct ms from type 0x0b packet (highest accuracy) ──
          timecodeMs = pp.playbackMs;
          // Capture exact track length when CDJ-3000 reaches end of track
          if(isEnded && pp.playbackMs > (this._bgTrackLen?.[p.playerNum] || 0)){
            this._bgTrackLen = this._bgTrackLen || {};
            this._bgTrackLen[p.playerNum] = pp.playbackMs;
          }
        } else if(isEnded){
          // ── End/Ended state (both models): show last known position, clamp to totalLenMs ──
          const prev = this.layers[li]?.timecodeMs || 0;
          timecodeMs = (totalLenMs > 0 && prev > totalLenMs) ? totalLenMs : (prev || totalLenMs);
          if(acc){
            acc._playStart=0; acc._anchorMs=null; acc._anchorTime=null;
            acc._noBeatAnchorTime=null; acc._noBeatAnchorMs=null;
            acc._fracMs=null; acc._fracAnchorTime=null;
            // _prevState 업데이트 누락이 hot cue 다중 누름 버그 원인이었음:
            // ENDED→PLAYING 전환 시 prev 가 PLAYING 으로 남아 wasStoppedLike 가 fail 해
            // anchor reset 이 안 일어나 stale totalLenMs 그대로 사용 → 즉시 끝 점프.
            acc._prevState = p.state;
          }
        } else if(p.isPlaying || p.isLooping){
          // ── Playing/Looping: CDJ-2000NXS2 interpolation (+ CDJ-3000 fallback without 0x0b) ──
          if(!acc) this._tcAcc[li] = acc = { prevBn:0, elapsedMs:0, trackId:p.trackId, dbgCount:0, metaRequested:false };
          // State transition: CUED/PAUSED/STOPPED → PLAYING 순간 accumulator 리셋.
          // (hot cue / play 버튼 모두 이 전환을 거치며, 점프 위치를 즉시 반영)
          const prevSt = acc._prevState;
          // ENDED 포함: NXS2 fw 1.87 은 hot cue 다중 누름 시 ENDED→PLAYING 직접 transition
          // (CUED 패킷 거치지 않음). ENDED 가 reset 트리거에 빠져있어 anchor 가 stale (totalLenMs)
          // 그대로 유지되어 timecode 가 즉시 끝으로 점프하던 버그 수정.
          const wasStoppedLike = prevSt === STATE.CUEDOWN || prevSt === STATE.PAUSED ||
            prevSt === STATE.STOPPED || prevSt === STATE.IDLE || prevSt === STATE.ENDED;
          if(wasStoppedLike){
            acc._fracMs = null; acc._fracAnchorTime = null;
            acc._anchorMs = null; acc._anchorTime = null;
            acc._noBeatAnchorTime = null; acc._noBeatAnchorMs = null;
            acc._bwGuardCount = 0;
            acc.prevBn = 0;
          }
          acc._prevState = p.state;

          // NXS2 루프: TC forward 진행 + saved loop cue 매칭 시 wrap, 그 외 trackEnd 에서 clamp.
          if(p.isNXS2 && p.isLooping){
            const wasLooping = (this.layers[li]?.state === STATE.LOOPING);
            if(!wasLooping){
              const lastTc = this.layers[li]?.timecodeMs || 0;
              acc._loopAnchorMs = lastTc > 0 ? lastTc : (acc._fracMs || 0);
              acc._loopAnchorTime = Date.now();
            }
            let baseMs = acc._loopAnchorMs || 0;
            const beatMs = p.bpm > 0 ? 60000/p.bpm : (p.bpmTrack > 0 ? 60000/p.bpmTrack : 60000/130);
            let loopEndMs = baseMs + beatMs * 4;
            let hasSaved = false;
            const cuePts = this._cuePoints?.[p.playerNum];
            if(cuePts){
              const matchedLoop = cuePts.find(c =>
                c.type === 'loop' && c.loopEndMs > c.timeMs &&
                Math.abs(c.timeMs - baseMs) < beatMs * 2
              );
              if(matchedLoop){
                baseMs = matchedLoop.timeMs;
                loopEndMs = matchedLoop.loopEndMs;
                hasSaved = true;
              }
            }
            const elapsed = Date.now() - (acc._loopAnchorTime || Date.now());
            const advance = elapsed * (p.pitchMultiplier || 1);
            if(hasSaved){
              // saved loop: 정확한 길이 wrap
              const loopMs = loopEndMs - baseMs;
              timecodeMs = Math.round(baseMs + (advance % Math.max(1, loopMs)));
            } else {
              // unknown length: anchor 부터 forward, trackEnd 에서 clamp (past-end 방지)
              const proposed = (acc._loopAnchorMs || baseMs) + advance;
              const cap = totalLenMs > 0 ? totalLenMs - 50 : Infinity;
              timecodeMs = Math.round(Math.min(proposed, cap));
            }
            acc._loopStartMs = Math.round(baseMs);
            acc._loopEndMs   = Math.round(loopEndMs);
            // acc._fracMs / _anchor 도 동기화 (루프 풀릴 때 ms 점프 최소화)
            acc._fracMs = timecodeMs;
            acc._fracAnchorTime = Date.now();
            acc._anchorMs = timecodeMs;
            acc._anchorTime = Date.now();
          } else if(p.positionFraction > 0 && totalLenMs > 0){
            // NXS2 positionFraction 은 beatNum/trackBeats 비율 → BEAT 단위로 quantize
            // 되어 있다 (128BPM 에서 ~469ms 간격). beat 사이에는 rawFracMs 가
            // 정지하므로 내부적으로 extrapolation 필요. "beat 크로싱" 감지 시에만
            // anchor 갱신하고 연속성을 보존해야 뚝뚝 끊기는 현상 제거.
            const rawFracMs = Math.round(p.positionFraction * totalLenMs);
            const prevRaw = acc._prevRawFrac ?? -1;
            const rawChanged = rawFracMs !== prevRaw;
            const now = Date.now();

            // 루프 경계 추론 — rawFracMs 가 역으로 점프할 때만 (loop wrap)
            if(p.isLooping){
              if(prevRaw > 0 && rawFracMs < prevRaw - 100){
                acc._loopStartMs = rawFracMs;
                acc._loopEndMs   = prevRaw;
              }
            } else {
              acc._loopStartMs = 0; acc._loopEndMs = 0;
            }

            if(!acc._anchorMs){
              acc._anchorMs = rawFracMs;
              acc._anchorTime = now;
              acc._prevRawFrac = rawFracMs;
            } else if(rawChanged){
              // 순수 pitch-extrapolation 전략: anchor 는 "처음 세팅" + "jump 시에만
              // reset". 정상 beat 크로싱에서는 anchor 갱신 금지 (갱신하면 작은
              // backward jitter 발생). 대신 pitch 가 정확하면 extrapolation 만으로
              // 정확도 유지. 누적 drift 가 크면 그때 snap.
              const elapsedA = now - acc._anchorTime;
              const expected = acc._anchorMs + elapsedA * p.pitchMultiplier;
              const delta = rawFracMs - expected;
              // Snap 조건 — 실제 jump 만:
              //   delta < -100ms      : 역방향 (hot cue back / loop / seek)
              //   delta > 1500ms      : 큰 전방 jump (hot cue forward / seek)
              //   p.isLooping         : 루프 경계
              //   |delta| > 600 AND 누적 drift 의심 (pitch 오차 장기 축적)
              if(delta < -100 || delta > 1500 || p.isLooping){
                acc._anchorMs = rawFracMs;
                acc._anchorTime = now;
              }
              // else: anchor 유지, pitch extrapolation 이 TC 를 연속적으로 생성.
              acc._prevRawFrac = rawFracMs;
            }
            // rawChanged 아니면 anchor 유지, extrapolation 만 이어감 → 뚝뚝 없음.

            acc._fracMs = rawFracMs;
            acc._fracAnchorTime = now;
            if(p.isLooping){
              // 루프: 경계 오버슈트 방지 위해 extrapolation 제한 (최대 500ms)
              const elapsed = Math.min(now - acc._anchorTime, 500);
              timecodeMs = Math.round(acc._anchorMs + elapsed * p.pitchMultiplier);
            } else {
              const elapsed = now - acc._anchorTime;
              timecodeMs = Math.round(acc._anchorMs + elapsed * p.pitchMultiplier);
            }
          } else {
            // BPM-less / trackBeats=0 fallback — beat 카운터 + pitch extrapolation
            const bg = this._beatGrids?.[p.playerNum];
            const beatNum = (p.beatNum > 0 && p.beatNum < 0xFFFFFF) ? p.beatNum : 0;
            const beatIdx = beatNum - 1;
            if(beatNum > 0 && acc.prevBn !== beatNum){
              const beatMs = (bg && beatIdx >= 0 && beatIdx < bg.length)
                ? bg[beatIdx].timeMs
                : (p.bpmTrack > 0 ? Math.round((beatNum-1) * 60000 / p.bpmTrack) : 0);
              const predicted = acc._anchorMs != null && acc._anchorTime != null
                ? Math.round(acc._anchorMs + (Date.now()-acc._anchorTime) * p.pitchMultiplier)
                : 0;
              if(shouldKeepPredictedBeatAnchor(predicted, beatMs, p.bpmTrack, p.isReverse)){
                timecodeMs = predicted;
                acc.prevBn = beatNum;
              } else {
                timecodeMs = beatMs;
                acc._anchorMs = timecodeMs; acc._anchorTime = Date.now(); acc.prevBn = beatNum;
              }
            } else if(acc._anchorMs != null){
              const elapsed = Date.now() - acc._anchorTime;
              timecodeMs = Math.round(acc._anchorMs + elapsed * p.pitchMultiplier);
            } else if(beatNum > 0 && p.bpmTrack > 0){
              timecodeMs = Math.round((beatNum-1) * 60000 / p.bpmTrack);
              acc._anchorMs = timecodeMs; acc._anchorTime = Date.now(); acc.prevBn = beatNum;
            } else {
              // BPM-less + no beat number: wall-clock interpolation.
              // NXS2 한정 강화: pitchMultiplier 가 0 이라도 (paused/0% pitch) playing 상태면
              // 1.0 fallback 사용. 이전엔 pitchMultiplier=0 이면 stale tc 유지 → 정체.
              const pm = (p.pitchMultiplier > 0)
                ? p.pitchMultiplier
                : (p.isNXS2 && p.isPlaying ? 1.0 : 0);
              if(pm > 0){
                if(acc._noBeatAnchorTime == null){
                  acc._noBeatAnchorTime = Date.now();
                  // wasStoppedLike 직후: layers[li].timecodeMs 가 stale (ENDED clamp=totalLenMs)
                  // 일 수 있어 그대로 사용 시 hot cue 다중 누름 시 즉시 끝으로 점프. cuePosMs
                  // (마지막 CUEDOWN 시점 tc) 우선, 없으면 0 으로 fresh start.
                  const cuePos = (this._cuePosMs?.[p.playerNum]) || 0;
                  const lastTc = (this.layers[li]?.timecodeMs) || 0;
                  // 만약 lastTc 가 totalLenMs 부근(끝) 이면 stale 로 간주 → cuePos 사용.
                  // 그 외엔 lastTc (extrapolation 연속성 유지).
                  const nearEnd = totalLenMs > 0 && lastTc >= totalLenMs - 200;
                  acc._noBeatAnchorMs = nearEnd ? cuePos : lastTc;
                }
                const elapsed = Date.now() - acc._noBeatAnchorTime;
                timecodeMs = Math.round(acc._noBeatAnchorMs + elapsed * pm);
                // 재anchor 주기 단축 (2s → 500ms) — NXS2 status 600ms 간격 사이에서도 매끄럽게
                if(elapsed > 500){ acc._noBeatAnchorTime=Date.now(); acc._noBeatAnchorMs=timecodeMs; }
                // Loop wrap only in LOOPING state; non-loop tracks clamp at track end
                if(totalLenMs > 0 && timecodeMs >= totalLenMs){
                  if(p.isLooping){
                    timecodeMs = timecodeMs % totalLenMs;
                    acc._noBeatAnchorTime = Date.now(); acc._noBeatAnchorMs = timecodeMs;
                  } else {
                    timecodeMs = totalLenMs;
                  }
                }
              } else {
                timecodeMs = this.layers[li]?.timecodeMs || 0;
              }
            }
          }
        } else {
          // ── Stopped/Paused/Cued ──
          // state 트래킹 유지 (다음 playing 진입 때 transition 감지용)
          if(acc) acc._prevState = p.state;
          if(p.state === STATE.CUEDOWN){
            // beatNum in CUEDOWN = current cue position. 비트그리드 우선 lookup.
            // 큐 리스트 매칭은 transient mis-match 일으켜서 제거 (1비트 점프 버그).
            const cueBeat = (p.beatNum > 0 && p.beatNum < 0xFFFFFF) ? p.beatNum : 0;
            if(cueBeat > 0){
              const bg = this._beatGrids?.[p.playerNum];
              const beatIdx = cueBeat - 1;
              if(bg && beatIdx >= 0 && beatIdx < bg.length){
                timecodeMs = bg[beatIdx].timeMs;
              } else if(p.bpmTrack > 0){
                timecodeMs = Math.round((cueBeat - 1) * 60000 / p.bpmTrack);
              } else {
                timecodeMs = 0;
              }
            } else {
              timecodeMs = 0;
            }
          } else {
            if(this._cueEnterTime) delete this._cueEnterTime[p.playerNum];
            if(this.layers[li]?.timecodeMs > 0) timecodeMs = this.layers[li].timecodeMs;
          }
          if(acc){ acc._playStart=0; acc._anchorMs=null; acc._anchorTime=null; acc._noBeatAnchorTime=null; acc._noBeatAnchorMs=null; acc._fracMs=null; acc._fracAnchorTime=null; }
        }

        const prev = this.layers[li];
        const stateChanged = !prev || prev.state     !== p.state;
        const bpmChanged   = !prev || Math.abs((prev.bpm||0) - (p.bpm||0)) > 0.005;
        const beatChanged  = !prev || prev.beatPhase !== beatPhase;

        if(stateChanged || bpmChanged || trackChanged || beatChanged){
          // NXS2 한정: !hasTrack 인데 prev.totalLength 가 살아있으면 stale 잔존 → 0 강제.
          // (CDJ-3000 은 0x0b precise_pos 가 별도 길이 정보 보내므로 그대로)
          const _len = (p.isNXS2 && !p.hasTrack)
            ? 0
            : (totalLenMs || prev?.totalLength || 0);
          this.updateLayer(li, {
            state:       p.state,
            timecodeMs,
            bpm:         p.bpm,
            trackId:     p.trackId,
            totalLength: _len,
            beatPhase,
            deviceName:  p.name,
            _pitch:      p.effectivePitch || p.pitch || 0,
          });
          // NXS2 + no-track 시 cuePos 도 0 으로 강제 (renderer 가 dk.cp 0 표시)
          if(p.isNXS2 && !p.hasTrack && this._cuePosMs){
            this._cuePosMs[p.playerNum] = 0;
          }
        } else if(prev){
          prev._pitch = p.pitch || 0;
          // Only reset interpolation origin when timecode actually changed (new beat)
          if(prev.timecodeMs !== timecodeMs){
            prev.timecodeMs = timecodeMs;
            prev._updateTime = Date.now();
          }
        }
        p.ip = rinfo.address;
        p.timecodeMs = timecodeMs;
        p.totalLenMs = totalLenMs; // beat-based ms precision — renderer uses this for dk.dur

        // CUEDOWN 상태 = CDJ 가 현재 큐 포인트에 있음 → cuePosMs 캡쳐.
        // 주의: P1_TO_STATE[0x07]=CUEDOWN 이지만 0x07 은 "CUE 누른 채 재생(cuing)" 상태.
        // 이때 cuePosMs 갱신하면 매 packet timecode 가 cue 로 저장되어 큐 마커가 플레이헤드 따라감.
        // p1===0x06 (parked at cue) 일 때만 캡처해야 함.
        if(!this._cuePosMs) this._cuePosMs = {};
        if(p.p1 === 0x06 && timecodeMs >= 0){
          this._cuePosMs[p.playerNum] = timecodeMs;
        }
        p.cuePosMs = this._cuePosMs[p.playerNum] || 0;

        // NXS2: 패킷에 loop 필드 없음 → positionFraction 역전으로 추론한 loop 경계 주입
        if(p.isNXS2 && acc?._loopStartMs > 0 && acc?._loopEndMs > acc._loopStartMs){
          p.loopStartMs = acc._loopStartMs;
          p.loopEndMs   = acc._loopEndMs;
        }

        // NXS2/CDJ 상세 로그 — 0.5s 간격 + 상태 전환마다. 타임코드 지터/점프/CP 추적용.
        if(!this._cdjLogState) this._cdjLogState = {};
        const cs = this._cdjLogState[p.playerNum] || (this._cdjLogState[p.playerNum] = { lastT:0, lastState:-1, lastTc:0, hexDumped:false });
        const nowL = Date.now();
        const stChanged = cs.lastState !== p.state;
        const bigJump = Math.abs(timecodeMs - cs.lastTc) > 1500;
        // NXS2 첫 패킷 + state change 마다 raw hex 0x80~0xC0 영역 dump (BPM/beat offset 분석용)
        if(p.isNXS2 && (!cs.hexDumped || stChanged)){
          cs.hexDumped = true;
          const head = p._msgHexHead || '';
          // 0x80 ~ 0xC0 영역 추출 (BPM=0x92, pitch=0x8D, beat=0xA0, trackBeats=0xB4 모두 포함)
          const region80 = head.slice(0x80*2, Math.min(0xC0*2, head.length));
          _dbgLog(`[NXS2-RAW] P${p.playerNum} fw=${p.firmware} msgLen=${p._rawMsgLen} bpmRaw16=0x${(p._bpmRaw16||0).toString(16)} beatRaw=0x${(p._beatNumRaw||0).toString(16)} trackBeatsRaw=0x${(p._trackBeatsRaw||0).toString(16)} posFracRaw=0x${(p._posFracRaw||0).toString(16)} 0x80~0xC0=${region80}`);
        }
        if(stChanged || bigJump || (nowL - cs.lastT) > 500){
          const dt = cs.lastT ? (nowL-cs.lastT) : 0;
          const dTc = timecodeMs - cs.lastTc;
          const expected = dt>0 ? Math.round(dt * (p.pitchMultiplier||1)) : 0;
          const drift = dTc - expected;
          _dbgLog(`[CDJ] P${p.playerNum} ${p.isNXS2?'NXS2':'3000'} fw=${p.firmware} len=${p._rawMsgLen} src=dev${p.trackDeviceId}/slot${p.slot}/tt${p.trackType} tid=${p.trackId} st=${p.p1Name}(0x${p.p1.toString(16)}) tc=${timecodeMs}ms dur=${totalLenMs}ms beat=${p.beatNum}/${p.trackBeats} bib=${p.beatInBar} bpm=${p.bpm}/${p.bpmTrack} pitch=${p.effectivePitch?.toFixed?.(3)}% posFrac=${p.positionFraction?.toFixed?.(4)} cuePos=${p.cuePosMs}ms loop=[${p.loopStartMs||0},${p.loopEndMs||0}] dt=${dt}ms ΔTc=${dTc}ms drift=${drift}ms${stChanged?' [STATE_CHG]':''}${bigJump?' [JUMP]':''}`);
          cs.lastT = nowL; cs.lastState = p.state; cs.lastTc = timecodeMs;
        }

        this.onCDJStatus?.(li, p);
      }
    }
    if(p.kind==='djm_probe20'){
      if(!parsePDJL._probe20Logged){
        parsePDJL._probe20Logged=true;
        console.log(`[DJM] 0x20 probe from ${rinfo.address} seq=${p.seq} (presence only)`);
      }
    }
    if(p.kind==='djm'){
      // 2차 방어: name 에 "DJM" 이 없으면 (rekordbox/가상 믹서) state 덮어쓰기 금지
      if(!(p.name && p.name.includes('DJM'))){
        if(!parsePDJL._fakeDjmLogged){
          parsePDJL._fakeDjmLogged=true;
          console.warn(`[DJM] 가짜 mixer 패킷 무시: name="${p.name}" from=${rinfo.address}:${rinfo.port}`);
        }
        return;
      }
      if(!this._hasRealFaders){
        console.log(`[DJM] 첫 0x39 수신! name=${p.name} from=${rinfo.address}:${rinfo.port} faders=[${p.channel}]`);
      }
      this._hasRealFaders=true;
      this._lastDjmStatus39=Date.now();
      this.faders=p.channel;
      this._djmMixer={
        eq:p.eq,
        xfader:p.xfader!=null?p.xfader:128,
        masterLvl:p.masterLvl!=null?p.masterLvl:255,
        boothLvl:p.boothLvl||0,
        hpLevel:p.hpLevel||0,
        cueBtn:p.cueBtn||[0,0,0,0],
        xfAssign:p.xfAssign||[0,0,0,0],
        masterCue:p.masterCue||0,
        masterBalance:p.masterBalance!=null?p.masterBalance:128,
      };
      // DJM 등록: name 또는 타입 바이트로 실제 믹서 판별
      const isRealDjm = (p.name && p.name.includes('DJM'));
      if(isRealDjm){
        if(!this.devices['djm']){
          this.devices['djm']={type:'DJM',name:p.name,ip:rinfo.address,lastSeen:Date.now()};
          this.onDeviceList?.(this.devices);
          // 자동 모드일 때 DJM 서브넷과 매칭되는 인터페이스로 전환 (bridgeJoin 전에 실행 → 올바른 IP로 join)
          this._autoSelectPdjlForRemote(rinfo.address);
        } else { this.devices['djm'].lastSeen=Date.now(); }
      }
      // Forward raw hex dump for first 128 bytes for protocol debugging in UI log panel
      let rawHex=null;
      if(msg.length>0x20){
        rawHex=Array.from(msg.slice(0,Math.min(msg.length,128))).map(x=>x.toString(16).padStart(2,'0')).join(' ');
      }
      this.onDJMStatus?.({
        channel:p.channel, onAir:p.onAir, eq:p.eq, vuLevel:p.vuLevel,
        xfader:p.xfader, masterLvl:p.masterLvl, masterBalance:p.masterBalance, masterCue:p.masterCue,
        boothLvl:p.boothLvl, hpLevel:p.hpLevel, hpCueCh:p.hpCueCh,
        eqCurve:p.eqCurve, faderCurve:p.faderCurve,
        cueBtn:p.cueBtn, cueBtnB:p.cueBtnB, xfAssign:p.xfAssign,
        chExtra:p.chExtra, hasRealFaders:true,
        // Beat FX / Color FX — parser 가 채워주는 필드들 (이전엔 IPC 로 안 보내져 UI 비활성)
        beatFxSel:p.beatFxSel, beatFxAssign:p.beatFxAssign, beatFxLevel:p.beatFxLevel, beatFxOn:p.beatFxOn,
        fxFreqLo:p.fxFreqLo, fxFreqMid:p.fxFreqMid, fxFreqHi:p.fxFreqHi,
        sendReturn:p.sendReturn, multiIoSel:p.multiIoSel,
        colorFxSel:p.colorFxSel, colorFxParam:p.colorFxParam, sendExt1:p.sendExt1, sendExt2:p.sendExt2,
        hpMixing:p.hpMixing,
        // V10/A9 확장 (이미 parser 에서 채움)
        isV10:p.isV10, boothEqHi:p.boothEqHi, boothEqLo:p.boothEqLo, boothEqBtn:p.boothEqBtn,
        masterCueB:p.masterCueB, hpCueLink:p.hpCueLink, hpCueLinkB:p.hpCueLinkB,
        isolatorOn:p.isolatorOn, isolatorHi:p.isolatorHi, isolatorMid:p.isolatorMid, isolatorLo:p.isolatorLo,
        pktType:msg[10], pktLen:msg.length, rawHex
      });
    }
    if(p.kind==='djm_meter'){
      this._lastDjmMeter58=Date.now();
      this._djmMeterCount=(this._djmMeterCount||0)+1;
      if(!this.devices['djm']){
        this.devices['djm']={type:'DJM',name:p.name||'DJM',ip:rinfo.address,lastSeen:Date.now()};
        console.log(`[DJM] 0x58 meter에서 DJM 최초 감지: name=${p.name} ip=${rinfo.address} len=${msg.length}`);
        this.onDeviceList?.(this.devices);
        this._autoSelectPdjlForRemote(rinfo.address);
      } else {
        this.devices['djm'].lastSeen=Date.now();
        this.devices['djm'].ip=rinfo.address;
        if(p.name) this.devices['djm'].name=p.name;
      }
      if(!this._hasRealFaders && (this._djmMeterCount===1 || this._djmMeterCount%50===0)){
        const has50002=!!this._pdjlSocketByPort?.[50002];
        console.warn(`[DJM] 0x58 meter 수신 중이나 0x39 fader 미수신: meterCount=${this._djmMeterCount} from=${rinfo.address}:${rinfo.port} udp50002=${has50002?'active':'missing'}`);
      }
      this.onDJMMeter?.({ch:p.ch, spectrum:p.spectrum, masterL:p.masterL, masterR:p.masterR, masterLBands:p.masterLBands, masterRBands:p.masterRBands});
    }
    // DJM Channels-On-Air (type 0x03 on port 50001)
    if(p.kind==='djm_onair'){
      // On-air 깜빡임 방지: OR-hold (한번 on이면 500ms 유지)
      const now=Date.now();
      if(!this._onAirLastOn) this._onAirLastOn=[0,0,0,0];
      for(let i=0;i<4;i++) if(p.onAir[i]) this._onAirLastOn[i]=now;
      const held=[0,1,2,3].map(i=> (now-this._onAirLastOn[i]<500)?1:0 );
      const prev=this.onAir||[0,0,0,0];
      const changed = prev[0]!==held[0] || prev[1]!==held[1] ||
                      prev[2]!==held[2] || prev[3]!==held[3];
      if(changed){
        this.onAir = held;
        this.onDJMStatus?.({channel:this.faders, onAir:held, eq:[], xfader:null, masterLvl:null, hpCueCh:null, hasRealFaders:this._hasRealFaders});
      }
      this._lastDjmOnair03=Date.now();
      if(!this.devices['djm']){
        if(!this._hasRealFaders) this.faders=[255,255,255,255];
        this.devices['djm']={type:'DJM',name:p.name||'DJM',ip:rinfo.address,lastSeen:Date.now()};
        console.log(`[DJM] 0x03 on-air에서 DJM 최초 감지: name=${p.name} ip=${rinfo.address}`);
        this.onDeviceList?.(this.devices);
        // 자동 모드일 때 DJM 서브넷과 매칭되는 인터페이스로 전환
        this._autoSelectPdjlForRemote(rinfo.address);
        // 15초 후 0x39 미수신이면 진단 로그
        setTimeout(()=>{
          if(this.running && !this._hasRealFaders && this.devices['djm']){
            const djmIp = this.devices['djm'].ip;
        console.warn(`[DJM] ⚠ 15초 경과했으나 0x39 미수신! DJM=${djmIp} 0x57전송횟수=${this._djmSubCount||0}`);
            console.warn(`[DJM] 체크: 1) DJM이 같은 서브넷? 2) UDP 50002 수신 가능? 3) 0x58 meter만 오는 상태? meterCount=${this._djmMeterCount||0}`);
          }
        }, 15000);
      } else {
        this.devices['djm'].lastSeen=Date.now();
        this.devices['djm'].ip=rinfo.address;
        if(p.name) this.devices['djm'].name=p.name;
      }
    }
    // Beat packet (0x28, port 50001) — beat timing from CDJ
    if(p.kind==='beat'){
      const li=p.playerNum-1;
      if(li>=0&&li<8){
        // Forward to renderer for beatInBar display
        this.onCDJStatus?.(li,{
          playerNum:p.playerNum,
          beatInBar:p.beatInBar,
          bpmFromBeat:p.bpm,
          _beatPacket:true,
        });
      }
    }
    // CDJ-3000 Precise Position (type 0x0b on port 50001, ~30ms interval)
    // Contains direct ms playback position — most accurate source
    if(p.kind==='precise_pos'){
      const li=p.playerNum-1;
      if(li>=0&&li<8){
        // Extra guard: skip if this player is a known NXS2 (redundant but safe)
        const _ppDev = this.devices[`cdj${p.playerNum}`];
        if(_ppDev?.state?.isNXS2) return;
        // Jog anti-jitter (TCNetOutput.h): when paused/jogging, ignore position deltas < 33ms
        // Prevents Resolume frame vibration from CDJ jog-wheel micro-movements
        const _layerState = this.layers[li]?.state;
        const _isPlaying = _layerState===STATE.PLAYING || _layerState===STATE.LOOPING;
        if(!_isPlaying){
          const _lastMs = this.layers[li]?.timecodeMs || 0;
          const _delta = Math.abs(p.playbackMs - _lastMs);
          if(_delta > 0 && _delta < 33) return;
        }
        // Store precise position for CDJ status handler to use
        if(!this._precisePos) this._precisePos={};
        this._precisePos[p.playerNum]={
          playbackMs:p.playbackMs,
          trackLengthSec:p.trackLengthSec,
          bpmEffective:p.bpmEffective,
          time:Date.now(),
        };
        // Debug first occurrence
        if(!this._ppDbg)this._ppDbg={};
        if(!this._ppDbg[p.playerNum]){
          this._ppDbg[p.playerNum]=true;
        }
        // precise_pos는 CDJ-3000 전용 — 길이 우선순위:
        //  1) 웨이브폼 디테일 길이 (rekordbox 분석 원본, 150 pts/sec)
        //  2) beat-grid 추정 길이 (last beat + 1 interval)
        //  3) 0x0b 정수 초 × 1000 (항상 .000 — 프로토콜 제약)
        //  4) 기존 layer totalLength
        // 0x0b [36-39] trackLength 필드는 "seconds rounded down" (프로토콜 명세)
        //  → ms 정밀도는 반드시 dbserver/NFS 분석 데이터로부터 획득해야 함
        const _li = p.playerNum - 1;
        const _wfMs = this._wfTrackLen?.[p.playerNum] || 0;
        const _bgMs = this._bgTrackLen?.[p.playerNum] || 0;
        const _ppSec = p.trackLengthSec > 0 ? Math.round(p.trackLengthSec * 1000) : 0;
        const _wfSane = _wfMs > 0 && (_ppSec === 0 || Math.abs(_wfMs - _ppSec) < 3000);
        const _bgSane = _bgMs > 0 && (_ppSec === 0 || Math.abs(_bgMs - _ppSec) < 3000);
        const _ppTotal = _wfSane ? _wfMs
          : _bgSane ? _bgMs
          : (_ppSec || this.layers[_li]?.totalLength || 0);
        this.onCDJStatus?.(li, {
          playerNum:p.playerNum,
          timecodeMs:p.playbackMs,
          trackLengthSec:p.trackLengthSec,
          totalLenMs: _ppTotal,
          bpmEffective:p.bpmEffective,
          _precisePos:true,
        });
      }
    }
    // Media Slot Response (type 0x06, long variant) — USB color
    if(p.kind==='media_slot'&&p.playerNum>0&&p.mediaColor>0){
      // Apply this color to all players that load from this player's USB
      console.log(`[MEDIA] P${p.playerNum} USB color=${p.mediaColor}`);
      for(const[k,dev]of Object.entries(this.devices)){
        if(k.startsWith('cdj')&&dev.state){
          // All players loading from this source get the same color
          if(dev.state.trackDeviceId===p.playerNum||dev.playerNum===p.playerNum){
            dev.state.mediaColor=p.mediaColor;
            dev.mediaColor=p.mediaColor;
            this.onCDJStatus?.(dev.playerNum-1,dev.state);
          }
        }
      }
    }
    if(p.kind==='cdj_wf'){
      this.onWaveformPreview?.(p.playerNum, {seg:p.seg, pts:p.pts, wfType:p.wfType});
    }
    if(p.kind==='announce'){
      const pn = p.playerNum;
      // Skip self-announce (bridge device) — double-check name and IP
      if(p.name==='BRIDGE+'||p.name==='TCS-SHOWKONTROL'||rinfo.address==='127.0.0.1') return;
      // 가상 장치/소프트웨어 announce — 덱 목록 제외.
      if(p.name && /rekordbox|rbdj|NXS-?GW|TCS-|prolink/i.test(p.name)){
        // rekordbox 는 CDJ 가 LAN Link Export 로 로드한 트랙의 메타데이터 출처 →
        // IP 를 _mediaSources 에 저장. playerNum 이 0 이어도 저장 (CDJ 의 trackDeviceId
        // 가 실제로 어떤 값일지 모르니 0, pn, 그리고 가능한 alias 모두 매핑).
        if(p.name && /rekordbox|rbdj/i.test(p.name)){
          this._mediaSources = this._mediaSources || {};
          const entry = { ip: rinfo.address, name: p.name, lastSeen: Date.now() };
          if(pn >= 0 && pn <= 50) this._mediaSources[pn] = entry;
          // rekordbox 흔한 trackDeviceId 들: 0x11(17), 0x21(33), 0x22(34), 0x23(35)
          for(const k of [17, 33, 34, 35]){
            if(!this._mediaSources[k]) this._mediaSources[k] = entry;
          }
        }
        if(!this._fakeAnnLogged) this._fakeAnnLogged={};
        const fkey = `${p.name}@${rinfo.address}`;
        if(!this._fakeAnnLogged[fkey]){
          this._fakeAnnLogged[fkey]=true;
          console.warn(`[PDJL] 가짜 announce 차단: name="${p.name}" from=${rinfo.address} pn=${pn} (media source 로 17/33/34/35 에 매핑)`);
        }
        return;
      }
      // DJM detect: name contains "DJM" OR device type byte[33]=0x02 (mixer 식별자)
      const isDjm = (p.name && p.name.includes('DJM')) || p.isDjmType;
      if(isDjm){
        if(!this.devices['djm']){
          this.devices['djm']={type:'DJM',name:p.name,ip:rinfo.address,lastSeen:Date.now()};
          console.log(`[PDJL] DJM keepalive detected: ${p.name}@${rinfo.address} (isDjmType=${p.isDjmType})`);
          this.onDeviceList?.(this.devices);
          // 자동 모드일 때 DJM 서브넷 매칭으로 인터페이스 자동 선택
          this._autoSelectPdjlForRemote(rinfo.address);
        } else {
          this.devices['djm'].lastSeen=Date.now();
          this.devices['djm'].ip=rinfo.address;
        }
        return;
      }
      // Register as CDJ device if playerNum is valid (1-6)
      if(pn>0 && pn<=6){
        const key = `cdj${pn}`;
        if(!this.devices[key]){
          this.devices[key]={type:'CDJ',playerNum:pn,name:p.name,ip:rinfo.address,lastSeen:Date.now()};
          this.onDeviceList?.(this.devices);
          // 자동 모드일 때 CDJ 서브넷 매칭으로 인터페이스 자동 선택
          this._autoSelectPdjlForRemote(rinfo.address);
        } else {
          this.devices[key].lastSeen=Date.now();
          this.devices[key].ip=rinfo.address; // update IP in case it changed
        }
      } else {
        const k=`dev_${rinfo.address}`;
        if(!this.devices[k]){
          this.devices[k]={type:'DEVICE',name:p.name,ip:rinfo.address,lastSeen:Date.now()};
          this.onDeviceList?.(this.devices);
        }
      }
    }
  }

  // ── API ─────────────────────────────────────
  /** Update layer state; actual transmission happens in Status/TIME packets. */
  updateLayer(i, data){
    if(i<0||i>7) return;
    const prev = this.layers[i] || {};

    // 재생→정지 전환 감지: Force Re-sync(TC State=2) 플래그 — Arena가 정확한 위치로 즉시 seek
    const wasActive = prev.state === STATE.PLAYING || prev.state === STATE.LOOPING
      || prev.state === STATE.FFWD || prev.state === STATE.FFRV;
    const newState = data.state ?? prev.state ?? STATE.IDLE;
    const nowInactive = newState !== STATE.PLAYING && newState !== STATE.LOOPING
      && newState !== STATE.FFWD && newState !== STATE.FFRV;
    const _needResync = wasActive && nowInactive && data.state !== undefined;

    // Merge: only overwrite fields that are explicitly provided
    this.layers[i] = {
      timecodeMs:  data.timecodeMs ?? prev.timecodeMs ?? 0,
      state:       newState,
      bpm:         data.bpm ?? prev.bpm ?? 0,
      trackId:     data.trackId ?? prev.trackId ?? 0,
      totalLength: data.totalLength ?? prev.totalLength ?? 0,
      trackName:   data.trackName  ?? prev.trackName  ?? '',
      artistName:  data.artistName ?? prev.artistName ?? '',
      deviceName:  data.deviceName ?? prev.deviceName ?? '',
      beatPhase:   data.beatPhase ?? prev.beatPhase ?? 0,
      _updateTime: Date.now(),
      _pitch:      data._pitch ?? prev._pitch ?? 0,
      _needResync,
    };
    // Virtual deck: broadcast CDJ status so Arena queries our dbserver immediately
    if(!this.hwMode[i] && data.trackId){
      this._sendVirtualCDJStatus(i+1, data.trackId, data.bpm||128);
    }
  }

  removeLayer(i){ if(i>=0&&i<=7){ this.layers[i]=null; this._syncVirtualDevices(); } }
  setHWMode(i,e){ if(i>=0&&i<=7){this.hwMode[i]=e;console.log(`[HW] setHWMode(${i},${e}) → [${this.hwMode.slice(0,4)}]`);} }

  /** Register virtual deck in devices list so Arena sees a CDJ model name. */
  registerVirtualDeck(slot, modelName){ return _vd.registerVirtualDeck(this, slot, modelName); }
  unregisterVirtualDeck(slot){ return _vd.unregisterVirtualDeck(this, slot); }
  _syncVirtualDevices(){
    for(const [k,d] of Object.entries(this.devices)){
      if(d.virtual) d.lastSeen = Date.now();
    }
  }
  getActiveNodes(){ const now=Date.now(); return Object.values(this.nodes).filter(n=>now-n.lastSeen<10000); }
  getActiveDevices(){ const now=Date.now(); return Object.values(this.devices).filter(d=>now-d.lastSeen<10000&&d.name!=='BRIDGE+'&&d.ip!=='127.0.0.1'); }
  getPDJLPort(){ return this.pdjlPort; }
  get nodeName(){ return TC.NNAME; }

  // ── Virtual dbserver (TCP 12523 emulation) ────
  // Serves artwork for virtual decks so Resolume Arena can fetch album art
  // Protocol: responds to port-discovery + greeting + artwork requests

  /** Store artwork JPEG buffer for a virtual deck slot (0-based).
   *  Also triggers PDJL CDJ status broadcast so Arena queries our dbserver,
   *  and pushes thumbnail via REST API as fallback. */
  setVirtualArt(slot, jpegBuf){ return _vd.setVirtualArt(this, slot, jpegBuf); }

  /** Send a virtual CDJ status packet (type 0x0A) so Resolume Arena sees
   *  a track-loaded player and queries our virtual dbserver for artwork.
   *  Relevant offsets:
   *    0x24=playerNum, 0x28=trackDeviceId, 0x29=slot, 0x2A=trackType, 0x2C=trackId(BE) */
  // Rate-limit guard lives in bridge/virtual-deck.js: if(this._shouldLogRate(`virt_status_${playerNum}`, 10000, _summary)){
  _sendVirtualCDJStatus(playerNum, trackId, bpm){ return _vd.sendVirtualCDJStatus(this, playerNum, trackId, bpm); }

  /** Push JPEG artwork to Resolume Arena REST API as clip thumbnail fallback. */
  async _pushArtToResolume(slot, jpegBuf){
    try{
      // Find Arena IP from known nodes
      let arenaIP = '127.0.0.1';
      for(const n of Object.values(this.nodes)){
        if(n.vendor && n.vendor.includes('Resolume')) arenaIP = n.ip;
      }

      // Resolume REST API: PUT raw JPEG binary as clip thumbnail
      const layer = slot + 1;
      const clip = 1;
      const http = require('http');
      const url = `http://${arenaIP}:8080/api/v1/composition/layers/${layer}/clips/${clip}/thumbnail`;
      console.log(`[ARENA-ART] PUT ${url} (${jpegBuf.length}B JPEG)`);
      const req = http.request(url, {method:'PUT', headers:{'Content-Type':'image/jpeg','Content-Length':jpegBuf.length}}, res=>{
        let d='';res.on('data',c=>d+=c);
        res.on('end',()=>console.log(`[ARENA-ART] thumbnail ${res.statusCode} slot${slot+1}: ${d.slice(0,80)}`));
      });
      req.on('error', e=>console.warn(`[ARENA-ART] REST failed: ${e.message} (enable HTTP server in Arena Preferences)`));
      req.write(jpegBuf); req.end();
    }catch(e){
      console.warn(`[ARENA-ART] push failed: ${e.message}`);
    }
  }

  _startVirtualDbServer(){ return _vd.startVirtualDbServer(this); }

  /** parseDbRequest → pdjl/dbserver.js (Phase 4.11) */
  _parseDbRequest(buf){ return _DB.parseDbRequest(buf); }

  _handleVDbRequest(sock, buf){ return _vd.handleVDbRequest(this, sock, buf); }

  // Find artwork for a specific trackId (matches layer's trackId → slot → _virtualArt)
  _findArtByTrackId(trackId){
    if(!trackId) return null;
    for(let i=0;i<8;i++){
      const ld=this.layers[i];
      if(ld && ld.trackId===trackId){
        const buf=this._virtualArt[i];
        if(buf&&buf.length>100) return buf;
      }
    }
    return null;
  }

  _findVirtualArt(){ return _vd.findVirtualArt(this); }

  _dbBuildMenuItem(txId, label1, label2, artworkId){ return _DB.dbBuildMenuItem(txId, label1, label2, artworkId); }
  _dbBuildArtResponse(txId, jpegBuf){ return _DB.dbBuildArtResponse(txId, jpegBuf); }

  // ── dbserver metadata client (TCP 12523) ────
  // Protocol implementation
  // Flow: port discovery → greeting → setup → metadata query → render → parse

  onTrackMetadata = null; // (playerNum, {title, artist, album, duration, artworkId, key, genre}) => {}

  /**
   * Request track metadata + artwork from a CDJ via dbserver protocol.
   */
  // dbserver orchestrator → bridge/dbserver-orchestrator.js (Phase 5.4). 1줄 wrapper.
  requestMetadata(ip, slot, trackId, playerNum, force=false, trackType=1){
    return _dborch.requestMetadata(this, ip, slot, trackId, playerNum, force, trackType);
  }
  refreshAllMetadata(){ return _dborch.refreshAllMetadata(this); }
  requestArtwork(ip, slot, artworkId, playerNum){
    return _dborch.requestArtwork(this, ip, slot, artworkId, playerNum);
  }
  _scheduleDbFollowUps(ip, slot, trackId, playerNum, trackType, artworkId){
    return _dborch.scheduleDbFollowUps(this, ip, slot, trackId, playerNum, trackType, artworkId);
  }

  // ── dbserver field builders ────
  // dbserver protocol helpers → pdjl/dbserver.js (Phase 4.11)
  _dbNum1(v){ return _DB.dbNum1(v); }
  _dbNum2(v){ return _DB.dbNum2(v); }
  _dbNum4(v){ return _DB.dbNum4(v); }
  _dbBinary(buf){ return _DB.dbBinary(buf); }
  _dbStr(str){ return _DB.dbStr(str); }
  _dbArg4(v){ return _DB.dbArg4(v); }
  _dbRMST(reqPlayer, menu, slot, trackType){ return _DB.dbRMST(reqPlayer, menu, slot, trackType); }
  _dbBuildMsg(txId, type, args){ return _DB.dbBuildMsg(txId, type, args); }

  // TCP session pool → bridge/dbserver-pool.js (Phase 5.3b). 1줄 wrapper.
  _dbCleanupSessions(){ this._dbPool.cleanup(); }
  async _dbAcquire(ip, spoofPlayer){ return this._dbPool.acquire(ip, spoofPlayer); }

  // socket I/O → pdjl/dbserver-io.js, parser → pdjl/dbserver.js (Phase 5.3a).
  _dbReadResponse(sock){ return _DBIO.dbReadResponse(sock); }
  _dbReadFullResponse(sock, idleMs=300){ return _DBIO.dbReadFullResponse(sock, idleMs); }
  _dbReadField(buf, pos){ return _DB.dbReadField(buf, pos); }
  _dbParseItems(buf){ return _DB.dbParseItems(buf); }

  // dbserver client 메서드 (Phase 5.3c) — 본문 → bridge/dbserver-client.js
  async _dbserverMetadata(ip, slot, trackId, playerNum, trackType=1){ return _dbcli.dbserverMetadata(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverWaveform(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverWaveform(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverWaveformDetail(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverWaveformDetail(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverWaveformNxs2(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverWaveformNxs2(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverCuePoints(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverCuePoints(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverCuePointsExt(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverCuePointsExt(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverCuePointsNxs2(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverCuePointsNxs2(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverCuePointsStd(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverCuePointsStd(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverBeatGrid(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverBeatGrid(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverSongStructure(ip, slot, trackId, playerNum, trackType){ return _dbcli.dbserverSongStructure(this, ip, slot, trackId, playerNum, trackType); }
  async _dbserverArtwork(ip, slot, artworkId, playerNum, cacheKey){ return _dbcli.dbserverArtwork(this, ip, slot, artworkId, playerNum, cacheKey); }
  _phraseKindMeta(hiMood, kind){ return _dbcli.phraseKindMeta(hiMood, kind); }
}

module.exports = {
  BridgeCore, getAllInterfaces, interfaceSignature, sanitizeInterfaceSelection,
  mkOptIn, mkStatus, mkTime, mkAppResp, mkMetadataResp,
  mkDataMetrics, mkDataMeta, mkNotification, mkLowResArtwork,
  parsePDJL, pdjlBridgeAnnounceId, pdjlIdentityByteFromMac,
  buildPdjlBridgeHelloPacket, buildPdjlBridgeClaimPacket, buildPdjlBridgeKeepalivePacket,
  buildDjmSubscribePacket, buildBridgeNotifyPacket, buildDbServerKeepalivePacket,
  TC, PDJL, STATE, P1_TO_STATE, P1_NAME,
};
