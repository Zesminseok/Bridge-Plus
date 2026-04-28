// 패턴 검증용 테스트 음원 생성기.
// 4개 band 별 pure sine + 조합 → 우리 색공식이 정확히 매핑하는지 확인.
// 사용: node tools/gen-test-tones.js [output.wav]
//   default: /tmp/bridge-test-tones.wav

'use strict';
const fs = require('fs');

const SR = 44100;
const SECTIONS = [
  // [duration_s, freq_hz, label]
  [1.0, 0,    'silence'],
  [1.5, 50,   'lo (sub bass)'],         // <90Hz → 빨강
  [1.5, 500,  'mi (mid)'],              // 90-1.6k → 그린
  [1.5, 3500, 'hi (treble)'],           // 1.6-8k → 시안
  [1.5, 12000,'ai (air)'],              // >8k → 파랑
  [1.0, 0,    'silence'],
  // sweep + chord
  [2.0, [50, 12000], 'sweep 50Hz→12kHz'],
  [1.0, 0,    'silence'],
  // chord (4-band 동시)
  [1.5, [50, 500, 3500, 12000], 'chord (모든 band)'],
];

let totalSamples = 0;
for (const [dur] of SECTIONS) totalSamples += Math.floor(dur * SR);

const samples = new Float32Array(totalSamples);
let cursor = 0;
console.log('[gen] sections:');
for (const [dur, freq, label] of SECTIONS) {
  const N = Math.floor(dur * SR);
  const tStart = cursor / SR;
  if (freq === 0) {
    // silence
  } else if (Array.isArray(freq) && freq.length === 2) {
    // sweep (log scale)
    const f0 = freq[0], f1 = freq[1];
    const k = Math.log(f1 / f0) / dur;
    let phase = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const f = f0 * Math.exp(k * t);
      phase += 2 * Math.PI * f / SR;
      samples[cursor + i] = 0.55 * Math.sin(phase);
    }
  } else if (Array.isArray(freq)) {
    // chord — 모든 freq 합산
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      let s = 0;
      for (const f of freq) s += Math.sin(2 * Math.PI * f * t);
      samples[cursor + i] = (s / freq.length) * 0.7;
    }
  } else {
    // pure sine
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      samples[cursor + i] = 0.7 * Math.sin(2 * Math.PI * freq * t);
    }
  }
  console.log(`  ${tStart.toFixed(2)}s..${(tStart + dur).toFixed(2)}s  ${label}`);
  cursor += N;
}

// 16-bit PCM mono WAV 작성
const pcm = Buffer.alloc(totalSamples * 2);
for (let i = 0; i < totalSamples; i++) {
  const v = Math.max(-1, Math.min(1, samples[i]));
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}
const dataSize = pcm.length;
const fileSize = 36 + dataSize;
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(fileSize, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);             // PCM
header.writeUInt16LE(1, 22);             // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(dataSize, 40);
const out = Buffer.concat([header, pcm]);
const outPath = process.argv[2] || '/tmp/bridge-test-tones.wav';
fs.writeFileSync(outPath, out);
console.log(`\n[gen] 출력: ${outPath} (${(out.length / 1024).toFixed(1)} KB, ${(totalSamples/SR).toFixed(2)}s)`);
console.log(`\n앱에서 이 파일 열고 RGB 모드로 보면 구간별 색 검증 가능:`);
console.log(`  silence(회색) → 빨강(lo) → 그린(mi) → 시안(hi) → 파랑(ai) → 회색 → sweep(red→blue) → 회색 → 모든 band 동시`);
console.log(`\n또는 색공식 직접 확인: node tools/render-wav.js ${outPath} /tmp/test-tones.html`);
