'use strict';

const assert = require('assert');
const path = require('path');
const { parsePDJL } = require(path.join(__dirname, '..', 'pdjl', 'parser'));

function test(name, fn){
  try { fn(); console.log(`ok - ${name}`); }
  catch(err){ console.error(`not ok - ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ─── Robustness — malformed / edge-case packets 에 대해 throw 없이 처리 ────────

test('parsePDJL: empty buffer returns null/undefined gracefully', () => {
  // 빈 버퍼는 magic 매칭 실패 → null/undefined.
  const r = parsePDJL(Buffer.alloc(0));
  assert.ok(r === null || r === undefined, 'empty buffer should return null/undefined');
});

test('parsePDJL: too-short buffer (< magic len) returns null', () => {
  // PDJL magic 은 10 bytes. 5 bytes 만 있으면 매칭 불가.
  const r = parsePDJL(Buffer.from([0x51, 0x53, 0x70, 0x74, 0x31]));
  assert.ok(r === null || r === undefined, 'too-short buffer should return null');
});

test('parsePDJL: random garbage (no PDJL magic) returns null', () => {
  // PDJL magic 없는 random 버퍼 → 파서가 reject.
  const r = parsePDJL(Buffer.alloc(100, 0xAA));
  assert.ok(r === null || r === undefined, 'non-PDJL buffer should return null');
});

test('parsePDJL: malformed PDJL (correct magic but truncated) does not throw', () => {
  // Magic 시작 + 짧은 데이터 → exception 없이 graceful fail.
  const buf = Buffer.alloc(15);
  Buffer.from('Qspt1WmJOL', 'ascii').copy(buf);
  // No throw expected
  let threw = false;
  try { parsePDJL(buf); } catch(e){ threw = true; }
  assert.strictEqual(threw, false, 'truncated PDJL should not throw');
});

test('parsePDJL: NXS2 backward beat anchor 검증', () => {
  // 0x29 NXS2 status — 정상 파싱 통과 시 beat 정보 보존.
  // 단순 packet length sanity check. (실제 0x29 packet 은 large struct 라 단순화.)
  // 우리는 throw 없이 처리되는지 확인.
  const buf = Buffer.alloc(0xff, 0);
  Buffer.from('Qspt1WmJOL', 'ascii').copy(buf, 0);
  buf[0x0a] = 0x29; // 메시지 타입
  buf[0x21] = 0x05; // player#
  let threw = false;
  try { parsePDJL(buf); } catch(e){ threw = true; }
  assert.strictEqual(threw, false, 'malformed 0x29 should not throw');
});

test('parsePDJL: 0x06 keepalive packet smoke test', () => {
  // 정상적인 keepalive 형태 (0x0A=0x06, 충분한 길이) → throw 없이 처리.
  const buf = Buffer.alloc(0x40, 0);
  Buffer.from('Qspt1WmJOL', 'ascii').copy(buf, 0);
  buf[0x0a] = 0x06;
  let threw = false;
  try { parsePDJL(buf); } catch(e){ threw = true; }
  assert.strictEqual(threw, false, 'keepalive packet should parse without throwing');
});

test('parsePDJL: handles boundary lengths without crashing', () => {
  // 다양한 길이 (10, 50, 100, 200, 500) 에서 throw 안 함.
  for(const len of [10, 50, 100, 200, 500, 1000]){
    const buf = Buffer.alloc(len, 0);
    Buffer.from('Qspt1WmJOL', 'ascii').copy(buf, 0);
    let threw = false;
    try { parsePDJL(buf); } catch(e){ threw = true; }
    assert.strictEqual(threw, false, `len=${len} should not throw`);
  }
});
