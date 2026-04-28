'use strict';
// Prevent EPIPE crashes when stdout pipe is broken
process.stdout?.on('error',()=>{});
process.stderr?.on('error',()=>{});
const{app,BrowserWindow,ipcMain,protocol,net,Menu}=require('electron');
// Windows/Linux 상단 기본 메뉴 (File / View / Window) 제거 — 커스텀 UI 만 사용.
// macOS 는 시스템 메뉴 규약상 유지.
if(process.platform!=='darwin') try{ Menu.setApplicationMenu(null); }catch(_){}

// Single instance lock — prevent duplicate app windows
const gotLock=app.requestSingleInstanceLock();
if(!gotLock){console.log('[APP] another instance running — quitting');app.quit();process.exit(0);}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
const path=require('path'),os=require('os'),fs=require('fs'),crypto=require('crypto');
const{spawn}=require('child_process');
const dgram=require('dgram');
const{BridgeCore,getAllInterfaces,interfaceSignature}=require('./bridge-core');
const licenseService=require('./license-service');

// ═══ FFmpeg multi-channel audio decode ═══════════════════════════════
// FFmpeg + temp 파일 + audio decode IPC → main/audio-decode.js (Phase 3.6)
const audioDecode=require('./main/audio-decode');
const _tempFiles=audioDecode.tempFiles;
app.on('before-quit',()=>audioDecode.cleanupTempFiles());

// bridge-audio:// — serves decoded temp WAV files with range request support
// Registered before app ready via protocol.registerSchemesAsPrivileged
protocol.registerSchemesAsPrivileged([
  {scheme:'bridge-audio',privileges:{standard:true,secure:true,supportFetchAPI:true,bypassCSP:true,stream:true}},
]);

function _registerBridgeAudioProtocol(){
  protocol.handle('bridge-audio',(req)=>{
    const fp=decodeURIComponent(new URL(req.url).pathname);
    // Security: only serve registered temp files
    if(!_tempFiles.has(fp)){return new Response('Forbidden',{status:403});}
    try{
      const stat=fs.statSync(fp);const total=stat.size;
      const rangeHdr=req.headers.get('range');
      if(rangeHdr){
        const[s,e]=rangeHdr.replace('bytes=','').split('-');
        const start=parseInt(s)||0;const end=e?parseInt(e):total-1;
        const length=end-start+1;
        const stream=fs.createReadStream(fp,{start,end});
        return new Response(stream,{status:206,headers:{
          'Content-Range':`bytes ${start}-${end}/${total}`,
          'Accept-Ranges':'bytes','Content-Length':String(length),'Content-Type':'audio/wav',
        }});
      }
      return new Response(fs.createReadStream(fp),{headers:{
        'Accept-Ranges':'bytes','Content-Length':String(total),'Content-Type':'audio/wav',
      }});
    }catch(e){return new Response('Not found',{status:404});}
  });
}

