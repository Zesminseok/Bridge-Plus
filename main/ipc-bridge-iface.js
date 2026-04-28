// Interface / time code IPC — main.js 에서 Phase 3.11 modularization 으로 분리.
// sendInterfaces, sendArtTimeCode 는 main.js 에 정의 (closure 변수 _ifaceSig, artnet, _artSocket 의존).
// 함수 ref 만 deps 로 받음.
'use strict';

function registerBridgeIfaceIpc(ipcMain, { getBridge, sendInterfaces, sendArtTimeCode }) {
  ipcMain.handle('bridge:getInterfaces', () => sendInterfaces('manual'));

  ipcMain.handle('bridge:refreshInterfaces', async () => {
    const ifaces = sendInterfaces('manual-refresh');
    try { await getBridge()?.handleInterfacesChanged(ifaces); }
    catch (e) { return { ok: false, err: e.message, interfaces: ifaces }; }
    return { ok: true, interfaces: ifaces };
  });

  // SECURITY: renderer 가 임의 IP/port 로 UDP timecode 패킷을 보내지 못하게 검증.
  ipcMain.handle('bridge:artTimeCode', (_, { ip, port, hh, mm, ss, ff, type }) => {
    if (typeof ip !== 'string' || ip.length > 15 || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { ok: false, err: 'invalid ip' };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, err: 'invalid port' };
    if (!Number.isInteger(hh) || hh < 0 || hh > 23) return { ok: false, err: 'invalid hh' };
    if (!Number.isInteger(mm) || mm < 0 || mm > 59) return { ok: false, err: 'invalid mm' };
    if (!Number.isInteger(ss) || ss < 0 || ss > 59) return { ok: false, err: 'invalid ss' };
    if (!Number.isInteger(ff) || ff < 0 || ff > 59) return { ok: false, err: 'invalid ff' };
    if (!Number.isInteger(type) || type < 0 || type > 3) return { ok: false, err: 'invalid type' };
    sendArtTimeCode(ip, port, hh, mm, ss, ff, type);
    return { ok: true };
  });
}

module.exports = { registerBridgeIfaceIpc };
