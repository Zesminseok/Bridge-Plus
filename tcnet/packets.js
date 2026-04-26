// TCNet 패킷 빌더 — bridge-core.js 에서 추출 (Phase 4.10 modularization).
// 순수 함수 + 상수 (Buffer/process 만 의존).

const TC = {
  MAGIC : Buffer.from('TCN'),
  VER   : Buffer.from([0x03, 0x05]),  // TCNet V3.5 wire version (Arena 호환)
  OPTIN : 0x02, OPTOUT: 0x03, STATUS: 0x05,
  DATA  : 0xC8, TIME  : 0xFE,  APP   : 0x1E,
  ARTWORK: 0xCC,
  NOTIFY: 0x0D,
  P_BC  : 60000, P_TIME: 60001, P_DATA: 60002,
  NID   : Buffer.from([Math.floor(Math.random()*256), 0xFE]),
  NNAME : 'Bridge01',
  NTYPE : 0x02,   // 0x02 = Server (Arena = 0x04 = Client)
  NOPTS : Buffer.from([0x07, 0x00]),
  VENDOR: 'BRIDGE+', DEVICE: 'BRIDGE+',
  APPV  : { ma:1, mi:1, bug:67 },
  H     : 24,
  SZ_OI : 68, SZ_ST: 300, SZ_TM: 162,
  SZ_DT_METRICS: 122, SZ_DT_META: 548,
  LPORT : 0,
  DT_METRICS: 0x02,
  DT_META:    0x04,
  DT_ARTWORK: 0x80,
  DT_MIXER:   0x96,
};

// TCNet V3.5.1B LayerStatus values
const STATE = { IDLE:0, PLAYING:3, LOOPING:4, PAUSED:5, STOPPED:6, CUEDOWN:7, PLATTERDOWN:8, FFWD:9, FFRV:10, HOLD:11 };
function toTCNetState(s){ return s || 0; }

