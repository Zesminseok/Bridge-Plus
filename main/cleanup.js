// 좀비 BRIDGE+ / TCNet / PDJL 프로세스 + 포트 점유 정리.
// 자기 자신 PID 와 부모 PID 는 절대 죽이지 않는다 (현재 실행 중인 인스턴스 보호).

const {execFile} = require('child_process');
const {promisify} = require('util');
const pExec = promisify(execFile);

const PORTS_TCNET = [60000, 60001, 60002];
const PORTS_PDJL  = [50000, 50001, 50002, 50003, 50004, 50005, 50006, 50007];
const PORTS_DBSRV = [12523, 12524];
const ALL_PORTS = [...PORTS_TCNET, ...PORTS_PDJL, ...PORTS_DBSRV];

// 정확한 시퀀스 매칭 — generic "Bridge" 단어는 macOS 시스템 프로세스
// (XProtectBridgeService, ViewBridgeAuxiliary 등) 와 겹치므로 회피.
const PROC_PATTERNS = [
  /BRIDGE\+/i,
  /Pro ?DJ ?Link ?Bridge/i,
  /ProDJLinkBridge/i,
  /PDJLBridge/i,
  /Pioneer Pro DJ Link/i,
];

// 절대 죽이면 안 되는 프로세스 — TCNet 클라이언트/타깃 앱.
// 이들도 60000~60002 포트를 바인딩하므로 포트 기반 kill 시 잘못 죽일 수 있음.
const SAFE_PATTERNS = [
  /Arena/i,
  /Resolume/i,
  /Avenue/i,
  /Wirecast/i,
  /VDMX/i,
  /Madmapper/i,
  /TouchDesigner/i,
  /Notch/i,
  /Smode/i,
  /Disguise/i,
  /Hippotizer/i,
  /Watchout/i,
  /MA[\s-]?Lighting/i,
  /grandMA/i,
  /Avolites/i,
  /Obsidian/i,
];

const SELF_PID = process.pid;
const PARENT_PID = process.ppid;

function isProtected(pid){
  const n = Number(pid);
  if(!n || n <= 0) return true;
  return n === SELF_PID || n === PARENT_PID || n === 1;
}

async function _safe(fn){ try{ return await fn(); }catch(e){ return {err:e.message}; } }

// ─────────────────────────────────────────────
// macOS / Linux
// ─────────────────────────────────────────────
async function _findByNameUnix(){
  const found = [];
  // ps -ax -o pid,comm,args
  const {stdout} = await pExec('ps', ['-ax','-o','pid=,comm=,args=']);
  for(const line of stdout.split('\n')){
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if(!m) continue;
    const pid = Number(m[1]);
    const cmd = m[2];
    const args = m[3];
    if(isProtected(pid)) continue;
    const text = `${cmd} ${args}`;
    if(PROC_PATTERNS.some(re=>re.test(text))){
      found.push({pid, name: cmd.split('/').pop(), cmd: text.slice(0,100)});
    }
  }
  return found;
}

async function _pidNameUnix(pid){
  const r = await _safe(()=>pExec('ps', ['-p', String(pid), '-o', 'comm=,args=']));
  if(r.err) return '';
  return String(r.stdout||'').trim();
}

async function _findByPortUnix(port){
  const found = [];
  for(const proto of ['UDP','TCP']){
    const r = await _safe(()=>pExec('lsof', ['-nP','-i'+proto+':'+port,'-t']));
    if(r.err) continue;
    for(const pid of String(r.stdout||'').split('\n').map(s=>s.trim()).filter(Boolean)){
      if(isProtected(pid)) continue;
      const name = await _pidNameUnix(pid);
      if(SAFE_PATTERNS.some(re=>re.test(name))) continue; // Arena/Resolume 등 보호
      found.push({pid:Number(pid), port, proto, name: name.slice(0,80)});
    }
  }
  return found;
}

async function _killUnix(pid){
  await _safe(()=>pExec('kill', ['-9', String(pid)]));
}

// ─────────────────────────────────────────────
// Windows
// ─────────────────────────────────────────────
async function _findByNameWin(){
  const found = [];
  const {stdout} = await pExec('tasklist', ['/FO','CSV','/NH']);
  for(const line of stdout.split('\n')){
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if(!m) continue;
    const name = m[1];
    const pid = Number(m[2]);
    if(isProtected(pid)) continue;
    if(PROC_PATTERNS.some(re=>re.test(name))){
      found.push({pid, name, cmd:name});
    }
  }
  return found;
}

async function _pidNameWin(pid){
  const r = await _safe(()=>pExec('tasklist', ['/FI',`PID eq ${pid}`,'/FO','CSV','/NH']));
  if(r.err) return '';
  const m = String(r.stdout||'').match(/^"([^"]+)"/);
  return m ? m[1] : '';
}

async function _findByPortWin(port){
  const found = [];
  const r = await _safe(()=>pExec('netstat', ['-ano']));
  if(r.err) return found;
  const lines = String(r.stdout||'').split('\n');
  for(const line of lines){
    // Proto  Local Address          Foreign Address        State           PID
    const m = line.match(/^\s*(UDP|TCP)\s+\S+:(\d+)\s+\S+(?:\s+\S+)?\s+(\d+)\s*$/);
    if(!m) continue;
    if(Number(m[2]) !== port) continue;
    const pid = Number(m[3]);
    if(isProtected(pid)) continue;
    const name = await _pidNameWin(pid);
    if(SAFE_PATTERNS.some(re=>re.test(name))) continue; // Arena/Resolume 등 보호
    found.push({pid, port, proto:m[1], name});
  }
  return found;
}

async function _killWin(pid){
  await _safe(()=>pExec('taskkill', ['/F','/PID',String(pid),'/T']));
}

// ─────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────
async function runCleanup(){
  const isWin = process.platform === 'win32';
  const findByName = isWin ? _findByNameWin : _findByNameUnix;
  const findByPort = isWin ? _findByPortWin : _findByPortUnix;
  const kill       = isWin ? _killWin : _killUnix;

  const result = {
    selfPid: SELF_PID,
    killedProcs: [],     // [{pid,name,cmd}]
    killedPorts: [],     // [{pid,port,proto}]
    remaining:   [],     // [{port,proto,pid}]
    errors: [],
  };

  // 1) 이름으로 찾은 좀비
  let nameHits = [];
  try{ nameHits = await findByName(); }catch(e){ result.errors.push('name: '+e.message); }
  const killedSet = new Set();
  for(const p of nameHits){
    await kill(p.pid);
    killedSet.add(p.pid);
    result.killedProcs.push(p);
  }

  // 2) 포트로 찾은 좀비 (이름 매칭 안된 케이스 보완)
  for(const port of ALL_PORTS){
    let hits = [];
    try{ hits = await findByPort(port); }catch(e){ result.errors.push(`port ${port}: ${e.message}`); continue; }
    for(const h of hits){
      if(killedSet.has(h.pid)) continue;
      await kill(h.pid);
      killedSet.add(h.pid);
      result.killedPorts.push(h);
    }
  }

  // 3) 짧게 대기 후 잔여 점유 확인
  await new Promise(r=>setTimeout(r, 400));
  for(const port of ALL_PORTS){
    let hits = [];
    try{ hits = await findByPort(port); }catch(_){ continue; }
    for(const h of hits) result.remaining.push(h);
  }

  return result;
}

module.exports = { runCleanup };
