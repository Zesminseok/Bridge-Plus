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

// ─────────────────────────────────────────────
// TCNet 상수
// ─────────────────────────────────────────────
const TC = {
  MAGIC : Buffer.from('TCN'),
  VER   : Buffer.from([0x03, 0x05]),
  OPTIN : 0x02, OPTOUT: 0x03, STATUS: 0x05,
  DATA  : 0xC8, TIME  : 0xFE,  APP   : 0x1E,
  NOTIFY: 0x0D,
  P_BC  : 60000, P_TIME: 60001, P_DATA: 60002,
  NID   : Buffer.from([Math.floor(Math.random()*256), 0xFE]), // random per instance
  NNAME : 'BRIDGE29',
  NTYPE : 0x02,   // 0x02 = Server (Arena = 0x04 = Client)
  NOPTS : Buffer.from([0x07, 0x00]),
  VENDOR: 'PIONEER DJ CORP', DEVICE: 'PRODJLINK BRIDGE',
  APPV  : { ma:1, mi:1, bug:67 },
  H     : 24,
  SZ_OI : 68, SZ_ST: 300, SZ_TM: 154,
  SZ_DT_METRICS: 122, SZ_DT_META: 548,
  LPORT : 0,  // dynamically assigned each run
  DT_METRICS: 0x02,  // MetricsData: fader, gain, pitch, BPM, status per layer
  DT_META:    0x04,  // MetaData: track name, artist, waveform, artwork per layer
};

// TCNet LayerStatus values (node-tcnet spec)
const STATE = { IDLE:0, PLAYING:3, LOOPING:4, PAUSED:5, STOPPED:6, CUEDOWN:7, PLATTERDOWN:8, FFWD:9, FFRV:10, HOLD:11 };

const P1_TO_STATE = {
  0x00: STATE.IDLE,       0x02: STATE.STOPPED,  0x03: STATE.PLAYING,
  0x04: STATE.LOOPING,    0x05: STATE.PAUSED,   0x06: STATE.CUEDOWN,
  0x07: STATE.CUEDOWN,    0x08: STATE.CUEDOWN,  0x09: STATE.STOPPED,
  0x0D: STATE.STOPPED,    0x11: STATE.PLAYING,  0x13: STATE.CUEDOWN,
};
const P1_NAME = {
  0x00:'no track',0x02:'loading',0x03:'playing',0x04:'loop',
  0x05:'paused',0x06:'paused@cue',0x07:'cue play',0x08:'cue scratch',
  0x09:'searching',0x0D:'end',0x11:'reverse',0x13:'vinyl scratch',
};

