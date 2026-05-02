# Changelog

All notable changes to BRIDGE+ are documented in this file.

The version history below begins at **1.0.0-beta.0** — earlier internal builds are
not archived. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
- Ableton Link mini fork (Windows native build 포함)
- 클린 semver 적용

## 1.0.0.12 — 2026-05-01

30-day demo evaluation build.

### Changed

- **macOS Pro DJ Link bridge** — match STC reference packet shapes (`pkt[0x35]=0x20` in 95B keepalive, single 44B `0x55` notify, simplified claim check formula, single-shot hello/claim with STC timing 2×300ms + 11×500ms) for reliable DJM mixer data delivery on macOS.
- **HW deck PCM-style waveform (A+C hybrid)** — hardware decks now render the rekordbox color/height waveform through the same oscilloscope path used by virtual decks, using `wfDetailNxs2` peak data when available and per-bin track colors directly.
- **Ableton Link integration** — replaced upstream `abletonlink` npm dependency with a minimal in-tree NAPI wrapper (`vendor/abletonlink-mini/`) exposing only BPM / beat / phase / peer count, eliminating ThreadSafeFunction abort risk and simplifying Windows build maintenance.
- **Build artifact naming** — `1.0.0.12` artifact names.
- **Windows distribution** — added portable `.exe` target alongside the NSIS installer.

## 1.0.0.11 — 2026-05-01

30-day demo evaluation build.

### Changed

- **macOS DJM subscribe compatibility** — send bridge notify packets from the bound DJM aux source port (`50006`) to match the macOS bridge capture path.
- **CDJ-2000NXS2 timecode stability** — stop treating NXS2 `trackBeats`/`positionFraction` status bytes as duration/position when captures show those fields are not valid, and keep inferred loop playback inside the active loop window.
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
- **macOS / Windows 네이티브 빌드** — `abletonlink` C++ binding 포함

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
- macOS x64/arm64 (DMG·ZIP), Windows x64 (installer)
- 네이티브 의존성: `abletonlink` (`node-gyp` 빌드 필요)
- npm 패키지 매니저
