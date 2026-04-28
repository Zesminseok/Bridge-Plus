// Bridge simple IPC — bridge 인스턴스만 의존하는 단순 forward handlers.
// Phase 3.10 modularization. start/stop/interfaces 등 closure 의존 핸들러는 main.js 에 유지.
'use strict';

function registerBridgeSimpleIpc(ipcMain, getBridge) {
  const b = () => getBridge();

  // SECURITY: layer/slot/fader index validation — IPC 임의 호출 시 array out-of-bounds / DoS 방지.
  const _isLayerIdx = (i) => Number.isInteger(i) && i >= 0 && i <= 7;
  const _isSlotIdx = (i) => Number.isInteger(i) && i >= 0 && i <= 15;
  const _MAX_ART_BYTES = 5 * 1024 * 1024; // 5MB JPEG cap
  // base64 cap: 정확한 상한 = ceil(maxBytes/3)*4 (그 이상 길면 디코딩 후 5MB 초과 보장).
  const _MAX_ART_B64_LEN = Math.ceil(_MAX_ART_BYTES / 3) * 4;
  const _TCNET_MODES = new Set(['auto', 'client', 'server']);

  ipcMain.handle('bridge:updateLayer', (_, { i, data }) => {
    if (!_isLayerIdx(i)) return { ok: false, err: 'invalid layer index' };
    b()?.updateLayer(i, data); return { ok: true };
  });
  ipcMain.on('bridge:setFader', (_, { i, val }) => {
    if (!_isLayerIdx(i)) return;
    const br = b();
    if (br && br.faders) br.faders[i] = Math.max(0, Math.min(255, val));
  });
  ipcMain.handle('bridge:removeLayer', (_, { i }) => {
    if (!_isLayerIdx(i)) return { ok: false, err: 'invalid layer index' };
    b()?.removeLayer(i); return { ok: true };
  });
  ipcMain.handle('bridge:registerVirtualDeck', (_, { slot, model }) => {
    if (!_isSlotIdx(slot)) return { ok: false, err: 'invalid slot' };
    if (typeof model !== 'string' || model.length > 64) return { ok: false, err: 'invalid model name' };
    b()?.registerVirtualDeck(slot, model); return { ok: true };
  });
  ipcMain.handle('bridge:unregisterVirtualDeck', (_, { slot }) => {
    if (!_isSlotIdx(slot)) return { ok: false, err: 'invalid slot' };
    b()?.unregisterVirtualDeck(slot); return { ok: true };
  });
  ipcMain.handle('bridge:setHWMode', (_, { i, en }) => {
    if (!_isLayerIdx(i)) return { ok: false, err: 'invalid layer index' };
    b()?.setHWMode(i, en); return { ok: true };
  });
  ipcMain.handle('bridge:refreshMeta', () => { b()?.refreshAllMetadata(); return { ok: true }; });
  ipcMain.handle('bridge:requestArtwork', (_, { ip, slot, artworkId, playerNum }) => {
    if (typeof ip !== 'string' || ip.length > 45) return { ok: false, err: 'invalid ip' }; // IPv6 max 45
    if (!Number.isInteger(slot) || slot < 0 || slot > 7) return { ok: false, err: 'invalid slot' };
    if (!Number.isInteger(artworkId) || artworkId < 0) return { ok: false, err: 'invalid artworkId' };
    if (!Number.isInteger(playerNum) || playerNum < 1 || playerNum > 8) return { ok: false, err: 'invalid playerNum' };
    b()?.requestArtwork(ip, slot, artworkId, playerNum); return { ok: true };
  });
  ipcMain.handle('bridge:setVirtualArt', (_, { slot, jpegBase64 }) => {
    if (!_isSlotIdx(slot)) return { ok: false, err: 'invalid slot' };
    // 5MB cap — 무한 base64 → Buffer 메모리 폭주 방지.
    if (jpegBase64 && (typeof jpegBase64 !== 'string' || jpegBase64.length > _MAX_ART_B64_LEN)) {
      return { ok: false, err: 'art too large (max 5MB)' };
    }
    const br = b();
    if (br) br.setVirtualArt(slot, jpegBase64 ? Buffer.from(jpegBase64, 'base64') : null);
    return { ok: true };
  });
  // SECURITY: rebind addr 는 'auto' 또는 enumerated local interface IPv4 만 허용.
  // bridge.getAllInterfaces() 결과에 없는 임의 IP 면 거부.
  const _isValidBindAddr = (addr) => {
    if (addr === 'auto' || addr === '0.0.0.0' || addr == null) return true;
    if (typeof addr !== 'string' || addr.length > 15) return false;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) return false;
    try {
      const br = b();
      const ifaces = br?.getAllInterfaces?.() || [];
      return ifaces.some(i => i.address === addr);
    } catch (_) { return false; }
  };
  ipcMain.handle('bridge:rebindTCNet', async (_, { addr }) => {
    if (!_isValidBindAddr(addr)) return { ok: false, err: 'invalid bind addr' };
    try { await b()?.rebindTCNet(addr); return { ok: true }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  ipcMain.handle('bridge:rebindPDJL', async (_, { addr }) => {
    if (!_isValidBindAddr(addr)) return { ok: false, err: 'invalid bind addr' };
    try { await b()?.rebindPDJL(addr); return { ok: true }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  ipcMain.handle('bridge:setTCNetMode', (_, { mode }) => {
    if (!_TCNET_MODES.has(mode)) return { ok: false, err: 'invalid mode' };
    b()?.setTCNetMode(mode); return { ok: true };
  });
}

module.exports = { registerBridgeSimpleIpc };
