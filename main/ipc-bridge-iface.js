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

  ipcMain.handle('bridge:artTimeCode', (_, { ip, port, hh, mm, ss, ff, type }) => {
    sendArtTimeCode(ip, port, hh, mm, ss, ff, type);
    return { ok: true };
  });
}

module.exports = { registerBridgeIfaceIpc };
