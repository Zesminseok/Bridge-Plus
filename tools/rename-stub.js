#!/usr/bin/env node
// 빌드 카운터(마지막 2자리) 증가 + -stub 접미사 추가.
//
// 버전 규칙: X.Y.Z.BB
//   X.Y.Z = package.json 의 semver (수동 bump)
//   BB    = 자동 증가 2자리 빌드 카운터 (.build-number 파일 관리)
// 빌드 카운터는 semver 가 바뀌면 00 으로 리셋.
//
// 결과 파일명: BRIDGE+ X.Y.Z.BB-stub.exe
//
// CI 네이티브 빌드는 electron-builder 를 직접 호출하므로 이 스크립트
// 영향 없음 (CI 는 X.Y.Z 그대로 유지).
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const semver = pkg.version;
const dist = path.resolve(__dirname, '..', 'dist');
const stateFile = path.resolve(__dirname, '..', '.build-number');

let state = { version: '', build: -1 };
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch(_) {}
if (state.version !== semver) {
  state = { version: semver, build: 0 };
} else {
  state.build = (state.build | 0) + 1;
}
fs.writeFileSync(stateFile, JSON.stringify(state) + '\n');
const bb = String(state.build).padStart(2, '0');
const fullVer = `${semver}.${bb}`;

const targets = [
  `BRIDGE+ ${semver}.exe`,
  `BRIDGE+ Setup ${semver}.exe`,
  `BRIDGE+ Setup ${semver}.exe.blockmap`,
];

let renamed = 0;
for (const name of targets) {
  const src = path.join(dist, name);
  if (!fs.existsSync(src)) continue;
  // BRIDGE+ 0.9.2.exe → BRIDGE+ 0.9.2.01-stub.exe
  const dst = src.replace(`${semver}.exe`, `${fullVer}-stub.exe`);
  fs.renameSync(src, dst);
  console.log(`[stub] ${name} → ${path.basename(dst)}`);
  renamed++;
}

if (renamed === 0) console.log(`[stub] no Windows artifacts found (expected version ${semver})`);
else console.log(`[stub] build ${fullVer} — renamed ${renamed} file(s)`);
