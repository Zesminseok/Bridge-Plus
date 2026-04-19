'use strict';
// Prevent EPIPE crashes when stdout pipe is broken
process.stdout?.on('error',()=>{});
process.stderr?.on('error',()=>{});
const{app,BrowserWindow,ipcMain,protocol,net}=require('electron');

// Single instance lock — prevent duplicate app windows
const gotLock=app.requestSingleInstanceLock();
if(!gotLock){console.log('[APP] another instance running — quitting');app.quit();process.exit(0);}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
const path=require('path'),os=require('os'),fs=require('fs'),crypto=require('crypto');
const{spawn}=require('child_process');
const dgram=require('dgram');
const{BridgeCore,getAllInterfaces}=require('./bridge-core');

// ═══ FFmpeg multi-channel audio decode ═══════════════════════════════
let _ffmpegPath=null;
function _findFFmpeg(){
  if(_ffmpegPath!==null)return _ffmpegPath;
  const candidates=[
    '/opt/homebrew/bin/ffmpeg',   // Apple Silicon Homebrew
    '/usr/local/bin/ffmpeg',      // Intel Homebrew
    '/usr/bin/ffmpeg',
    process.env.FFMPEG_PATH||'',
  ].filter(Boolean);
  for(const p of candidates){try{fs.accessSync(p,fs.constants.X_OK);_ffmpegPath=p;return p;}catch(_){}}
  try{const r=require('child_process').execSync('which ffmpeg 2>/dev/null',{encoding:'utf8',timeout:2000}).trim();if(r){_ffmpegPath=r;return r;}}catch(_){}
  _ffmpegPath='';return'';
}

