'use strict';
const{app,BrowserWindow,ipcMain}=require('electron');
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

function createWindow(){
  win=new BrowserWindow({
    width:1040,height:840,minWidth:900,minHeight:680,
    backgroundColor:'#0a0c10',titleBarStyle:'hiddenInset',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false},
  });
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
    await bridge.start();push();
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
app.on('window-all-closed',()=>{bridge?.stop();clearInterval(iv);app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
