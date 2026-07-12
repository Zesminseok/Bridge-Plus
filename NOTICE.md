# ORVIK — Notice & Disclaimers

## Trademark Notice

ORVIK is an independent third-party application created to enable interoperability between compatible DJ hardware and visual / lighting software. It is **not affiliated with, endorsed by, sponsored by, approved by, licensed by, certified by, or otherwise officially connected to AlphaTheta Corporation, Pioneer Corporation, Pioneer DJ, TC Supply, Event Imagineering Group, ShowKontrol, or any other mentioned party.**

The following are trademarks (or registered trademarks) of their respective owners:

- **Pioneer DJ** and **Pioneer** — trademarks of Pioneer Corporation, used by AlphaTheta under license
- **CDJ**, **DJM**, **PRO DJ LINK**, **rekordbox**, and related product or technology names — trademarks or registered trademarks of AlphaTheta Corporation or their respective owners
- **TCNet**, **ShowKontrol**, **TC Supply**, and related names or logos — marks, protocol names, product names, or trade names associated with TC Supply and/or Event Imagineering Group
- **Resolume Arena**, **Resolume Wire** — Resolume B.V.  
- **Art-Net** — Artistic Licence Holdings Ltd.  

All trademarks are used solely for descriptive purposes related to interoperability and compatibility. No trademark use in this repository or binary distribution should be understood as an endorsement, sponsorship, certification, or official relationship.

ORVIK is not AlphaTheta's official PRO DJ LINK Bridge application and is not a PRO DJ LINK licensed company product or certified product. References to PRO DJ LINK, Pioneer DJ, CDJ, DJM, and rekordbox describe compatibility targets only.

TC Supply describes TCNet as an open network protocol for exchanging show-control information between lighting, video, and other entertainment systems, and the publicly available TCNet LINK Specification (© Event Imagineering Group) states that "the protocol is open and free to be used". ORVIK implements compatible TCNet output independently from that public specification. ORVIK does not include ShowKontrol or BeatKontrol code, does not use TC Supply logos, and does not claim TC Supply or Event Imagineering Group endorsement, certification, support, or license status.

---

## Bundled Third-Party Assets

The following bundled assets are used under their respective licenses:

- **Fonts** (`renderer/fonts/`): DSEG7 Classic, Noto Sans KR, DM Mono, Space Grotesk,
  and Inter — all licensed under the SIL Open Font License Version 1.1.
  See `renderer/fonts/LICENSE.txt`.
- **Default placeholder artwork** (`default-album-artwork.png`, `renderer/assets/default-art.png`):
  Simple solid-color placeholders included with ORVIK and governed by the ORVIK
  Binary License unless a file states otherwise.
- **QR code generation** (`qrcode` npm package): MIT License.

## Protocol Implementation

ORVIK communicates with external systems based on **observed network behavior and publicly available information**.

Its functionality is designed to interpret and translate network events between different systems for interoperability purposes. No proprietary source code, firmware, confidential materials, licensed SDK, or non-public PRO DJ LINK network documentation from any manufacturer have been used in the development of this software. No third-party software was decompiled, disassembled, or otherwise code-analyzed: compatibility was achieved solely by observing network traffic between devices the developer owns or lawfully operates, a method consistent with interoperability principles recognized in major jurisdictions (including 17 U.S.C. § 1201(f), Directive 2009/24/EC, and Article 101-4 of the Korean Copyright Act).

Certain identifier strings or protocol-level values that may appear in network communication are handled strictly for compatibility with existing systems and are not used as branding or representation in user-facing contexts.

ORVIK does not copy audio content, decrypt protected media, or bypass access controls. Track metadata and artwork are displayed or forwarded only from user-controlled libraries or connected devices; users are responsible for having the necessary rights to use that media and artwork.

---

## License

This public repository is governed by the ORVIK Public Repository License in `LICENSE`.

ORVIK desktop binaries are proprietary demo binaries governed by `BINARY_LICENSE.md` and by any terms shown in the application or release materials. This build has no time limit at this time; if a future release adds one, demo expiration will not block application launch and ORVIK would continue only the basic Pro DJ Link to TCNet output described in the binary license, while extended features are disabled. No permission is granted to copy, modify, redistribute, mirror, sell, sublicense, or reverse engineer ORVIK except where applicable law cannot restrict those rights.

