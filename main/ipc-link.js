// Ableton Link IPC handlers — main.js 에서 Phase 3.8 modularization 으로 분리.
// 의존: link 인스턴스 (abletonlink wrapper) 단일.
'use strict';

function registerLinkIpc(ipcMain, link) {
  ipcMain.handle('link:setEnabled', (_, { enabled }) => { link.setEnabled(enabled); return link.getStatus(); });
  ipcMain.on('link:setTempo', (_, { bpm }) => { link.setTempo(bpm); });
  ipcMain.handle('link:getStatus', () => link.getStatus());
  ipcMain.handle('link:alignBeat', (_, { beat }) => {
    const ok = link.alignBeat(beat);
    return { ok, status: link.getStatus() };
  });
}

module.exports = { registerLinkIpc };
