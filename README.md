# BRIDGE+

> Independent desktop bridge — connects compatible DJ hardware to visual / lighting / DAW software.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.6-orange.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()
[![Releases](https://img.shields.io/badge/download-Releases-brightgreen.svg)](../../releases)

BRIDGE+ listens to the compatible DJ network and translates timing, transport, metadata, and deck information into outputs for visual, lighting, and production environments.

> **Trademark notice** — BRIDGE+ is an independent third-party project. It is **not affiliated with, endorsed by, sponsored by, approved by, or certified by** any hardware or software manufacturer mentioned in this repository. Product names and trademarks are used solely to describe compatibility and interoperability. See [NOTICE.md](NOTICE.md).

---

## Download

Get the native package for your OS from [Releases](../../releases):

| Platform | File |
|---|---|
| **macOS** (Apple Silicon) | `BRIDGE+-1.0.6-mac-arm64.dmg` / `BRIDGE+-1.0.6-mac-arm64.zip` |
| **macOS** (Intel) | `BRIDGE+-1.0.6-mac-x64.dmg` / `BRIDGE+-1.0.6-mac-x64.zip` |
| **Windows** (x64 portable) | `BRIDGE-Plus-windows-x64-portable.zip` |
| **Windows** (x64 bundle) | `BRIDGE-Plus-windows-x64.zip` (installer + portable) |

No runtime installation required. Open the package and run.

> **Demo build** — 30-day evaluation. Demo period starts on first launch. After expiry, core bridge features deactivate; the app remains open for status and license information.

---

## Features

- **Compatible DJ network receiver** — deck state, tempo, beat, position, track metadata, cue points, beat grids, phrase data, artwork
- **TCNet output** — visual software sync (up to 6 layers, bidirectional metadata)
- **Art-Net Timecode · LTC · MIDI Clock · MTC** — lighting consoles, DAWs, sequencers
- **Ableton Link integration** — wireless tempo / phase sync (native `abletonlink` C++ binding)
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

Users are responsible for ensuring that their use of BRIDGE+ complies with applicable laws, third-party licenses, device terms, and venue or production requirements in their jurisdiction.

---

## 한국어 요약

BRIDGE+ 는 호환 DJ 하드웨어 (CDJ · DJM 등) 의 네트워크 상태를 감지해 비주얼 소프트웨어 (Resolume Arena/Wire), 조명 콘솔 (grandMA·QLC+), DAW (Ableton Live 등) 와 동기화하는 독립 데스크톱 도구입니다.

주요 출력: **TCNet · Art-Net Timecode · LTC · MIDI Clock·MTC · Ableton Link** (네이티브 C++ binding).

본 빌드는 **30일 데모**입니다. [Releases](../../releases) 에서 OS 에 맞는 네이티브 패키지 다운로드 후 바로 실행하세요.

본 프로젝트는 어떠한 제조사와도 제휴/승인/후원 관계가 없습니다. 자세한 면책은 [NOTICE.md](NOTICE.md).