// Temp file registry — cleaned up on quit
const _tempFiles=new Set();
app.on('before-quit',()=>{for(const f of _tempFiles){try{fs.unlinkSync(f);}catch(_){}}});

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
  getStatus(){
    const quantum=4;
    const beat=this._enabled?this._readBeat():0;
    const phase=this._enabled?this._readPhase(quantum):0;
    return {available:this._available,enabled:this._enabled,peers:this._peers,bpm:this._currentBpm,lastSent:this._lastSentBpm,beat,phase,quantum};
  }
  setEnabled(on){
    this._enabled=!!on;
    if(this._enabled){
      if(this._available && !this._link){
        try{
          this._link=new this._LinkCtor(120.0);
          this._link.enable(true);
          // 피어 수 콜백 (버전별 API 차이 흡수)
          if(typeof this._link.setNumPeersCallback==='function'){
            this._link.setNumPeersCallback(n=>{this._peers=n|0;});
          } else if(typeof this._link.on==='function'){
            this._link.on('numPeers',n=>{this._peers=n|0;});
          }
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
let win,bridge,iv;

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
  splash=new BrowserWindow({
    width:320,height:160,frame:false,transparent:true,alwaysOnTop:true,
    resizable:false,skipTaskbar:true,
    webPreferences:{contextIsolation:true,nodeIntegration:false},
  });
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:rgba(17,19,24,.95);border-radius:12px;border:1px solid rgba(60,74,66,.15);flex-direction:column;gap:8px;font-family:'Plus Jakarta Sans',-apple-system,sans-serif;-webkit-app-region:drag"><div style="font:700 15px 'Plus Jakarta Sans',-apple-system,sans-serif;color:#e2e2e8;letter-spacing:-.01em">${msg}</div><div style="font:500 11px 'DM Mono',monospace;color:#85948b">${sub}</div></body></html>`)}`);
  if(win&&!win.isDestroyed()){
    const wb=win.getBounds();
    splash.setPosition(Math.round(wb.x+wb.width/2-160),Math.round(wb.y+wb.height/2-80));
  }
}
function createWindow(){
  const saved=loadBounds();
  win=new BrowserWindow({
    x:saved?.x, y:saved?.y,
    width:saved?.width||1040, height:saved?.height||840,
    minWidth:900,minHeight:680,show:false,
    backgroundColor:'#111318',titleBarStyle:'hiddenInset',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false},
  });
  // Show splash while loading
  showSplash('BRIDGE+ 시작 중...','네트워크 초기화');
  win.once('ready-to-show',()=>{
    win.show();
    setTimeout(()=>{if(splash&&!splash.isDestroyed())splash.destroy();splash=null;},500);
  });
  // Save bounds on move/resize (debounced) and on close
  let _saveTmr;
  const debounceSave=()=>{clearTimeout(_saveTmr);_saveTmr=setTimeout(saveBounds,500);};
  win.on('move',debounceSave);
  win.on('resize',debounceSave);
  win.on('close',()=>saveBounds());
  const p=path.join(__dirname,'renderer','index.html');
  win.loadFile(fs.existsSync(p)?p:path.join(__dirname,'index.html'));
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

ipcMain.handle('bridge:start',async(_,opts)=>{
  try{
    if(bridge?.running){
      bridge.stop();
      // wait for socket release before rebinding (macOS port reuse)
      await new Promise(r=>setTimeout(r,300));
    }
    bridge=new BridgeCore(opts||{});
    const _send=(ch,d)=>{try{if(win&&!win.isDestroyed())win.webContents.send(ch,d);}catch(_){}};
    bridge.onNodeDiscovered=n=>_send('tcnet:node',n);
    bridge.onCDJStatus=(li,s)=>_send('bridge:cdj',{layerIndex:li,status:s});
    bridge.onDJMStatus=f=>_send('bridge:djm',{
      // core
      name:f.name, isV10:f.isV10, numCh:f.numCh,
      faders:f.channel||f, onAir:f.onAir, eq:f.eq, hasRealFaders:f.hasRealFaders,
      cueBtn:f.cueBtn, cueBtnB:f.cueBtnB, xfAssign:f.xfAssign, chExtra:f.chExtra,
      xfader:f.xfader, masterLvl:f.masterLvl, masterCue:f.masterCue, masterCueB:f.masterCueB,
      masterBalance:f.masterBalance, eqCurve:f.eqCurve, faderCurve:f.faderCurve, xfCurve:f.xfCurve,
      // Isolator (A9/V10)
      isolatorOn:f.isolatorOn, isolatorHi:f.isolatorHi, isolatorMid:f.isolatorMid, isolatorLo:f.isolatorLo,
      // Booth (+EQ A9/V10)
      boothLvl:f.boothLvl, boothEqHi:f.boothEqHi, boothEqLo:f.boothEqLo, boothEqBtn:f.boothEqBtn,
      // HP A/B
      hpCueCh:f.hpCueCh, hpCueLink:f.hpCueLink, hpCueLinkB:f.hpCueLinkB,
      hpMixing:f.hpMixing, hpMixingB:f.hpMixingB, hpLevel:f.hpLevel, hpLevelB:f.hpLevelB,
      // Beat FX
      fxFreqLo:f.fxFreqLo, fxFreqMid:f.fxFreqMid, fxFreqHi:f.fxFreqHi,
      beatFxSel:f.beatFxSel, beatFxAssign:f.beatFxAssign, beatFxLevel:f.beatFxLevel, beatFxOn:f.beatFxOn,
      multiIoSel:f.multiIoSel, sendReturn:f.sendReturn,
      // Mic
      micEqHi:f.micEqHi, micEqLo:f.micEqLo,
      // Filter (V10)
      filterLPF:f.filterLPF, filterHPF:f.filterHPF, filterReso:f.filterReso,
      // Color FX + Send Ext
      colorFxSel:f.colorFxSel, sendExt1:f.sendExt1, sendExt2:f.sendExt2, colorFxParam:f.colorFxParam,
      // Master Mix (V10)
      masterMixOn:f.masterMixOn, masterMixSize:f.masterMixSize,
      masterMixTime:f.masterMixTime, masterMixTone:f.masterMixTone, masterMixLevel:f.masterMixLevel,
      // diagnostics
      pktType:f.pktType, pktLen:f.pktLen, rawHex:f.rawHex
    });
    bridge.onDJMMeter=d=>_send('bridge:djmmeter',d);
    bridge.onTCMixerVU=d=>_send('bridge:tcmixervu',d);
    bridge.onDeviceList=devs=>{
      // stale(>10s) 기기 필터링 — UI에 유령 장치/쓰레기값 남지 않도록
      const now=Date.now();
      const active=Object.values(devs||{}).filter(d=>d&&(now-(d.lastSeen||0))<10000&&d.name!=='BRIDGE+'&&d.ip!=='127.0.0.1');
      _send('pdjl:devices',active);
    };
    bridge.onWaveformPreview=(pn,wf)=>_send('bridge:wfpreview',{playerNum:pn,...wf});
    bridge.onWaveformDetail=(pn,wf)=>_send('bridge:wfdetail',{playerNum:pn,...wf});
    bridge.onCuePoints=(pn,cues)=>_send('bridge:cuepoints',{playerNum:pn,cues});
    bridge.onBeatGrid=(pn,bg)=>_send('bridge:beatgrid',{playerNum:pn,...bg});
    bridge.onSongStructure=(pn,ss)=>_send('bridge:songstruct',{playerNum:pn,...ss});
    bridge.onAlbumArt=(pn,b64)=>_send('bridge:albumart',{playerNum:pn,art:b64});
    bridge.onTrackMetadata=(pn,meta)=>_send('bridge:trackmeta',{playerNum:pn,...meta});
    await bridge.start();push();
    // Re-request metadata for already-loaded tracks — retry at 3s, 8s, 20s
    setTimeout(()=>bridge?.refreshAllMetadata(), 3000);
    setTimeout(()=>bridge?.refreshAllMetadata(), 8000);
    setTimeout(()=>bridge?.refreshAllMetadata(), 20000);
    return{ok:true,pdjlPort:bridge.getPDJLPort(),broadcastAddr:bridge.broadcastAddr,nodeName:bridge.nodeName||'BRIDGE+'};
  }catch(e){return{ok:false,err:e.message};}
});
ipcMain.handle('bridge:stop',async()=>{bridge?.stop();clearInterval(iv);return{ok:true};});
ipcMain.handle('bridge:cpuUsage',()=>{
  const metrics=app.getAppMetrics();
  let cpu=0;
  metrics.forEach(m=>{cpu+=m.cpu.percentCPUUsage;});
  const mem=process.memoryUsage();
  return{cpu:Math.round(cpu*10)/10, memMB:Math.round(mem.rss/1048576)};
});
// Raw PDJL packet capture for protocol analysis (ALL sources, ALL types)
ipcMain.handle('bridge:djmCaptureStart',()=>{
  if(!bridge)return{ok:false,err:'bridge not running'};
  const path=require('path');
  const filePath=path.join(app.getPath('desktop'),`pdjl-raw-capture-${Date.now()}.txt`);
  bridge.startDJMCapture(filePath);
  return{ok:true,path:filePath};
});
ipcMain.handle('bridge:djmCaptureStop',()=>{
  bridge?.stopDJMCapture();
  return{ok:true};
});
ipcMain.handle('bridge:updateLayer',(_,{i,data})=>{bridge?.updateLayer(i,data);return{ok:true};});
ipcMain.on('bridge:setFader',(_,{i,val})=>{if(bridge&&bridge.faders)bridge.faders[i]=Math.max(0,Math.min(255,val));});
ipcMain.handle('bridge:removeLayer',(_,{i})=>{bridge?.removeLayer(i);return{ok:true};});
ipcMain.handle('bridge:registerVirtualDeck',(_,{slot,model})=>{bridge?.registerVirtualDeck(slot,model);return{ok:true};});
ipcMain.handle('bridge:unregisterVirtualDeck',(_,{slot})=>{bridge?.unregisterVirtualDeck(slot);return{ok:true};});
ipcMain.handle('bridge:setHWMode',(_,{i,en})=>{bridge?.setHWMode(i,en);return{ok:true};});
ipcMain.handle('bridge:refreshMeta',()=>{bridge?.refreshAllMetadata();return{ok:true};});
ipcMain.handle('bridge:getInterfaces',()=>getAllInterfaces());
ipcMain.handle('bridge:getDevices',()=>bridge?.getActiveDevices()||[]);
ipcMain.handle('bridge:artTimeCode',(_,{ip,port,hh,mm,ss,ff,type})=>{sendArtTimeCode(ip,port,hh,mm,ss,ff,type);return{ok:true};});
// ─── Art-Net Engine IPC ───────────────────────────────────────────
ipcMain.handle('artnet:start',async(_,opts={})=>{
  const{bindIp,destIp,destPort,fps,unicast,unicastIp,pollReply,sync,dmxHz}=opts;
  if(fps)artnet.setFps(fps);
  return await artnet.start({bindIp,destIp,destPort,unicast,unicastIp,pollReply,sync,dmxHz});
});
ipcMain.handle('artnet:setUnicast',(_,{enabled,ip})=>{artnet.setUnicast(enabled,ip);return{ok:true};});
ipcMain.handle('artnet:setPollReply',(_,{enabled})=>{artnet.setPollReply(enabled);return{ok:true};});
ipcMain.handle('artnet:setSync',(_,{enabled})=>{artnet.setSync(enabled);return{ok:true};});
ipcMain.handle('artnet:setDmxHz',(_,{hz})=>{artnet.setDmxHz(hz);return{ok:true};});
// ─── Ableton Link IPC ───────────────────────────────────────────
ipcMain.handle('link:setEnabled',(_,{enabled})=>{link.setEnabled(enabled);return link.getStatus();});
ipcMain.on('link:setTempo',(_,{bpm})=>{link.setTempo(bpm);});
ipcMain.handle('link:getStatus',()=>link.getStatus());
ipcMain.handle('artnet:stop',()=>{artnet.stop();return{ok:true};});
ipcMain.on('artnet:setTc',(_,{hh,mm,ss,ff})=>{artnet.setTimecode(hh,mm,ss,ff);});
ipcMain.handle('artnet:setFps',(_,{fps})=>{artnet.setFps(fps);return{ok:true};});
ipcMain.handle('artnet:setPaused',(_,{paused})=>{artnet.setPaused(paused);return{ok:true};});
ipcMain.handle('artnet:forceResync',()=>{artnet.forceResync();return{ok:true};});
ipcMain.on('artnet:setDmx',(_,{data,universe})=>{
  try{artnet.setDmx(data instanceof Uint8Array?data:Buffer.from(data||[]),universe||0);}catch(_){}
});
ipcMain.handle('artnet:clearDmx',()=>{artnet.clearDmx();return{ok:true};});
ipcMain.handle('artnet:getStatus',()=>artnet.getStatus());
ipcMain.handle('bridge:requestArtwork',(_,{ip,slot,artworkId,playerNum})=>{bridge?.requestArtwork(ip,slot,artworkId,playerNum);return{ok:true};});
ipcMain.handle('bridge:setVirtualArt',(_,{slot,jpegBase64})=>{
  if(bridge){bridge.setVirtualArt(slot,jpegBase64?Buffer.from(jpegBase64,'base64'):null);}
  return{ok:true};
});
// Live rebind — interface/mode changes without restart
ipcMain.handle('bridge:rebindTCNet',async(_,{addr})=>{
  try{await bridge?.rebindTCNet(addr);return{ok:true};}catch(e){return{ok:false,err:e.message};}
});
ipcMain.handle('bridge:rebindPDJL',async(_,{addr})=>{
  try{await bridge?.rebindPDJL(addr);return{ok:true};}catch(e){return{ok:false,err:e.message};}
});
ipcMain.handle('bridge:setTCNetMode',(_,{mode})=>{
  bridge?.setTCNetMode(mode);return{ok:true};
});
ipcMain.handle('bridge:setTCNetUnicast',(_,{unicast,allIfaces})=>{
  bridge?.setTCNetUnicast(unicast,allIfaces);return{ok:true};
});

// ═══ Multi-channel audio decode (FFmpeg) ═════════════════════════════
ipcMain.handle('bridge:checkFFmpeg',()=>{
  const p=_findFFmpeg();return{available:!!p,path:p};
});

ipcMain.handle('bridge:decodeAudio',async(_,{filePath,slot})=>{
  const ffmpeg=_findFFmpeg();
  if(!ffmpeg)return{ok:false,err:'FFmpeg를 찾을 수 없습니다.\nbrew install ffmpeg 로 설치하세요.'};
  const tmpOut=path.join(os.tmpdir(),`bridge_${crypto.randomBytes(6).toString('hex')}.wav`);
  _tempFiles.add(tmpOut);
  return new Promise(resolve=>{
    // Decode to 48kHz 24-bit PCM WAV, preserving all channels
    const args=['-i',filePath,'-vn','-acodec','pcm_s24le','-ar','48000','-y',tmpOut];
    const proc=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});
    let stderr='',durationSec=0;
    proc.stderr.on('data',chunk=>{
      const txt=chunk.toString();stderr+=txt;
      // Parse total duration once
      if(!durationSec){const m=stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        if(m)durationSec=parseInt(m[1])*3600+parseInt(m[2])*60+parseFloat(m[3]);}
      // Parse progress
      const pm=txt.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if(pm&&durationSec>0){
        const cur=parseInt(pm[1])*3600+parseInt(pm[2])*60+parseFloat(pm[3]);
        const pct=Math.min(99,Math.round(cur/durationSec*100));
        if(win&&!win.isDestroyed())win.webContents.send('bridge:audioProgress',{slot,pct});
      }
    });
    proc.on('error',e=>{_tempFiles.delete(tmpOut);try{fs.unlinkSync(tmpOut);}catch(_){}resolve({ok:false,err:e.message});});
    proc.on('close',code=>{
      if(code!==0){_tempFiles.delete(tmpOut);try{fs.unlinkSync(tmpOut);}catch(_){}resolve({ok:false,err:stderr.slice(-400)});return;}
      if(win&&!win.isDestroyed())win.webContents.send('bridge:audioProgress',{slot,pct:100});
      resolve({ok:true,tempPath:tmpOut});
    });
  });
});

ipcMain.handle('bridge:cleanupTemp',(_,{tempPath})=>{
  if(tempPath&&_tempFiles.has(tempPath)){try{fs.unlinkSync(tempPath);}catch(_){}finally{_tempFiles.delete(tempPath);}}
  return{ok:true};
});

// ═══ Rekordbox ANLZ PWV7 reader ═══
// Reads 3-band waveform data from .2EX files for pixel-perfect Rekordbox rendering
const _anlzDir=path.join(os.homedir(),'Library','Pioneer','rekordbox','share','PIONEER','USBANLZ');
let _anlzIndex=null; // {filename → anlzPath} cache

function _buildANLZIndex(){
  if(_anlzIndex)return _anlzIndex;
  _anlzIndex={};
  try{
    const walk=(dir)=>{
      for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
        if(ent.isDirectory()){walk(path.join(dir,ent.name));continue;}
        if(ent.name==='ANLZ0000.EXT'||ent.name==='ANLZ0000.2EX'){
          // Read PPTH tag to get original file path
          const fp=path.join(dir,ent.name);
          try{
            const buf=fs.readFileSync(fp);
            const hLen=buf.readUInt32BE(4);
            let pos=hLen;
            while(pos<buf.length-12){
              const tag=buf.toString('ascii',pos,pos+4);
              const tHL=buf.readUInt32BE(pos+4);
              const tTL=buf.readUInt32BE(pos+8);
              if(tag==='PPTH'){
                const pathLen=buf.readUInt16BE(pos+tHL-2);
                const trackPath=buf.toString('utf16be',pos+tHL,pos+tHL+pathLen).replace(/\0+$/,'');
                const baseName=path.basename(trackPath).toLowerCase();
                _anlzIndex[baseName]=dir;
                break;
              }
              pos+=tTL;if(tTL===0)break;
            }
          }catch(_){}
        }
      }
    };
    if(fs.existsSync(_anlzDir))walk(_anlzDir);
    console.log(`[ANLZ] indexed ${Object.keys(_anlzIndex).length} tracks`);
  }catch(e){console.warn('[ANLZ] index error:',e.message);}
  return _anlzIndex;
}

