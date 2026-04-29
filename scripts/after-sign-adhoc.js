// after-sign hook — ad-hoc sign the .app to reduce macOS Gatekeeper friction.
// Without Apple Developer ID, ad-hoc ('-') signature doesn't enable notarization but
// changes the user-facing error from "damaged" to "unidentified developer"
// (bypassable via right-click → Open). Reduces friction significantly.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  const { appOutDir, packager } = context;
  if (packager.platform.name !== 'mac') return;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  console.log(`[afterSign] ad-hoc signing ${appPath}`);
  try {
    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
    // ad-hoc only — NO --options runtime (hardenedRuntime + ad-hoc 조합은
    // 사용자 머신에서 "이 버전의 macOS에서 작동" 거부 메시지 발생).
    // 평범한 ad-hoc 서명만 적용 — Gatekeeper "damaged" 메시지만 우회.
    execFileSync('codesign', [
      '--force', '--deep', '--sign', '-',
      '--timestamp=none',
      appPath,
    ], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
    console.log('[afterSign] ad-hoc signature OK');
  } catch (e) {
    console.warn('[afterSign] failed:', e.message);
  }
};
