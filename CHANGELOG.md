# Changelog

All notable changes to BRIDGE+ are documented in this file.

The version history below begins at **1.0.0-beta.0** — earlier internal builds are
not archived. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 1.2.1 — 2026-07-03

### English

- Improved CDJ-2000NXS2 tiny loop display in the main app and Web Viewer.
- Improved CDJ-2000NXS2 jog, forward spin, and backspin playhead response during active loops.
- Kept hardware TCNet timing sourced from raw PRO DJ LINK state, separate from UI-rendered playhead values.

### 한국어

- 프로그램과 Web Viewer에서 CDJ-2000NXS2 아주 짧은 루프 구간 표시 개선
- 루프 중 CDJ-2000NXS2 조그, 포워드 스핀, 백스핀 플레이헤드 반응 개선
- 하드웨어 TCNet 타이밍은 UI 표시값이 아닌 원본 PRO DJ LINK 상태 기준으로 유지

## 1.2.0 — 2026-07-02

### English

- Improved CDJ-2000NXS2 cue, hot cue, jog, vinyl, loop, and track-load transport stability.
- Reduced UI stalls during track loading and waveform refresh.
- Merged PDJL and TCNet connection views into a cleaner NET / 연결 page.
- Refined mixer controls, hardware link status, Web Viewer playhead, and waveform display behavior.
- Added model routing for CDJ-1500X / CDJ-3000X and expanded DJM / euphonia mixer profiles.

### 한국어

- CDJ-2000NXS2 큐, 핫큐, 조그, 바이닐, 루프, 곡 로드 중 위치 추적 안정화
- 곡 로드와 웨이브폼 갱신 중 UI 끊김 완화
- PDJL / TCNet 연결 상태를 NET / 연결 메뉴로 통합
- 믹서 컨트롤, 하드웨어 연결 상태, Web Viewer 플레이헤드와 웨이브폼 표시 개선
- CDJ-1500X / CDJ-3000X 모델 분기와 DJM / euphonia 믹서 프로필 추가

## 1.1.9 — 2026-06-14

### English

- Added
  - Improved CDJ-2000NXS2 transport handling for cue, hot cue, memory cue, jog, and sub-beat loop workflows.

- Fixed
  - Fixed stale cue anchoring on short CDJ-2000NXS2 samples.
  - Improved mixer/player discovery on variable IP network setups.
  - Stabilized TCNet timing output independently from UI frame-rate settings.
  - Reduced track-load metadata and waveform refresh stalls.

### 한국어

- 기능 추가
  - CDJ-2000NXS2 큐, 핫큐, 메모리 큐, 조그, 1비트 미만 루프 처리 개선

- 버그 픽스
  - 짧은 CDJ-2000NXS2 샘플에서 이전 큐 위치를 잘못 기준점으로 잡는 문제 수정
  - IP가 바뀌는 네트워크 환경에서 믹서/플레이어 감지 안정화
  - UI 프레임레이트 설정과 별개로 TCNet 타이밍 출력 안정화
  - 곡 로드 중 메타데이터와 웨이브폼 갱신 시 버벅임 완화

## 1.1.8 — 2026-06-07

### English

- Added
  - Improved CDJ-2000NXS2 transport handling for cue, hot cue, jog, and short loop playback.

- Fixed
  - Fixed short CDJ-2000NXS2 loop handoff when loop-start packets arrive before loop-end packets.
  - Reduced CDJ-2000NXS2 cue, hot cue, and platter-position jumps in TCNet output.

### 한국어

- 기능 추가
  - CDJ-2000NXS2 큐, 핫큐, 조그, 짧은 루프 재생 처리 개선

- 버그 픽스
  - loop-start 패킷이 loop-end보다 먼저 들어오는 짧은 CDJ-2000NXS2 루프 처리 수정
  - CDJ-2000NXS2 큐, 핫큐, 플래터 조작 중 TCNet 위치 튐 완화

