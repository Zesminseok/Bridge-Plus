#!/usr/bin/env bash
# 빌드 작업을 /tmp 에서 진행하고 최종 .exe 만 프로젝트 dist/ 로 복사.
# Dropbox 폴더 안의 node_modules/source 를 직접 읽지 않으므로
# 빌드 중 Dropbox 동기화로 인한 ERR_ELECTRON_BUILDER_CANNOT_EXECUTE 회피.
#
# APFS clone (cp -cR) 사용 → CoW, 데이터 복사 거의 0.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="/tmp/bridge-plus-work"
OUT="/tmp/bridge-plus-build"

echo "[build-tmp] SRC = $SRC"
echo "[build-tmp] WORK = $WORK (APFS clone)"
echo "[build-tmp] OUT  = $OUT"

# 이전 작업 디렉토리 정리
rm -rf "$WORK" "$OUT"
mkdir -p "$WORK"

# 빌드에 필요한 항목만 APFS 클론으로 복사 (CoW, 디스크 사용량 거의 0)
cd "$SRC"
ITEMS=(
  main.js bridge-core.js preload.js license-service.js
  renderer main pdjl tcnet
  default-album-artwork.png i18n.js
  package.json package-lock.json node_modules
)
for item in "${ITEMS[@]}"; do
  if [ -e "$item" ]; then
    cp -cR "$item" "$WORK/" 2>/dev/null || cp -R "$item" "$WORK/"
  fi
done
[ -d assets ] && (cp -cR assets "$WORK/" 2>/dev/null || cp -R assets "$WORK/")

# Electron Builder 실행 (작업 디렉토리 = /tmp/bridge-plus-work, 출력 = /tmp/bridge-plus-build)
cd "$WORK"
"$WORK/node_modules/.bin/electron-builder" --win --x64 \
  --config.directories.output="$OUT"

# 최종 .exe 만 프로젝트 dist/ 로 복사 + 빌드 카운터 증가
cd "$SRC"
node tools/rename-stub.js

# 작업 디렉토리 정리
rm -rf "$WORK"
echo "[build-tmp] done"
