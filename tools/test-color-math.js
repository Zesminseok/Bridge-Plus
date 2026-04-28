// 셰이더 색공식 검증 — Node 단독 실행. 다양한 band envelope 조합으로 RGB 결과 확인.
// 사용: node tools/test-color-math.js

// rekordbox 매핑: lo=빨강, mid=그린, hi=시안, air=파랑.
const R_LOW = [1.000, 0.180, 0.100];
const R_MID = [0.300, 0.960, 0.250];
const R_HI  = [0.080, 0.820, 0.980];
const R_AIR = [0.080, 0.260, 1.000];

const ORG_SAT  = [1.000, 0.520, 0.060];
const WARM_WHT = [1.000, 0.965, 0.880];

function mix(a, b, t) { return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
function dot(c) { return c[0]*0.299 + c[1]*0.587 + c[2]*0.114; }
function sat(c, factor) {
  const lum = dot(c);
  return [lum + (c[0]-lum)*factor, lum + (c[1]-lum)*factor, lum + (c[2]-lum)*factor];
}
function clamp01(c) { return [Math.max(0, Math.min(1.2, c[0])), Math.max(0, Math.min(1.2, c[1])), Math.max(0, Math.min(1.2, c[2]))]; }
function toRGB255(c) { return [Math.round(Math.min(255, c[0]*255)), Math.round(Math.min(255, c[1]*255)), Math.round(Math.min(255, c[2]*255))]; }

// 셰이더와 동일한 RGB dominance picking
function rgbTraceColor(lo, mi, hi, ai) {
  const wLo = lo, wMi = mi*0.85, wHi = hi*1.40, wAi = ai*1.70;
  const maxW = Math.max(wLo, wMi, wHi, wAi);
  if (maxW < 0.001) return [0.5, 0.5, 0.5];
  const pLo = Math.pow(wLo/maxW, 2.2);
  const pMi = Math.pow(wMi/maxW, 2.2);
  const pHi = Math.pow(wHi/maxW, 2.2);
  const pAi = Math.pow(wAi/maxW, 2.2);
  const sum = pLo + pMi + pHi + pAi;
  let c = [
    (R_LOW[0]*pLo + R_MID[0]*pMi + R_HI[0]*pHi + R_AIR[0]*pAi)/sum,
    (R_LOW[1]*pLo + R_MID[1]*pMi + R_HI[1]*pHi + R_AIR[1]*pAi)/sum,
    (R_LOW[2]*pLo + R_MID[2]*pMi + R_HI[2]*pHi + R_AIR[2]*pAi)/sum,
  ];
  c = sat(c, 1.20);
  return clamp01(c);
}
function dominantBand(lo, mi, hi, ai) {
  const w = [lo, mi*0.85, hi*1.40, ai*1.70];
  let i=0; for (let k=1; k<4; k++) if (w[k]>w[i]) i=k;
  return ['lo(blue)','mi(green)','hi(orange)','ai(magenta)'][i];
}

// 셰이더와 동일한 Mono saturation 변조
function monoColor(lo, mi, hi, ai) {
  const peakBand = Math.max(lo, mi, hi, ai);
  const bandSum = Math.max(lo + mi + hi*1.2 + ai*1.4, 0.001);
  const trebleRatio = Math.max(0, Math.min(1, (hi*1.2 + ai*1.4) / bandSum));
  const satCurve = Math.pow(trebleRatio, 0.7);
  let c = mix(ORG_SAT, WARM_WHT, satCurve);
  const bright = 0.65 + 0.45 * Math.min(1, peakBand);
  c = [c[0]*bright, c[1]*bright, c[2]*bright];
  return clamp01(c);
}

const cases = [
  // [name, lo, mi, hi, ai]
  ['silence',           0.00, 0.00, 0.00, 0.00],
  ['kick (bass only)',  0.95, 0.10, 0.05, 0.00],
  ['sub bass',          0.85, 0.05, 0.00, 0.00],
  ['bassline + kick',   0.80, 0.30, 0.10, 0.05],
  ['vocal mid',         0.20, 0.85, 0.30, 0.10],
  ['snare',             0.30, 0.70, 0.65, 0.40],
  ['hi-hat',            0.05, 0.15, 0.85, 0.70],
  ['cymbal/treble',     0.05, 0.10, 0.40, 0.95],
  ['lead synth (mid+hi)', 0.10, 0.55, 0.85, 0.40],
  ['full mix loud',     0.85, 0.80, 0.70, 0.55],
  ['full mix quiet',    0.20, 0.18, 0.15, 0.10],
  ['breakdown',         0.10, 0.25, 0.05, 0.02],
  ['drop',              0.95, 0.85, 0.75, 0.65],
];

console.log('━━━ RGB dominance picking ━━━');
console.log('case'.padEnd(24), 'dominant       ', 'rgb            ', 'hex');
for (const [name, lo, mi, hi, ai] of cases) {
  const dom = dominantBand(lo, mi, hi, ai);
  const c = rgbTraceColor(lo, mi, hi, ai);
  const r = toRGB255(c);
  const hex = '#' + r.map(x => x.toString(16).padStart(2,'0')).join('');
  console.log(
    name.padEnd(24),
    dom.padEnd(15),
    ('rgb('+r[0]+','+r[1]+','+r[2]+')').padEnd(15),
    hex
  );
}

console.log('\n━━━ Mono saturation ━━━');
console.log('case'.padEnd(24), 'tRatio', 'rgb            ', 'hex');
for (const [name, lo, mi, hi, ai] of cases) {
  const bandSum = Math.max(lo + mi + hi*1.2 + ai*1.4, 0.001);
  const tRatio = Math.max(0, Math.min(1, (hi*1.2 + ai*1.4) / bandSum));
  const c = monoColor(lo, mi, hi, ai);
  const r = toRGB255(c);
  const hex = '#' + r.map(x => x.toString(16).padStart(2,'0')).join('');
  console.log(
    name.padEnd(24),
    tRatio.toFixed(3).padEnd(6),
    ('rgb('+r[0]+','+r[1]+','+r[2]+')').padEnd(15),
    hex
  );
}

// dominance distribution
console.log('\n━━━ Dominant band distribution ━━━');
const domCount = { 'lo(blue)':0, 'mi(green)':0, 'hi(orange)':0, 'ai(magenta)':0 };
for (const [name, lo, mi, hi, ai] of cases) {
  if (lo+mi+hi+ai < 0.05) continue;
  const dom = dominantBand(lo, mi, hi, ai);
  domCount[dom]++;
}
console.log(Object.entries(domCount).map(([k,v]) => k+':'+v).join(', '));
console.log('non-zero dominants:', Object.values(domCount).filter(v => v>0).length, '/ 4');
