// App-level / system IPC — CPU usage, version, cleanup. Phase 3.9 modularization.
// 의존성: app (electron), 파일 시스템, cleanup 서비스.
'use strict';

const fs = require('fs');
const path = require('path');

function registerAppIpc(ipcMain, { app, appRoot, cleanupSvc }) {
  ipcMain.handle('bridge:cpuUsage', () => {
    const metrics = app.getAppMetrics();
    let cpu = 0;
    metrics.forEach(m => { cpu += m.cpu.percentCPUUsage; });
    const mem = process.memoryUsage();
    return { cpu: Math.round(cpu * 10) / 10, memMB: Math.round(mem.rss / 1048576) };
  });

  ipcMain.handle('bridge:cleanupZombies', async () => {
    try { return { ok: true, ...(await cleanupSvc.runCleanup()) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // 앱 버전 — package.json semver + .build-number 카운터 → X.Y.Z.BB.
  ipcMain.handle('app:getVersion', () => {
    try {
      const pkgPath = path.join(appRoot, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      let bb = '00';
      try {
        const state = JSON.parse(fs.readFileSync(path.join(appRoot, '.build-number'), 'utf8'));
        if (state.version === pkg.version && typeof state.build === 'number') {
          bb = String(state.build).padStart(2, '0');
        }
      } catch (_) {}
      return `${pkg.version}.${bb}`;
    } catch (_) { return '0.0.0'; }
  });
}

module.exports = { registerAppIpc };
