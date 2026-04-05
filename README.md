# BRIDGE+ — Pro DJ Link Bridge

**Pioneer CDJ/DJM ↔ Resolume Arena** Professional DJ Bridge Application

Pioneer Pro DJ Link 네트워크의 CDJ/DJM 상태를 실시간으로 읽어 TCNet, Art-Net Timecode, LTC, MIDI 등 다양한 프로토콜로 변환하여 Resolume Arena와 동기화합니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| **Pro DJ Link 수신** | CDJ 재생 상태, BPM, 피치, 비트 위치, 트랙 정보 자동 감지 |
| **DJM 페이더/미터** | 채널 페이더 값 및 15-band VU 미터 실시간 모니터링 |
| **TCNet 출력** | Resolume Arena/Wire에 타임코드 + 레이어 상태 전송 (최대 6레이어) |
| **Art-Net Timecode** | ArtTimeCode 패킷으로 SMPTE 타임코드 브로드캐스트 |
| **LTC 오디오 출력** | AudioWorklet 기반 Linear Timecode 생성 |
| **MIDI Clock/MTC** | BPM 동기화 및 MIDI Timecode 출력 |
| **Virtual Deck** | 하드웨어 없이 로컬 MP3 파일로 테스트 가능 (최대 6덱) |
| **RGB 웨이브폼** | IIR 밴드스플릿 필터 — BLUE / RGB / 3BAND 컬러 프리셋 |
| **CDJ-3000 웨이브폼** | 컬러/모노 프리뷰 + 디테일 웨이브폼 수신 |
| **비트 그리드** | dbserver 비트그리드(0x2204) 파싱 + 오버레이 |
| **큐 포인트** | Hot Cue / Memory Cue 마커 표시 + 메모리 |
| **앨범아트** | TCP dbserver로 CDJ에서 JPEG 아트워크 요청 |
| **비트 페이저** | 4-segment 비트 시각화 (Scroll / Blink 모드) |

## 디자인 시스템

**BRIDGE+ Onyx Studio** — "The Tactile Command Center"

- **컬러**: Deep obsidian tonal layering (#111318 → #0c0e12 → #282a2e)
- **폰트**: Plus Jakarta Sans (UI) + Space Grotesk (라벨) + DM Mono (데이터)
- **악센트**: Primary Green (#5af0b3), Secondary Blue (#a4c9ff), Tertiary Gold (#ffd16d)
- **컴포넌트**: No-border 디자인, Ambient Glow, Glassmorphism
- **Stitch 프로젝트**: 4개 화면 (LINK, PRO DJ LINK, TCNet, SETTINGS)

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 실행
npm start
```

## 시스템 요구사항

- macOS / Windows / Linux
- Node.js 18+
- Electron 33+
- Pioneer CDJ/DJM (Pro DJ Link 지원 모델) 또는 Virtual Deck 모드

## 지원 프로토콜

| 프로토콜 | 방향 | 포트 | 설명 |
|---------|------|------|------|
| Pro DJ Link | 입력 | 50001/50002 | CDJ/DJM 상태 수신 |
| dbserver | 입출력 | 12523 | 웨이브폼, 큐 포인트, 비트그리드, 앨범아트 |
| TCNet | 출력 | 60000-60002 | Resolume Arena 레이어 제어 |
| Art-Net | 출력 | 6454 | ArtTimeCode (SMPTE) |
| LTC | 출력 | Audio | Linear Timecode 오디오 |
| MIDI | 출력 | Virtual | Clock, MTC, CC |

## 모드

- **Virtual 모드** — 소프트웨어 가상 덱으로 로컬 파일 재생 및 테스트
- **Hardware 모드** — 실제 CDJ/DJM 장비 연결, 자동 감지 및 동기화

## 버전 히스토리

자세한 변경 내역은 [CHANGELOG.md](CHANGELOG.md) 참고

## 라이선스

MIT

## 크레딧

- [Deep Symmetry / dysentery](https://github.com/Deep-Symmetry/dysentery) — Pro DJ Link 프로토콜 리버스 엔지니어링 참고
- [Stitch by Google](https://stitch.withgoogle.com) — UI 디자인 시스템 생성
- Electron + Web Audio API 기반
