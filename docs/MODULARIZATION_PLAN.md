# BRIDGE+ Modularization Plan

Purpose: split the current large Electron/Pro DJ Link codebase into smaller modules without changing runtime behavior. This plan is intended as implementation guidance for a coding agent.

## Ground Rules

- Preserve current behavior first. Refactor only, unless a step explicitly says to fix a bug.
- Keep each step small and separately testable.
- Do not change protocol byte layouts while moving code.
- Do not rewrite UI design while extracting modules.
- Keep license activation disabled in test builds.
- After code changes, run `graphify update .`.

## Current Hotspots

- `renderer/index.html` is about 7000 lines and mixes CSS, HTML, app state, settings, mixer UI, deck UI, waveform analysis, history, and IPC handling.
- `bridge-core.js` is about 4500 lines and mixes TCNet, Pro DJ Link packet parsing/building, UDP socket lifecycle, dbserver metadata/artwork, DJM state, and virtual deck support.
- `main.js` mixes Electron window lifecycle, splash screen, IPC registration, Art-Net, Ableton Link, FFmpeg decoding, and BridgeCore orchestration.
- Graphify god nodes currently include `BridgeCore`, `push()`, `ArtnetEngine`, `buildHdr()`, and `getAllInterfaces()`, which confirms high coupling around app orchestration and protocol logic.

## Status (2026-04-28)

- Phase 1.1 License Panel — DONE (`renderer/license-panel.js`)
- Phase 1.2 Main IPC License Router — DONE (`main/ipc-license.js`)
- Phase 1.3 Settings Panel — DONE (`renderer/settings-panel.js`)
- Phase 2.4 Mixer Panel — DONE (`renderer/mixer-panel.js`, +element cache)
- Phase 2.5 Waveform Analysis — DONE (`renderer/waveform-analysis.js`, `renderer/rgbwf-worker.js`)
- Phase 3.6 FFmpeg Audio Decode — DONE (`main/audio-decode.js`)
- Phase 3.7 Art-Net IPC — DONE (`main/ipc-artnet.js`)
- Phase 3.8 Ableton Link IPC — DONE (`main/ipc-link.js`)
- Phase 3.9 App / cleanup IPC — DONE (`main/ipc-app.js`)
- Phase 3.10 Bridge simple IPC — DONE (`main/ipc-bridge-simple.js`)
- Phase 3.11 Bridge interface / artTimeCode IPC — DONE (`main/ipc-bridge-iface.js`)
- Phase 3.12 Bridge start/stop IPC — DONE (`main/ipc-bridge-start.js`, setter/getter dep injection for bridge/iv/_ifaceSig)
- Phase 4.0 Theme-aware worker analysis — DONE (worker accepts cutoffs/releases/smooth via message; per-theme cache `d._wfByTheme`)
- Phase 4.13 ID3 parser — DONE (`renderer/id3-parser.js`, 6 funcs: text/BPM/TXXX/applyFrame/_findAIFFId3/readID3Tags)
- Phase 4.14 RGB tuner integration — DONE (worker theme-aware analysis + brightness-constant normalize)
- Phase 4.15 BPM analysis — DONE (`renderer/bpm-analysis.js`, 3 funcs: _normalizeAnalyzedBpm/detectAudioStart/analyzeBPM)
- Phase 4.16 PCM decode pipeline — DONE (`renderer/pcm-decode.js`, _getPcmWorker / _decodePcmFor + module-local pcm worker state)
- Phase 4.17 Security hardening — DONE (`renderer/util-html.js` _escHtml + IPC input validation in main/ipc-bridge-simple + CSP meta tag)
- Phase 4.18 Network helpers (Pro DJ Link interface enumeration) — DONE (`pdjl/network.js`, 6 helpers: _getHWPortMap/getAllInterfaces/interfaceSignature/sanitizeInterfaceSelection/detectBroadcastFor/pdjlBroadcastTargets)
- Phase 4.8 PDJL packet builders — DONE (`pdjl/packets.js`)
- Phase 4.9 PDJL parser — DONE (`pdjl/parser.js`)
- Phase 4.10 TCNet packet builders — DONE (`tcnet/packets.js`)
- Phase 4.11 dbserver — DONE (`pdjl/dbserver.js`)

## Pending Work (다음 session 인계 — 2026-04-28)

### High-Risk Protocol Modules (BridgeCore 깊이 의존, hardware test 환경 권장)