## 1.1.7 — 2026-05-24

### English

- Added
  - Improved waveform marker display in Web Viewer and the main app.

- Fixed
  - Fixed internal beat phasor theme-color blending across main app layouts.
  - Fixed blurry or broken text in some Windows UI areas after waveform rendering.
  - Smoothed CDJ-2000NXS2 playhead rendering in Web Viewer.
  - Fixed the main detail waveform playhead appearing dimmed by played-region or marker caches.
  - Fixed cue marker vertical-line alignment and opacity in the main app and Web Viewer.
  - Improved CDJ-2000NXS2 cue, hot cue, and jog wheel stability.

### 한국어

- 기능 추가
  - Web Viewer와 프로그램 웨이브폼 마커 표시 개선

- 버그 픽스
  - 프로그램 내부 비트페이저가 모든 레이아웃에서 테마색 블렌딩을 반영하도록 수정
  - Windows에서 웨이브폼 렌더링 후 일부 텍스트가 흐려지거나 깨지는 문제 수정
  - Web Viewer의 CDJ-2000NXS2 플레이헤드 표시가 끊겨 보이는 문제 수정
  - 프로그램 디테일 웨이브폼 플레이헤드가 과거 재생영역/마커 캐시에 묻혀 어둡게 보이는 문제 수정
  - 프로그램/웹뷰 큐 마커 세로선 정렬 및 불투명도 수정
  - CDJ-2000NXS2 큐, 핫큐, 조그휠 동작 안정화

## 1.1.6 — 2026-05-18

- 기능 추가
  - Web Viewer 추가
  - 하드웨어 웨이브폼 테마 및 표시 옵션 개선

- 버그 픽스
  - Web Viewer 웨이브폼, 큐 마커, 진행 표시 오류 수정
  - 프로그램 프리뷰/디테일 웨이브폼 표시 오류 수정
  - CDJ-2000NXS2 / CDJ-3000 메타데이터, 큐, 비트 그리드, 웨이브폼 수신 안정화
  - macOS / Windows 네트워크 인터페이스 변경 후 플레이어/믹서 연결 오류 수정

## 1.1.5 — 2026-05-17

- 기능 추가
  - Web Viewer 추가
  - CDJ-2000NXS2 / CDJ-3000 하드웨어 웨이브폼 지원 개선

- 버그 픽스
  - Web Viewer 웨이브폼 표시 오류 수정
  - Web Viewer 자동 시작 오류 수정
  - CDJ-2000NXS2 / CDJ-3000 메타데이터, 큐, 비트 그리드, 웨이브폼 수신 안정화
  - Windows 네트워크 인터페이스 변경 후 플레이어/믹서 연결 오류 수정

## 1.0.9.1 — 2026-05-08

- HW overview waveform 의 저레벨 envelope 를 오버뷰 전용으로 보정해 빈 구간처럼 보이는 느낌 완화
- Overview 하단 진행바를 흰색으로 변경하고, 종료 30초 전부터 현재 진행 구간과 남은 구간이 번갈아 표시되도록 수정
- Detail/Overview loop overlay 가 비트 그리드와 하단 진행바를 침범하지 않도록 waveform 영역 안으로 제한
- Overview loop 구간 시작/끝에 세로 경계선을 추가해 루프 범위를 더 명확하게 표시
- Release assets: `BRIDGE+-1.0.9.1-win-x64.exe`, `BRIDGE+-1.0.9.1-mac-arm64.dmg`, `BRIDGE+-1.0.9.1-mac-x64.dmg`

## 1.0.9 — 2026-05-08

