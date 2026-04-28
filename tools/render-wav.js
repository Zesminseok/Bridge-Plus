// WAV 분석 → 컬러 웨이브폼 HTML 렌더 (브라우저 렌더 없이 셰이더 색 결과 확인용).
// 사용: node tools/render-wav.js <input.wav> [output.html]
//   default output: /tmp/dwd-waveform.html
// rgbwf-worker.js 의 LR4 biquad 분석을 그대로 포팅 + waveform-gl.js 의 rgbTraceColor 색 적용.

'use strict';
const fs = require('fs');
const path = require('path');

// ──────────── WAV 디코더 (PCM 16/24/32 / float32 stereo/mono) ────────────
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not WAVE');
  let off = 12;
  let fmt = null, dataStart = 0, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      const audioFormat = buf.readUInt16LE(off + 8);
      const numChannels = buf.readUInt16LE(off + 10);
      const sampleRate = buf.readUInt32LE(off + 12);
      const bitsPerSample = buf.readUInt16LE(off + 22);
      fmt = { audioFormat, numChannels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      dataStart = off + 8;
      dataLen = sz;
    }
    off += 8 + sz + (sz & 1);
  }
  if (!fmt || !dataStart) throw new Error('missing fmt/data');
  const { audioFormat, numChannels, sampleRate, bitsPerSample } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const totalFrames = Math.floor(dataLen / (bytesPerSample * numChannels));
  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(new Float32Array(totalFrames));
  for (let i = 0; i < totalFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const off2 = dataStart + (i * numChannels + c) * bytesPerSample;
      let v = 0;
      if (audioFormat === 1) {
        if (bitsPerSample === 16) v = buf.readInt16LE(off2) / 32768;
        else if (bitsPerSample === 24) {
          const b0 = buf[off2], b1 = buf[off2 + 1], b2 = buf[off2 + 2];
          let n = (b2 << 16) | (b1 << 8) | b0;
          if (n & 0x800000) n |= ~0xffffff;
          v = n / 8388608;
        } else if (bitsPerSample === 32) v = buf.readInt32LE(off2) / 2147483648;
      } else if (audioFormat === 3 && bitsPerSample === 32) {
        v = buf.readFloatLE(off2);
      }
      channels[c][i] = v;
    }
  }
  return { sampleRate, durationMs: (totalFrames / sampleRate) * 1000, channels };
}

// ──────────── LR4 biquad — rgbwf-worker.js 와 동일 ────────────
function _mkBQ(fc, sr2, Q) {
  const w = 2 * Math.PI * fc / sr2, sn = Math.sin(w), cs = Math.cos(w), al = sn / (2 * Q), a0 = 1 + al;
  return { b0: ((1 - cs) / 2) / a0, b1: (1 - cs) / a0, b2: ((1 - cs) / 2) / a0, a1: (-2 * cs) / a0, a2: (1 - al) / a0, w1: 0, w2: 0 };
}
function _mkHP(fc, sr2, Q) {
  const w = 2 * Math.PI * fc / sr2, sn = Math.sin(w), cs = Math.cos(w), al = sn / (2 * Q), a0 = 1 + al;
  return { b0: ((1 + cs) / 2) / a0, b1: -(1 + cs) / a0, b2: ((1 + cs) / 2) / a0, a1: (-2 * cs) / a0, a2: (1 - al) / a0, w1: 0, w2: 0 };
}
function _bq(f, x) { const y = f.b0 * x + f.w1; f.w1 = f.b1 * x - f.a1 * y + f.w2; f.w2 = f.b2 * x - f.a2 * y; return y; }

function smoothEnv(src, attack, release) {
  const out = new Float32Array(src.length);
  let v = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    const k = x > v ? attack : release;
    v += (x - v) * k;
    out[i] = v;
  }
  return out;
}

