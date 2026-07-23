# Changelog

All notable changes to ORVIK are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 1.4.3 — 2026-07-24

### English

- Faster track loading — waveforms, cue points and beat grids appear right after loading.
- Detail waveform: native resolution, progressive drawing, and stability fixes.
- Fixed ghosting and blurry text on some Windows GPUs.
- Hover tooltips on main controls, REPORT (Instagram DM) button, UI Drawing FPS now applies everywhere, translation fixes.

### 한국어

- 곡 로드 속도 개선 — 웨이브폼·큐 포인트·비트 그리드가 로드 직후 표시됩니다.
- 디테일 웨이브폼: 네이티브 해상도, 점진 드로잉, 안정성 수정.
- 일부 Windows GPU 의 잔상·글씨 뭉개짐 수정.
- 주요 버튼 설명 툴팁, REPORT(Instagram DM) 버튼, UI Drawing FPS 전면 적용, 번역 수정.

## 1.4.2 — 2026-07-19

### English

- Mixer panel: channel fader curve, crossfader curve, and EQ/ISO mode are now shown from the DJM; fixed V10 6-channel EQ knobs showing shifted values.
- Channel and master VU meters redrawn as continuous bars for better level visibility.
- New UI Scale option (100 / 125 / 150%) for HiDPI monitors.
- All UI fonts are now bundled — the app renders fully offline.
- Fixed small text looking blurry on Windows.
- UI improvements.

### 한국어

- 믹서 패널: DJM 의 채널 페이더 커브·크로스페이더 커브·EQ/ISO 모드 표시, V10 6채널 EQ 노브 값이 밀려 보이던 문제 수정.
- 채널·마스터 VU 미터를 연속 바 형태로 변경해 레벨 가시성 개선.
- HiDPI 모니터용 UI 배율 옵션 추가 (100 / 125 / 150%).
- 모든 UI 폰트 내장 — 오프라인에서도 완전하게 표시됩니다.
- Windows 에서 작은 글씨가 뭉개져 보이던 문제 수정.
- UI 개선.

## 1.4.1 — 2026-07-17

### English

- Fixed the Settings window layout collapsing into narrow vertical columns on Windows.
- Fixed repeated deck paint errors during track loading (waveform transition).
- The sidebar Settings button now toggles the Settings window — click again to close it.
- Minor bug fixes and improvements.

### 한국어

- Windows 에서 설정 창이 좁은 세로 컬럼으로 깨지던 문제 수정.
- 트랙 로딩 중(웨이브폼 전환) 덱 페인트 오류가 반복되던 문제 수정.
- 사이드바 설정 버튼이 설정 창을 토글 — 다시 누르면 닫힙니다.
- 자잘한 버그 수정 및 개선.

## 1.4.0 — 2026-07-14

### English

- Fixed a startup crash on some Windows and macOS machines (app now launches reliably).
- Updated the app runtime for better performance and security (Chromium/Electron refresh).
- Security: hardened handling of track title/artist text from hardware.
- Fixed a brief color flash when the app starts.
- Header and controls now stay consistent when switching deck themes — only the deck area changes.
- Fixed a horizontal scrollbar in the STK theme with 3 or more decks.
- Added on-screen guidance when no decks or hardware are connected.
- Improved resilience to malformed network packets on the DJ Link network.
- Minor bug fixes and improvements.

### 한국어

- 일부 Windows·macOS 에서 앱이 실행되지 않던 시작 크래시 수정 (이제 정상 실행).
- 앱 런타임 갱신 — 성능·보안 향상 (Chromium/Electron 리프레시).
- 보안: 하드웨어에서 오는 곡 제목·아티스트 텍스트 처리 강화.
- 앱 시작 시 잠깐 보이던 색 플래시 수정.
- 덱 테마 전환 시 헤더·컨트롤이 그대로 유지 — 덱 영역만 바뀝니다.
- STK 테마에서 덱 3개 이상일 때 가로 스크롤바 생기던 문제 수정.
- 덱·하드웨어 미연결 시 화면 안내 추가.
- DJ Link 네트워크의 비정상 패킷에 대한 견고성 개선.
- 자잘한 버그 수정 및 개선.

## 1.3.9 — 2026-07-13

### English

- Completed translations for all six supported languages.
- Added a **GPU safe rendering** toggle in Settings (Windows) for machines with display glitches.
- Minor bug fixes and improvements.

### 한국어

- 지원 6개 언어 번역 완성.
- 설정에 **GPU 안전 렌더링** 토글 추가 (Windows) — 화면 글리치가 있는 머신용.
- 자잘한 버그 수정 및 개선.
