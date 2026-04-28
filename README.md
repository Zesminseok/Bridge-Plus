# BRIDGE+

> Independent interoperability bridge between compatible DJ hardware and visual / lighting software.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0--beta.0-orange.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()

BRIDGE+ 는 호환 DJ 하드웨어 (CDJ · DJM 시리즈) 의 네트워크 상태를 감지해 Resolume Arena / Wire 같은 비주얼 소프트웨어, 조명 콘솔, DAW 와 동기화하는 독립적인 데스크톱 도구입니다.

> **Trademark notice** — Pioneer DJ, CDJ, DJM, Pro DJ Link 는 AlphaTheta Corporation 의 상표입니다.
> Resolume Arena 는 Resolume B.V., Ableton Link 는 Ableton AG, TCNet 은 Tom Cosm Technologies 의 상표입니다.
> BRIDGE+ 는 어떠한 위 기업과도 제휴/승인/후원 관계가 없습니다. 자세한 내용은 [NOTICE.md](NOTICE.md).

---

## 주요 기능

| 영역 | 설명 |
|------|------|
| **네트워크 수신** | CDJ 재생 상태, BPM, 피치, 비트 위치, 트랙 ID 자동 감지 |
| **DJM 페이더 / EQ / VU** | 채널 페이더, 3-band EQ, COLOR, TRIM, 15-band VU 미터 실시간 |
| **TCNet 출력** | Arena/Wire 양방향 — 최대 6 레이어, MetaData / MetricsData |
| **Art-Net Timecode** | SMPTE 타임코드 브로드캐스트 (DMX 콘솔 동기) |
| **Linear Timecode** | AudioWorklet 기반 LTC 오디오 출력 |
| **MIDI Clock / MTC** | 가상 MIDI 출력 — DAW · 외장 시퀀서 동기 |
| **Ableton Link** | 네이티브 바인딩 — 무선 BPM/Phase 동기 (`abletonlink` C++ addon) |
| **Virtual Deck** | 하드웨어 없이 로컬 파일 6덱 재생 (MP3 · WAV · FLAC · AAC · OGG · M4A · AIFF) |
| **HW 웨이브폼** | CDJ-3000 컬러 프리뷰 / 디테일 + NXS2 3-Band PWV7 |
| **dbserver 메타데이터** | 트랙 정보, 큐 포인트, 비트 그리드, 앨범아트, 곡 구조 (PSSI) |
| **자동 idle 절약** | 창 가려지면 1Hz, 보이면 디스플레이 refresh 네이티브 |

---

## 시스템 요구사항

- **macOS** 10.15+ (x64 / arm64) 또는 **Windows** 10/11 (x64)
- **Node.js** 18+ (소스 빌드 시)
- **Electron** 33+ (자동 설치)
- 호환 DJ 하드웨어 (Pro DJ Link 지원 모델) 또는 Virtual Deck 모드
- 네트워크 인터페이스 (CDJ/DJM 가 같은 LAN segment 에 연결)

### 네이티브 빌드 의존성

Ableton Link 는 C++ 네이티브 모듈 (`abletonlink` npm 패키지) 로 통합됩니다. 소스 빌드 시 다음이 필요합니다:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Visual Studio Build Tools (Desktop development with C++)
- **공통**: Python 3.x (`node-gyp` 의존성)

```bash
npm install         # node-gyp 가 abletonlink 자동 빌드
```

빌드 실패 시: [`abletonlink` GitHub](https://github.com/2bbb/node-abletonlink) 의 platform 별 안내 참고.

---

## 설치 및 실행

### 사전 빌드된 릴리스 사용

[Releases 페이지](../../releases) 에서 OS 에 맞는 패키지 다운로드:

- **macOS**: `BRIDGE+-1.0.0-beta.0.dmg` 또는 `.zip`
- **Windows**: `BRIDGE+-Portable-1.0.0-beta.0.exe`

### 소스에서 빌드

```bash
# 의존성 설치 (네이티브 모듈 포함)
npm install

# 개발 모드 실행
npm start

# 패키징
npm run dist:mac      # macOS DMG + ZIP
npm run dist:win      # Windows portable
npm run dist:all      # 모두
```

---

## 모드

### Virtual 모드
- 소프트웨어 가상 덱 — 로컬 음원 파일 재생
- 6덱 동시 + RGB 웨이브폼 분석 (Web Worker)
- 하드웨어 없이 모든 출력 (TCNet/Art-Net/LTC/MIDI/Link) 테스트 가능

### Hardware 모드
- 실제 CDJ/DJM 자동 감지
- TCP dbserver 로 트랙 메타데이터 / 큐 / 비트 그리드 / 앨범아트 / 곡 구조 수신
- 가상 CDJ 등록 (deck 5/6) — Arena 가 BRIDGE+ 를 디바이스로 인식

---

## 지원 프로토콜

| 프로토콜 | 방향 | 포트 | 용도 |
|---------|------|------|------|
| Pro DJ Link 호환 | 입력 | UDP 50001/50002 | CDJ/DJM 상태 수신 |
| dbserver | 입출력 | TCP 12523 | 메타데이터, 웨이브폼, 큐, 비트그리드, 앨범아트 |
| TCNet | 입출력 | UDP 60000-60002 | Arena 레이어 제어 + 메타데이터 응답 |
| Art-Net | 출력 | UDP 6454 | ArtTimeCode (SMPTE) |
| LTC | 출력 | Audio | Linear Timecode (AudioWorklet) |
| MIDI | 출력 | Virtual MIDI | Clock, MTC, CC |
| Ableton Link | 양방향 | mDNS / UDP | 무선 BPM/Phase 동기 |

---

## 아키텍처

```
main process            preload (sandbox)        renderer
─────────────           ──────────────────       ──────────
main.js                 preload.js               renderer/index.html
  ├─ ipc-bridge-*         ├─ contextBridge         ├─ deck UI
  ├─ ipc-link               (60+ IPC channels)     ├─ waveform GL
  ├─ ipc-artnet                                    └─ workers (RGB / PCM)
  └─ audio-decode

bridge-core.js (orchestrator)
  ├─ pdjl/parser, packets, dbserver, dbserver-io, network
  ├─ bridge/dbserver-pool, dbserver-client, dbserver-orchestrator
  ├─ bridge/virtual-deck, beat-anchor, tcnet-handler
  └─ tcnet/packets
```

---

## 개발 / 기여

```bash
npm test              # 회귀 테스트 (현재 180+ 케이스)
graphify update .     # 코드 그래프 갱신 (graphify-out/)
```

자세한 모듈화 계획은 [docs/MODULARIZATION_PLAN.md](docs/MODULARIZATION_PLAN.md).

---

## 라이선스 및 면책

- **코드**: [MIT License](LICENSE)
- **상표 / 면책**: [NOTICE.md](NOTICE.md)
- **변경 내역**: [CHANGELOG.md](CHANGELOG.md)

BRIDGE+ 는 관찰된 네트워크 동작과 공개 정보에 기반한 독립 구현입니다.
어떤 제조사의 비공개 소스코드, 펌웨어, 또는 기밀 자료도 사용되지 않았습니다.
