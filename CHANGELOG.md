# Changelog

All notable changes to BRIDGE+ are documented in this file.

The version history below begins at **1.0.0-beta.0** — earlier internal builds are
not archived. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