function analyze(channels, sampleRate, durationMs, targetRate = 120) {
  const sr = sampleRate;
  const analysisDur = durationMs / 1000;
  const totalLen = channels[0].length;
  const pts = Math.min(8_000_000, Math.max(6000, Math.floor(analysisDur * targetRate)));
  const step = Math.max(1, Math.floor(totalLen / pts));
  const _Q1 = 0.5412, _Q2 = 1.3066;
  const lowCut = 90, midCut = 1600;
  const _lp250a = _mkBQ(lowCut, sr, _Q1), _lp250b = _mkBQ(lowCut, sr, _Q2);
  const _hp250a = _mkHP(lowCut, sr, _Q1), _hp250b = _mkHP(lowCut, sr, _Q2);
  const _lp2000a_mid = _mkBQ(midCut, sr, _Q1), _lp2000b_mid = _mkBQ(midCut, sr, _Q2);
  const _hp2000a = _mkHP(midCut, sr, _Q1), _hp2000b = _mkHP(midCut, sr, _Q2);
  const airCut = Math.min(8000, sr * 0.45);
  const _lp6000a_hi = _mkBQ(airCut, sr, _Q1), _lp6000b_hi = _mkBQ(airCut, sr, _Q2);
  const _hp6000a = _mkHP(airCut, sr, _Q1), _hp6000b = _mkHP(airCut, sr, _Q2);
  const chCount = channels.length;
  const envCurve = v => Math.pow(Math.min(1, Math.max(0, v)), 0.86);
  const raw = new Float32Array(pts * 8);
  let pkGlobal = 1e-6;
  for (let i = 0; i < pts; i++) {
    const s0 = i * step;
    let loPk = 0, miPk = 0, hiPk = 0, airPk = 0, fullMn = 0, fullMx = 0;
    let sumSq = 0, loSq = 0, miSq = 0, hiSq = 0, airSq = 0;
    for (let j = 0; j < step; j++) {
      let s = 0;
      for (let c = 0; c < chCount; c++) s += channels[c][s0 + j] || 0;
      s /= chCount;
      sumSq += s * s;
      const bass = _bq(_lp250b, _bq(_lp250a, s));
      const hp250 = _bq(_hp250b, _bq(_hp250a, s));
      const mid = _bq(_lp2000b_mid, _bq(_lp2000a_mid, hp250));
      const hp2000 = _bq(_hp2000b, _bq(_hp2000a, hp250));
      const hi = _bq(_lp6000b_hi, _bq(_lp6000a_hi, hp2000));
      const air = _bq(_hp6000b, _bq(_hp6000a, hp2000));
      if (!Number.isFinite(bass) || !Number.isFinite(mid) || !Number.isFinite(hi) || !Number.isFinite(air)) continue;
      loSq += bass * bass; miSq += mid * mid; hiSq += hi * hi; airSq += air * air;
      if (Math.abs(bass) > loPk) loPk = Math.abs(bass);
      if (Math.abs(mid) > miPk) miPk = Math.abs(mid);
      if (Math.abs(hi) > hiPk) hiPk = Math.abs(hi);
      if (Math.abs(air) > airPk) airPk = Math.abs(air);
      if (s < fullMn) fullMn = s; if (s > fullMx) fullMx = s;
    }
    const loRms = Math.sqrt(loSq / step), miRms = Math.sqrt(miSq / step),
          hiRms = Math.sqrt(hiSq / step), airRms = Math.sqrt(airSq / step);
    const ro = i * 8;
    raw[ro] = Math.max(loPk, loRms * 1.22);
    raw[ro + 1] = Math.max(miPk, miRms * 1.32);
    raw[ro + 2] = Math.max(hiPk, hiRms * 0.92);
    raw[ro + 3] = Math.max(airPk, airRms * 0.86);
    const pkBin = Math.max(raw[ro], raw[ro + 1], raw[ro + 2], raw[ro + 3], -fullMn, fullMx);
    if (pkBin > pkGlobal) pkGlobal = pkBin;
  }
  const invG = 1 / pkGlobal;
  const loSrc = new Float32Array(pts), miSrc = new Float32Array(pts),
        hiSrc = new Float32Array(pts), airSrc = new Float32Array(pts);
  for (let i = 0; i < pts; i++) {
    const ro = i * 8;
    loSrc[i] = envCurve(raw[ro] * invG);
    miSrc[i] = envCurve(raw[ro + 1] * invG);
    hiSrc[i] = envCurve(raw[ro + 2] * invG);
    airSrc[i] = envCurve(raw[ro + 3] * invG);
  }
  const loEnv = smoothEnv(loSrc, 0.88, 0.12);
  const miEnv = smoothEnv(miSrc, 0.88, 0.15);
  const hiEnv = smoothEnv(hiSrc, 0.88, 0.18);
  const airEnv = smoothEnv(airSrc, 0.82, 0.22);
  return { loEnv, miEnv, hiEnv, airEnv, pts, durationMs: analysisDur * 1000 };
}

