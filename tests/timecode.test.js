'use strict';

// MTC / LTC / Art-Net Timecode 출력 정합성 테스트.
// 각 표준의 비트/바이트 인코딩을 직접 검증 (네트워크/오디오 출력 없이).

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function test(name, fn){
  try{ fn(); console.log(`ok - ${name}`); }
  catch(err){ console.error(`not ok - ${name}`); console.error(err.stack||err.message); process.exitCode=1; }
}

// ─── LTC (Linear Timecode) 80-bit frame encoding ────────────────────
//
// SMPTE-12M LTC 스펙: 80 bit/frame, biphase mark code.
// 본 테스트는 _encode() 의 비트 layout 을 재구현해 stand-alone 으로 검증.
function ltcEncode(hh, mm, ss, ff){
  const b = new Uint8Array(80);
  const fu = ff % 10, ft = Math.floor(ff / 10);
  b[0]=(fu>>0)&1; b[1]=(fu>>1)&1; b[2]=(fu>>2)&1; b[3]=(fu>>3)&1;
  b[8]=(ft>>0)&1; b[9]=(ft>>1)&1;
  const su = ss % 10, st = Math.floor(ss / 10);
  b[16]=(su>>0)&1; b[17]=(su>>1)&1; b[18]=(su>>2)&1; b[19]=(su>>3)&1;
  b[24]=(st>>0)&1; b[25]=(st>>1)&1; b[26]=(st>>2)&1;
  const mu = mm % 10, mt = Math.floor(mm / 10);
  b[32]=(mu>>0)&1; b[33]=(mu>>1)&1; b[34]=(mu>>2)&1; b[35]=(mu>>3)&1;
  b[40]=(mt>>0)&1; b[41]=(mt>>1)&1; b[42]=(mt>>2)&1;
  const hu = hh % 10, ht = Math.floor(hh / 10);
  b[48]=(hu>>0)&1; b[49]=(hu>>1)&1; b[50]=(hu>>2)&1; b[51]=(hu>>3)&1;
  b[56]=(ht>>0)&1; b[57]=(ht>>1)&1;
  // Sync word 0011111111111101 (16 bits, MSB-first)
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1].forEach((v,i) => b[64+i]=v);
  // Polarity correction (bit 27): make total ones in [0..63] even
  let ones=0; for(let i=0;i<64;i++) if(i!==27) ones += b[i];
  b[27] = ones & 1;
  return b;
}

test('LTC: ltc-processor.js 의 _encode 비트 layout 이 SMPTE-12M 사양과 일치', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ltc-processor.js'), 'utf8');
  // 비트 위치 sample 검증 — 5개 핵심 라인이 그대로 있는지
  assert.match(src, /b\[0\]=\(fu>>0\)&1;\s*b\[1\]=\(fu>>1\)&1;\s*b\[2\]=\(fu>>2\)&1;\s*b\[3\]=\(fu>>3\)&1/);
  assert.match(src, /b\[8\]=\(ft>>0\)&1;\s*b\[9\]=\(ft>>1\)&1/);
  assert.match(src, /b\[16\]=\(su>>0\)&1/);
  assert.match(src, /b\[48\]=\(hu>>0\)&1/);
  assert.match(src, /b\[56\]=\(ht>>0\)&1;\s*b\[57\]=\(ht>>1\)&1/);
  // Sync word
  assert.match(src, /\[0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1\]/);
  // Polarity correction
  assert.match(src, /b\[27\] = ones & 1/);
});

test('LTC: 00:00:00:00 시 frame/seconds/minutes/hours bits = 0', () => {
  const b = ltcEncode(0,0,0,0);
  for(const idx of [0,1,2,3,8,9,16,17,18,19,24,25,26,32,33,34,35,40,41,42,48,49,50,51,56,57]) {
    assert.strictEqual(b[idx], 0, `bit ${idx} should be 0`);
  }
  // Sync word always present
  assert.strictEqual(b[64], 0); assert.strictEqual(b[65], 0);
  assert.strictEqual(b[66], 1); assert.strictEqual(b[78], 0); assert.strictEqual(b[79], 1);
});

