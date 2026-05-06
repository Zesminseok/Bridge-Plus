# Changelog

All notable changes to BRIDGE+ are documented in this file.

The version history below begins at **1.0.0-beta.0** — earlier internal builds are
not archived. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 1.0.7 — 2026-05-06

Release build — 30-day demo test build.

### New / Improved

- Settings 화면을 별도 고정폭 창 기준으로 정리하고 언어/라이선스/웨이브폼/출력 설정 배치를 다듬음
- 설정 항목과 옵션 라벨의 다국어 번역 범위를 확장하고 불필요한 waveform sharpness 설정 제거
- BPM Link 출력에서 Ableton Link 와 OSC 출력을 독립 선택 가능하도록 분리하고 OSC host/broadcast 설정 UI 개선
- HW overview waveform 에 좌우 패딩, 하단 진행바, 1분 마커를 추가하고 재생 완료 영역 dimming 제거
- HW detail waveform grid 옵션을 4비트 / 1비트 / 세로줄 모드로 정리하고 grid 두께와 길이를 조정
- HW detail waveform 색상 경로를 overview 와 더 가깝게 맞추고 bar counter 위치/표시 기준 보정
- Windows 글꼴 렌더링과 앱 아이콘/스플래시 아이콘 표시를 정리

### Build artifacts

- `BRIDGE+-1.0.7-win-x64-portable.exe`
- `BRIDGE+-1.0.7-mac-arm64.dmg`
- `BRIDGE+-1.0.7-mac-x64.dmg`

## 1.0.6 — 2026-05-04

Release build — 30-day demo test build.

### New / Improved

- macOS DJM mixer subscribe / keepalive identity 안정화
- Windows GitHub Actions native Ableton Link rebuild 경로 유지
- HW waveform theme rendering, marker/grid cleanup, and smoother playhead rendering
- HW detail waveform strip cache 안정화: 10초 주기/다른 덱 로드 시 재렌더로 모양이 바뀌던 문제 수정
- HW detail waveform strip 경로에서 사라진 위/아래 마진 복원
- HW detail waveform 색상 경로를 overview waveform 과 통일
- 2000NXS2 overview playhead/TCNet 출력이 스무딩된 위치를 사용하도록 수정
- 2000NXS2 loop mode 에서 정밀 MS 없는 모델만 루프 구간 보간 적용
- External implementation/capture reference comments cleaned from source

### Build artifacts

- `BRIDGE+-1.0.6-win-x64-portable.exe`
- `BRIDGE+-1.0.6-mac-arm64.dmg`
- `BRIDGE+-1.0.6-mac-x64.dmg`

## 1.0.0-demo.0 — 2026-04-29

Demo build — 30-day evaluation. Full feature set, time-limited from first run.

### New / Improved

- **전체 i18n 커버리지** — 6 언어 (en/ko/ja/es/de/fr), 사이드바 / 설정 / 히스토리 / 믹서 / 데크 placeholder / 스플래시 / alert 메시지 모두 포함
- **`renderSettings` 후 자동 번역 재적용** — i18n 변경 시 동적으로 렌더되는 마크업도 즉시 번역
- **DECKS Object 순회 critical fix** — BPM force-write 가 0번 실행되던 버그 수정 (테마 전환 시 BPM 사라짐 해결)
- **Card 덱 배경 통일** — `--bg-lowest` → `--bg2` (Tower / Row 와 일관)
- **Observatory 자연 높이** — `grid-auto-rows: min-content` 로 컨텐츠 기반 자동 높이
- **Observatory 글로벌 UI 통일** — 사이드바 / 헤더 / 설정 패널은 모든 layout 공통
- **Tower 빈 덱 + 버튼** — 자연스러운 dashed border + "+" 아이콘 + 텍스트
- **macOS / Windows 네이티브 빌드** — `abletonlink` C++ binding 포함

### Build artifacts

- `BRIDGE+-1.0.0.00_demo-mac-x64.dmg` / `-arm64.dmg` (Intel / Apple Silicon)
- `.zip` 버전 동시 제공
- `BRIDGE+-1.0.0.00_demo-win-x64.exe` (Windows portable)

---

## 1.0.0-beta.0 — 2026-04-29

First public beta release.

### Highlights

- **Pro DJ Link 호환 수신** — CDJ/DJM 상태, 비트, 위치, 트랙 정보, 페이더, EQ 실시간 모니터링
- **TCNet 출력** — Resolume Arena/Wire 동기화 (최대 6 레이어, 양방향 메타데이터/메트릭스)
- **Art-Net Timecode** — SMPTE 타임코드 브로드캐스트
- **Linear Timecode (LTC)** — AudioWorklet 기반 오디오 출력
- **MIDI Clock / MTC** — DAW · 외부 장비 동기
- **Ableton Link** — 네이티브 바인딩 (`abletonlink` C++ addon) 으로 무선 BPM/Phase 동기
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
- macOS x64/arm64 (DMG·ZIP), Windows x64 (portable)
- 네이티브 의존성: `abletonlink` (`node-gyp` 빌드 필요)
- npm 패키지 매니저
