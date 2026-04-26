// Art-Net IPC — main.js 에서 추출 (Phase 3.7 modularization).
// ArtnetEngine 클래스는 main.js 에 유지, IPC 핸들러만 분리.

function registerArtnetIpc(ipcMain, artnet){
  ipcMain.handle('artnet:start',async(_,opts={})=>{
    const{bindIp,destIp,destPort,fps,unicast,unicastIp,pollReply,sync,dmxHz}=opts;
    if(fps)artnet.setFps(fps);
    return await artnet.start({bindIp,destIp,destPort,unicast,unicastIp,pollReply,sync,dmxHz});
  });
  ipcMain.handle('artnet:setUnicast',(_,{enabled,ip})=>{artnet.setUnicast(enabled,ip);return{ok:true};});
  ipcMain.handle('artnet:setPollReply',(_,{enabled})=>{artnet.setPollReply(enabled);return{ok:true};});
  ipcMain.handle('artnet:setSync',(_,{enabled})=>{artnet.setSync(enabled);return{ok:true};});
  ipcMain.handle('artnet:setDmxHz',(_,{hz})=>{artnet.setDmxHz(hz);return{ok:true};});
  ipcMain.handle('artnet:stop',()=>{artnet.stop();return{ok:true};});
  ipcMain.on('artnet:setTc',(_,{hh,mm,ss,ff})=>{artnet.setTimecode(hh,mm,ss,ff);});
  ipcMain.handle('artnet:setFps',(_,{fps})=>{artnet.setFps(fps);return{ok:true};});
  ipcMain.handle('artnet:forceResync',()=>{artnet.forceResync();return{ok:true};});
  ipcMain.on('artnet:setDmx',(_,{data,universe})=>{
    try{artnet.setDmx(data instanceof Uint8Array?data:Buffer.from(data||[]),universe||0);}catch(_){}
  });
  ipcMain.handle('artnet:clearDmx',()=>{artnet.clearDmx();return{ok:true};});
}

module.exports={ registerArtnetIpc };
