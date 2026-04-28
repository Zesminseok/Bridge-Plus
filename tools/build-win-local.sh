#!/usr/bin/env bash
# Windows 빌드를 ~/.bridge-plus-cache/proj/ (CloudStorage 외부 로컬) 에서 진행.
#
# Dropbox CloudStorage 경로는 매 read 마다 동기화 레이어 통과 → 빌드 매우 느림 + 종종 ERR_ELECTRON_BUILDER_CANNOT_EXECUTE.
# 해결: 로컬 캐시 디렉토리에 source/node_modules 를 rsync (incremental) → electron-builder 가 그 안에서 실행 → 결과 .exe 만 프로젝트 dist/ 로 복사.
#
# 첫 실행: node_modules ~676MB 읽기 (CloudStorage materialization) — 느릴 수 있음.
# 두 번째부터: rsync incremental — 변경 파일만 전송, 빠름.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$HOME/.bridge-plus-cache/proj"
OUT="/tmp/bridge-plus-build"

echo "[build-local] SRC = $SRC"
echo "[build-local] CACHE = $CACHE (persistent)"
echo "[build-local] OUT = $OUT"

mkdir -p "$CACHE"

# 1) 소스 파일 + node_modules → 캐시로 incremental rsync.
#    -a: archive (perms/timestamps), --delete: 캐시에만 있는 파일 정리
#    제외: dist/, .git/, graphify-out/, *.dmg, *.exe (출력물), .DS_Store
echo "[build-local] sync source → cache (incremental)..."
rsync -a --delete \
  --exclude='dist/' \
  --exclude='.git/' \
  --exclude='graphify-out/' \
  --exclude='node_modules/' \
  --exclude='*.dmg' --exclude='*.exe' --exclude='*.zip' \
  --exclude='.DS_Store' --exclude='*.log' \
  --exclude='docs/design-proposals/' \
  "$SRC/" "$CACHE/"

# node_modules 는 별도 sync (큰 용량, 변경 적음, --delete 로 stale 모듈 정리)
echo "[build-local] sync node_modules → cache (incremental, 첫 실행은 느림)..."
rsync -a --delete \
  --exclude='.cache/' \
  "$SRC/node_modules/" "$CACHE/node_modules/"

# 2) 빌드 실행 (캐시 디렉토리 = cwd, 출력 = /tmp)
echo "[build-local] running electron-builder from $CACHE..."
rm -rf "$OUT"
cd "$CACHE"
"$CACHE/node_modules/.bin/electron-builder" --win --x64 \
  --config.directories.output="$OUT"

# 3) 결과 .exe 만 프로젝트 dist/ 로 복사 (rename-stub 이 .build-number 증가 + prune 처리)
echo "[build-local] copy result → project dist/..."
cd "$SRC"
node tools/rename-stub.js

echo "[build-local] done."