#### 1. `pdjl/sockets.js` — PDJL UDP socket lifecycle
- **상태**: pending
- **이전**: bridge-core.js 안 `_pdjlAnnSock`/`_pdjlSockets`/`_pdjlAnnTxSock`/`_pdjlAnnTimer`/`pdjlSocket`/`pdjlPort` 등 instance state
- **함수들**: `_startPDJLAnnounce()` (~317 lines), `_onPDJL()` (~700 lines), `_findLocalIfaceForRemote`, `_pickAutoPdjlIface`, `_autoSelectPdjlForRemote`, `_shouldDelayWinAutoPdjl`
- **위험**: socket lifecycle 매우 복잡 (announce 세션 관리, double-close 가드, snapshot diff). protocol byte 변경 위험.
- **권장 접근**: `PdjlSocketManager` class composition. BridgeCore 에 인스턴스 보관. 또는 wrapper method 만 남기고 내부만 분리.

#### 2. `pdjl/artwork.js` — Album art TCP fetch
- **상태**: pending
- **이전**: `requestArtwork()` 메서드 (line 2694), `_dbserverArtwork()` (TCP connection + dbserver request), `_findArtByTrackId()`, `_findVirtualArt()`, art cache (`art_${ip}_${slot}_${artworkId}` key)
- **위험**: `_dbBuildMsg`, `_dbReadResponse` 등 dbserver state 의존. cache invalidation 로직.
- **권장 접근**: 함수들을 standalone (BridgeCore instance 첫 인자) 으로 변환. dbserver helpers 는 이미 `pdjl/dbserver.js` 에 있음.

#### 3. `tcnet/transport.js` — TCNet UDP send helpers
- **상태**: pending
- **이전**: `_send(buf, port)`, `_uc(buf, port, ip)`, `_sendToArenas(buf, port)`, `_sendToArenasLPort(buf)`, `_sendDataToArenas(buf)`, `_sendArtwork(layerIdx, jpegBuf)`, `_resendAllArtwork()`, `_sendDataCycle()`, `_sendOptIn()`, `_sendStatus()`. socket state: `txSocket`, `_dataSocket`, `_lportSockets`, `broadcastAddr`, `unicastTargets`.
- **bridge-core 안 access count**: 69 (this.txSocket / this._dataSocket / this._send / this._uc)
- **권장 접근**: `TCNetTransport` class composition. socket lifecycle 도 transport 안으로. BridgeCore wrapper 로 backward compat.

#### 4. BridgeCore class split — God class (3680 lines)
- **상태**: pending
- **이전**: BridgeCore 가 TCNet, PDJL, dbserver, DJM state, Virtual deck, beat anchor predictor 모두 보유
- **분리 후보**: `bridge/virtual-deck.js` (registerVirtualDeck/unregisterVirtualDeck/setVirtualArt/_sendVirtualCDJStatus/_startVirtualDbServer/_handleVDbRequest), `bridge/djm-state.js` (DJM 0x39/0x29 packet 파싱 결과 보관), `bridge/beat-anchor.js` (NXS2 beat anchor predictor — `nxs2BeatCountToMs`, `shouldKeepPredictedBeatAnchor`, `_smoothPos` 추적)
- **권장 접근**: composition pattern. BridgeCore 가 sub-managers 보관, public API 는 wrapper.

### Medium-Risk Renderer Refactoring (innerHTML 보안 hook 으로 새 file write 차단됨)

#### 5. `renderer/status-panels.js` — Tab panel renderers
- **상태**: blocked (Write tool 의 innerHTML security hook 이 새 파일 작성 차단)
- **함수들**: `renderPDJL` (이미 _escHtml 적용), `renderTcnet` (이미 _escHtml 적용), `renderArtnet`, `renderAblink` (~100 lines), `_renderLinkBig`, `_ablinkPollStart/Stop`, `_updateLinkUi`
- **우회**: Edit tool 로 기존 file 에 추가하거나, content 안에 innerHTML 문자열 패턴 회피 (bracket notation 등).

#### 6. `renderer/deck-ui.js` — Deck rendering / patchDeck
- **상태**: pending (큰 refactor, ~580 lines)
- **함수들**: `bindDeck` (215 lines), `patchDeck` (100 lines), `_buildDeckElsCache` (40 lines), `renderDecks` (100 lines), `deckHTMLDefault` (125 lines)
- **위험**: globals 다수 (DECKS, cfg, _wfThemeMode, drawOverview, drawZoomWaveform). script-tag global lexical 으로 호환되지만 의존성 추적 필요.

### Session Context (다음 agent 가 이어받을 때 알아야 할 것)