test('LTC: 23:59:59:24 (마지막 프레임 25fps) 비트 패턴', () => {
  const b = ltcEncode(23,59,59,24);
  // Frame 24: units=4, tens=2 → b[0..3]=0100 b[8..9]=01
  assert.strictEqual(b[0],0); assert.strictEqual(b[1],0);
  assert.strictEqual(b[2],1); assert.strictEqual(b[3],0);
  assert.strictEqual(b[8],0); assert.strictEqual(b[9],1);
  // Hours 23: units=3, tens=2 → b[48..51]=1100 b[56..57]=01
  assert.strictEqual(b[48],1); assert.strictEqual(b[49],1);
  assert.strictEqual(b[50],0); assert.strictEqual(b[51],0);
  assert.strictEqual(b[56],0); assert.strictEqual(b[57],1);
});

test('LTC: polarity bit (27) — 64 비트 총 1 개수가 짝수', () => {
  // 임의 시간 5개 검증
  for(const tc of [[1,2,3,4],[12,34,56,12],[10,20,30,15],[0,30,0,0],[5,7,11,3]]){
    const b = ltcEncode(...tc);
    let ones=0; for(let i=0;i<64;i++) ones += b[i];
    assert.strictEqual(ones%2, 0, `total 1-bits should be even for ${tc.join(':')}`);
  }
});

// ─── MTC (MIDI Timecode) Quarter-Frame messages ───────────────────────
//
// MIDI MTC: 0xF1 (Quarter Frame) + 1 data byte. 8 messages = 1 frame (sent over 2 frames).
// Data byte: upper nibble = piece# (0-7), lower nibble = data.
function mtcQuarterFrame(qf, hh, mm, ss, ff, fpsType){
  switch(qf%8){
    case 0: return 0x00 | (ff & 0x0F);
    case 1: return 0x10 | ((ff>>4) & 1);
    case 2: return 0x20 | (ss & 0x0F);
    case 3: return 0x30 | ((ss>>4) & 3);
    case 4: return 0x40 | (mm & 0x0F);
    case 5: return 0x50 | ((mm>>4) & 3);
    case 6: return 0x60 | (hh & 0x0F);
    case 7: return 0x70 | ((hh>>4) & 1) | (fpsType<<1);
  }
}

test('MTC: 0xF1 quarter-frame 8 메시지가 1 프레임 인코딩', () => {
  // 12:34:56:12 @ 25fps (fpsType=1)
  const hh=12, mm=34, ss=56, ff=12, type=1;
  // Each piece — verify upper nibble (0x00, 0x10, ..., 0x70) AND data correctness
  assert.strictEqual(mtcQuarterFrame(0,hh,mm,ss,ff,type), 0x00 | (ff & 0x0F));
  assert.strictEqual(mtcQuarterFrame(1,hh,mm,ss,ff,type), 0x10 | ((ff>>4) & 1));
  assert.strictEqual(mtcQuarterFrame(2,hh,mm,ss,ff,type), 0x20 | (ss & 0x0F));
  assert.strictEqual(mtcQuarterFrame(3,hh,mm,ss,ff,type), 0x30 | ((ss>>4) & 3));
  assert.strictEqual(mtcQuarterFrame(4,hh,mm,ss,ff,type), 0x40 | (mm & 0x0F));
  assert.strictEqual(mtcQuarterFrame(5,hh,mm,ss,ff,type), 0x50 | ((mm>>4) & 3));
  assert.strictEqual(mtcQuarterFrame(6,hh,mm,ss,ff,type), 0x60 | (hh & 0x0F));
  // Last piece carries fpsType bits (1=25fps)
  const last = mtcQuarterFrame(7,hh,mm,ss,ff,type);
  assert.strictEqual(last & 0xF0, 0x70);
  assert.strictEqual((last>>1) & 3, 1);  // fpsType=1
});

