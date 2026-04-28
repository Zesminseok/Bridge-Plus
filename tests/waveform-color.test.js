'use strict';

const assert = require('assert');
const path = require('path');

function test(name, fn){
  try { fn(); console.log(`ok - ${name}`); }
  catch(err){ console.error(`not ok - ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

const WFC = require(path.join(__dirname, '..', 'renderer', 'waveform-color.js'));

// 색 분류 헬퍼 — R/G/B 채널 비율로 대략적 색 카테고리 식별.
function colorCategory([r, g, b]){
  if(r < 0.05 && g < 0.05 && b < 0.05) return 'BLACK';
  if(r > 0.7 && g < 0.4 && b < 0.4) return 'RED';
  if(r > 0.6 && g > 0.5 && b < 0.4) return 'ORANGE';
  if(r < 0.4 && g > 0.5 && b < 0.4) return 'GREEN';
  if(r < 0.4 && g > 0.5 && b > 0.6) return 'CYAN';
  if(r < 0.4 && g < 0.4 && b > 0.7) return 'BLUE';
  if(r > 0.5 && g < 0.4 && b > 0.5) return 'MAGENTA';
  if(r > 0.6 && g > 0.4 && b > 0.5) return 'PINK';
  return `MIX(${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)})`;
}

// ─── rgbTraceColor: 튜너 도출 — R=lo, G=hi, B=hi+ai (mid 미사용) ───────────────

test('rgbTraceColor: pure low band (50Hz) → RED', () => {
  const c = WFC.rgbTraceColor(1, 0, 0, 0);
  assert.strictEqual(colorCategory(c), 'RED', `got ${colorCategory(c)} (${c.map(v=>v.toFixed(2))})`);
});

test('rgbTraceColor: pure mid band → GREEN (mid 가 G 채널 dominant)', () => {
  // 튜너 도출 — R: mi*0.10 (약), G: mi*1.85 (강), B: mi*0.45 (약). G dominant → GREEN.
  const c = WFC.rgbTraceColor(0, 1, 0, 0);
  assert.strictEqual(colorCategory(c), 'GREEN', `got ${colorCategory(c)} (${c.map(v=>v.toFixed(2))})`);
});

test('rgbTraceColor: pure high band → B dominant (B*1.60 > G*0.45)', () => {
  // R=0, G=hi*0.45=0.45, B=hi*1.60=1.60 → SAT/normalize 후 B=1, G≈0.20.
  const c = WFC.rgbTraceColor(0, 0, 1, 0);
  assert.strictEqual(c[2], 1, `B should be 1 (max) for pure hi, got B=${c[2].toFixed(2)}`);
  assert.ok(c[1] < 0.5, `G should be smaller than B, got G=${c[1].toFixed(2)}`);
});

test('rgbTraceColor: pure air band → pure BLUE', () => {
  const c = WFC.rgbTraceColor(0, 0, 0, 1);
  assert.strictEqual(colorCategory(c), 'BLUE', `got ${colorCategory(c)} (${c.map(v=>v.toFixed(2))})`);
});

test('rgbTraceColor: brightness-constant — max(R,G,B) 가 amplitude 무관 1.0', () => {
  // 새 normalize 정책: 시각적 밝기는 PCM peak 높이로만 표현, color value 자체는 항상 max=1.
  const lows = WFC.rgbTraceColor(0.3, 0, 0, 0);    // weak lo
  const highs = WFC.rgbTraceColor(0.9, 0, 0, 0);   // strong lo
  // 둘 다 max channel = 1 (color hue 동일, 밝기 안 변함).
  assert.ok(Math.max(...lows) > 0.99, `weak lo should still have max=1, got ${Math.max(...lows).toFixed(2)}`);
  assert.ok(Math.max(...highs) > 0.99, `strong lo should still have max=1, got ${Math.max(...highs).toFixed(2)}`);
});

test('rgbTraceColor: kick (lo+mi+hi mix, lo dominant) → RED-tinged', () => {
  // 강한 bass + 약한 mid harmonics + 미미한 hi/ai
  const c = WFC.rgbTraceColor(0.9, 0.3, 0.1, 0.05);
  // R should be high (lo dominant), G/B moderate
  assert.ok(c[0] > 0.7, `R should be high for kick, got ${c[0].toFixed(2)}`);
  assert.ok(c[1] < c[0], `G should be lower than R, got G=${c[1].toFixed(2)} R=${c[0].toFixed(2)}`);
});

test('rgbTraceColor: broadband content does NOT flatten to single GREEN', () => {
  // 모든 band 동일 → 다채널 mix → saturation boost 로 vivid MAGENTA (R+B 강함, G 약함).
  // 이전 centroid 방식은 GREEN 으로 평탄화 됐었음 → 직접 R/G/B 매핑 + SAT 2.20 으로 해결.
  const c = WFC.rgbTraceColor(0.5, 0.5, 0.5, 0.5);
  // GREEN-only 이면 안 됨 — broadband 은 magenta/pink 영역으로 이동.
  assert.notStrictEqual(colorCategory(c), 'GREEN', `broadband should NOT be pure GREEN, got ${colorCategory(c)}`);
  // R + B 가 G 보다 훨씬 강해야 함 (saturation boost 결과 magenta).
  assert.ok(c[0] + c[2] > c[1] * 2, `broadband should be R+B dominant (magenta), got R=${c[0].toFixed(2)} G=${c[1].toFixed(2)} B=${c[2].toFixed(2)}`);
});

test('rgbTraceColor: silent (all zero) → BLACK / very dark', () => {
  const c = WFC.rgbTraceColor(0, 0, 0, 0);
  assert.ok(c[0] < 0.05 && c[1] < 0.05 && c[2] < 0.05, 'silent input should produce dark color');
});

test('rgbTraceColor: clamps to [0, 1] range', () => {
  // 매우 큰 값 입력 — clamp 가 작동하는지
  const c = WFC.rgbTraceColor(2, 2, 2, 2);
  assert.ok(c[0] <= 1.0 && c[1] <= 1.0 && c[2] <= 1.0, 'all channels should be ≤ 1.0');
  assert.ok(c[0] >= 0.0 && c[1] >= 0.0 && c[2] >= 0.0, 'all channels should be ≥ 0.0');
});

test('rgbTraceColor: mid-amplitude content has reasonable brightness (BR 1.20 effect)', () => {
  // BR 1.20 적용 → 중간 amplitude 콘텐츠도 dark 하지 않아야 함.
  // Bassline 패턴 (lo+mi+hi+ai 모두 중간) 평균 밝기 60% 이상.
  const c = WFC.rgbTraceColor(0.7, 0.7, 0.5, 0.3);
  const bright = (c[0] + c[1] + c[2]) / 3;
  assert.ok(bright > 0.55, `bassline should be > 55% bright, got ${(bright*100).toFixed(0)}%`);
});

test('rgbTraceColor: handles negative inputs (treats as 0)', () => {
  const c = WFC.rgbTraceColor(-0.5, 0, 0, 0);
  assert.ok(c[0] < 0.05, 'negative lo should be treated as 0');
});

// ─── monoColor: 4-band tonal map (M_LOW → M_AIR) ──────────────────────────

test('monoColor: pure air → PURE WHITE (가장 높은 freq 표현)', () => {
  const c = WFC.monoColor(0, 0, 0, 1);
  // M_AIR = [1.000, 1.000, 1.000] (순백)
  assert.ok(c[0] > 0.99, `R should be ~1.0, got ${c[0].toFixed(2)}`);
  assert.ok(c[1] > 0.99, `G should be ~1.0, got ${c[1].toFixed(2)}`);
  assert.ok(c[2] > 0.99, `B should be ~1.0, got ${c[2].toFixed(2)}`);
});

test('monoColor: pure low → 어두운 적갈색', () => {
  const c = WFC.monoColor(1, 0, 0, 0);
  // M_LOW = [0.620, 0.220, 0.030] — bass band 시각 contrast 위해 어둡게
  assert.ok(c[0] > 0.5 && c[0] < 0.7, `R should be ~0.62, got ${c[0].toFixed(2)}`);
  assert.ok(c[1] < 0.3, `G should be ~0.22, got ${c[1].toFixed(2)}`);
  assert.ok(c[2] < 0.1, `B should be ~0.03, got ${c[2].toFixed(2)}`);
});

// ─── bandHeights: 4-band envelope 비율 ─────────────────────────────────────

test('bandHeights: BAND_RATIO 4-band tuner 매칭', () => {
  // 그리는 순서: BLUE outer → ORANGE → BROWN → WHITE (innermost top).
  // ratio: lo:0.95, mi:0.85, hi:0.90, ai:1.40 (튜너에서 도출).
  const h = WFC.bandHeights(0.5, 0.5, 0.5, 0.5, 100);
  assert.strictEqual(h.hLow, 0.5 * 100 * 0.95); // BLUE lo
  assert.strictEqual(h.hMid, 0.5 * 100 * 0.85); // BROWN mid
  assert.strictEqual(h.hHi,  0.5 * 100 * 0.90); // ORANGE hi
  assert.strictEqual(h.hAir, 0.5 * 100 * 1.40); // WHITE air (가장 큰 scale)
});

test('bandHeights: clamps band amplitudes to [0,1]', () => {
  const h = WFC.bandHeights(2, 2, 2, 2, 100);
  assert.strictEqual(h.hLow, 100 * 0.95);
  assert.strictEqual(h.hAir, 100 * 1.40);
});

// ─── peakBand: bass/mid 우세 + hi/air 약화 ─────────────────────────────────

test('peakBand: lo dominant', () => {
  const pk = WFC.peakBand(0.9, 0.3, 0.5, 0.2);
  assert.strictEqual(pk, 0.9, `should pick lo as peak`);
});

test('peakBand: hi/air weakened by 0.55/0.32', () => {
  // lo=0.5, hi*0.55=0.55, ai*0.32=0.16 → max = hi*0.55 = 0.55
  const pk = WFC.peakBand(0.5, 0, 1.0, 0);
  assert.strictEqual(pk, 0.55, `hi should be reduced by 0.55`);
});