// ═══ Art-Net 4 Engine (Bridge 자체 구현) ═══════════════════════════════
// 설계 특징:
//  • 2ms setInterval + hrtime 누적기 → setTimeout 지터 제거, 드리프트 0
//  • 프레임 인코더 자동증분 + seek diff>1 감지 → 역주행 티어링 방지
//  • forceResync() — CUE/핫큐/트랙전환 즉시 반영 (1-frame 지연 제로)
//  • OpTimeCode 19B + OpDmx 512ch(시퀀스 1-255) 단일 엔진 통합
//  • 인터페이스별 bind + SO_BROADCAST + Pause/Resume/에러카운터
//  • ArtPollReply 자동응답 (grandMA / Resolume / QLC+ 자동 탐지)
//  • Unicast 모드(특정 노드 IP 직접 송신) + DMX 주기 설정 + ArtSync(0x5200)
//  • IPC 핸들러 분리 → 메인 ↔ 렌더러 동기화 오버헤드 최소
class ArtnetEngine{
  constructor(){
    this._sock=null;this._pollSock=null;
    this._bindIp='0.0.0.0';this._destIp='255.255.255.255';this._destPort=6454;
    this._unicast=false;this._unicastIp='';
    this._pollReply=true;this._sync=false;
    this._timer=null;this._running=false;this._paused=false;
    this._fps=25;this._fpsType=1;
    this._target={hh:0,mm:0,ss:0,ff:0};
    this._enc={hh:0,mm:0,ss:0,ff:0};
    this._seeded=false;this._lastHR=0;this._errors=0;
    this._dmxBuf=null;this._dmxUniverse=0;this._dmxSeq=0;this._dmxLastHR=0;this._dmxIntervalMs=25; // 40Hz
    this._nodeShortName='BRIDGE+';
    this._nodeLongName='Pro DJ Link Bridge Plus - Art-Net 4';
  }
  _now(){const[s,n]=process.hrtime();return s*1000+n/1e6;}
  _destFor(){ return this._unicast && this._unicastIp ? this._unicastIp : this._destIp; }
  getStatus(){return{running:this._running,paused:this._paused,bindIp:this._bindIp,destIp:this._destFor(),port:this._destPort,fps:this._fps,errors:this._errors,unicast:this._unicast,sync:this._sync,pollReply:this._pollReply,dmxHz:Math.round(1000/this._dmxIntervalMs)};}
  isRunning(){return this._running;}
  setFps(fpsStr){
    const m={'24':[24,0],'25':[25,1],'29.97':[30,2],'30':[30,3]};
    const[n,t]=m[String(fpsStr)]||m['25'];
    this._fps=n;this._fpsType=t;
  }
  setTimecode(hh,mm,ss,ff){this._target={hh:hh&0xFF,mm:mm&0xFF,ss:ss&0xFF,ff:ff&0xFF};}
  setPaused(p){
    const was=this._paused;this._paused=!!p;
    if(was&&!this._paused){this._seeded=false;this._lastHR=this._now();}
  }
  setDmx(arr,universe){
    if(!arr||!arr.length){this._dmxBuf=null;return;}
    this._dmxBuf=Buffer.from(arr);
    this._dmxUniverse=(universe|0)&0x7FFF;
  }
  clearDmx(){this._dmxBuf=null;}
  setDmxHz(hz){
    const v=Math.max(10,Math.min(50,parseInt(hz)||40));
    this._dmxIntervalMs=Math.round(1000/v);
  }
  setUnicast(enabled,ip){
    this._unicast=!!enabled;
    this._unicastIp=(ip||'').trim();
  }
  setPollReply(enabled){ this._pollReply=!!enabled; }
  setSync(enabled){ this._sync=!!enabled; }
  forceResync(){
    if(!this._running||this._paused||!this._sock)return;
    this._seeded=false;
    this._sendTc();
    this._lastHR=this._now();
  }
  start({bindIp,destIp,destPort,unicast,unicastIp,pollReply,sync,dmxHz}={}){
    return new Promise((resolve)=>{
      this.stop();
      this._bindIp=bindIp||'0.0.0.0';
      this._destIp=destIp||'255.255.255.255';
      this._destPort=(destPort|0)||6454;
      this._unicast=!!unicast;this._unicastIp=(unicastIp||'').trim();
      this._pollReply=pollReply!==false;
      this._sync=!!sync;
      if(dmxHz) this.setDmxHz(dmxHz);
      const sock=dgram.createSocket({type:'udp4',reuseAddr:true});
      sock.on('error',e=>{this._errors++;console.warn('[ART] sock err',e.message);});
      const bindAddr=(this._bindIp&&this._bindIp!=='0.0.0.0'&&this._bindIp!=='auto')?this._bindIp:undefined;
      try{
        sock.bind(0,bindAddr,()=>{
          try{sock.setBroadcast(true);}catch(_){}
          this._sock=sock;this._running=true;this._paused=false;
          this._seeded=false;this._errors=0;
          this._lastHR=this._now();this._dmxLastHR=0;
          this._timer=setInterval(()=>this._tick(),2);
          this._startPollListener();
          console.log('[ART] started',this._bindIp,'->',this._destFor()+':'+this._destPort,
                      this._unicast?'(unicast)':'(broadcast)',
                      this._pollReply?'ArtPoll✓':'ArtPoll✗',
                      this._sync?'ArtSync✓':'');
          resolve({ok:true});
        });
      }catch(e){console.warn('[ART] bind error',e.message);resolve({ok:false,err:e.message});}
    });
  }
  stop(){
    this._running=false;this._paused=false;
    if(this._timer){clearInterval(this._timer);this._timer=null;}
    if(this._sock){try{this._sock.close();}catch(_){}this._sock=null;}
    if(this._pollSock){try{this._pollSock.close();}catch(_){}this._pollSock=null;}
  }
  _tick(){
    if(!this._running||!this._sock)return;
    const now=this._now();
    if(!this._paused){
      const iv=1000/this._fps;
      let sent=0;
      while((now-this._lastHR)>=iv&&sent<2){
        this._sendTc();
        this._lastHR+=iv;
        sent++;
      }
      if((now-this._lastHR)>100)this._lastHR=now;
    }
    if(this._dmxBuf&&(now-this._dmxLastHR)>=this._dmxIntervalMs){
      this._sendDmx();
      if(this._sync) this._sendSync();
      this._dmxLastHR=now;
    }
  }
  _incFrame(tc){
    let{hh,mm,ss,ff}=tc;ff++;
    const max=Math.round(this._fps);
    if(ff>=max){ff=0;ss++;}
    if(ss>=60){ss=0;mm++;}
    if(mm>=60){mm=0;hh++;}
    if(hh>=24){hh=0;}
    return{hh,mm,ss,ff};
  }
  _toTotal(tc,max){return tc.hh*3600*max+tc.mm*60*max+tc.ss*max+tc.ff;}
  _sendTc(){
    const fps=this._fps,max=Math.round(fps);let tc;
    const pending=this._target;
    if(!this._seeded){tc={...pending};this._seeded=true;}
    else{
      tc=this._incFrame(this._enc);
      const day=24*3600*max;
      let raw=this._toTotal(pending,max)-this._toTotal(tc,max);
      let diff=((raw%day)+day)%day;
      if(diff>day/2)diff=day-diff;
      if(diff>1)tc={...pending};
    }
    this._enc=tc;
    if(tc.hh>23||tc.mm>59||tc.ss>59||tc.ff>=max)return;
    const pkt=Buffer.alloc(19);
    pkt.write('Art-Net\0',0,'ascii');
    pkt.writeUInt16LE(0x9700,8);
    pkt.writeUInt8(0,10);pkt.writeUInt8(0x0E,11);
    pkt.writeUInt8(0,12);pkt.writeUInt8(0,13);
    pkt.writeUInt8(tc.ff,14);pkt.writeUInt8(tc.ss,15);
    pkt.writeUInt8(tc.mm,16);pkt.writeUInt8(tc.hh,17);
    pkt.writeUInt8(this._fpsType&0x03,18);
    try{this._sock.send(pkt,0,19,this._destPort,this._destFor());}
    catch(e){this._errors++;}
  }
  _sendDmx(){
    let n=this._dmxBuf.length;
    if(n<2)n=2;if(n>512)n=512;if(n%2)n++;
    const pkt=Buffer.alloc(18+n);
    pkt.write('Art-Net\0',0,'ascii');
    pkt.writeUInt16LE(0x5000,8);
    pkt.writeUInt8(0,10);pkt.writeUInt8(0x0E,11);
    this._dmxSeq=(this._dmxSeq%255)+1;
    pkt.writeUInt8(this._dmxSeq,12);
    pkt.writeUInt8(0,13);
    pkt.writeUInt8(this._dmxUniverse&0xFF,14);
    pkt.writeUInt8((this._dmxUniverse>>8)&0x7F,15);
    pkt.writeUInt8((n>>8)&0xFF,16);
    pkt.writeUInt8(n&0xFF,17);
    this._dmxBuf.copy(pkt,18,0,Math.min(this._dmxBuf.length,n));
    try{this._sock.send(pkt,0,pkt.length,this._destPort,this._destFor());}
    catch(e){this._errors++;}
  }
  // ArtSync (0x5200, 14B) — 프레임 그룹 송신 후 일괄 래치. Resolume/grandMA 지원.
  _sendSync(){
    const pkt=Buffer.alloc(14);
    pkt.write('Art-Net\0',0,'ascii');
    pkt.writeUInt16LE(0x5200,8);
    pkt.writeUInt8(0,10);pkt.writeUInt8(0x0E,11);
    pkt.writeUInt8(0,12);pkt.writeUInt8(0,13);
    const dst = this._unicast && this._unicastIp ? this._unicastIp : '255.255.255.255';
    try{this._sock.send(pkt,0,pkt.length,this._destPort,dst);}catch(e){this._errors++;}
  }
  // 239-byte ArtPollReply (0x2100) — ArtPoll 수신 시 자동 응답.
  _sendPollReply(remoteIp){
    if(!this._sock) return;
    const pkt=Buffer.alloc(239);
    pkt.write('Art-Net\0',0,'ascii');
    pkt.writeUInt16LE(0x2100,8);
    // IP (4B LE-style: Art-Net 필드는 실제 IP octet 순서 — 다수 구현이 network order 로 씀)
    const ip=this._bindIp==='0.0.0.0' ? (getLocalIp()||'0.0.0.0') : this._bindIp;
    const oct=ip.split('.').map(x=>parseInt(x)||0);
    pkt[10]=oct[0];pkt[11]=oct[1];pkt[12]=oct[2];pkt[13]=oct[3];
    pkt.writeUInt16LE(this._destPort,14);  // Port
    pkt.writeUInt16BE(0x0001,16);           // VersInfo
    pkt.writeUInt8(0,18);pkt.writeUInt8(0,19); // NetSwitch/SubSwitch
    pkt.writeUInt16BE(0xFFFF,20);           // OEM
    pkt[22]=0;                              // UBEA
    pkt[23]=0xE0;                           // Status1: indicator on, port-addr programmable
    pkt.writeUInt16LE(0x1212,24);           // ESTA manufacturer code (개발자 코드)
    pkt.write(this._nodeShortName.padEnd(17,'\0'),26,17,'ascii');
    pkt.write(this._nodeLongName.padEnd(63,'\0'),44,63,'ascii');
    pkt.write('#0001 [0000] BRIDGE+ online',108,64,'ascii');
    pkt[173]=0;pkt[174]=1;                  // NumPorts (1)
    pkt[175]=0x45;                          // PortType 0: DMX out + Art-Net
    pkt[178]=0x02;                          // GoodInput: data received
    pkt[182]=0x80;                          // GoodOutputA: data being transmitted
    pkt[186]=this._dmxUniverse&0x0F;        // SwOut 0
    pkt[190]=0;                             // SwVideo
    pkt[191]=0;                             // SwMacro
    pkt[192]=0;                             // SwRemote
    pkt[196]=0;                             // Style: Node
    // MAC (6B 0x00) — 필요시 getAllInterfaces 로 실 주소 주입 가능
    pkt[201]=0;
    pkt[212]=0x01;                          // Status2: supports 15-bit addressing + DHCP capable
    try{
      const dst = remoteIp || '255.255.255.255';
      this._sock.send(pkt,0,pkt.length,this._destPort,dst);
    }catch(e){this._errors++;}
  }
  // ArtPoll 수신 대기 — 기본 포트 6454 (메인 sock 과 공유 불가하므로 별도 소켓)
  _startPollListener(){
    if(!this._pollReply) return;
    try{
      const s=dgram.createSocket({type:'udp4',reuseAddr:true});
      s.on('error',()=>{});
      s.on('message',(msg,rinfo)=>{
        if(msg.length<14) return;
        if(msg.toString('ascii',0,8)!=='Art-Net\0') return;
        const op=msg.readUInt16LE(8);
        if(op===0x2000){ // ArtPoll
          this._sendPollReply(rinfo.address);
        }
      });
      const bindAddr=(this._bindIp&&this._bindIp!=='0.0.0.0'&&this._bindIp!=='auto')?this._bindIp:undefined;
      s.bind(6454,bindAddr,()=>{
        try{s.setBroadcast(true);}catch(_){}
        this._pollSock=s;
        // 시작 시 자발 공지 한 번 → 컨트롤러가 즉시 인식
        setTimeout(()=>this._sendPollReply(null),200);
      });
    }catch(_){}
  }
}
// 자체 bind IP 추출 — ArtPollReply 응답 시 우리 IP 를 정확히 기재하기 위해.
function getLocalIp(){
  try{
    const os=require('os');
    const ifs=os.networkInterfaces();
    for(const name of Object.keys(ifs)){
      for(const x of (ifs[name]||[])){
        if(x.family==='IPv4' && !x.internal) return x.address;
      }
    }
  }catch(_){}
  return null;
}
const artnet=new ArtnetEngine();

