'use strict';
/**
 * BridgeCore — TCNet v3.5 node + Pro DJ Link receiver
 *
 * Sends OptIn(0x02) + Status(0x05) + TIME(0xFE) on TCNet ports.
 * Receives CDJ status and DJM meter data via Pro DJ Link (UDP 50001/50002).
 * Packet layouts reverse-engineered from BRIDGE36 pcap captures.
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
  VER   : Buffer.from([0x03, 0x06]),  // TCNet V3.5.1B spec: protocol wire version 3.6
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
};

// TCNet V3.5.1B LayerStatus values — these ARE the protocol values, send directly
// ROLLBACK: was using toTCNetState() that collapsed CUEDOWN(7)/PLATTERDOWN(8) to 2(Paused)
const STATE = { IDLE:0, PLAYING:3, LOOPING:4, PAUSED:5, STOPPED:6, CUEDOWN:7, PLATTERDOWN:8, FFWD:9, FFRV:10, HOLD:11 };
// Identity function — STATE values are already TCNet protocol values
function toTCNetState(s){ return s || 0; }

// Pro DJ Link P1 (0x7B) → TCNet LayerStatus 매핑
// 소스: prolink-connect PlayState enum + Deep Symmetry djl-analysis
// TCNet V3.5.1B: 0=IDLE,3=PLAYING,4=LOOPING,5=PAUSED,6=STOPPED,7=CUE,8=PLATTER,9=FFWD,10=FFRV,11=HOLD
const P1_TO_STATE = {
  0x00: STATE.IDLE,          // Empty — 트랙 없음
  0x02: STATE.STOPPED,       // Loading — 트랙 로딩 중
  0x03: STATE.PLAYING,       // Playing — 재생
  0x04: STATE.LOOPING,       // Looping — 루프 재생
  0x05: STATE.PAUSED,        // Paused — 일시정지
  0x06: STATE.CUEDOWN,       // Cued — 큐 포인트에서 정지 (큐 버튼 홀드)
  // ROLLBACK: 0x07 was PLAYING — prolink-connect: Cuing = 큐 탐색 중 (재생 아님)
  0x07: STATE.CUEDOWN,       // Cuing — 큐 포인트 탐색
  0x08: STATE.PLATTERDOWN,   // PlatterHeld — 플래터 누름 (바이닐 모드)
  // ROLLBACK: 0x09 was PAUSED — TCNet에 FFWD(9) 상태 존재
  0x09: STATE.FFWD,          // Searching — 탐색 (빨리감기/되감기)
  0x0D: STATE.STOPPED,       // End — 트랙 끝 (루프 없이)
  // ROLLBACK: 0x0E was STOPPED — TCNet에 HOLD(11) 상태 존재
  0x0E: STATE.HOLD,          // SpunDown — 플래터 감속 정지 (홀드)
  // ROLLBACK: 0x11 was PLAYING — prolink-connect: Ended = 트랙 끝
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

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────
let _seq = 0;
const u32 = n => (Math.max(0,n)&0xFFFFFFFF)>>>0;
const clamp8 = n => Math.max(0,Math.min(255,Math.round(n)))&0xFF;

// UTF-32LE writer — matches official Bridge TCNetOutput.h writeUtf32LE()
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
  d.writeUInt16LE(nc||2, 0);           // body[0-1]: nodeCount (BRIDGE36: 2)
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
 * body layout (node-tcnet spec):
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

  // layerSource[0-7] at body[8-15] — matches official Bridge offset
  for(let n=0;n<8;n++){
    const hasLayer = layers && layers[n];
    const isHW = hwMode && hwMode[n];
    d[8+n] = (hasLayer || isHW) ? (n+1) : 0;
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
  d[60] = 0x00;  // autoMasterMode = 0 (matching official Bridge)

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
 * body layout (node-tcnet spec):
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

  // generalSMPTEMode at body[81] — 30fps (TCNet spec: valid values 24/25/29/30; 0=invalid)
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
    // TCNet v3.5.1B spec offsets (body-relative, i.e. subtract 24 from absolute byte#)
    d[3] = toTCNetState(layerData.state||0);   // byte 27: Layer State (TCNet: 0=Idle,1=Playing,2=Paused,3=Stopped)
    d[5] = 0x01;                 // byte 29: Sync Master (1=Master)
    d[7] = layerData.beatPhase || 0; // byte 31: Beat Marker (0-4)
    d.writeUInt32LE(layerData.totalLength || 0, 8);   // byte 32: Track Length (ms)
    let curMs = layerData.timecodeMs || 0;
    const isPlaying = layerData.state === STATE.PLAYING || layerData.state === STATE.LOOPING;
    if(isPlaying && layerData._updateTime) curMs += (Date.now() - layerData._updateTime);
    d.writeUInt32LE(u32(curMs), 12);    // byte 36: Current Position (ms)
    // byte 40: Speed — TCNet spec: 32768=100%, 0=0%, 65536=200%
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
      console.log(`[METRICS] L${layerIdx} state=${d[3]} speed=${speedVal} bpm=${bpm} pos=${Math.round(curMs)}ms dur=${layerData.totalLength}ms track="${layerData.trackName||''}" artist="${layerData.artistName||''}"`);
    }
  }

  return b;
}

/**
 * DATA MixerData (0xC8, sub-type 150) — 270B
 * TCNet v3.5.1B spec: per-channel fader, EQ, filter, crossfader, master
 */
