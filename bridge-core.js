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

// ─────────────────────────────────────────────
// TCNet 상수
// ─────────────────────────────────────────────
const TC = {
  MAGIC : Buffer.from('TCN'),
  VER   : Buffer.from([0x03, 0x05]),  // TCNet V3.5 wire version used by Arena
  OPTIN : 0x02, OPTOUT: 0x03, STATUS: 0x05,
  DATA  : 0xC8, TIME  : 0xFE,  APP   : 0x1E,
  ARTWORK: 0xCC, // MessageType 204 = LowResArtwork (JPEG)
  NOTIFY: 0x0D,
  P_BC  : 60000, P_TIME: 60001, P_DATA: 60002,
  NID   : Buffer.from([Math.floor(Math.random()*256), 0xFE]), // random per instance
  NNAME : 'Bridge01',
  NTYPE : 0x02,   // 0x02 = Server (Arena = 0x04 = Client)
  NOPTS : Buffer.from([0x07, 0x00]),
  VENDOR: 'BRIDGE+', DEVICE: 'BRIDGE+',
  APPV  : { ma:1, mi:1, bug:67 },
  H     : 24,
  SZ_OI : 68, SZ_ST: 300, SZ_TM: 162,
  SZ_DT_METRICS: 122, SZ_DT_META: 548,
  LPORT : 0,  // dynamically assigned each run
  DT_METRICS: 0x02,  // MetricsData: fader, gain, pitch, BPM, status per layer
  DT_META:    0x04,  // MetaData: track name, artist, waveform, artwork per layer
  DT_ARTWORK: 0x80,  // LowResArtworkFile (128) — JPEG artwork per layer
  DT_MIXER:   0x96,  // MixerData (150) — per-channel fader/EQ/VU + master
};

// TCNet V3.5.1B LayerStatus values — these ARE the protocol values, send directly
// ROLLBACK: was using toTCNetState() that collapsed CUEDOWN(7)/PLATTERDOWN(8) to 2(Paused)
const STATE = { IDLE:0, PLAYING:3, LOOPING:4, PAUSED:5, STOPPED:6, CUEDOWN:7, PLATTERDOWN:8, FFWD:9, FFRV:10, HOLD:11 };
// Identity function — STATE values are already TCNet protocol values
function toTCNetState(s){ return s || 0; }

// Pro DJ Link P1 (0x7B) → TCNet LayerStatus 매핑
// TCNet V3.5.1B: 0=IDLE,3=PLAYING,4=LOOPING,5=PAUSED,6=STOPPED,7=CUE,8=PLATTER,9=FFWD,10=FFRV,11=HOLD
const P1_TO_STATE = {
  0x00: STATE.IDLE,          // Empty — 트랙 없음
  0x02: STATE.STOPPED,       // Loading — 트랙 로딩 중
  0x03: STATE.PLAYING,       // Playing — 재생
  0x04: STATE.LOOPING,       // Looping — 루프 재생
  0x05: STATE.PAUSED,        // Paused — 일시정지
  0x06: STATE.CUEDOWN,       // Cued — 큐 포인트에서 정지 (큐 버튼 홀드)
  // ROLLBACK: 0x07 was PLAYING — 큐 탐색 중 (재생 아님)
  0x07: STATE.CUEDOWN,       // Cuing — 큐 포인트 탐색
  0x08: STATE.PLATTERDOWN,   // PlatterHeld — 플래터 누름 (바이닐 모드)
  // ROLLBACK: 0x09 was PAUSED — TCNet에 FFWD(9) 상태 존재
  0x09: STATE.FFWD,          // Searching — 탐색 (빨리감기/되감기)
  0x0D: STATE.STOPPED,       // End — 트랙 끝 (루프 없이)
  // ROLLBACK: 0x0E was STOPPED — TCNet에 HOLD(11) 상태 존재
  0x0E: STATE.HOLD,          // SpunDown — 플래터 감속 정지 (홀드)
  // ROLLBACK: 0x11 was PLAYING — 트랙 끝
  0x11: STATE.STOPPED,       // Ended — 트랙 종료
  0x12: STATE.LOOPING,       // Emergency Loop — 긴급 루프
  0x13: STATE.PLATTERDOWN,   // Vinyl Scratch — 재생 중 플래터 터치
};
const P1_NAME = {
  0x00:'no track',0x02:'loading',0x03:'playing',0x04:'loop',
  0x05:'paused',0x06:'cued',0x07:'cuing',0x08:'platter held',
  0x09:'searching',0x0D:'end of track',0x0E:'spun down',0x11:'ended',
  0x12:'emergency loop',0x13:'vinyl scratch',
};

const PDJL = {
  MAGIC: Buffer.from([0x51,0x73,0x70,0x74,0x31,0x57,0x6D,0x4A,0x4F,0x4C]),
  CDJ:0x0A, DJM:0x39, DJM2:0x29, ANN:0x06,
  CDJ_BEAT:0x28,   // CDJ beat packet (port 50002, 96B) — beat timing only
  CDJ_WF:0x56,     // CDJ waveform preview (port 50002, ~1420B)
  DJM_ONAIR:0x03,  // DJM Channels On-Air (port 50001, 45B)
  DJM_METER:0x58,  // DJM VU Metering (port 50001, 524B)
};

// pcap 확정 (관찰된 값들):
//   Windows Pioneer: 0xBD (2회 세션 모두)
//   Mac     Pioneer: 0xDA, 0xD3 (2회 세션 다름 — 가변인지 단일 값인지 불확정)
// 이전 동작 유지: Mac = 0xDA (과거 정상 동작 이력), Windows = 0xBD.
function pdjlBridgeAnnounceId(platform=process.platform){
  return platform==='darwin' ? 0xDA : 0xBD;
}

function pdjlIdentityByteFromMac(mac, platform=process.platform){
  return pdjlBridgeAnnounceId(platform);
}

function buildPdjlBridgeHelloPacket(deviceId=5){
  const p=Buffer.alloc(37);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x0A;
  p[0x0B]=0x00;
  Buffer.from('TCS-SHOWKONTROL','ascii').copy(p,0x0C,0,15);
  p[0x20]=0x01;
  p[0x21]=0x01;
  p[0x22]=0x00;
  p[0x23]=0x25;
  p[0x24]=deviceId&0xFF;
  return p;
}

function buildPdjlBridgeClaimPacket(annIP, annMAC, seqN=1, deviceId=5, platform=process.platform){
  const cIP=String(annIP||'0.0.0.0').split('.').map(Number);
  const cMAC=String(annMAC||'00:00:00:00:00:00').split(':').map(h=>parseInt(h,16));
  const p=Buffer.alloc(50);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x02;
  p[0x0B]=0x00;
  Buffer.from('TCS-SHOWKONTROL','ascii').copy(p,0x0C,0,15);
  p[0x20]=0x01;
  p[0x21]=0x01;
  p[0x22]=0x00;
  p[0x23]=0x32;
  for(let i=0;i<4;i++) p[0x24+i]=cIP[i]||0;
  for(let i=0;i<6;i++) p[0x28+i]=cMAC[i]||0;
  // pcap 확정: Pioneer 공식 브릿지 claim byte 0x2E checksum
  //   MAC[5] XOR (0x57 + seqN)
  //   예: MAC[5]=0xB2, seqN=1 → 0xB2^0x58 = 0xEA (win-bridge.pcapng 일치)
  p[0x2E]=((cMAC[5]||0) ^ ((0x57 + seqN) & 0xFF)) & 0xFF;
  p[0x2F]=seqN&0xFF;
  // pcap 확정: Pioneer 공식 브릿지 claim byte 0x30 = deviceId (양쪽 동일)
  //   Mac    (ceo_2): 0x05
  //   Windows (fullcap4): 0x05
  p[0x30]=deviceId&0xFF;
  p[0x31]=0x00;
  return p;
}

function buildPdjlBridgeKeepalivePacket(annIP, annMAC, deviceId=5, platform=process.platform){
  const aIP=String(annIP||'0.0.0.0').split('.').map(Number);
  const aMAC=String(annMAC||'00:00:00:00:00:00').split(':').map(h=>parseInt(h,16));
  const p=Buffer.alloc(54);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x06;
  p[0x0B]=0x00;
  Buffer.from('TCS-SHOWKONTROL','ascii').copy(p,0x0C,0,15);
  p[0x20]=0x01;
  p[0x21]=0x01;
  p[0x22]=0x00;
  p[0x23]=0x36;
  p[0x24]=pdjlIdentityByteFromMac(annMAC, platform);
  p[0x25]=0x00;
  for(let i=0;i<6;i++) p[0x26+i]=aMAC[i]||0;
  for(let i=0;i<4;i++) p[0x2C+i]=aIP[i]||0;
  // pcap 확정: Pioneer 공식 브릿지 keepalive byte 0x30
  //   Mac    (ceo_2):    0x07
  //   Windows (fullcap4): 0x08
  p[0x30]=platform==='darwin' ? 0x07 : 0x08;
  p[0x34]=deviceId&0xFF;
  p[0x35]=0x20;
  return p;
}

function buildDjmSubscribePacket(platform=process.platform){
  const p=Buffer.alloc(40);
  PDJL.MAGIC.copy(p,0);
  p[10]=0x57;
  Buffer.from('TCS-SHOWKONTROL','ascii').copy(p,11,0,15);
  p[31]=0x01;
  p[32]=0x00;
  // pcap 확정: Pioneer 공식 브릿지 0x57 subscribe byte 33 bitmask
  //   Mac    (ceo_2):    0xE1 (fader + VU + onair)
  //   Windows (fullcap4): 0xFF (전체 subscribe)
  p[33]=platform==='darwin' ? 0xE1 : 0xFF;
  p[34]=0x00;
  p[35]=0x04;
  p[36]=0x01;
  return p;
}

function buildDbServerKeepalivePacket(annIP, annMAC, deviceId=5, platform=process.platform){
  const aIP=String(annIP||'0.0.0.0').split('.').map(Number);
  const aMAC=String(annMAC||'00:00:00:00:00:00').split(':').map(h=>parseInt(h,16));
  const p=Buffer.alloc(95);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x06;
  const bridgeName = platform==='win32' ? 'BRIDGE+' : 'TCS-SHOWKONTROL';
  Buffer.from(bridgeName,'ascii').copy(p,0x0C,0,Math.min(bridgeName.length, 20));
  p[0x20]=0x01;
  p[0x21]=0x01;
  p[0x23]=0x36;
  p[0x24]=deviceId&0xFF;
  for(let i=0;i<6;i++) p[0x26+i]=aMAC[i]||0;
  for(let i=0;i<4;i++) p[0x2C+i]=aIP[i]||0;
  p[0x35]=0x64;
  Buffer.from('PIONEER DJ CORP','ascii').copy(p,54,0,15);
  Buffer.from('PRODJLINK BRIDGE','ascii').copy(p,74,0,16);
  p[94]=0x43;
  return p;
}

function buildBridgeNotifyPacket(deviceId=5){
  const p=Buffer.alloc(44);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x55;
  Buffer.from('TCS-SHOWKONTROL','ascii').copy(p,0x0B,0,15);
  p[31]=0x01;
  p[32]=0x00;
  p[33]=0x8B;
  p[34]=0x08;
  p[39]=0x01;
  p[40]=deviceId&0xFF;
  p[41]=0x01;
  p[42]=0x03;
  p[43]=0x01;
  return p;
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────
let _seq = 0;
const u32 = n => (Math.max(0,n)&0xFFFFFFFF)>>>0;
const clamp8 = n => Math.max(0,Math.min(255,Math.round(n)))&0xFF;

// UTF-32LE writer
function _writeUtf32LE(buf, offset, str, maxChars){
  for(let i=0;i<str.length&&i<maxChars;i++){
    const cp=str.codePointAt(i);
    const off=offset+i*4;
    buf[off]  = cp&0xFF;
    buf[off+1]=(cp>>8)&0xFF;
    buf[off+2]=(cp>>16)&0xFF;
    buf[off+3]=(cp>>24)&0xFF;
    if(cp>0xFFFF) i++; // surrogate pair
  }
}

function buildHdr(type){
  const b = Buffer.alloc(TC.H);
  TC.NID.copy(b,0); TC.VER.copy(b,2); TC.MAGIC.copy(b,4);
  b[7] = type;
  b.write(TC.NNAME.padEnd(8,'\0'), 8, 8, 'ascii');
  b[16] = (_seq++)&0xFF; b[17] = TC.NTYPE; TC.NOPTS.copy(b,18);
  const hr = process.hrtime();
  b.writeUInt32LE(u32(hr[0]*1e6+Math.floor(hr[1]/1000)), 20);
  return b;
}

// macOS: map device name (en0) → hardware port name (Wi-Fi) via networksetup
let _hwPortMap = null;
function _getHWPortMap(){
  if(_hwPortMap) return _hwPortMap;
  _hwPortMap = {};
  if(process.platform !== 'darwin') return _hwPortMap;
  try{
    const out = require('child_process').execSync('networksetup -listallhardwareports 2>/dev/null',{encoding:'utf8',timeout:3000});
    const blocks = out.split('Hardware Port:').slice(1);
    for(const block of blocks){
      const lines = block.trim().split('\n');
      const port = lines[0].trim();
      const devMatch = lines.find(l=>l.startsWith('Device:'));
      if(devMatch){
        const dev = devMatch.replace('Device:','').trim();
        _hwPortMap[dev] = port;
      }
    }
  }catch(_){}
  return _hwPortMap;
}

function getAllInterfaces(){
  const result = [];
  const hwMap = _getHWPortMap();
  result.push({name:'lo0 (localhost)',address:'127.0.0.1',netmask:'255.0.0.0',broadcast:'127.255.255.255',mac:'00:00:00:00:00:00',internal:true,isLoopback:true,hwPort:'Loopback'});
  for(const [name,addrs] of Object.entries(os.networkInterfaces()))
    for(const a of addrs)
      if(a.family==='IPv4'){
        const ip=a.address.split('.').map(Number), mask=a.netmask.split('.').map(Number);
        const bc=ip.map((o,i)=>o|(~mask[i]&255)).join('.');
        const hwPort = hwMap[name] || name;
        result.push({name,address:a.address,netmask:a.netmask,broadcast:bc,mac:a.mac,internal:a.internal,isLoopback:a.internal,hwPort});
      }
  return result;
}

function interfaceSignature(ifaces){
  return (ifaces||[])
    .map(i=>`${i.name}|${i.address}|${i.netmask}`)
    .sort()
    .join(';');
}

function sanitizeInterfaceSelection(selected, ifaces){
  if(!selected || selected==='auto' || selected==='0.0.0.0') return null;
  if(selected==='127.0.0.1') return '127.0.0.1';
  return (ifaces||[]).some(i=>i.address===selected) ? selected : null;
}

function detectBroadcastFor(bindAddr){
  if(!bindAddr||bindAddr==='auto'||bindAddr==='0.0.0.0'){
    for(const iface of getAllInterfaces())
      if(!iface.internal && iface.address!=='127.0.0.1') return iface.broadcast;
    return '255.255.255.255';
  }
  if(bindAddr==='127.0.0.1') return '127.0.0.1';
  for(const iface of getAllInterfaces())
    if(iface.address===bindAddr) return iface.broadcast;
  return '255.255.255.255';
}

function pdjlBroadcastTargets(bindAddr){
  const iface = getAllInterfaces().find(i=>!i.internal && i.address===bindAddr && i.broadcast && i.broadcast!=='127.255.255.255');
  if(iface) return [iface.broadcast];
  return [...new Set(
    getAllInterfaces()
      .filter(i=>!i.internal && i.broadcast && i.broadcast!=='127.255.255.255')
      .map(i=>i.broadcast)
  )];
}

function hasPDJLMagic(msg){
  if(!msg || msg.length < PDJL.MAGIC.length) return false;
  for(let i=0;i<PDJL.MAGIC.length;i++) if(msg[i]!==PDJL.MAGIC[i]) return false;
  return true;
}

function readPDJLNameField(msg){
  if(!msg || msg.length <= 0x0B) return '';
  const end = Math.min(0x1B, msg.length);
  if(end <= 0x0B) return '';
  return msg.slice(0x0B, end).toString('ascii').replace(/\0/g,'').trim();
}

// ─────────────────────────────────────────────
// TCNet 패킷 빌더
// ─────────────────────────────────────────────

/**
 * OptIn (0x02) — 68B
 */
function mkOptIn(port, uptime, nc){
  const b = Buffer.alloc(TC.SZ_OI);
  buildHdr(TC.OPTIN).copy(b,0);
  const d = b.slice(24);
  d.writeUInt16LE(nc||2, 0);           // body[0-1]: nodeCount
  d.writeUInt16LE(port||0, 2);  // body[2-3]: listenerPort
  d.writeUInt16LE(uptime||0, 4);       // body[4-5]: uptime seconds
  d.writeUInt16LE(0, 6);               // body[6-7]: padding
  d.write(TC.VENDOR.padEnd(16,'\0'), 8, 16, 'ascii');   // body[8-23]: vendor
  d.write(TC.DEVICE.padEnd(16,'\0'), 24, 16, 'ascii');  // body[24-39]: device
  d[40]=TC.APPV.ma; d[41]=TC.APPV.mi; d[42]=TC.APPV.bug; // body[40-42]: version
  d[43]=0;  // body[43]: padding
  return b;
}

/**
 * Status (0x05) — 300B
 *
 * body layout:
 *   body[0-1]    = nodeCount (LE u16)
 *   body[2-3]    = nodeListenerPort (LE u16)
 *   body[10+n]   = layerSource[n] (n=0-7)
 *   body[18+n]   = layerStatus[n] (n=0-7)
 *   body[26+n*4] = trackID[n] (LE u32, n=0-7)
 *   body[59]     = smpteMode
 *   body[148+n*16]= layerName[n] (16B ASCII, n=0-7)
 */
function mkStatus(port, devices, layers, faders, hwMode){
  const b = Buffer.alloc(TC.SZ_ST);
  buildHdr(TC.STATUS).copy(b,0);
  const d = b.slice(24);  // body 276B

  // nodeCount = number of active layers OR hwMode slots (even if idle)
  let nc=0;
  for(let n=0;n<8;n++){
    if(layers&&layers[n]) nc++;
    else if(hwMode&&hwMode[n]) nc++;
  }
  d.writeUInt16LE(nc||1, 0);
  d.writeUInt16LE(port||0, 2);     // nodeListenerPort

  // layerSource[0-7] at body[10-17] — TCNet absolute byte 34..41
  for(let n=0;n<8;n++){
    const hasLayer = layers && layers[n];
    const isHW = hwMode && hwMode[n];
    d[10+n] = (hasLayer || isHW) ? (n+1) : 0;
  }

  // layerStatus[0-7] at body[18-25] — raw TCNetLayerStatus (0=IDLE,3=PLAYING,5=PAUSED,6=STOPPED)
  for(let n=0;n<8;n++){
    const layerData = layers && layers[n];
    d[18+n] = layerData ? toTCNetState(layerData.state||0) : 0;
  }

  // trackID[0-7] at body[26-57] (LE u32 × 8)
  for(let n=0;n<8;n++){
    const layerData = layers && layers[n];
    if(layerData && layerData.trackId){
      d.writeUInt32LE(layerData.trackId, 26+n*4);
    }
  }

  d[59] = 0x1E;  // smpteMode = 30fps
  d[60] = 0x00;  // autoMasterMode = 0

  // body[96-111]: device name
  d.write(TC.DEVICE.padEnd(16,'\0'), 96, 16, 'ascii');

  // layerName[0-7] at body[148-275] (16B ASCII × 8)
  // Official Bridge puts CDJ model name here, NOT track name
  for(let n=0;n<8;n++){
    const layerData = layers && layers[n];
    const name = layerData?.deviceName ? layerData.deviceName.slice(0,15) : '';
    if(name) d.write(name.padEnd(16,'\0'), 148+n*16, 16, 'ascii');
  }

  return b;
}

/**
 * TIME (0xFE) — 154B
 *
 * body layout:
 *   body[0+n*4]  = layerCurrentTime[n] (LE u32, n=0-7)
 *   body[32+n*4] = layerTotalTime[n]   (LE u32, n=0-7)
 *   body[64+n]   = layerBeatmarker[n]  (n=0-7)
 *   body[72+n]   = layerState[n]       (n=0-7)
 *   body[81]     = generalSMPTEMode
 *   body[82+n*6] = layerTimecode[n]    (6B: mode,state,h,m,s,frames, n=0-7)
 */
function mkTime(layers, uptimeMs, faders){
  const b = Buffer.alloc(TC.SZ_TM);
  buildHdr(TC.TIME).copy(b,0);
  const d = b.slice(24);  // body 138B

  // layerCurrentTime[0-7] at body[0-31] — interpolated from wall clock
  const now = Date.now();
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld){
      let ms = ld.timecodeMs || 0;
      // Interpolate: if playing/looping/searching, add elapsed time since last beat update (pitch-corrected)
      const isActive = ld.state === STATE.PLAYING || ld.state === STATE.LOOPING
        || ld.state === STATE.FFWD || ld.state === STATE.FFRV;
      if(isActive && ld._updateTime){
        const pitch = ld._pitch || 0;
        ms += (now - ld._updateTime) * (1 + pitch / 100);
      }
      d.writeUInt32LE(u32(ms), n*4);
    }
  }

  // layerTotalTime[0-7] at body[32-63]
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld) d.writeUInt32LE(u32(ld.totalLength||0), 32+n*4);
  }

  // layerBeatmarker[0-7] at body[64-71]
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld) d[64+n] = ld.beatPhase || 0;
  }

  // layerState[0-7] at body[72-79] — TCNet state (0=Idle,1=Playing,2=Paused,3=Stopped)
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld) d[72+n] = toTCNetState(ld.state||0);
  }

  // generalSMPTEMode at body[81] — 30fps
  d[81] = 30;

  // layerTimecode[0-7] at body[82-129] (6B each: mode, state, h, m, s, frames)
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld){
      let ms = ld.timecodeMs || 0;
      const isPlaying = ld.state === STATE.PLAYING || ld.state === STATE.LOOPING;
      if(isPlaying && ld._updateTime) ms += (now - ld._updateTime);
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const frames = Math.floor((ms % 1000) / 33.33);  // ~30fps
      const off = 82 + n*6;
      d[off+0] = 30;     // layer SMPTE mode = 30fps
      // TC state: 0=Stopped, 1=Running, 2=Force Re-sync (재생→정지 전환 시 1회 Arena 강제 seek)
      const tcState = isPlaying ? 1 : (ld._needResync ? 2 : 0);
      if(ld._needResync) ld._needResync = false;  // 1회만 전송
      d[off+1] = tcState;
      d[off+2] = h;
      d[off+3] = m;
      d[off+4] = s;
      d[off+5] = frames;
    }
  }

  // layerOnAir[0-7] at body[130-137] — fader position 0-255
  for(let n=0;n<8;n++){
    d[130+n] = faders?.[n] || 0;
  }

  return b;
}