Donations, sponsorships, tips, or similar payments are voluntary development support. They do not purchase a license, unlock paid functionality, transfer ownership, create a support obligation, create a warranty, or grant redistribution, modification, reverse-engineering, trademark, commercial resale, or source-code rights unless a separate written agreement expressly says so.

Bundled third-party components remain under their respective licenses.


---

## Disclaimer

ORVIK is provided "AS IS", without warranty of any kind, express or implied. The authors are not liable for any damages or losses arising from the use of this software.

Users are responsible for ensuring that their use of ORVIK complies with applicable laws, as well as any agreements, terms of service, or policies associated with third-party hardware and software.

ORVIK may not be redistributed without prior written permission. If a separate written agreement permits redistribution or commercial deployment, you are solely responsible for ensuring compliance with all applicable legal and trademark requirements in your jurisdiction.

---

---

# ORVIK — 고지 및 면책 조항 (Korean Version)

## 상표 고지

ORVIK는 호환 DJ 하드웨어와 비주얼/조명 소프트웨어 간의 상호운용성을 지원하기 위해 제작된 독립적인 서드파티 애플리케이션입니다.<br>
본 소프트웨어는 **AlphaTheta Corporation, Pioneer Corporation, Pioneer DJ, TC Supply, Event Imagineering Group, ShowKontrol 또는 기타 언급된 어떠한 기업과도 제휴, 승인, 후원, 라이선스, 인증 또는 공식 연결 관계가 없습니다.**

다음 상표는 각 소유자의 등록 상표 또는 상표입니다:

- **Pioneer DJ**, **Pioneer** — Pioneer Corporation의 상표이며 AlphaTheta가 라이선스에 따라 사용합니다.
- **CDJ**, **DJM**, **PRO DJ LINK**, **rekordbox** 및 관련 제품/기술명 — AlphaTheta Corporation 또는 각 권리자의 상표 또는 등록 상표입니다.
- **TCNet**, **ShowKontrol**, **TC Supply** 및 관련 명칭/로고 — TC Supply 및/또는 Event Imagineering Group과 관련된 표장, 프로토콜명, 제품명 또는 상호입니다.
- **Resolume Arena**, **Resolume Wire** — Resolume B.V.  
- **Art-Net** — Artistic Licence Holdings Ltd.  

모든 상표는 상호운용성 및 호환성 설명을 위한 목적으로만 사용됩니다. 이 저장소 또는 바이너리 배포물의 상표 사용은 보증, 후원, 인증 또는 공식 관계를 의미하지 않습니다.

ORVIK는 AlphaTheta의 공식 PRO DJ LINK Bridge 애플리케이션이 아니며, PRO DJ LINK 라이선스 회사의 제품 또는 인증 제품이 아닙니다. PRO DJ LINK, Pioneer DJ, CDJ, DJM, rekordbox에 대한 언급은 호환 대상 설명을 위한 것입니다.

TC Supply는 TCNet을 조명, 영상 및 기타 엔터테인먼트 시스템 간 쇼 컨트롤 정보를 교환하기 위한 open network protocol로 설명하며, 공개된 TCNet LINK Specification(© Event Imagineering Group)은 "the protocol is open and free to be used"라고 명시합니다. ORVIK는 이 공개 스펙을 기반으로 TCNet 호환 출력을 독립적으로 구현합니다. ORVIK에는 ShowKontrol 또는 BeatKontrol 코드가 포함되어 있지 않으며, TC Supply 로고를 사용하지 않고, TC Supply 또는 Event Imagineering Group의 승인, 인증, 지원 또는 라이선스 상태를 주장하지 않습니다.

---

## 번들 서드파티 자산

- **폰트** (`renderer/fonts/`): DSEG7 Classic, Noto Sans KR, DM Mono, Space Grotesk,
  Inter — 모두 SIL Open Font License 1.1. 상세는 앱에 동봉된 `renderer/fonts/LICENSE.txt` 참조.