// Pro DJ Link P1 (0x7B) → TCNet LayerStatus 매핑
const P1_TO_STATE = {
  0x00: STATE.IDLE,
  0x02: STATE.STOPPED,
  0x03: STATE.PLAYING,
  0x04: STATE.LOOPING,
  0x05: STATE.PAUSED,
  0x06: STATE.CUEDOWN,
  0x07: STATE.CUEDOWN,
  0x08: STATE.PLATTERDOWN,
  0x09: STATE.FFWD,
  0x0D: STATE.STOPPED,
  0x0E: STATE.HOLD,
  0x11: STATE.STOPPED,
  0x12: STATE.LOOPING,
  0x13: STATE.PLATTERDOWN,
};
const P1_NAME = {
  0x00:'no track',0x02:'loading',0x03:'playing',0x04:'loop',
  0x05:'paused',0x06:'cued',0x07:'cuing',0x08:'platter held',
  0x09:'searching',0x0D:'end of track',0x0E:'spun down',0x11:'ended',
  0x12:'emergency loop',0x13:'vinyl scratch',
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
let _seq = 0;
const u32 = n => (Math.max(0,n)&0xFFFFFFFF)>>>0;
const clamp8 = n => Math.max(0,Math.min(255,Math.round(n)))&0xFF;

function _writeUtf32LE(buf, offset, str, maxChars){
  for(let i=0;i<str.length&&i<maxChars;i++){
    const cp=str.codePointAt(i);
    const off=offset+i*4;
    buf[off]  = cp&0xFF;
    buf[off+1]=(cp>>8)&0xFF;
    buf[off+2]=(cp>>16)&0xFF;
    buf[off+3]=(cp>>24)&0xFF;
    if(cp>0xFFFF) i++;
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

// ─────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────

function mkOptIn(port, uptime, nc){
  const b = Buffer.alloc(TC.SZ_OI);
  buildHdr(TC.OPTIN).copy(b,0);
  const d = b.slice(24);
  d.writeUInt16LE(nc||2, 0);
  d.writeUInt16LE(port||0, 2);
  d.writeUInt16LE(uptime||0, 4);
  d.writeUInt16LE(0, 6);
  d.write(TC.VENDOR.padEnd(16,'\0'), 8, 16, 'ascii');
  d.write(TC.DEVICE.padEnd(16,'\0'), 24, 16, 'ascii');
  d[40]=TC.APPV.ma; d[41]=TC.APPV.mi; d[42]=TC.APPV.bug;
  d[43]=0;
  return b;
}

function mkStatus(port, devices, layers, faders, hwMode){
  const b = Buffer.alloc(TC.SZ_ST);
  buildHdr(TC.STATUS).copy(b,0);
  const d = b.slice(24);
  let nc=0;
  for(let n=0;n<8;n++){
    if(layers&&layers[n]) nc++;
    else if(hwMode&&hwMode[n]) nc++;
  }
  d.writeUInt16LE(nc||1, 0);
  d.writeUInt16LE(port||0, 2);
  for(let n=0;n<8;n++){
    const hasLayer = layers && layers[n];
    const isHW = hwMode && hwMode[n];
    d[10+n] = (hasLayer || isHW) ? (n+1) : 0;
  }
  for(let n=0;n<8;n++){
    const layerData = layers && layers[n];
    d[18+n] = layerData ? toTCNetState(layerData.state||0) : 0;
  }
  for(let n=0;n<8;n++){
    const layerData = layers && layers[n];
    if(layerData && layerData.trackId){
      d.writeUInt32LE(layerData.trackId, 26+n*4);
    }
  }
  d[59] = 0x1E;
  d[60] = 0x00;
  d.write(TC.DEVICE.padEnd(16,'\0'), 96, 16, 'ascii');
  for(let n=0;n<8;n++){
    const layerData = layers && layers[n];
    const name = layerData?.deviceName ? layerData.deviceName.slice(0,15) : '';
    if(name) d.write(name.padEnd(16,'\0'), 148+n*16, 16, 'ascii');
  }
  return b;
}

function mkTime(layers, uptimeMs, faders){
  const b = Buffer.alloc(TC.SZ_TM);
  buildHdr(TC.TIME).copy(b,0);
  const d = b.slice(24);
  const now = Date.now();
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld){
      let ms = ld.timecodeMs || 0;
      const isActive = ld.state === STATE.PLAYING || ld.state === STATE.LOOPING
        || ld.state === STATE.FFWD || ld.state === STATE.FFRV;
      if(isActive && ld._updateTime){
        const pitch = ld._pitch || 0;
        ms += (now - ld._updateTime) * (1 + pitch / 100);
      }
      d.writeUInt32LE(u32(ms), n*4);
    }
  }
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld) d.writeUInt32LE(u32(ld.totalLength||0), 32+n*4);
  }
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld) d[64+n] = ld.beatPhase || 0;
  }
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld) d[72+n] = toTCNetState(ld.state||0);
  }
  d[81] = 30;
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
      const frames = Math.floor((ms % 1000) / 33.33);
      const off = 82 + n*6;
      d[off+0] = 30;
      const tcState = isPlaying ? 1 : (ld._needResync ? 2 : 0);
      if(ld._needResync) ld._needResync = false;
      d[off+1] = tcState;
      d[off+2] = h;
      d[off+3] = m;
      d[off+4] = s;
      d[off+5] = frames;
    }
  }
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

function mkMetadataResp(layer, reqType, layerData){
  const trackName  = layerData?.trackName  || '';
  const artistName = layerData?.artistName || '';
  const dataLen = 2 + 2 + trackName.length + 2 + artistName.length + 16;
  const totalLen = TC.H + dataLen;
  const b = Buffer.alloc(totalLen);
  buildHdr(0x14).copy(b,0);
  const d = b.slice(TC.H);
  d[0] = layer;
  d[1] = reqType;
  let off = 2;
  d.writeUInt16LE(trackName.length, off); off+=2;
  if(trackName.length > 0){ d.write(trackName, off, trackName.length, 'utf8'); off += trackName.length; }
  d.writeUInt16LE(artistName.length, off); off+=2;
  if(artistName.length > 0){ d.write(artistName, off, artistName.length, 'utf8'); off += artistName.length; }
  return b;
}

function mkDataMetrics(layerIdx, layerData, faderVal){
  const b = Buffer.alloc(TC.SZ_DT_METRICS);
  buildHdr(TC.DATA).copy(b, 0);
  const d = b.slice(TC.H);
  d[0] = TC.DT_METRICS;
  d[1] = layerIdx;
  if(layerData){
    d[3] = toTCNetState(layerData.state||0);
    d[5] = 0x01;
    d[7] = layerData.beatPhase || 0;
    d.writeUInt32LE(layerData.totalLength || 0, 8);
    let curMs = layerData.timecodeMs || 0;
    const isPlaying = layerData.state === STATE.PLAYING || layerData.state === STATE.LOOPING;
    if(isPlaying && layerData._updateTime) curMs += (Date.now() - layerData._updateTime);
    d.writeUInt32LE(u32(curMs), 12);
    const pitch = layerData._pitch || 0;
    const speedVal = isPlaying ? Math.round(32768 * (1 + pitch / 100)) : 0;
    d.writeUInt32LE(u32(Math.max(0, Math.min(65536, speedVal))), 16);
    d.writeUInt32LE(0, 33);
    const bpm = layerData.bpm || 0;
    d.writeUInt32LE(u32(Math.round(bpm * 100)), 88);
    const pbVal = Math.round(32768 * (1 + pitch / 100));
    d.writeUInt16LE(Math.max(0, Math.min(65535, pbVal)), 92);
    d.writeUInt32LE(layerData.trackId || 0, 94);
  }
  return b;
}

