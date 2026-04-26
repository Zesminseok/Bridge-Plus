// Pro DJ Link 패킷 파서 — bridge-core.js 에서 추출 (Phase 4.9 modularization).
// 출력 객체 shape 유지 (기존 parsePDJL 동작 동일).

const { PDJL, hasPDJLMagic, readPDJLNameField } = require('./packets');
const { STATE, P1_TO_STATE, P1_NAME } = require('../tcnet/packets');

function parsePDJL(msg){
  if(msg.length<11) return null;
  const hasMagic = hasPDJLMagic(msg);
  const type = msg[10];
  const name = readPDJLNameField(msg);
  const isKnownDjmShape =
    (type===PDJL.DJM && msg.length>=0x80) ||
    (type===PDJL.DJM2 && msg.length>=0x24) ||
    (type===PDJL.DJM_ONAIR && msg.length>=0x2C) ||
    (type===PDJL.DJM_METER && msg.length>=0x176);
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
    // Loop start/end from CDJ-3000 512B extended packet.
    // Pioneer 포맷: raw 는 position_ms × 1000 / 65536 으로 저장 → 역변환 ms = raw * 65536 / 1000.
    const loopStartRaw = msg.length>0x1C1 ? msg.readUInt32BE(0x1B6) : 0;
    const loopEndRaw   = msg.length>0x1C5 ? msg.readUInt32BE(0x1BE) : 0;
    const loopStartMs  = loopStartRaw > 0 ? Math.round(loopStartRaw * 65536 / 1000) : 0;
    const loopEndMs    = loopEndRaw   > 0 ? Math.round(loopEndRaw   * 65536 / 1000) : 0;
    return{
      kind:'cdj', playerNum:pNum, name, deviceName:name, p1, state,
      p1Name: P1_NAME[p1]||`0x${p1.toString(16)}`,
      // p1=0x07 (Cuing) 은 CUE 버튼 홀드로 preview-play 중 — 오디오/TC 진행 중
      //   매핑 상태는 CUEDOWN 유지 (TCNet out 호환) 하되 isPlaying 은 true.
      isPlaying: state===STATE.PLAYING || state===STATE.FFWD || state===STATE.FFRV || p1===0x07,
      isLooping: state===STATE.LOOPING,
      isReverse,
      loopStartMs, loopEndMs,
      bpm:bpmEff, bpmTrack:baseBpm, bpmEffective:bpmEff,
      pitch, effectivePitch:effPitch, pitchMultiplier,
      isNXS2,
      // 진단용 raw 값 — NXS2 BPM=0 디버그
      _rawMsgLen: msg.length,
      _bpmRaw16: bpmRaw16,
      _beatNumRaw,
      _trackBeatsRaw,
      _posFracRaw: posFracRaw,
      _msgHexHead: msg.slice(0,Math.min(0xC0,msg.length)).toString('hex'),
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

module.exports={ parsePDJL };
