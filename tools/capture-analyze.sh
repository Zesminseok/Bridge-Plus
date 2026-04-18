#!/usr/bin/env bash
# 캡쳐된 pcap을 빠르게 점검 — 어떤 TCNet/PDJL 메시지가 얼마나 들어있는지 요약
#
# 사용법:
#   ./tools/capture-analyze.sh <nic.pcapng> [lo.pcapng]
#
set -e
NIC="${1:?사용법: $0 <nic.pcapng> [lo.pcapng]}"
LO="${2:-}"

summarize(){
  local F="$1" LABEL="$2"
  [[ -f "$F" ]] || return
  echo ""
  echo "══════════════════════════════════════════"
  echo "  [$LABEL] $F"
  echo "══════════════════════════════════════════"
  local TOTAL=$(tshark -r "$F" 2>/dev/null | wc -l | tr -d ' ')
  echo "  전체 패킷: $TOTAL"
  echo ""
  echo "  ── PDJL (50000/50001/50002) ──"
  tshark -r "$F" -Y "udp.dstport>=50000 and udp.dstport<=50002" -T fields -e udp.dstport -e udp.length 2>/dev/null \
    | sort | uniq -c | sort -rn | head -15
  echo ""
  echo "  ── TCNet (60000/60001/60002 + 65000-65535) ──"
  tshark -r "$F" -Y "(udp.dstport>=60000 and udp.dstport<=60002) or (udp.dstport>=65000 and udp.dstport<=65535)" \
    -T fields -e udp.dstport -e udp.length 2>/dev/null \
    | sort | uniq -c | sort -rn | head -20
  echo ""
  echo "  ── TCNet 메시지 타입 분포 ──"
  python3 - <<PY
import subprocess
from collections import Counter
r = subprocess.run(['tshark','-r','$F','-Y',
    '(udp.dstport>=60000 and udp.dstport<=60002) or (udp.dstport>=65000 and udp.dstport<=65535)',
    '-T','fields','-e','data.data'], capture_output=True,text=True)
c=Counter()
NAMES={2:'OPTIN',3:'OPTOUT',5:'STATUS',0x14:'META_REQ',30:'APP',0xcc:'ARTWORK(204)',0xc8:'DATA(200)',0xfe:'TIME'}
subtypes=Counter()
for line in r.stdout.strip().split('\n'):
    if not line: continue
    try:
        raw=bytes.fromhex(line)
        if len(raw)<24 or raw[4:7]!=b'TCN': continue
        t=raw[7]; c[t]+=1
        if t==0xc8 and len(raw)>=25:
            subtypes[raw[24]]+=1
    except: pass
for t,cc in sorted(c.items()):
    print(f"    Type {t:3d} ({NAMES.get(t,'?'):12s}): {cc}")
if subtypes:
    DTNAMES={2:'Metrics',4:'Metadata',8:'BeatGrid',12:'Cue',16:'SmallWF',32:'BigWF',128:'Artwork',150:'Mixer'}
    print("    DATA sub-types:")
    for st,cc in sorted(subtypes.items()):
        print(f"      {st:3d} ({DTNAMES.get(st,'?'):10s}): {cc}")
PY
  echo ""
  echo "  ── CDJ/DJM/Bridge 활동 IP ──"
  tshark -r "$F" -Y "udp.dstport>=50000 and udp.dstport<=50002" -T fields -e ip.src 2>/dev/null \
    | sort | uniq -c | sort -rn | head -10
}

summarize "$NIC" "NIC"
[[ -n "$LO" ]] && summarize "$LO" "lo0"

echo ""
echo "══════════════════════════════════════════"
echo "  병합 (선택): mergecap -w merged.pcapng $NIC $LO"
echo "══════════════════════════════════════════"
