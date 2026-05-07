# BRIDGE+

> Independent desktop bridge — connects compatible DJ hardware to visual / lighting / DAW software.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.7-orange.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()
[![Releases](https://img.shields.io/badge/download-Releases-brightgreen.svg)](../../releases)

BRIDGE+ listens to the compatible DJ network and translates timing, transport, metadata, and deck information into outputs for visual, lighting, and production environments.

> **Trademark notice** — BRIDGE+ is an independent third-party project. It is **not affiliated with, endorsed by, sponsored by, approved by, or certified by** any hardware or software manufacturer mentioned in this repository. Product names and trademarks are used solely to describe compatibility and interoperability. See [NOTICE.md](NOTICE.md).

---

## Download

Get the native package for your OS from [Releases](../../releases):

| Platform | File |
|---|---|
| **macOS** (Apple Silicon) | `BRIDGE+-1.0.7-mac-arm64.dmg` |
| **macOS** (Intel) | `BRIDGE+-1.0.7-mac-x64.dmg` |
| **Windows** (x64 portable) | `BRIDGE+-1.0.7-win-x64-portable.exe` |

No runtime installation required. Open the package and run.

> **Demo build** — 30-day evaluation. Demo period starts on first launch. After expiry, core bridge features deactivate; the app remains open for status and license information.

---

## Optional Ableton Link

BRIDGE+ release packages do **not** bundle Ableton Link source code, the Ableton Link SDK, or an Ableton Link native binary. Link output stays disabled unless the user installs a compatible module separately. The default BRIDGE+ binary distribution is kept separate from Ableton Link's GPL-2.0 / commercial dual-license terms.

BRIDGE+ 1.0.7 runs on Electron 33. A compatible optional module must be built for:

- your operating system (`win32` or `darwin`)
- your CPU architecture (`x64` or `arm64`)
- Electron 33's native module ABI

Install the **whole module folder**, not only the `.node` file. BRIDGE+ looks for the optional module in this order:

1. `BRIDGE_ABLETON_LINK_MODULE`
2. The OS-specific application support folder below
3. A globally resolvable `abletonlink-mini` Node module

The module folder must be loadable by Node/Electron, usually with `package.json` or `index.js` at the folder root. It must expose a `Link` constructor compatible with BRIDGE+ (`enable`, `setBpm`, `getBpm`, `getBeat`, `getPhase`, `getNumPeers`, and `setBeat`). Its native `.node` binary must match your OS, CPU architecture, and Electron ABI.

After installation, restart BRIDGE+, open **BPM Link**, enable **Ableton Link**, and check the status. OSC BPM output can still be used without Ableton Link.

**Windows**

Recommended install path:

```powershell
%APPDATA%\BRIDGE+\abletonlink-mini
```

Create the folder if it does not exist:

```powershell
mkdir "$env:APPDATA\BRIDGE+\abletonlink-mini"
```

Expected shape:

```text
%APPDATA%\BRIDGE+\abletonlink-mini\
  package.json
  index.js
  bin\win32-x64-<electron-abi>\abletonlink-mini.node
```

If your module package already contains `package.json`, `index.js`, and `bin\...`, copy that package folder's contents into `%APPDATA%\BRIDGE+\abletonlink-mini`.

Or set an explicit module path:

```powershell
setx BRIDGE_ABLETON_LINK_MODULE "C:\Path\To\abletonlink-mini"
```

Restart BRIDGE+ after changing the environment variable.

**macOS**

Recommended install path:

```sh
~/Library/Application Support/BRIDGE+/abletonlink-mini
```

Create the folder if it does not exist:

```sh
mkdir -p "$HOME/Library/Application Support/BRIDGE+/abletonlink-mini"
```

Expected shape:

```text
~/Library/Application Support/BRIDGE+/abletonlink-mini/
  package.json
  index.js
  bin/darwin-arm64-<electron-abi>/abletonlink-mini.node
  # or bin/darwin-x64-<electron-abi>/abletonlink-mini.node
```

If your module package already contains `package.json`, `index.js`, and `bin/...`, copy that package folder's contents into `~/Library/Application Support/BRIDGE+/abletonlink-mini`.

Or launch BRIDGE+ with an explicit module path. Finder-launched apps do not inherit normal shell environment variables, so the application support folder above is usually the simplest option. For a temporary shell launch:

```sh
export BRIDGE_ABLETON_LINK_MODULE="$HOME/Library/Application Support/BRIDGE+/abletonlink-mini"
open -a "BRIDGE+"
```

For a persistent GUI environment variable:

```sh
launchctl setenv BRIDGE_ABLETON_LINK_MODULE "$HOME/Library/Application Support/BRIDGE+/abletonlink-mini"
```

Then quit and reopen BRIDGE+.

Troubleshooting checklist:

- The folder path points to the module root, not directly to the `.node` file.
- `package.json` or `index.js` exists at the module root.
- The `.node` binary matches the current BRIDGE+ release's Electron major version.
- Windows uses `win32-x64`; Apple Silicon uses `darwin-arm64`; Intel Mac uses `darwin-x64`.
- If Ableton Link stays unavailable, remove the env var and use the OS-specific application support folder first.

If you build, install, bundle, or redistribute an optional Ableton Link module, you are responsible for complying with that module's license and Ableton Link's GPL-2.0 or commercial license terms. The optional module is a separate component and is not covered by BRIDGE+'s Apache-2.0 license.

---

## Features

- **Compatible DJ network receiver** — deck state, tempo, beat, position, track metadata, cue points, beat grids, phrase data, artwork
- **TCNet output** — visual software sync (up to 6 layers, bidirectional metadata)
- **Art-Net Timecode · LTC · MIDI Clock · MTC** — lighting consoles, DAWs, sequencers
- **Optional Ableton Link integration** — wireless tempo / phase sync when a user-installed compatible Link module is available
- **Virtual Deck** — local 6-deck playback (MP3 · WAV · FLAC · AAC · OGG · M4A · AIFF)
- **Hardware waveform** — color preview · detail waveform · 3-band visualization
- **Auto idle reduction** — display refresh native when visible, 1Hz timer when hidden
- **6-language UI** — English · 한국어 · 日本語 · Español · Deutsch · Français (auto-detect)

---

## System Requirements

- **macOS** 10.15+ (x64 / arm64) or **Windows** 10/11 (x64)
- Compatible DJ hardware on the same LAN, or Virtual Deck mode
- Network interface reachable by your DJ / lighting / visual software

---

## Modes

**Virtual** — Use local audio files without external hardware. All outputs (TCNet / Art-Net / LTC / MIDI / Link) work for testing, rehearsal, and production setup.

**Hardware** — Auto-detect compatible DJ players and mixers on the network. Forward timing, transport, mixer state, metadata, cue points, waveforms, and artwork.

---

## Legal

- **Source license:** [Apache License 2.0](LICENSE)
- **Trademarks, third-party assets, and disclaimers:** [NOTICE.md](NOTICE.md)
- **Release history:** [CHANGELOG.md](CHANGELOG.md)

BRIDGE+ is an independent interoperability implementation based on observed network behavior and publicly available information. No proprietary source code, firmware, or confidential materials from any manufacturer were used in development.

BRIDGE+ release packages do not include Ableton Link source code, SDK files, or native binaries. Optional user-installed modules remain under their own licenses.

Users are responsible for ensuring that their use of BRIDGE+ complies with applicable laws, third-party licenses, device terms, and venue or production requirements in their jurisdiction.

---

## 한국어 요약

BRIDGE+ 는 호환 DJ 하드웨어 (CDJ · DJM 등) 의 네트워크 상태를 감지해 비주얼 소프트웨어 (Resolume Arena/Wire), 조명 콘솔 (grandMA·QLC+), DAW (Ableton Live 등) 와 동기화하는 독립 데스크톱 도구입니다.

주요 출력: **TCNet · Art-Net Timecode · LTC · MIDI Clock·MTC · 선택적 Ableton Link**.

본 빌드는 **30일 데모**입니다. [Releases](../../releases) 에서 OS 에 맞는 네이티브 패키지 다운로드 후 바로 실행하세요.

### 선택적 Ableton Link

BRIDGE+ 릴리스 패키지는 Ableton Link 소스 코드, Ableton Link SDK, Ableton Link 네이티브 바이너리를 기본 포함하지 않습니다. 사용자가 호환 모듈을 별도 설치한 경우에만 Link 출력이 활성화됩니다.

BRIDGE+는 `BRIDGE_ABLETON_LINK_MODULE`, OS별 앱 지원 폴더, 전역 `abletonlink-mini` Node 모듈 순서로 선택 모듈을 찾습니다.

- **Windows**: `%APPDATA%\BRIDGE+\abletonlink-mini`
- **macOS**: `~/Library/Application Support/BRIDGE+/abletonlink-mini`

선택 모듈은 Node/Electron에서 `require()` 가능한 폴더여야 하며, BRIDGE+가 사용할 수 있는 `Link` 생성자를 제공해야 합니다. 선택 모듈을 빌드, 설치, 번들 포함, 재배포하는 경우 해당 모듈의 라이선스와 Ableton Link의 GPL-2.0 또는 상용 라이선스 조건을 준수할 책임은 사용자/배포자에게 있습니다. 선택 모듈은 별도 구성요소이며 BRIDGE+의 Apache-2.0 라이선스 대상이 아닙니다.

본 프로젝트는 어떠한 제조사와도 제휴/승인/후원 관계가 없습니다. 자세한 면책은 [NOTICE.md](NOTICE.md).