// ═══ Ableton Link Bridge (BPM-only, one-way propagation) ══════════════
// 설계 원칙 (브리지 전용 튜닝):
//  • 브리지는 마스터 BPM "공급자" 역할만 수행 — phase/quantum 기여 없음
//  • 소스 선택(cfg.linkSource): 'mixer' | 'deck' | 'master' 를 렌더러가 결정
//  • 0.02 BPM 히스테리시스 + 250ms 레이트리밋 → 네트워크 플러딩 방지
//  • abletonlink 네이티브 모듈이 설치된 경우 실제 Link 송신, 미설치 시 stub
//     설치법: `npm i abletonlink && npx electron-rebuild`
class LinkBridge{
  constructor(){
    this._link=null;this._enabled=false;this._peers=0;
    this._currentBpm=0;this._lastSentBpm=0;this._lastSentAt=0;
    this._available=false;
    try{
      const AL=require('abletonlink');
      this._LinkCtor=AL.default||AL;
      this._available=true;
      console.log('[LINK] abletonlink native module loaded');
    }catch(e){
      console.log('[LINK] abletonlink not installed (stub mode). '
                + 'Install: npm i abletonlink && npx electron-rebuild');
    }
  }
  isAvailable(){ return this._available; }
  // Link 세션의 전역 beat 클럭과 quantum 내 phase 를 읽어 UI에 공급.
  // API 변형 흡수: link.beat/phase(getter) · link.getBeat()/getPhase() · beat+quantum 기반 계산.
  _readBeat(){
    const L=this._link;if(!L)return 0;
    try{
      if(typeof L.getBeat==='function') return L.getBeat();
      if('beat' in L) return typeof L.beat==='function'?L.beat():L.beat;
    }catch(_){}
    return 0;
  }
  _readPhase(quantum){
    const L=this._link;if(!L)return 0;
    try{
      if(typeof L.getPhase==='function') return L.getPhase();
      if('phase' in L) return typeof L.phase==='function'?L.phase():L.phase;
    }catch(_){}
    // fallback: beat mod quantum
    const b=this._readBeat();const q=quantum||4;
    return ((b%q)+q)%q;
  }
  // peers 폴링 — setNumPeersCallback (ThreadSafeFunction) 경로를 회피.
  // Link 내부 쓰레드에서 JS 콜백을 호출하다가 abort() 크래시가 발생해
  // 콜백 등록을 제거하고 getStatus 폴링 시점에 동기 조회한다.
  _readPeers(){
    const L=this._link;if(!L)return 0;
    try{
      if(typeof L.getNumPeers==='function') return L.getNumPeers()|0;
      if(typeof L.numPeers==='function') return L.numPeers()|0;
      if('numPeers' in L) return (L.numPeers|0);
    }catch(_){}
    return 0;
  }
  getStatus(){
    const quantum=4;
    const beat=this._enabled?this._readBeat():0;
    const phase=this._enabled?this._readPhase(quantum):0;
    const peers=this._enabled?this._readPeers():0;
    this._peers=peers;
    return {available:this._available,enabled:this._enabled,peers,bpm:this._currentBpm,lastSent:this._lastSentBpm,beat,phase,quantum};
  }
  setEnabled(on){
    this._enabled=!!on;
    if(this._enabled){
      if(this._available && !this._link){
        try{
          this._link=new this._LinkCtor(120.0);
          this._link.enable(true);
          // 피어 수는 getStatus 폴링에서 동기 조회 (ThreadSafeFunction 콜백 abort 회피)
          console.log('[LINK] session started (BPM-only mode)');
        }catch(e){
          console.warn('[LINK] start error:',e.message);
          this._link=null;
        }
      }
    } else {
      if(this._link){
        try{this._link.enable(false);}catch(_){}
        try{this._link.destroy?.();}catch(_){}
        this._link=null;this._peers=0;this._lastSentBpm=0;
      }
    }
  }
  // 세션 beat 를 강제 정렬 (탭 다운비트 / 마스터 덱 정렬용)
  // beat: 0=다운비트, 1=2번째 비트 … quantum-1=마지막 비트
  // API 변형 흡수: setBeat / forceBeat / forceBeatAtTime / beat= 속성
  alignBeat(beat){
    if(!this._enabled||!this._link)return false;
    const b=Number.isFinite(+beat)?(+beat):0;
    try{
      const L=this._link;
      if(typeof L.setBeat==='function'){ L.setBeat(b); return true; }
      if(typeof L.forceBeat==='function'){ L.forceBeat(b); return true; }
      if(typeof L.forceBeatAtTime==='function'){ L.forceBeatAtTime(b,0,4); return true; }
      if('beat' in L){ L.beat=b; return true; }
    }catch(e){ console.warn('[LINK] alignBeat err:',e.message); }
    return false;
  }
  setTempo(bpm){
    const v=parseFloat(bpm);
    if(!Number.isFinite(v)||v<20||v>999)return;
    this._currentBpm=v;
    if(!this._enabled||!this._link)return;
    // 히스테리시스 0.02 + 레이트리밋 250ms
    const now=Date.now();
    if(Math.abs(v-this._lastSentBpm)<0.02 && (now-this._lastSentAt)<250) return;
    try{
      if(typeof this._link.setBpm==='function') this._link.setBpm(v);
      else if(typeof this._link.bpm==='function') this._link.bpm(v);
      else if('bpm' in this._link) this._link.bpm=v;
      this._lastSentBpm=v;this._lastSentAt=now;
    }catch(e){ console.warn('[LINK] setBpm err:',e.message); }
  }
}
const link=new LinkBridge();

