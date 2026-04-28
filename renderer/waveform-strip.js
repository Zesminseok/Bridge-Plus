// renderer/waveform-strip.js
// 풀-트랙 웨이브폼 비트맵 사전 렌더러.
// 셰이더 매 프래그먼트 envelope/색 합성 → CPU 1회 풀 컬러 비트맵 → GL 단순 텍스처 패닝.
// 효과: (1) 빠른 스크롤 지글거림 원천 제거, (2) GPU 비용 감소, (3) detail/overview 동일 비트맵 → 색 자동 일치.
//
// 출력: OffscreenCanvas (또는 fallback HTMLCanvasElement) — RGBA premultiplied.
//   alpha = envelope 마스크 (0=BG, 1=opaque 색) → GL 셰이더가 base BG 위에 합성.
//   width = pts (GPU MAX_TEXTURE_SIZE 초과 시 peak-pool 다운샘플)
//   height = 입력 H (보통 detail canvas 높이의 1~1.5x)

'use strict';

(function (root) {

  const WFC = (typeof window !== 'undefined' && window.WFColor) || (typeof require === 'function' ? require('./waveform-color.js') : null);
  if (!WFC) throw new Error('waveform-strip.js: WFColor 모듈이 필요합니다');

  // wfData 액세스 헬퍼 — index.html getBin() 과 동일.
  // wfData 형식: 배열 of {r,g,b,a,h} (0-1) 또는 packed Uint8Array (8 byte stride).
  function wfLen(wfData) {
    if (wfData instanceof Uint8Array && wfData._packed) return Math.floor(wfData.length / 8);
    return (wfData && wfData.length) || 0;
  }

  function wfBin(wfData, i) {
    if (wfData instanceof Uint8Array && wfData._packed) {
      const o = i * 8;
      // signed mn/mx — encU 역변환: byte 0 → -1, 255 → 1.
      const mn = wfData[o + 4] / 127.5 - 1.0;
      const mx = wfData[o + 5] / 127.5 - 1.0;
      return {
        r: wfData[o]     / 255,
        g: wfData[o + 1] / 255,
        b: wfData[o + 2] / 255,
        a: wfData[o + 3] / 255,
        mn, mx,
        h: Math.max(wfData[o + 6] / 255, wfData[o + 7] / 255),
      };
    }
    return wfData[i] || null;
  }

  // peak-pool 다운샘플 (texture 폭 < pts 일 때, 작은 piek 보존).
  function poolBin(wfData, j0, j1) {
    let r = 0, g = 0, b = 0, a = 0, h = 0;
    for (let j = j0; j < j1; j++) {
      const p = wfBin(wfData, j);
      if (!p) continue;
      if (p.r > r) r = p.r;
      if (p.g > g) g = p.g;
      if (p.b > b) b = p.b;
      if (p.a > a) a = p.a;
      if (p.h > h) h = p.h;
    }
    return { r, g, b, a, h };
  }

  // 픽셀별 색 산출 — 셰이더 main() 과 동치.
  // theme: 0=3band, 1=RGB, 2=Mono.
  // 반환: { hLow, hMid, hHi, hAir, hPeak, lowCol, midCol, hiCol, airCol, traceCol }
  // (3band 는 layer 색이 고정 상수, RGB/Mono 는 traceCol 단일 사용)
  function colsForBin(p, theme, yLimit, isHw, isPwv7) {
    let lo = p.r, mi = p.g, hi = p.b, ai = p.a;
    // HW 모드 — band 슬롯 의미가 다름. PWV7 은 (low,mid,hi), 1-byte preview 는 이미 RGB.
    // strip 렌더에서 HW 는 rekordbox 풍 4-band 가 아니라 단일 색 + 높이 (h) 로 표현.
    if (isHw) {
      const col = WFC.hwPointColor(p, isPwv7);
      const hAll = (p.h || Math.max(lo, mi, hi)) * yLimit;
      return {
        mode: 'hw',
        hAll,
        col,
      };
    }
    const heights = WFC.bandHeights(lo, mi, hi, ai, yLimit);
    const pk = WFC.peakBand(lo, mi, hi, ai);
    if (theme === 1) {
      return { mode: 'rgb', hPeak: pk * yLimit, traceCol: WFC.rgbTraceColor(lo, mi, hi, ai), energy: WFC.clamp(pk, 0, 1), heights };
    }
    if (theme === 2) {
      return { mode: 'mono', hPeak: pk * yLimit, traceCol: WFC.monoColor(lo, mi, hi, ai), energy: WFC.clamp(pk, 0, 1), heights };
    }
    // 3band — band amplitude × BAND_RATIO (lo dominance). bandHeights() 가 이미 그 비율 적용.
    return { mode: '3band', heights };
  }

  // smoothstep AA 마스크 — 셰이더 symMask 와 동일.
  function symMask(yRel, h, aa) {
    const H = h < 0 ? 0 : h;
    if (H + aa < Math.abs(yRel)) return 0;
    if (Math.abs(yRel) < H - aa) return 1;
    // smoothstep 상하 결합
    const t1 = (yRel - (-H - aa)) / (2 * aa);
    const lower = t1 <= 0 ? 0 : (t1 >= 1 ? 1 : t1 * t1 * (3 - 2 * t1));
    const t2 = (yRel - (H - aa)) / (2 * aa);
    const upStep = t2 <= 0 ? 0 : (t2 >= 1 ? 1 : t2 * t2 * (3 - 2 * t2));
    return lower * (1 - upStep);
  }

  // RGB blend over base — premultiplied alpha 기반.
  // base: [r,g,b,a], color: [r,g,b], maskAlpha: 0..1.
  function blendLayer(base, color, maskAlpha, layerAlpha) {
    const a = WFC.clamp(maskAlpha * layerAlpha, 0, 1);
    base[0] = base[0] * (1 - a) + color[0] * a;
    base[1] = base[1] * (1 - a) + color[1] * a;
    base[2] = base[2] * (1 - a) + color[2] * a;
    if (a > base[3]) base[3] = a;
  }

  /**
   * 비트맵 빌드.
   * @param {object} opts
   * @param {*}      opts.wfData     - getBin 호환 (배열 또는 packed Uint8Array)
   * @param {number} opts.theme      - 0=3band, 1=RGB, 2=Mono
   * @param {number} opts.height     - 비트맵 H (px). 일반적으로 detail canvas 높이.
   * @param {number} [opts.maxWidth] - 최대 W (GPU MAX_TEXTURE_SIZE 고려, 기본 8192).
   * @param {boolean} [opts.isHw]    - HW 덱 데이터 여부.
   * @param {boolean} [opts.isPwv7]  - PWV7 high-res 여부.
   * @param {number} [opts.aa]       - envelope edge AA px (기본 0.9 — 부드러운 rekordbox 느낌).
   * @param {number} [opts.yScale]   - waveform 가용 영역 비율 (기본 0.94, 셰이더 sLow 와 동기).
   * @returns {OffscreenCanvas|HTMLCanvasElement}
   */
  function buildStrip(opts) {
    const wfData = opts.wfData;
    const theme  = opts.theme | 0;
    const H      = Math.max(8, opts.height | 0);
    const maxW   = opts.maxWidth | 0 || 8192;
    const isHw   = !!opts.isHw;
    const isPwv7 = !!opts.isPwv7;
    const AA     = opts.aa != null ? +opts.aa : 0.9;
    const yScale = opts.yScale != null ? +opts.yScale : 0.94;

    const n = wfLen(wfData);
    if (n < 2) return null;

    // 저해상도 입력 (1pass 진행 중 / HW preview 30pt 등) 은 upsample → 인접 bin 보간으로
    // 매끈한 envelope. 30 columns 단편화 → 화면 가로폭 stretch 시 균일 peak 반복으로 보이는 문제 해결.
    const TARGET_SMOOTH_W = 4096;
    const W = (n < TARGET_SMOOTH_W) ? Math.min(maxW, TARGET_SMOOTH_W) : Math.min(maxW, n);
    const stride = n / W;
    const upsample = stride < 1;

    const cv = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(W, H)
      : (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; })();
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);
    const buf = img.data;

    const midY  = H * 0.5;
    const yLim  = midY * yScale;

    // 가로 가우시안 블러 — 약간 rekordbox 느낌 (1-pass 3-tap [1,2,1]/4 효과적).
    // 일반적인 5-tap 보다 가벼움. 가로 픽셀 보간만 (envelope 모양 보존).
    // 실제 적용은 라스터 후 별도 패스, 여기서는 마지막에.

    // 픽셀 작성 — 위쪽 절반만 계산 후 미러 (envelope 대칭성 활용).
    // y=0 (top), y=H-1 (bottom). midY 기준 yRel = y - midY.
    const halfH = Math.ceil(midY);

    for (let x = 0; x < W; x++) {
      let p;
      if (upsample) {
        // 인접 bin linear interp — 저해상도 입력의 height/color 사이 부드럽게.
        const fbin = x * stride;
        const j0 = Math.floor(fbin);
        const j1 = Math.min(n - 1, j0 + 1);
        const t = fbin - j0;
        const p0 = wfBin(wfData, j0);
        const p1 = wfBin(wfData, j1);
        if (!p0) continue;
        if (!p1 || t === 0) p = p0;
        else {
          p = {
            r: p0.r + (p1.r - p0.r) * t,
            g: p0.g + (p1.g - p0.g) * t,
            b: p0.b + (p1.b - p0.b) * t,
            a: p0.a + (p1.a - p0.a) * t,
            h: p0.h + (p1.h - p0.h) * t,
          };
        }
      } else {
        const j0 = Math.floor(x * stride);
        const j1 = Math.min(n, Math.max(j0 + 1, Math.floor((x + 1) * stride)));
        p = (j1 - j0 <= 1) ? wfBin(wfData, j0) : poolBin(wfData, j0, j1);
        if (!p) continue;
      }
      const cols = colsForBin(p, theme, yLim, isHw, isPwv7);

      for (let yi = 0; yi < halfH; yi++) {
        // 상단 반: yRel < 0. 하단 미러 시 부호만 다름 (symMask 는 |yRel| 사용).
        const yRel = (halfH - 1 - yi) - 0; // 0..halfH-1 → midY 기준 거리 (양수)

        const base = [0, 0, 0, 0];

        if (cols.mode === 'hw') {
          const m = symMask(yRel, cols.hAll, AA);
          if (m > 0.001) blendLayer(base, cols.col, m, 1.0);
        } else if (cols.mode === '3band') {
          const h = cols.heights;
          const mLow = symMask(yRel, h.hLow, AA);
          const mMid = symMask(yRel, h.hMid, AA);
          const mHi  = symMask(yRel, h.hHi,  AA);
          const mAir = symMask(yRel, h.hAir, AA);
          // 그리는 순서: BLUE → ORANGE → BROWN → WHITE (WHITE 가장 위/안쪽).
          if (mLow > 0.001) blendLayer(base, WFC.C_LOW, mLow, 0.97);
          if (mHi  > 0.001) blendLayer(base, WFC.C_HI,  mHi,  0.95);
          if (mMid > 0.001) blendLayer(base, WFC.C_MID, mMid, 0.94);
          if (mAir > 0.001) blendLayer(base, WFC.C_AIR, mAir, 0.96);
        } else {
          // rgb / mono — 단일 envelope (peakBand)
          const m = symMask(yRel, cols.hPeak, AA);
          if (m > 0.001) {
            // 에너지 변조 (작으면 어둡게, 크면 밝게)
            const e = cols.energy;
            const k = cols.mode === 'rgb' ? (0.62 + (1.22 - 0.62) * e) : (0.65 + (1.10 - 0.65) * e);
            const c = [
              WFC.clamp(cols.traceCol[0] * k, 0, 1.2),
              WFC.clamp(cols.traceCol[1] * k, 0, 1.2),
              WFC.clamp(cols.traceCol[2] * k, 0, 1.2),
            ];
            // RGB 모드: 중심선 살짝 밝게 (셰이더 yCore highlight 와 등가, premultiplied)
            if (cols.mode === 'rgb') {
              const hRef = Math.max(cols.heights.hLow, 1);
              const yCore = 1 - WFC.clamp(yRel / hRef, 0, 1);
              const hi = Math.pow(yCore, 3) * e;
              c[0] = WFC.clamp(c[0] + 0.18 * hi, 0, 1.2);
              c[1] = WFC.clamp(c[1] + 0.18 * hi, 0, 1.2);
              c[2] = WFC.clamp(c[2] + 0.20 * hi, 0, 1.2);
            }
            blendLayer(base, c, m, 1.0);
          }
        }

        // 위쪽 픽셀
        const yTop = yi;
        const oTop = (yTop * W + x) * 4;
        // premultiplied: r,g,b 이미 alpha 곱해진 상태가 아닌 straight RGBA. GL strip 셰이더에서 mix 사용.
        buf[oTop]     = (base[0] * 255) | 0;
        buf[oTop + 1] = (base[1] * 255) | 0;
        buf[oTop + 2] = (base[2] * 255) | 0;
        buf[oTop + 3] = (base[3] * 255) | 0;
        // 미러 (하단)
        const yBot = H - 1 - yi;
        if (yBot !== yTop) {
          const oBot = (yBot * W + x) * 4;
          buf[oBot]     = buf[oTop];
          buf[oBot + 1] = buf[oTop + 1];
          buf[oBot + 2] = buf[oTop + 2];
          buf[oBot + 3] = buf[oTop + 3];
        }
      }
    }

    // 가로 1-pass 블러 ([1,2,1]/4) — rekordbox 풍 부드러움.
    // 가로만 → envelope 수직 모양 보존. ImageData 직접 가공.
    if (W >= 4) {
      const tmp = new Uint8ClampedArray(buf.length);
      for (let y = 0; y < H; y++) {
        const row = y * W * 4;
        for (let x = 0; x < W; x++) {
          const xm = x === 0 ? x : x - 1;
          const xp = x === W - 1 ? x : x + 1;
          const om = row + xm * 4;
          const oc = row + x  * 4;
          const op = row + xp * 4;
          tmp[oc]     = (buf[om]     + 2 * buf[oc]     + buf[op])     >> 2;
          tmp[oc + 1] = (buf[om + 1] + 2 * buf[oc + 1] + buf[op + 1]) >> 2;
          tmp[oc + 2] = (buf[om + 2] + 2 * buf[oc + 2] + buf[op + 2]) >> 2;
          tmp[oc + 3] = (buf[om + 3] + 2 * buf[oc + 3] + buf[op + 3]) >> 2;
        }
      }
      buf.set(tmp);
    }

    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // wfData 용 캐시 키 — 데이터 ref + theme + height + 파라미터 종합.
  // 입력 데이터 자체는 hash 가 없으므로 length + 일부 sample 으로 fingerprint.
  function buildKey(wfData, theme, height, isHw, isPwv7) {
    const n = wfLen(wfData);
    let s0 = 0, s1 = 0, s2 = 0;
    if (n > 4) {
      const a = wfBin(wfData, 0); const b = wfBin(wfData, n >> 1); const c = wfBin(wfData, n - 1);
      if (a) s0 = ((a.r * 255) | 0) ^ ((a.g * 255) | 0) << 8 ^ ((a.b * 255) | 0) << 16;
      if (b) s1 = ((b.r * 255) | 0) ^ ((b.g * 255) | 0) << 8 ^ ((b.b * 255) | 0) << 16;
      if (c) s2 = ((c.r * 255) | 0) ^ ((c.g * 255) | 0) << 8 ^ ((c.b * 255) | 0) << 16;
    }
    return `${n}|${theme}|${height}|${isHw ? 1 : 0}|${isPwv7 ? 1 : 0}|${s0}|${s1}|${s2}`;
  }

  const API = { buildStrip, buildKey, wfLen, wfBin };

  if (typeof window !== 'undefined') window.WFStrip = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
