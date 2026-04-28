#!/bin/bash
# BRIDGE+ / Pro DJ Link Bridge / TCNet 잔여 프로세스 + 포트 정리 (macOS)
# 사용법:  bash tools/cleanup-mac.sh
#         또는: chmod +x tools/cleanup-mac.sh && ./tools/cleanup-mac.sh

set +e
echo "═══ BRIDGE+ / TCNet 정리 시작 ═══"

PORTS_TCNET="60000 60001 60002"
PORTS_PDJL="50000 50001 50002 50003 50004 50005 50006 50007"
PORTS_DBSRV="12523 12524"
ALL_PORTS="$PORTS_TCNET $PORTS_PDJL $PORTS_DBSRV"

# ───────────────────────────────────────────────
# 1) 이름으로 프로세스 종료
# ───────────────────────────────────────────────
echo ""
echo "[1/3] 관련 프로세스 종료..."
SELF_PID=$$
PARENT_PID=$PPID
# Pioneer 공식 + 우리 앱 모두 커버. 단, generic "Bridge" 단어는 시스템 프로세스
# (XProtectBridgeService 등) 와 겹치므로 정확한 시퀀스만 매칭.
for pat in "BRIDGE\+" "Pro DJ Link Bridge" "ProDJLinkBridge" "PDJLBridge" "Pioneer Pro DJ Link" "Electron.*BRIDGE\+"; do
  pids=$(pgrep -fi "$pat" 2>/dev/null)
  for pid in $pids; do
    [ "$pid" = "$SELF_PID" ] && continue
    [ "$pid" = "$PARENT_PID" ] && continue
    [ "$pid" = "1" ] && continue
    pname=$(ps -p $pid -o comm= 2>/dev/null | head -c 60)
    echo "  ▸ PID $pid ($pname) — kill (pat: $pat)"
    kill -9 $pid 2>/dev/null
  done
done

# ───────────────────────────────────────────────
# 2) 포트 점유 프로세스 종료
# ───────────────────────────────────────────────
echo ""
echo "[2/3] 포트 점유 프로세스 종료... (Arena/Resolume 등은 보호)"
SAFE_RE='Arena|Resolume|Avenue|Wirecast|VDMX|Madmapper|TouchDesigner|Notch|grandMA|Avolites|Obsidian|Smode|Disguise|Hippotizer|Watchout'
for port in $ALL_PORTS; do
  pids=$(lsof -nP -iUDP:$port -t 2>/dev/null; lsof -nP -iTCP:$port -t 2>/dev/null)
  pids=$(echo "$pids" | sort -u | tr '\n' ' ')
  for pid in $pids; do
    [ -z "$pid" ] && continue
    [ "$pid" = "$SELF_PID" ] && continue
    [ "$pid" = "$PARENT_PID" ] && continue
    pname=$(ps -p $pid -o comm=,args= 2>/dev/null | head -c 200)
    if echo "$pname" | grep -Eqi "$SAFE_RE"; then
      echo "  ▸ port $port PID $pid ($pname) — 보호됨, skip"
      continue
    fi
    echo "  ▸ port $port PID $pid — kill"
    kill -9 $pid 2>/dev/null
  done
done

# ───────────────────────────────────────────────
# 3) 결과 확인
# ───────────────────────────────────────────────
sleep 0.5
echo ""
echo "[3/3] 정리 후 점유 확인..."
remaining=0
for port in $ALL_PORTS; do
  hit=$(lsof -nP -iUDP:$port -iTCP:$port 2>/dev/null | grep -v '^COMMAND')
  if [ -n "$hit" ]; then
    echo "  ⚠ port $port 아직 점유:"
    echo "$hit" | sed 's/^/      /'
    remaining=$((remaining+1))
  fi
done

echo ""
if [ "$remaining" = "0" ]; then
  echo "✅ 정리 완료 — 모든 BRIDGE+/TCNet/PDJL 포트 해제됨"
else
  echo "⚠️ $remaining 개 포트가 여전히 점유 중. 위 프로세스 수동 확인 필요."
fi
echo "═════════════════════════════════"
