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
- Phase 4.8 PDJL packet builders — DONE (`pdjl/packets.js`)
- Phase 4.9 PDJL parser — DONE (`pdjl/parser.js`)
- Phase 4.10 TCNet packet builders — DONE (`tcnet/packets.js`)
- Phase 4.11 dbserver — DONE (`pdjl/dbserver.js`)

Pending (high risk — 명시 요청 시 진행):
- pdjl/sockets.js (UDP lifecycle 분리 from bridge-core)
- pdjl/artwork.js (artwork TCP fetch 분리)
- tcnet/transport.js (TCNet UDP transport 분리)
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

