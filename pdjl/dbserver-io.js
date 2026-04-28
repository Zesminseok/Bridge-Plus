// dbserver socket I/O helpers — bridge-core.js 에서 추출 (Phase 5.3a).
// 두 함수 모두 socket 만 받고 listener/timer 정리까지 책임지는 self-contained Promise wrapper.
// 동작 보존: 입력 → 출력 동일 (input/output contract preservation).
'use strict';

const _DB_RESP_MAX = 16 * 1024 * 1024; // 16MB cap (artwork JPEG < 5MB, metadata < 64KB → 충분)

// 첫 응답 헤더 (32B 이상) 도착 시점에 resolve.
// SECURITY: malicious/buggy CDJ 가 무한 응답으로 메모리 폭주시키지 못하게 16MB cap.
// 누수 방지: success/timeout/error 어느 경로든 listener 와 timer 모두 정리.
function dbReadResponse(sock){
  return new Promise((res,rej)=>{
    const chunks = [];
    let totalLen = 0;
    let timer = null;
    const cleanup = () => {
      if(timer){ clearTimeout(timer); timer = null; }
      sock.removeListener('data', onData);
      sock.removeListener('error', onError);
    };
    const onData = d => {
      chunks.push(d);
      totalLen += d.length;
      if(totalLen > _DB_RESP_MAX){ cleanup(); rej(new Error('dbserver response too large')); return; }
      const buf = Buffer.concat(chunks);
      // NumberField format: UInt32(magic)=5 + UInt32(txId)=5 + UInt16(type)=3 + UInt8(argc)=2 + Binary(tags)=17 = 32+ bytes
      if(buf.length >= 32){
        cleanup();
        res(buf);
      }
    };
    const onError = e => { cleanup(); rej(e); };
    sock.on('data', onData);
    sock.once('error', onError);
    timer = setTimeout(()=>{ cleanup(); rej(new Error('response timeout')); }, 5000);
  });
}

// idle (idleMs ms) 가 지나면 resolve — multi-chunk artwork/구조체 응답에서 사용.
// 절대 timeout 8s, 16MB cap. 동작 보존: idleMs 기본 300, 호출자가 override 가능.
function dbReadFullResponse(sock, idleMs=300){
  return new Promise((res,rej)=>{
    const chunks = [];
    let totalLen = 0;
    let timer = null;
    const onData = d => {
      chunks.push(d);
      totalLen += d.length;
      if(totalLen > _DB_RESP_MAX){
        if(timer) clearTimeout(timer);
        sock.removeListener('data', onData);
        rej(new Error('dbserver full response too large')); return;
      }
      if(timer) clearTimeout(timer);
      timer = setTimeout(()=>{
        sock.removeListener('data', onData);
        res(Buffer.concat(chunks));
      }, idleMs);
    };
    sock.on('data', onData);
    sock.once('error', e=>{if(timer)clearTimeout(timer);rej(e);});
    setTimeout(()=>{sock.removeListener('data',onData);if(timer)clearTimeout(timer);rej(new Error('full response timeout'));}, 8000);
  });
}

module.exports = { dbReadResponse, dbReadFullResponse };