// Legacy one-shot Art-Net ArtTimeCode (used by direct IPC call or fallback)
const _artSocket=dgram.createSocket('udp4');
_artSocket.bind(0,()=>{try{_artSocket.setBroadcast(true);}catch(_){}});
function sendArtTimeCode(ip,port,hh,mm,ss,ff,type){
  if(artnet.isRunning()){artnet.setTimecode(hh,mm,ss,ff);return;}
  const pkt=Buffer.alloc(19);
  pkt.write('Art-Net\0',0,'ascii');
  pkt.writeUInt16LE(0x9700,8);
  pkt.writeUInt8(0x00,10);pkt.writeUInt8(0x0E,11);
  pkt.writeUInt8(0,12);pkt.writeUInt8(0,13);
  pkt.writeUInt8(ff&0xFF,14);pkt.writeUInt8(ss&0xFF,15);
  pkt.writeUInt8(mm&0xFF,16);pkt.writeUInt8(hh&0xFF,17);
  pkt.writeUInt8(type&0x03,18);
  try{_artSocket.send(pkt,0,pkt.length,port||6454,ip||'255.255.255.255');}catch(e){console.warn('[ART]',e.message);}
}
let win,bridge,iv,_ifaceWatcher=null,_ifaceSig='';

// Window bounds persistence
const cfgPath=path.join(app.getPath('userData'),'window-state.json');
function loadBounds(){try{return JSON.parse(fs.readFileSync(cfgPath,'utf8'));}catch(_){return null;}}
function saveBounds(){
  try{
    if(!win||win.isDestroyed()) return;
    const b=win.getBounds();
    fs.writeFileSync(cfgPath,JSON.stringify(b));
    console.log('[WIN] saved bounds:',JSON.stringify(b));
  }catch(e){console.warn('[WIN] saveBounds error:',e.message);}
}

