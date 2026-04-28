// Art-Net IPC — main.js 에서 추출 (Phase 3.7 modularization).
// ArtnetEngine 클래스는 main.js 에 유지, IPC 핸들러만 분리.

// SECURITY validators — renderer compromise 시 임의 IP/port/DMX payload 차단.
const _isIPv4 = (s) => typeof s === 'string' && s.length <= 15 && /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const _isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;
const _isUniverse = (n) => Number.isInteger(n) && n >= 0 && n <= 32767; // Art-Net: 15-bit
const _isFps = (n) => typeof n === 'number' && n > 0 && n <= 240;
const _isHz = (n) => typeof n === 'number' && n > 0 && n <= 1000;
const _DMX_MAX = 512;

function registerArtnetIpc(ipcMain, artnet){
  ipcMain.handle('artnet:start',async(_,opts={})=>{
    const{bindIp,destIp,destPort,fps,unicast,unicastIp,pollReply,sync,dmxHz}=opts;
    if (bindIp != null && bindIp !== 'auto' && bindIp !== '0.0.0.0' && !_isIPv4(bindIp)) return { ok:false, err:'invalid bindIp' };
    if (destIp != null && !_isIPv4(destIp)) return { ok:false, err:'invalid destIp' };
    if (destPort != null && !_isPort(destPort)) return { ok:false, err:'invalid destPort' };
    if (unicastIp != null && unicastIp !== '' && !_isIPv4(unicastIp)) return { ok:false, err:'invalid unicastIp' };
    if (fps != null && !_isFps(fps)) return { ok:false, err:'invalid fps' };
    if (dmxHz != null && !_isHz(dmxHz)) return { ok:false, err:'invalid dmxHz' };
    if (fps)artnet.setFps(fps);
    return await artnet.start({bindIp,destIp,destPort,unicast,unicastIp,pollReply,sync,dmxHz});
  });
  ipcMain.handle('artnet:setUnicast',(_,{enabled,ip})=>{
    if (ip != null && ip !== '' && !_isIPv4(ip)) return { ok:false, err:'invalid ip' };
    artnet.setUnicast(enabled,ip);return{ok:true};
  });
  ipcMain.handle('artnet:setPollReply',(_,{enabled})=>{artnet.setPollReply(enabled);return{ok:true};});
  ipcMain.handle('artnet:setSync',(_,{enabled})=>{artnet.setSync(enabled);return{ok:true};});
  ipcMain.handle('artnet:setDmxHz',(_,{hz})=>{
    if (!_isHz(hz)) return { ok:false, err:'invalid hz' };
    artnet.setDmxHz(hz);return{ok:true};
  });
  ipcMain.handle('artnet:stop',()=>{artnet.stop();return{ok:true};});
  ipcMain.on('artnet:setTc',(_,{hh,mm,ss,ff})=>{
    if (!Number.isInteger(hh)||hh<0||hh>23) return;
    if (!Number.isInteger(mm)||mm<0||mm>59) return;
    if (!Number.isInteger(ss)||ss<0||ss>59) return;
    if (!Number.isInteger(ff)||ff<0||ff>59) return;
    artnet.setTimecode(hh,mm,ss,ff);
  });
  ipcMain.handle('artnet:setFps',(_,{fps})=>{
    if (!_isFps(fps)) return { ok:false, err:'invalid fps' };
    artnet.setFps(fps);return{ok:true};
  });
  ipcMain.handle('artnet:forceResync',()=>{artnet.forceResync();return{ok:true};});
  ipcMain.on('artnet:setDmx',(_,{data,universe})=>{
    if (universe != null && !_isUniverse(universe)) return;
    try{
      // DMX universe 한 패킷 = 최대 512 byte. 그 이상은 잘라서 전달 (DoS 방지).
      let buf;
      if (data instanceof Uint8Array) buf = data.length > _DMX_MAX ? data.slice(0, _DMX_MAX) : data;
      else if (Array.isArray(data)) buf = Buffer.from(data.length > _DMX_MAX ? data.slice(0, _DMX_MAX) : data);
      else buf = Buffer.alloc(0);
      artnet.setDmx(buf, universe||0);
    }catch(_){}
  });
  ipcMain.handle('artnet:clearDmx',()=>{artnet.clearDmx();return{ok:true};});
}

module.exports={ registerArtnetIpc };
