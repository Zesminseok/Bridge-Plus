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

// ═══ Art-Net 4 Engine ════════════════════════════════════════════════
// Features parity with SuperTimecodeConverter ArtnetOutput.h:
//  • High-rate timer (setInterval 2ms) + fractional accumulator → drift-free
//  • OpTimeCode 0x9700 19B + auto-increment encoder + seek detection
//  • forceResync() for seek/hot-cue/track-change (eliminates 1-frame latency)
//  • OpDmx 0x5000 DMX output (up to 512ch, sequenced 1-255)
//  • Per-interface bind (SO_BROADCAST) + dest-port config
//  • Pause/resume, range validation, send-error counter
class ArtnetEngine{
  constructor(){
    this._sock=null;this._bindIp='0.0.0.0';this._destIp='255.255.255.255';this._destPort=6454;
    this._timer=null;this._running=false;this._paused=false;
    this._fps=25;this._fpsType=1;
    this._target={hh:0,mm:0,ss:0,ff:0};
    this._enc={hh:0,mm:0,ss:0,ff:0};
    this._seeded=false;this._lastHR=0;this._errors=0;
    this._dmxBuf=null;this._dmxUniverse=0;this._dmxSeq=0;this._dmxLastHR=0;this._dmxIntervalMs=25; // 40Hz
  }
  _now(){const[s,n]=process.hrtime();return s*1000+n/1e6;}
  getStatus(){return{running:this._running,paused:this._paused,bindIp:this._bindIp,destIp:this._destIp,port:this._destPort,fps:this._fps,errors:this._errors};}
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
  forceResync(){
    if(!this._running||this._paused||!this._sock)return;
    this._seeded=false;
    this._sendTc();
    this._lastHR=this._now();
  }
  start({bindIp,destIp,destPort}={}){
    return new Promise((resolve)=>{
      this.stop();
      this._bindIp=bindIp||'0.0.0.0';
      this._destIp=destIp||'255.255.255.255';
      this._destPort=(destPort|0)||6454;
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
          console.log('[ART] started',this._bindIp,'->',this._destIp+':'+this._destPort);
          resolve({ok:true});
        });
      }catch(e){console.warn('[ART] bind error',e.message);resolve({ok:false,err:e.message});}
    });
  }
  stop(){
    this._running=false;this._paused=false;
    if(this._timer){clearInterval(this._timer);this._timer=null;}
    if(this._sock){try{this._sock.close();}catch(_){}this._sock=null;}
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
    try{this._sock.send(pkt,0,19,this._destPort,this._destIp);}
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
    try{this._sock.send(pkt,0,pkt.length,this._destPort,this._destIp);}
    catch(e){this._errors++;}
  }
}
const artnet=new ArtnetEngine();

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
ipcMain.handle('artnet:start',async(_,{bindIp,destIp,destPort,fps})=>{
  if(fps)artnet.setFps(fps);
  return await artnet.start({bindIp,destIp,destPort});
});
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
    try{_artSocket.close();}catch(_){}
    _cleaned=true;
  }
  setTimeout(()=>process.exit(0),500).unref();
});
app.on('activate',()=>{if(!_quitting&&BrowserWindow.getAllWindows().length===0)createWindow();});