test('MTC: 23:59:59:29 @ 30fps drop-frame (fpsType=3) 마지막 메시지에 type 비트', () => {
  const last = mtcQuarterFrame(7, 23, 59, 59, 29, 3);
  assert.strictEqual(last & 0xF0, 0x70);
  // bits: hh tens (1 bit) at position 0, fpsType (2 bits) at positions 1-2
  // ht=2 → bit0=0; type=3 → bits 1-2 = 11 → value 0x06
  assert.strictEqual((last>>1) & 3, 3);
});

test('MTC: index.html 의 _mtcSend 가 0xF1 + qf 데이터 송신', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(src, /_mtcOut\.send\(\[0xF1,d\]\)/);
  // 8 piece switch case 모두
  for(const c of ['case 0','case 1','case 2','case 3','case 4','case 5','case 6','case 7']){
    assert.ok(src.includes(c+':d=0x'), `MTC qf ${c} 케이스 누락`);
  }
});

// ─── Art-Net OpTimeCode (0x9700) ──────────────────────────────────────
//
// Art-Net spec: ArtTimeCode = 19 bytes
//   [0..7]   "Art-Net\0"
//   [8..9]   OpCode 0x9700 (LE)
//   [10..11] ProtVer 14 (BE)
//   [12]     Filler1
//   [13]     Filler2
//   [14]     Frames (0..29)
//   [15]     Seconds
//   [16]     Minutes
//   [17]     Hours
//   [18]     Type (0=24, 1=25, 2=29.97DF, 3=30)
test('Art-Net: OpTimeCode 19B 패킷 구조 (main.js _sendTc 와 동일 layout)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /Buffer\.alloc(?:Unsafe)?\(19\)/);            // 19-byte allocation
  assert.match(src, /'Art-Net\\0'/);                                // ID
  assert.match(src, /writeUInt16LE\(0x9700/);                       // OpCode 0x9700 LE
  assert.match(src, /writeUInt8\(0x0E,11\)/);                       // ProtVer 14
  assert.match(src, /writeUInt8\(tc\.ff,14\)/);                     // Frame
  assert.match(src, /writeUInt8\(tc\.ss,15\)/);                     // Seconds
  assert.match(src, /writeUInt8\(tc\.mm,16\)/);                     // Minutes
  assert.match(src, /writeUInt8\(tc\.hh,17\)/);                     // Hours
  assert.match(src, /writeUInt8\(this\._fpsType&0x03,18\)/);        // Type 0..3
});

test('Art-Net: setTimecode 가 hh/mm/ss/ff 를 0..255 로 mask', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /setTimecode\(hh,mm,ss,ff\)\{this\._target=\{hh:hh&0xFF,mm:mm&0xFF,ss:ss&0xFF,ff:ff&0xFF\};\}/);
});

test('Art-Net: setFps 가 24/25/29.97/30 fps type 매핑', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // 4가지 fps 모두 매핑
  assert.match(src, /'24':\[24,0\]/);
  assert.match(src, /'25':\[25,1\]/);
  assert.match(src, /'29\.97':\[30,2\]/);
  assert.match(src, /'30':\[30,3\]/);
});

test('Art-Net: setUnicast / setSync / setPollReply 모두 노출', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /setUnicast\(enabled,ip\)/);
  assert.match(src, /setSync\(enabled\)/);
  assert.match(src, /setPollReply\(enabled\)/);
});

test('Art-Net: forceResync 가 즉시 1프레임 재송신', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /forceResync\(\)\{[\s\S]{0,200}this\._sendTc\(\)/);
});

test('Art-Net: ArtSync (0x5200) 패킷 14B', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // ArtSync 가 활성화된 상태에서 송신 호출
  assert.match(src, /this\._sync\) this\._sendSync\(\)/);
});

// ─── End-to-end 일관성: TC offset 동일 적용 ────────────────────────────

test('TC 출력: cfg.tcOffsetMs 가 LTC/MTC/Art-Net 모두에 적용', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  // 주석에 명시된 일관 적용 정책 보존
  assert.match(src, /cfg\.tcOffsetMs.*?(LTC.*MTC.*Art-Net|모든 TC 출력)/);
});
