// dbserver TCP session pool — bridge-core.js 에서 추출 (Phase 5.3b).
// 한 ip|spoofPlayer 당 single TCP socket 을 재사용 — mutex serialize, 30s idle TTL.
// 동작 보존: 입력 → 출력 동일, acquire/release/invalidate triplet 짝 유지.
//
// 외부 dep 은 명시적으로 주입 (require 가 아닌 constructor) — 테스트 격리 + 순환 의존 방지.
//   DB:   pdjl/dbserver.js  (dbNum4, dbBuildMsg, dbArg4 — handshake 메시지 빌드)
//   DBIO: pdjl/dbserver-io.js  (dbReadResponse — SETUP_REQ 응답 대기)
'use strict';

const DB_SESSION_IDLE_MS = 30000;

class DbServerPool {
  constructor(deps){
    if(!deps || !deps.DB || !deps.DBIO) throw new Error('DbServerPool requires { DB, DBIO } deps');
    this._DB = deps.DB;
    this._DBIO = deps.DBIO;
    // `${ip}|${spoofPlayer}` → { sock, mutex, idleTimer, invalidated, connectPromise, onDead }
    this._sessions = new Map();
  }

  // ── TCP connection + handshake (port discovery → connect → greeting → SETUP_REQ) ────
  async _connect(ip, spoofPlayer){
    const net2 = require('net');
    // Step 1: discover actual dbserver port via 12523 RemoteDBServer probe
    const realPort = await new Promise((res,rej)=>{
      const s = new net2.Socket();
      s.setTimeout(3000);
      s.on('error', rej);
      s.on('timeout', ()=>{s.destroy();rej(new Error('port discovery timeout'));});
      s.connect(12523, ip, ()=>{
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

    // Step 2: connect to actual port + greeting
    const sock = new net2.Socket();
    // setKeepAlive(true, 5000) — TCP keepalive 5s 후 → idle 끊김 빠른 감지.
    // setNoDelay(true) — Nagle 비활성, dbserver greeting/SETUP_REQ 작은 패킷 즉시 전송.
    // setTimeout 5000ms — CDJ 부팅 직후 / 네트워크 jitter 시 false timeout 방지.
    sock.setKeepAlive(true, 5000);
    sock.setNoDelay(true);
    sock.setTimeout(5000);
    await new Promise((res,rej)=>{
      sock.on('error', rej);
      sock.on('timeout', ()=>{sock.destroy();rej(new Error('connect timeout'));});
      sock.connect(realPort, ip, ()=>{
        sock.write(this._DB.dbNum4(1));  // greeting NumberField(4-byte) = 1
        res();
      });
    });
    // Wait for greeting echo
    await new Promise((res,rej)=>{
      sock.once('data', d=>{
        if(d.length>=5 && d[0]===0x11) res();
        else rej(new Error(`bad greeting: ${d.toString('hex')}`));
      });
      sock.once('error', rej);
    });

    // Step 3: SETUP_REQ (type 0x0000, txId 0xfffffffe)
    const setupMsg = this._DB.dbBuildMsg(0xfffffffe, 0x0000, [this._DB.dbArg4(spoofPlayer)]);
    sock.write(setupMsg);
    await this._DBIO.dbReadResponse(sock);

    return sock;
  }

  // 모든 세션 강제 종료 — bridge stop / TCNet rebind 시 호출.
  cleanup(){
    for(const entry of this._sessions.values()){
      entry.invalidated = true;
      if(entry.idleTimer){ clearTimeout(entry.idleTimer); entry.idleTimer = null; }
      try{ entry.sock?.destroy(); }catch(_){}
    }
    this._sessions.clear();
  }

  // 세션 획득 — 호출자 must release() 또는 invalidate() 호출.
  // mutex 로 인해 동시에 한 호출자만 socket 사용 (read interleaving 방지).
  async acquire(ip, spoofPlayer){
    const key = `${ip}|${spoofPlayer}`;
    let entry = this._sessions.get(key);
    if(!entry || entry.invalidated){
      entry = { sock:null, mutex:Promise.resolve(), idleTimer:null, invalidated:false, connectPromise:null };
      this._sessions.set(key, entry);
      entry.connectPromise = this._connect(ip, spoofPlayer).then(sock=>{
        if(entry.invalidated){
          try{sock.destroy();}catch(_){}
          throw new Error('dbserver session invalidated');
        }
        entry.sock = sock;
        const onDead = () => {
          if(entry.invalidated) return;
          entry.invalidated = true;
          if(entry.idleTimer){ clearTimeout(entry.idleTimer); entry.idleTimer = null; }
          if(this._sessions.get(key) === entry) this._sessions.delete(key);
          try{entry.sock?.destroy();}catch(_){}
        };
        entry.onDead = onDead;
        sock.once('error', onDead);
        sock.once('close', onDead);
        return sock;
      }).catch(err=>{
        if(this._sessions.get(key) === entry) this._sessions.delete(key);
        entry.invalidated = true;
        throw err;
      });
    }
    if(!entry.sock) await entry.connectPromise;

    const previous = entry.mutex.catch(()=>{});
    let unlock = null;
    entry.mutex = previous.then(()=>new Promise(resolve=>{ unlock = resolve; }));
    await previous;

    if(entry.invalidated || !entry.sock){
      if(unlock) unlock();
      return this.acquire(ip, spoofPlayer);
    }
    if(entry.idleTimer){ clearTimeout(entry.idleTimer); entry.idleTimer = null; }

    let released = false;
    const invalidate = () => {
      if(entry.invalidated) return;
      entry.invalidated = true;
      if(entry.idleTimer){ clearTimeout(entry.idleTimer); entry.idleTimer = null; }
      if(this._sessions.get(key) === entry) this._sessions.delete(key);
      if(entry.onDead){
        try{entry.sock?.removeListener('error', entry.onDead);}catch(_){}
        try{entry.sock?.removeListener('close', entry.onDead);}catch(_){}
      }
      try{entry.sock?.destroy();}catch(_){}
    };
    const release = () => {
      if(released) return;
      released = true;
      if(!entry.invalidated && this._sessions.get(key) === entry){
        if(entry.idleTimer) clearTimeout(entry.idleTimer);
        entry.idleTimer = setTimeout(()=>invalidate(), DB_SESSION_IDLE_MS);
        try{entry.idleTimer.unref?.();}catch(_){}
      }
      if(unlock) unlock();
    };
    return { sock:entry.sock, release, invalidate };
  }

  // 디버그/테스트 — 활성 세션 수
  size(){ return this._sessions.size; }
}

module.exports = { DbServerPool, DB_SESSION_IDLE_MS };