let splash=null;
function showSplash(msg,sub){
  if(splash&&!splash.isDestroyed()){try{splash.destroy();}catch(_){}}
  const W=460, H=260;
  splash=new BrowserWindow({
    width:W,height:H,frame:false,transparent:true,alwaysOnTop:true,
    resizable:false,skipTaskbar:true,
    webPreferences:{contextIsolation:true,nodeIntegration:false},
  });
  const html=`<!DOCTYPE html><html><head><style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;height:100%;overflow:hidden;-webkit-user-select:none;user-select:none}
    body{background:linear-gradient(180deg,rgba(22,24,30,.97),rgba(14,16,20,.97));border-radius:14px;border:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:'Plus Jakarta Sans',-apple-system,sans-serif;-webkit-app-region:drag}
    .brand{display:flex;align-items:center;gap:10px;margin-bottom:2px}
    .logo{width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,#8787ff,#ff6b2c);display:flex;align-items:center;justify-content:center;font:800 18px 'Plus Jakarta Sans',sans-serif;color:#0f1116;letter-spacing:-.02em}
    .wm{font:800 22px 'Plus Jakarta Sans',sans-serif;color:#e6e8ee;letter-spacing:.02em}
    .wm small{font:500 11px 'DM Mono',monospace;color:#8a94a3;letter-spacing:.14em;margin-left:8px}
    .msg{font:600 15px 'Plus Jakarta Sans',sans-serif;color:#e2e2e8}
    .sub{font:500 11px 'DM Mono',monospace;color:#7e8796;letter-spacing:.05em}
    .bar{margin-top:6px;width:70%;height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}
    .bar::after{content:'';position:absolute;top:0;bottom:0;width:30%;background:linear-gradient(90deg,#8787ff,#ff6b2c);border-radius:2px;animation:sld 1.4s ease-in-out infinite}
    @keyframes sld{0%{left:-30%}100%{left:100%}}
  </style></head><body>
    <div class="brand"><div class="logo">B+</div><div class="wm">BRIDGE+<small>DJ NETWORK BRIDGE</small></div></div>
    <div class="msg">${msg}</div>
    <div class="sub">${sub}</div>
    <div class="bar"></div>
  </body></html>`;
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  if(win&&!win.isDestroyed()){
    const wb=win.getBounds();
    splash.setPosition(Math.round(wb.x+wb.width/2-W/2),Math.round(wb.y+wb.height/2-H/2));
  }
}
function createWindow(){
  const saved=loadBounds();
  win=new BrowserWindow({
    x:saved?.x, y:saved?.y,
    width:saved?.width||1040, height:saved?.height||840,
    minWidth:900,minHeight:680,show:false,
    backgroundColor:'#111318',titleBarStyle:'hiddenInset',
    autoHideMenuBar:true, menuBarVisible:false,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,webSecurity:true},
  });
  try{ win.setMenuBarVisibility(false); }catch(_){}
  // Show splash while loading
  showSplash('BRIDGE+ 시작 중...','네트워크 초기화');
  win.once('ready-to-show',()=>{
    win.show();
    setTimeout(()=>{if(splash&&!splash.isDestroyed())splash.destroy();splash=null;},1500);
  });
  // Save bounds on move/resize (debounced) and on close
  let _saveTmr;
  const debounceSave=()=>{clearTimeout(_saveTmr);_saveTmr=setTimeout(saveBounds,500);};
  win.on('move',debounceSave);
  win.on('resize',debounceSave);
  win.on('close',()=>saveBounds());
  const p=path.join(__dirname,'renderer','index.html');
  win.loadFile(fs.existsSync(p)?p:path.join(__dirname,'index.html'));
  win.webContents.once('did-finish-load',()=>sendInterfaces('startup'));
  startInterfaceWatcher();
}

