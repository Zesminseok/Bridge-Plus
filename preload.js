'use strict';
const{contextBridge,ipcRenderer}=require('electron');

// ipcRenderer.on listener 가 UI 재마운트 시 누적되는 누수 방지 — 등록 후 remover 반환.
// 기존 호출자가 반환값을 무시해도 동작 동일 (backward compat).
function _on(channel, cb){
  const wrapped = (_e, d) => cb(d);
  ipcRenderer.on(channel, wrapped);
  return () => { try { ipcRenderer.removeListener(channel, wrapped); } catch (_) {} };
}
function _onArgless(channel, cb){
  const wrapped = () => cb();
  ipcRenderer.on(channel, wrapped);
  return () => { try { ipcRenderer.removeListener(channel, wrapped); } catch (_) {} };
}

contextBridge.exposeInMainWorld('bridge',{
  platform: process.platform,
  start:(o)=>ipcRenderer.invoke('bridge:start',o),
  stop:()=>ipcRenderer.invoke('bridge:stop'),
  getInterfaces:()=>ipcRenderer.invoke('bridge:getInterfaces'),
  refreshInterfaces:()=>ipcRenderer.invoke('bridge:refreshInterfaces'),
  updateLayer:(i,d)=>ipcRenderer.invoke('bridge:updateLayer',{i,data:d}),
  setFader:(i,val)=>ipcRenderer.send('bridge:setFader',{i,val}),
  removeLayer:(i)=>ipcRenderer.invoke('bridge:removeLayer',{i}),
  registerVirtualDeck:(slot,model)=>ipcRenderer.invoke('bridge:registerVirtualDeck',{slot,model}),
  unregisterVirtualDeck:(slot)=>ipcRenderer.invoke('bridge:unregisterVirtualDeck',{slot}),
  setHWMode:(i,e)=>ipcRenderer.invoke('bridge:setHWMode',{i,en:e}),
  onStatus:(cb)=>_on('bridge:status',cb),
  onTcnetNode:(cb)=>_on('tcnet:node',cb),
  onCDJStatus:(cb)=>_on('bridge:cdj',cb),
  onDJMStatus:(cb)=>_on('bridge:djm',cb),
  onDevices:(cb)=>_on('pdjl:devices',cb),
  onInterfaces:(cb)=>_on('net:interfaces',cb),
  onDJMMeter:(cb)=>_on('bridge:djmmeter',cb),
  onWaveformPreview:(cb)=>_on('bridge:wfpreview',cb),
  onWaveformDetail:(cb)=>_on('bridge:wfdetail',cb),
  onCuePoints:(cb)=>_on('bridge:cuepoints',cb),
  onBeatGrid:(cb)=>_on('bridge:beatgrid',cb),
  onSongStructure:(cb)=>_on('bridge:songstruct',cb),
  onAlbumArt:(cb)=>_on('bridge:albumart',cb),
  onTrackMeta:(cb)=>_on('bridge:trackmeta',cb),
  refreshMeta:()=>ipcRenderer.invoke('bridge:refreshMeta'),
  requestArtwork:(d)=>ipcRenderer.invoke('bridge:requestArtwork',d),
  setVirtualArt:(slot,jpegBase64)=>ipcRenderer.invoke('bridge:setVirtualArt',{slot,jpegBase64}),
  sendArtnet:(d)=>ipcRenderer.invoke('bridge:artTimeCode',d),
  // Art-Net Engine API
  artnetStart:(o)=>ipcRenderer.invoke('artnet:start',o),
  artnetStop:()=>ipcRenderer.invoke('artnet:stop'),
  artnetSetTc:(tc)=>ipcRenderer.send('artnet:setTc',tc),
  artnetSetFps:(fps)=>ipcRenderer.invoke('artnet:setFps',{fps}),
  artnetForceResync:()=>ipcRenderer.invoke('artnet:forceResync'),
  artnetSetDmx:(data,universe)=>ipcRenderer.send('artnet:setDmx',{data,universe}),
  artnetClearDmx:()=>ipcRenderer.invoke('artnet:clearDmx'),
  // Art-Net 확장 옵션
  artnetSetUnicast:(enabled,ip)=>ipcRenderer.invoke('artnet:setUnicast',{enabled,ip}),
  artnetSetPollReply:(enabled)=>ipcRenderer.invoke('artnet:setPollReply',{enabled}),
  artnetSetSync:(enabled)=>ipcRenderer.invoke('artnet:setSync',{enabled}),
  artnetSetDmxHz:(hz)=>ipcRenderer.invoke('artnet:setDmxHz',{hz}),
  // Ableton Link API
  linkSetEnabled:(enabled)=>ipcRenderer.invoke('link:setEnabled',{enabled}),
  linkSetTempo:(bpm)=>ipcRenderer.send('link:setTempo',{bpm}),
  linkGetStatus:()=>ipcRenderer.invoke('link:getStatus'),
  linkAlignBeat:(beat)=>ipcRenderer.invoke('link:alignBeat',{beat}),
  licenseGetStatus:()=>ipcRenderer.invoke('license:getStatus'),
  licenseActivate:(email,serial)=>ipcRenderer.invoke('license:activate',{email,serial}),
  licenseDeactivate:()=>ipcRenderer.invoke('license:deactivate'),
  licenseRefresh:()=>ipcRenderer.invoke('license:refresh'),
  rebindTCNet:(addr)=>ipcRenderer.invoke('bridge:rebindTCNet',{addr}),
  rebindPDJL:(addr)=>ipcRenderer.invoke('bridge:rebindPDJL',{addr}),
  setTCNetMode:(mode)=>ipcRenderer.invoke('bridge:setTCNetMode',{mode}),
  cleanupZombies:()=>ipcRenderer.invoke('bridge:cleanupZombies'),
  getAppVersion:()=>ipcRenderer.invoke('app:getVersion'),
  // Multi-channel audio decode
  checkFFmpeg:()=>ipcRenderer.invoke('bridge:checkFFmpeg'),
  decodeAudio:(filePath,slot)=>ipcRenderer.invoke('bridge:decodeAudio',{filePath,slot}),
  cleanupTemp:(tempPath)=>ipcRenderer.invoke('bridge:cleanupTemp',{tempPath}),
  onAudioProgress:(cb)=>_on('bridge:audioProgress',cb),
  onQuitting:(cb)=>_onArgless('app:quitting',cb),
  getCpuUsage:()=>ipcRenderer.invoke('bridge:cpuUsage'),
});
