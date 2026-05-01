# BRIDGE+

> Independent desktop bridge for synchronizing compatible DJ hardware, virtual decks, visual software, lighting systems, DAWs, and timecode workflows.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0.12-orange.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()

BRIDGE+ listens to compatible DJ network state and translates timing, transport, metadata, and deck information into practical outputs for visual, lighting, and production environments.

> **Trademark and affiliation notice:** BRIDGE+ is an independent third-party project. It is not affiliated with, endorsed by, sponsored by, approved by, or certified by any hardware or software manufacturer mentioned in this repository. Product names and trademarks are used only to describe compatibility and interoperability. See [NOTICE.md](NOTICE.md).

---

## Distribution Model

BRIDGE+ is distributed as a binary application. Certain interoperability components are not published as source code. Those components are included only to support compatibility with user-owned systems and are not presented as official, certified, or manufacturer-approved implementations.

This release is a **30-day demo test build**. The demo period starts on first launch. After the demo period ends, core bridge features are disabled while the app remains available for status and license information.

---

## Features

- **Compatible DJ network receiver** - deck state, tempo, beat, position, track metadata, cue points, beat grids, phrase data, and artwork where available
- **TCNet output** - visual software synchronization with up to 6 layers and bidirectional metadata / metrics
- **Art-Net Timecode, LTC, MIDI Clock, and MTC** - synchronization for lighting consoles, DAWs, sequencers, and timecode tools
- **Ableton Link integration** - wireless tempo and phase synchronization through the native `abletonlink` binding
- **Virtual Deck mode** - local 6-deck playback for MP3, WAV, FLAC, AAC, OGG, M4A, and AIFF files
- **Hardware waveform rendering** - color preview, detail waveform, and 3-band visualization where supported by the source data
- **Automatic idle downshift** - reduces renderer activity when the window is hidden and resumes display-synchronized rendering when visible

---

## System Requirements

- **macOS** 10.15+ (x64 / arm64) or **Windows** 10/11 (x64)
- Compatible DJ hardware on the same LAN, or Virtual Deck mode
- Network interface access for the DJ / lighting / visual software network

---

## Installation

Download the native package for your operating system from [Releases](../../releases):

- **macOS**: `BRIDGE+-1.0.0.12-mac-x64.dmg` / `-mac-arm64.dmg`
- **Windows**: `BRIDGE+-1.0.0.12-win-x64.exe`

Install or run the downloaded package. No separate runtime installation is required for normal use.

---

## Modes

### Virtual Mode

Use local audio files without external hardware. Virtual Deck mode can drive TCNet, Art-Net Timecode, LTC, MIDI, and Ableton Link outputs for testing, rehearsal, and production setup.

### Hardware Mode

Detect compatible DJ players and mixers on the network, then forward timing, transport, mixer, metadata, cue, waveform, and artwork information where available from the connected system.

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

BRIDGE+는 바이너리 애플리케이션으로 배포됩니다. 일부 상호운용성 컴포넌트는 소스 코드로 공개되지 않습니다. 해당 컴포넌트는 사용자가 소유한 시스템과의 호환성을 지원하기 위한 목적으로만 포함되며, 공식 구현, 인증 구현, 또는 제조사 승인 구현으로 표시되지 않습니다.

이 릴리스는 **30일 데모 테스트 빌드**입니다. 데모 기간은 첫 실행일부터 시작됩니다. 데모 기간이 종료되면 핵심 브리지 기능은 비활성화되며, 앱은 상태 및 라이선스 정보를 확인할 수 있도록 계속 열립니다.

### 주요 기능

- **호환 DJ 네트워크 수신** - 덱 상태, 템포, 비트, 위치, 트랙 메타데이터, 큐 포인트, 비트 그리드, 구간 정보, 앨범아트 수신
- **TCNet 출력** - 최대 6 레이어 비주얼 소프트웨어 동기화 및 양방향 메타데이터 / 메트릭스 전송
- **Art-Net Timecode, LTC, MIDI Clock, MTC** - 조명 콘솔, DAW, 시퀀서, 타임코드 장비 동기화
- **Ableton Link 연동** - 네이티브 `abletonlink` 바인딩을 통한 무선 템포 / 위상 동기화
- **Virtual Deck 모드** - MP3, WAV, FLAC, AAC, OGG, M4A, AIFF 파일을 사용하는 로컬 6덱 재생
- **하드웨어 웨이브폼 렌더링** - 소스 데이터가 제공되는 경우 컬러 프리뷰, 디테일 웨이브폼, 3밴드 시각화
- **자동 idle downshift** - 창이 가려진 동안 렌더러 활동을 줄이고, 다시 보이면 디스플레이 동기 렌더링으로 복귀

### 시스템 요구사항

- **macOS** 10.15+ (x64 / arm64) 또는 **Windows** 10/11 (x64)
- 같은 LAN에 연결된 호환 DJ 하드웨어 또는 Virtual Deck 모드
- DJ / 조명 / 비주얼 소프트웨어 네트워크에 접근 가능한 네트워크 인터페이스

### 설치

[Releases](../../releases)에서 운영체제에 맞는 네이티브 패키지를 다운로드하세요.

- **macOS**: `BRIDGE+-1.0.0.12-mac-x64.dmg` / `-mac-arm64.dmg`
- **Windows**: `BRIDGE+-1.0.0.12-win-x64.exe`

다운로드한 패키지를 설치하거나 실행하면 됩니다. 일반 사용에는 별도 런타임 설치가 필요하지 않습니다.

### 모드

#### Virtual Mode

외부 하드웨어 없이 로컬 오디오 파일을 사용합니다. Virtual Deck 모드는 테스트, 리허설, 프로덕션 세팅을 위해 TCNet, Art-Net Timecode, LTC, MIDI, Ableton Link 출력을 구동할 수 있습니다.

#### Hardware Mode

네트워크의 호환 DJ 플레이어와 믹서를 감지하고, 연결된 시스템에서 제공되는 타이밍, 재생 상태, 믹서, 메타데이터, 큐, 웨이브폼, 앨범아트 정보를 전달합니다.

### 법적 고지

- **소스 라이선스:** [Apache License 2.0](LICENSE)
- **상표, 서드파티 자산, 면책 고지:** [NOTICE.md](NOTICE.md)
- **릴리스 내역:** [CHANGELOG.md](CHANGELOG.md)

BRIDGE+는 관찰된 네트워크 동작과 공개 정보를 기반으로 한 독립 상호운용성 구현입니다. 이 프로젝트를 개발하는 과정에서 어떤 제조사의 비공개 소스 코드, 펌웨어, 기밀 자료도 사용하지 않았습니다.

사용자는 BRIDGE+ 사용이 본인 관할 지역의 관련 법률, 제3자 라이선스, 장비 약관, 공연장 또는 프로덕션 요구사항을 준수하는지 직접 확인할 책임이 있습니다.