function sendInterfaces(reason='manual'){
  const ifaces=getAllInterfaces();
  _ifaceSig=interfaceSignature(ifaces);
  try{if(win&&!win.isDestroyed())win.webContents.send('net:interfaces',{interfaces:ifaces,reason,signature:_ifaceSig});}catch(_){}
  return ifaces;
}

function startInterfaceWatcher(){
  if(_ifaceWatcher)return;
  _ifaceSig=interfaceSignature(getAllInterfaces());
  _ifaceWatcher=setInterval(async()=>{
    let ifaces,sig;
    try{ifaces=getAllInterfaces();sig=interfaceSignature(ifaces);}catch(_){return;}
    if(sig===_ifaceSig)return;
    _ifaceSig=sig;
    console.log(`[NET] interface list changed (${ifaces.length})`);
    try{if(win&&!win.isDestroyed())win.webContents.send('net:interfaces',{interfaces:ifaces,reason:'hotplug',signature:sig});}catch(_){}
    try{await bridge?.handleInterfacesChanged(ifaces);}catch(e){console.warn('[NET] bridge interface refresh failed:',e.message);}
  },2000);
}

function push(){
  clearInterval(iv);
  iv=setInterval(()=>{
    if(!bridge?.running){clearInterval(iv);return;}
    win?.webContents.send('bridge:status',{
      running:bridge.running,layers:bridge.layers,
      uptime:Math.floor((Date.now()-bridge.startTime)/1000),
      pkts:bridge.packetCount,
      nodes:bridge.getActiveNodes(),devices:bridge.getActiveDevices(),
      faders:bridge.faders,onAir:bridge.onAir,hwMode:bridge.hwMode,pdjlPort:bridge.getPDJLPort(),
      broadcastAddr:bridge.broadcastAddr,listenerPort:bridge.listenerPort,
    });
  },100);
}

