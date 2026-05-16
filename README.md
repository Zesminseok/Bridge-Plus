# BRIDGE+

> Independent desktop bridge for synchronizing compatible DJ hardware, virtual decks, visual software, lighting systems, DAWs, and timecode workflows.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-orange.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()

BRIDGE+ listens to compatible DJ network state and translates timing, transport, metadata, and deck information into practical outputs for visual, lighting, and production environments.

> **Trademark and affiliation notice:** BRIDGE+ is an independent third-party project. It is not affiliated with, endorsed by, sponsored by, approved by, or certified by any hardware or software manufacturer mentioned in this repository. Product names and trademarks are used only to describe compatibility and interoperability. See [NOTICE.md](NOTICE.md).

---

## Distribution Model

BRIDGE+ release packages are distributed as desktop binaries for macOS and Windows.

This release is a **30-day demo release**. The demo period starts on first launch. After the demo period ends, core bridge features are disabled while the app remains available for status and license information.

---

## Features

- **Compatible DJ network receiver** - deck state, tempo, beat, position, track metadata, cue points, beat grids, phrase data, and artwork where available
- **TCNet output** - visual software synchronization with up to 6 layers and bidirectional metadata / metrics
- **OSC BPM Sync** - sends BPM changes to configurable local, unicast, or broadcast OSC targets for tempo-driven visual workflows
- **Art-Net Timecode, LTC, MIDI Clock, and MTC** - synchronization for lighting consoles, DAWs, sequencers, and timecode tools
- **Virtual Deck mode** - local 6-deck playback for MP3, WAV, FLAC, AAC, OGG, M4A, and AIFF files
- **Hardware waveform rendering** - color preview, detail waveform, and 3-band visualization where supported by the source data
- **Web Viewer** - local-network browser view for mobile/tablet monitoring of deck state, waveform, cue markers, mixer state, and timecode

---

## System Requirements

- **macOS** 10.15+ (x64 / arm64) or **Windows** 10/11 (x64)
- Compatible DJ hardware on the same LAN, or Virtual Deck mode
- Network interface access for the DJ / lighting / visual software network

---

## Installation

Download the native package for your operating system from [Releases](../../releases):

- **macOS Apple Silicon**: `BRIDGE+-1.1.0-mac-arm64.dmg`
- **macOS Intel**: `BRIDGE+-1.1.0-mac-x64.dmg`
- **Windows x64 portable**: `BRIDGE+-1.1.0-win-x64-portable.exe`

Install or run the downloaded package. No separate runtime installation is required for normal use.

For CDJ-2000NXS2 field diagnostics, add `--nxs2-diag` to the Windows shortcut target. The app will write `bridge-nxs2-*.log` to the Desktop. Omit the flag for normal runs.

---

## Modes

### Virtual Mode

Use local audio files without external hardware. Virtual Deck mode can drive TCNet, OSC BPM Sync, Art-Net Timecode, LTC, and MIDI for testing, rehearsal, and production setup.

### Hardware Mode

Detect compatible DJ players and mixers on the network, then forward timing, transport, mixer, metadata, cue, waveform, artwork, and OSC BPM output where available from the connected system.

---

## Legal Notes

- **Source license:** [Apache License 2.0](LICENSE)
- **Trademark, third-party asset, and disclaimer notices:** [NOTICE.md](NOTICE.md)
- **Release history:** [CHANGELOG.md](CHANGELOG.md)

BRIDGE+ is an independent interoperability implementation based on observed network behavior and publicly available information. No proprietary source code, firmware, or confidential materials from any manufacturer were used to develop this project.

Users are responsible for ensuring that their use of BRIDGE+ complies with applicable laws, third-party licenses, device terms, and venue or production requirements in their jurisdiction.

---

## Korean

> 호환 DJ 하드웨어, Virtual Deck, 비주얼 소프트웨어, 조명 시스템, DAW, 타임코드 워크플로를 동기화하기 위한 독립 데스크톱 브리지입니다.

BRIDGE+는 호환 DJ 네트워크 상태를 수신하고, 타이밍 / 재생 상태 / 메타데이터 / 덱 정보를 비주얼, 조명, 프로덕션 환경에서 사용할 수 있는 출력으로 변환합니다.

> **상표 및 비제휴 고지:** BRIDGE+는 독립 서드파티 프로젝트입니다. 이 저장소에 언급된 어떤 하드웨어 또는 소프트웨어 제조사와도 제휴, 승인, 후원, 인증 관계가 없습니다. 제품명과 상표는 호환성 및 상호운용성 설명을 위한 목적으로만 사용됩니다. 자세한 내용은 [NOTICE.md](NOTICE.md)를 확인하세요.

