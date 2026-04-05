# Pro DJ Link Bridge+

**Pioneer CDJ/DJM ↔ Resolume Arena** 실시간 브릿지 애플리케이션

Pioneer Pro DJ Link 네트워크의 CDJ/DJM 상태를 읽어 TCNet, Art-Net Timecode, LTC, MIDI 등 다양한 프로토콜로 변환하여 Resolume Arena와 실시간 동기화합니다.

## 주요 기능

- **Pro DJ Link 수신** — CDJ 재생 상태, BPM, 피치, 비트 위치, 트랙 정보 자동 감지
- **DJM 페이더/미터** — 채널 페이더 값 및 VU 미터 실시간 모니터링
- **TCNet 출력** — Resolume Arena/Wire에 타임코드 및 레이어 상태 전송
- **Art-Net Timecode** — ArtTimeCode 패킷으로 SMPTE 타임코드 브로드캐스트
- **LTC 오디오 출력** — 오디오 장치별 Linear Timecode 생성
- **MIDI Clock/MTC** — BPM 동기화 및 MIDI Timecode 출력
- **Virtual Deck** — 하드웨어 없이 로컬 MP3 파일로 테스트 가능
- **RGB 웨이브폼** — BLUE / RGB / 3BAND 컬러 프리셋 지원
- **비트 페이저** — 비트 동기화 시각 피드백 (Scroll / Blink 모드)

## 스크린샷

> 추후 추가 예정

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

| 프로토콜 | 방향 | 설명 |
|---------|------|------|
| Pro DJ Link | 입력 | CDJ/DJM 상태 수신 |
| TCNet | 출력 | Resolume Arena 레이어 제어 |
| Art-Net | 출력 | ArtTimeCode (SMPTE) |
| LTC | 출력 | Linear Timecode 오디오 |
| MIDI | 출력 | Clock, MTC, CC |

## 모드

- **Virtual 모드** — 소프트웨어 가상 덱으로 로컬 파일 재생 및 테스트
- **Hardware 모드** — 실제 CDJ/DJM 장비 연결, 자동 감지 및 동기화

## 라이선스

MIT

## 크레딧

- [Deep Symmetry / dysentery](https://github.com/Deep-Symmetry/dysentery) — Pro DJ Link 프로토콜 리버스 엔지니어링 참고
- Electron + Web Audio API 기반
