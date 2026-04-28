// Bridge simple IPC — bridge 인스턴스만 의존하는 단순 forward handlers.
// Phase 3.10 modularization. start/stop/interfaces 등 closure 의존 핸들러는 main.js 에 유지.
'use strict';

function registerBridgeSimpleIpc(ipcMain, getBridge) {
  const b = () => getBridge();

  ipcMain.handle('bridge:updateLayer', (_, { i, data }) => { b()?.updateLayer(i, data); return { ok: true }; });
  ipcMain.on('bridge:setFader', (_, { i, val }) => {
    const br = b();
    if (br && br.faders) br.faders[i] = Math.max(0, Math.min(255, val));
  });
  ipcMain.handle('bridge:removeLayer', (_, { i }) => { b()?.removeLayer(i); return { ok: true }; });
  ipcMain.handle('bridge:registerVirtualDeck', (_, { slot, model }) => { b()?.registerVirtualDeck(slot, model); return { ok: true }; });
  ipcMain.handle('bridge:unregisterVirtualDeck', (_, { slot }) => { b()?.unregisterVirtualDeck(slot); return { ok: true }; });
  ipcMain.handle('bridge:setHWMode', (_, { i, en }) => { b()?.setHWMode(i, en); return { ok: true }; });
  ipcMain.handle('bridge:refreshMeta', () => { b()?.refreshAllMetadata(); return { ok: true }; });
  ipcMain.handle('bridge:requestArtwork', (_, { ip, slot, artworkId, playerNum }) => {
    b()?.requestArtwork(ip, slot, artworkId, playerNum); return { ok: true };
  });
  ipcMain.handle('bridge:setVirtualArt', (_, { slot, jpegBase64 }) => {
    const br = b();
    if (br) br.setVirtualArt(slot, jpegBase64 ? Buffer.from(jpegBase64, 'base64') : null);
    return { ok: true };
  });
  ipcMain.handle('bridge:rebindTCNet', async (_, { addr }) => {
    try { await b()?.rebindTCNet(addr); return { ok: true }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  ipcMain.handle('bridge:rebindPDJL', async (_, { addr }) => {
    try { await b()?.rebindPDJL(addr); return { ok: true }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  ipcMain.handle('bridge:setTCNetMode', (_, { mode }) => { b()?.setTCNetMode(mode); return { ok: true }; });
}

module.exports = { registerBridgeSimpleIpc };
