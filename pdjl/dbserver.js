// dbserver protocol pure helpers — bridge-core.js 에서 추출 (Phase 4.11 modularization).
// 메시지 빌더/파서. 소켓/캐시/state 처리는 BridgeCore 클래스 메서드에 유지.

const DB_MAGIC = 0x872349ae;

// Field tag wrappers (TLV)
function dbNum1(v){ return Buffer.from([0x0f, v & 0xFF]); }
function dbNum2(v){ const b = Buffer.alloc(3); b[0] = 0x10; b.writeUInt16BE(v & 0xFFFF, 1); return b; }
function dbNum4(v){ const b = Buffer.alloc(5); b[0] = 0x11; b.writeUInt32BE(v >>> 0, 1); return b; }
function dbBinary(buf){
  const hdr = Buffer.alloc(5);
  hdr[0] = 0x14;
  hdr.writeUInt32BE(buf.length, 1);
  return Buffer.concat([hdr, buf]);
}
// UTF-16BE string field (tag 0x26): 4-byte char count (incl. null) + UTF-16BE chars
function dbStr(str){
  const cs = (str || '').split('').map(c => c.charCodeAt(0));
  cs.push(0);
  const d = Buffer.alloc(cs.length * 2);
  cs.forEach((c, i) => d.writeUInt16BE(c & 0xFFFF, i * 2));
  const h = Buffer.alloc(5);
  h[0] = 0x26;
  h.writeUInt32BE(cs.length, 1);
  return Buffer.concat([h, d]);
}

// Argument constructors — { tag, data } pairs used by dbBuildMsg
function dbArg4(v){ return { tag: 0x06, data: dbNum4(v) }; }
function dbRMST(reqPlayer, menu, slot, trackType){
  const v = ((reqPlayer & 0xFF) << 24) | ((menu & 0xFF) << 16) | ((slot & 0xFF) << 8) | (trackType & 0xFF);
  return dbArg4(v);
}

function dbBuildMsg(txId, type, args){
  // 12 type-tag slots. UInt32=0x06, UInt16=0x05, UInt8=0x04, Binary=0x03, String=0x26
  const argList = Buffer.alloc(12);
  for (let i = 0; i < args.length && i < 12; i++) argList[i] = args[i].tag;
  const parts = [
    dbNum4(DB_MAGIC),
    dbNum4(txId),
    dbNum2(type),
    dbNum1(args.length),
    dbBinary(argList),
  ];
  for (const a of args) parts.push(a.data);
  return Buffer.concat(parts);
}

// Build a 0x4101 MenuItem message — used to tell Arena about artworkId.
//   args[3]=label1(str), args[4]=label2(str), args[6]=itemType, args[8]=artworkId
function dbBuildMenuItem(txId, label1, label2, artworkId){
  const TYPE_CODES = [0x06, 0x06, 0x06, 0x26, 0x26, 0x06, 0x06, 0x06, 0x06, 0x06, 0x26, 0x06];
  const argList = Buffer.from(TYPE_CODES);
  const args = [
    dbArg4(1),
    dbArg4(0),
    dbArg4(0),
    { tag: 0x26, data: dbStr(label1) },
    { tag: 0x26, data: dbStr(label2 || '') },
    dbArg4(artworkId ? 1 : 0),
    dbArg4(0x0004),
    dbArg4(0),
    dbArg4(artworkId),
    dbArg4(0),
    { tag: 0x26, data: dbStr('') },
    dbArg4(0),
  ];
  const parts = [
    dbNum4(DB_MAGIC),
    dbNum4(txId),
    dbNum2(0x4101),
    dbNum1(args.length),
    dbBinary(argList),
  ];
  for (const a of args) parts.push(a.data);
  return Buffer.concat(parts);
}

function dbBuildArtResponse(txId, jpegBuf){
  // args[0]=size(UInt32), args[1]=binary JPEG
  const sizeArg = dbArg4(jpegBuf.length);
  const artArg = { tag: 0x03, data: dbBinary(jpegBuf) };
  return dbBuildMsg(txId, 0x4003, [sizeArg, artArg]);
}

// Parse a dbserver message to extract txId, type, and UInt32 args.
// Format: magic(5) + txId(5) + type(3) + argc(2) + argTags(5+argc) + args...
function parseDbRequest(buf){
  if (buf.length < 15) return null;
  const txId = buf.readUInt32BE(6);   // [5]=0x11, [6-9]=value
  const type = buf.readUInt16BE(11);  // [10]=0x10, [11-12]=value
  const argc = buf[14];               // [13]=0x0F, [14]=value
  if (buf.length < 20) return { txId, type, argc, args: [] };
  const tagListLen = buf.readUInt32BE(16);
  const argsStart = 20 + tagListLen;
  const args = [];
  let pos = argsStart;
  for (let i = 0; i < argc && pos < buf.length; i++){
    const tag = buf[pos];
    if (tag === 0x11 && pos + 5 <= buf.length){       // UInt32
      args.push(buf.readUInt32BE(pos + 1)); pos += 5;
    } else if (tag === 0x10 && pos + 3 <= buf.length){ // UInt16
      args.push(buf.readUInt16BE(pos + 1)); pos += 3;
    } else if (tag === 0x0F && pos + 2 <= buf.length){ // UInt8
      args.push(buf[pos + 1]); pos += 2;
    } else if (tag === 0x14 && pos + 5 <= buf.length){ // Binary — skip
      const blen = buf.readUInt32BE(pos + 1); pos += 5 + blen;
      args.push(0);
    } else if (tag === 0x26 && pos + 5 <= buf.length){ // String — skip
      const slen = buf.readUInt32BE(pos + 1); pos += 5 + slen * 2;
      args.push(0);
    } else { break; }
  }
  return { txId, type, argc, args };
}

module.exports = {
  DB_MAGIC,
  dbNum1, dbNum2, dbNum4, dbBinary, dbStr,
  dbArg4, dbRMST,
  dbBuildMsg, dbBuildMenuItem, dbBuildArtResponse,
  parseDbRequest,
};
