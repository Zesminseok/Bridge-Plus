// dbserver protocol pure helpers — bridge-core.js 에서 추출 (Phase 4.11 + 5.3a).
// 메시지 빌더/parser + 응답 TLV reader. 소켓 I/O 는 dbserver-io.js, 세션/캐시 state 는 BridgeCore.

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

// ── Read a single TLV field from response buffer at offset ────
// 동작 보존: bridge-core.js 의 _dbReadField 와 동일 contract (input/output 일치).
function dbReadField(buf, pos){
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

// ── Parse multi-message dbserver response (NumberField format) ────
// 응답에서 magic 0x872349ae 를 스캔해 알려진 msgType (0x4101/0x4000/0x4002/0x4702/0x4e02) 만 수집.
// dbReadField 를 내부 호출 — 두 함수는 짝으로 유지.
function dbParseItems(buf){
  const items = [];
  let pos = 0;
  while(pos < buf.length - 5){
    if(buf[pos]!==0x11||buf.readUInt32BE(pos+1)!==0x872349ae){pos++;continue;}
    pos+=5;
    const txF=dbReadField(buf,pos);if(!txF)break;pos+=txF.size;
    const typeF=dbReadField(buf,pos);if(!typeF)break;pos+=typeF.size;
    const msgType=typeF.val;
    const cntF=dbReadField(buf,pos);if(!cntF)break;pos+=cntF.size;
    const argc=cntF.val;
    const listF=dbReadField(buf,pos);if(!listF)break;pos+=listF.size;
    const args = [];
    for(let i=0;i<argc&&i<12;i++){
      const f=dbReadField(buf,pos);
      if(!f)break;
      args.push(f);
      pos+=f.size;
    }
    if(msgType===0x4101||msgType===0x4000||msgType===0x4002||msgType===0x4702||msgType===0x4e02){
      items.push({msgType,args});
    }
  }
  return items;
}

module.exports = {
  DB_MAGIC,
  dbNum1, dbNum2, dbNum4, dbBinary, dbStr,
  dbArg4, dbRMST,
  dbBuildMsg, dbBuildMenuItem, dbBuildArtResponse,
  parseDbRequest,
  dbReadField, dbParseItems,
};