const PDJL = {
  MAGIC: Buffer.from([0x51,0x73,0x70,0x74,0x31,0x57,0x6D,0x4A,0x4F,0x4C]),
  CDJ:0x0A, DJM:0x39, DJM2:0x29, ANN:0x06,
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

function getAllInterfaces(){
  const result = [];
  result.push({name:'lo0 (localhost)',address:'127.0.0.1',netmask:'255.0.0.0',broadcast:'127.255.255.255',mac:'00:00:00:00:00:00',internal:true,isLoopback:true});
  for(const [name,addrs] of Object.entries(os.networkInterfaces()))
    for(const a of addrs)
      if(a.family==='IPv4'){
        const ip=a.address.split('.').map(Number), mask=a.netmask.split('.').map(Number);
        const bc=ip.map((o,i)=>o|(~mask[i]&255)).join('.');
        result.push({name,address:a.address,netmask:a.netmask,broadcast:bc,mac:a.mac,internal:a.internal,isLoopback:a.internal});
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

  // layerSource[0-7] at body[10-17] — always report hwMode slots as active
  for(let n=0;n<8;n++){
    const hasLayer = layers && layers[n];
    const isHW = hwMode && hwMode[n];
    d[10+n] = (hasLayer || isHW) ? (n+1) : 0;
  }

  // layerStatus[0-7] at body[18-25]
  for(let n=0;n<8;n++){
    const layerData = layers && layers[n];
    d[18+n] = layerData ? (layerData.state || 0) : 0;
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
function mkTime(layers, uptimeMs){
  const b = Buffer.alloc(TC.SZ_TM);
  buildHdr(TC.TIME).copy(b,0);
  const d = b.slice(24);  // body 130B

  // layerCurrentTime[0-7] at body[0-31] — interpolated from wall clock
  const now = Date.now();
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld){
      let ms = ld.timecodeMs || 0;
      // Interpolate: if playing, add elapsed time since last beat update (pitch-corrected)
      if(ld.state === 3 && ld._updateTime && ld.bpm > 0){
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

  // layerState[0-7] at body[72-79]
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld) d[72+n] = ld.state || 0;
  }

  // generalSMPTEMode at body[81]
  d[81] = 0x00;

  // layerTimecode[0-7] at body[82-129] (6B each: mode, state, h, m, s, frames)
  for(let n=0;n<8;n++){
    const ld = layers && layers[n];
    if(ld){
      let ms = ld.timecodeMs || 0;
      if(ld.state === 3 && ld._updateTime && ld.bpm > 0) ms += (now - ld._updateTime);
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const frames = Math.floor((ms % 1000) / 33.33);  // ~30fps
      const off = 82 + n*6;
      d[off+0] = 0;      // mode
      d[off+1] = (ld.state === 3) ? 1 : 0;  // state: 1=running if PLAYING
      d[off+2] = h;
      d[off+3] = m;
      d[off+4] = s;
      d[off+5] = frames;
    }
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
    d[3] = layerData.state || 0;
    d[5] = 0x01;  // syncMaster = Master
    d[7] = layerData.beatPhase || 0;
    d.writeUInt32LE(layerData.totalLength || 0, 8);   // trackLength ms
    let curMs = layerData.timecodeMs || 0;
    if(layerData.state === 3 && layerData._updateTime && layerData.bpm > 0) curMs += (Date.now() - layerData._updateTime);
    d.writeUInt32LE(u32(curMs), 12);    // currentPosition ms (interpolated)
    d.writeUInt32LE(layerData.state===3 ? 0x8000 : 0, 16);  // speed (0x8000=100%, 0=stopped)
    d.writeUInt32LE(0, 33);                             // beatNumber
    const bpm = layerData.bpm || 0;
    d.writeUInt32LE(Math.round(bpm * 100), 88);        // bpm ×100
    d.writeUInt16LE(0x4000, 92);                        // pitchBend (중앙값)
    d.writeUInt32LE(layerData.trackId || 0, 94);       // trackID
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
    const artist = layerData.artistName || '';
    if(artist){
      const artistBuf = Buffer.from(artist, 'utf8');
      artistBuf.copy(d, 5, 0, Math.min(artistBuf.length, 255));
    }

    const track = layerData.trackName || '';
    if(track){
      const trackBuf = Buffer.from(track, 'utf8');
      trackBuf.copy(d, 261, 0, Math.min(trackBuf.length, 255));
    }

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

// ─────────────────────────────────────────────
// Pro DJ Link parser
// ─────────────────────────────────────────────
function parsePDJL(msg){
  if(msg.length<11) return null;
  for(let i=0;i<10;i++) if(msg[i]!==PDJL.MAGIC[i]) return null;
  const type = msg[10];
  const name = msg.slice(0x0B,0x1B).toString('ascii').replace(/\0/g,'').trim();

  if(type===PDJL.CDJ && msg.length>=0x90){
    const pNum = msg[0x24]; if(pNum<1||pNum>6) return null;
    const p1   = msg[0x7B];
    const state= P1_TO_STATE[p1] ?? STATE.IDLE;
    // BPM: uint32BE at 0x90 — top bit 0x80 = valid, lower 16 bits = BPM×100
    const bpmRaw = msg.length>0x93 ? msg.readUInt32BE(0x90) : 0;
    const bpmEff = (bpmRaw&0x80000000)&&bpmRaw!==0x80000000 ? (bpmRaw&0xFFFF)/100 : 0;
    // Pitch: signed offset from 0x100000 at 0x8C
    const pitchRaw = msg.length>0x8F ? msg.readUInt32BE(0x8C) : 0x100000;
    const pitch = (pitchRaw-0x100000)/0x100000*100;
    // Base BPM = effective / (1 + pitch/100)
    const baseBpm = bpmEff>0&&Math.abs(pitch)>0.01 ? bpmEff/(1+pitch/100) : bpmEff;
    const beatNum   = msg.length>0xA3 ? msg.readUInt32BE(0xA0) : 0;
    const beatInBar = msg.length>0xA6 ? msg[0xA6] : 0;
    const barsRemain = msg.length>0xA5 ? msg.readUInt16BE(0xA4) : 0;
    const trackBeats = msg.length>0xB7 ? msg.readUInt32BE(0xB4) : 0;
    const flags = msg.length>0x89 ? msg[0x89] : 0;
    return{
      kind:'cdj', playerNum:pNum, name, p1, state,
      p1Name: P1_NAME[p1]||`0x${p1.toString(16)}`,
      isPlaying: state===STATE.PLAYING,
      bpm:bpmEff, bpmTrack:baseBpm, bpmEffective:bpmEff,
      pitch,
      trackId: msg.readUInt32BE(0x2C),
      trackDeviceId: msg[0x28],  // source player that owns the media
      slot:     msg[0x29],       // 0=None, 1=CD, 2=SD, 3=USB, 4=Collection
      trackType: msg[0x2A],      // 0=None, 1=RB, 2=Unanalyzed, 5=AudioCD
      hasTrack: msg[0x29]>0,
      beatNum, beatInBar, barsRemain, trackBeats,
      firmware: msg.slice(0x7C,0x80).toString('ascii').replace(/\0/g,'').trim(),
      isOnAir:  !!(flags&0x10), isMaster: !!(flags&0x20), isSync: !!(flags&0x01),
    };
  }
  if((type===PDJL.DJM || type===PDJL.DJM2) && msg.length>=0x70){
    // DJM Mixer Status (type 0x29 or 0x39, port 50002)
    // Debug: hex dump first packet to find correct fader offsets
    if(!parsePDJL._djmDumped){
      parsePDJL._djmDumped=true;
      try{
        console.log(`[DJM] mixer status type=0x${type.toString(16)} len=${msg.length}`);
        const hex=msg.slice(0x20,Math.min(0x80,msg.length)).toString('hex').match(/.{2}/g).join(' ');
        console.log(`[DJM] hex@0x20: ${hex}`);
        for(const base of [0x24,0x3C,0x54,0x6C]){
          if(base+2>msg.length) break;
          const vals=[];
          for(let i=0;i<24&&base+i+1<msg.length;i+=2) vals.push(`+${i}:${msg.readUInt16BE(base+i).toString(16)}`);
          console.log(`[DJM] block@0x${base.toString(16)}: ${vals.join(' ')}`);
        }
      }catch(_){}
    }
    const ch=[0x24,0x3C,0x54,0x6C].map(off=>{
      if(off+1>=msg.length) return 0;
      const raw=msg.readUInt16BE(off);
      return Math.round(raw/0x3FF*255);
    });
    if(!parsePDJL._lastDjm || parsePDJL._lastDjm.some((v,i)=>v!==ch[i])){
      parsePDJL._lastDjm=ch.slice();
      try{console.log(`[DJM] faders=[${ch}]`);}catch(_){}
    }
    return{kind:'djm',name,channel:ch};
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
    return{kind:'djm_meter',name,ch};
  }
  // DJM Channels On-Air (type 0x03, 45B, port 50001)
  if(type===PDJL.DJM_ONAIR && msg.length>=0x2C){
    const name2 = msg.slice(0x0B,0x1B).toString('ascii').replace(/\0/g,'').trim();
    if(name2.includes('DJM')){
      // Debug: hex dump on-air packet to find all available data
      if(!parsePDJL._onairDumped){
        parsePDJL._onairDumped=true;
        try{
          const hex=msg.toString('hex').match(/.{2}/g).join(' ');
          console.log(`[DJM] on-air packet len=${msg.length}: ${hex}`);
        }catch(_){}
      }
      // On-air flags at byte 0x24+channel (1-based skipping 0x28 which is cross-fader assign)
      // On-air flags at 2-byte intervals: 0x25, 0x27, 0x29, 0x2B
      return{kind:'djm_onair',name:name2,
        onAir:[msg[0x25]?1:0, msg[0x27]?1:0, msg[0x29]?1:0, msg[0x2B]?1:0]};
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
    return{kind:'announce',name,playerNum:msg.length>0x24?msg[0x24]:0};
  }
  return null;
}

// ─────────────────────────────────────────────
// BridgeCore
// ─────────────────────────────────────────────
class BridgeCore {
  constructor(opts={}){
    this.tcnetBindAddr = opts.tcnetIface||null;
    this.pdjlBindAddr  = opts.pdjlIface||null;
    this.broadcastAddr = 'auto';

    this.isLocalMode   = (opts.tcnetIface==='127.0.0.1');

    this.tcnetMode = opts.tcnetMode || 'auto';  // 'auto' | 'server' | 'client'

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
    this.onAlbumArt       = null;   // (playerNum, jpegBuffer) => {}
    this._artCache = {};  // trackId -> {playerNum, jpegBase64}
    this._dbConns  = {};  // ip -> net.Socket
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
    return detectBroadcastFor(this.tcnetBindAddr);
  }

  async start(){
    this.broadcastAddr = this._resolveBroadcast();

    if(!this._nameSet){
      const suffix = String(Math.floor(Math.random()*900)+100);
      TC.NNAME = 'BRIDGE' + suffix;
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

    await new Promise(res=>{
      const tryBind = port => {
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
      const timePkt = mkTime(this.layers, Date.now()-this.startTime);
      this._send(timePkt, TC.P_TIME);
      this._sendToArenas(timePkt, TC.P_TIME);
      this._sendToArenasLPort(timePkt);
      this.packetCount++;
    }, 33);
    // DATA packets cycle through layers: MetricsData + MetaData per layer
    const t4 = setInterval(()=>this._sendDataCycle(), 170);

    this._timers = [t1, t2, t3, t4];
    this._startTCNetRx();

    if(!this.isLocalMode){
      await this._startPDJLRx();
      this._startPDJLAnnounce();
    }

    const nid = TC.NID[1].toString(16)+TC.NID[0].toString(16);
    console.log(`[v13] mode=${this.isLocalMode?'LOCAL(127.0.0.1)':'NETWORK'} bc=${this.broadcastAddr} localIP=${this.localAddr||'none'}`);
    console.log(`[v13] NodeID=0x${nid}, NodeType=0x${TC.NTYPE.toString(16)}, lPort=${this.listenerPort}, name=${TC.NNAME}`);
    console.log(`[v13] Sending: OptIn(1s) + Status(170ms) + TIME(33ms) + DATA(170ms)`);
    console.log(`[v13] Triple-send: broadcast + localIP(${this.localAddr}) + 127.0.0.1`);
    return this;
  }

  stop(){
    if(!this.running && !this.txSocket) return; // already stopped
    this.running = false;
    // clear all intervals and timeouts
    this._timers.forEach(t=>{clearInterval(t);clearTimeout(t);}); this._timers=[];
    try{ const b=Buffer.alloc(TC.H); buildHdr(TC.OPTOUT).copy(b,0); this._send(b,TC.P_BC); }catch(_){}
    // close all UDP sockets including PDJL
    const sockets = [this.txSocket,this.rxSocket,this._loRxSocket,this._ipRxSocket,this.lPortSocket];
    if(this._pdjlSockets) this._pdjlSockets.forEach(s=>sockets.push(s));
    else if(this.pdjlSocket) sockets.push(this.pdjlSocket);
    sockets.forEach(s=>{try{s?.close();}catch(_){}});
    this.txSocket=null; this.rxSocket=null; this._loRxSocket=null;
    this._ipRxSocket=null; this.lPortSocket=null; this.pdjlSocket=null;
    this._pdjlSockets=[];
    try{this._pdjlAnnSock?.close();}catch(_){}
    this._pdjlAnnSock=null;
    // close dbserver TCP connections
    for(const [k,s] of Object.entries(this._dbConns)){
      try{s.removeAllListeners();s.destroy();}catch(_){}
    }
    this._dbConns={};
    // remove all callbacks to prevent post-stop activity
    this.onNodeDiscovered=null; this.onCDJStatus=null; this.onDJMStatus=null;
    this.onDJMMeter=null; this.onDeviceList=null; this.onWaveformPreview=null;
    this.onAlbumArt=null; this.onTrackMetadata=null;
    console.log('[BridgeCore] stop: all sockets and connections closed');
  }

  /**
   * Send to broadcast + own IP unicast + 127.0.0.1
   * (covers Arena on same machine regardless of which interface it binds to)
   */
  _send(buf, port){
    if(!this.running||!this.txSocket) return;
    try{ this.txSocket.send(buf, 0, buf.length, port, this.broadcastAddr); }catch(_){}
    if(!this.isLocalMode){
      // Also send to 255.255.255.255 if broadcastAddr is subnet-specific
      if(this.broadcastAddr!=='255.255.255.255'){
        try{ this.txSocket.send(buf, 0, buf.length, port, '255.255.255.255'); }catch(_){}
      }
      if(this.localAddr){
        try{ this.txSocket.send(buf, 0, buf.length, port, this.localAddr); }catch(_){}
      }
      try{ this.txSocket.send(buf, 0, buf.length, port, '127.0.0.1'); }catch(_){}
    }
  }
  _uc(buf, port, ip){
    if(!this.running||!this.txSocket||!ip||!port) return;
    try{ this.txSocket.send(buf, 0, buf.length, port, ip); }catch(_){}
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
      // 같은 머신이면 127.0.0.1로도 전송
      if(!this.isLocalMode){try{ this.txSocket.send(buf, 0, buf.length, node.lPort, '127.0.0.1'); }catch(_){}}
    }
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

    // send to Arena lPort when known; always broadcast to P_DATA as fallback
    const hasArenas = Object.values(this.nodes).some(n=>Date.now()-n.lastSeen<15000);
    if(hasArenas){
      this._sendToArenasLPort(pkt);
      this._sendToArenasSourcePort(pkt);
    }
    // broadcast:60002는 항상 (Arena 미발견 대비 + 새로운 Arena 탐색용)
    this._send(pkt, TC.P_DATA);

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
    if(type===TC.APP){
      if(!this._lPortDbg)this._lPortDbg={};
      if(!this._lPortDbg['txapp_'+rinfo.address]){this._lPortDbg['txapp_'+rinfo.address]=true;console.log(`[${label}] APP from ${name} → ${rinfo.address}:${rinfo.port}`);}
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
    sock.bind(TC.P_BC, bindAddr, ()=>{
      console.log(`[TCNet] RX bound to ${bindAddr||'0.0.0.0'}:${TC.P_BC}`);
      if(!this.isLocalMode){ try{ sock.addMembership('224.0.0.1'); }catch(_){} }
    });

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
          if(isNew) console.log(`[lPort] OptIn: ${name}@${rinfo.address} lPort=${lPort} vendor=${vendor} device=${device}`);
          this.onNodeDiscovered?.(this.nodes[key]);
        }
        if(type===TC.APP){
          const body = msg.slice(TC.H);
          const lPort = body.length>=22 ? body.readUInt16LE(20) : this.listenerPort;
          if(!this._lPortDbg['app_'+rinfo.address]){this._lPortDbg['app_'+rinfo.address]=true;console.log(`[lPort] APP from ${name} → ${rinfo.address}:${rinfo.port}`);}
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
    for(const port of [50002, 50001]){
      try{
        const sock = dgram.createSocket({type:'udp4', reuseAddr:true});
        await new Promise((res,rej)=>{
          sock.on('error',rej);
          sock.bind(port, this.pdjlBindAddr||undefined, ()=>{ sock.setBroadcast(true); res(); });
        });
        sock.on('message',(msg,rinfo)=>this._onPDJL(msg,rinfo));
        sock.on('error',()=>{});
        this._pdjlSockets.push(sock);
        if(!this.pdjlSocket){ this.pdjlSocket = sock; this.pdjlPort = port; }
        console.log(`[PDJL] UDP ${port} active`);
      }catch(e){ console.warn(`[PDJL] port ${port} fail: ${e.message}`); }
    }
    if(this._pdjlSockets.length===0) console.warn('[PDJL] all ports failed');
  }

  // Pro DJ Link keep-alive announcement on 50000
  // CDJs only send status to devices they see on the network
  _startPDJLAnnounce(){
    // Find the link-local (169.254.x.x) interface for PDJL
    let pdjlIP=null, pdjlMAC='00:00:00:00:00:00', pdjlBC='169.254.255.255';
    for(const iface of getAllInterfaces()){
      if(!iface.internal && iface.address.startsWith('169.254.')){
        pdjlIP=iface.address; pdjlMAC=iface.mac||pdjlMAC;
        pdjlBC=iface.broadcast||pdjlBC;
        break;
      }
    }
    // Also try pdjlBindAddr if specified
    if(this.pdjlBindAddr && this.pdjlBindAddr.startsWith('169.254.')){
      pdjlIP=this.pdjlBindAddr;
    }
    if(!pdjlIP){
      // Try all non-internal interfaces
      for(const iface of getAllInterfaces()){
        if(!iface.internal && !iface.isLoopback){
          pdjlIP=iface.address; pdjlMAC=iface.mac||pdjlMAC;
          pdjlBC=iface.broadcast||pdjlBC;
        }
      }
    }
    if(!pdjlIP){console.warn('[PDJL] no interface found for keep-alive');return;}

    console.log(`[PDJL] announcing on ${pdjlIP} → ${pdjlBC}:50000 MAC=${pdjlMAC}`);

    // Build keep-alive packet (type 0x06, 54 bytes)
    const macBytes=pdjlMAC.split(':').map(h=>parseInt(h,16));
    const ipParts=pdjlIP.split('.').map(Number);

    // Create a dedicated socket for 50000 broadcast (CDJ announcement)
    this._pdjlAnnSock=dgram.createSocket({type:'udp4',reuseAddr:true});
    this._pdjlAnnSock.on('error',()=>{});
    this._pdjlAnnSock.bind(0, pdjlIP, ()=>{
      try{this._pdjlAnnSock.setBroadcast(true);}catch(_){}
    });

    const sendAnn=()=>{
      const pkt=Buffer.alloc(54);
      PDJL.MAGIC.copy(pkt,0);          // 0x00: magic (10 bytes)
      pkt[0x0A]=0x06;                   // type = keep-alive
      pkt[0x0B]=0x00;                   // sub-type byte
      // Device name: 20 bytes at 0x0C-0x1F (padded with 0)
      const nameStr='BRIDGE-CLONE';
      Buffer.from(nameStr,'ascii').copy(pkt,0x0C,0,Math.min(nameStr.length,20));
      pkt[0x20]=0x01;                   // unknown (always 1 in captures)
      pkt[0x21]=0x01;                   // proto ver?
      pkt[0x22]=0x00;                   // pad
      pkt[0x23]=0x36;                   // length marker
      pkt[0x24]=0x05;                   // D = device/player number: 5 (avoids conflict with P1-P4)
      pkt[0x25]=0x01;                   // Dt = device type: 0x01=CDJ (required for dbserver)
      // MAC address at 0x26-0x2B
      for(let i=0;i<6;i++) pkt[0x26+i]=macBytes[i]||0;
      // IP at 0x2C-0x2F
      for(let i=0;i<4;i++) pkt[0x2C+i]=ipParts[i];
      // Tail bytes
      pkt[0x30]=0x08; pkt[0x34]=0x05; pkt[0x35]=0x64; // 0x35=0x64 for CDJ-3000 compatibility
      try{this._pdjlAnnSock.send(pkt,0,pkt.length,50000,pdjlBC);}catch(e){console.warn('[PDJL] ann:',e.message);}
    };

    sendAnn();
    const t=setInterval(sendAnn,1500); // 1.5s like real CDJs
    this._timers.push(t);
  }

  _onPDJL(msg, rinfo){
    const p = parsePDJL(msg);
    // Debug: log first occurrence of each PDJL packet type per source
    if(!this._pdjlDbg){this._pdjlDbg={};try{console.log('[PDJL] listening on',this.pdjlBindAddr||'0.0.0.0');}catch(_){}}
    const dbgK=rinfo.address+':'+msg[10];
    if(!this._pdjlDbg[dbgK]){
      this._pdjlDbg[dbgK]=true;
      try{console.log(`[PDJL] packet type=0x${msg[10]?.toString(16)} from ${rinfo.address}:${rinfo.port} len=${msg.length} parsed=${p?.kind||'null'}`);}catch(_){}
      // Extra debug: if from DJM IP (non-CDJ), dump hex header for analysis
      if(!p || p.kind==='djm_onair'){
        try{
          const devName=msg.slice(0x0B,0x1B).toString('ascii').replace(/\0/g,'').trim();
          if(devName.includes('DJM')){
            console.log(`[DJM-DBG] type=0x${msg[10]?.toString(16)} len=${msg.length} name=${devName}`);
            if(msg.length>0x24) console.log(`[DJM-DBG] hex@0x20: ${msg.slice(0x20,Math.min(0x30,msg.length)).toString('hex')}`);
          }
        }catch(_){}
      }
    }
    if(!p) return;
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

        const acc = this._tcAcc[li];
        const trackChanged = !acc || acc.trackId !== p.trackId;
        let timecodeMs = 0;

        if(trackChanged){
          this._tcAcc[li] = { prevBn: p.beatNum, elapsedMs: 0, trackId: p.trackId, dbgCount:0, metaRequested:false };
          try{console.log(`[TC] P${p.playerNum} track change: trackId=${p.trackId} hasTrack=${p.hasTrack} slot=${p.slot} trackType=${p.trackType} trackDeviceId=${p.trackDeviceId} ip=${rinfo?.address}`);}catch(_){}
          // Auto-request metadata — must query the SOURCE device's dbserver (Link Export)
          if(p.trackId>0 && p.hasTrack){
            this._tcAcc[li].metaRequested = true;
            // Find source device IP: trackDeviceId tells us which player owns the media
            const srcDev = this.devices['cdj'+p.trackDeviceId];
            const _ip = srcDev?.ip || rinfo?.address;
            const _slot=p.slot||3, _tid=p.trackId, _pn=p.playerNum, _tt=p.trackType||1;
            try{console.log(`[TC] P${p.playerNum} meta request → device ${p.trackDeviceId} ip=${_ip}`);}catch(_){}
            setTimeout(()=>this.requestMetadata(_ip, _slot, _tid, _pn, false, _tt), this._dbReady?100:3000);
            this._dbReady = true;
          }
        } else if(acc && !acc.metaRequested && p.trackId>0 && p.hasTrack){
          acc.metaRequested = true;
          const srcDev = this.devices['cdj'+p.trackDeviceId];
          const _ip = srcDev?.ip || rinfo?.address;
          try{console.log(`[TC] P${p.playerNum} metadata retry → device ${p.trackDeviceId} ip=${_ip}`);}catch(_){}
          this.requestMetadata(_ip, p.slot||3, p.trackId, p.playerNum, false, p.trackType||1);
        }
        if(acc && p.beatNum > 0 && p.bpm > 0){
          // Absolute timecode: beatNum × beat duration (ms per beat at current BPM)
          // This gives the correct position from track start, no drift
          const msPerBeat = 60000 / p.bpm;
          const absoluteMs = p.beatNum * msPerBeat;
          const deltaBn = p.beatNum - acc.prevBn;
          if(deltaBn > 0 && acc.dbgCount < 20){
            acc.dbgCount++;
            try{console.log(`[TC] P${p.playerNum} beat=${p.beatNum} delta=${deltaBn} ms=${Math.round(absoluteMs)} bpm=${p.bpm}`);}catch(_){}
          }
          acc.prevBn = p.beatNum;
          timecodeMs = Math.round(absoluteMs);
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
            totalLength: 0,
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
      this.faders=p.channel;
      if(!this.devices['djm']){
        this.devices['djm']={type:'DJM',name:p.name||'DJM',ip:rinfo.address,lastSeen:Date.now()};
        this.onDeviceList?.(this.devices);
      } else this.devices['djm'].lastSeen=Date.now();
      this.onDJMStatus?.(p.channel);
    }
    if(p.kind==='djm_meter'){
      this.onDJMMeter?.(p.ch);
    }
    // DJM Channels-On-Air (type 0x03 on port 50001)
    if(p.kind==='djm_onair'){
      this.onAir = p.onAir;
      if(!this.devices['djm']){
        this.devices['djm']={type:'DJM',name:p.name||'DJM',ip:rinfo.address,lastSeen:Date.now()};
        this.onDeviceList?.(this.devices);
      } else this.devices['djm'].lastSeen=Date.now();
    }
    if(p.kind==='cdj_wf'){
      this.onWaveformPreview?.(p.playerNum, {seg:p.seg, pts:p.pts, wfType:p.wfType});
    }
    if(p.kind==='announce'){
      const k=`dev_${rinfo.address}`;
      if(!this.devices[k]){
        this.devices[k]={type:'DEVICE',name:p.name,ip:rinfo.address,lastSeen:Date.now()};
        this.onDeviceList?.(this.devices);
      }
    }
  }

  // ── API ─────────────────────────────────────
  /** Update layer state; actual transmission happens in Status/TIME packets. */
  updateLayer(i, data){
    if(i<0||i>7) return;
    const prev = this.layers[i];

    const newTrackName  = data.trackName  || (prev ? prev.trackName  : '');
    const newArtistName = data.artistName || (prev ? prev.artistName : '');

    this.layers[i] = {
      timecodeMs:  data.timecodeMs||0,
      state:       data.state ?? STATE.IDLE,
      bpm:         data.bpm||0,
      trackId:     data.trackId||0,
      totalLength: data.totalLength||0,
      trackName:   newTrackName,
      artistName:  newArtistName,
      deviceName:  data.deviceName || (prev ? prev.deviceName : ''),
      beatPhase:   data.beatPhase||0,
      _updateTime: Date.now(),  // for timecode interpolation
    };
  }

  removeLayer(i){ if(i>=0&&i<=7){ this.layers[i]=null; this._syncVirtualDevices(); } }
  setHWMode(i,e){ if(i>=0&&i<=7) this.hwMode[i]=e; }

  /** Register virtual deck in devices list so Arena sees a CDJ model name. */
  registerVirtualDeck(slot, modelName){
    if(slot<0||slot>7) return;
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
  getActiveDevices(){ const now=Date.now(); return Object.values(this.devices).filter(d=>now-d.lastSeen<10000); }
  getPDJLPort(){ return this.pdjlPort; }

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

  _dbReadFullResponse(sock){
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
        }, 300); // 300ms idle = response complete
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
    // Spoof as player 5 (unlikely to conflict with real CDJs 1-4)
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
      const renderReq = this._dbBuildMsg(txId+1, 0x3000, [
        rmst, this._dbArg4(0), this._dbArg4(64),
        this._dbArg4(0), this._dbArg4(64), this._dbArg4(0)
      ]);
      sock.write(renderReq);
      const fullResp = await this._dbReadFullResponse(sock);

      // Parse menu items
      const items = this._dbParseItems(fullResp);
      console.log(`[DBSRV] P${playerNum} render resp: ${fullResp.length}B, items=${items.length}`);
      if(items.length===0) console.log(`[DBSRV] P${playerNum} resp hex(first 80): ${fullResp.slice(0,80).toString('hex')}`);
      const meta = {};
      for(const item of items){
        if(item.msgType===0x4101){
          // MENU_ITEM: args[3]=label1(str), args[6]=itemType(num), args[8]=artworkId
          const itemType = item.args[6]?.val || 0;
          const label1 = item.args[3]?.val || '';
          switch(itemType){
            case 0x0004: meta.title=label1; meta.artworkId=item.args[8]?.val||0; break;
            case 0x0007: meta.artist=label1; break;
            case 0x0002: meta.album=label1; break;
            case 0x000b: meta.duration=item.args[1]?.val||0; break;
            case 0x000d: meta.bpm=(item.args[1]?.val||0)/100; break;
            case 0x000f: meta.key=label1; break;
            case 0x0006: meta.genre=label1; break;
          }
        }
      }
      console.log(`[DBSRV] P${playerNum} metadata:`, JSON.stringify(meta));

      // Emit metadata
      if(meta.title||meta.artist){
        this.onTrackMetadata?.(playerNum, meta);
      }

      // Request artwork if available
      if(meta.artworkId){
        const artRmst = this._dbRMST(spoofPlayer, 0x08, slot, 0x01);
        const artReq = this._dbBuildMsg(txId+2, 0x2003, [artRmst, this._dbArg4(meta.artworkId)]);
        sock.write(artReq);
        const artResp = await this._dbReadFullResponse(sock);
        // Find JPEG in response
        const jpegStart = artResp.indexOf(Buffer.from([0xFF,0xD8]));
        const jpegEnd = artResp.lastIndexOf(Buffer.from([0xFF,0xD9]));
        if(jpegStart>=0 && jpegEnd>jpegStart){
          const jpeg = artResp.slice(jpegStart, jpegEnd+2);
          const b64 = 'data:image/jpeg;base64,' + jpeg.toString('base64');
          this._artCache[`art_${ip}_${slot}_${meta.artworkId}`] = b64;
          this.onAlbumArt?.(playerNum, b64);
          console.log(`[DBSRV] P${playerNum} artwork: ${jpeg.length}B`);
        }
      }

      // Teardown
      try{
        const teardown = this._dbBuildMsg(0xfffffffe, 0x0100, []);
        sock.write(teardown);
      }catch(_){}
    }catch(e){
      throw e;
    }finally{
      try{sock?.destroy();}catch(_){}
    }
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
      const jpegStart = artResp.indexOf(Buffer.from([0xFF,0xD8]));
      const jpegEnd = artResp.lastIndexOf(Buffer.from([0xFF,0xD9]));
      if(jpegStart>=0 && jpegEnd>jpegStart){
        const jpeg = artResp.slice(jpegStart, jpegEnd+2);
        const b64 = 'data:image/jpeg;base64,' + jpeg.toString('base64');
        this._artCache[cacheKey] = b64;
        this.onAlbumArt?.(playerNum, b64);
      }
      try{sock.write(this._dbBuildMsg(0xfffffffe,0x0100,[]));sock.destroy();}catch(_){}
    }catch(e){throw e;}
    finally{try{sock?.destroy();}catch(_){}}
  }
}

module.exports = {
  BridgeCore, getAllInterfaces,
  mkOptIn, mkStatus, mkTime, mkAppResp, mkMetadataResp,
  mkDataMetrics, mkDataMeta, mkNotification,
  parsePDJL,
  TC, PDJL, STATE, P1_TO_STATE, P1_NAME,
};