function mkMixerData(faders, mixerName, mixer){
  const b = Buffer.alloc(270);
  buildHdr(TC.DATA).copy(b, 0);
  const d = b.slice(TC.H);
  d[0] = 150;
  d[1] = 1;
  d[2] = 0;
  const nm = (mixerName || 'DJM-900NXS2').padEnd(16, '\0');
  Buffer.from(nm, 'ascii').copy(d, 5, 0, 16);
  d[37] = mixer?.masterLvl != null ? mixer.masterLvl : 255;
  d[38] = mixer?.masterLvl != null ? mixer.masterLvl : 255;
  d[75] = mixer?.xfader != null ? mixer.xfader : 127;
  for(let ch=0; ch<4; ch++){
    const off = 101 + ch * 24;
    d[off]   = ch + 1;
    d[off+1] = faders?.[ch] != null ? faders[ch] : 0;
    d[off+2] = faders?.[ch] != null ? faders[ch] : 0;
    d[off+3]  = mixer?.eq?.[ch]?.[0] != null ? mixer.eq[ch][0] : 200;
    d[off+4]  = 0;
    d[off+5]  = mixer?.eq?.[ch]?.[1] != null ? mixer.eq[ch][1] : 128;
    d[off+6]  = mixer?.eq?.[ch]?.[2] != null ? mixer.eq[ch][2] : 128;
    d[off+7]  = 0;
    d[off+8]  = mixer?.eq?.[ch]?.[3] != null ? mixer.eq[ch][3] : 128;
    d[off+13] = mixer?.xfAssign?.[ch] != null ? mixer.xfAssign[ch] : 0;
  }
  return b;
}

function mkDataMeta(layerIdx, layerData){
  const b = Buffer.alloc(TC.SZ_DT_META);
  buildHdr(TC.DATA).copy(b, 0);
  const d = b.slice(TC.H);
  d[0] = TC.DT_META;
  d[1] = layerIdx;
  if(layerData){
    const artist = layerData.artistName || '';
    if(artist) _writeUtf32LE(d, 5, artist, 64);
    const track = layerData.trackName || '';
    if(track) _writeUtf32LE(d, 261, track, 64);
    d.writeUInt16LE(0, 517);
    d.writeUInt32LE(layerData.trackId || 0, 519);
  }
  return b;
}

function mkNotification(){
  const b = Buffer.alloc(30);
  buildHdr(TC.NOTIFY).copy(b, 0);
  const d = b.slice(TC.H);
  d[0]=0xFF; d[1]=0xFF; d[2]=0xFF; d[3]=0x00; d[4]=0x1E; d[5]=0x00;
  return b;
}

function mkLowResArtwork(layerIdx, jpegBuf){
  const CLUSTER_SIZE = 4800;
  const totalPackets = Math.ceil(jpegBuf.length / CLUSTER_SIZE);
  const packets = [];
  for(let i = 0; i < totalPackets; i++){
    const chunkStart = i * CLUSTER_SIZE;
    const chunk = jpegBuf.slice(chunkStart, chunkStart + CLUSTER_SIZE);
    const b = Buffer.alloc(TC.H + 18 + chunk.length);
    buildHdr(TC.ARTWORK).copy(b, 0);
    b[TC.H]     = TC.DT_ARTWORK;
    b[TC.H + 1] = layerIdx;
    b.writeUInt32LE(jpegBuf.length, TC.H + 2);
    b.writeUInt32LE(totalPackets,   TC.H + 6);
    b.writeUInt32LE(i,              TC.H + 10);
    b.writeUInt32LE(CLUSTER_SIZE,   TC.H + 14);
    chunk.copy(b, TC.H + 18);
    packets.push(b);
  }
  return packets;
}

module.exports={
  TC, STATE, toTCNetState, P1_TO_STATE, P1_NAME,
  u32, clamp8,
  buildHdr,
  mkOptIn, mkStatus, mkTime, mkAppResp, mkMetadataResp,
  mkDataMetrics, mkMixerData, mkDataMeta, mkNotification, mkLowResArtwork,
};
