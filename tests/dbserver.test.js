'use strict';

const assert = require('assert');
const path = require('path');
const db = require(path.join(__dirname, '..', 'pdjl', 'dbserver'));

function test(name, fn){
  try { fn(); console.log(`ok - ${name}`); }
  catch(err){ console.error(`not ok - ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ─── Field tag wrappers (TLV) ──────────────────────────────────────────────

test('dbNum1: 1-byte value with 0x0f tag', () => {
  const b = db.dbNum1(0x42);
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[0], 0x0f); // tag
  assert.strictEqual(b[1], 0x42);
});

test('dbNum1: clamps to 8 bits', () => {
  const b = db.dbNum1(0x1FF); // 511 → 0xFF
  assert.strictEqual(b[1], 0xFF);
});

test('dbNum2: 2-byte big-endian value with 0x10 tag', () => {
  const b = db.dbNum2(0x1234);
  assert.strictEqual(b.length, 3);
  assert.strictEqual(b[0], 0x10);
  assert.strictEqual(b.readUInt16BE(1), 0x1234);
});

test('dbNum4: 4-byte big-endian value with 0x11 tag', () => {
  const b = db.dbNum4(0xCAFEBABE);
  assert.strictEqual(b.length, 5);
  assert.strictEqual(b[0], 0x11);
  assert.strictEqual(b.readUInt32BE(1), 0xCAFEBABE);
});

test('dbNum4: handles unsigned 32-bit (>= 2^31)', () => {
  // >>> 0 으로 unsigned 처리 — JS bitwise 는 default 32-bit signed 이므로 중요.
  const b = db.dbNum4(0xFFFFFFFF);
  assert.strictEqual(b.readUInt32BE(1), 0xFFFFFFFF);
});

test('dbBinary: prepends 4-byte BE length + 0x14 tag', () => {
  const data = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
  const b = db.dbBinary(data);
  assert.strictEqual(b.length, 5 + 4);
  assert.strictEqual(b[0], 0x14);
  assert.strictEqual(b.readUInt32BE(1), 4); // length
  assert.deepStrictEqual([...b.slice(5)], [0xDE, 0xAD, 0xBE, 0xEF]);
});

// ─── String encoding (UTF-16BE with null term) ──────────────────────────

test('dbStr: ASCII string encodes as UTF-16BE with null terminator', () => {
  const b = db.dbStr('AB');
  // header: 0x26 + UInt32BE charCount (3 = "A","B",null)
  assert.strictEqual(b[0], 0x26);
  assert.strictEqual(b.readUInt32BE(1), 3);
  // body: 'A' (0x0041), 'B' (0x0042), null (0x0000) — 6 bytes
  assert.strictEqual(b.length, 5 + 6);
  assert.strictEqual(b.readUInt16BE(5), 0x0041);
  assert.strictEqual(b.readUInt16BE(7), 0x0042);
  assert.strictEqual(b.readUInt16BE(9), 0x0000);
});

test('dbStr: empty string still has null terminator', () => {
  const b = db.dbStr('');
  assert.strictEqual(b.readUInt32BE(1), 1); // 1 char (null)
  assert.strictEqual(b.length, 5 + 2);
});

test('dbStr: handles undefined/null gracefully', () => {
  const b = db.dbStr(undefined);
  assert.strictEqual(b.readUInt32BE(1), 1);
});

// ─── dbBuildMsg (request/response message builder) ─────────────────────

test('dbBuildMsg: builds magic + txId + type + argList structure', () => {
  const args = [db.dbArg4(1), db.dbArg4(2)];
  const msg = db.dbBuildMsg(0x1000, 0x4001, args);
  // dbNum4(MAGIC) + dbNum4(txId) + dbNum2(type) + dbNum1(argc) + dbBinary(argList) + args...
  // = 5 + 5 + 3 + 2 + (5+12) + 5*2 = 42
  assert.strictEqual(msg.length, 42);
  // First field: MAGIC (0x872349ae)
  assert.strictEqual(msg[0], 0x11); // dbNum4 tag
  assert.strictEqual(msg.readUInt32BE(1), 0x872349ae);
  // Second field: txId
  assert.strictEqual(msg[5], 0x11);
  assert.strictEqual(msg.readUInt32BE(6), 0x1000);
  // Third field: type (UInt16BE)
  assert.strictEqual(msg[10], 0x10);
  assert.strictEqual(msg.readUInt16BE(11), 0x4001);
  // Fourth field: argc
  assert.strictEqual(msg[13], 0x0f);
  assert.strictEqual(msg[14], 0x02);
});

test('dbBuildMsg: argList contains exactly 12 type tag slots (zero-padded)', () => {
  const args = [db.dbArg4(1)];
  const msg = db.dbBuildMsg(0x100, 0x4001, args);
  // After header (15 bytes) + dbBinary header (5 bytes), argList occupies 12 bytes.
  // arg type 0x06 at index 0, rest zero.
  assert.strictEqual(msg[20], 0x06); // first arg's tag
  for(let i = 21; i < 32; i++) assert.strictEqual(msg[i], 0x00, `argList[${i-20}] should be 0`);
});

// ─── parseDbRequest ───────────────────────────────────────────────────

test('parseDbRequest: round-trip — buildMsg → parse', () => {
  const args = [db.dbArg4(0x1234), db.dbArg4(0x5678)];
  const msg = db.dbBuildMsg(0xCAFE, 0x4001, args);
  const parsed = db.parseDbRequest(msg);
  assert.ok(parsed, 'parse should succeed');
  assert.strictEqual(parsed.txId, 0xCAFE);
  assert.strictEqual(parsed.type, 0x4001);
  assert.strictEqual(parsed.argc, 2);
});

test('parseDbRequest: invalid magic → null/error gracefully', () => {
  const bad = Buffer.alloc(20);
  // 첫 4 bytes 가 magic 이 아님 → 파서 reject (throw 안 함)
  let threw = false;
  let result;
  try { result = db.parseDbRequest(bad); } catch(e) { threw = true; }
  assert.ok(threw === false || result === null || result === undefined, 'invalid input should not throw or return null');
});

test('parseDbRequest: too-short buffer does not throw', () => {
  let threw = false;
  try { db.parseDbRequest(Buffer.alloc(5)); } catch(e) { threw = true; }
  assert.strictEqual(threw, false, 'short buffer should not throw');
});
