# BRIDGE+ — Notice & Disclaimers

## Trademark Notice

BRIDGE+ is an independent third-party application created to enable interoperability between compatible DJ hardware and visual / lighting software. It is **not affiliated with, endorsed by, sponsored by, approved by, or certified by AlphaTheta Corporation, Pioneer DJ, Tom Cosm Technologies, or any other mentioned party.**

The following are trademarks (or registered trademarks) of their respective owners:

- **Pioneer DJ**, **CDJ**, **DJM**, **Pro DJ Link**, **rekordbox** — AlphaTheta Corporation  
- **TCNet**, **ShowKontrol** — Tom Cosm Technologies (TC Supply)  
- **Resolume Arena**, **Resolume Wire** — Resolume B.V.  
- **Ableton Link**, **Ableton Live** — Ableton AG  
- **Art-Net** — Artistic Licence Holdings Ltd.  
- **grandMA** — MA Lighting Technology GmbH  
- **QLC+** — Massimo Callegari and contributors  
- **Wirecast** — Telestream, LLC  

All trademarks are used solely for descriptive purposes related to interoperability and compatibility. No trademark use in this repository or binary distribution should be understood as an endorsement, sponsorship, certification, or official relationship.

---

## Bundled Third-Party Assets

The following bundled assets are used under their respective licenses:

- **Fonts** (`renderer/fonts/`): DSEG7 Classic and Noto Sans KR — both licensed under
  the SIL Open Font License Version 1.1. See `renderer/fonts/LICENSE.txt`.
- **Default placeholder artwork** (`default-album-artwork.png`, `renderer/assets/default-art.png`):
  Simple solid-color placeholders included with this project under Apache License 2.0.

BRIDGE+ release packages do **not** include Ableton Link source code, the Ableton Link SDK,
or any Ableton Link native binary.

---

## Optional Ableton Link Module

BRIDGE+ can optionally load a user-installed compatible Link module from the documented
application support path or from `BRIDGE_ABLETON_LINK_MODULE`. That module is not part of
the default BRIDGE+ binary distribution.

Ableton Link is published by Ableton as a dual-licensed technology: GPLv2+ or a separate
proprietary license. Users or distributors who build, install, bundle, or redistribute an
optional Ableton Link module are responsible for complying with that module's license and
the applicable Ableton Link license. See:

- <https://ableton.github.io/>
- <https://github.com/Ableton/link/blob/master/LICENSE.md>
- <https://www.ableton.com/en/link/>

---

## Protocol Implementation

BRIDGE+ communicates with external systems based on **observed network behavior and publicly available information**.

Its functionality is designed to interpret and translate network events between different systems for interoperability purposes. No proprietary source code, firmware, or confidential materials from any manufacturer have been used in the development of this software.

Certain identifier strings or protocol-level values that may appear in network communication are handled strictly for compatibility with existing systems and are not used as branding or representation in user-facing contexts.

BRIDGE+ is distributed as a binary application. Certain interoperability components are not published as source code. These components are included only to support compatibility with user-owned systems and are not represented as official, certified, or manufacturer-approved implementations.

---

## License

The BRIDGE+ application code and bundled BRIDGE+ assets are released under the Apache
License 2.0 unless a file states otherwise.

Optional user-installed modules are separate components and remain under their own licenses.

---

## Disclaimer

BRIDGE+ is provided "AS IS", without warranty of any kind, express or implied. The authors are not liable for any damages or losses arising from the use of this software.

Users are responsible for ensuring that their use of BRIDGE+ complies with applicable laws, as well as any agreements, terms of service, or policies associated with third-party hardware and software.

If you choose to redistribute BRIDGE+ or use it in a commercial environment, you are solely responsible for ensuring compliance with all applicable legal and trademark requirements in your jurisdiction.

---

---

# BRIDGE+ — 고지 및 면책 조항 (Korean Version)

## 상표 고지

BRIDGE+는 호환 DJ 하드웨어와 비주얼/조명 소프트웨어 간의 상호운용성을 지원하기 위해 제작된 독립적인 서드파티 애플리케이션입니다.<br>
본 소프트웨어는 **AlphaTheta Corporation, Pioneer DJ, Tom Cosm Technologies 또는 기타 언급된 어떠한 기업과도 제휴, 승인, 후원, 인증 관계가 없습니다.**

