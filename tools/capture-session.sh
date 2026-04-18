#!/usr/bin/env bash
# Pro DJ Link + TCNet + Arena 전체 트래픽 캡쳐 (macOS 전용)
#
# 이 스크립트는 두 개의 pcap을 동시 생성합니다:
#   1) $OUT_NIC  — 실제 USB 이더넷 NIC (PDJL 브로드캐스트, DJM/CDJ 트래픽)
#   2) $OUT_LO   — lo0 loopback (Arena ↔ Bridge 같은 머신일 때 unicast 전부 여기로 감)
#
# 사용법:
#   ./tools/capture-session.sh [interface_name] [session_label]
#
# 예시:
#   ./tools/capture-session.sh en4 session1
#   → /tmp/pdjl_session1_nic.pcapng + /tmp/pdjl_session1_lo.pcapng
#
# 중단: Ctrl+C 한 번
#
set -e

IFACE="${1:-}"
LABEL="${2:-$(date +%Y%m%d_%H%M%S)}"
OUTDIR="${OUTDIR:-$HOME/Desktop}"
OUT_NIC="$OUTDIR/pdjl_${LABEL}_nic.pcapng"
OUT_LO="$OUTDIR/pdjl_${LABEL}_lo.pcapng"

# 자동 NIC 감지: 169.254.x.x link-local이 있는 인터페이스
if [[ -z "$IFACE" ]]; then
  IFACE=$(ifconfig | awk '/^[a-z]/{dev=$1} /inet 169\.254\./{sub(/:$/,"",dev); print dev; exit}')
  if [[ -z "$IFACE" ]]; then
    echo "❌ 169.254.x.x IP가 붙은 인터페이스를 자동 감지 못했습니다."
    echo "   USB 이더넷이 CDJ/DJM에 연결되어 있는지 확인하고 인터페이스 이름을 인자로 넘기세요."
    echo "   예: ./tools/capture-session.sh en5"
    ifconfig | grep -E "^[a-z]+[0-9]+:" | awk -F: '{print "   사용 가능:", $1}'
    exit 1
  fi
  echo "✅ 자동 감지된 NIC: $IFACE"
fi

# tshark 존재 확인
if ! command -v tshark >/dev/null; then
  echo "❌ tshark 필요. brew install wireshark"
  exit 1
fi

# ── 캡쳐 필터 ──────────────────────────────────────
# PDJL: 50000(keepalive/claim) 50001(beat/onair) 50002(status)
# TCNet: 60000(bc) 60001(time) 60002(data) + unicast(65000-65535)
# dbserver: 1050-1200 (CDJ 메타데이터 TCP)
# mdns: 5353 (CDJ Link 디스커버리 보조)
FILTER='udp and (portrange 50000-50002 or portrange 60000-60002 or portrange 65000-65535) or (tcp and portrange 1050-1200) or udp port 5353'

echo "───────────────────────────────────────────"
echo "  NIC:   $IFACE → $OUT_NIC"
echo "  lo0:   → $OUT_LO"
echo "  필터:  $FILTER"
echo "  중단:  Ctrl+C"
echo "───────────────────────────────────────────"

mkdir -p "$OUTDIR"

# 두 개 tshark 병렬 실행 (sudo 필요)
sudo -v  # 패스워드 선입력

# 파일 회전 방지를 위해 충분히 큰 단일 파일로 기록 (-b duration:0 = 비활성)
sudo tshark -i "$IFACE" -f "$FILTER" -w "$OUT_NIC" -q &
PID_NIC=$!
sudo tshark -i lo0       -f "$FILTER" -w "$OUT_LO"  -q &
PID_LO=$!

cleanup(){
  echo ""
  echo "⏹  캡쳐 중단 중..."
  sudo kill -INT $PID_NIC $PID_LO 2>/dev/null || true
  wait $PID_NIC 2>/dev/null || true
  wait $PID_LO 2>/dev/null || true
  echo "✅ 저장 완료:"
  ls -lh "$OUT_NIC" "$OUT_LO" 2>/dev/null
  echo ""
  echo "분석: ./tools/capture-analyze.sh $OUT_NIC $OUT_LO"
}
trap cleanup INT TERM

echo "🔴 녹화 중... (Bridge + Arena + CDJ + DJM 순서로 켜세요)"
wait