// Bridge start/stop IPC → main/ipc-bridge-start.js (Phase 3.12)
require('./main/ipc-bridge-start').registerBridgeStartIpc(ipcMain, {
  setBridge: (b) => { bridge = b; },
  getBridge: () => bridge,
  setIfaceSig: (s) => { _ifaceSig = s; },
  getIv: () => iv,
  clearIv: () => clearInterval(iv),
  getWin: () => win,
  BridgeCore,
  getAllInterfaces,
  interfaceSignature,
  push,
});
// Bridge simple IPC → main/ipc-bridge-simple.js (Phase 3.10)
require('./main/ipc-bridge-simple').registerBridgeSimpleIpc(ipcMain, ()=>bridge);
// Interface / artTimeCode IPC → main/ipc-bridge-iface.js (Phase 3.11)
require('./main/ipc-bridge-iface').registerBridgeIfaceIpc(ipcMain, {
  getBridge: () => bridge,
  sendInterfaces,
  sendArtTimeCode,
});
// Art-Net IPC → main/ipc-artnet.js (Phase 3.7)
require('./main/ipc-artnet').registerArtnetIpc(ipcMain, artnet);
// Ableton Link IPC → main/ipc-link.js (Phase 3.8)
require('./main/ipc-link').registerLinkIpc(ipcMain, link);
// License IPC — main/ipc-license.js 모듈로 위임
require('./main/ipc-license').registerLicenseIpc(ipcMain, licenseService);


// Audio decode IPC → main/audio-decode.js (Phase 3.6)
audioDecode.registerAudioDecodeIpc(ipcMain, { getWin: ()=>win });