// ──────────── Color formula (waveform-gl.js rgbTraceColor 와 동일) ────────────
const R_LOW = [1.000, 0.180, 0.100];
const R_MID = [0.300, 0.960, 0.250];
const R_HI  = [0.080, 0.820, 0.980];
const R_AIR = [0.080, 0.260, 1.000];

function rgbTraceColor(lo, mi, hi, ai) {
  const wLo = lo, wMi = mi * 0.85, wHi = hi * 1.40, wAi = ai * 1.70;
  const maxW = Math.max(wLo, wMi, wHi, wAi);
  if (maxW < 0.001) return [128, 128, 128];
  const pLo = Math.pow(wLo / maxW, 2.2);
  const pMi = Math.pow(wMi / maxW, 2.2);
  const pHi = Math.pow(wHi / maxW, 2.2);
  const pAi = Math.pow(wAi / maxW, 2.2);
  const sum = pLo + pMi + pHi + pAi;
  let cr = (R_LOW[0] * pLo + R_MID[0] * pMi + R_HI[0] * pHi + R_AIR[0] * pAi) / sum;
  let cg = (R_LOW[1] * pLo + R_MID[1] * pMi + R_HI[1] * pHi + R_AIR[1] * pAi) / sum;
  let cb = (R_LOW[2] * pLo + R_MID[2] * pMi + R_HI[2] * pHi + R_AIR[2] * pAi) / sum;
  const lum = cr * 0.299 + cg * 0.587 + cb * 0.114;
  cr = lum + (cr - lum) * 1.20; cg = lum + (cg - lum) * 1.20; cb = lum + (cb - lum) * 1.20;
  return [
    Math.max(0, Math.min(255, Math.round(cr * 255))),
    Math.max(0, Math.min(255, Math.round(cg * 255))),
    Math.max(0, Math.min(255, Math.round(cb * 255)))
  ];
}