다음 상표는 각 소유자의 등록 상표 또는 상표입니다:

- **Pioneer DJ**, **CDJ**, **DJM**, **Pro DJ Link**, **rekordbox** — AlphaTheta Corporation  
- **TCNet**, **ShowKontrol** — Tom Cosm Technologies (TC Supply)  
- **Resolume Arena**, **Resolume Wire** — Resolume B.V.  
- **Ableton Link**, **Ableton Live** — Ableton AG  
- **Art-Net** — Artistic Licence Holdings Ltd.  
- **grandMA** — MA Lighting Technology GmbH  
- **QLC+** — Massimo Callegari 및 기여자  
- **Wirecast** — Telestream, LLC  

모든 상표는 상호운용성 및 호환성 설명을 위한 목적으로만 사용됩니다. 이 저장소 또는 바이너리 배포물의 상표 사용은 보증, 후원, 인증 또는 공식 관계를 의미하지 않습니다.

---

## 프로토콜 구현

BRIDGE+는 **관찰된 네트워크 동작 및 공개된 정보**를 기반으로 외부 시스템과 통신합니다.

본 소프트웨어는 서로 다른 시스템 간의 상호운용성을 위해 네트워크 이벤트를 해석하고 변환하는 기능을 제공합니다. 개발 과정에서 어떠한 제조사의 비공개 소스 코드, 펌웨어, 또는 기밀 자료도 사용되지 않았습니다.

네트워크 통신 과정에서 일부 식별 문자열 또는 프로토콜 값이 사용될 수 있으나, 이는 기존 시스템과의 호환성을 위한 것이며 사용자에게 표시되는 브랜딩 목적으로 사용되지 않습니다.

BRIDGE+는 바이너리 애플리케이션으로 배포됩니다. 일부 상호운용성 컴포넌트는 소스 코드로 공개되지 않습니다. 해당 컴포넌트는 사용자가 소유한 시스템과의 호환성을 지원하기 위한 목적으로만 포함되며, 공식 구현, 인증 구현, 또는 제조사 승인 구현으로 표시되지 않습니다.

---

## 선택적 Ableton Link

기본 BRIDGE+ 릴리스 패키지는 Ableton Link 소스 코드, Ableton Link SDK, Ableton Link 네이티브 바이너리를 포함하지 않습니다.

BRIDGE+는 사용자가 문서화된 앱 지원 경로 또는 `BRIDGE_ABLETON_LINK_MODULE` 환경 변수로 호환 Link 모듈을 직접 설치한 경우에만 선택적으로 로드합니다. 이 선택 모듈은 기본 BRIDGE+ 바이너리 배포물의 일부가 아닙니다.

Ableton Link는 GPL-2.0 또는 Ableton AG의 별도 상용 라이선스 조건으로 제공됩니다. 선택적 Ableton Link 모듈을 직접 빌드, 설치, 번들 포함, 재배포하는 사용자 또는 배포자는 해당 모듈의 라이선스와 적용 가능한 Ableton Link 라이선스 조건을 준수할 책임이 있습니다.

---

## 라이선스

BRIDGE+ 애플리케이션 코드와 BRIDGE+에 포함된 기본 자산은 별도 표시가 없는 한 Apache License 2.0 으로 배포됩니다.

사용자가 별도로 설치하는 선택 모듈은 독립 구성요소이며, 각 모듈의 자체 라이선스를 따릅니다.

---

## 면책 조항

BRIDGE+는 "있는 그대로(AS IS)" 제공되며, 명시적 또는 묵시적 어떠한 보증도 제공하지 않습니다. 본 소프트웨어 사용으로 인해 발생하는 어떠한 손해나 손실에 대해서도 개발자는 책임을 지지 않습니다.

사용자는 BRIDGE+의 사용이 관련 법률 및 제3자 하드웨어/소프트웨어의 이용약관, 정책 등을 준수하는지에 대해 스스로 책임을 집니다.

BRIDGE+를 재배포하거나 상업적으로 사용할 경우, 해당 관할 지역의 법률 및 상표 관련 요구사항을 준수할 책임은 전적으로 사용자에게 있습니다.