### 배포 모델

BRIDGE+ 릴리스 패키지는 macOS 및 Windows용 데스크톱 바이너리로 배포됩니다.

이 릴리스는 **30일 데모 릴리스**입니다. 데모 기간은 첫 실행일부터 시작됩니다. 데모 기간이 종료되면 핵심 브리지 기능은 비활성화되며, 앱은 상태 및 라이선스 정보를 확인할 수 있도록 계속 열립니다.

### 주요 기능

- **호환 DJ 네트워크 수신** - 덱 상태, 템포, 비트, 위치, 트랙 메타데이터, 큐 포인트, 비트 그리드, 구간 정보, 앨범아트 수신
- **TCNet 출력** - 최대 6 레이어 비주얼 소프트웨어 동기화 및 양방향 메타데이터 / 메트릭스 전송
- **OSC BPM Sync** - BPM 변화값을 로컬, 유니캐스트, 브로드캐스트 OSC 대상으로 송신해 템포 기반 비주얼 워크플로에 사용
- **Art-Net Timecode, LTC, MIDI Clock, MTC** - 조명 콘솔, DAW, 시퀀서, 타임코드 장비 동기화
- **Virtual Deck 모드** - MP3, WAV, FLAC, AAC, OGG, M4A, AIFF 파일을 사용하는 로컬 6덱 재생
- **하드웨어 웨이브폼 렌더링** - 소스 데이터가 제공되는 경우 컬러 프리뷰, 디테일 웨이브폼, 3밴드 시각화
- **Web Viewer** - 같은 네트워크의 모바일/태블릿 브라우저에서 덱 상태, 웨이브폼, 큐 마커, 믹서 상태, 타임코드 확인

### 시스템 요구사항

- **macOS** 10.15+ (x64 / arm64) 또는 **Windows** 10/11 (x64)
- 같은 LAN에 연결된 호환 DJ 하드웨어 또는 Virtual Deck 모드
- DJ / 조명 / 비주얼 소프트웨어 네트워크에 접근 가능한 네트워크 인터페이스

### 설치

[Releases](../../releases)에서 운영체제에 맞는 네이티브 패키지를 다운로드하세요.

- **macOS Apple Silicon**: `BRIDGE+-1.1.0-mac-arm64.dmg`
- **macOS Intel**: `BRIDGE+-1.1.0-mac-x64.dmg`
- **Windows x64 포터블**: `BRIDGE+-1.1.0-win-x64-portable.exe`

다운로드한 패키지를 설치하거나 실행하면 됩니다. 일반 사용에는 별도 런타임 설치가 필요하지 않습니다.

CDJ-2000NXS2 현장 진단이 필요하면 Windows 바로가기 대상 뒤에 `--nxs2-diag`를 붙이세요. 데스크톱에 `bridge-nxs2-*.log`가 생성됩니다. 일반 실행은 옵션을 붙이지 않으면 됩니다.

### 모드

#### Virtual Mode

외부 하드웨어 없이 로컬 오디오 파일을 사용합니다. Virtual Deck 모드는 테스트, 리허설, 프로덕션 세팅을 위해 TCNet, OSC BPM Sync, Art-Net Timecode, LTC, MIDI를 구동할 수 있습니다.

#### Hardware Mode

네트워크의 호환 DJ 플레이어와 믹서를 감지하고, 연결된 시스템에서 제공되는 타이밍, 재생 상태, 믹서, 메타데이터, 큐, 웨이브폼, 앨범아트, OSC BPM 출력을 전달합니다.

### 법적 고지

- **소스 라이선스:** [Apache License 2.0](LICENSE)
- **상표, 서드파티 자산, 면책 고지:** [NOTICE.md](NOTICE.md)
- **릴리스 내역:** [CHANGELOG.md](CHANGELOG.md)

BRIDGE+는 관찰된 네트워크 동작과 공개 정보를 기반으로 한 독립 상호운용성 구현입니다. 이 프로젝트를 개발하는 과정에서 어떤 제조사의 비공개 소스 코드, 펌웨어, 기밀 자료도 사용하지 않았습니다.

사용자는 BRIDGE+ 사용이 본인 관할 지역의 관련 법률, 제3자 라이선스, 장비 약관, 공연장 또는 프로덕션 요구사항을 준수하는지 직접 확인할 책임이 있습니다.