function _readPWV7(anlzDir){
  const fp=path.join(anlzDir,'ANLZ0000.2EX');
  if(!fs.existsSync(fp))return null;
  const buf=fs.readFileSync(fp);
  const hLen=buf.readUInt32BE(4);
  let pos=hLen;
  while(pos<buf.length-12){
    const tag=buf.toString('ascii',pos,pos+4);
    const tHL=buf.readUInt32BE(pos+4);
    const tTL=buf.readUInt32BE(pos+8);
    if(tag==='PWV7'){
      const dataStart=pos+tHL;
      const dataLen=tTL-tHL;
      const entries=Math.floor(dataLen/3);
      // Convert to array of {r,g,b} using beat-link scaling
      // byte[0]=mid, byte[1]=hi, byte[2]=low — raw 0-255 values
      const wf=new Array(entries);
      for(let i=0;i<entries;i++){
        const off=dataStart+i*3;
        wf[i]={
          low:buf[off+2],   // raw byte 0-255
          mid:buf[off],     // raw byte 0-255
          hi:buf[off+1],    // raw byte 0-255
        };
      }
      return wf;
    }
    pos+=tTL;if(tTL===0)break;
  }
  return null;
}

ipcMain.handle('bridge:findRekordboxWaveform',(_,{filename})=>{
  try{
    const idx=_buildANLZIndex();
    const key=filename.toLowerCase();
    // Try exact match first, then partial
    let anlzDir=idx[key];
    if(!anlzDir){
      for(const[k,v]of Object.entries(idx)){
        if(k.includes(key)||key.includes(k)){anlzDir=v;break;}
      }
    }
    if(!anlzDir)return null;
    const pwv7=_readPWV7(anlzDir);
    if(!pwv7)return null;
    console.log(`[ANLZ] PWV7 found for "${filename}": ${pwv7.length} entries`);
    return pwv7;
  }catch(e){console.warn('[ANLZ]',e.message);return null;}
});

app.whenReady().then(()=>{_registerBridgeAudioProtocol();createWindow();});
let _cleaned=false,_quitting=false;
function doQuit(){
  if(_quitting)return;_quitting=true;
  console.log('[APP] doQuit — starting shutdown sequence');
  // 1. Save window bounds while window is still valid
  saveBounds();
  clearInterval(iv);
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
      console.log('[APP] cleanup done — force exiting');
      try{if(splash&&!splash.isDestroyed())splash.destroy();}catch(_){}
      try{if(win&&!win.isDestroyed())win.destroy();}catch(_){}
      // Force process exit — app.quit() alone doesn't always work
      process.exit(0);
    },500);
  },100);
  // Safety net: force exit after 2s no matter what
  setTimeout(()=>{console.log('[APP] safety net exit');process.exit(0);},2000).unref();
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
  setTimeout(()=>process.exit(0),500).unref();
});
app.on('activate',()=>{if(!_quitting&&BrowserWindow.getAllWindows().length===0)createWindow();});
