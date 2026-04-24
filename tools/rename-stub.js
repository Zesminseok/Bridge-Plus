#!/usr/bin/env node
// 로컬 stub 빌드 (abletonlink 네이티브 없이) 산출물에 -stub 접미사 추가.
// CI 빌드(네이티브)와 파일명 혼동 방지용.
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const v = pkg.version;
const dist = path.resolve(__dirname, '..', 'dist');

const targets = [
  `BRIDGE+ ${v}.exe`,
  `BRIDGE+ Setup ${v}.exe`,
  `BRIDGE+ Setup ${v}.exe.blockmap`,
];

let renamed = 0;
for (const name of targets) {
  const src = path.join(dist, name);
  if (!fs.existsSync(src)) continue;
  const dst = src.replace(`${v}.exe`, `${v}-stub.exe`);
  fs.renameSync(src, dst);
  console.log(`[stub] ${name} → ${path.basename(dst)}`);
  renamed++;
}

if (renamed === 0) console.log('[stub] no Windows artifacts found to rename');
else console.log(`[stub] renamed ${renamed} file(s) with -stub suffix`);
