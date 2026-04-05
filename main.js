'use strict';
// Prevent EPIPE crashes when stdout pipe is broken
process.stdout?.on('error',()=>{});
process.stderr?.on('error',()=>{});
const{app,BrowserWindow,ipcMain}=require('electron');

// Single instance lock — prevent duplicate app windows
const gotLock=app.requestSingleInstanceLock();
if(!gotLock){console.log('[APP] another instance running — quitting');app.quit();process.exit(0);}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
const path=require('path'),os=require('os'),fs=require('fs');
const dgram=require('dgram');
const{BridgeCore,getAllInterfaces}=require('./bridge-core');

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

function createWindow(){
  const saved=loadBounds();
  win=new BrowserWindow({
    x:saved?.x, y:saved?.y,
    width:saved?.width||1040, height:saved?.height||840,
    minWidth:900,minHeight:680,
    backgroundColor:'#0a0c10',titleBarStyle:'hiddenInset',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false},
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
    bridge.onNodeDiscovered=n=>win?.webContents.send('tcnet:node',n);
    bridge.onCDJStatus=(li,s)=>win?.webContents.send('bridge:cdj',{layerIndex:li,status:s});
    bridge.onDJMStatus=f=>win?.webContents.send('bridge:djm',{faders:f});
    bridge.onDJMMeter=ch=>win?.webContents.send('bridge:djmmeter',ch);
    bridge.onDeviceList=devs=>win?.webContents.send('pdjl:devices',Object.values(devs));
    bridge.onWaveformPreview=(pn,wf)=>win?.webContents.send('bridge:wfpreview',{playerNum:pn,...wf});
    bridge.onAlbumArt=(pn,b64)=>win?.webContents.send('bridge:albumart',{playerNum:pn,art:b64});
    bridge.onTrackMetadata=(pn,meta)=>win?.webContents.send('bridge:trackmeta',{playerNum:pn,...meta});
    await bridge.start();push();
    // After 8s, re-request metadata for already-loaded tracks
    setTimeout(()=>bridge?.refreshAllMetadata(), 8000);
    return{ok:true,pdjlPort:bridge.getPDJLPort(),broadcastAddr:bridge.broadcastAddr};
  }catch(e){return{ok:false,err:e.message};}
});
ipcMain.handle('bridge:stop',async()=>{bridge?.stop();clearInterval(iv);return{ok:true};});
ipcMain.handle('bridge:updateLayer',(_,{i,data})=>{bridge?.updateLayer(i,data);return{ok:true};});
ipcMain.handle('bridge:removeLayer',(_,{i})=>{bridge?.removeLayer(i);return{ok:true};});
ipcMain.handle('bridge:registerVirtualDeck',(_,{slot,model})=>{bridge?.registerVirtualDeck(slot,model);return{ok:true};});
ipcMain.handle('bridge:unregisterVirtualDeck',(_,{slot})=>{bridge?.unregisterVirtualDeck(slot);return{ok:true};});
ipcMain.handle('bridge:setHWMode',(_,{i,en})=>{bridge?.setHWMode(i,en);return{ok:true};});
ipcMain.handle('bridge:getInterfaces',()=>getAllInterfaces());
ipcMain.handle('bridge:getDevices',()=>bridge?.getActiveDevices()||[]);
ipcMain.handle('bridge:artTimeCode',(_,{ip,port,hh,mm,ss,ff,type})=>{sendArtTimeCode(ip,port,hh,mm,ss,ff,type);return{ok:true};});
ipcMain.handle('bridge:requestArtwork',(_,{ip,slot,artworkId,playerNum})=>{bridge?.requestArtwork(ip,slot,artworkId,playerNum);return{ok:true};});

app.whenReady().then(createWindow);
let _cleaned=false;
function cleanup(){
  if(_cleaned)return;_cleaned=true;
  console.log('[APP] cleanup start');
  saveBounds();
  clearInterval(iv);
  try{bridge?.stop();}catch(e){console.warn('[APP] bridge.stop:',e.message);}
  bridge=null;
  try{_artSocket.close();}catch(_){}
  console.log('[APP] cleanup done — scheduling force exit');
  // Absolute safety net: force kill process after 500ms no matter what
  setTimeout(()=>{console.log('[APP] force exit');process.exit(0);},500).unref();
}
app.on('window-all-closed',()=>{cleanup();app.quit();});
app.on('before-quit',()=>{cleanup();});
app.on('will-quit',()=>{cleanup();});
app.on('activate',()=>{if(!_cleaned&&BrowserWindow.getAllWindows().length===0)createWindow();});