// App-level / cleanup IPC → main/ipc-app.js (Phase 3.9)
const _cleanupSvc = require('./main/cleanup');
require('./main/ipc-app').registerAppIpc(ipcMain, { app, appRoot: __dirname, cleanupSvc: _cleanupSvc });

// SECURITY: web-contents-created 중앙 가드 — 모든 webContents 에 deny-by-default 정책.
// renderer 가 compromise 되거나 향후 개발 시 의도치 않은 외부 navigation/popup 차단.
app.on('web-contents-created', (_e, contents) => {
  // 새 창 / window.open / target=_blank 모두 거부.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // file:// 외부 네비게이션 거부 (앱 내부 file:// 만 허용).
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  // <webview> 태그가 우연히 추가돼도 nodeIntegration / preload 비활성화.
  contents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.preload = undefined;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
});

app.whenReady().then(()=>{_registerBridgeAudioProtocol();createWindow();});
let _cleaned=false,_quitting=false;
function doQuit(){
  if(_quitting)return;_quitting=true;
  console.log('[APP] doQuit — starting shutdown sequence');
  // 1. Save window bounds while window is still valid
  saveBounds();
  clearInterval(iv);
  clearInterval(_ifaceWatcher);_ifaceWatcher=null;
  // 2. Signal renderer to clean up WebGL contexts (prevents V8 BackingStore crash)
  try{if(win&&!win.isDestroyed())win.webContents.send('app:quitting');}catch(_){}
  // 3. Show shutdown splash BEFORE hiding main window (so position is correct)
  showSplash('종료 중...','TCNet · ProDJ Link 연결 해제');
  // 4. Hide main window after splash is positioned
  try{if(win&&!win.isDestroyed()){win.hide();}}catch(_){}
  // 4. Stop bridge after small delay (let splash render first)
  setTimeout(()=>{
    try{bridge?.stop();}catch(e){console.warn('[APP] bridge.stop error:',e.message);}
    bridge=null;
    try{artnet.stop();}catch(_){}
    try{link.setEnabled(false);}catch(_){}
    try{_artSocket.close();}catch(_){}
    _cleaned=true;
    // 5. Wait 500ms for OptOut UDP (5×broadcast + per-iface + per-node) to flush + 250ms socket close
    setTimeout(()=>{
      console.log('[APP] cleanup done — force exiting via SIGKILL');
      try{if(splash&&!splash.isDestroyed())splash.destroy();}catch(_){}
      try{if(win&&!win.isDestroyed())win.destroy();}catch(_){}
      // abletonlink native callback_handler thread (sleep_for 루프) 이 프로세스
      // 종료 시점에도 살아있어 app.exit()/process.exit() 의 libc atexit/C++ dtor
      // 경로에서 스레드 소유권 경합 → std::terminate → abort.
      // SIGKILL 은 커널 레벨 즉시 회수 → dtor 경로 완전 우회 (cleanup 은 이미 완료).
      try{process.kill(process.pid,'SIGKILL');}catch(_){app.exit(0);}
    },500);
  },100);
  // Safety net: SIGKILL after 2s no matter what
  setTimeout(()=>{try{process.kill(process.pid,'SIGKILL');}catch(_){app.exit(0);}},2000).unref();
}
app.on('window-all-closed',(e)=>{
  // Prevent default quit — we handle it in doQuit
  if(!_quitting) doQuit();
});
app.on('before-quit',(e)=>{if(!_quitting){e.preventDefault();doQuit();}});
app.on('will-quit',()=>{
  if(!_cleaned){
    saveBounds();clearInterval(iv);
    try{bridge?.stop();}catch(_){}bridge=null;
    try{artnet.stop();}catch(_){}
    try{link.setEnabled(false);}catch(_){}
    try{_artSocket.close();}catch(_){}
    _cleaned=true;
  }
  // abletonlink v0.2.0 NAPI 바인딩에 스레드 종료 API가 없어 native callback
  // thread (sleep_for 루프) 가 프로세스 종료 시점에도 살아있다.
  // app.exit()/process.exit() 도 내부적으로 libc exit → atexit → C++ static dtor
  // → abletonlink 스레드 소유권 경합 → abort 발생.
  // SIGKILL 은 커널이 즉시 프로세스 회수 → dtor 경로 건너뛰기 (cleanup 이미 끝).
  setTimeout(()=>{try{process.kill(process.pid,'SIGKILL');}catch(_){app.exit(0);}},300).unref();
});
app.on('activate',()=>{if(!_quitting&&BrowserWindow.getAllWindows().length===0)createWindow();});
