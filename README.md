# BRIDGE+

> Independent interoperability bridge between compatible DJ hardware and visual / lighting software.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0--beta.0-orange.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()

BRIDGE+ 는 호환 DJ 하드웨어 (CDJ · DJM 시리즈) 의 네트워크 상태를 감지해 비주얼 소프트웨어, 조명 콘솔, DAW 와 동기화하는 독립적인 데스크톱 도구입니다.

> **Trademark notice** — 본 프로젝트에서 언급되는 모든 제품명 / 브랜드명은 각 소유자의 상표이며, BRIDGE+ 는 어떠한 제조사와도 제휴/승인/후원 관계가 없습니다. 자세한 내용은 [NOTICE.md](NOTICE.md).

---

## 주요 기능

- **Pro DJ Link 지원** — CDJ/DJM 상태, BPM, 비트, 트랙 메타데이터 (트랙명, 아티스트, 큐 포인트, 비트 그리드, 곡 구조, 앨범아트 등) 자동 수신
- **TCNet 출력** — 비주얼 소프트웨어 동기화 (최대 6 레이어, 양방향 메타데이터/메트릭스)
- **Art-Net Timecode / LTC / MIDI Clock·MTC** — 외부 조명 콘솔 · DAW · 시퀀서 동기
- **Ableton Link 네이티브** — 무선 BPM/Phase 동기 (C++ binding)
- **Virtual Deck** — 6덱 로컬 음원 재생 (MP3 · WAV · FLAC · AAC · OGG · M4A · AIFF)
- **HW 웨이브폼** — 컬러 프리뷰 / 디테일 / 3-Band
- **자동 idle 절약** — 창 가려지면 1Hz, 보이면 디스플레이 refresh 네이티브 (ProMotion 120Hz / 60·144·240Hz 자동 sync)

---

## 시스템 요구사항

- **macOS** 10.15+ (x64 / arm64) 또는 **Windows** 10/11 (x64)
- 호환 DJ 하드웨어 또는 Virtual Deck 모드
- 네트워크 인터페이스 (DJ 장비와 같은 LAN segment)

---

## 설치

[Releases](../../releases) 에서 OS 에 맞는 네이티브 패키지 다운로드:

- **macOS**: `BRIDGE+-1.0.0-beta.0.dmg`
- **Windows**: `BRIDGE+-Portable-1.0.0-beta.0.exe`

다운로드 후 설치/실행 — 별도 의존성 설치 불필요.

---

## 모드

### Virtual 모드
하드웨어 없이 로컬 음원 파일 6덱 재생 — 모든 출력 (TCNet/Art-Net/LTC/MIDI/Link) 테스트 가능.

### Hardware 모드
실제 CDJ/DJM 자동 감지 — 트랙 메타데이터 / 큐 포인트 / 비트 그리드 / 앨범아트 / 곡 구조 자동 수신.

---

## 라이선스 및 면책

- **코드**: [MIT License](LICENSE)
- **상표 / 면책**: [NOTICE.md](NOTICE.md)
- **변경 내역**: [CHANGELOG.md](CHANGELOG.md)

BRIDGE+ 는 관찰된 네트워크 동작과 공개 정보에 기반한 독립 구현입니다. 어떤 제조사의 비공개 소스코드, 펌웨어, 또는 기밀 자료도 사용되지 않았습니다.
