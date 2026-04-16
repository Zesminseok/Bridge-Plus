# Changelog

## v0.8.0 — 2026-04-17

### DJM-900NXS2 믹서 데이터 완전 파싱 + TCNet VU 미터

#### DJM 0x39 패킷 파싱 개선
- **EQ 바이트 오프셋 확정** (라이브 물리 테스트 기반)
  - TRIM: byte+1, COLOR/Filter: byte+2, HI: byte+3, MID: byte+4, LOW: byte+6, FADER: byte+11
  - HI↔MID 스왑 수정, COLOR 오프셋 +7→+2 수정
- **글로벌 파라미터 오프셋 확정** (pcap 분석)
  - xfader: gBase+75, masterLvl: gBase+59, boothLvl: gBase+94, hpLevel: gBase+71
- **전체 패킷 바이트 변화 추적 로그** — 미분류 바이트 발견용 ★NEW 표시

#### 믹서 UI 노브 아크 수정
- **EQ 노브** (HI/MID/LOW): 12시 기준 Boost=파란 호, Cut=빨간 호
- **레벨 노브** (TRIM, COLOR, MASTER): 7시(-∞)에서 현재 위치까지 회색 호
- **덱 EQ 아크**: `<circle>` dasharray → `<path>` 극좌표 방식으로 교체, 믹서와 동일 렌더링

#### TCNet Mixer Data (DataType 150) 수신 파싱
- **채널 Audio Level** (CH+1, 0-255): 음악에 따라 변동하는 실시간 VU 소스
- **Master Audio Level** (byte 61): 마스터 VU LED 점등
- **CUE A/B** (CH+11/12): 채널별 CUE 버튼 하이라이트
- **Crossfader Assign** (CH+13): A/THRU/B 배지 실시간 표시
- `onTCMixerVU` 콜백 → `bridge:tcmixervu` IPC → renderer

#### 성능 개선
- 상태바 TX 카운터, ARENA/UP 등 갱신 주기: 60fps → 3초
- TCNet 메뉴 통계 패널 갱신: 즉시 → 3초 디바운스

---

## v0.7.0 — 2025-04-06

### BRIDGE+ Onyx Studio 디자인 시스템 리뉴얼

- **디자인 시스템 전면 교체** — "BRIDGE+ Onyx Studio" (Stitch MCP로 생성)
  - Creative North Star: "The Tactile Command Center"
  - 4개 화면 디자인: LINK, PRO DJ LINK, TCNet, SETTINGS
- **컬러 팔레트** — Tonal layering: Surface (#111318) → Lowest (#0c0e12) → High (#282a2e)
  - Primary Green: #5af0b3 / #34d399
  - Secondary Blue: #a4c9ff / #0267b8
  - Tertiary Gold: #ffd16d / #ecb210
- **타이포그래피** — Plus Jakarta Sans (UI) + Space Grotesk (라벨) + DM Mono (데이터)
- **No-Border 디자인** — 1px 보더 대신 Tonal shift로 영역 구분
- **Ambient Glow** — 활성 요소에 box-shadow 기반 발광 효과
- **Glassmorphism** — 플로팅 요소에 backdrop-filter + 반투명 배경
- **CUE/PLAY 버튼** — CDJ-3000 스타일 gradient + glow 업그레이드
- **브랜딩 변경** — Bridge Clone → BRIDGE+ (Pro DJ Link Bridge Plus)
- **패키지명 변경** — bridge-clone → pro-dj-link-bridge-plus
- **Status Bar** — 그리드 → 필 뱃지 스타일로 변경
- **Output Layer 카드** — 좌측 컬러 보더 + 큰 타임코드 표시
- **Mode Toggle** — 슬라이더 스타일 토글 버튼
- **Section 라벨** — Space Grotesk uppercase + letter-spacing

## v0.6.0 — 2025-04-05

### CDJ 웨이브폼 프리뷰 + 앨범아트 수신

- **CDJ-3000 컬러 웨이브폼 프리뷰** — 패킷 타입 0x56/0x25 파싱, 세그먼트 재조립, 컬러 니블 → RGB 매핑
- **CDJ-3000 모노 웨이브폼 프리뷰** — 0x56/0x02 파싱
- **dbserver 앨범아트 클라이언트** — TCP 12523 포트로 CDJ에서 JPEG 아트워크 요청
- **자동 앨범아트 요청** — HW 모드에서 트랙 변경 감지 시 자동으로 CDJ에 아트워크 요청
- **IPC 채널 추가** — `bridge:wfpreview`, `bridge:albumart`, `bridge:requestArtwork`

### UI 개선

- **미래 웨이브폼 밝기 증가** — 오버뷰: dimF .32→.55, 줌: dimF .40→.45
- **KEY/BPM 텍스트** — 폰트 크기 증가 (KEY 13px, BPM 12px bold), 완전 불투명
- **줌 버튼 세로 배치** — 웨이브폼 상단 가림 방지
- **플레이헤드 위치 설정** — 중앙/좌측(25%) 선택 가능 (설정 메뉴)
- **앨범아트 구조 개선** — div 래퍼로 변경, ⏏ 이젝트 오버레이 정상 동작
- **.gitignore** — 민감 파일 패턴 추가 (.env, *.pem, *.key 등)

## v0.5.0 — 2025-04-05

### 초기 릴리스

- **Pro DJ Link 수신** — CDJ 플레이어 상태 (재생/일시정지/큐), BPM, 피치, 비트 위치 파싱
- **DJM 페이더/미터** — 4채널 페이더 값 및 VU 미터 수신
- **TCNet 브릿지** — 최대 4레이어 타임코드를 Resolume Arena로 전송
- **Art-Net Timecode** — SMPTE 타임코드 UDP 브로드캐스트 (24/25/29.97/30fps)
- **LTC 오디오 출력** — Web Audio API + AudioWorklet 기반 리니어 타임코드 생성
- **MIDI 출력** — MIDI Clock, MTC (MIDI Timecode), CC 메시지
- **Virtual Deck** — 로컬 MP3 로드, ID3v2 태그 파싱 (제목/아티스트/앨범아트/키)
- **RGB 웨이브폼 분석** — IIR 밴드스플릿 필터 (200Hz/3kHz 크로스오버)
- **웨이브폼 컬러 프리셋** — BLUE (모노톤), RGB (저=R 중=G 고=B), 3BAND (저=청 중=앰버 고=백)
- **에너지 기반 웨이브폼 높이** — RMS 에너지 + 감마 보정으로 자연스러운 표현
- **오실로스코프 스타일 렌더링** — 가장자리 밝고 중심부 어두운 그라디언트 필
- **비트 그리드 오버레이** — 마디(1~4) 표시, 다운비트 강조
- **BAR.BEAT 카운터** — 플레이헤드 센터 상단에 실시간 표시
- **KEY / BPM·피치 오버레이** — 웨이브폼 우상단/우하단 캔버스 박스
- **플레이헤드 위치 설정** — 중앙 / 좌측(25%) 선택 가능
- **줌 컨트롤** — 세로 배치 (-/RST/+), 2초~32초 범위
- **Virtual / Hardware 모드** — 글로벌 모드 전환, 슬롯 충돌 방지
- **앨범아트** — ID3 APIC 태그에서 추출, 마우스 오버 시 ⏏ 이젝트 오버레이
- **비트 페이저** — 4세그먼트 비트 시각화 (Scroll / Blink 모드)
- **오버뷰 웨이브폼** — 전체 트랙 미니맵, 현재 위치 인디케이터
- **UI** — 다크 테마, DM Sans/DM Mono 폰트, 반응형 2/3열 덱 레이아웃
