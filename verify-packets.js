/**
 * 패킷 검증 스크립트
 * 
 * 우리가 생성한 TCNet 패킷을 실제 캡처한 Bridge 패킷과 비교합니다.
 * 캡처 파일 없이도 실행 가능 — 패킷 구조를 시각적으로 확인합니다.
 */

const { BridgeClone, TCNET, buildOptInPacket, buildStatusPacket, buildTimePacket } = require('./bridge-clone');

// 캡처에서 추출한 실제 Bridge 패킷 (hex)
const CAPTURED = {
  optIn:  '7bff030554434e0242524944474532396a020700a7fc0100010084fe7e02000050494f4e45455220444a20434f52500050524f444a4c494e4b2042524944474501014300',
  time:   '7bff030554434efe425249444745323962020700826d0b001b000000130900000d4800001b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010100000000000706030600000000011e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
};

function hexDiff(label, generated, captured) {
  const genHex = generated.toString('hex');
  const capHex = captured;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`크기: 생성=${generated.length}B, 캡처=${capHex.length/2}B`);
  
  let matches = 0;
  let diffs = [];
  const len = Math.min(genHex.length, capHex.length) / 2;
  
  for (let i = 0; i < len; i++) {
    const genByte = genHex.substring(i*2, i*2+2);
    const capByte = capHex.substring(i*2, i*2+2);
    if (genByte === capByte) {
      matches++;
    } else {
      diffs.push({ offset: i, gen: genByte, cap: capByte });
    }
  }
  
  const pct = ((matches / len) * 100).toFixed(1);
  console.log(`일치율: ${matches}/${len} (${pct}%)`);
  
  if (diffs.length > 0) {
    console.log(`\n차이점 (${diffs.length}개):`);
    diffs.forEach(d => {
      const fieldName = getFieldName(label, d.offset);
      const note = isExpectedDiff(label, d.offset) ? ' (예상된 차이)' : '';
      console.log(`  offset ${d.offset.toString().padStart(3)}: 생성=0x${d.gen} 캡처=0x${d.cap}  ${fieldName}${note}`);
    });
  }
  
  // Hex 비교 시각화
  console.log(`\n바이트 비교 (16B/줄):`);
  for (let row = 0; row < len; row += 16) {
    let genLine = '';
    let capLine = '';
    let markLine = '';
    
    for (let i = row; i < Math.min(row + 16, len); i++) {
      const g = genHex.substring(i*2, i*2+2);
      const c = capHex.substring(i*2, i*2+2);
      genLine += g + ' ';
      capLine += c + ' ';
      markLine += (g === c ? '.. ' : '^^ ');
    }
    
    if (markLine.includes('^^')) {
      console.log(`  ${row.toString().padStart(3)} 생성: ${genLine.trim()}`);
      console.log(`      캡처: ${capLine.trim()}`);
      console.log(`      차이: ${markLine.trim()}`);
    }
  }
}

function getFieldName(label, offset) {
  // 공통 헤더 필드
  if (offset < 2) return '[NodeID]';
  if (offset < 4) return '[Version]';
  if (offset < 7) return '[Magic TCN]';
  if (offset === 7) return '[MsgType]';
  if (offset < 16) return '[NodeName]';
  if (offset === 16) return '[Sequence]';
  if (offset === 17) return '[NodeType]';
  if (offset < 20) return '[NodeOptions]';
  if (offset < 24) return '[Timestamp]';
  
  if (label.includes('OptIn')) {
    if (offset < 26) return '[NodeCount]';
    if (offset < 28) return '[ListenerPort]';
    if (offset < 30) return '[Uptime]';
  }
  
  if (label.includes('Time')) {
    if (offset < 28) return '[Layer1.TotalLen]';
    if (offset < 32) return '[Layer1.TrackId]';
    if (offset < 36) return '[Layer1.Timecode]';
    if (offset === 90) return '[PlayState]';
    if (offset === 98) return '[BeatPhase]';
  }
  
  return '';
}

function isExpectedDiff(label, offset) {
  // Sequence, Timestamp는 항상 다름
  if (offset === 16) return true;  // Sequence
  if (offset >= 20 && offset < 24) return true;  // Timestamp
  
  if (label.includes('OptIn')) {
    if (offset >= 28 && offset < 30) return true;  // Uptime
    if (offset >= 24 && offset < 26) return true;  // 가변
  }
  
  if (label.includes('Time')) {
    if (offset >= 32 && offset < 36) return true;  // Timecode (재생 위치)
    if (offset === 90) return true;  // PlayState
    if (offset === 98) return true;  // BeatPhase
  }
  
  return false;
}

// ============================================================
// 실행
// ============================================================

const header = {
  sequence: 0x62,  // 캡처와 동일한 시퀀스로 테스트
  build(msgType) {
    const buf = Buffer.alloc(24);
    Buffer.from([0x7B, 0xFF]).copy(buf, 0);
    Buffer.from([0x03, 0x05]).copy(buf, 2);
    Buffer.from('TCN').copy(buf, 4);
    buf[7] = msgType;
    buf.write('BRIDGE29', 8, 8, 'ascii');
    buf[16] = this.sequence;
    buf[17] = 0x02;
    Buffer.from([0x07, 0x00]).copy(buf, 18);
    buf.writeUInt32LE(0x0B6D82, 20);  // 캡처와 동일 타임스탬프
    return buf;
  }
};

console.log('DJ Link Bridge Clone — 패킷 검증');
console.log('캡처한 실제 Bridge 패킷과 우리가 생성한 패킷을 비교합니다.\n');

// 1. Time 패킷 비교
const timePkt = buildTimePacket(header, [{
  totalLength: 0x1B,
  trackId: 0x0913,
  timecodeMs: 0x480D,  // 캡처된 값
  state: 1,
  beatPhase: 3,
}]);
hexDiff('Time 패킷 (0xFE) — 재생 중', timePkt, CAPTURED.time);

// 2. OptIn 패킷 비교
header.sequence = 0x6a;
const origBuild = header.build;
header.build = function(msgType) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x7B, 0xFF]).copy(buf, 0);
  Buffer.from([0x03, 0x05]).copy(buf, 2);
  Buffer.from('TCN').copy(buf, 4);
  buf[7] = msgType;
  buf.write('BRIDGE29', 8, 8, 'ascii');
  buf[16] = 0x6a;
  buf[17] = 0x02;
  Buffer.from([0x07, 0x00]).copy(buf, 18);
  buf.writeUInt32LE(0x0001FCA7, 20);
  return buf;
};

const optinPkt = buildOptInPacket(header, 0xFE84, 638, 1);
hexDiff('OptIn 패킷 (0x02)', optinPkt, CAPTURED.optIn);

console.log('\n\n=== 결론 ===');
console.log('예상된 차이(Sequence, Timestamp, Timecode 등)를 제외하고');
console.log('구조적 일치율을 확인하세요. 90% 이상이면 프로토타입으로 진행 가능!');