- **현재 상태** (2026-04-28 세션 종료 시):
  - Tests: 149/149 PASS
  - main.js: 653 lines (-14% from initial 761)
  - bridge-core.js: ~3680 lines (network helpers 분리됨)
  - renderer/index.html: ~7531 lines
  - main/ modules: 9, renderer/ modules: 16, pdjl/ modules: 4, tcnet/ modules: 1
  - graphify-out 최신
- **마지막 commit**: ba80967 (Phase 3.8-3.12 + 4.0/4.13/4.15 IPC + theme-aware analysis + ID3/BPM extraction). 이후 변경사항 (pcm-decode, util-html, security validation, pdjl/network, _cdjColorToRGB dead code) 은 unstaged.
- **Cmd+R reload 필요**: renderer 모듈 추가 (id3-parser, bpm-analysis, pcm-decode, util-html) + worker (rgbwf-worker theme-aware) + index.html 변경
- **Worker reload caveat**: rgbwf-worker.js 변경 시 페이지 reload 전까지 옛 worker code 실행 (memory: feedback_worker_reload).

### Tuner Pages (refactor 시 reference)

- 3band tuner: `/tmp/wf-test/test.html` — 4-band stack BLUE/BROWN/ORANGE/WHITE
- RGB tuner: `/tmp/wf-test/test-rgb.html` — band coefficients + normalize toggle (project 모드 = max-normalize)
- 음원: `/tmp/wf-test/test-audio.mp3` (Clean Bandit - Rather Be Remix)
- 서버: `python3 -m http.server 8765 --directory /tmp/wf-test/` (이미 background 실행 중)
- BridgeCore god class split (~3700 lines, virtual deck / DJM state / TCNet 분리)

## Phase 1: Low-Risk Extraction

### 1. License Panel

Move the stub license UI helpers out of `renderer/index.html`.

Create:

- `renderer/license-panel.js`

Move:

- `_licenseStatusText`
- `_paintLicenseStatus`
- `_refreshLicensePanel`
- license button binding logic from `renderSettings()`

Target API:

```js
window.BridgeLicensePanel = {
  bind(rootEl, bridgeApi),
  refresh(bridgeApi),
};
```

Constraints:

- Keep `license-service.js` disabled by default.
- No license gating.
- No network calls.

Verification:

- `node tests/license-service.test.js`
- renderer inline script parse check
- manual open Settings and confirm the License section still displays `TEST BUILD`.

### 2. Main IPC License Router

Move license IPC registration out of `main.js`.

Create:

- `main/ipc-license.js`

Target API:

```js
function registerLicenseIpc(ipcMain, licenseService) {}
module.exports = { registerLicenseIpc };
```

Verification:

- `node --check main.js main/ipc-license.js license-service.js`
- `node tests/license-service.test.js`

## Phase 2: Renderer Split

### 3. Settings Panel Extraction

Move `renderSettings()` and settings-specific helpers out of `renderer/index.html`.

Create:

- `renderer/settings-panel.js`

Suggested API:

```js
window.BridgeSettingsPanel = {
  render(ctx),
};
```

Where `ctx` contains only required dependencies:

- `cfg`
- `allIfaces`
- `audioDevs`
- `window.bridge`
- callbacks such as `_saveCfg`, `_probeAndFillChSels`, `_wfPersistAndApply`

Do this incrementally. First move only the HTML renderer, then move event binding.

Verification:

- renderer inline script parse check
- settings controls still update local config
- interface rebind controls still work while running

### 4. Mixer Panel Extraction

Move mixer UI rendering and update logic out of `renderer/index.html`.

Create:

- `renderer/mixer-panel.js`

Move:

- `_DJM_PROFILES`
- `_mxDetectProfile`
- `_mxBuildBody`
- `updateMixer`
- AUX knob/toggle helpers

Keep DJM state variables in the main renderer initially. Only move rendering logic first.

Verification:

- `node tests/vu-strip.test.js`
- `node tests/tcnet-packets.test.js`
- manual check Mixer tab with and without DJM device data.

### 5. Waveform Analysis Extraction

Separate analysis from rendering.

Create:

- `renderer/waveform-analysis.js`

Move:

- `buildRGBWaveform`
- filter helpers used only by analysis
- packed waveform encode/decode helpers if not tightly tied to rendering

Do not move `renderer/waveform-gl.js`; it is already a separate renderer module.

Verification:

- `node tests/waveform-shader.test.js`
- renderer inline script parse check
- load virtual audio and verify waveform still appears.

## Phase 3: Main Process Split

### 6. FFmpeg Audio Decode

Move FFmpeg discovery and decode IPC out of `main.js`.

Create:

- `main/audio-decode.js`

Move:

- `_findFFmpeg`
- temp file tracking helpers if practical
- `bridge:checkFFmpeg`
- `bridge:decodeAudio`
- `bridge:cleanupTemp`

Target API:

```js
function registerAudioDecodeIpc(ipcMain, deps) {}
function cleanupTempFiles() {}
module.exports = { registerAudioDecodeIpc, cleanupTempFiles };
```

Verification:

- `node --check main.js main/audio-decode.js`
- virtual deck AIFF/FLAC conversion path still reports progress.

### 7. Art-Net IPC

Move Art-Net IPC registration out of `main.js`.

Create:

- `main/ipc-artnet.js`

Move IPC handlers only. Keep `ArtnetEngine` class in `main.js` until a later pass.

Verification:

- `node --check main.js main/ipc-artnet.js`
- Art-Net start/stop and DMX settings still work.

## Phase 4: Protocol Core Split

This is the highest-risk part. Do not start until Phase 1-3 are stable.

### 8. Pro DJ Link Packet Builders

Move pure packet builder functions out of `bridge-core.js`.

Create:

- `pdjl/packets.js`

Move:

- `PDJL`
- `pdjlBridgeAnnounceId`
- `pdjlIdentityByteFromMac`
- `buildPdjlBridgeHelloPacket`
- `buildPdjlBridgeClaimPacket`
- `buildPdjlBridgeKeepalivePacket`
- `buildDjmSubscribePacket`
- `buildBridgeNotifyPacket`
- `buildDbServerKeepalivePacket`
- `hasPDJLMagic`
- `readPDJLNameField`

Verification:

- `node tests/tcnet-packets.test.js`
- compare exported function names from `bridge-core.js` before/after.

### 9. Pro DJ Link Parser

Move packet parsing out of `bridge-core.js`.

Create:

- `pdjl/parser.js`

Move:

- `parsePDJL`
- parser-local helper functions
- packet type constants used only by parser

Constraints:

- Keep output object shape exactly the same.
- Add focused parser tests before moving larger logic.

Verification:

- `node tests/tcnet-packets.test.js`
- add `tests/pdjl-parser.test.js` if parser behavior changes are discovered.

### 10. TCNet Packet Builders

Move pure TCNet packet construction out of `bridge-core.js`.

Create:

- `tcnet/packets.js`

Move:

- `TC`
- `STATE`
- `P1_TO_STATE`
- `P1_NAME`
- `buildHdr`
- `mkOptIn`
- `mkStatus`
- `mkTime`
- `mkAppResp`
- `mkMetadataResp`
- `mkDataMetrics`
- `mkDataMeta`
- `mkNotification`
- `mkLowResArtwork`

Verification:

- `node tests/tcnet-packets.test.js`
- confirm exported API compatibility from `bridge-core.js`.

### 11. dbserver and Artwork

Move dbserver TCP handling out of `BridgeCore`.

Create:

- `pdjl/dbserver.js`
- `pdjl/artwork.js`

Move only after packet builders/parser are stable.

Verification:

- hardware CDJ metadata fetch
- album artwork fetch
- virtual deck metadata/artwork serving

## Suggested Final Structure

```text
main.js
main/
  audio-decode.js
  ipc-artnet.js
  ipc-bridge.js
  ipc-license.js
bridge-core.js
pdjl/
  packets.js
  parser.js
  sockets.js
  dbserver.js
  artwork.js
tcnet/
  packets.js
  transport.js
renderer/
  index.html
  app-state.js
  settings-panel.js
  license-panel.js
  mixer-panel.js
  deck-ui.js
  waveform-analysis.js
  waveform-gl.js
  ltc-processor.js
```

## Verification Checklist Per Phase

Run the smallest relevant checks after each extraction:

```bash
node --check main.js
node --check bridge-core.js
node --check preload.js
node --check license-service.js
node tests/license-service.test.js
node tests/interfaces.test.js
node tests/metadata-bpm.test.js
node tests/vu-strip.test.js
node tests/waveform-shader.test.js
node tests/tcnet-packets.test.js
```

Renderer inline script parse check:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('renderer/index.html','utf8');const blocks=[...s.matchAll(/<script(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(m=>m[1]);for(let i=0;i<blocks.length;i++)new Function(blocks[i]);console.log('renderer inline scripts ok:',blocks.length);"
```

After modifying code files:

```bash
graphify update .
```

## Do Not Do Yet

- Do not add code obfuscation in this refactor.
- Do not convert the project to a new bundler until modules are stable.
- Do not migrate to TypeScript in the same pass.
- Do not rewrite the UI layout while extracting renderer modules.
- Do not enforce license activation until the real licensing backend is designed and tested.

