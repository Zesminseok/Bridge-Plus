#!/usr/bin/env node
// 빌드 산출물을 /tmp/bridge-plus-build (Dropbox 외부) 에서 꺼내와
// 프로젝트의 dist/ 폴더로 복사. 파일명에 -stub 및 자동 증가 빌드 카운터(BB)
// 붙임. intermediate 수천 개 파일이 Dropbox sync 되는 것 방지 목적.
//
// 버전 규칙: X.Y.Z.BB
//   X.Y.Z = package.json semver (수동 bump)
//   BB    = 2자리 빌드 카운터 (.build-number 자동 증가, semver 바뀌면 00 리셋)
//
// 결과: dist/BRIDGE+ X.Y.Z.BB-stub.exe  (이거 하나만)
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const semver = pkg.version;
const projRoot = path.resolve(__dirname, '..');
const buildOut = '/tmp/bridge-plus-build';
const distDir = path.join(projRoot, 'dist');
const stateFile = path.join(projRoot, '.build-number');

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

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const copyMap = [
  { src: `BRIDGE+ ${semver}.exe`,          dst: `BRIDGE+ ${fullVer}-stub.exe` },
  { src: `BRIDGE+ Setup ${semver}.exe`,    dst: `BRIDGE+ Setup ${fullVer}-stub.exe` },
];

let moved = 0;
for (const { src, dst } of copyMap) {
  const srcPath = path.join(buildOut, src);
  if (!fs.existsSync(srcPath)) continue;
  const dstPath = path.join(distDir, dst);
  fs.copyFileSync(srcPath, dstPath);
  console.log(`[stub] copied → ${dst}`);
  moved++;
}

// 기존 같은 semver 의 이전 BB 빌드 제거 (예: 0.9.2.15-stub.exe 삭제)
if (moved > 0) {
  try {
    for (const name of fs.readdirSync(distDir)) {
      if (name === copyMap[0].dst || name === copyMap[1].dst) continue;
      const m = name.match(new RegExp(`^BRIDGE\\+ (Setup )?${semver.replace(/\./g,'\\.')}\\.(\\d+)-stub\\.exe$`));
      if (m && m[2] !== bb) {
        try { fs.unlinkSync(path.join(distDir, name)); console.log(`[stub] pruned old build ${name}`); } catch(_) {}
      }
    }
  } catch(_) {}
}

// 빌드 폴더 정리 (Dropbox sync 방지용). 최종 exe 만 dist/ 로 복사했으므로 안전.
try {
  fs.rmSync(buildOut, { recursive: true, force: true });
  console.log(`[stub] cleaned ${buildOut}`);
} catch(_) {}

if (moved === 0) console.log(`[stub] no artifacts found in ${buildOut}`);
else console.log(`[stub] build ${fullVer} — ${moved} file(s) copied to dist/`);