function mkAppResp(lPort){
  const b = Buffer.alloc(62);
  buildHdr(TC.APP).copy(b,0);
  const d = b.slice(24);
  d[0]=0xFF; d[1]=0xFF; d[2]=0x14; d[3]=0;
  d.writeUInt32LE(1,4); d.writeUInt32LE(1,8);
  d.writeUInt16LE(lPort||0, 20);
  return b;
}

/**
 * MetadataResponse (0x14) — reply to Arena's MetadataRequest
 */
function mkMetadataResp(layer, reqType, layerData){
  const trackName  = layerData?.trackName  || '';
  const artistName = layerData?.artistName || '';
  const dataLen = 2 + 2 + trackName.length + 2 + artistName.length + 16;  // padding
  const totalLen = TC.H + dataLen;
  const b = Buffer.alloc(totalLen);
  buildHdr(0x14).copy(b,0);  // type 0x14 = MetadataResponse
  const d = b.slice(TC.H);
  d[0] = layer;     // layerIndex
  d[1] = reqType;   // responseType (echo back)
  // Simple metadata: track name + artist name as null-terminated strings
  let off = 2;
  d.writeUInt16LE(trackName.length, off); off+=2;
  if(trackName.length > 0){ d.write(trackName, off, trackName.length, 'utf8'); off += trackName.length; }
  d.writeUInt16LE(artistName.length, off); off+=2;
  if(artistName.length > 0){ d.write(artistName, off, artistName.length, 'utf8'); off += artistName.length; }
  return b;
}

/**
 * DATA MetricsData (0xC8, sub-type 0x02) — 122B
 * Per-layer: fader, gain, pitch, BPM, status, beat info
 */
function mkDataMetrics(layerIdx, layerData, faderVal){
  const b = Buffer.alloc(TC.SZ_DT_METRICS);
  buildHdr(TC.DATA).copy(b, 0);
  const d = b.slice(TC.H);  // body 98B

  d[0] = TC.DT_METRICS;  // sub-type 0x02
  d[1] = layerIdx;        // 1-based layer index

  if(layerData){
    // TCNet offsets (body-relative, subtract 24 from absolute byte index)
    d[3] = toTCNetState(layerData.state||0);   // byte 27: Layer State (TCNet: 0=Idle,1=Playing,2=Paused,3=Stopped)
    d[5] = 0x01;                 // byte 29: Sync Master (1=Master)
    d[7] = layerData.beatPhase || 0; // byte 31: Beat Marker (0-4)
    d.writeUInt32LE(layerData.totalLength || 0, 8);   // byte 32: Track Length (ms)
    let curMs = layerData.timecodeMs || 0;
    const isPlaying = layerData.state === STATE.PLAYING || layerData.state === STATE.LOOPING;
    if(isPlaying && layerData._updateTime) curMs += (Date.now() - layerData._updateTime);
    d.writeUInt32LE(u32(curMs), 12);    // byte 36: Current Position (ms)
    // byte 40: Speed — 32768=100%, 0=0%, 65536=200%
    const pitch = layerData._pitch || 0;
    const speedVal = isPlaying ? Math.round(32768 * (1 + pitch / 100)) : 0;
    d.writeUInt32LE(u32(Math.max(0, Math.min(65536, speedVal))), 16);
    d.writeUInt32LE(0, 33);              // byte 57: Beat Number
    const bpm = layerData.bpm || 0;
    d.writeUInt32LE(u32(Math.round(bpm * 100)), 88);  // byte 112: BPM ×100
    // byte 116: Pitch Bend — 32768=100%, scale from pitch%
    const pbVal = Math.round(32768 * (1 + pitch / 100));
    d.writeUInt16LE(Math.max(0, Math.min(65535, pbVal)), 92);
    d.writeUInt32LE(layerData.trackId || 0, 94);  // byte 118: Track ID
    // Debug first MetricsData per layer
    if(!mkDataMetrics._dbg) mkDataMetrics._dbg={};
    if(!mkDataMetrics._dbg[layerIdx]){
      mkDataMetrics._dbg[layerIdx]=true;
      // [METRICS] muted
    }
  }

  return b;
}

/**
 * DATA MixerData (0xC8, sub-type 150) — 270B
 * TCNet MixerData packet: per-channel fader, EQ, filter, crossfader, master
 */
function mkMixerData(faders, mixerName, mixer){
  const b = Buffer.alloc(270);
  buildHdr(TC.DATA).copy(b, 0);
  const d = b.slice(TC.H);  // body 246B

  d[0] = 150;  // DataType = Mixer Data
  d[1] = 1;    // Mixer ID
  d[2] = 0;    // Mixer Type
  // Mixer Name at body offset 5 (byte 29), 16 chars
  const nm = (mixerName || 'DJM-900NXS2').padEnd(16, '\0');
  Buffer.from(nm, 'ascii').copy(d, 5, 0, 16);
  // Master Audio Level — use real DJM masterLvl if available
  d[37] = mixer?.masterLvl != null ? mixer.masterLvl : 255;
  // Master Fader Level
  d[38] = mixer?.masterLvl != null ? mixer.masterLvl : 255;
  // Cross Fader — real xfader value (0=A, 128=center, 255=B)
  d[75] = mixer?.xfader != null ? mixer.xfader : 127;
  // Per-channel data: each channel block starts at body offset 101 + (ch * 24)
  for(let ch=0; ch<4; ch++){
    const off = 101 + ch * 24;
    d[off]   = ch + 1;                                  // Source Select (1-4)
    d[off+1] = faders?.[ch] != null ? faders[ch] : 0;  // Audio Level (fader 0-255)
    d[off+2] = faders?.[ch] != null ? faders[ch] : 0;  // Fader Level
    // TCNet V3.5 channel block: source, audio, fader, trim, comp, hi, mid,
    // lo-mid, low, color/send/cue placeholders, xf assign.
    d[off+3]  = mixer?.eq?.[ch]?.[0] != null ? mixer.eq[ch][0] : 200;  // TRIM
    d[off+4]  = 0;                                                       // COMP / reserved
    d[off+5]  = mixer?.eq?.[ch]?.[1] != null ? mixer.eq[ch][1] : 128;   // HI
    d[off+6]  = mixer?.eq?.[ch]?.[2] != null ? mixer.eq[ch][2] : 128;   // MID
    d[off+7]  = 0;                                                       // LO-MID / reserved
    d[off+8]  = mixer?.eq?.[ch]?.[3] != null ? mixer.eq[ch][3] : 128;   // LOW
    d[off+13] = mixer?.xfAssign?.[ch] != null ? mixer.xfAssign[ch] : 0; // XF Assign
  }
  return b;
}

/**
 * DATA MetaData (0xC8, sub-type 0x04) — 548B
 * Per-layer: track name, artist name, key, trackID
 */
function mkDataMeta(layerIdx, layerData){
  const b = Buffer.alloc(TC.SZ_DT_META);
  buildHdr(TC.DATA).copy(b, 0);
  const d = b.slice(TC.H);  // body 524B

  d[0] = TC.DT_META;  // sub-type 0x04
  d[1] = layerIdx;     // 1-based layer index

  if(layerData){
    // Official Bridge uses UTF-32LE (4 bytes/char, 64 chars max = 256 bytes)
    const artist = layerData.artistName || '';
    if(artist) _writeUtf32LE(d, 5, artist, 64);

    const track = layerData.trackName || '';
    if(track) _writeUtf32LE(d, 261, track, 64);

    d.writeUInt16LE(0, 517);  // trackKey
    d.writeUInt32LE(layerData.trackId || 0, 519);
  }

  return b;
}

/**
 * Notification (0x0D) — 30B
 */
function mkNotification(){
  const b = Buffer.alloc(30);
  buildHdr(TC.NOTIFY).copy(b, 0);
  const d = b.slice(TC.H);
  d[0]=0xFF; d[1]=0xFF; d[2]=0xFF; d[3]=0x00; d[4]=0x1E; d[5]=0x00;
  return b;
}

/**
 * LowResArtwork (MessageType 0xCC = 204)
 * TCNet File Data Packet - Low Res Artwork File
 * header(24B) + dataType(1B) + layerID(1B) + dataSize(4B LE) +
 * totalPackets(4B LE) + packetNo(4B LE) + dataClusterSize(4B LE) + JPEG data
 * Standard Data Cluster Size = 4800, Max payload per packet = 4842
 */
function mkLowResArtwork(layerIdx, jpegBuf){
  const CLUSTER_SIZE = 4800;  // TCNet standard Data Cluster Size
  const totalPackets = Math.ceil(jpegBuf.length / CLUSTER_SIZE);
  const packets = [];

  for(let i = 0; i < totalPackets; i++){
    const chunkStart = i * CLUSTER_SIZE;
    const chunk = jpegBuf.slice(chunkStart, chunkStart + CLUSTER_SIZE);
    // header(24) + dataType(1) + layerID(1) + dataSize(4) + totalPackets(4) + packetNo(4) + clusterSize(4) + data
    const b = Buffer.alloc(TC.H + 18 + chunk.length);
    buildHdr(TC.ARTWORK).copy(b, 0);  // Type 204 (0xCC) — TCNet File Data File Packet
    b[TC.H]     = TC.DT_ARTWORK;     // DataType 128 = Low Res Artwork File
    b[TC.H + 1] = layerIdx;          // 1-8 layer number
    b.writeUInt32LE(jpegBuf.length, TC.H + 2);   // total Data Size
    b.writeUInt32LE(totalPackets,   TC.H + 6);   // Total Packets
    b.writeUInt32LE(i,              TC.H + 10);  // Packet No
    b.writeUInt32LE(CLUSTER_SIZE,   TC.H + 14);  // Data Cluster Size = 4800
    chunk.copy(b, TC.H + 18);
    packets.push(b);
  }
  return packets;
}