function mkMixerData(faders, mixerName){
  const b = Buffer.alloc(270);
  buildHdr(TC.DATA).copy(b, 0);
  const d = b.slice(TC.H);  // body 246B

  d[0] = 150;  // DataType = Mixer Data
  d[1] = 1;    // Mixer ID
  d[2] = 0;    // Mixer Type
  // Mixer Name at body offset 5 (byte 29), 16 chars
  const nm = (mixerName || 'DJM-900NXS2').padEnd(16, '\0');
  Buffer.from(nm, 'ascii').copy(d, 5, 0, 16);
  // Master Audio Level (byte 61)
  d[37] = 255;
  // Master Fader Level (byte 62)
  d[38] = 255;
  // Cross Fader (byte 99) — center
  d[75] = 127;
  // Per-channel data: each channel block starts at byte 125 + (ch * 24)
  // Channel N block: [+0]=SourceSelect, [+1]=AudioLevel, [+2]=FaderLevel, [+3]=TrimLevel
  for(let ch=0; ch<4; ch++){
    const off = 101 + ch * 24;  // body offset for channel block (byte 125 = body 101)
    d[off]   = ch + 1;          // Source Select (1-4)
    d[off+1] = faders?.[ch] || 0; // Audio Level (0-255)
    d[off+2] = faders?.[ch] || 0; // Fader Level (0-255)
    d[off+3] = 200;             // Trim Level (default 200/255)
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
 * TCNet V3.5.1B spec page 29: File Data Packet - Low Res Artwork File
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
    b.writeUInt32LE(jpegBuf.length, TC.H + 2);   // total Data Size (LE per spec)
    b.writeUInt32LE(totalPackets,   TC.H + 6);   // Total Packets (LE per spec)
    b.writeUInt32LE(i,              TC.H + 10);  // Packet No (LE per spec)
    b.writeUInt32LE(CLUSTER_SIZE,   TC.H + 14);  // Data Cluster Size = 4800 (LE per spec)
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
    // Deep Symmetry: device number at 0x21 (NXS2), also at 0x24 (CDJ-3000)
    // Try 0x21 first (works for both NXS2 and CDJ-3000), fallback to 0x24
    // ROLLBACK: was `const pNum = msg[0x24]` only
    let pNum = msg[0x21]; if(pNum<1||pNum>6) pNum = msg[0x24];
    if(pNum<1||pNum>6) return null;
    const p1   = msg[0x7B];
    const state= P1_TO_STATE[p1] ?? STATE.IDLE;
    // BPM: uint16BE at 0x92–0x93 = TRACK BPM (original, no pitch) × 100
    // Ref: https://djl-analysis.deepsymmetry.org/djl-analysis/vcdj.html
    const bpmRaw16 = msg.length>0x93 ? msg.readUInt16BE(0x92) : 0;
    const trackBpm = (bpmRaw16>0 && bpmRaw16!==0xFFFF) ? bpmRaw16/100 : 0;
    // Pitch: 3 bytes uint24 at 0x8D (prolink-connect + beat-link confirmed: 0x8D, NOT 0x8C)
    // Deep Symmetry docs say 4B at 0x8C but actual implementations read 3B at 0x8D
    // Neutral = 0x100000, range: 0x000000(-100%) ~ 0x200000(+100%)
    const pitchRaw = msg.length>0x8F ? (msg[0x8D]*65536 + msg[0x8E]*256 + msg[0x8F]) : 0x100000;
    const pitch = (pitchRaw-0x100000)/0x100000*100;
    // effectivePitch at 0x99 (3B) — includes jog wheel nudge (prolink-connect confirmed)
    const effPitchRaw = msg.length>0x9B ? (msg[0x99]*65536 + msg[0x9A]*256 + msg[0x9B]) : pitchRaw;
    const effPitch = (effPitchRaw-0x100000)/0x100000*100;
    // Effective BPM: use effectivePitch when available (jog wheel 반영)
    let bpmEff = trackBpm>0 ? Math.round(trackBpm*(1+effPitch/100)*100)/100 : 0;
    if(bpmEff > 500) bpmEff = 0;  // sanity: no track exceeds 500 BPM
    const baseBpm = trackBpm;
    const beatNum   = msg.length>0xA3 ? msg.readUInt32BE(0xA0) : 0;
    const beatInBar = msg.length>0xA6 ? msg[0xA6] : 0;
    const barsRemain = msg.length>0xA5 ? msg.readUInt16BE(0xA4) : 0;
    const trackBeats = msg.length>0xB7 ? msg.readUInt32BE(0xB4) : 0;
    // Playback position fraction 0x48-0x4B (prolink-connect confirmed): uint32BE / 1000 = 0.0~1.0
    // Available on CDJ-2000NXS2 and CDJ-3000 — gives absolute position for any track including BPM-less
    const posFracRaw = msg.length>0x4B ? msg.readUInt32BE(0x48) : 0;
    const positionFraction = (posFracRaw>0 && posFracRaw<=1000) ? posFracRaw/1000 : 0;
    // Flags byte F at 0x89 (Deep Symmetry spec):
    //   bit 6 = playing, bit 5 = master, bit 4 = sync, bit 3 = on-air
    const flags = msg.length>0x89 ? msg[0x89] : 0;
    const isSync   = !!(flags & 0x10);  // bit 4
    const isMaster = !!(flags & 0x20);  // bit 5
    const isOnAir  = !!(flags & 0x08);  // bit 3
    // Vinyl/CDJ jog mode at 0x9D (P3)
    const p3 = msg.length>0x9D ? msg[0x9D] : 0;
    const isVinylMode = (p3===0x09 || p3===0x0A); // forward/backward vinyl
    // Speed multiplier from Pitch 1: pitchRaw/0x100000 (beat-link method)
    // Note: pitchRaw stays non-zero even when paused — use state for play/stop detection
    const pitchMultiplier = pitchRaw / 0x100000;  // 1.0 = normal speed
    return{
      kind:'cdj', playerNum:pNum, name, deviceName:name, p1, state,
      p1Name: P1_NAME[p1]||`0x${p1.toString(16)}`,
      isPlaying: state===STATE.PLAYING || state===STATE.FFWD || state===STATE.FFRV,
      isLooping: state===STATE.LOOPING,
      bpm:bpmEff, bpmTrack:baseBpm, bpmEffective:bpmEff,
      pitch, effectivePitch:effPitch, pitchMultiplier,
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
    // Type 0x29 — flat layout per Deep Symmetry docs
    // Faders at 0x0F-0x12 (0-0x7F), scale to 0-255
    const ch=[0,1,2,3].map(c=>{ const v=msg[0x0F+c]||0; return Math.min(255,Math.round(v*255/0x7F)); });
    const xfader=Math.min(255,Math.round((msg[0x13]||0)*255/0x7F));
    const masterLvl=Math.min(255,Math.round((msg[0x14]||0)*255/0x7F));
    const hpLevel=msg.length>0x15?Math.min(255,Math.round(msg[0x15]*255/0x7F)):0;
    const hpCueCh=msg.length>0x16?msg[0x16]:0;
    // EQ: 0x17 + ch*3, each [Hi,Mid,Lo] 0x00-0x7F
    const eq=[0,1,2,3].map(c=>{
      const b=0x17+c*3;
      return[ b<msg.length?msg[b]:0x40, b+1<msg.length?msg[b+1]:0x40, b+2<msg.length?msg[b+2]:0x40 ];
    });
    const onAir=[0,0,0,0]; // type 0x29 has no on-air field, comes from type 0x03
    if(!parsePDJL._djm29Logged){
      parsePDJL._djm29Logged=true;
      const hex=Array.from(msg.slice(0,Math.min(56,msg.length))).map(x=>x.toString(16).padStart(2,'0')).join(' ');
      try{console.log(`[DJM-0x29] len=${msg.length} hex=[${hex}]`);}catch(_){}
    }
    try{console.log(`[DJM-0x29] faders=[${ch}] eq=${JSON.stringify(eq)} xf=${xfader} mVol=${masterLvl}`);}catch(_){}
    return{kind:'djm',name,channel:ch,onAir,eq,xfader,masterLvl,boothLvl:0,hpLevel,hpCueCh,chExtra:[]};
  }
  if(type===PDJL.DJM && msg.length>=0x80){
    // Type 0x39 — block layout: 4ch × 24B starting at 0x24
    const CH_BASE=0x24, CH_STRIDE=0x18;
    const ch=[0,1,2,3].map(c=>{ const off=CH_BASE+c*CH_STRIDE+3; return off<msg.length?msg[off]:0; });
    const onAir=[0,1,2,3].map(c=>{ const off=CH_BASE+c*CH_STRIDE+11; return off<msg.length?msg[off]:0; });
    const eq=[0,1,2,3].map(c=>{
      const base=CH_BASE+c*CH_STRIDE;
      return[ base<msg.length?msg[base]:0x40, base+1<msg.length?msg[base+1]:0x40, base+2<msg.length?msg[base+2]:0x40 ];
    });
    const chExtra=[0,1,2,3].map(c=>{
      const base=CH_BASE+c*CH_STRIDE; const extra={};
      for(let b=4;b<=23;b++){if(base+b<msg.length)extra['b'+b]=msg[base+b];}
      return extra;
    });
    const gBase=CH_BASE+4*CH_STRIDE; // 0x84
    const xfader=(gBase<msg.length)?msg[gBase]:127;
    const masterLvl=(gBase+1<msg.length)?msg[gBase+1]:0;
    const boothLvl=(gBase+2<msg.length)?msg[gBase+2]:0;
    const hpLevel=(gBase+3<msg.length)?msg[gBase+3]:0;
    const hpCueCh=(gBase+4<msg.length)?msg[gBase+4]:0;
    // Debug hex dump: first receive + periodically
    if(!parsePDJL._djm39Logged){
      parsePDJL._djm39Logged=true;
      const hex=[0,1,2,3].map(c=>{const b=CH_BASE+c*CH_STRIDE;return`CH${c+1}[${Array.from(msg.slice(b,Math.min(b+24,msg.length))).map(x=>x.toString(16).padStart(2,'0')).join(' ')}]`;}).join(' ');
      const gHex=msg.length>gBase?Array.from(msg.slice(gBase,Math.min(gBase+32,msg.length))).map(x=>x.toString(16).padStart(2,'0')).join(' '):'(none)';
      try{console.log(`[DJM-0x39] len=${msg.length}\n  ${hex}\n  GLOBAL@0x${gBase.toString(16)}=[${gHex}]`);}catch(_){}
    }
    if(!parsePDJL._lastDjm||parsePDJL._lastDjm.some((v,i)=>v!==ch[i])){
      parsePDJL._lastDjm=ch.slice();
      try{console.log(`[DJM-0x39] faders=[${ch}] onair=[${onAir}] eq=${JSON.stringify(eq)} xf=${xfader} mVol=${masterLvl}`);}catch(_){}
    }
    return{kind:'djm',name,channel:ch,onAir,eq,xfader,masterLvl,boothLvl,hpLevel,hpCueCh,chExtra};
  }
  // DJM VU Metering (type 0x58, ~524B, port 50001)
  // 15-band spectrum per channel: base 0xA4, stride 0x3C, uint16BE per band
  if(type===PDJL.DJM_METER && msg.length>=0x180){
    const MBASE=0xA4, MSTEP=0x3C;
    const ch=[0,1,2,3].map(c=>{
      let peak=0;
      for(let b=0;b<15;b++){
        const off=MBASE+c*MSTEP+b*2;
        if(off+1<msg.length){const v=msg.readUInt16BE(off);if(v>peak)peak=v;}
      }
      return Math.min(255,Math.round(peak/9200*255));
    });
    // 15-band spectrum raw data per channel (normalized 0-255)
    const spectrum=[0,1,2,3].map(c=>{
      const bands=[];
      for(let b=0;b<15;b++){
        const off=MBASE+c*MSTEP+b*2;
        if(off+1<msg.length){bands.push(Math.min(255,Math.round(msg.readUInt16BE(off)/9200*255)));}
        else bands.push(0);
      }
      return bands;
    });
    return{kind:'djm_meter',name,ch,spectrum};
  }
  // DJM Channels On-Air (type 0x03, 45B, port 50001)
  if(type===PDJL.DJM_ONAIR && msg.length>=0x2C){
    const name2 = msg.slice(0x0B,0x1B).toString('ascii').replace(/\0/g,'').trim();
    if(name2.includes('DJM')){
      // On-air flags at consecutive bytes: CH1=0x24, CH2=0x25, CH3=0x26, CH4=0x27
      // Confirmed via beat-link source: data[0x23 + channel] for channel 1-4
      // DJM-V10 (6ch): additionally CH5=0x2D, CH6=0x2E (packet length 0x35)

      // ── FADER HUNT: log ALL bytes in packet, track any variation ──
      // We're looking for analog fader values (0-255 range) beyond the binary on-air flags
      if(!parsePDJL._djm03First){
        parsePDJL._djm03First=true;
        const hex=Array.from(msg).map((b,i)=>`[0x${i.toString(16).padStart(2,'0')}]=0x${b.toString(16).padStart(2,'0')}`).join(' ');
        console.log(`[DJM-0x03] FULL DUMP len=${msg.length}: ${hex}`);
      }
      // Track any byte that changes value — indicates potential fader/level data
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

      // Bytes 0x29-0x2B: independent binary flags — captured analysis shows these
      // differ from on-air state; likely headphone CUE selection per channel (CH2-CH4)
      // (DJM-900NXS2 never sends type 0x39, so these are the only per-channel extras)
      const cueCh=[0, msg.length>0x29?msg[0x29]:0, msg.length>0x2A?msg[0x2A]:0, msg.length>0x2B?msg[0x2B]:0];
      return{kind:'djm_onair',name:name2,
        onAir:[msg[0x24]?1:0, msg[0x25]?1:0, msg[0x26]?1:0, msg[0x27]?1:0],
        cueCh};
    }
  }
  // Type 0x02 = Fader Start (DJM → CDJ, port 50001, ~50B)
  // Commands: 0x00=start, 0x01=stop+cue, 0x02=maintain
  if(type===0x02 && msg.length>=42){
    const name2=msg.slice(0x0B,0x1B).toString('ascii').replace(/\0/g,'').trim();
    // Fader start: logged once per session via _pdjlDbg above
    // Per docs: bytes 42-45 = C1,C2,C3,C4 commands
    if(msg.length>=46){
      return{kind:'fader_start',name:name2,ch:[msg[42],msg[43],msg[44],msg[45]]};
    }
  }
  // Type 0x28 = Beat packet (96B on port 50001) — beat timing + position data
  // STC reference: offset 84=pitch(u32BE), 90=bpm(u16BE×100), 92=beatInBar(1-4)
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
    return{kind:'announce',name,playerNum:msg.length>0x24?msg[0x24]:0};
  }
  // CDJ-3000 Absolute Position (type 0x0b, port 50001, ~60B, ~30Hz pairs)
  // CDJ-3000 sends PAIRS: 1) real data (byte[33]=player 1-6), 2) garbage (byte[33]>=0x80)
  // Filter by player number range (no sub-type byte — STC confirmed)
  // Offsets: [38-39] trackLen(s) uint16BE, [40-43] playhead(ms), [44-47] pitch, [56-59] bpm*10
  // Note: bytes[36-37] are separate fields (not part of trackLength).
  // Only bytes[38-39] as uint16BE give correct duration across all CDJ-3000 units.
  // CDJ-3000 Precise Position (type 0x0b, exactly 60B, port 50001)
  // IMPORTANT: NXS2 also sends type 0x0b packets with different structure — validate parsed values
  if(type===0x0b && msg.length>=60){
    const pNum = msg[33];
    if(pNum>=1 && pNum<=6){
      const trackLenSec = msg.readUInt16BE(38);
      const playheadRaw = msg.readUInt32BE(40);
      const pitchRaw2 = msg.readInt32BE(44);
      const bpmRaw10 = msg.readUInt32BE(56);
      // Sanity check: reject garbage from non-CDJ-3000 models
      // Valid: trackLen < 24h, playhead < trackLen, BPM 20-500, pitch ±50%
      const bpmCheck = bpmRaw10/10;
      const sane = trackLenSec > 0 && trackLenSec < 86400
                && playheadRaw <= trackLenSec * 1000
                && bpmCheck > 20 && bpmCheck < 500
                && Math.abs(pitchRaw2) < 5000;
      if(!sane){
        // Not a valid CDJ-3000 precise_pos — skip silently
        return null;
      }
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
    this.pdjlPort      = null;
    this.startTime     = Date.now();
    this.running       = false;
    this.packetCount   = 0;
    this._timers       = [];

    this.layers  = new Array(8).fill(null);   // 8 layers (1-8)
    this.hwMode  = new Array(8).fill(false);
    this.nodes   = {};
    this.devices = {};
    this.faders  = [0,0,0,0];
    this.onAir   = [0,0,0,0];  // DJM Channels-On-Air flags
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
    this.onAlbumArt       = null;   // (playerNum, jpegBuffer) => {}
    this._artCache = {};  // trackId -> {playerNum, jpegBase64}
    this._beatGrids = {};  // playerNum -> [{beatInBar, bpm, timeMs}]
    this._dbConns  = {};  // ip -> net.Socket
    this._virtualArt = {};  // slot -> Buffer (JPEG data for virtual deck artwork)
    this._dbSrv = null;  // virtual dbserver (TCP 12523 emulation)
    this._lastVdbTrackId = 0;  // last trackId from 0x2002 (cross-connection fallback)
    this._djmSeenTypes = new Set();
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
          res();
        });
      };
      tryBind(0);
    });

    // Arena sends MetadataRequest(0x14) to Bridge's txSocket source port
    this.txSocket.on('message',(msg,rinfo)=>this._handleTCNetMsg(msg, rinfo, 'tx-RX'));

    // Dedicated DATA socket — official Bridge sends DATA/Metrics/Meta from separate ephemeral port
    this._dataSocket = dgram.createSocket({type:'udp4', reuseAddr:true});
    this._dataSocket.on('error',()=>{});
    await new Promise(r=>this._dataSocket.bind(0, this.isLocalMode?'127.0.0.1':undefined, r));
    console.log(`[TCNet] DATA socket bound to port ${this._dataSocket.address().port}`);

    this.running = true; this.startTime = Date.now();

    await this._startListenerPortRx();

    // Transmission rates matching BRIDGE36 captures:
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
    // Sent via dedicated _dataSocket (separate from txSocket) — matches official Bridge architecture
    const t4 = setInterval(()=>this._sendDataCycle(), 170);
    // Mixer Data (Type 150) — fader levels to Arena at 10fps (on-air is binary, no need for 60fps)
    const t5 = setInterval(()=>{
      if(!this.running) return;
      const djm = Object.values(this.devices).find(d=>d.type==='DJM');
      const pkt = mkMixerData(this.faders, djm?.name);
      this._sendDataToArenas(pkt);
    }, 100);

    this._timers = [t1, t2, t3, t4, t5];
    this._startTCNetRx();

    // Start PDJL receiver in all modes (local mode uses pcap-replay simulation)
    await this._startPDJLRx();
    if(!this.isLocalMode) this._startPDJLAnnounce();
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
      for(let i=0;i<3;i++) this._send(b,TC.P_BC);
      // Also send to ALL network interfaces' broadcast addresses (covers WiFi, LAN, etc.)
      const allIfaces = getAllInterfaces().filter(i=>!i.internal&&i.broadcast);
      for(const iface of allIfaces){
        for(let i=0;i<2;i++){
          try{this.txSocket.send(b,0,b.length,TC.P_BC,iface.broadcast);}catch(_){}
        }
      }
      // Also send directly to each known Arena's listener port (unicast)
      for(const[,n] of Object.entries(this.nodes||{})){
        if(n.lPort&&n.ip){
          try{this.txSocket.send(b,0,b.length,n.lPort,n.ip);}catch(_){}
          try{this.txSocket.send(b,0,b.length,TC.P_BC,n.ip);}catch(_){}
        }
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
      this._pdjlSockets=[];
      // _pdjlAnnSock may be shared with _pdjlSockets[0], don't double-close
      if(this._pdjlAnnSock && !this._pdjlSockets?.includes(this._pdjlAnnSock)){
        try{this._pdjlAnnSock.close();}catch(_){}
      }
      this._pdjlAnnSock=null;
      try{this._dbKaSock?.close();}catch(_){}
      this._dbKaSock=null;
      try{this._djmSubSock?.close();}catch(_){}
      this._djmSubSock=null;
      console.log('[BridgeCore] sockets closed');
    };
    setTimeout(closeSockets, 100);
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
    this.onDJMMeter=null; this.onDeviceList=null; this.onWaveformPreview=null; this.onWaveformDetail=null; this.onCuePoints=null; this.onBeatGrid=null;
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

  // ── Live rebind: Pro DJ Link interface ──
  async rebindPDJL(newAddr){
    if(!this.running) return;
    const prev = this.pdjlBindAddr;
    this.pdjlBindAddr = newAddr||null;
    console.log(`[PDJL] rebind ${prev||'auto'} → ${newAddr||'auto'}`);

    // Close existing PDJL sockets
    if(this._pdjlAnnSock && !this._pdjlSockets?.includes(this._pdjlAnnSock)){
      try{this._pdjlAnnSock.close();}catch(_){}
    }
    this._pdjlAnnSock=null;
    if(this._pdjlSockets){ this._pdjlSockets.forEach(s=>{try{s.close();}catch(_){}}); }
    else if(this.pdjlSocket){ try{this.pdjlSocket.close();}catch(_){} }
    this._pdjlSockets=[]; this.pdjlSocket=null; this.pdjlPort=null;
    // Clear PDJL announce timer
    if(this._pdjlAnnTimer){ clearInterval(this._pdjlAnnTimer); this._pdjlAnnTimer=null; }

    await this._startPDJLRx();
    if(!this.isLocalMode) this._startPDJLAnnounce();
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
      if(this.localAddr){
        try{ this.txSocket.send(buf, 0, buf.length, port, this.localAddr); }catch(_){}
      }
      try{ this.txSocket.send(buf, 0, buf.length, port, '127.0.0.1'); }catch(_){}
    }
  }
  _uc(buf, port, ip){
    if(!this.running||!ip||!port) return;
    // Use dedicated _dataSocket for DATA responses (official Bridge pattern)
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

  /** Send to each Arena's originating source port (distinct from lPort). */
  _sendToArenasSourcePort(buf){
    if(!this.running||!this.txSocket) return;
    for(const node of Object.values(this.nodes)){
      if(Date.now()-node.lastSeen > 15000) continue;
      if(!node.port || node.port === node.lPort) continue;  // lPort와 같으면 중복 전송 방지
      try{ this.txSocket.send(buf, 0, buf.length, node.port, node.ip); }catch(_){}
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

  /** Send DATA packets via dedicated _dataSocket to Arena lPort (official Bridge pattern). */
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
    console.log(`[TCNET-ART] L${layerIdx} sending ${packets.length} artwork packets (${jpegBuf.length}B) JPEG=${isJpeg} endFFD9=${endOk} hdr=[${jpegBuf[0].toString(16)},${jpegBuf[1].toString(16)}] → [${targets.join(', ')}] local=${this.isLocalMode}`);
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

    // Send via dedicated _dataSocket (official Bridge architecture)
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
        try{console.log(`[ST] layers: ${ls.join(' | ')} hwMode=[${this.hwMode.slice(0,4)}]`);}catch(_){}
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
    const type = msg[7];
    const name = msg.slice(8,16).toString('ascii').replace(/\0/g,'').trim();
    if(name.toUpperCase().startsWith('BRIDGE')) return;

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
    // body: [layer(1-based), reqType(1-8)]; reply with MetaData + MetricsData
    if(type===0x14){
      const body = msg.slice(TC.H);
      const layerReq = body.length>=1 ? body[0] : 0;  // 1-based
      const reqType = body.length>=2 ? body[1] : 0;
      const li = layerReq - 1;  // convert to 0-indexed
      const layerData = (li >= 0 && li < this.layers.length) ? this.layers[li] : null;
      // MetaReq logs suppressed (too frequent)
      const metaPkt = mkDataMeta(layerReq, layerData);
      this._uc(metaPkt, rinfo.port, rinfo.address);
      const faderVal = this.faders ? (this.faders[li] || 0) : 0;
      const metricsPkt = mkDataMetrics(layerReq, layerData, faderVal);
      this._uc(metricsPkt, rinfo.port, rinfo.address);
      // MetaResp log suppressed (too frequent, causes FPS drop)
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
        const type = msg[7];
        const name = msg.slice(8,16).toString('ascii').replace(/\0/g,'').trim();
        if(name.toUpperCase().startsWith('BRIDGE')) return;

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
    // macOS: ALL PDJL ports bind to INADDR_ANY (0.0.0.0)
    // to receive both broadcast and unicast packets from CDJs and DJMs.
    // Binding 50002 to specific IP blocks DJM mixer status packets from other interfaces.
    // Standard PDJL ports + extra Pioneer ports (fader data might arrive on unknown port)
    for(const port of [50000, 50001, 50002, 50003, 50004]){
      try{
        const sock = dgram.createSocket({type:'udp4', reuseAddr:true});
        const bindAddr = undefined; // always INADDR_ANY for all ports
        await new Promise((res,rej)=>{
          sock.on('error',rej);
          sock.bind(port, bindAddr, ()=>{ try{sock.setBroadcast(true);}catch(_){} res(); });
        });
        sock.on('message',(msg,rinfo)=>this._onPDJL(msg,rinfo));
        sock.on('error',()=>{});
        this._pdjlSockets.push(sock);
        if(!this.pdjlSocket){ this.pdjlSocket = sock; this.pdjlPort = port; }
        console.log(`[PDJL] UDP ${port} active (${bindAddr||'0.0.0.0'})`);
      }catch(e){ console.warn(`[PDJL] port ${port} fail: ${e.message}`); }
    }
    if(this._pdjlSockets.length===0) console.warn('[PDJL] all ports failed');
  }

  // ── DJM TCP probe — connect to DJM port 50003 when discovered ──
  // DJM-900NXS2 TCP 50003: connection accepted but DJM sends nothing first.
  // Must send correct handshake. Try multiple approaches sequentially.
  _probeDjmTCP(djmIp){
    if(this._djmTcpProbed===djmIp) return;
    this._djmTcpProbed=djmIp;
    // Only probe TCP 50003 (50002 TCP is ECONNREFUSED on DJM-900NXS2)
    const port=50003;
    const tryHandshakes=[
      // 1. Send nothing — passive listen (DJM might push data on its own after delay)
      null,
      // 2. Full PDJL keepalive (type 0x06) with magic bytes
      ()=>{ const p=Buffer.alloc(11); PDJL.MAGIC.copy(p,0); p[10]=0x06; return p; },
      // 3. PDJL opt-in subscribe (type 0x02 — used by CDJs to receive DJM status)
      ()=>{ const p=Buffer.alloc(11); PDJL.MAGIC.copy(p,0); p[10]=0x02; return p; },
      // 4. Raw 0x00 probe
      ()=>Buffer.from([0x00]),
    ];
    let attempt=0;
    const doAttempt=()=>{
      if(attempt>=tryHandshakes.length) return;
      const hs=tryHandshakes[attempt++];
      const sock=net.createConnection({host:djmIp,port,timeout:10000});
      sock.on('connect',()=>{
        const hsDesc=hs?`hs#${attempt-1}`:'passive(no-send)';
        console.log(`[DJM-TCP] connected ${djmIp}:${port} attempt=${hsDesc}`);
        sock.on('data',buf=>{
          const hex=buf.toString('hex');
          console.log(`[DJM-TCP] DATA! ${djmIp}:${port} len=${buf.length} hex=${hex}`);
          // Log every unique response
          const key=`tcp_${port}_len${buf.length}_b0=${buf[0]}`;
          if(!this._djmSeenTypes.has(key)){
            this._djmSeenTypes.add(key);
            console.log(`[DJM-TCP] FIRST-SEEN key=${key}`);
          }
        });
        if(hs){ try{ sock.write(hs()); }catch(_){} }
      });
      sock.on('error',e=>{ console.log(`[DJM-TCP] ${djmIp}:${port} err: ${e.message}`); setTimeout(doAttempt,500); });
      sock.on('timeout',()=>{ console.log(`[DJM-TCP] ${djmIp}:${port} timeout (no data)`); sock.destroy(); setTimeout(doAttempt,500); });
    };
    doAttempt();
  }

  // Pro DJ Link keep-alive announcement on 50000
  // CDJs only send status to devices they see on the network
  _startPDJLAnnounce(){
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
    // 2) Fall back to localAddr (TCNet interface)
    if(!pdjlIP && this.localAddr && !this.isLocalMode){
      pdjlIP = this.localAddr;
      for(const iface of getAllInterfaces()){
        if(iface.address===pdjlIP){ pdjlMAC=iface.mac||pdjlMAC; break; }
      }
    }
    // 3) Fall back to any non-internal interface (including link-local for USB LAN CDJ setups)
    if(!pdjlIP){
      for(const iface of getAllInterfaces()){
        if(!iface.internal && iface.address!=='127.0.0.1'){
          pdjlIP=iface.address; pdjlMAC=iface.mac||pdjlMAC; break;
        }
      }
    }
    if(!pdjlIP){ console.warn('[PDJL] no interface found for keep-alive'); return; }

    // Collect ALL non-internal broadcast addresses so every subnet (including Arena's) receives the keepalive
    const allBCs = [...new Set(
      getAllInterfaces()
        .filter(i=>!i.internal && i.broadcast && i.broadcast!=='127.255.255.255')
        .map(i=>i.broadcast)
        .concat(['255.255.255.255'])
    )];
    console.log(`[PDJL] announcing IP=${pdjlIP} MAC=${pdjlMAC} → ${allBCs.join(',')}:50000`);

    const macBytes=pdjlMAC.split(':').map(h=>parseInt(h,16));
    const ipParts=pdjlIP.split('.').map(Number);

    // Use port 50000 socket for keepalive broadcast (DJM requires keepalives from port 50000)
    // STC reference: keepaliveSock is the port 50000 socket, not an ephemeral port.
    // DJM only recognizes bridge identity from broadcasts originating on port 50000.
    this._pdjlAnnSock = this._pdjlSockets?.[0] || null;
    if(!this._pdjlAnnSock){
      // Fallback: create new socket if port 50000 socket not available
      this._pdjlAnnSock=dgram.createSocket({type:'udp4',reuseAddr:true});
      this._pdjlAnnSock.on('error',()=>{});
      this._pdjlAnnSock.bind(0, ()=>{try{this._pdjlAnnSock.setBroadcast(true);}catch(_){}});
    }

    // Bridge join sequence — DJM needs hello + claims before activating fader delivery
    // STC reference: 2 hellos (0x0A, 37B) + 11 IP claims (0x02, 50B)
    const spoofPlayer=5;
    const _bridgeJoin=()=>{
      // Hello (0x0A) — 37B broadcast × 2
      for(let h=0;h<2;h++){
        setTimeout(()=>{
          const p=Buffer.alloc(37);
          PDJL.MAGIC.copy(p,0);
          p[0x0A]=0x0A; p[0x20]=0x01; p[0x21]=0x01; p[0x23]=0x25; p[0x24]=spoofPlayer;
          Buffer.from('BRIDGE+\0\0\0\0\0\0\0\0','ascii').copy(p,0x0C,0,15);
          for(const bc of allBCs){try{this._pdjlAnnSock.send(p,0,p.length,50000,bc);}catch(_){}}
          console.log(`[PDJL] bridge hello #${h+1}`);
        }, h*300);
      }
      // Claim (0x02) — 50B broadcast × 11
      for(let n=1;n<=11;n++){
        setTimeout(()=>{
          const p=Buffer.alloc(50);
          PDJL.MAGIC.copy(p,0);
          p[0x0A]=0x02; p[0x20]=0x01; p[0x21]=0x01; p[0x23]=0x32;
          Buffer.from('BRIDGE+\0\0\0\0\0\0\0\0','ascii').copy(p,0x0C,0,15);
          for(let i=0;i<4;i++) p[0x24+i]=ipParts[i];
          for(let i=0;i<6;i++) p[0x28+i]=macBytes[i]||0;
          p[0x2E]=(macBytes[5]||0)^(n*3+0xFB); p[0x2F]=n;
          p[0x30]=process.platform==='darwin'?spoofPlayer:0xC0;
          for(const bc of allBCs){try{this._pdjlAnnSock.send(p,0,p.length,50000,bc);}catch(_){}}
        }, 600+n*500);
      }
    };
    _bridgeJoin();

    const sendAnn=()=>{
      // 54B bridge keepalive (0x06) — DJM recognizes player=0xF9 as bridge device
      // STC reference: pkt[0x24]=0xF9(macOS)/0xC1(other), pkt[0x30]=0x03, pkt[0x35]=0x20
      const pkt=Buffer.alloc(54);
      PDJL.MAGIC.copy(pkt,0);
      pkt[0x0A]=0x06; pkt[0x0B]=0x00;
      Buffer.from('BRIDGE+\0\0\0\0\0\0\0\0','ascii').copy(pkt,0x0C,0,15);
      pkt[0x20]=0x01; pkt[0x21]=0x01; pkt[0x22]=0x00; pkt[0x23]=0x36;
      pkt[0x24]=process.platform==='darwin'?0xF9:0xC1; // bridge device type (macOS=0xF9)
      pkt[0x25]=0x00;
      for(let i=0;i<6;i++) pkt[0x26+i]=macBytes[i]||0;
      for(let i=0;i<4;i++) pkt[0x2C+i]=ipParts[i];
      // ROLLBACK: was pkt[0x35]=0x20
      // prolink-connect: CDJ-3000 requires 0x35=0x64 (incorrect values cause network kicks)
      pkt[0x30]=0x03; pkt[0x34]=0x05; pkt[0x35]=0x64;
      // Send to all broadcast addresses
      for(const bc of allBCs){
        try{this._pdjlAnnSock.send(pkt,0,pkt.length,50000,bc);}catch(_){}
      }
    };

    // 95B dbserver keepalive — UNICAST to CDJs only (not broadcast!)
    // STC: CDJ-3000 validates "PIONEER DJ CORP" / "PRODJLINK BRIDGE" strings
    // CRITICAL: DJM must NOT see this packet (player=5 conflicts with bridge player=0xF9)
    this._dbKaSock = dgram.createSocket({type:'udp4',reuseAddr:true});
    this._dbKaSock.on('error',()=>{});
    this._dbKaSock.bind(0,()=>{try{this._dbKaSock.setBroadcast(true);}catch(_){}});
    const _dbKeepaliveSocket = this._dbKaSock;
    const sendDbKeepalive=()=>{
      const pkt=Buffer.alloc(95);
      PDJL.MAGIC.copy(pkt,0);
      pkt[0x0A]=0x06;
      Buffer.from('BRIDGE+\0\0\0\0\0\0\0\0','ascii').copy(pkt,0x0C,0,15);
      pkt[0x20]=0x01; pkt[0x21]=0x01; pkt[0x23]=0x36;
      pkt[0x24]=spoofPlayer; // player=5
      for(let i=0;i<6;i++) pkt[0x26+i]=macBytes[i]||0;
      for(let i=0;i<4;i++) pkt[0x2C+i]=ipParts[i];
      // ROLLBACK: was pkt[0x35]=0x20
      pkt[0x35]=0x64; // CDJ-3000 requires 0x64 (prolink-connect confirmed)
      // Pioneer identification strings (required for CDJ-3000 dbserver access)
      Buffer.from('PIONEER DJ CORP','ascii').copy(pkt,54,0,15);
      Buffer.from('PRODJLINK BRIDGE','ascii').copy(pkt,74,0,16);
      pkt[94]=0x43; // 'C'
      // Unicast to each CDJ only (not DJM!)
      for(const[k,dev] of Object.entries(this.devices)){
        if(dev.type==='CDJ'&&dev.ip){
          try{_dbKeepaliveSocket.send(pkt,0,pkt.length,50000,dev.ip);}catch(_){}
        }
      }
    };

    sendAnn();
    if(this._pdjlAnnTimer) clearInterval(this._pdjlAnnTimer);
    this._pdjlAnnTimer=setInterval(()=>{sendAnn();sendDbKeepalive();},1500);
    this._timers.push(this._pdjlAnnTimer);

    // DJM subscribe (0x57) — triggers fader + VU meter delivery
    // STC ref: must be sent from a SEPARATE socket (bridgeSock, ephemeral port)
    // NOT from the beat socket (50001). DJM may reject subscribe from a port it sends data to.
    // Must be delayed ~3s+ after first keepalive (DJM needs to register bridge identity first)
    this._djmSubSock = dgram.createSocket({type:'udp4',reuseAddr:true});
    this._djmSubSock.on('error',()=>{});
    this._djmSubSock.bind(0,()=>{try{this._djmSubSock.setBroadcast(true);}catch(_){}});
    const _mkDjmSub=()=>{
      const pkt=Buffer.alloc(40);
      PDJL.MAGIC.copy(pkt,0);
      pkt[10]=0x57; // subscribe type
      Buffer.from('BRIDGE+\0\0\0\0\0\0\0\0','ascii').copy(pkt,11,0,15);
      pkt[31]=0x01; pkt[32]=0x00;
      pkt[33]=process.platform==='darwin'?0xFE:0x87; // macOS=0xFE, Windows=0x87
      pkt[34]=0x00; pkt[35]=0x04; pkt[36]=0x01; // subtype=4, subscribe=1
      return pkt;
    };
    const sendDJMSub = ()=>{
      const pkt=_mkDjmSub();
      for(const[k,dev] of Object.entries(this.devices)){
        if(dev.type==='DJM'||k==='djm'){
          try{this._djmSubSock.send(pkt,0,pkt.length,50001,dev.ip);}catch(_){}
        }
      }
    };
    const sendDJMSubBC = ()=>{
      const pkt=_mkDjmSub();
      for(const bc of allBCs){
        try{this._djmSubSock.send(pkt,0,pkt.length,50001,bc);}catch(_){}
      }
    };
    // Delay: join sequence takes ~6s, then wait 2s more for DJM to register
    setTimeout(sendDJMSubBC, 8000);
    setTimeout(sendDJMSub, 10000);
    // Re-subscribe every 2s (STC uses kBridgeSubInterval=2.0)
    const djmSubTimer = setInterval(()=>{sendDJMSub();sendDJMSubBC();}, 2000);
    this._timers.push(djmSubTimer);

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
    if(p.name==='BRIDGE+'||rinfo.address==='127.0.0.1') return;
    if(p.kind==='cdj'){
      const li = p.playerNum-1;
      const key = `cdj${p.playerNum}`;
      if(!this.devices[key]){
        this.devices[key]={type:'CDJ',playerNum:p.playerNum,name:p.name,ip:rinfo.address,lastSeen:Date.now()};
        console.log(`[PDJL] CDJ P${p.playerNum}(${p.name})@${rinfo.address}`);
        this.onDeviceList?.(this.devices);
      } else this.devices[key].lastSeen=Date.now();
      this.devices[key].state=p;
      if(this.hwMode[li]){
        const beatPhase = Math.max(0, (p.beatInBar - 1)) * 64;

        let acc = this._tcAcc[li];
        const trackChanged = !acc || acc.trackId !== p.trackId;
        let timecodeMs = 0;

        if(trackChanged){
          this._tcAcc[li] = { prevBn: p.beatNum, elapsedMs: 0, trackId: p.trackId, dbgCount:0, metaRequested:false, initPos:0 };
          try{console.log(`[TC] P${p.playerNum} track change: trackId=${p.trackId} hasTrack=${p.hasTrack} slot=${p.slot} trackType=${p.trackType} trackDeviceId=${p.trackDeviceId} ip=${rinfo?.address}`);}catch(_){}
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
            // Find source device IP: trackDeviceId tells us which player owns the media
            const srcDev = this.devices['cdj'+p.trackDeviceId];
            const _ip = srcDev?.ip || rinfo?.address;
            const _slot=p.slot||3, _tid=p.trackId, _pn=p.playerNum, _tt=p.trackType||1;
            try{console.log(`[TC] P${p.playerNum} meta request → device ${p.trackDeviceId} ip=${_ip}`);}catch(_){}
            setTimeout(()=>this.requestMetadata(_ip, _slot, _tid, _pn, true, _tt), this._dbReady?100:3000);
            this._dbReady = true;
          }
        } else if(acc && !acc.metaRequested && p.trackId>0 && p.hasTrack){
          acc.metaRequested = true;
          const srcDev = this.devices['cdj'+p.trackDeviceId];
          const _ip = srcDev?.ip || rinfo?.address;
          try{console.log(`[TC] P${p.playerNum} metadata retry → device ${p.trackDeviceId} ip=${_ip}`);}catch(_){}
          this.requestMetadata(_ip, p.slot||3, p.trackId, p.playerNum, false, p.trackType||1);
        }
        // ── Model-specific position tracking ──
        // CDJ-3000: Precise Position (0x0b) — direct ms, highest accuracy
        // CDJ-2000NXS2: Beat + BeatGrid + interpolation (beat-link method)
        const pp = this._precisePos?.[p.playerNum];
        // `_precisePos` is populated only from parsePDJL kind==='precise_pos' (type 0x0b), which is already CDJ-3000-specific.
        const hasPrecise = pp && (Date.now()-pp.time)<500;

        // Get track length from any available source
        const prevLayerLen = this.layers[li]?.totalLength || 0;
        const ppLen = this._precisePos?.[p.playerNum]?.trackLengthSec;
        const totalLenMs = ppLen ? Math.round(ppLen*1000) : prevLayerLen;

        const isCdj3000=(p.name||p.deviceName||'').includes('CDJ-3000');
        if(hasPrecise){
          // CDJ-3000: direct ms from 0x0b packet (highest accuracy)
          timecodeMs = pp.playbackMs;
        } else if(!isCdj3000 && p.positionFraction > 0 && totalLenMs > 0 && (p.isPlaying || p.isLooping)){
          // CDJ-2000NXS2 position fraction (0x48 field) — most accurate for non-BPM tracks
          // CDJ-3000 type 0x0a packets already have 0x0b precise_pos; treating 0x48 as a fraction there can corrupt position.
          // Re-anchor every status packet: fraction × total length = absolute ms position
          const fracMs = Math.round(p.positionFraction * totalLenMs);
          if(!acc) this._tcAcc[li] = acc = { prevBn:0, elapsedMs:0, trackId:p.trackId, dbgCount:0, metaRequested:false };
          // Only update anchor when fraction changes (avoid jitter from repeated same value)
          if(!acc._fracMs || Math.abs(fracMs - acc._fracMs) > 50){
            acc._fracMs = fracMs;
            acc._fracAnchorTime = Date.now();
            acc._anchorMs = fracMs;
            acc._anchorTime = Date.now();
          }
          // Interpolate between fraction anchors using pitch multiplier
          const elapsed = acc._fracAnchorTime ? Date.now() - acc._fracAnchorTime : 0;
          timecodeMs = Math.round((acc._anchorMs||fracMs) + elapsed * p.pitchMultiplier);
        } else if(p.isPlaying || p.isLooping){
          // Fallback: beat-link style interpolation (NXS2 without track length, or track length unknown)
          if(!acc) this._tcAcc[li] = acc = { prevBn:0, elapsedMs:0, trackId:p.trackId, dbgCount:0, metaRequested:false };
          const bg = this._beatGrids?.[p.playerNum];
          const beatNum = (p.beatNum > 0 && p.beatNum < 0xFFFFFF) ? p.beatNum : 0;
          const beatIdx = beatNum - 1;

          if(beatNum > 0 && acc.prevBn !== beatNum){
            if(bg && beatIdx >= 0 && beatIdx < bg.length){
              timecodeMs = bg[beatIdx].timeMs;
            } else {
              const baseBpm = p.bpmTrack || p.bpm;
              timecodeMs = baseBpm > 0 ? Math.round((beatNum - 1) * 60000 / baseBpm) : 0;
            }
            acc._anchorMs = timecodeMs;
            acc._anchorTime = Date.now();
            acc.prevBn = beatNum;
          } else if(acc._anchorMs != null){
            const elapsed = Date.now() - acc._anchorTime;
            timecodeMs = Math.round(acc._anchorMs + elapsed * p.pitchMultiplier);
          } else if(beatNum > 0 && p.bpm > 0){
            const baseBpm = p.bpmTrack || p.bpm;
            timecodeMs = baseBpm > 0 ? Math.round((beatNum - 1) * 60000 / baseBpm) : 0;
            acc._anchorMs = timecodeMs; acc._anchorTime = Date.now(); acc.prevBn = beatNum;
          } else {
            // BPM-less + no track length: wall-clock from last known position
            if(p.pitchMultiplier > 0){
              if(acc._noBeatAnchorTime == null){
                acc._noBeatAnchorTime = Date.now();
                acc._noBeatAnchorMs = (this.layers[li]?.timecodeMs) || 0;
              }
              const elapsed = Date.now() - acc._noBeatAnchorTime;
              timecodeMs = Math.round(acc._noBeatAnchorMs + elapsed * p.pitchMultiplier);
              if(elapsed > 2000){ acc._noBeatAnchorTime=Date.now(); acc._noBeatAnchorMs=timecodeMs; }
            } else {
              timecodeMs = this.layers[li]?.timecodeMs || 0;
            }
          }
        } else {
          // Stopped/paused: preserve previous position
          if(this.layers[li]?.timecodeMs > 0) timecodeMs = this.layers[li].timecodeMs;
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
            _pitch:      p.pitch || 0,
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
        this.onCDJStatus?.(li, p);
      }
    }
    if(p.kind==='djm'){
      this._hasRealFaders=true;
      this.faders=p.channel;
      if(p.onAir) this.onAir = p.onAir.map(v => v > 127 ? 1 : 0);
      if(!this.devices['djm']){
        this.devices['djm']={type:'DJM',name:p.name||'DJM',ip:rinfo.address,lastSeen:Date.now()};
        this.onDeviceList?.(this.devices);
      } else this.devices['djm'].lastSeen=Date.now();
      // Forward raw hex dump for first 128 bytes for protocol debugging in UI log panel
      let rawHex=null;
      if(msg.length>0x20){
        rawHex=Array.from(msg.slice(0,Math.min(msg.length,128))).map(x=>x.toString(16).padStart(2,'0')).join(' ');
      }
      this.onDJMStatus?.({channel:p.channel, onAir:p.onAir, eq:p.eq, xfader:p.xfader, masterLvl:p.masterLvl, boothLvl:p.boothLvl, hpLevel:p.hpLevel, hpCueCh:p.hpCueCh, chExtra:p.chExtra, hasRealFaders:true, pktType:msg[10], pktLen:msg.length, rawHex});
    }
    if(p.kind==='djm_meter'){
      this.onDJMMeter?.({ch:p.ch, spectrum:p.spectrum});
    }
    // DJM Channels-On-Air (type 0x03 on port 50001)
    if(p.kind==='djm_onair'){
      this.onAir = p.onAir;
      // DJM-900NXS2: use on-air state as fader proxy for TCNet until real faders detected
      if(!this._hasRealFaders){
        const faderProxy=p.onAir.map(v=>v?255:0);
        this.faders=faderProxy; // TCNet mixer data will send these values to Arena
        this.onDJMStatus?.({channel:faderProxy, onAir:p.onAir, eq:[], xfader:null, masterLvl:null, hpCueCh:null, hasRealFaders:false});
      }
      if(!this.devices['djm']){
        this.devices['djm']={type:'DJM',name:p.name||'DJM',ip:rinfo.address,lastSeen:Date.now()};
        this.onDeviceList?.(this.devices);
        // Probe DJM TCP ports when first discovered — fader data might be on TCP 50003
        this._probeDjmTCP(rinfo.address);
      } else this.devices['djm'].lastSeen=Date.now();
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
          console.log(`[PDJL] P${p.playerNum} Precise Position: ${p.playbackMs}ms, dur=${p.trackLengthSec}s, bpm=${p.bpmEffective}`);
        }
        // Send directly to renderer as CDJ status update
        this.onCDJStatus?.(li, {
          playerNum:p.playerNum,
          timecodeMs:p.playbackMs,
          trackLengthSec:p.trackLengthSec,
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
      // Register as CDJ device if playerNum is valid (1-6)
      if(pn>0 && pn<=6){
        const key = `cdj${pn}`;
        if(!this.devices[key]){
          this.devices[key]={type:'CDJ',playerNum:pn,name:p.name,ip:rinfo.address,lastSeen:Date.now()};
          console.log(`[PDJL] CDJ keepalive P${pn}(${p.name})@${rinfo.address}`);
          this.onDeviceList?.(this.devices);
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
   *  Offsets verified from Deep Symmetry djl-analysis + parsePDJL in this file:
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
      // ROLLBACK: was 'BRIDGE-CLONE' — must match keepalive name for device identity
      const nm = 'BRIDGE+';
      Buffer.from(nm+'\0','ascii').copy(pkt, 0x0C, 0, Math.min(nm.length+1,20));
      // Header fields — Deep Symmetry spec: 0x20=subtype(0x03=CDJ), 0x21=deviceNum
      // ROLLBACK: was pkt[0x20]=0x01, pkt[0x21]=0x04
      pkt[0x20] = 0x03; pkt[0x21] = playerNum & 0xFF;
      pkt.writeUInt16BE(pktSize - 0x24, 0x22);  // lengthRemaining from 0x24 to end
      pkt[0x24] = playerNum & 0xFF;   // player number (NXS2 reads 0x21, CDJ-3000 reads 0x24)
      pkt[0x25] = 0x00;
      // 0x26-0x27: sub-field (unused, zero)
      // Track source fields — verified offsets from parsePDJL
      pkt[0x28] = playerNum & 0xFF;   // trackDeviceId = self (same player loaded it)
      pkt[0x29] = 0x03;               // slot = 3 (USB)
      pkt[0x2A] = 0x01;               // trackType = 1 (rekordbox analyzed track)
      pkt[0x2B] = 0x00;
      pkt.writeUInt32BE(trackId >>> 0, 0x2C);  // trackId (big-endian)

      // prolink-connect: bytes 0x68 and 0x75 MUST be 1 for mp3 metadata delivery
      // ROLLBACK: was 0x00 (unset)
      pkt[0x68] = 0x01;
      pkt[0x75] = 0x01;

      // Playing state: P1 byte (0x7B) and flags (0x89)
      // ROLLBACK: was pkt[0x7B]=0x09 (0x09=searching per Deep Symmetry spec)
      pkt[0x7B] = 0x03;   // P1 = 0x03 = playing (Deep Symmetry: 0x03=playing, 0x09=search)
      // ROLLBACK: was 0x68 (bit5=Master set) — only P1 should be master, others sync+onAir
      pkt[0x89] = (playerNum === 1) ? 0x68 : 0x48;
      // 0x68 = play(0x40)+master(0x20)+onAir(0x08), 0x48 = play(0x40)+onAir(0x08)
      // P2 play mode: NXS2 uses 0xFA(play)/0xFE(stop)
      pkt[0x8B] = 0xFA;  // P2 = playing (NXS2 format)
      // BPM × 100 as uint16BE at 0x92
      const bpmVal = Math.round((bpm||128)*100);
      pkt.writeUInt16BE(bpmVal, 0x92);
      // Pitch: slider at 0x8D (3B), effective at 0x99 (3B) — neutral = 0x100000
      // prolink-connect writes neutral pitch at both locations
      pkt[0x8D] = 0x10; pkt[0x8E] = 0x00; pkt[0x8F] = 0x00; // sliderPitch = 0x100000
      pkt[0x99] = 0x10; pkt[0x9A] = 0x00; pkt[0x9B] = 0x00; // effectivePitch = 0x100000
      // ROLLBACK: was pkt.writeUInt32BE(0x100000, 0x8C) — wrote 4B starting at 0x8C
      // prolink-connect: 0xB6 MUST be 1 (firmware version check bypass)
      pkt[0xB6] = 0x01;

      const allBCs = [...new Set(
        getAllInterfaces()
          .filter(i=>!i.internal && i.broadcast && i.broadcast!=='127.255.255.255')
          .map(i=>i.broadcast)
          .concat(['255.255.255.255'])
      )];
      // Send to BOTH 50001 and 50002 — CDJ-3000 uses 50002, some older firmware uses 50001
      for(const bc of allBCs){
        try{this._pdjlAnnSock.send(pkt,0,pkt.length,50002,bc);}catch(_){}
        try{this._pdjlAnnSock.send(pkt,0,pkt.length,50001,bc);}catch(_){}
      }
      // Also send to localhost for Arena running on the same machine
      try{this._pdjlAnnSock.send(pkt,0,pkt.length,50002,'127.0.0.1');}catch(_){}
      console.log(`[PDJL-VIRT] CDJ status P${playerNum} trackId=${trackId} bpm=${bpm||128} size=${pktSize}`);
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
   *  12-byte tag list, but Arena/prolink-connect use variable-length tags (argc bytes). */
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
    // argList type codes for 12 args of a MenuItem (prolink-connect protocol)
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
  // Protocol: Deep-Symmetry/dysentery reverse engineering
  // Flow: port discovery → greeting → setup → metadata query → render → parse

  onTrackMetadata = null; // (playerNum, {title, artist, album, duration, artworkId, key, genre}) => {}

  /**
   * Request track metadata + artwork from a CDJ via dbserver protocol.
   */
  requestMetadata(ip, slot, trackId, playerNum, force=false, trackType=1){
    if(!ip || !trackId) return;
    const cacheKey = `${ip}_${slot}_${trackId}`;
    if(!force && this._metaReqCache?.[cacheKey]) return; // already requested
    if(!this._metaReqCache) this._metaReqCache = {};
    this._metaReqCache[cacheKey] = true;
    this._dbserverMetadata(ip, slot, trackId, playerNum, trackType).catch(e=>{
      console.warn(`[DBSRV] metadata request failed: ${e.message}`);
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
        console.log(`[DBSRV] refresh P${s.playerNum} trackId=${s.trackId} trackType=${s.trackType} → device ${s.trackDeviceId} ip=${ip}`);
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
      console.warn(`[DBSRV] artwork request failed: ${e.message}`);
    });
  }

  // ── dbserver field builders ────
  _dbNum1(v){ return Buffer.from([0x0f, v&0xFF]); }
  _dbNum2(v){ const b=Buffer.alloc(3); b[0]=0x10; b.writeUInt16BE(v,1); return b; }
  _dbNum4(v){ const b=Buffer.alloc(5); b[0]=0x11; b.writeUInt32BE(v>>>0,1); return b; }

  _dbBuildMsg(txId, type, args){
    // prolink-connect format: each field wrapped in FieldType prefix
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
    console.log(`[DBSRV] ${ip} dbserver port=${realPort}`);

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
        console.log(`[DBSRV] ${ip} greeting response: len=${d.length} hex=${d.toString('hex')}`);
        if(d.length>=5 && d[0]===0x11) res();
        else rej(new Error(`bad greeting: ${d.toString('hex')}`));
      });
      sock.once('error', rej);
    });

    // Step 3: SETUP_REQ (type 0x0000, txId 0xfffffffe)
    const setupMsg = this._dbBuildMsg(0xfffffffe, 0x0000, [this._dbArg4(spoofPlayer)]);
    console.log(`[DBSRV] ${ip} sending SETUP player=${spoofPlayer} msg=${setupMsg.toString('hex')}`);
    sock.write(setupMsg);
    const setupResp = await this._dbReadResponse(sock);
    console.log(`[DBSRV] ${ip} SETUP response: len=${setupResp.length} hex=${setupResp.slice(0,40).toString('hex')}`);

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
    // Spoof as player 7 (Deep Symmetry recommended, avoids conflict with CDJs 1-6)
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
      console.log(`[DBSRV] P${playerNum} META_REQ: slot=${slot} trackId=${trackId} trackType=${tt} rmst=0x${((spoofPlayer<<24)|(0x01<<16)|(slot<<8)|tt).toString(16)}`);
      sock.write(metaReq);
      const menuAvail = await this._dbReadResponse(sock);
      console.log(`[DBSRV] P${playerNum} META_RESP: ${menuAvail.length}B hex=${menuAvail.slice(0,40).toString('hex')}`);
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
      console.log(`[DBSRV] P${playerNum} render resp: ${fullResp.length}B, items=${items.length}`);
      if(items.length===0) console.log(`[DBSRV] P${playerNum} render 0 items, hex(80): ${fullResp.slice(0,80).toString('hex')}`);
      const meta = {};
      for(const item of items){
        if(item.msgType===0x4101){
          // MENU_ITEM: args[3]=label1(str), args[5]=label2(str), args[6]=itemType(num), args[8]=artworkId
          const itemType = item.args[6]?.val || 0;
          const label1 = item.args[3]?.val || '';
          const label2 = item.args[5]?.val || '';
          // Debug: dump first occurrence of each item type
          if(!this._dbgItemTypes) this._dbgItemTypes={};
          if(!this._dbgItemTypes[itemType]){
            this._dbgItemTypes[itemType]=true;
            console.log(`[DBSRV] itemType=0x${itemType.toString(16)} label1="${label1}" label2="${label2}" args[1]=${item.args[1]?.val}`);
          }
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
      console.log(`[DBSRV] P${playerNum} metadata:`, JSON.stringify(meta));

      // Store metadata into layer so TCNet DATA packets include it
      const li = playerNum - 1;
      if(li >= 0 && li < 8 && this.layers[li]){
        if(meta.title)  this.layers[li].trackName  = meta.title;
        if(meta.artist) this.layers[li].artistName = meta.artist;
        // Invalidate MetaData packet cache so it gets rebuilt with new names
        if(this._metaCache && this._metaCache[li]) this._metaCache[li] = null;
        console.log(`[DBSRV] P${playerNum} stored metadata → layer ${li}: "${meta.title}" / "${meta.artist}"`);
      }

      // Emit metadata
      if(meta.title||meta.artist){
        this.onTrackMetadata?.(playerNum, meta);
      }

      // Teardown metadata connection
      try{
        const teardown = this._dbBuildMsg(0xfffffffe, 0x0100, []);
        sock.write(teardown);
      }catch(_){}

      // Request artwork + waveform on separate connections (non-blocking)
      if(meta.artworkId){
        this._dbserverArtwork(ip, slot, meta.artworkId, playerNum, `art_${ip}_${slot}_${meta.artworkId}`)
          .catch(e=>console.warn(`[DBSRV] P${playerNum} artwork failed:`,e.message));
      }
      this._dbserverWaveform(ip, slot, trackId, playerNum, tt)
        .catch(e=>console.warn(`[DBSRV] P${playerNum} waveform preview failed:`,e.message));
      this._dbserverWaveformDetail(ip, slot, trackId, playerNum, tt)
        .catch(e=>console.warn(`[DBSRV] P${playerNum} waveform detail failed:`,e.message));
      // NXS2 extension: 3-band waveform (PWV7) — higher quality than single-byte encoding
      this._dbserverWaveformNxs2(ip, slot, trackId, playerNum, tt)
        .catch(e=>console.warn(`[DBSRV] P${playerNum} nxs2 waveform failed:`,e.message));
      this._dbserverCuePoints(ip, slot, trackId, playerNum, tt)
        .catch(e=>console.warn(`[DBSRV] P${playerNum} cue points failed:`,e.message));
      this._dbserverBeatGrid(ip, slot, trackId, playerNum, tt)
        .catch(e=>console.warn(`[DBSRV] P${playerNum} beat grid failed:`,e.message));
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
        console.log(`[DBSRV] P${playerNum} waveform preview: ${pts.length} points`);
      } else {
        console.log(`[DBSRV] P${playerNum} waveform: no data in ${wfResp.length}B resp`);
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
        this.onWaveformDetail?.(playerNum, {pts, wfType:'detail'});
        console.log(`[DBSRV] P${playerNum} waveform detail: ${pts.length} pts (${Math.round(pts.length/150)}s)`);
      } else {
        console.log(`[DBSRV] P${playerNum} waveform detail: no data in ${wfResp?.length||0}B`);
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
        console.log(`[DBSRV] P${playerNum} nxs2 waveform: no ANLZ data`);
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
            console.log(`[DBSRV] P${playerNum} NXS2 PWV7 waveform: ${entries} entries (${Math.round(entries/150)}s)`);
            return;
          }
        }
        if(tTL===0)break;
        pos+=tTL;
      }
      console.log(`[DBSRV] P${playerNum} nxs2 waveform: PWV7 tag not found in ${anlzData.length}B`);
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
      console.log(`[DBSRV] P${playerNum} cue points: ${cues.length} (${hot} hot, ${mem} memory, ${lp} loop)`);
    } else {
      console.log(`[DBSRV] P${playerNum} cue points: none found`);
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
        console.log(`[DBSRV] P${playerNum} PCO2: no ANLZ data in ${resp.length}B`);
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
          console.log(`[DBSRV] P${playerNum} PCO2: ${cues.length} cue entries parsed`);
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
          console.log(`[DBSRV] P${playerNum} PCOB fallback: ${cues.length} cues`);
          return cues;
        }
        if(tTL===0)break;
        pos+=tTL;
      }
      console.log(`[DBSRV] P${playerNum} PCO2/PCOB tag not found`);
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
      // 0x2204 = BEAT_GRID_REQ — returns full beat grid with ms positions
      const rmst = this._dbRMST(spoofPlayer, 0x01, slot, trackType||1);
      const req = this._dbBuildMsg(1, 0x2204, [
        rmst, this._dbArg4(0), this._dbArg4(trackId), this._dbArg4(0)
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
          this.onBeatGrid?.(playerNum, {beats, baseBpm});
          console.log(`[DBSRV] P${playerNum} beat grid: ${beats.length} beats, baseBpm=${baseBpm}`);
        } else {
          console.log(`[DBSRV] P${playerNum} beat grid: no entries in ${bgData.length}B`);
        }
      } else {
        console.log(`[DBSRV] P${playerNum} beat grid: no data in ${resp?.length||0}B resp`);
      }
    }catch(e){
      console.warn(`[DBSRV] P${playerNum} beat grid failed:`,e.message);
    }finally{try{sock?.destroy();}catch(_){}}
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
      console.log(`[DBSRV] P${playerNum} artwork resp: ${artResp.length}B`);
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
        console.log(`[DBSRV] P${playerNum} artwork: ${img.length}B ${mime}`);
        // Store in virtual dbserver — Arena fetches via ProDJ Link dbserver protocol
        this.setVirtualArt(playerNum-1, img);
      } else {
        console.log(`[DBSRV] P${playerNum} artwork: no image in ${artResp.length}B`);
      }
    }finally{try{sock?.destroy();}catch(_){}}
  }
}

module.exports = {
  BridgeCore, getAllInterfaces,
  mkOptIn, mkStatus, mkTime, mkAppResp, mkMetadataResp,
  mkDataMetrics, mkDataMeta, mkNotification, mkLowResArtwork,
  parsePDJL,
  TC, PDJL, STATE, P1_TO_STATE, P1_NAME,
};
