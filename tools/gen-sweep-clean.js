// 깨끗한 단일 log frequency sweep WAV — 색공식 검증용.
// 출력: 30초 연속 log sweep 20Hz → 20kHz. 각 시점이 특정 주파수에 대응 → 색 spectrum 한 눈에 검증.
// 사용: node tools/gen-sweep-clean.js [output.wav] [duration_s] [f_start] [f_end]
//   default: /tmp/bridge-sweep-clean.wav 30s 20Hz→20kHz

'use strict';
const fs = require('fs');

const SR = 44100;
const outPath = process.argv[2] || '/tmp/bridge-sweep-clean.wav';
const DUR = +(process.argv[3]) || 30;
const F0  = +(process.argv[4]) || 20;
const F1  = +(process.argv[5]) || 20000;

const totalSamples = Math.floor(DUR * SR);
const samples = new Float32Array(totalSamples);

// log sweep: f(t) = F0 * (F1/F0)^(t/DUR), phase = ∫ 2πf dt
// φ(t) = 2π * F0 * DUR / log(F1/F0) * ((F1/F0)^(t/DUR) - 1)
const k = Math.log(F1 / F0);
const A = (2 * Math.PI * F0 * DUR) / k;
// 시작/종료 5ms fade — DC click 방지
const fadeN = Math.min(Math.floor(0.005 * SR), Math.floor(totalSamples / 100));

for (let i = 0; i < totalSamples; i++) {
  const t = i / SR;
  const tau = t / DUR;
  const phase = A * (Math.exp(k * tau) - 1);
  let g = 0.7;
  if (i < fadeN)                  g *= i / fadeN;
  else if (i > totalSamples - fadeN) g *= (totalSamples - i) / fadeN;
  samples[i] = g * Math.sin(phase);
}

// 16-bit PCM mono WAV
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
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(dataSize, 40);

fs.writeFileSync(outPath, Buffer.concat([header, pcm]));

console.log(`[sweep] ${outPath}`);
console.log(`  duration: ${DUR}s @ ${SR}Hz, mono 16-bit (${(fileSize/1024).toFixed(1)} KB)`);
console.log(`  log sweep: ${F0}Hz → ${F1}Hz`);
console.log(`  시각 검증: 좌→우 진행 시 빨강 → 노랑 → 그린 → 시안 → 파랑 → 보라 부드러운 그라디언트 기대.`);
console.log(`  주파수 → 위치: t = log(f/${F0})/log(${F1}/${F0}) × ${DUR}s`);
console.log(`    ex) 80Hz   = ${(Math.log(80/F0)/k*DUR).toFixed(2)}s   (bass 영역)`);
console.log(`    ex) 500Hz  = ${(Math.log(500/F0)/k*DUR).toFixed(2)}s   (mid 영역)`);
console.log(`    ex) 3500Hz = ${(Math.log(3500/F0)/k*DUR).toFixed(2)}s   (hi 영역)`);
console.log(`    ex) 12kHz  = ${(Math.log(12000/F0)/k*DUR).toFixed(2)}s   (air 영역)`);