- 창 숨김/전체화면 전환 후에도 TCNet/타임코드 송신이 렌더러 FPS 절감 상태에 묶이지 않도록 idle downshift 동작 제거
- HW detail waveform bar counter 표시를 10진 소수 대신 1bar=4beat 표기 기준으로 보정
- 남은 memory cue bar counter 는 `-8.4` → `-8.3` → `-8.2` → `-8.1` 형식으로 표시
- Release assets: `BRIDGE+-1.0.9-win-x64.exe`, `BRIDGE+-1.0.9-mac-arm64.dmg`, `BRIDGE+-1.0.9-mac-x64.dmg`

## 1.0.8 — 2026-05-07

- BPM 출력은 당분간 OSC 전용으로 제한하고 Link 계열 UI/옵션/loader를 비활성화
- 본체 저장소에서 비활성화된 외부 동기화 모듈과 관련 빌드 단계를 제거
- README / NOTICE 에서 비활성화된 외부 sync 모듈 설치 안내와 고지를 제거
- OSC BPM 출력은 BPM 변화가 있을 때만 송신하도록 유지해 불필요한 반복 패킷을 줄임
- Release assets: `BRIDGE+-1.0.8-win-x64-portable.exe`, `BRIDGE+-1.0.8-mac-arm64.dmg`, `BRIDGE+-1.0.8-mac-x64.dmg`

## 1.0.7 — 2026-05-06

- Settings 화면을 별도 고정폭 창 기준으로 정리하고 언어/라이선스/웨이브폼/출력 설정 배치를 다듬음
- 설정 항목과 옵션 라벨의 다국어 번역 범위를 확장하고 불필요한 waveform sharpness 설정 제거
- BPM 출력에서 OSC host/broadcast 설정 UI 개선
- HW overview waveform 에 좌우 패딩, 하단 진행바, 1분 마커를 추가하고 재생 완료 영역 dimming 제거
- HW detail waveform grid 옵션을 4비트 / 1비트 / 세로줄 모드로 정리하고 grid 두께와 길이를 조정
- HW detail waveform 색상 경로를 overview 와 더 가깝게 맞추고 bar counter 위치/표시 기준 보정
- Windows 글꼴 렌더링과 앱 아이콘/스플래시 아이콘 표시를 정리
- OSC/Art-Net 포트 충돌 방지와 main process IPC 입력 검증 강화
- cleanup zombies 기능이 BRIDGE+ 계열 프로세스만 정리하도록 제한해 다른 앱 강제 종료 위험 축소
- Release assets: `BRIDGE+-1.0.7-win-x64-portable.exe`, `BRIDGE+-1.0.7-mac-arm64.dmg`, `BRIDGE+-1.0.7-mac-x64.dmg`

## 1.0.6 — 2026-05-04

- BPM 메뉴에 OSC BPM 출력 추가
- OSC 출력 IP/Port 설정과 BPM Link 페이지의 다중 OSC 주소 편집 추가
- BPM Link phase 정렬을 선택 BPM 소스 기준으로 보정
- macOS DJM mixer subscribe/keepalive identity 안정화
- HW waveform theme rendering and marker/grid cleanup
- HW detail waveform strip cache 안정화: 10초 주기/다른 덱 로드 시 재렌더로 모양이 바뀌던 문제 수정
- HW detail waveform strip 경로에서 사라진 위/아래 마진 복원
- HW detail waveform 색상 경로를 overview waveform 과 통일
- 2000NXS2 overview playhead/TCNet 출력이 스무딩된 위치를 사용하도록 수정
- 2000NXS2 loop mode 에서 정밀 MS 없는 모델만 루프 구간 보간 적용
- Release assets: `BRIDGE+-1.0.6-win-x64-portable.exe`, `BRIDGE+-1.0.6-mac-arm64.dmg`, `BRIDGE+-1.0.6-mac-x64.dmg`
- External implementation/capture reference comments cleaned from source

## 1.0.5 — 2026-05-03

