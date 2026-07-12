# ORVIK Third-Party Notices

This file summarizes third-party trademark, protocol, and component notices for
ORVIK. It is informational and does not grant additional rights.

## AlphaTheta / Pioneer DJ / PRO DJ LINK

ORVIK is an independent third-party interoperability application. It is not
AlphaTheta's official PRO DJ LINK Bridge application and is not affiliated with,
endorsed by, sponsored by, approved by, licensed by, certified by, or otherwise
officially connected to AlphaTheta Corporation, Pioneer Corporation, Pioneer DJ,
or any related party.

References to Pioneer DJ, Pioneer, CDJ, DJM, PRO DJ LINK, rekordbox, or related
product and technology names are used only to describe compatibility targets.

Public AlphaTheta/Pioneer DJ materials identify Pioneer DJ and Pioneer as
trademarks of Pioneer Corporation used under license, and identify PRO DJ LINK
and rekordbox as trademarks or registered trademarks of AlphaTheta Corporation.
Public AlphaTheta/Pioneer DJ materials also describe PRO DJ LINK Bridge access
in the context of licensed companies and certified products. ORVIK makes no
claim to that status.

## TC Supply / ShowKontrol / TCNet

TC Supply describes TCNet as an open network protocol for exchanging
show-control information between lighting, video, and other entertainment
systems. ORVIK implements compatible TCNet output independently.

ORVIK is not ShowKontrol or BeatKontrol, does not include ShowKontrol or
BeatKontrol code, does not use TC Supply logos, and is not affiliated with,
endorsed by, sponsored by, approved by, licensed by, certified by, or supported
by TC Supply, Event Imagineering Group, ShowKontrol, or any related party.

References to TCNet, ShowKontrol, TC Supply, or Event Imagineering Group are
used only to describe protocol compatibility and interoperability.

## Runtime Components

ORVIK is built as an Electron desktop application (Electron 33.x). Electron
(MIT) bundles Chromium, Node.js, V8, ICU, and the FFmpeg library, among other
components; their license texts are distributed with the application as
`LICENSE.electron.txt` and `LICENSES.chromium.html`.

The bundled FFmpeg library is licensed under the GNU Lesser General Public
License and is distributed as an unmodified, dynamically linked library from
the official Electron distribution. Its corresponding source code is available
from the Electron and Chromium open-source projects
(https://github.com/electron/electron/releases). The ORVIK binary license
does not restrict rights granted by the LGPL for this component.

Runtime dependency:

- `qrcode` npm package: MIT License.

Bundled fonts:

- DSEG7 Classic, Noto Sans KR, DM Mono, Space Grotesk, and Inter:
  SIL Open Font License Version 1.1. See
  `renderer/fonts/LICENSE.txt` in the private source tree or bundled
  application notices where available.

## User Media

ORVIK does not grant rights to any music, metadata, album artwork, device
firmware, or third-party media. Users are responsible for ensuring that they
have the rights required to use, display, forward, or store any metadata,
artwork, or media-related information in their own workflow.

---

# ORVIK 서드파티 고지 요약

이 파일은 ORVIK의 서드파티 상표, 프로토콜, 구성요소 관련 고지를 정리한
문서이며, 추가 권리를 부여하지 않습니다.

ORVIK는 AlphaTheta의 공식 PRO DJ LINK Bridge 애플리케이션이 아니며,
AlphaTheta Corporation, Pioneer Corporation, Pioneer DJ 또는 관련 당사자와
제휴, 승인, 후원, 라이선스, 인증 또는 공식 연결 관계가 없습니다.

Pioneer DJ, Pioneer, CDJ, DJM, PRO DJ LINK, rekordbox 등의 명칭은 호환 대상
설명을 위해서만 사용됩니다. 공개 AlphaTheta/Pioneer DJ 자료는 Pioneer DJ와
Pioneer를 Pioneer Corporation의 상표로, PRO DJ LINK와 rekordbox를
AlphaTheta Corporation의 상표 또는 등록 상표로 안내합니다. 또한 PRO DJ LINK
Bridge 접근은 라이선스 회사 및 인증 제품 맥락에서 설명됩니다. ORVIK는
그 지위를 주장하지 않습니다.

TC Supply는 TCNet을 조명, 영상 및 기타 엔터테인먼트 시스템 간 쇼 컨트롤
정보를 교환하기 위한 open network protocol로 설명하며, 공개된 TCNet LINK
Specification(© Event Imagineering Group)은 "the protocol is open and free
to be used"라고 명시합니다. ORVIK는 이 공개 스펙을 기반으로 TCNet 호환
출력을 독립적으로 구현합니다. ORVIK는 ShowKontrol 또는 BeatKontrol이
아니며, 해당 코드를 포함하지 않고, TC Supply, Event Imagineering Group,
ShowKontrol 또는 관련 당사자의 승인, 인증, 지원 또는 라이선스 상태를 주장하지
않습니다.

ORVIK는 Electron(MIT) 데스크톱 앱이며 Chromium, Node.js, V8, ICU, FFmpeg
등을 함께 배포합니다. 각 라이선스 전문은 앱에 동봉된 `LICENSE.electron.txt`,
`LICENSES.chromium.html`에 있습니다. 번들된 FFmpeg 라이브러리는 GNU Lesser
General Public License(LGPL) 적용을 받는 무수정 동적 링크 라이브러리로,
소스 코드는 Electron/Chromium 오픈소스 프로젝트에서 구할 수 있습니다.
ORVIK 바이너리 라이선스는 이 구성요소에 대해 LGPL이 부여하는 권리를
제한하지 않습니다.

번들 폰트(DSEG7 Classic, Noto Sans KR, DM Mono, Space Grotesk, Inter)는
모두 SIL Open Font License 1.1 적용을 받으며, 저작권 고지와 라이선스 전문이
앱에 동봉되어 있습니다. QR 코드 생성은 MIT License 의 `qrcode` npm 패키지를
사용합니다.