// ─────────────────────────────────────────────
// Pro DJ Link parser
// ─────────────────────────────────────────────
function parsePDJL(msg){
  if(msg.length<11) return null;
  const hasMagic = hasPDJLMagic(msg);
  const type = msg[10];
  const name = readPDJLNameField(msg);
  const isKnownDjmShape =
    (type===PDJL.DJM && msg.length>=0x80) ||
    (type===PDJL.DJM2 && msg.length>=0x24) ||
    (type===PDJL.DJM_ONAIR && msg.length>=0x2C) ||
    (type===PDJL.DJM_METER && msg.length>=0x180);
  if(!hasMagic && !isKnownDjmShape) return null;

  if(type===PDJL.CDJ && msg.length>=0x90){
    // Device number: CDJ-2000NXS2 uses 0x21, CDJ-3000 uses 0x24
    let pNum = msg[0x21]; if(pNum<1||pNum>6) pNum = msg[0x24];
    if(pNum<1||pNum>6) return null;
    // Model detection — use full model name to avoid false-positives (e.g. future CDJ-3000NXS2)
    const isNXS2 = name.includes('2000NXS2');
    const p1   = msg[0x7B];
    const state= P1_TO_STATE[p1] ?? STATE.IDLE;
    // BPM: uint16BE at 0x92–0x93 = TRACK BPM (original, no pitch) × 100
    const bpmRaw16 = msg.length>0x93 ? msg.readUInt16BE(0x92) : 0;
    const trackBpm = (bpmRaw16>0 && bpmRaw16!==0xFFFF) ? bpmRaw16/100 : 0;
    // Fader pitch: 3 bytes uint24 at 0x8D, neutral=0x100000, range 0~0x200000 (-100%~+100%)
    const pitchRaw = msg.length>0x8F ? (msg[0x8D]*65536 + msg[0x8E]*256 + msg[0x8F]) : 0x100000;
    const pitch = (pitchRaw-0x100000)/0x100000*100;
    // Effective pitch (includes jog wheel nudge) — model-specific:
    // CDJ-2000NXS2: offset 0x99 (3B) is reliable (jog nudge), fallback to 0x8D if zero
    // CDJ-3000: offset 0x99 is 0x000000 in cued/paused state → always use fader pitch 0x8D
    const v99 = isNXS2 && msg.length>0x9B ? (msg[0x99]*65536 + msg[0x9A]*256 + msg[0x9B]) : 0;
    const effPitchRaw = isNXS2
      ? (v99 || pitchRaw)  // NXS2: 0x99 includes jog nudge
      : pitchRaw;          // CDJ-3000: fader pitch only
    const effPitch = (effPitchRaw-0x100000)/0x100000*100;
    // Effective BPM: trackBpm × (1 + effPitch/100)
    let bpmEff = trackBpm>0 ? Math.round(trackBpm*(1+effPitch/100)*100)/100 : 0;
    if(bpmEff > 500) bpmEff = 0;
    const baseBpm = trackBpm;
    // beatNum at 0xA0 is reliable on CDJ-3000; on CDJ-2000NXS2 the same offset
    // may hold unrelated float data (e.g. 0x40000000 = 2.0f raw) yielding
    // nonsense beat counts like 1073741824. Sanity-clamp: realistic tracks
    // rarely exceed 10k beats (~40min @ 250BPM). Anything beyond is garbage.
    const BEAT_MAX = 65535;
    const _beatNumRaw = msg.length>0xA3 ? msg.readUInt32BE(0xA0) : 0;
    const beatNum   = _beatNumRaw <= BEAT_MAX ? _beatNumRaw : 0;
    const beatInBar = msg.length>0xA6 ? msg[0xA6] : 0;
    const barsRemain = msg.length>0xA5 ? msg.readUInt16BE(0xA4) : 0;
    const _trackBeatsRaw = msg.length>0xB7 ? msg.readUInt32BE(0xB4) : 0;
    const trackBeats = _trackBeatsRaw <= BEAT_MAX ? _trackBeatsRaw : 0;
    // Playback position fraction 0x48-0x4B: uint32BE / 1000 = 0.0~1.0
    // Available on CDJ-2000NXS2 and CDJ-3000 — gives absolute position for any track including BPM-less
    const posFracRaw = msg.length>0x4B ? msg.readUInt32BE(0x48) : 0;
    // Do not synthesize a fraction from beatNum/trackBeats on NXS2: 0xB4 is not a
    // reliable total-duration field here, and it creates timeline drift/jumps.
    const positionFraction = (posFracRaw>0 && posFracRaw<=1000) ? posFracRaw/1000 : 0;
    // Flags byte F at 0x89:
    //   bit 6 = playing, bit 5 = master, bit 4 = sync, bit 3 = on-air
    const flags = msg.length>0x89 ? msg[0x89] : 0;
    const isSync   = !!(flags & 0x10);  // bit 4
    const isMaster = !!(flags & 0x20);  // bit 5
    const isOnAir  = !!(flags & 0x08);  // bit 3
    // Vinyl/CDJ jog mode at 0x9D (P3)
    const p3 = msg.length>0x9D ? msg[0x9D] : 0;
    const isVinylMode = (p3===0x09 || p3===0x0A); // forward/backward vinyl
    // Reverse detection: FFRV state or backward vinyl mode (p3=0x0A)
    const isReverse = state===STATE.FFRV || p3===0x0A;
    const pitchMultiplier = effPitchRaw / 0x100000;  // 1.0 = normal speed
    // Loop start/end from CDJ-3000 512B extended packet (not available on shorter packets)
    // Raw value × 65536 / 1000 = ms per ProDJLinkInput.h
    const loopStartRaw = msg.length>0x1C1 ? msg.readUInt32BE(0x1B6) : 0;
    const loopEndRaw   = msg.length>0x1C5 ? msg.readUInt32BE(0x1BE) : 0;
    const loopStartMs  = loopStartRaw > 0 ? Math.round(loopStartRaw / 65.536) : 0;
    const loopEndMs    = loopEndRaw   > 0 ? Math.round(loopEndRaw   / 65.536) : 0;
    return{
      kind:'cdj', playerNum:pNum, name, deviceName:name, p1, state,
      p1Name: P1_NAME[p1]||`0x${p1.toString(16)}`,
      isPlaying: state===STATE.PLAYING || state===STATE.FFWD || state===STATE.FFRV,
      isLooping: state===STATE.LOOPING,
      isReverse,
      loopStartMs, loopEndMs,
      bpm:bpmEff, bpmTrack:baseBpm, bpmEffective:bpmEff,
      pitch, effectivePitch:effPitch, pitchMultiplier,
      isNXS2,
      trackId: msg.readUInt32BE(0x2C),
      trackDeviceId: msg[0x28],
      slot:     msg[0x29],
      trackType: msg[0x2A],
      hasTrack: msg[0x29]>0,
      beatNum, beatInBar, barsRemain, trackBeats,
      firmware: msg.slice(0x7C,0x80).toString('ascii').replace(/\0/g,'').trim(),
      isOnAir, isMaster, isSync, isVinylMode,
      positionFraction, // 0.0-1.0 absolute playback position (0x48 field)
    };
  }
  // ── DJM Mixer Status ──
  // Type 0x29: flat 56-byte layout (DJM-2000NXS, legacy)
  // Type 0x39: block 248-byte layout (DJM-900NXS2, V10, A9)
  if(type===PDJL.DJM2 && msg.length>=0x24){
    // Type 0x29 — flat layout
    // rekordbox/NXS-GW 가 fake 0x29 브로드캐스트 → 쓰레기값 원천 차단
    if(/rekordbox|NXS-?GW|TCS-/i.test(name)) return null;
    // Faders at 0x0F-0x12 (0-0x7F), scale to 0-255
    const ch=[0,1,2,3].map(c=>{ const v=msg[0x0F+c]||0; return Math.min(255,Math.round(v*255/0x7F)); });
    const xfader=Math.min(255,Math.round((msg[0x13]||0)*255/0x7F));
    const masterLvl=Math.min(255,Math.round((msg[0x14]||0)*255/0x7F));
    const hpLevel=msg.length>0x15?Math.min(255,Math.round(msg[0x15]*255/0x7F)):0;
    const hpCueCh=msg.length>0x16?msg[0x16]:0;
    // EQ: 0x17+ch*3, [Hi,Mid,Lo] 0-0x7F → renderer 형식 [TRIM,HI,MID,LOW,COLOR] 0-255 center=128
    const eq=[0,1,2,3].map(c=>{
      const b=0x17+c*3;
      const hi  = b  <msg.length ? Math.min(255,msg[b  ]*2) : 128;
      const mid = b+1<msg.length ? Math.min(255,msg[b+1]*2) : 128;
      const lo  = b+2<msg.length ? Math.min(255,msg[b+2]*2) : 128;
      return[128, hi, mid, lo, 128]; // TRIM/COLOR neutral
    });
    if(!parsePDJL._djm29Logged){
      parsePDJL._djm29Logged=true;
      const hex=Array.from(msg.slice(0,Math.min(56,msg.length))).map(x=>x.toString(16).padStart(2,'0')).join(' ');
      try{console.log(`[DJM-0x29] name="${name}" len=${msg.length} hex=[${hex}]`);}catch(_){}
    }
    return{kind:'djm',name,channel:ch,eq,xfader,masterLvl,boothLvl:0,hpLevel,hpCueCh,chExtra:[]};
  }
  if(type===PDJL.DJM && msg.length>=0x80){
    // Rekordbox 가 생성하는 가짜 0x39 (가상 믹서 state) 차단
    // 실제 DJM은 "DJM-900NXS2", "DJM-V10", "DJM-A9" 등으로만 이름 시작
    if(/rekordbox|rbdj|NXS-?GW|TCS-|prolink/i.test(name)){
      if(!parsePDJL._fake39Logged){
        parsePDJL._fake39Logged=true;
        console.warn(`[DJM-0x39] 가짜 패킷 차단: name="${name}" len=${msg.length}`);
      }
      return null;
    }
    // Type 0x39 — 248-byte layout (DJM-900NXS2/A9/V10)
    // V10/A9 계열 추가 오프셋
    // Per-channel block (stride 0x18):
    //   +0 InputSource  +1 Trim  +2 Comp(V10)  +3 HI  +4 MID  +5 LoMid(V10)
    //   +6 LO  +7 Color  +8 Send(V10)  +9 CUE  +10 CueB(A9/V10)  +11 Fader  +12 XF Assign
    const isV10 = /V10/i.test(name);
    const numCh = isV10 ? 6 : 4;
    const CH_BASES = [0x024,0x03C,0x054,0x06C,0x084,0x09C];
    const readB = (o,dflt=0)=> o<msg.length ? msg[o] : dflt;
    const ch      = new Array(numCh).fill(0).map((_,c)=>readB(CH_BASES[c]+11,0));
    const cueBtn  = new Array(numCh).fill(0).map((_,c)=>readB(CH_BASES[c]+9,0));
    const cueBtnB = new Array(numCh).fill(0).map((_,c)=>readB(CH_BASES[c]+10,0));
    const xfAssign= new Array(numCh).fill(0).map((_,c)=>readB(CH_BASES[c]+12,0));
    // eq: [TRIM, HI, MID, LOW, COLOR] for display compatibility
    const eq = new Array(numCh).fill(0).map((_,c)=>{
      const b=CH_BASES[c];
      return [readB(b+1,128), readB(b+3,128), readB(b+4,128), readB(b+6,128), readB(b+7,128)];
    });
    // V10 extras per channel
    const chComp  = new Array(numCh).fill(0).map((_,c)=>readB(CH_BASES[c]+2,0));
    const chLoMid = new Array(numCh).fill(0).map((_,c)=>readB(CH_BASES[c]+5,128));
    const chSend  = new Array(numCh).fill(0).map((_,c)=>readB(CH_BASES[c]+8,0));
    const chInput = new Array(numCh).fill(0).map((_,c)=>readB(CH_BASES[c]+0,0));
    const chExtra = new Array(numCh).fill(0).map((_,c)=>({
      cue:cueBtn[c], cueB:cueBtnB[c], xfa:xfAssign[c],
      comp:chComp[c], loMid:chLoMid[c], send:chSend[c], input:chInput[c]
    }));
    // Global / Master (absolute offsets — same for 4ch & 6ch)
    const xfader      = readB(0x0B4,128);
    const faderCurve  = readB(0x0B5,1);
    const xfCurve     = readB(0x0B6,1);
    const masterLvl   = readB(0x0B7,128);
    const masterCue   = readB(0x0B9,0);
    const masterCueB  = readB(0x0BA,0);  // A9/V10
    const isolatorOn  = readB(0x0BB,0);  // A9/V10
    const isolatorHi  = readB(0x0BC,128);// V10
    const isolatorMid = readB(0x0BD,128);// V10
    const isolatorLo  = readB(0x0BE,128);// V10
    const boothLvl    = readB(0x0BF,0);
    const boothEqHi   = readB(0x0C0,128);// A9/V10
    const boothEqLo   = readB(0x0C1,128);// A9/V10
    // Headphones
    const hpCueLink   = readB(0x0C4,0);
    const hpCueLinkB  = readB(0x0C5,0);  // A9/V10
    const hpMixing    = readB(0x0E3,0);
    const hpLevel     = readB(0x0E4,0);
    const boothEqBtn  = readB(0x0E5,0);  // A9/V10
    const hpMixingB   = readB(0x0E6,0);  // A9/V10
    const hpLevelB    = readB(0x0E7,0);  // A9/V10
    // Beat FX
    const fxFreqLo    = readB(0x0C6,0);
    const fxFreqMid   = readB(0x0C7,0);
    const fxFreqHi    = readB(0x0C8,0);
    const beatFxSel   = readB(0x0C9,0);
    const beatFxAssign= readB(0x0CA,0);
    const beatFxLevel = readB(0x0CB,0);
    const beatFxOn    = readB(0x0CC,0);
    const multiIoSel  = readB(0x0CE,0);
    const sendReturn  = readB(0x0CF,0);
    // Mic
    const micEqHi     = readB(0x0D6,128);
    const micEqLo     = readB(0x0D7,128);
    // Filter (V10)
    const filterLPF   = readB(0x0D8,0);
    const filterHPF   = readB(0x0D9,0);
    const filterReso  = readB(0x0DA,0);
    // Color FX / Send ext
    const colorFxSel  = readB(0x0DB,255);
    const sendExt1    = readB(0x0DC,0);
    const sendExt2    = readB(0x0DD,0);
    const colorFxParam= readB(0x0E2,128);
    // Master Mix (V10 — shares 0x0E2 with ColorFxParam)
    const masterMixOn   = readB(0x0DE,0);
    const masterMixSize = readB(0x0DF,0);
    const masterMixTime = readB(0x0E0,0);
    const masterMixTone = readB(0x0E1,0);
    const masterMixLevel= readB(0x0E2,0);
    // Legacy aliases kept for backward compatibility with renderer
    const eqCurve = faderCurve; // historical name; actually fader curve
    const masterBalance = 128;  // not in 0x39 (V10 has isolator instead)
    const hpCueCh = hpCueLink;  // legacy alias
    // Debug hex dump: first receive (per-channel + global ranges)
    if(!parsePDJL._djm39Logged){
      parsePDJL._djm39Logged=true;
      const hex=CH_BASES.slice(0,numCh).map((b,c)=>`CH${c+1}[${Array.from(msg.slice(b,Math.min(b+13,msg.length))).map(x=>x.toString(16).padStart(2,'0')).join(' ')}]`).join(' ');
      const gHex=msg.length>0xB4?Array.from(msg.slice(0xB4,Math.min(0xE8,msg.length))).map(x=>x.toString(16).padStart(2,'0')).join(' '):'(none)';
      try{console.log(`[DJM-0x39] model=${name} ${isV10?'(V10/6ch)':'(4ch)'} len=${msg.length}\n  ${hex}\n  GLOBAL@0xB4=[${gHex}]`);}catch(_){}
    }
    if(process.env.BRIDGE_DJM39_DEBUG){
      if(!parsePDJL._lastDjm||parsePDJL._lastDjm.length!==ch.length||parsePDJL._lastDjm.some((v,i)=>v!==ch[i])){
        parsePDJL._lastDjm=ch.slice();
        try{console.log(`[DJM-0x39] faders=[${ch}] xf=${xfader} mVol=${masterLvl} mCue=${masterCue} booth=${boothLvl} fCv=${faderCurve} xfCv=${xfCurve} hpLv=${hpLevel} hpMix=${hpMixing} beatFx=${beatFxSel}/${beatFxOn} colorFx=${colorFxSel}`);}catch(_){}
      }
    }
    return{
      kind:'djm',name, isV10, numCh,
      channel:ch, eq, cueBtn, cueBtnB, xfAssign, chExtra,
      xfader, masterLvl, masterCue, masterCueB,
      faderCurve, xfCurve,
      isolatorOn, isolatorHi, isolatorMid, isolatorLo,
      boothLvl, boothEqHi, boothEqLo, boothEqBtn,
      hpCueLink, hpCueLinkB, hpMixing, hpMixingB, hpLevel, hpLevelB,
      fxFreqLo, fxFreqMid, fxFreqHi,
      beatFxSel, beatFxAssign, beatFxLevel, beatFxOn, multiIoSel, sendReturn,
      micEqHi, micEqLo,
      filterLPF, filterHPF, filterReso,
      colorFxSel, sendExt1, sendExt2, colorFxParam,
      masterMixOn, masterMixSize, masterMixTime, masterMixTone, masterMixLevel,
      // legacy aliases
      masterBalance, eqCurve, hpCueCh
    };
  }
  // DJM VU Metering (type 0x58, ~524B, port 50001)
  // 15 × uint16BE per block, 0=silence, 32767=clip:
  //   4-ch: CH1=0x02C CH2=0x068 CH3=0x0A4 CH4=0x0E0 MasterL=0x11C MasterR=0x158
  //   6-ch (V10): CH5=0x194 CH6=0x1D0 appended AFTER MasterR (same as 4-ch positions)
  if(type===PDJL.DJM_METER && msg.length>=0x176){
    const isV10 = /V10/i.test(name);
    const chOff4 = [0x02C,0x068,0x0A4,0x0E0];
    const chOff6 = [0x02C,0x068,0x0A4,0x0E0,0x194,0x1D0];
    const masterLOff = 0x11C, masterROff = 0x158;
    const chOffsets = isV10 ? chOff6 : chOff4;
    const readBlock = (base)=>{
      const bands=[]; let peak=0;
      for(let b=0;b<15;b++){
        const off=base+b*2;
        if(off+1<msg.length){const v=msg.readUInt16BE(off); if(v>peak)peak=v; bands.push(Math.min(255,Math.round(v/32767*255)));}
        else bands.push(0);
      }
      return {peak:Math.min(255,Math.round(peak/32767*255)), bands};
    };
    const blocks = chOffsets.map(readBlock);
    const ch = blocks.map(b=>b.peak);
    const spectrum = blocks.map(b=>b.bands);
    const mL = msg.length>=masterLOff+30 ? readBlock(masterLOff) : {peak:0,bands:new Array(15).fill(0)};
    const mR = msg.length>=masterROff+30 ? readBlock(masterROff) : {peak:0,bands:new Array(15).fill(0)};
    return{kind:'djm_meter',name,isV10,numCh:chOffsets.length,ch,spectrum,masterL:mL.peak,masterR:mR.peak,masterLBands:mL.bands,masterRBands:mR.bands};
  }
  // DJM Channels On-Air (type 0x03, 45B, port 50001)
  if(type===PDJL.DJM_ONAIR && msg.length>=0x2C){
    const name2 = msg.slice(0x0B,0x1B).toString('ascii').replace(/\0/g,'').trim();
    if(name2.includes('DJM')){
      // 각 채널은 2바이트 페어로 상태 표현:
      //   CH1=(0x24,0x25)  CH2=(0x26,0x27)  CH3=(0x28,0x29)  CH4=(0x2A,0x2B)
      //   각 페어 내 두 바이트는 X-Fader A/B assign 또는 단독 on-air 비트 (DJM 내부 상태)
      //   페어 OR로 "채널 활성" 판정 → 단일 바이트만 읽으면 CH4 깜빡임 발생(이전 버그)

      // Optional packet-diff diagnostics for DJM 0x03 on-air packets.
      if(process.env.BRIDGE_DJM03_DEBUG && !parsePDJL._djm03First){
        parsePDJL._djm03First=true;
        const hex=Array.from(msg).map((b,i)=>`[0x${i.toString(16).padStart(2,'0')}]=0x${b.toString(16).padStart(2,'0')}`).join(' ');
        console.log(`[DJM-0x03] FULL DUMP len=${msg.length}: ${hex}`);
      }
      if(process.env.BRIDGE_DJM03_DEBUG){
        if(!parsePDJL._djm03Baseline) parsePDJL._djm03Baseline=Buffer.from(msg);
        else {
          const changed=[];
          for(let i=0x1B;i<Math.min(msg.length,parsePDJL._djm03Baseline.length);i++){
            if(msg[i]!==parsePDJL._djm03Baseline[i]){
              changed.push(`0x${i.toString(16)}:${parsePDJL._djm03Baseline[i]}→${msg[i]}`);
            }
          }
          if(changed.length){
            parsePDJL._djm03Baseline=Buffer.from(msg);
            console.log(`[DJM-0x03] BYTE CHANGE: ${changed.join(' ')}`);
          }
        }
      }

      // CUE info comes from 0x39 packet (preferred) or TCNet MixerData — not from 0x03
      const cueCh=[0,0,0,0];
      const onA=(a,b)=> (msg[a]||msg[b]) ? 1 : 0;
      return{kind:'djm_onair',name:name2,
        onAir:[onA(0x24,0x25), onA(0x26,0x27), onA(0x28,0x29), onA(0x2A,0x2B)],
        cueCh};
    }
  }
  // Type 0x02 = Fader Start (DJM → CDJ, port 50001, ~50B)
  // Commands: 0x00=start, 0x01=stop+cue, 0x02=maintain
  if(type===0x02 && msg.length>=42){
    const name2=msg.slice(0x0B,0x1B).toString('ascii').replace(/\0/g,'').trim();
    // Fader start: logged once per session via _pdjlDbg above
      // bytes 42-45 = C1,C2,C3,C4 commands
    if(msg.length>=46){
      return{kind:'fader_start',name:name2,ch:[msg[42],msg[43],msg[44],msg[45]]};
    }
  }
  // Type 0x28 = Beat packet (96B on port 50001) — beat timing + position data
  // 확정 오프셋: 84=pitch(u32BE), 90=bpm(u16BE×100), 92=beatInBar(1-4)
  if(type===0x28 && msg.length>=96){
    const pNum = msg[33];
    if(pNum>=1&&pNum<=6){
      const pitch = msg.readUInt32BE(84);
      const bpm16 = msg.readUInt16BE(90);
      const beat  = msg[92]; // 1-4
      return{
        kind:'beat', playerNum:pNum, name,
        pitch: (pitch-0x100000)/0x100000*100,
        bpm: (bpm16>0&&bpm16!==0xFFFF)?bpm16/100:0,
        beatInBar: beat,
      };
    }
  }
  // CDJ-3000 waveform preview (type 0x56, variable size)
  // Sub-types at byte 0x33: 0x02=mono preview, 0x03=beat grid, 0x25=color waveform
  if(type===PDJL.CDJ_WF && msg.length>0x34){
    const pNum = msg[0x2a]; // player number
    const sub  = msg[0x33]; // sub-type
    const seg  = msg.readUInt16BE(0x30); // segment index
    if(sub===0x25 && msg.length>0x40){
      // Color waveform: 2 bytes per point starting at 0x34
      // Byte 1: high nibble = color (0-15), low nibble = extra
      // Byte 2: height (0-255)
      const pts=[];
      for(let i=0x34;i<msg.length-1;i+=2){
        pts.push({color:(msg[i]>>4)&0xF, height:msg[i+1]});
      }
      return{kind:'cdj_wf',playerNum:pNum,name,sub,seg,pts,wfType:'color'};
    }
    if(sub===0x02 && msg.length>0x40){
      // Mono waveform preview: 1 byte per point starting at 0x34
      const pts=[];
      for(let i=0x34;i<msg.length;i++){
        pts.push({height:msg[i]});
      }
      return{kind:'cdj_wf',playerNum:pNum,name,sub,seg,pts,wfType:'mono'};
    }
    return null; // ignore beat grid (0x03) and others
  }
  if(type===PDJL.ANN){
    // Media Slot Response (type 0x06, length > 0xA8) — contains USB color at 0xA8
    if(msg.length>0xA8){
      const pNum=msg.length>0x24?msg[0x24]:0;
      const color=msg[0xA8];
      if(color>=0&&color<=8){
        return{kind:'media_slot',name,playerNum:pNum,mediaColor:color};
      }
    }
    const playerNum = msg.length>0x24 ? msg[0x24] : 0;
    // 자체 분석: byte[0x21]=device type (0x02=mixer), byte[0x24]=playerNum (>=0x21=DJM)
    const devType = msg.length>0x21 ? msg[0x21] : 0;
    const isDjmType = devType===0x02 && playerNum>=0x21;
    return{kind:'announce',name,playerNum,isDjmType};
  }
  // CDJ-3000 Absolute Position (type 0x0b, port 50001, ~60B, ~30Hz pairs)
  // CDJ-3000 sends PAIRS: 1) real data (byte[33]=player 1-6), 2) garbage (byte[33]>=0x80)
  // Filter by player number range
  // Offsets: [38-39] trackLen(s) uint16BE, [40-43] playhead(ms), [44-47] pitch, [56-59] bpm*10
  // Note: bytes[36-37] are separate fields (not part of trackLength).
  // Only bytes[38-39] as uint16BE give correct duration across all CDJ-3000 units.
  // CDJ-3000 Precise Position (type 0x0b, exactly 60B, port 50001)
  // IMPORTANT: NXS2 also sends type 0x0b with different structure — filter by name field
  if(type===0x0b && msg.length>=60){
    const pNum = msg[33];
    if(pNum>=1 && pNum<=6){
      // NXS2 sends type 0x0b packets with incompatible structure — reject by name
      if(name.includes('2000NXS2') || name.includes('NXS2') || name.includes('NXS')) return null;
      const trackLenSec = msg.readUInt16BE(38);
      const playheadRaw = msg.readUInt32BE(40);
      const pitchRaw2 = msg.readInt32BE(44);
      const bpmRaw10 = msg.readUInt32BE(56);
      // Sanity check: reject garbage packets
      // Valid: trackLen < 24h, playhead ≤ trackLen×1000ms, BPM 20-500, pitch ±50%
      const bpmCheck = bpmRaw10/10;
      // bpmCheck=0 허용: BPM 정보 없는 트랙(BPM-less)도 정상 처리
      const sane = trackLenSec > 0 && trackLenSec < 86400
                && playheadRaw <= trackLenSec * 1000
                && (bpmCheck === 0 || (bpmCheck > 20 && bpmCheck < 500))
                && Math.abs(pitchRaw2) < 5000;
      if(!sane) return null;
      return{
        kind:'precise_pos', playerNum:pNum, name,
        trackLengthSec: trackLenSec,
        playbackMs: playheadRaw,
        pitch: pitchRaw2/100,
        bpmEffective: bpmRaw10/10,
      };
    }
  }
  // Catch-all: return unknown packet with raw info for DJM protocol analysis
  if(msg.length>=0x1B){
    const devName=msg.slice(0x0B,0x1B).toString('ascii').replace(/\0/g,'').trim();
    if(devName.includes('DJM')){
      if(type===0x20){
        // DJM-900NXS2 sends 0x20 in response to 0x57 subscribe — handshake probe
        const seqCounter = msg.length>0x28 ? msg[0x28] : 0;
        return{kind:'djm_probe20',name:devName,type,seq:seqCounter,rawLen:msg.length};
      }
      if(!parsePDJL._unkDjm)parsePDJL._unkDjm={};
      const uk=type+'_'+msg.length;
      if(!parsePDJL._unkDjm[uk]){
        parsePDJL._unkDjm[uk]=true;
        console.log(`[DJM-UNK] type=0x${type.toString(16)} len=${msg.length} name=${devName} hex=${msg.slice(0,Math.min(64,msg.length)).toString('hex')}`);
      }
      return{kind:'djm_unknown',name:devName,type,rawLen:msg.length};
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Default album art — vinyl record JPEG loaded from file
// Used in Arena display and TCNet LowResArtwork when no real album art
const BLANK_JPEG = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'renderer', 'assets', 'default-art.jpg'));
  } catch (e) {
    console.warn('[WARN] default-art.jpg not found, using 1x1 black JPEG fallback');
    return Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6ery8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AP0poA//2Q==', 'base64');
  }
})();

