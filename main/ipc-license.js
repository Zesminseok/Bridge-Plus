// License IPC Router — main.js 에서 추출 (Phase 1.2 modularization).
// Test builds 에서 stub 동작 — 앱 런타임 게이팅 없음.

function registerLicenseIpc(ipcMain, licenseService){
  ipcMain.handle('license:getStatus',()=>licenseService.getStatus());
  ipcMain.handle('license:activate',(_,{email,serial}={})=>licenseService.activate({email,serial}));
  ipcMain.handle('license:deactivate',()=>licenseService.deactivate());
  ipcMain.handle('license:refresh',()=>licenseService.refresh());
}

module.exports={ registerLicenseIpc };