- NXS2 jog forward EMA blend (천천히/빨리 조그 모두 부드럽게 추적)
- HW PWV7/3band 색을 virtual rgbTraceColor 와 통일 (vivid spectrum)
- NXS2 loop ms 공식 fix (역방향 → 정상) + status loop fields 우선
- NXS2 loop wrap 정확한 boundary 사용 (4-beat default 의존 제거)

## 1.0.4 — 2026-05-03

- macOS Pro DJ Link bridge 분기 통일 (mac/win 동일 byte 셋, 0x57 src port 50001)
- NXS2 jog forward 튐 보정 (snap threshold ±1500 → ±150 대칭)
- 짧은 음원 트랙 변경 시 stale preview waveform/길이 잔존 fix

## 1.0.3 — 2026-05-03

- NXS2 cue→play 첫 비트 점프 보정 (`_cuePosMs` anchor pre-set)
- 1.0.0.12 timecode/loop 동작 복원 + NXS2 분기 가드 강화
- overview waveform shader 흰색 playhead 제거 (overlay 빨강 단일화)

## 1.0.2 — 2026-05-02

- macOS Pro DJ Link bridge byte-perfect (DJM 호환성 개선)
- CDJ-3000 beat grid + color waveform live-push 파싱
- HW 덱 PCM-스타일 웨이브폼 (A+C 하이브리드)
- 클린 semver 적용

## 1.0.0.12 — 2026-05-01

30-day demo evaluation build.

### Changed

- **macOS Pro DJ Link bridge** — update bridge identity, notify, claim, and join timing for reliable DJM mixer data delivery on macOS.
- **HW deck PCM-style waveform (A+C hybrid)** — hardware decks now render the rekordbox color/height waveform through the same oscilloscope path used by virtual decks, using `wfDetailNxs2` peak data when available and per-bin track colors directly.
- **Build artifact naming** — `1.0.0.12` artifact names.
- **Windows distribution** — added portable `.exe` target alongside the NSIS installer.

## 1.0.0.11 — 2026-05-01

30-day demo evaluation build.

### Changed

- **macOS DJM subscribe compatibility** — send bridge notify packets from the bound DJM aux source port (`50006`) for stable mixer subscription.
- **CDJ-2000NXS2 timecode stability** — stop treating NXS2 `trackBeats`/`positionFraction` status bytes as duration/position when those fields are not valid, and keep inferred loop playback inside the active loop window.
- **Observatory hardware deck visibility** — brighten VU meter, fader, and status indicators without dimming loaded hardware decks.
- **Build artifact naming** — `1.0.0.11` artifact names.

## 1.0.0.10 — 2026-04-29

30-day demo evaluation build. Full feature set, time-limited from first run.

### Changed

- **데모 기간 30일** — 첫 실행일부터 30일간 테스트 가능
- **버전 명명** — `-demo` 접미사 제거, `1.0.0.10` 형식으로 통일 (semver `1.0.0` + 빌드 카운터 `10`)
- **Desktop 디버그 로그 disable** — production 빌드에서 `~/Desktop/bridge-debug.log` 생성 시도 제거 (macOS 데스크톱 폴더 권한 프롬프트 회피)

### New / Improved

- **앱 아이콘** — B+ 마크 적용 (DMG / EXE / 윈도우 / Dock / 스플래시)
- **macOS Ad-hoc 서명** — Gatekeeper "손상됨" 메시지 회피 (우클릭 → 열기 1회로 통과)
- **전체 i18n 커버리지** — 6 언어 (en/ko/ja/es/de/fr), 사이드바 / 설정 / 히스토리 / 믹서 / 데크 placeholder / 스플래시 / alert 메시지 모두 포함
- **`renderSettings` 후 자동 번역 재적용** — i18n 변경 시 동적으로 렌더되는 마크업도 즉시 번역
- **DECKS Object 순회 critical fix** — BPM force-write 가 0번 실행되던 버그 수정 (테마 전환 시 BPM 사라짐 해결)
- **Card 덱 배경 통일** — `--bg-lowest` → `--bg2` (Tower / Row 와 일관)
- **Observatory 자연 높이** — `grid-auto-rows: min-content` 로 컨텐츠 기반 자동 높이
- **Observatory 글로벌 UI 통일** — 사이드바 / 헤더 / 설정 패널은 모든 layout 공통
- **Tower 빈 덱 + 버튼** — 자연스러운 dashed border + "+" 아이콘 + 텍스트
- **macOS / Windows 빌드** — DMG / Windows installer 빌드 구성