function nxs2BeatCountToMs(beatCount, bpm){
  const bn = Number(beatCount) || 0;
  const b = Number(bpm) || 0;
  if(!(bn > 0) || !(b > 0)) return 0;
  return Math.round(bn * 60000 / b);
}

function shouldKeepPredictedBeatAnchor(predictedMs, beatMs, bpm, isReverse=false){
  const predicted = Number(predictedMs) || 0;
  const anchored = Number(beatMs) || 0;
  const trackBpm = Number(bpm) || 0;
  if(!(predicted > 0) || !(anchored > 0) || isReverse) return false;
  const delta = Math.abs(anchored - predicted);
  const halfBeatMs = trackBpm > 0 ? Math.max(120, 30000 / trackBpm) : 250;
  return delta < halfBeatMs;
}

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
    console.log(`[v13] mode=${this.isLocalMode?'LOCAL(127.0.0.1)':'NETWORK'} bc=${this.broadcastAddr} localIP=${this.localAddr||'none'}`);
    console.log(`[v13] NodeID=0x${nid}, NodeType=0x${TC.NTYPE.toString(16)}, lPort=${this.listenerPort}, name=${TC.NNAME}`);
    console.log(`[v13] Sending: OptIn(1s) + Status(170ms) + TIME(33ms) + DATA(170ms)`);
    console.log(`[v13] Triple-send: broadcast + localIP(${this.localAddr}) + 127.0.0.1`);
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
    // Delay socket close by 100ms to let OptOut UDP packets flush from OS buffer
    const closeSockets=()=>{
      const sockets = [this.txSocket,this.rxSocket,this._loRxSocket,this._ipRxSocket,this.lPortSocket,this._dataSocket];
      if(this._pdjlSockets) this._pdjlSockets.forEach(s=>sockets.push(s));
      else if(this.pdjlSocket) sockets.push(this.pdjlSocket);
      sockets.forEach(s=>{try{s?.close();}catch(_){}});
      this.txSocket=null; this.rxSocket=null; this._loRxSocket=null;
      this._ipRxSocket=null; this.lPortSocket=null; this._dataSocket=null; this.pdjlSocket=null;
      try{this._ownPorts?.clear();}catch(_){}
      this._pdjlSockets=[];
      // _pdjlAnnSock may be shared with _pdjlSockets[0], don't double-close
      if(this._pdjlAnnSock && !this._pdjlSockets?.includes(this._pdjlAnnSock)){
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
    const targets = [];
    for(const node of Object.values(this.nodes)){
      if(Date.now()-node.lastSeen > 15000) continue;
      if(node.lPort) targets.push(`${node.name||'?'}@${node.ip}:${node.lPort}`);
    }
    const isJpeg = jpegBuf[0]===0xFF && jpegBuf[1]===0xD8;
    const endOk = jpegBuf[jpegBuf.length-2]===0xFF && jpegBuf[jpegBuf.length-1]===0xD9;
    // [TCNET-ART] muted
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
    if(count > 0) console.log(`[TCNET-ART] resending ${count} artwork(s) to new node`);
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
    // Debug: log layers state once per second (first 10 times)
    if(!this._stDbg)this._stDbg=0;
    if(this._stDbg<10 && Date.now()-this.startTime>2000){
      if(!this._stDbgLast || Date.now()-this._stDbgLast>1000){
        this._stDbgLast=Date.now();this._stDbg++;
        const ls=this.layers.map((l,i)=>l?`L${i+1}:st=${l.state},bpm=${l.bpm},tc=${l.timecodeMs}`:'null');
        // [ST] layers muted
      }
    }
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
          try{console.log(`[TCNet MixerData] from=${rinfo.address} masterAudio=${masterAudio} chAudio=[${chAudio}] cueA=[${chCueA}] xfAssign=[${chXfAssign}]`);}catch(_){}
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
      loSock.on('error',(e)=>{ console.warn(`[lo-RX] error: ${e.message}`); });
      loSock.bind(TC.P_BC, '127.0.0.1', ()=>{
        console.log(`[TCNet] loopback RX on 127.0.0.1:${TC.P_BC}`);
      });

      // 3) own IP RX socket (unicast from self)
      if(this.localAddr){
        const ipSock = dgram.createSocket({type:'udp4', reuseAddr:true});
        this._ipRxSocket = ipSock;
        ipSock.on('message',(msg,rinfo)=>this._handleTCNetMsg(msg, rinfo, 'ip-RX'));
        ipSock.on('error',(e)=>{ console.warn(`[ip-RX] error: ${e.message}`); });
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
        if(!this._lPortDbg[lk]){this._lPortDbg[lk]=true;try{console.log(`[lPort] ${name} type=0x${type.toString(16)} from ${rinfo.address}:${rinfo.port}`);}catch(_){}}

        if(type===TC.OPTIN){
          const body = msg.slice(TC.H);
          const lPort = body.length>=4 ? body.readUInt16LE(2) : 0;
          const vendor = body.length>=40 ? body.slice(8,24).toString('ascii').replace(/\0/g,'').trim() : '';
          const device = body.length>=40 ? body.slice(24,40).toString('ascii').replace(/\0/g,'').trim() : '';
          const key = name+'@'+rinfo.address;
          const isNew = !this.nodes[key];
          this.nodes[key] = {name,vendor,device,type:msg[17],ip:rinfo.address,port:rinfo.port,lPort,lastSeen:Date.now()};
          if(isNew){
            console.log(`[lPort] OptIn: ${name}@${rinfo.address} lPort=${lPort} vendor=${vendor} device=${device}`);
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
            console.log(`[lPort] auto-register ${name}@${rinfo.address} lPort=${rinfo.port} (from type=0x${type.toString(16)})`);
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
          if(!this._lPortDbg['app_'+rinfo.address]){this._lPortDbg['app_'+rinfo.address]=true;console.log(`[lPort] APP from ${name} → ${rinfo.address}:${rinfo.port} lPort=${lPort}`);}
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
        console.warn(`[lPort] error: ${e.message}`);
        // Fallback to 127.0.0.1 if bind address unavailable
        if(e.code==='EADDRNOTAVAIL'){
          sock.removeAllListeners('error');
          sock.on('error',(e2)=>{console.warn(`[lPort] fallback error: ${e2.message}`);reject(e2);});
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
          // [PDJL] bridge hello muted
        }, h*HELLO_GAP);
      }
      for(let n=1;n<=CLAIM_N;n++){
        setTimeout(()=>{
          if(!liveSession()||!this._pdjlAnnSock) return;
          const cp = _buildClaim(n);
          for(const bc of allBCs){
            try{this._pdjlAnnSock.send(cp,0,cp.length,50000,bc);}catch(_){}
          }
          // [PDJL] bridge claim muted
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
    this._timers.push(_djmRetryT);
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
      this._timers.push(this._pdjlAnnTimer);
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
    // Pioneer 공식 브릿지는 0x57 을 단 1번만 보냄 (pcap 확정, 0424_.pcapng).
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
    this._timers.push(_subRetryT);
    const _notifyTimer=setInterval(()=>{ if(!liveSession()) return; sendBridgeNotifyToAll(); },2000);
    this._bridgeNotifyTimer=_notifyTimer;
    this._timers.push(_notifyTimer);

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
    this._timers.push(_djmWatch);

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
    const p = parsePDJL(msg);
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
          // [TC] track change muted
          // 새 트랙에 이전 캐시 적용 금지: beat grid / 길이 / 정밀 위치 모두 무효화
          // (dbserver 응답이 오기 전까지 stale 값으로 timecodeMs 계산하면 UI가 점프로 인식)
          if(this._beatGrids) delete this._beatGrids[p.playerNum];
          if(this._bgTrackLen) delete this._bgTrackLen[p.playerNum];
          if(this._precisePos) delete this._precisePos[p.playerNum];
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
            // CDJ 일반 덱 먼저, 없으면 rekordbox 등 media source (_mediaSources),
            // 마지막으로 packet sender IP 로 fallback.
            const srcDev = this.devices['cdj'+p.trackDeviceId];
            const _ip = srcDev?.ip
              || this._mediaSources?.[p.trackDeviceId]?.ip
              || rinfo?.address;
            const _slot=p.slot||3, _tid=p.trackId, _pn=p.playerNum, _tt=p.trackType||1;
            // [TC] meta request muted
            setTimeout(()=>this.requestMetadata(_ip, _slot, _tid, _pn, true, _tt), this._dbReady?100:3000);
            this._dbReady = true;
          }
        } else if(acc && !acc.metaRequested && p.trackId>0 && p.hasTrack){
          acc.metaRequested = true;
          const srcDev = this.devices['cdj'+p.trackDeviceId];
          const _ip = srcDev?.ip
            || this._mediaSources?.[p.trackDeviceId]?.ip
            || rinfo?.address;
          // [TC] metadata retry muted
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
          if(acc){ acc._playStart=0; acc._anchorMs=null; acc._anchorTime=null; acc._noBeatAnchorTime=null; acc._noBeatAnchorMs=null; acc._fracMs=null; acc._fracAnchorTime=null; }
        } else if(p.isPlaying || p.isLooping){
          // ── Playing/Looping: CDJ-2000NXS2 interpolation (+ CDJ-3000 fallback without 0x0b) ──
          if(!acc) this._tcAcc[li] = acc = { prevBn:0, elapsedMs:0, trackId:p.trackId, dbgCount:0, metaRequested:false };
          // State transition: CUED/PAUSED/STOPPED → PLAYING 순간 accumulator 리셋.
          // (hot cue / play 버튼 모두 이 전환을 거치며, 점프 위치를 즉시 반영)
          const prevSt = acc._prevState;
          const wasStoppedLike = prevSt === STATE.CUEDOWN || prevSt === STATE.PAUSED || prevSt === STATE.STOPPED || prevSt === STATE.IDLE;
          if(wasStoppedLike){
            acc._fracMs = null; acc._fracAnchorTime = null;
            acc._anchorMs = null; acc._anchorTime = null;
            acc._noBeatAnchorTime = null; acc._noBeatAnchorMs = null;
            acc._bwGuardCount = 0;
            acc.prevBn = 0;
          }
          acc._prevState = p.state;

          if(p.positionFraction > 0 && totalLenMs > 0){
            // positionFraction = beatNum/trackBeats → absolute position anchor
            const rawFracMs = Math.round(p.positionFraction * totalLenMs);
            const prevFrac = acc._fracMs || 0;
            let fracMs;
            if(p.isLooping){
              // 루프 모드: backward guard 완전 비활성. 루프 경계에서의 정상 역전이므로
              // raw packet 위치를 즉시 수용하고 TC extrapolation 도 꺼야 loop wrap 시각화 정확.
              acc._bwGuardCount = 0;
              fracMs = rawFracMs;
              // NXS2 는 0x0A 256B 패킷에 loopStartMs/End 가 없으므로 positionFraction
              // 역전 패턴으로 loop 경계 추론 (오버레이 표시에 사용).
              if(prevFrac > 0 && rawFracMs < prevFrac - 100){
                acc._loopStartMs = rawFracMs;
                acc._loopEndMs   = prevFrac;
              }
            } else {
              // Backward-jump guard:
              //  (1) 트랙 끝(마지막 30%) 근처에서 beatNum 리셋으로 prevFrac−2s 이상 역전
              //  (2) PLAYING 중 트랙 어느 지점에서든 갑자기 prevFrac−5s 이상 역전 (CDJ 순간 오류)
              //  단, hot cue/seek 는 합법적 역방향 점프이므로 연속 2 패킷 이상 지속되면 수용.
              const endBackward   = prevFrac > totalLenMs * 0.7 && rawFracMs < prevFrac - 2000;
              const midBackward   = prevFrac > 5000 && rawFracMs < prevFrac - 5000 && !p.isReverse;
              if(endBackward || midBackward){
                acc._bwGuardCount = (acc._bwGuardCount || 0) + 1;
                if(acc._bwGuardCount >= 2){
                  fracMs = rawFracMs;
                  acc._bwGuardCount = 0;
                } else {
                  fracMs = prevFrac;
                }
              } else {
                acc._bwGuardCount = 0;
                fracMs = rawFracMs;
              }
              // non-looping 상태에선 추론된 loop 경계 폐기
              acc._loopStartMs = 0; acc._loopEndMs = 0;
            }
            // Anchor 갱신 — 3-zone 정책으로 jitter 제거:
            //  |drift| > 200ms → snap (hot cue/seek/loop wrap)
            //  50~200ms         → anchor = expected + drift*0.5 (실제 drift 보정)
            //  <50ms            → drift 무시 (packet 지터를 anchor 에 흘리지 않음)
            //  정상 play 에서는 drift≈0 에 가까워 이 경로에선 _anchorMs 값을
            //  변경하지 않고 elapsed 만 누적 → 완벽히 선형 TC.
            const now = Date.now();
            if(!acc._anchorMs){
              acc._anchorMs = fracMs;
              acc._anchorTime = now;
            } else {
              const elapsedA = now - (acc._anchorTime || now);
              const expected = acc._anchorMs + elapsedA * p.pitchMultiplier;
              const drift = fracMs - expected;
              const absD = Math.abs(drift);
              if(absD > 200 || p.isLooping){
                acc._anchorMs = fracMs;
                acc._anchorTime = now;
              } else if(absD > 50){
                acc._anchorMs = expected + drift * 0.5;
                acc._anchorTime = now;
              }
              // else: drift < 50ms → 무시. anchor/anchorTime 유지해 extrapolation
              //        연속성 보존 (packet arrival jitter 흡수).
            }
            acc._fracMs = fracMs;
            acc._fracAnchorTime = now;
            if(p.isLooping){
              timecodeMs = fracMs;
            } else {
              const elapsed = now - acc._anchorTime;
              timecodeMs = Math.round(acc._anchorMs + elapsed * p.pitchMultiplier);
            }
          } else {
            // Beat-link fallback (no positionFraction: BPM-less track or trackBeats=0)
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
              // BPM-less + no beat number: wall-clock interpolation
              if(p.pitchMultiplier > 0){
                if(acc._noBeatAnchorTime == null){
                  acc._noBeatAnchorTime = Date.now();
                  acc._noBeatAnchorMs = (this.layers[li]?.timecodeMs) || 0;
                }
                const elapsed = Date.now() - acc._noBeatAnchorTime;
                timecodeMs = Math.round(acc._noBeatAnchorMs + elapsed * p.pitchMultiplier);
                if(elapsed > 2000){ acc._noBeatAnchorTime=Date.now(); acc._noBeatAnchorMs=timecodeMs; }
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
            // beatNum in CUEDOWN = current cue position
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
          } else if(this.layers[li]?.timecodeMs > 0){
            timecodeMs = this.layers[li].timecodeMs;
          }
          if(acc){ acc._playStart=0; acc._anchorMs=null; acc._anchorTime=null; acc._noBeatAnchorTime=null; acc._noBeatAnchorMs=null; acc._fracMs=null; acc._fracAnchorTime=null; }
        }

        const prev = this.layers[li];
        const stateChanged = !prev || prev.state     !== p.state;
        const bpmChanged   = !prev || Math.abs((prev.bpm||0) - (p.bpm||0)) > 0.005;
        const beatChanged  = !prev || prev.beatPhase !== beatPhase;

        if(stateChanged || bpmChanged || trackChanged || beatChanged){
          this.updateLayer(li, {
            state:       p.state,
            timecodeMs,
            bpm:         p.bpm,
            trackId:     p.trackId,
            totalLength: totalLenMs || prev?.totalLength || 0,
            beatPhase,
            deviceName:  p.name,
            _pitch:      p.effectivePitch || p.pitch || 0,
          });
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
        // NXS2: 패킷에 loop 필드 없음 → positionFraction 역전으로 추론한 loop 경계 주입
        if(p.isNXS2 && acc?._loopStartMs > 0 && acc?._loopEndMs > acc._loopStartMs){
          p.loopStartMs = acc._loopStartMs;
          p.loopEndMs   = acc._loopEndMs;
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
        cueBtn:p.cueBtn, xfAssign:p.xfAssign,
        chExtra:p.chExtra, hasRealFaders:true,
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
          // [PDJL] Precise Position muted
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
      // 가상 장치/소프트웨어 announce 차단 (CDJ 덱 목록에는 안 나타남)
      if(p.name && /rekordbox|rbdj|NXS-?GW|TCS-|prolink/i.test(p.name)){
        // 단, rekordbox 는 CDJ 가 LAN Link Export 로 로드한 트랙의 메타데이터
        // 출처이므로 IP 를 별도 _mediaSources 맵에 저장해 dbserver 쿼리에 사용.
        if(p.name && /rekordbox|rbdj/i.test(p.name) && pn >= 1 && pn <= 50){
          this._mediaSources = this._mediaSources || {};
          this._mediaSources[pn] = { ip: rinfo.address, name: p.name, lastSeen: Date.now() };
        }
        if(!this._fakeAnnLogged) this._fakeAnnLogged={};
        const fkey = `${p.name}@${rinfo.address}`;
        if(!this._fakeAnnLogged[fkey]){
          this._fakeAnnLogged[fkey]=true;
          console.warn(`[PDJL] 가짜 announce 차단: name="${p.name}" from=${rinfo.address} (덱 목록 제외, trackDeviceId=${pn} 는 미디어 소스로 등록)`);
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
          // [PDJL] CDJ keepalive muted
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
  registerVirtualDeck(slot, modelName){
    if(slot<0||slot>7) return;
    this.hwMode[slot] = false;  // virtual deck → disable HW mode for this slot
    const key = `cdj${slot+1}`;
    this.devices[key] = {
      type:'CDJ', playerNum:slot+1,
      name: modelName || 'CDJ-3000',
      ip:'127.0.0.1', lastSeen:Date.now(), virtual:true,
      state:{}
    };
    this._syncVirtualDevices();
    this.onDeviceList?.(this.devices);
  }
  unregisterVirtualDeck(slot){
    if(slot<0||slot>7) return;
    this.hwMode[slot] = true;  // restore HW mode when virtual deck removed
    const key = `cdj${slot+1}`;
    if(this.devices[key]?.virtual) delete this.devices[key];
    this._syncVirtualDevices();
    this.onDeviceList?.(this.devices);
  }
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
  setVirtualArt(slot, jpegBuf){
    if(slot<0||slot>7) return;
    this._virtualArt[slot] = jpegBuf || BLANK_JPEG;
    const isBuf = Buffer.isBuffer(jpegBuf);
    const hdr = jpegBuf ? `[${jpegBuf[0]?.toString(16)},${jpegBuf[1]?.toString(16)}]` : 'null';
    console.log(`[VDBSRV] slot ${slot} artwork stored: ${jpegBuf?.length||0}B isBuffer=${isBuf} hdr=${hdr}`);
    // Send artwork via TCNet LowResArtwork (same path as HW mode)
    this._sendArtwork(slot + 1, jpegBuf);
    // Retry after delays — Arena may not have registered the layer yet
    setTimeout(()=>this._sendArtwork(slot + 1, this._virtualArt[slot]), 500);
    setTimeout(()=>this._sendArtwork(slot + 1, this._virtualArt[slot]), 2000);
    setTimeout(()=>this._sendArtwork(slot + 1, this._virtualArt[slot]), 5000);
  }

  /** Send a virtual CDJ status packet (type 0x0A) so Resolume Arena sees
   *  a track-loaded player and queries our virtual dbserver for artwork.
   *  Relevant offsets:
   *    0x24=playerNum, 0x28=trackDeviceId, 0x29=slot, 0x2A=trackType, 0x2C=trackId(BE) */
  _sendVirtualCDJStatus(playerNum, trackId, bpm){
    if(!this._pdjlAnnSock || !trackId) return;
    try{
      // ROLLBACK: was 212 (0xD4, Nexus 1st gen size) — NXS2 uses 0x11C (284B)
      // Arena/CDJs may ignore packets with wrong size for their expected model
      const pktSize = 0x11C;  // 284 bytes = NXS2 CDJ status size
      const pkt = Buffer.alloc(pktSize);
      PDJL.MAGIC.copy(pkt, 0);
      pkt[0x0A] = PDJL.CDJ;   // 0x0A = CDJ status type
      pkt[0x0B] = 0x00;
      const nm = 'TCS-SHOWKONTROL';
      Buffer.from(nm,'ascii').copy(pkt, 0x0C, 0, 15);
      // Header fields — 0x20=subtype(0x03=CDJ), 0x21=deviceNum
      // ROLLBACK: was pkt[0x20]=0x01, pkt[0x21]=0x04
      pkt[0x20] = 0x03; pkt[0x21] = playerNum & 0xFF;
      pkt.writeUInt16BE(pktSize - 0x24, 0x22);  // lengthRemaining from 0x24 to end
      pkt[0x24] = playerNum & 0xFF;   // player number (NXS2 reads 0x21, CDJ-3000 reads 0x24)
      pkt[0x25] = 0x00;
      // 0x26-0x27: sub-field (unused, zero)
      // Track source fields
      pkt[0x28] = playerNum & 0xFF;   // trackDeviceId = self (same player loaded it)
      pkt[0x29] = 0x03;               // slot = 3 (USB)
      pkt[0x2A] = 0x01;               // trackType = 1 (rekordbox analyzed track)
      pkt[0x2B] = 0x00;
      pkt.writeUInt32BE(trackId >>> 0, 0x2C);  // trackId (big-endian)

      // bytes 0x68 and 0x75 MUST be 1 for mp3 metadata delivery
      // ROLLBACK: was 0x00 (unset)
      pkt[0x68] = 0x01;
      pkt[0x75] = 0x01;

      // Playing state: P1 byte (0x7B) and flags (0x89)
      // ROLLBACK: was pkt[0x7B]=0x09
      pkt[0x7B] = 0x03;   // P1 = 0x03 = playing
      // ROLLBACK: was 0x68 (bit5=Master set) — only P1 should be master, others sync+onAir
      pkt[0x89] = (playerNum === 1) ? 0x68 : 0x48;
      // 0x68 = play(0x40)+master(0x20)+onAir(0x08), 0x48 = play(0x40)+onAir(0x08)
      // P2 play mode: NXS2 uses 0xFA(play)/0xFE(stop)
      pkt[0x8B] = 0xFA;  // P2 = playing (NXS2 format)
      // BPM × 100 as uint16BE at 0x92
      const bpmVal = Math.round((bpm||128)*100);
      pkt.writeUInt16BE(bpmVal, 0x92);
      // Pitch: slider at 0x8D (3B), effective at 0x99 (3B) — neutral = 0x100000
      // Write neutral pitch at both locations
      pkt[0x8D] = 0x10; pkt[0x8E] = 0x00; pkt[0x8F] = 0x00; // sliderPitch = 0x100000
      pkt[0x99] = 0x10; pkt[0x9A] = 0x00; pkt[0x9B] = 0x00; // effectivePitch = 0x100000
      // ROLLBACK: was pkt.writeUInt32BE(0x100000, 0x8C) — wrote 4B starting at 0x8C
      // 0xB6 must be 1
      pkt[0xB6] = 0x01;

      // Unicast only to Arena + localhost — broadcasting reaches DJM and causes
      // identity conflict (same playerNum from two IPs) that makes DJM-900NXS2
      // refuse 0x57 subscribe and never send 0x39 fader data.
      try{this._pdjlAnnSock.send(pkt,0,pkt.length,50002,'127.0.0.1');}catch(_){}
      try{this._pdjlAnnSock.send(pkt,0,pkt.length,50001,'127.0.0.1');}catch(_){}
      const arenaIPs = new Set();
      for(const n of Object.values(this.nodes||{})){
        if(n?.ip && n.ip!=='127.0.0.1' && (n.name?.includes('Arena') || n.vendor?.includes('Resolume'))){
          arenaIPs.add(n.ip);
        }
      }
      for(const ip of arenaIPs){
        try{this._pdjlAnnSock.send(pkt,0,pkt.length,50002,ip);}catch(_){}
        try{this._pdjlAnnSock.send(pkt,0,pkt.length,50001,ip);}catch(_){}
      }
      const _summary=`${trackId}_${bpm||128}_${pktSize}`;
      if(this._shouldLogRate(`virt_status_${playerNum}`, 10000, _summary)){
        console.log(`[PDJL-VIRT] CDJ status P${playerNum} trackId=${trackId} bpm=${bpm||128} size=${pktSize}`);
      }
    }catch(e){console.warn('[PDJL-VIRT] status send error:',e.message);}
  }

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

  _startVirtualDbServer(){
    const net2 = require('net');
    // Port discovery server on 12523 — tells clients our actual dbserver port
    const REAL_PORT = 12524;  // actual protocol port

    // 1) Port discovery listener on 12523
    this._dbSrv = net2.createServer(sock=>{
      sock.on('error',()=>{});
      sock.once('data', d=>{
        // Client sends 4-byte BE length + "RemoteDBServer\0"
        const str = d.slice(4).toString('ascii').replace(/\0/g,'');
        if(str === 'RemoteDBServer'){
          const resp = Buffer.alloc(2);
          resp.writeUInt16BE(REAL_PORT, 0);
          sock.write(resp);
          console.log(`[VDBSRV] port discovery → ${REAL_PORT}`);
        }
        sock.end();
      });
    });
    this._dbSrv.on('error', e=>{
      // Port 12523 may be in use by a real CDJ on the network
      console.warn(`[VDBSRV] port 12523 bind failed: ${e.message} (real CDJ on network?)`);
    });
    this._dbSrv.listen(12523, '0.0.0.0', ()=>{
      console.log('[VDBSRV] port discovery listening on 12523');
    });

    // 2) Actual protocol server on REAL_PORT
    this._dbSrvProto = net2.createServer(sock=>{
      sock.on('error',e=>console.warn('[VDBSRV] sock error:',e.message));
      console.log(`[VDBSRV] Arena connected to proto port ${REAL_PORT} from ${sock.remoteAddress}`);
      let phase = 'greeting';  // greeting → setup → ready
      let buf = Buffer.alloc(0);

      sock.on('data', d=>{
        buf = Buffer.concat([buf, d]);

        if(phase === 'greeting'){
          // Client sends NumberField UInt32 = player number (5 bytes: 0x11 + 4B BE)
          if(buf.length >= 5 && buf[0] === 0x11){
            const player = buf.readUInt32BE(1);
            sock._vdbPlayer = player;  // save greeting player for routing context
            console.log(`[VDBSRV] greeting from player ${player}`);
            // Echo back greeting
            sock.write(this._dbNum4(player));
            buf = buf.slice(5);
            phase = 'setup';
          }
          return;
        }

        if(phase === 'setup'){
          // SETUP_REQ: magic(5) + txId(5) + type(3) + argc(2) + tags(variable) + args
          // ROLLBACK: was buf.length>=32, but variable-length tags make SETUP as short as 26B
          if(buf.length >= 15){
            const typeOff = 10;  // after magic(5)+txId(5)
            if(buf[typeOff] === 0x10){  // UInt16 field
              const reqType = buf.readUInt16BE(typeOff+1);
              if(reqType === 0x0000){  // SETUP
                const setupTxId = buf.readUInt32BE(6);
                const argc = buf[14] || 0;
                // Calculate actual SETUP message length: 15 header + 5+argc tags + argc*5 args
                const setupLen = 15 + 5 + argc + argc * 5;
                console.log(`[VDBSRV] SETUP received txId=0x${setupTxId.toString(16)} argc=${argc} msgLen=${setupLen}`);
                const resp = this._dbBuildMsg(setupTxId, 0x4000, [this._dbArg4(1)]);
                sock.write(resp);
                phase = 'ready';
                buf = buf.length > setupLen ? buf.slice(setupLen) : Buffer.alloc(0);
                // Fall through to handle any remaining buffered requests
                if(buf.length < 15) return;
              } else {
                // Non-setup request arrived (Arena skips SETUP step) — go directly to ready
                console.log(`[VDBSRV] no SETUP from client, handling reqType=0x${reqType.toString(16)} directly`);
                phase = 'ready';
                // Fall through to handle request below
              }
            } else {
              return;
            }
          } else {
            return;
          }
        }

        // phase === 'ready': handle artwork & metadata requests
        // ROLLBACK: was buf.length>=32, but variable-length tags make messages shorter
        if(buf.length >= 15){
          this._handleVDbRequest(sock, buf);
          buf = Buffer.alloc(0);
        }
      });
    });
    this._dbSrvProto.on('error', e=>{
      console.warn(`[VDBSRV] proto port ${REAL_PORT} bind failed: ${e.message}`);
    });
    this._dbSrvProto.listen(REAL_PORT, '0.0.0.0', ()=>{
      console.log(`[VDBSRV] protocol server listening on ${REAL_PORT}`);
    });
  }

  /** Parse a dbserver message to extract txId, type, and UInt32 args.
   *  Format: magic(5) + txId(5) + type(3) + argc(2) + argTags(5+argc) + args...
   *  ROLLBACK: was using hardcoded offset 38 for arg1 — only correct for our fixed
   *  12-byte tag list, but clients here use variable-length tags (argc bytes). */
  _parseDbRequest(buf){
    if(buf.length < 15) return null;
    const txId = buf.readUInt32BE(6);   // [5]=0x11, [6-9]=value
    const type = buf.readUInt16BE(11);  // [10]=0x10, [11-12]=value
    const argc = buf[14];              // [13]=0x0F, [14]=value
    // argTags binary: [15]=0x14, [16-19]=tagListLen, [20..20+tagListLen-1]=tags
    if(buf.length < 20) return { txId, type, argc, args: [] };
    const tagListLen = buf.readUInt32BE(16);
    const argsStart = 20 + tagListLen;
    // Parse UInt32 args (each: 0x11 tag + 4B BE value = 5 bytes)
    const args = [];
    let pos = argsStart;
    for(let i = 0; i < argc && pos < buf.length; i++){
      const tag = buf[pos];
      if(tag === 0x11 && pos + 5 <= buf.length){       // UInt32
        args.push(buf.readUInt32BE(pos + 1)); pos += 5;
      } else if(tag === 0x10 && pos + 3 <= buf.length){ // UInt16
        args.push(buf.readUInt16BE(pos + 1)); pos += 3;
      } else if(tag === 0x0F && pos + 2 <= buf.length){ // UInt8
        args.push(buf[pos + 1]); pos += 2;
      } else if(tag === 0x14 && pos + 5 <= buf.length){ // Binary — skip
        const blen = buf.readUInt32BE(pos + 1); pos += 5 + blen;
        args.push(0);
      } else if(tag === 0x26 && pos + 5 <= buf.length){ // String — skip
        const slen = buf.readUInt32BE(pos + 1); pos += 5 + slen * 2;
        args.push(0);
      } else { break; }
    }
    return { txId, type, argc, args };
  }

  _handleVDbRequest(sock, buf){
    try{
      const msg = this._parseDbRequest(buf);
      if(!msg) return;
      const { txId: actualTxId, type: reqType, args } = msg;
      console.log(`[VDBSRV] request type=0x${reqType.toString(16)} txId=${actualTxId} args=[${args.join(',')}]`);

      if(reqType === 0x2002){
        // MetadataReq → MenuAvail with item count=1
        // ROLLBACK: was buf.readUInt32BE(38) — wrong offset for variable-length argTags
        // args[0]=RMST (player|menu|slot|trackType), args[1]=trackId
        const trackIdReq = args[1] || 0;
        sock._vdbTrackId = trackIdReq;  // save per-connection
        if(trackIdReq) this._lastVdbTrackId = trackIdReq;  // global fallback
        console.log(`[VDBSRV] meta req trackId=${trackIdReq} greeting=${sock._vdbPlayer||'?'}`);
        sock.write(this._dbBuildMsg(actualTxId, 0x4002, [this._dbArg4(1)]));
      } else if(reqType === 0x3000){
        // RenderMenuReq → send MenuItem(s) + render complete
        // Find layer by trackId from earlier 0x2002 request
        const tid = sock._vdbTrackId || this._lastVdbTrackId || 0;
        let title='BRIDGE+', artist='', artSlot=-1;
        for(let i=0;i<8;i++){
          const ld=this.layers[i];
          if(ld && ((tid && ld.trackId===tid) || (!tid && ld.trackName))){
            title=ld.trackName||'';artist=ld.artistName||'';artSlot=i;break;
          }
        }
        const art = artSlot>=0 ? this._virtualArt[artSlot] : this._findVirtualArt();
        const artworkId = art ? (tid || (this.layers.find(l=>l?.trackId)?.trackId) || 1) : 0;
        const item=this._dbBuildMenuItem(actualTxId, title, artist, artworkId);
        const done=this._dbBuildMsg(actualTxId+1, 0x4003, [this._dbArg4(1)]);
        sock.write(Buffer.concat([item, done]));
        console.log(`[VDBSRV] render menu: title="${title}" artSlot=${artSlot} artworkId=${artworkId} tid=${tid}`);
      } else if(reqType === 0x2003){
        // ArtworkReq → serve stored JPEG matching the trackId, then close
        // ROLLBACK: was buf.readUInt32BE(38) — wrong offset for variable-length argTags
        // args[0]=RMST, args[1]=artworkId (= trackId set in MenuItem)
        const reqArtId = args[1] || 0;
        // Find artwork by trackId, then fallback to per-connection trackId, then _findVirtualArt()
        const artBuf = this._findArtByTrackId(reqArtId)
          || this._findArtByTrackId(sock._vdbTrackId)
          || this._findVirtualArt();
        if(artBuf){
          const isJpeg = artBuf[0]===0xFF && artBuf[1]===0xD8;
          console.log(`[VDBSRV] artwork req artId=${reqArtId} connTrackId=${sock._vdbTrackId||0} → ${artBuf.length}B ${isJpeg?'JPEG':'?'}`);
          const artResp = this._dbBuildArtResponse(actualTxId, artBuf);
          sock.write(artResp, ()=>{
            console.log(`[VDBSRV] artwork sent OK, closing conn`);
            sock.end();
          });
        } else {
          // No real art — send blank JPEG so Arena clears previous artwork
          console.log(`[VDBSRV] artwork req artId=${reqArtId} → sending blank JPEG`);
          const artResp = this._dbBuildArtResponse(actualTxId, BLANK_JPEG);
          sock.write(artResp, ()=>sock.end());
        }
      } else if(reqType === 0x0100){
        // TEARDOWN — client is closing connection
        sock.end();
      } else {
        // Unknown data request — send empty render-done (0x4003) so Arena doesn't stall
        console.log(`[VDBSRV] unhandled reqType=0x${reqType.toString(16)}, sending empty done`);
        sock.write(this._dbBuildMsg(actualTxId, 0x4003, [this._dbArg4(0)]), ()=>sock.end());
      }
    }catch(e){
      console.warn(`[VDBSRV] handleRequest error: ${e.message}`);
    }
  }

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

  _findVirtualArt(){
    for(const slot of Object.keys(this._virtualArt)){
      const buf=this._virtualArt[slot];
      if(buf&&buf.length>100) return buf;  // skip BLANK_JPEG (tiny placeholder)
    }
    return null;
  }

  // Build a 0x4101 MenuItem message — used to tell Arena about artworkId
  // args[3]=label1(str), args[4]=label2(str), args[6]=itemType, args[8]=artworkId
  _dbBuildMenuItem(txId, label1, label2, artworkId){
    // argList type codes for 12 args of a MenuItem
    const TYPE_CODES = [0x06,0x06,0x06,0x26,0x26,0x06,0x06,0x06,0x06,0x06,0x26,0x06];
    const argList = Buffer.from(TYPE_CODES);
    const args = [
      this._dbArg4(1),                                          // [0] item id
      this._dbArg4(0),                                          // [1] numeric
      this._dbArg4(0),                                          // [2] color
      {tag:0x26, data:this._dbStr(label1)},                    // [3] title
      {tag:0x26, data:this._dbStr(label2||'')},                // [4] artist
      this._dbArg4(artworkId?1:0),                              // [5] has artwork flag
      this._dbArg4(0x0004),                                     // [6] itemType = title track
      this._dbArg4(0),                                          // [7]
      this._dbArg4(artworkId),                                  // [8] artworkId
      this._dbArg4(0),                                          // [9]
      {tag:0x26, data:this._dbStr('')},                        // [10] empty
      this._dbArg4(0),                                          // [11]
    ];
    const parts=[
      this._dbNum4(0x872349ae),
      this._dbNum4(txId),
      this._dbNum2(0x4101),
      this._dbNum1(args.length),
      this._dbBinary(argList),
    ];
    for(const a of args) parts.push(a.data);
    return Buffer.concat(parts);
  }

  _dbBuildArtResponse(txId, jpegBuf){
    // Real CDJ format: args[0]=size(UInt32), args[1]=binary JPEG
    const sizeArg = this._dbArg4(jpegBuf.length);
    const artArg  = { tag: 0x03, data: this._dbBinary(jpegBuf) };
    return this._dbBuildMsg(txId, 0x4003, [sizeArg, artArg]);
  }

  // ── dbserver metadata client (TCP 12523) ────
  // Protocol implementation
  // Flow: port discovery → greeting → setup → metadata query → render → parse

  onTrackMetadata = null; // (playerNum, {title, artist, album, duration, artworkId, key, genre}) => {}

  /**
   * Request track metadata + artwork from a CDJ via dbserver protocol.
   */
  requestMetadata(ip, slot, trackId, playerNum, force=false, trackType=1){
    if(!ip || !trackId) return;
    const cacheKey = `${ip}_${slot}_${trackId}`;
    if(!this._metaReqCache) this._metaReqCache = {};
    const now = Date.now();
    const prev = this._metaReqCache[cacheKey];
    const ttlMs = force ? 8000 : 30000;
    if(prev && (now - prev.time) < ttlMs) return;
    this._metaReqCache[cacheKey] = { time: now, force: !!force };
    this._dbserverMetadata(ip, slot, trackId, playerNum, trackType).catch(e=>{
      if(this._shouldLogRate(`db_meta_fail_${cacheKey}`, 10000, e.message)){
        console.warn(`[DBSRV] metadata request failed: ${e.message}`);
      }
      delete this._metaReqCache[cacheKey];
    });
  }
  // Re-request metadata for all currently loaded tracks (called after startup delay)
  refreshAllMetadata(){
    for(const [key,dev] of Object.entries(this.devices)){
      if(dev.type==='CDJ' && dev.state?.trackId>0 && dev.state?.hasTrack){
        const s=dev.state;
        const srcDev = this.devices['cdj'+s.trackDeviceId];
        const ip = srcDev?.ip || dev.ip;
        // [DBSRV] refresh muted
        this.requestMetadata(ip, s.slot||3, s.trackId, s.playerNum, true, s.trackType||1);
      }
    }
  }

  requestArtwork(ip, slot, artworkId, playerNum){
    if(!ip || !artworkId) return;
    const cacheKey = `art_${ip}_${slot}_${artworkId}`;
    if(this._artCache[cacheKey]){
      this.onAlbumArt?.(playerNum, this._artCache[cacheKey]);
      return;
    }
    this._dbserverArtwork(ip, slot, artworkId, playerNum, cacheKey).catch(e=>{
      if(this._shouldLogRate(`db_art_fail_${cacheKey}`, 10000, e.message)){
        console.warn(`[DBSRV] artwork request failed: ${e.message}`);
      }
    });
  }

  _scheduleDbFollowUps(ip, slot, trackId, playerNum, trackType, artworkId){
    if(!this._dbFollowTimers) this._dbFollowTimers = {};
    const key = `p${playerNum}`;
    const prev = this._dbFollowTimers[key];
    if(prev?.timers){
      prev.timers.forEach(t=>clearTimeout(t));
    }
    const token = `${ip}_${slot}_${trackId}_${Date.now()}`;
    const timers = [];
    const alive = ()=>this._dbFollowTimers?.[key]?.token===token;
    const defer = (delay, fn)=>{
      const timer = setTimeout(()=>{
        if(!alive()) return;
        fn().catch(e=>{
          if(this._shouldLogRate(`db_follow_fail_${playerNum}_${delay}`, 10000, e.message)){
            console.warn(`[DBSRV] P${playerNum} follow-up failed:`, e.message);
          }
        });
      }, delay);
      timers.push(timer);
    };
    this._dbFollowTimers[key] = { token, timers };

    if(artworkId){
      defer(0, ()=>this._dbserverArtwork(ip, slot, artworkId, playerNum, `art_${ip}_${slot}_${artworkId}`));
    }
    defer(180, ()=>this._dbserverWaveform(ip, slot, trackId, playerNum, trackType));
    defer(520, ()=>this._dbserverWaveformDetail(ip, slot, trackId, playerNum, trackType));
    defer(920, ()=>this._dbserverWaveformNxs2(ip, slot, trackId, playerNum, trackType));
    defer(1280, ()=>this._dbserverCuePoints(ip, slot, trackId, playerNum, trackType));
    defer(1640, ()=>this._dbserverBeatGrid(ip, slot, trackId, playerNum, trackType));
    defer(2320, ()=>this._dbserverSongStructure(ip, slot, trackId, playerNum, trackType));
  }

  // ── dbserver field builders ────
  _dbNum1(v){ return Buffer.from([0x0f, v&0xFF]); }
  _dbNum2(v){ const b=Buffer.alloc(3); b[0]=0x10; b.writeUInt16BE(v,1); return b; }
  _dbNum4(v){ const b=Buffer.alloc(5); b[0]=0x11; b.writeUInt32BE(v>>>0,1); return b; }

  _dbBuildMsg(txId, type, args){
    // Each field is wrapped in a FieldType prefix
    // UInt32=0x11(5B), UInt16=0x10(3B), UInt8=0x0F(2B), Binary=0x14(1+4+data)
    const argList = Buffer.alloc(12); // 12 type-tag slots
    for(let i=0;i<args.length&&i<12;i++) argList[i] = args[i].tag;
    const parts = [
      this._dbNum4(0x872349ae),           // magic as UInt32 field
      this._dbNum4(txId),                 // txId as UInt32 field
      this._dbNum2(type),                 // type as UInt16 field
      this._dbNum1(args.length),          // argCount as UInt8 field
      this._dbBinary(argList),            // type tags as Binary field
    ];
    for(const a of args) parts.push(a.data);
    return Buffer.concat(parts);
  }

  _dbBinary(buf){ const hdr=Buffer.alloc(5); hdr[0]=0x14; hdr.writeUInt32BE(buf.length,1); return Buffer.concat([hdr,buf]); }
  _dbArg4(v){ return { tag:0x06, data: this._dbNum4(v) }; }
  // UTF-16BE string field (tag 0x26): 4-byte char count (incl. null) + UTF-16BE chars
  _dbStr(str){ const cs=(str||'').split('').map(c=>c.charCodeAt(0)); cs.push(0); const d=Buffer.alloc(cs.length*2); cs.forEach((c,i)=>d.writeUInt16BE(c&0xFFFF,i*2)); const h=Buffer.alloc(5); h[0]=0x26; h.writeUInt32BE(cs.length,1); return Buffer.concat([h,d]); }

  _dbRMST(reqPlayer, menu, slot, trackType){
    const v = ((reqPlayer&0xFF)<<24)|((menu&0xFF)<<16)|((slot&0xFF)<<8)|(trackType&0xFF);
    return this._dbArg4(v);
  }

  // ── TCP connection + handshake ────
  async _dbConnect(ip, spoofPlayer){
    const net2 = require('net');
    // Step 1: discover actual dbserver port
    const realPort = await new Promise((res,rej)=>{
      const s = new net2.Socket();
      s.setTimeout(3000);
      s.on('error', rej);
      s.on('timeout', ()=>{s.destroy();rej(new Error('port discovery timeout'));});
      s.connect(12523, ip, ()=>{
        // Send "RemoteDBServer\0" with 4-byte BE length prefix
        // length=15: "RemoteDBServer" (14) + NUL (1)
        const msg = Buffer.alloc(4+15);
        msg.writeUInt32BE(15, 0);
        msg.write('RemoteDBServer\0', 4, 'ascii');
        s.write(msg);
      });
      s.once('data', d=>{
        s.destroy();
        if(d.length>=2) res(d.readUInt16BE(0));
        else rej(new Error(`bad port response len=${d.length} hex=${d.toString('hex')}`));
      });
    });
    // [DBSRV] dbserver port muted

    // Step 2: connect to actual port + greeting
    const sock = new net2.Socket();
    sock.setTimeout(5000);
    await new Promise((res,rej)=>{
      sock.on('error', rej);
      sock.on('timeout', ()=>{sock.destroy();rej(new Error('connect timeout'));});
      sock.connect(realPort, ip, ()=>{
        // Greeting: send NumberField(4-byte) = 1
        sock.write(this._dbNum4(1));
        res();
      });
    });
    // Wait for greeting echo
    await new Promise((res,rej)=>{
      sock.once('data', d=>{
        // [DBSRV] greeting response muted
        if(d.length>=5 && d[0]===0x11) res();
        else rej(new Error(`bad greeting: ${d.toString('hex')}`));
      });
      sock.once('error', rej);
    });

    // Step 3: SETUP_REQ (type 0x0000, txId 0xfffffffe)
    const setupMsg = this._dbBuildMsg(0xfffffffe, 0x0000, [this._dbArg4(spoofPlayer)]);
    // [DBSRV] SETUP muted
    sock.write(setupMsg);
    const setupResp = await this._dbReadResponse(sock);
    // [DBSRV] SETUP response muted

    return sock;
  }

  _dbReadResponse(sock){
    return new Promise((res,rej)=>{
      const chunks = [];
      const onData = d => {
        chunks.push(d);
        const buf = Buffer.concat(chunks);
        // NumberField format: UInt32(magic)=5 + UInt32(txId)=5 + UInt16(type)=3 + UInt8(argc)=2 + Binary(tags)=17 = 32+ bytes
        if(buf.length >= 32){
          sock.removeListener('data', onData);
          res(buf);
        }
      };
      sock.on('data', onData);
      sock.once('error', rej);
      setTimeout(()=>{sock.removeListener('data',onData);rej(new Error('response timeout'));}, 5000);
    });
  }

  _dbReadFullResponse(sock, idleMs=300){
    return new Promise((res,rej)=>{
      const chunks = [];
      let timer = null;
      const onData = d => {
        chunks.push(d);
        // Reset idle timer on each chunk
        if(timer) clearTimeout(timer);
        timer = setTimeout(()=>{
          sock.removeListener('data', onData);
          res(Buffer.concat(chunks));
        }, idleMs);
      };
      sock.on('data', onData);
      sock.once('error', e=>{if(timer)clearTimeout(timer);rej(e);});
      setTimeout(()=>{sock.removeListener('data',onData);if(timer)clearTimeout(timer);rej(new Error('full response timeout'));}, 8000);
    });
  }

  // ── Read a single field from buffer at offset ────
  _dbReadField(buf, pos){
    if(pos>=buf.length)return null;
    const ft=buf[pos]; pos++;
    if(ft===0x0f){// UInt8
      if(pos>=buf.length)return null;
      return{type:'num',val:buf[pos],size:2};
    }else if(ft===0x10){// UInt16
      if(pos+1>=buf.length)return null;
      return{type:'num',val:buf.readUInt16BE(pos),size:3};
    }else if(ft===0x11){// UInt32
      if(pos+3>=buf.length)return null;
      return{type:'num',val:buf.readUInt32BE(pos),size:5};
    }else if(ft===0x14){// Binary
      if(pos+3>=buf.length)return null;
      const len=buf.readUInt32BE(pos); pos+=4;
      return{type:'blob',val:buf.slice(pos,pos+len),size:5+len};
    }else if(ft===0x26){// String UTF-16BE
      if(pos+3>=buf.length)return null;
      const len=buf.readUInt32BE(pos); pos+=4;
      const byteLen=len*2;
      let str='';
      for(let j=0;j<byteLen-1&&pos+j+1<buf.length;j+=2){
        const ch=buf.readUInt16BE(pos+j);if(ch===0)break;
        str+=String.fromCharCode(ch);
      }
      return{type:'str',val:str,size:5+byteLen};
    }
    return null;
  }

  // ── Parse metadata items from response (NumberField format) ────
  _dbParseItems(buf){
    const items = [];
    let pos = 0;
    while(pos < buf.length - 5){
      // Scan for magic: 0x11 0x872349ae
      if(buf[pos]!==0x11||buf.readUInt32BE(pos+1)!==0x872349ae){pos++;continue;}
      pos+=5; // skip magic field
      // txId: UInt32 field
      const txF=this._dbReadField(buf,pos);if(!txF)break;pos+=txF.size;
      // msgType: UInt16 field
      const typeF=this._dbReadField(buf,pos);if(!typeF)break;pos+=typeF.size;
      const msgType=typeF.val;
      // argCount: UInt8 field
      const cntF=this._dbReadField(buf,pos);if(!cntF)break;pos+=cntF.size;
      const argc=cntF.val;
      // argList: Binary field (12 bytes)
      const listF=this._dbReadField(buf,pos);if(!listF)break;pos+=listF.size;
      const tags=listF.val;
      // Read arguments
      const args = [];
      for(let i=0;i<argc&&i<12;i++){
        const f=this._dbReadField(buf,pos);
        if(!f)break;
        args.push(f);
        pos+=f.size;
      }
      if(msgType===0x4101||msgType===0x4000||msgType===0x4002){
        items.push({msgType,args});
      }
    }
    return items;
  }

  async _dbserverMetadata(ip, slot, trackId, playerNum, trackType=1){
    // Spoof as player 7 to avoid conflict with CDJs 1-6
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);

      // Send REKORDBOX_METADATA_REQ (type 0x2002)
      // trackType: 1=RB (rekordbox analyzed), 2=Unanalyzed, 5=AudioCD
      const tt = trackType || 1;
      const txId = 1;
      const rmst = this._dbRMST(spoofPlayer, 0x01, slot, tt);
      const metaReq = this._dbBuildMsg(txId, 0x2002, [rmst, this._dbArg4(trackId)]);
      sock.write(metaReq);
      const menuAvail = await this._dbReadResponse(sock);
      // Send RENDER_MENU_REQ (type 0x3000) to get all items
      // CRITICAL: must use txId+1 (different from metadata req) — CDJ requires sequential txIds
      const renderReq = this._dbBuildMsg(txId+1, 0x3000, [
        rmst, this._dbArg4(0), this._dbArg4(64),
        this._dbArg4(0), this._dbArg4(64), this._dbArg4(0)
      ]);
      sock.write(renderReq);
      const fullResp = await this._dbReadFullResponse(sock);

      // Parse menu items
      const items = this._dbParseItems(fullResp);
      // [DBSRV] render resp muted
      // [DBSRV] render 0 items muted
      const meta = {};
      for(const item of items){
        if(item.msgType===0x4101){
          // MENU_ITEM: args[3]=label1(str), args[5]=label2(str), args[6]=itemType(num), args[8]=artworkId
          const itemType = item.args[6]?.val || 0;
          const label1 = item.args[3]?.val || '';
          const label2 = item.args[5]?.val || '';
          // Debug: dump first occurrence of each item type
          // itemType debug muted
          switch(itemType){
            case 0x0004: meta.title=label1; meta.artworkId=item.args[8]?.val||0; break;
            case 0x0007: meta.artist=label1||label2; break;  // try label2 as fallback
            case 0x0002: meta.album=label1||label2; break;
            case 0x000b: meta.duration=item.args[1]?.val||0; break;
            case 0x000d: meta.bpm=(item.args[1]?.val||0)/100; break;
            case 0x000f: meta.key=label1; break;
            case 0x0006: meta.genre=label1||label2; break;
          }
        }
      }
      // [DBSRV] metadata muted

      // Store metadata into layer so TCNet DATA packets include it
      const li = playerNum - 1;
      if(li >= 0 && li < 8 && this.layers[li]){
        if(meta.title)  this.layers[li].trackName  = meta.title;
        if(meta.artist) this.layers[li].artistName = meta.artist;
        // Invalidate MetaData packet cache so it gets rebuilt with new names
        if(this._metaCache && this._metaCache[li]) this._metaCache[li] = null;
        // [DBSRV] stored metadata muted
      }

      // Emit metadata — include durationMs (precise ms) so renderer can skip integer*1000 conversion
      if(meta.title||meta.artist){
        const layerLen = (li >= 0 && li < 8 && this.layers[li]?.totalLength) || 0;
        const durationMs = layerLen > 0 ? layerLen : (meta.duration > 0 ? meta.duration * 1000 : 0);
        this.onTrackMetadata?.(playerNum, {...meta, durationMs});
      }

      // Teardown metadata connection
      try{
        const teardown = this._dbBuildMsg(0xfffffffe, 0x0100, []);
        sock.write(teardown);
      }catch(_){}

      // Stagger heavy follow-up requests so HW track load does not create a burst
      // of parallel TCP work that stalls UI/audio on slower systems.
      this._scheduleDbFollowUps(ip, slot, trackId, playerNum, tt, meta.artworkId||0);
    }catch(e){
      throw e;
    }finally{
      try{sock?.destroy();}catch(_){}
    }
  }

  async _dbserverWaveform(ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);
      const wfRmst = this._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const wfReq = this._dbBuildMsg(1, 0x2004, [
        wfRmst, this._dbArg4(0), this._dbArg4(trackId), this._dbArg4(0),
        {tag:0x03, data:this._dbBinary(Buffer.alloc(0))}
      ]);
      sock.write(wfReq);
      const wfResp = await this._dbReadFullResponse(sock);
      // Find largest Binary field — contains waveform data
      let wfData=null;
      for(let i=0;i<wfResp.length-5;i++){
        if(wfResp[i]===0x14){
          const len=wfResp.readUInt32BE(i+1);
          if(len>100&&len<100000&&i+5+len<=wfResp.length){
            wfData=wfResp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(wfData&&wfData.length>0){
        const pts=[];
        for(let i=0;i<wfData.length;i++){
          pts.push({height:wfData[i]&0x1F, color:(wfData[i]>>5)&0x07});
        }
        this.onWaveformPreview?.(playerNum, {seg:0, pts, wfType:'preview'});
        // [DBSRV] waveform preview muted
      } else {
        // [DBSRV] waveform no data muted
      }
    }finally{try{sock?.destroy();}catch(_){}}
  }

  async _dbserverWaveformDetail(ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);
      // 0x2904 = WAVE_DETAIL_REQ — 150 segments/sec, full resolution
      const wfRmst = this._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const wfReq = this._dbBuildMsg(1, 0x2904, [
        wfRmst, this._dbArg4(trackId), this._dbArg4(0)
      ]);
      sock.write(wfReq);
      const wfResp = await this._dbReadFullResponse(sock);
      // Find largest Binary field (tag 0x14)
      let wfData=null;
      for(let i=0;i<wfResp.length-5;i++){
        if(wfResp[i]===0x14){
          const len=wfResp.readUInt32BE(i+1);
          if(len>400&&len<500000&&i+5+len<=wfResp.length){
            wfData=wfResp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(wfData&&wfData.length>19){
        // Skip 19-byte header junk (LEADING_DBSERVER_JUNK_BYTES)
        const data = wfData.slice(19);
        const pts=[];
        for(let i=0;i<data.length;i++){
          pts.push({height:data[i]&0x1F, color:(data[i]>>5)&0x07});
        }
        // Waveform detail = 150 pts/sec
        // rekordbox 분석 시 실제 오디오 파일 길이 기반 → ms 정밀도 확보 가능한 유일한 소스
        this._wfTrackLen = this._wfTrackLen || {};
        this._wfTrackLen[playerNum] = Math.round(pts.length * 1000 / 150);
        this.onWaveformDetail?.(playerNum, {pts, wfType:'detail', trackLenMs:this._wfTrackLen[playerNum]});
        // [DBSRV] waveform detail muted
      } else {
        // [DBSRV] waveform detail no data muted
      }
    }catch(e){
      console.warn(`[DBSRV] P${playerNum} waveform detail failed:`,e.message);
    }finally{try{sock?.destroy();}catch(_){}}
  }

  // NXS2 extension request (0x2c04) for 3-band waveform (PWV7)
  // Returns raw bass/mid/treble bytes per entry (3 bytes/entry, 150 entries/sec)
  async _dbserverWaveformNxs2(ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);
      // PWV7 magic = 0x50575637 ("PWV7" big-endian)
      const rmst = this._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const req = this._dbBuildMsg(1, 0x2c04, [
        rmst, this._dbArg4(trackId), this._dbArg4(0),
        this._dbArg4(0x50575637) // PWV7 tag magic
      ]);
      sock.write(req);
      const resp = await this._dbReadFullResponse(sock);
      // Find binary field (tag 0x14) containing raw ANLZ tag data
      let anlzData=null;
      for(let i=0;i<resp.length-5;i++){
        if(resp[i]===0x14){
          const len=resp.readUInt32BE(i+1);
          if(len>100&&len<2000000&&i+5+len<=resp.length){
            anlzData=resp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(!anlzData||anlzData.length<20){
        // [DBSRV] nxs2 waveform no ANLZ muted
        return;
      }
      // Parse ANLZ tag structure — find PWV7 tag
      let pos=0;
      while(pos<anlzData.length-12){
        const tag=anlzData.toString('ascii',pos,pos+4);
        const tHL=anlzData.readUInt32BE(pos+4);
        const tTL=anlzData.readUInt32BE(pos+8);
        if(tag==='PWV7'){
          const dataStart=pos+tHL;
          const dataLen=tTL-tHL;
          const entries=Math.floor(dataLen/3);
          if(entries>10){
            // PWV7: 3 bytes/entry = mid, hi, low (0-255 each)
            const pts=[];
            for(let j=0;j<entries;j++){
              const off=dataStart+j*3;
              pts.push({
                low:anlzData[off+2]/255,
                mid:anlzData[off]/255,
                hi:anlzData[off+1]/255,
              });
            }
            this.onWaveformDetail?.(playerNum, {pts, wfType:'nxs2_3band'});
            // [DBSRV] NXS2 PWV7 waveform muted
            return;
          }
        }
        if(tTL===0)break;
        pos+=tTL;
      }
      // [DBSRV] nxs2 waveform PWV7 not found muted
    }catch(e){
      console.warn(`[DBSRV] P${playerNum} nxs2 waveform failed:`,e.message);
    }finally{try{sock?.destroy();}catch(_){}}
  }

  async _dbserverCuePoints(ip, slot, trackId, playerNum, trackType){
    // Try NXS2 PCO2 first (has loop end positions + RGB colors), fall back to menu 0x2104
    let cues = await this._dbserverCuePointsNxs2(ip, slot, trackId, playerNum, trackType);
    if(!cues||cues.length===0){
      cues = await this._dbserverCuePointsMenu(ip, slot, trackId, playerNum, trackType);
    }
    if(cues&&cues.length>0){
      this.onCuePoints?.(playerNum, cues);
      const hot=cues.filter(c=>c.type==='hot').length;
      const mem=cues.filter(c=>c.type==='memory').length;
      const lp=cues.filter(c=>c.type==='loop').length;
      // [DBSRV] cue points muted
    } else {
      // [DBSRV] cue points none muted
    }
  }

  // PCO2 — NXS2 extended cue list via ANLZ tag request (0x2c04)
  // Provides loop end positions, RGB colors, and comment text
  async _dbserverCuePointsNxs2(ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);
      // PCO2 magic = "PCO2" as big-endian uint32 = 0x50434F32
      const rmst = this._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const req = this._dbBuildMsg(1, 0x2c04, [
        rmst, this._dbArg4(trackId), this._dbArg4(0),
        this._dbArg4(0x50434F32) // "PCO2" tag magic
      ]);
      sock.write(req);
      const resp = await this._dbReadFullResponse(sock);
      // Find binary field (tag 0x14) containing raw ANLZ tag data
      let anlzData=null;
      for(let i=0;i<resp.length-5;i++){
        if(resp[i]===0x14){
          const len=resp.readUInt32BE(i+1);
          if(len>20&&len<500000&&i+5+len<=resp.length){
            anlzData=resp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(!anlzData||anlzData.length<20){
        // [DBSRV] PCO2 no ANLZ muted
        return null;
      }
      // Parse ANLZ tag structure — find PCO2 tag
      let pos=0;
      while(pos<anlzData.length-12){
        const tag=anlzData.toString('ascii',pos,pos+4);
        const tHL=anlzData.readUInt32BE(pos+4);
        const tTL=anlzData.readUInt32BE(pos+8);
        if(tag==='PCO2'){
          // PCO2 header: numCues at offset tHL-2 (uint16BE)
          const numCues=anlzData.readUInt16BE(pos+tHL-2);
          const cues=[];
          let ePos=pos+tHL;
          for(let ci=0;ci<numCues&&ePos<pos+tTL-12;ci++){
            // Each entry starts with "PCP2" magic
            const entTag=anlzData.toString('ascii',ePos,ePos+4);
            if(entTag!=='PCP2')break;
            const eHL=anlzData.readUInt32BE(ePos+4);
            const eTL=anlzData.readUInt32BE(ePos+8);
            if(eTL<0x1D){ePos+=eTL||1;continue;}
            const hotCue=anlzData.readUInt32BE(ePos+0x0C);
            const ctype=anlzData[ePos+0x10];  // 1=cue, 2=loop
            const timeMs=anlzData.readUInt32BE(ePos+0x14);
            const loopMs=anlzData.readUInt32BE(ePos+0x18);
            const colorCode=anlzData[ePos+0x1C];
            // Determine type
            let type='memory';
            if(hotCue>0) type='hot';
            if(ctype===2||(loopMs>0&&loopMs!==0xFFFFFFFF)){
              type='loop';
            }
            const cue={
              name:'', timeMs, hotCueNum:hotCue, colorId:colorCode,
              type, loopEndMs: type==='loop'?loopMs:0,
              colorR:30, colorG:200, colorB:60, // defaults
            };
            // Read comment text if entry is large enough
            if(eTL>=0x2C){
              try{
                const commentBytes=anlzData.readUInt32BE(ePos+0x28);
                if(commentBytes>0&&commentBytes<512){
                  const txt=anlzData.toString('utf16be',ePos+0x2C,ePos+0x2C+commentBytes).replace(/\0+$/,'');
                  cue.name=txt;
                  // RGB color after comment
                  const colorOff=ePos+0x2C+commentBytes;
                  if(colorOff+3<ePos+eTL){
                    cue.colorR=anlzData[colorOff+1];
                    cue.colorG=anlzData[colorOff+2];
                    cue.colorB=anlzData[colorOff+3];
                  }
                }
              }catch(_){}
            }
            // Default colors by type if no custom color
            if(colorCode===0){
              if(type==='memory'){cue.colorR=200;cue.colorG=30;cue.colorB=30;}
              else if(type==='loop'){cue.colorR=255;cue.colorG=136;cue.colorB=0;}
            }
            cues.push(cue);
            ePos+=eTL;
          }
          // [DBSRV] PCO2 cue entries muted
          return cues;
        }
        if(tTL===0)break;
        pos+=tTL;
      }
      // PCO2 tag not found — try PCOB fallback within same response
      pos=0;
      while(pos<anlzData.length-12){
        const tag=anlzData.toString('ascii',pos,pos+4);
        const tHL=anlzData.readUInt32BE(pos+4);
        const tTL=anlzData.readUInt32BE(pos+8);
        if(tag==='PCOB'){
          const numCues=anlzData.readUInt16BE(pos+0x12);
          const cues=[];
          let ePos=pos+tHL;
          for(let ci=0;ci<numCues&&ePos<pos+tTL-12;ci++){
            const entTag=anlzData.toString('ascii',ePos,ePos+4);
            if(entTag!=='PCPT')break;
            const eTL=anlzData.readUInt32BE(ePos+8);
            if(eTL<0x24){ePos+=eTL||1;continue;}
            const hotCue=anlzData.readUInt32BE(ePos+0x0C);
            const ctype=anlzData[ePos+0x1C];
            const timeMs=anlzData.readUInt32BE(ePos+0x20);
            const loopMs=anlzData.readUInt32BE(ePos+0x24);
            let type='memory';
            if(hotCue>0) type='hot';
            if(ctype===2||loopMs>0) type='loop';
            cues.push({
              name:'', timeMs, hotCueNum:hotCue, colorId:0, type,
              loopEndMs:type==='loop'?loopMs:0,
              colorR:type==='memory'?200:type==='loop'?255:30,
              colorG:type==='memory'?30:type==='loop'?136:200,
              colorB:type==='memory'?30:type==='loop'?0:60,
            });
            ePos+=eTL;
          }
          // [DBSRV] PCOB fallback muted
          return cues;
        }
        if(tTL===0)break;
        pos+=tTL;
      }
      // [DBSRV] PCO2/PCOB tag not found muted
      return null;
    }catch(e){
      console.warn(`[DBSRV] P${playerNum} PCO2 cue points failed:`,e.message);
      return null;
    }finally{try{sock?.destroy();}catch(_){}}
  }

  // Fallback: menu-based cue point request (0x2104)
  async _dbserverCuePointsMenu(ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);
      const rmst = this._dbRMST(spoofPlayer, 0x01, slot, trackType||1);
      const req = this._dbBuildMsg(1, 0x2104, [
        rmst, this._dbArg4(0), this._dbArg4(trackId), this._dbArg4(0)
      ]);
      sock.write(req);
      const menuAvail = await this._dbReadResponse(sock);
      const renderReq = this._dbBuildMsg(2, 0x3000, [
        rmst, this._dbArg4(0), this._dbArg4(64),
        this._dbArg4(0), this._dbArg4(64), this._dbArg4(0)
      ]);
      sock.write(renderReq);
      const fullResp = await this._dbReadFullResponse(sock);
      const items = this._dbParseItems(fullResp);
      const cues = [];
      for(const item of items){
        if(item.msgType===0x4101){
          const itemType = item.args[6]?.val || 0;
          if(itemType===0x000e){
            const name = item.args[3]?.val || '';
            const timeMs = item.args[1]?.val || 0;
            const hotCueNum = item.args[4]?.val || 0;
            const colorId = item.args[5]?.val || 0;
            cues.push({name, timeMs, hotCueNum, colorId, type: hotCueNum>0?'hot':'memory',
              loopEndMs:0, colorR:0, colorG:0, colorB:0});
          }
        }
      }
      return cues.length>0 ? cues : null;
    }catch(e){
      console.warn(`[DBSRV] P${playerNum} menu cue points failed:`,e.message);
      return null;
    }finally{try{sock?.destroy();}catch(_){}}
  }

  async _dbserverBeatGrid(ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);
      // 0x2204 = BEAT_GRID_REQ
      const rmst = this._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const req = this._dbBuildMsg(1, 0x2204, [
        rmst, this._dbArg4(trackId), this._dbArg4(0)
      ]);
      sock.write(req);
      const resp = await this._dbReadFullResponse(sock);
      // Find Binary field (tag 0x14) containing beat grid data
      let bgData=null;
      for(let i=0;i<resp.length-5;i++){
        if(resp[i]===0x14){
          const len=resp.readUInt32BE(i+1);
          if(len>20&&len<2000000&&i+5+len<=resp.length){
            bgData=resp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(bgData&&bgData.length>20){
        // Beat grid format: 20-byte header + 16-byte entries (LITTLE ENDIAN)
        // Entry: beat_within_bar(2B LE) + tempo(2B LE, BPM×100) + time_ms(4B LE) + 8B unknown
        const hdrSize=20;
        const entrySize=16;
        const numEntries=Math.floor((bgData.length-hdrSize)/entrySize);
        const beats=[];
        let totalBpm=0, bpmCount=0;
        for(let e=0;e<numEntries;e++){
          const off=hdrSize+e*entrySize;
          if(off+entrySize>bgData.length)break;
          const beatInBar=bgData.readUInt16LE(off);
          const tempoRaw=bgData.readUInt16LE(off+2);
          const timeMs=bgData.readUInt32LE(off+4);
          const bpm=tempoRaw/100;
          if(bpm>0&&bpm<999){ totalBpm+=bpm; bpmCount++; }
          beats.push({beatInBar, bpm, timeMs});
        }
        const baseBpm=bpmCount>0?Math.round(totalBpm/bpmCount*100)/100:0;
        if(beats.length>0){
          this._beatGrids[playerNum] = beats;
          // Estimate track end: last beat timeMs + one beat interval (best available for NXS2)
          const lastB = beats[beats.length-1];
          if(lastB.bpm > 0 || baseBpm > 0){
            this._bgTrackLen = this._bgTrackLen || {};
            // baseBpm = 전체 비트 평균 BPM → 마지막 beat BPM보다 정확
            const estBpm = baseBpm > 0 ? baseBpm : lastB.bpm;
            this._bgTrackLen[playerNum] = Math.round(lastB.timeMs + 60000/estBpm);
          }
          this.onBeatGrid?.(playerNum, {beats, baseBpm});
          // [DBSRV] beat grid muted
        } else {
          // [DBSRV] beat grid no entries muted
        }
      } else {
        // [DBSRV] beat grid no data muted
      }
    }catch(e){
      console.warn(`[DBSRV] P${playerNum} beat grid failed:`,e.message);
    }finally{try{sock?.destroy();}catch(_){}}
  }

  // PSSI — 곡 구조(프레이즈) 분석. 0x2c04 ANLZ tag 요청, rekordbox가 분석한 경우에만 존재.
  // 반환: { phrases:[{timeMs, kind, label, color, beat}], endMs, mood }
  async _dbserverSongStructure(ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);
      const rmst = this._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      // PSSI magic: 'P'(0x50)'S'(0x53)'S'(0x53)'I'(0x49) BE UInt32 = 0x50535349
      const req = this._dbBuildMsg(1, 0x2c04, [
        rmst, this._dbArg4(trackId), this._dbArg4(0), this._dbArg4(0x50535349)
      ]);
      sock.write(req);
      const resp = await this._dbReadFullResponse(sock);
      // ANLZ binary blob 추출
      let anlzData=null;
      for(let i=0;i<resp.length-5;i++){
        if(resp[i]===0x14){
          const len=resp.readUInt32BE(i+1);
          if(len>40 && len<200000 && i+5+len<=resp.length){
            anlzData=resp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(!anlzData || anlzData.length<40){
        // [DBSRV] song structure no ANLZ muted
        return;
      }
      // ANLZ 태그 리스트 순회 → PSSI 섹션 위치 찾기
      let pssiStart=-1, pssiEnd=-1;
      let pos=0;
      while(pos<anlzData.length-12){
        const tag=anlzData.toString('ascii',pos,pos+4);
        const tHL=anlzData.readUInt32BE(pos+4);
        const tTL=anlzData.readUInt32BE(pos+8);
        if(tag==='PSSI'){ pssiStart=pos; pssiEnd=pos+tTL; break; }
        if(tTL===0||tTL>anlzData.length-pos)break;
        pos+=tTL;
      }
      if(pssiStart<0){
        // [DBSRV] song structure PSSI absent muted
        return;
      }
      const body = anlzData.slice(pssiStart, pssiEnd);
      // PSSI body layout (big-endian):
      //  0:  "PSSI"
      //  4:  u4 len_header
      //  8:  u4 len_tag
      // 12:  u4 len_entry_bytes (or padding)
      // 16:  u2 mood_high          (1=intro, 2=up, 3=down, 5=chorus, 6=outro)
      // 18:  u2 entry_count
      // 20:  u2 raw_mood           (>20 이면 XOR 난독화 적용)
      // 22:  u2 end_beat
      // 24:  u2 bank               (하이레벨 밴크 기호)
      // 26:  u2 padding
      // 28:  entries[ ] 24B each
      if(body.length<32){
        // [DBSRV] song structure body too short muted
        return;
      }
      const hiMood = body.readUInt16BE(16);
      const entryCount = body.readUInt16BE(18);
      const rawMood = body.readUInt16BE(20);
      const endBeat = body.readUInt16BE(22);
      const entriesStart = 28;
      if(entryCount<=0 || entryCount>300){
        // [DBSRV] song structure invalid count muted
        return;
      }
      if(entriesStart + entryCount*24 > body.length){
        // [DBSRV] song structure body cut muted
        return;
      }
      // XOR 난독화 (raw_mood > 20 일 때)
      // key = XOR_MASK[i%19] + endBeat, applied from entriesStart
      const buf = Buffer.from(body); // writable copy
      if(rawMood > 20){
        const XOR_MASK = Buffer.from([
          0xCB,0xE1,0xEE,0xFA,0xE5,0xEE,0xAD,0xEE,0xE9,0xD2,
          0xE9,0xEB,0xE1,0xE9,0xF3,0xE8,0xE9,0xF4,0xE1
        ]);
        const eb = endBeat & 0xFF;
        const total = entryCount*24;
        for(let i=0;i<total;i++){
          const m = (XOR_MASK[i%19] + eb) & 0xFF;
          buf[entriesStart+i] = buf[entriesStart+i] ^ m;
        }
      }
      // 비트그리드 준비 (없으면 BPM+anchor로 추정)
      const beatGrid = this._beatGrids && this._beatGrids[playerNum];
      const b2ms = (beat)=>{
        if(beatGrid && beat>=1 && beat<=beatGrid.length) return beatGrid[beat-1].timeMs;
        return 0;
      };
      // entries 파싱
      const phrases = [];
      for(let e=0;e<entryCount;e++){
        const off = entriesStart + e*24;
        const idx  = buf.readUInt16BE(off+0);
        const beat = buf.readUInt16BE(off+2);
        const kind = buf.readUInt16BE(off+4);
        const timeMs = b2ms(beat);
        const meta = this._phraseKindMeta(hiMood, kind);
        phrases.push({ index:idx, beat, kind, timeMs, label:meta.label, color:meta.color });
      }
      // 트랙 종료 시각
      let endMs = b2ms(endBeat);
      if(!endMs){
        if(beatGrid && beatGrid.length>0) endMs = beatGrid[beatGrid.length-1].timeMs;
        else if(this._bgTrackLen && this._bgTrackLen[playerNum]) endMs = this._bgTrackLen[playerNum];
      }
      // 시각순 정렬 + 유효한 엔트리만
      phrases.sort((a,b)=>a.timeMs-b.timeMs);
      const valid = phrases.filter(p=>p.timeMs>=0);
      if(valid.length>0){
        this._songStructures = this._songStructures || {};
        this._songStructures[playerNum] = { phrases:valid, endMs, mood:hiMood };
        this.onSongStructure?.(playerNum, { phrases:valid, endMs, mood:hiMood });
        // [DBSRV] song structure phrases muted
      }
    }catch(e){
      console.warn(`[DBSRV] P${playerNum} song structure failed:`,e.message);
    }finally{try{sock?.destroy();}catch(_){}}
  }

  // 프레이즈 종류 → 라벨/색상 맵. mood_high 에 따라 의미가 달라지지만
  // 세부 스펙 미확정 구간은 kind 숫자 기반 기본 매핑으로 표시.
  _phraseKindMeta(hiMood, kind){
    const COL_INTRO='#2c5fe0', COL_VERSE='#32be5a', COL_VERSE2='#30a8a0';
    const COL_BRIDGE='#8844cc', COL_CHORUS='#e04080', COL_OUTRO='#2c5fe0';
    const COL_UP='#f59e0b', COL_DOWN='#64748b', COL_DEFAULT='#6b7280';
    // mood_high=1: intro/outro 중심 구조
    if(hiMood===1){
      if(kind===1) return {label:'Intro', color:COL_INTRO};
      if(kind===2) return {label:'Verse', color:COL_VERSE};
      if(kind===3) return {label:'Bridge', color:COL_BRIDGE};
      if(kind===5) return {label:'Chorus', color:COL_CHORUS};
      if(kind===6) return {label:'Outro', color:COL_OUTRO};
    }
    // mood_high=2: up-tempo 구조
    if(hiMood===2){
      if(kind>=1 && kind<=3) return {label:`Up${kind}`, color:COL_UP};
      if(kind===5) return {label:'Chorus', color:COL_CHORUS};
      if(kind===6) return {label:'Outro', color:COL_OUTRO};
    }
    // mood_high=3: down-tempo 구조
    if(hiMood===3){
      if(kind>=1 && kind<=3) return {label:`Down${kind}`, color:COL_DOWN};
      if(kind===5) return {label:'Chorus', color:COL_CHORUS};
      if(kind===6) return {label:'Outro', color:COL_OUTRO};
    }
    // 기본 매핑
    const DEF={1:{label:'Intro',color:COL_INTRO},2:{label:'Verse',color:COL_VERSE},
      3:{label:'Verse2',color:COL_VERSE2},4:{label:'Bridge',color:COL_BRIDGE},
      5:{label:'Chorus',color:COL_CHORUS},6:{label:'Outro',color:COL_OUTRO}};
    return DEF[kind] || {label:`P${kind}`, color:COL_DEFAULT};
  }

  async _dbserverArtwork(ip, slot, artworkId, playerNum, cacheKey){
    const spoofPlayer = 5;
    let sock;
    try{
      sock = await this._dbConnect(ip, spoofPlayer);
      const artRmst = this._dbRMST(spoofPlayer, 0x08, slot, 0x01);
      const artReq = this._dbBuildMsg(1, 0x2003, [artRmst, this._dbArg4(artworkId)]);
      sock.write(artReq);
      const artResp = await this._dbReadFullResponse(sock);
      // [DBSRV] artwork resp muted
      // Find JPEG or PNG
      let imgStart = artResp.indexOf(Buffer.from([0xFF,0xD8]));
      let imgEnd = imgStart>=0 ? artResp.lastIndexOf(Buffer.from([0xFF,0xD9])) : -1;
      let mime = 'image/jpeg';
      if(imgStart<0){
        imgStart = artResp.indexOf(Buffer.from([0x89,0x50,0x4E,0x47]));
        if(imgStart>=0){ imgEnd = artResp.length; mime = 'image/png'; }
      }
      if(imgStart>=0 && imgEnd>imgStart){
        const img = artResp.slice(imgStart, mime==='image/jpeg'?imgEnd+2:imgEnd);
        const b64 = `data:${mime};base64,` + img.toString('base64');
        this._artCache[cacheKey] = b64;
        this.onAlbumArt?.(playerNum, b64);
        // [DBSRV] artwork muted
        // Store in virtual dbserver — Arena fetches via ProDJ Link dbserver protocol
        this.setVirtualArt(playerNum-1, img);
      } else {
        // [DBSRV] artwork no image muted
      }
    }finally{try{sock?.destroy();}catch(_){}}
  }
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