// ──────────── HTML 출력 (canvas 로 waveform 그리기) ────────────
function buildHtml(analysisRes, sourcePath) {
  const { loEnv, miEnv, hiEnv, airEnv, pts, durationMs } = analysisRes;
  // bin 별 색 + envelope 높이 계산
  const colorBytes = [];
  const heights = [];
  for (let i = 0; i < pts; i++) {
    const lo = loEnv[i], mi = miEnv[i], hi = hiEnv[i], ai = airEnv[i];
    const peak = Math.max(lo, mi, hi, ai);
    const [r, g, b] = rgbTraceColor(lo, mi, hi, ai);
    colorBytes.push(`${r},${g},${b}`);
    heights.push(peak.toFixed(3));
  }
  const colors = colorBytes.join('|');
  const heightsArr = heights.join(',');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WAV Color Test</title>
<style>
body { margin: 0; background: #0b0d12; color: #ccc; font: 12px ui-monospace,monospace; padding: 20px; }
h2 { margin: 0 0 8px; color: #fff; }
.meta { color: #888; margin-bottom: 16px; font-size: 11px; }
canvas { width: 100%; height: 200px; display: block; background: #000; border: 1px solid #222; image-rendering: pixelated; }
.legend { display: flex; gap: 12px; margin-top: 16px; align-items: center; }
.swatch { display: inline-block; width: 14px; height: 14px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }
</style>
</head><body>
<h2>WAV Color Test — ${path.basename(sourcePath)}</h2>
<div class="meta">${pts} bins · ${(durationMs/1000).toFixed(2)}s · LR4 4-band analysis</div>
<canvas id="cv" width="${pts}" height="200"></canvas>
<div class="legend">
  <span><span class="swatch" style="background:rgb(255,46,26)"></span>lo (저음, &lt;250Hz)</span>
  <span><span class="swatch" style="background:rgb(77,245,64)"></span>mid (중음, 250-1.6k)</span>
  <span><span class="swatch" style="background:rgb(20,209,250)"></span>hi (고음, 1.6-8k)</span>
  <span><span class="swatch" style="background:rgb(20,66,255)"></span>air (초고음, &gt;8k)</span>
</div>
<script>
const COLORS = ${JSON.stringify(colors)}.split('|');
const HEIGHTS = ${JSON.stringify(heightsArr)}.split(',').map(parseFloat);
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const W = cv.width, H = cv.height, mid = H >> 1;
ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
ctx.fillStyle = 'rgba(255,255,255,0.08)';
ctx.fillRect(0, mid, W, 1);
for (let i = 0; i < W; i++) {
  const h = HEIGHTS[i] * (mid - 4);
  ctx.fillStyle = 'rgb(' + COLORS[i] + ')';
  ctx.fillRect(i, mid - h, 1, h * 2);
}
</script>
</body></html>`;
}

// ──────────── main ────────────
const inputPath = process.argv[2] || '/Users/zes2021/Downloads/dwd.wav';
const outputPath = process.argv[3] || '/tmp/dwd-waveform.html';
console.log(`[render-wav] reading ${inputPath}`);
const buf = fs.readFileSync(inputPath);
const wav = decodeWav(buf);
console.log(`[render-wav] decoded: ${wav.sampleRate}Hz · ${wav.channels.length}ch · ${(wav.durationMs/1000).toFixed(2)}s`);
const res = analyze(wav.channels, wav.sampleRate, wav.durationMs);
console.log(`[render-wav] analyzed: ${res.pts} bins`);
const html = buildHtml(res, inputPath);
fs.writeFileSync(outputPath, html);
console.log(`[render-wav] HTML 출력: ${outputPath}`);

// 시간별 샘플링 — 색 방향 검증 (sweep 이면 시간 흐를수록 lo→ai 진행해야 함)
console.log('\n[verify] time-sampled colors:');
const times = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1.0];
for (const t of times) {
  const idx = Math.min(res.pts - 1, Math.floor(t * res.pts));
  const lo = res.loEnv[idx], mi = res.miEnv[idx], hi = res.hiEnv[idx], ai = res.airEnv[idx];
  const [r, g, b] = rgbTraceColor(lo, mi, hi, ai);
  const dom = ['lo(red)', 'mi(green)', 'hi(cyan)', 'ai(blue)'][
    [lo, mi*0.85, hi*1.40, ai*1.70].reduce((iMax, v, i, arr) => v > arr[iMax] ? i : iMax, 0)
  ];
  const tSec = (t * res.durationMs / 1000).toFixed(2);
  const hex = '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
  console.log(`  t=${tSec}s  bands(lo/mi/hi/ai)=${lo.toFixed(2)}/${mi.toFixed(2)}/${hi.toFixed(2)}/${ai.toFixed(2)}  dom=${dom.padEnd(12)}  ${hex}`);
}
console.log(`\n[render-wav] 브라우저로 확인: open ${outputPath}`);