### Build artifacts

- `BRIDGE+-1.0.0.10-mac-x64.dmg` / `-mac-arm64.dmg` (Intel / Apple Silicon)
- `.zip` 버전 동시 제공
- `BRIDGE+-1.0.0.10-win-x64.exe` (Windows installer)

---

## 1.0.0-beta.0 — 2026-04-29

First public beta release.

### Highlights

- **Pro DJ Link 호환 수신** — CDJ/DJM 상태, 비트, 위치, 트랙 정보, 페이더, EQ 실시간 모니터링
- **TCNet 출력** — Resolume Arena/Wire 동기화 (최대 6 레이어, 양방향 메타데이터/메트릭스)
- **Art-Net Timecode** — SMPTE 타임코드 브로드캐스트
- **Linear Timecode (LTC)** — AudioWorklet 기반 오디오 출력
- **MIDI Clock / MTC** — DAW · 외부 장비 동기
- **Virtual Deck** — 6덱 로컬 음원 재생 (MP3 · WAV · FLAC · AAC · OGG · M4A · AIFF)
- **HW 웨이브폼** — CDJ-3000 컬러 프리뷰 / 디테일 / 3-Band NXS2 PWV7
- **dbserver 메타데이터** — 트랙 정보, 큐 포인트, 비트 그리드, 앨범아트, 곡 구조 (PSSI)
- **모듈화 아키텍처** — `bridge/`, `pdjl/`, `tcnet/`, `main/` 6개 책임 분리 모듈

### Performance

- 자동 idle 감지 — 창이 가려질 때 1Hz timer 로 다운시프트, 보일 때 디스플레이 refresh 네이티브
- 웨이브폼: ProMotion 120Hz / 외부 144·240Hz 자동 sync
- TCNet UDP hot path 최적화 — buffer slice 회피, scratch 배열 재사용
- dbserver TCP session pool — IP/spoofPlayer 별 mutex serialize, 30s idle TTL
- 웨이브폼 overlay OffscreenCanvas 캐시 — 60fps × 4덱 redraw 방지
- IPC 페이로드 — Uint8Array 패킹으로 직렬화 비용 감소

### Security

- TCNet 노드 자동 등록 cap (32) + LRU eviction — 인증 없는 UDP 입력 DoS 방어
- dbserver 응답 16MB cap, 절대 timeout 5–8s
- ANLZ tag bounds 검사 (PWV7 attacker-controlled length 차단)
- IPC 입력 검증 (artnet IP/port/universe, layer/slot index, base64 art 크기 제한)
- BrowserWindow `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
- web-contents-created 중앙 가드 — window.open / will-navigate / webview preload 차단
- Web Worker postMessage 입력 검증 — channel/sampleRate/length 범위 강제
- 사용자 정의 `bridge-audio://` 프로토콜 path traversal 방어 (realpath + Set membership)

### UI

- Onyx Studio 디자인 — Tonal layering, ambient glow, glassmorphism
- 4개 탭: LINK / PRO DJ LINK / TCNet / SETTINGS
- 3 웨이브폼 테마 — 3 Band rekordbox / RGB rekordbox vivid spectrum / Mono Resolume gradient
- Observatory 4채널 2×2 CRT 인광 레이아웃 추가

### Build

- Electron 33+ / Node.js 18+
- macOS x64/arm64 (DMG·ZIP), Windows x64 (installer)
- npm 패키지 매니저
