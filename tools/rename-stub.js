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
  console.log(`[STUB] copied → ${dst}`);
  moved++;
}

// 보존 정책: 현재 빌드 + 직전 1개만 유지 (총 2개). 그 이전은 삭제.
// 이유: Dropbox 가 rename 을 변경으로 인식 → 프로그램 실행 중 동기화 중단.
// rename 없이 이전 빌드를 그대로 두고, 새 빌드는 새 이름으로 추가만 함.
// 다음 빌드에서 (현재-2) 만 삭제하므로 직전 1개는 항상 유지됨.
if (moved > 0) {
  try {
    // 같은 semver 의 모든 stub.exe 수집 → BB 기준 정렬
    const allBuilds = [];
    for (const name of fs.readdirSync(distDir)) {
      const m = name.match(new RegExp(`^BRIDGE\\+ (Setup )?${semver.replace(/\./g,'\\.')}\\.(\\d+)-stub\\.exe$`));
      if (m) allBuilds.push({ name, bb: parseInt(m[2], 10), kind: m[1] ? 'setup' : 'main' });
    }
    // kind 별로 그룹핑 후 BB 내림차순 정렬, 상위 2개(현재+직전)만 유지
    for (const kind of ['main', 'setup']) {
      const group = allBuilds.filter(b => b.kind === kind).sort((a, b) => b.bb - a.bb);
      const toDelete = group.slice(2); // 3번째부터 삭제
      for (const b of toDelete) {
        try { fs.unlinkSync(path.join(distDir, b.name)); console.log(`[STUB] pruned old build ${b.name}`); } catch(_) {}
      }
      if (group.length >= 2) {
        console.log(`[STUB] kept: ${group[0].name} (current) + ${group[1].name} (previous)`);
      }
    }
  } catch(e) { console.warn('[STUB] prune error:', e.message); }
}

// 빌드 폴더 정리 (Dropbox sync 방지용). 최종 exe 만 dist/ 로 복사했으므로 안전.
try {
  fs.rmSync(buildOut, { recursive: true, force: true });
  console.log(`[STUB] cleaned ${buildOut}`);
} catch(_) {}

if (moved === 0) console.log(`[STUB] no artifacts found in ${buildOut}`);
else console.log(`[STUB] build ${fullVer} — ${moved} file(s) copied to dist/`);
