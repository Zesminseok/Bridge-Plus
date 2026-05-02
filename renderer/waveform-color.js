// renderer/waveform-color.js
// 웨이브폼 색 매핑 SSOT (Single Source of Truth).
// GLSL 셰이더 (waveform-gl.js) 와 CPU 비트맵 렌더러 (waveform-strip.js) 가 동일한 공식을 사용.
// 공식 변경 시 양쪽 모두 갱신할 것.

'use strict';

(function (root) {

  // ─── 3band 팔레트 — rekordbox 4-band (튜너 매칭) ───
  // 그리는 순서: BLUE (outermost) → ORANGE → BROWN → WHITE (innermost top).
  const C_LOW = [0.137, 0.392, 0.941]; // BLUE rgb(35,100,240) — bass (lo)
  const C_MID = [0.706, 0.373, 0.098]; // BROWN rgb(180,95,25) — mid
  const C_HI  = [1.000, 0.651, 0.008]; // ORANGE rgb(255,166,2) — hi
  const C_AIR = [0.961, 0.922, 0.824]; // cream WHITE rgb(245,235,210) — air

  // ─── RGB 팔레트 — rekordbox 스타일 6-stop (RED → ORANGE → GREEN → CYAN → BLUE → PURPLE) ───
  // 노랑 stop 만 제거 (mid 가 yellow 로 끌려가던 문제). violet 은 끝에 보존 — rekordbox 의
  // 12kHz+ air 톤이 purple/violet 으로 보이는 동작 매칭. 이전 5-stop 은 끝이 plain blue 라
  // air-dominant 콘텐츠 전부 같은 blue 로 평탄화 → 시각 변별력 떨어졌음.
  const RGB_GRADIENT = [
    [1.000, 0.180, 0.080],  // 0.00 — 진한 빨강 (sub bass <90Hz)
    [1.000, 0.500, 0.080],  // 0.20 — 주황 (bass 100-200Hz)
    [0.250, 0.880, 0.280],  // 0.50 — 그린 (mid 500Hz-1.6kHz)
    [0.100, 0.700, 0.980],  // 0.72 — 시안 (hi 2-6kHz)
    [0.100, 0.280, 1.000],  // 0.88 — 진한 파랑 (high-air)
    [0.620, 0.200, 0.980],  // 1.00 — 보라 (air-dominant ≥8kHz, rekordbox 매칭)
  ];
  const RGB_GRADIENT_POS = [0.00, 0.20, 0.50, 0.72, 0.88, 1.00];

  // 호환용 별칭 (구 코드 참조)
  const R_LOW = RGB_GRADIENT[0];  // red
  const R_MID = RGB_GRADIENT[2];  // green
  const R_HI  = RGB_GRADIENT[3];  // cyan-blue
  const R_AIR = RGB_GRADIENT[4];  // blue

  // ─── Mono — 4-band tonal map ──────────────────────────────────────────────
  // 명확한 band 구분: 어두운 적갈색 (sub) → 오렌지 (mid) → 밝은 베이지 (hi) → 순백 (air).
  // 사용자 피드백: "흰색이 더 많았으면" — mid/hi 도 밝게, air 는 순백.
  const M_LOW = [0.620, 0.220, 0.030]; // 어두운 적갈색 (sub)
  const M_MID = [1.000, 0.620, 0.180]; // 오렌지 (mid) — 좀 더 밝게
  const M_HI  = [1.000, 0.940, 0.780]; // 밝은 베이지 (hi) — 흰색 가깝게
  const M_AIR = [1.000, 1.000, 1.000]; // 순백 (air/sparkle)
  // 호환용 (기존 셰이더 GLSL 상수와 동기화)
  const ORG_SAT  = M_LOW;
  const WARM_WHT = M_AIR;

  const BG = [0.035, 0.040, 0.055];
  const BG_PLAYED = [0.050, 0.055, 0.075];

  // ─── 유틸 ───
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function mix3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ─── RGB 트레이스 — 직접 R/G/B 채널 매핑 ─────────────────────────────────
  // 4 band → R/G/B 직접 contribution: bass→R, mid→G, high→B, air→ B 위주 (purple 약화).
  // Saturation 1.30 + Brightness 1.20 으로 vivid + bright. 이전 centroid lookup 방식보다
  // broadband 콘텐츠도 다채로운 색 mix 가능 (이전엔 모두 GREEN 으로 평탄화됐음).
  function rgbTraceColor(lo, mi, hi, ai) {
    const _lo = Math.max(lo, 0), _mi = Math.max(mi, 0), _hi = Math.max(hi, 0), _ai = Math.max(ai, 0);
    // Band → RGB 채널 매핑 (RGB tuner 도출):
    // R = lo*3.00 + mi*0.10 (red bass + slight mid tint)
    // G = mi*1.85 + hi*0.45 + ai*0.55 (green mid + small hi/ai bleed)
    // B = mi*0.45 + hi*1.60 + ai*3.00 (cyan air + mid bleed)
    let r = _lo * 3.00 + _mi * 0.10;
    let g = _mi * 1.85 + _hi * 0.45 + _ai * 0.55;
    let b = _mi * 0.45 + _hi * 1.60 + _ai * 3.00;
    // SAT — dominant 채널 쪽으로 push (avg 기준 차이 amplification).
    const SAT = 1.30;
    const avg = (r + g + b) / 3;
    r = avg + (r - avg) * SAT;
    g = avg + (g - avg) * SAT;
    b = avg + (b - avg) * SAT;
    // Negative clamp.
    if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
    // Brightness 일관 normalize — 색이 섞여도 max(R,G,B)=1 유지.
    // 시각적 밝기 변화는 PCM peak 높이로만 (color value 가 아닌 height 가 dynamics 표현).
    const maxC = Math.max(r, g, b);
    if (maxC > 0.001) { r /= maxC; g /= maxC; b /= maxC; }
    else { r = g = b = 0; }
    return [r, g, b];
  }

  // ─── Mono 톤 — 4-band 가중평균 (band 별 tonal point 보간) ───
  // RGB 와 같은 dominance picking 이지만 출력 톤은 모노 팔레트 (M_LOW..M_AIR).
  // 흰색 더 많이: hi/air 가중치 boost (실제 음악에서 hi/air 가 amplitude 가 작아도 흰색 highlight 잘 보이도록).
  function monoColor(lo, mi, hi, ai) {
    const wLo = Math.max(lo, 0) * 0.95;
    const wMi = Math.max(mi, 0) * 0.95;
    const wHi = Math.max(hi, 0) * 1.20;  // hi 가중치 ↑
    const wAi = Math.max(ai, 0) * 1.45;  // air 가중치 ↑↑ — 흰색 highlight 더 자주
    const maxW = Math.max(wLo, wMi, wHi, wAi);
    if (maxW < 0.001) return [0.5, 0.4, 0.3];
    const pLo = Math.pow(wLo / maxW, 1.5);
    const pMi = Math.pow(wMi / maxW, 1.5);
    const pHi = Math.pow(wHi / maxW, 1.5);
    const pAi = Math.pow(wAi / maxW, 1.5);
    const sum = pLo + pMi + pHi + pAi;
    return [
      (M_LOW[0] * pLo + M_MID[0] * pMi + M_HI[0] * pHi + M_AIR[0] * pAi) / sum,
      (M_LOW[1] * pLo + M_MID[1] * pMi + M_HI[1] * pHi + M_AIR[1] * pAi) / sum,
      (M_LOW[2] * pLo + M_MID[2] * pMi + M_HI[2] * pHi + M_AIR[2] * pAi) / sum,
    ];
  }

  function hwPwv7Color(low, mid, hi) {
    const m = Math.max(low, mid, hi, 0.001);
    return [low / m, mid / m, hi / m];
  }

  // ─── HW 1-byte (preview/detail) → RGB ───
  // 이미 팔레트 RGB 가 r,g,b 슬롯에 기록되어 있음.
  function hwLegacyColor(r, g, b) { return [r || 0, g || 0, b || 0]; }

  function hwPointColor(p, isPwv7) {
    if (isPwv7) return hwPwv7Color(p.r || 0, p.g || 0, p.b || 0);
    return hwLegacyColor(p.r, p.g, p.b);
  }

  // ─── envelope 높이 (per-band 기여) ───
  // rekordbox 풍 — hi/air 를 boost 해서 흰색 highlight 가 크게 보임.
  // 음악에서 hi/air 는 amplitude 가 작지만 visual 균형 위해 1.3-1.7배 강조.
  // BAND_RATIO 는 셰이더 코드와 동기화 — 한 곳만 바꾸면 양쪽 다 갱신.
  // BAND_RATIO: 레코드박스 매칭 — lo 가 시각 dominant (가장 tall), mi/hi/ai 는 점진적 작은 tips.
  // 이전 동등한 ratio → 모든 layer 비슷 → mid/hi/ai 가 lo 덮어 BLUE bass 안 보이는 문제.
  // 신규 lo=1.30, mi=0.85, hi=0.65, ai=0.50: kick 은 BLUE 큰 spike + ORANGE/WHITE 작은 tips.
  const BAND_RATIO = { lo: 0.95, mi: 0.85, hi: 0.90, ai: 1.40 };
  function bandHeights(lo, mi, hi, ai, yLimit) {
    return {
      hLow: clamp(lo, 0, 1) * yLimit * BAND_RATIO.lo,
      hMid: clamp(mi, 0, 1) * yLimit * BAND_RATIO.mi,
      hHi:  clamp(hi, 0, 1) * yLimit * BAND_RATIO.hi,
      hAir: clamp(ai, 0, 1) * yLimit * BAND_RATIO.ai,
    };
  }

  // RGB/Mono 모드용 단일 envelope (peakBand) — bass+mid 우세, hi/air 기여 적음.
  function peakBand(lo, mi, hi, ai) {
    return Math.max(Math.max(lo, mi * 0.90), Math.max(hi * 0.55, ai * 0.32));
  }

  const API = {
    // 팔레트 상수
    C_LOW, C_MID, C_HI, C_AIR,
    R_LOW, R_MID, R_HI, R_AIR,
    M_LOW, M_MID, M_HI, M_AIR,
    ORG_SAT, WARM_WHT, BG, BG_PLAYED,
    BAND_RATIO,
    // 색 매핑
    rgbTraceColor, monoColor, hwPwv7Color, hwLegacyColor, hwPointColor,
    // envelope
    bandHeights, peakBand,
    // 유틸
    clamp, mix3, lerp,
  };

  // 브라우저 (Electron renderer) — 전역 등록
  if (typeof window !== 'undefined') window.WFColor = API;
  // Node / Worker
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
