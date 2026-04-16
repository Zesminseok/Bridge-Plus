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

// Art-Net ArtTimeCode sender
const _artSocket=dgram.createSocket('udp4');
_artSocket.bind(0,()=>{try{_artSocket.setBroadcast(true);}catch(_){}});
function sendArtTimeCode(ip,port,hh,mm,ss,ff,type){
  // Art-Net 4 — ArtTimeCode (OpCode 0x9700 LE)
  // Spec: https://artisticlicence.com/WebSiteMaster/User%20Guides/art-net.pdf §14
  const pkt=Buffer.alloc(19);
  pkt.write('Art-Net\0',0,'ascii');  // ID[8]
  pkt.writeUInt16LE(0x9700,8);       // OpCode = OpTimeCode (LE)
  pkt.writeUInt8(0x00,10);           // ProtVerHi
  pkt.writeUInt8(0x0E,11);           // ProtVerLo = 14
  pkt.writeUInt8(0,12);              // Filler1
  pkt.writeUInt8(0,13);              // Filler2
  pkt.writeUInt8(ff&0xFF,14);        // Frames  0-29
  pkt.writeUInt8(ss&0xFF,15);        // Seconds 0-59
  pkt.writeUInt8(mm&0xFF,16);        // Minutes 0-59
  pkt.writeUInt8(hh&0xFF,17);        // Hours   0-23
  pkt.writeUInt8(type&0x03,18);      // Type: 0=Film/24,1=EBU/25,2=DF/29.97,3=SMPTE/30
  const target=ip||'255.255.255.255';
  try{_artSocket.send(pkt,0,pkt.length,port||6454,target);}catch(e){console.warn('[ART]',e.message);}
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
    bridge.onDJMStatus=f=>_send('bridge:djm',{faders:f.channel||f, eq:f.eq, xfader:f.xfader, masterLvl:f.masterLvl, boothLvl:f.boothLvl, hpLevel:f.hpLevel, hpCueCh:f.hpCueCh, chExtra:f.chExtra});
    bridge.onDJMMeter=d=>_send('bridge:djmmeter',d);
    bridge.onDeviceList=devs=>_send('pdjl:devices',Object.values(devs));
    bridge.onWaveformPreview=(pn,wf)=>_send('bridge:wfpreview',{playerNum:pn,...wf});
    bridge.onWaveformDetail=(pn,wf)=>_send('bridge:wfdetail',{playerNum:pn,...wf});
    bridge.onCuePoints=(pn,cues)=>_send('bridge:cuepoints',{playerNum:pn,cues});
    bridge.onBeatGrid=(pn,bg)=>_send('bridge:beatgrid',{playerNum:pn,...bg});
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
    try{_artSocket.close();}catch(_){}
    _cleaned=true;
    // 5. Wait 300ms for OptOut UDP to flush, then force exit
    setTimeout(()=>{
      console.log('[APP] cleanup done — force exiting');
      try{if(splash&&!splash.isDestroyed())splash.destroy();}catch(_){}
      try{if(win&&!win.isDestroyed())win.destroy();}catch(_){}
      // Force process exit — app.quit() alone doesn't always work
      process.exit(0);
    },300);
  },100);
  // Safety net: force exit after 1.5s no matter what
  setTimeout(()=>{console.log('[APP] safety net exit');process.exit(0);},1500).unref();
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
    try{_artSocket.close();}catch(_){}
    _cleaned=true;
  }
  setTimeout(()=>process.exit(0),500).unref();
});
app.on('activate',()=>{if(!_quitting&&BrowserWindow.getAllWindows().length===0)createWindow();});