- **기본 앨범아트 플레이스홀더**: ORVIK 에 포함된 단색 이미지 (바이너리 라이선스 적용).
- **QR 코드 생성** (`qrcode` npm 패키지): MIT License.

---

## 프로토콜 구현

ORVIK는 **관찰된 네트워크 동작 및 공개된 정보**를 기반으로 외부 시스템과 통신합니다.

본 소프트웨어는 서로 다른 시스템 간의 상호운용성을 위해 네트워크 이벤트를 해석하고 변환하는 기능을 제공합니다. 개발 과정에서 어떠한 제조사의 비공개 소스 코드, 펌웨어, 기밀 자료, 라이선스 SDK 또는 비공개 PRO DJ LINK 네트워크 문서도 사용되지 않았습니다. 어떠한 제3자 소프트웨어도 디컴파일, 디스어셈블 또는 코드 분석하지 않았으며, 호환성은 개발자가 소유하거나 적법하게 운용하는 장비 간 네트워크 트래픽 관찰만으로 확보되었습니다. 이는 주요 관할권에서 인정되는 상호운용성 원칙(미국 17 U.S.C. § 1201(f), EU 지침 2009/24/EC, 대한민국 저작권법 제101조의4 등)과 부합하는 방식입니다.

네트워크 통신 과정에서 일부 식별 문자열 또는 프로토콜 값이 사용될 수 있으나, 이는 기존 시스템과의 호환성을 위한 것이며 사용자에게 표시되는 브랜딩 목적으로 사용되지 않습니다.

ORVIK는 오디오 콘텐츠를 복사하거나 보호된 미디어를 복호화하거나 접근 제어를 우회하지 않습니다. 트랙 메타데이터와 앨범아트는 사용자가 관리하는 라이브러리 또는 연결된 장치에서 전달되는 범위에서만 표시/전송되며, 해당 미디어와 이미지 사용 권한은 사용자 책임입니다.

## 라이선스

이 공개 저장소는 `LICENSE`의 ORVIK Public Repository License 적용을 받습니다.

ORVIK 데스크톱 바이너리는 `BINARY_LICENSE.md` 및 앱/릴리스 자료에 표시된 조건의 적용을 받는 독점 데모 바이너리입니다. 이 빌드는 현재 기간 제한이 없습니다. 향후 기간 제한이 추가되더라도 데모 종료가 앱 실행을 차단하지 않으며, 바이너리 라이선스에 설명된 기본 Pro DJ Link → TCNet 출력만 계속 작동하고 확장 기능은 비활성화됩니다. 관련 법률상 제한할 수 없는 경우를 제외하고 ORVIK의 복사, 수정, 재배포, 미러링, 판매, 재라이선스, 리버스 엔지니어링은 허용되지 않습니다.

도네이션, 후원, 팁 또는 유사한 지급은 자발적인 개발 지원입니다. 별도 서면 계약이 없는 한 라이선스 구매, 유료 기능 해금, 소유권 이전, 지원 의무, 보증, 재배포 권한, 수정 권한, 리버스 엔지니어링 권한, 상표 권한, 상업 재판매 권한, 소스 코드 권한을 의미하지 않습니다.

포함된 서드파티 구성요소는 각 라이선스를 따릅니다.
QR 코드 생성 기능은 MIT License 의 `qrcode` npm 패키지를 사용합니다.


---

## 면책 조항

ORVIK는 "있는 그대로(AS IS)" 제공되며, 명시적 또는 묵시적 어떠한 보증도 제공하지 않습니다. 본 소프트웨어 사용으로 인해 발생하는 어떠한 손해나 손실에 대해서도 개발자는 책임을 지지 않습니다.

사용자는 ORVIK의 사용이 관련 법률 및 제3자 하드웨어/소프트웨어의 이용약관, 정책 등을 준수하는지에 대해 스스로 책임을 집니다.

ORVIK는 사전 서면 허가 없이 재배포할 수 없습니다. 별도 서면 계약으로 재배포 또는 상업적 배포가 허용된 경우에도, 해당 관할 지역의 법률 및 상표 관련 요구사항을 준수할 책임은 전적으로 사용자에게 있습니다.
