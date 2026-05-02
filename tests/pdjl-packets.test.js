'use strict';

const assert = require('assert');
const path = require('path');
const pkt = require(path.join(__dirname, '..', 'pdjl', 'packets'));

function test(name, fn){
  try { fn(); console.log(`ok - ${name}`); }
  catch(err){ console.error(`not ok - ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ─── PDJL constants ────────────────────────────────────────────────────────

test('PDJL: MAGIC is 10 bytes "Qspt1WmJOL"', () => {
  assert.strictEqual(pkt.PDJL.MAGIC.length, 10);
  assert.strictEqual(pkt.PDJL.MAGIC.toString('ascii'), 'Qspt1WmJOL');
});

test('PDJL: device type constants', () => {
  assert.strictEqual(pkt.PDJL.CDJ, 0x0A);
  assert.strictEqual(pkt.PDJL.DJM, 0x39);
  assert.strictEqual(pkt.PDJL.DJM2, 0x29);
  assert.strictEqual(pkt.PDJL.ANN, 0x06);
});

// ─── pdjlBridgeAnnounceId — Windows fullcap4 검증값으로 통일 (mac 도 동일) ──

test('pdjlBridgeAnnounceId: 모든 platform 0xBD 통일', () => {
  assert.strictEqual(pkt.pdjlBridgeAnnounceId('darwin'), 0xBD);
  assert.strictEqual(pkt.pdjlBridgeAnnounceId('win32'), 0xBD);
  assert.strictEqual(pkt.pdjlBridgeAnnounceId('linux'), 0xBD);
});

// ─── pdjlBridgeName ───────────────────────────────────────────────────

test('pdjlBridgeName: 항상 "TCS-SHOWKONTROL" (Pioneer pcap-verified)', () => {
  // 플랫폼 무관하게 동일 — Pioneer 의 dbserver 가 인식하는 이름.
  assert.strictEqual(pkt.pdjlBridgeName('darwin'), 'TCS-SHOWKONTROL');
  assert.strictEqual(pkt.pdjlBridgeName('win32'), 'TCS-SHOWKONTROL');
  assert.strictEqual(pkt.pdjlBridgeName(), 'TCS-SHOWKONTROL');
});

// ─── hasPDJLMagic ─────────────────────────────────────────────────────

test('hasPDJLMagic: 정상 PDJL 패킷 검증', () => {
  const buf = Buffer.alloc(50);
  pkt.PDJL.MAGIC.copy(buf, 0);
  assert.strictEqual(pkt.hasPDJLMagic(buf), true);
});

test('hasPDJLMagic: magic 없는 random 데이터 거부', () => {
  const buf = Buffer.alloc(50, 0xAA);
  assert.strictEqual(pkt.hasPDJLMagic(buf), false);
});

test('hasPDJLMagic: 너무 짧은 버퍼 거부', () => {
  assert.strictEqual(pkt.hasPDJLMagic(Buffer.alloc(5)), false);
  assert.strictEqual(pkt.hasPDJLMagic(Buffer.alloc(0)), false);
});

// ─── readPDJLNameField ─────────────────────────────────────────────────

test('readPDJLNameField: 정상 ASCII 이름 + null trim', () => {
  const buf = Buffer.alloc(40);
  Buffer.from('CDJ-3000', 'ascii').copy(buf, 0x0C);
  // null padded
  assert.strictEqual(pkt.readPDJLNameField(buf, 0x0C, 20), 'CDJ-3000');
});

test('readPDJLNameField: 빈 영역 → 빈 문자열', () => {
  const buf = Buffer.alloc(40);
  assert.strictEqual(pkt.readPDJLNameField(buf, 0x0C, 20), '');
});

// ─── buildPdjlBridgeHelloPacket — 정상 구조 ────────────────────────────

test('buildPdjlBridgeHelloPacket: 정상 길이 + magic + CDJ type byte', () => {
  const p = pkt.buildPdjlBridgeHelloPacket();
  assert.strictEqual(p.length, 37);
  assert.deepStrictEqual([...p.slice(0, 10)], [...pkt.PDJL.MAGIC]);
  assert.strictEqual(p[0x0A], 0x0A); // CDJ type
});

test('buildPdjlBridgeHelloPacket: deviceId 인자 위치', () => {
  // deviceId 가 어딘가에 들어감 (정확한 위치는 구현 dependent)
  const p1 = pkt.buildPdjlBridgeHelloPacket(5);
  const p2 = pkt.buildPdjlBridgeHelloPacket(7);
  // p1 과 p2 가 어딘가 다름 (deviceId 가 실제로 적용됨)
  assert.notDeepStrictEqual([...p1], [...p2]);
});

// ─── buildPdjlBridgeKeepalivePacket — 54B + 정확한 byte 위치 ──────────

test('buildPdjlBridgeKeepalivePacket: 54-byte 길이', () => {
  const p = pkt.buildPdjlBridgeKeepalivePacket('169.254.1.1', 'aa:bb:cc:dd:ee:ff', 5, 'darwin');
  assert.strictEqual(p.length, 54);
});

test('buildPdjlBridgeKeepalivePacket: keepalive type byte 0x06', () => {
  const p = pkt.buildPdjlBridgeKeepalivePacket('169.254.1.1', 'aa:bb:cc:dd:ee:ff', 5, 'darwin');
  assert.strictEqual(p[0x0A], 0x06);
});

test('buildPdjlBridgeKeepalivePacket: deviceId at 0x34', () => {
  const p = pkt.buildPdjlBridgeKeepalivePacket('169.254.1.1', 'aa:bb:cc:dd:ee:ff', 7, 'darwin');
  assert.strictEqual(p[0x34], 0x07);
});

test('buildPdjlBridgeKeepalivePacket: MAC 6 bytes encoded at 0x26', () => {
  const p = pkt.buildPdjlBridgeKeepalivePacket('169.254.1.1', 'aa:bb:cc:dd:ee:ff', 5, 'darwin');
  assert.strictEqual(p.slice(0x26, 0x2c).toString('hex'), 'aabbccddeeff');
});
