// RGB 웨이브폼 분석 — 별도 CPU 코어에서 실행 (메인 스레드 0% blocking, HW 재생/TCNet 보호).
// AudioContext.decodeAudioData 는 main 에서 수행 후 Float32Array channels 만 transfer.
// raw 분석 루프 진행 중 약 10 단계로 partial wf 를 emit → UI 즉시 progressive 페인트.
// 최종 단계: 평활화 (smoothEnv) 적용 + 최종 정규화로 wf 전체 재인코딩 → 'done'.

self.addEventListener('message', (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'analyze') analyzeWf(msg);
  } catch (err) {
    self.postMessage({ type: 'error', jobId: msg?.jobId, error: err?.message || String(err) });
  }
});

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

// Moving average — smooth slider 용 후처리. kernel=1 = no-op.
function movingAverage(src, kernel) {
  if (kernel <= 1) return src;
  const N = src.length, out = new Float32Array(N);
  const half = (kernel - 1) >> 1;
  let sum = 0, count = 0;
  for (let i = 0; i < Math.min(half, N); i++) { sum += src[i]; count++; }
  for (let i = 0; i < N; i++) {
    const add = i + half;
    if (add < N) { sum += src[add]; count++; }
    const rem = i - half - 1;
    if (rem >= 0) { sum -= src[rem]; count--; }
    out[i] = sum / count;
  }
  return out;
}

function analyzeWf({ jobId, channels, sampleRate, durationMs, targetDurMs, targetRate, shapeMode, cutoffs, releases, smooth }) {
  // 4-band 정의 — 각 band 의 upper edge frequency. message 의 cutoffs 가 오면 override (theme-specific 분석).
  // Project default = 3band 튜너 도출 값.
  const _ct = cutoffs || {};
  const LO_TOP = _ct.loTop ?? 500;
  const MID_TOP = _ct.midTop ?? 1750;
  const HI_TOP = _ct.hiTop ?? 9800;
  const AIR_TOP = _ct.airTop ?? 22000;
  // smoothEnv release — band 별 envelope decay 길이. message override 가능.
  const _rl = releases || {};
  const RL_LO = _rl.lo ?? 0.023;
  const RL_MI = _rl.mi ?? 0.061;
  const RL_HI = _rl.hi ?? 0.179;
  const RL_AIR = _rl.air ?? 0.464;
  // post-pass moving average kernel — 추가 smoothness. message override 가능.
  const _sm = smooth || {};
  const SM_LO = Math.max(1, Math.round(_sm.lo ?? 1));
  const SM_MI = Math.max(1, Math.round(_sm.mi ?? 3));
  const SM_HI = Math.max(1, Math.round(_sm.hi ?? 5));
  const SM_AIR = Math.max(1, Math.round(_sm.air ?? 1));
  const sr = sampleRate;
  const analysisDur = Math.max(0.001, (targetDurMs && targetDurMs > 0) ? targetDurMs / 1000 : (durationMs / 1000));
  const totalLen = channels[0].length;
  const pts = Math.min(8_000_000, Math.max(6000, Math.floor(analysisDur * targetRate)));
  const step = Math.max(1, Math.floor(totalLen / pts));
  // 실제 효과적 rate — pts 가 min 6000 으로 강제되면 targetRate 와 다름.
  // 짧은 트랙 (예: 7s 드럼 루프) 에서 색 lookup 이 시간축 따라 늘어나는 버그 방지.
  const effectiveRate = pts / analysisDur;

  const _Q1 = 0.5412, _Q2 = 1.3066;
  const cLOtop = LO_TOP, cMIDtop = MID_TOP;
  const _lp250a = _mkBQ(cLOtop, sr, _Q1), _lp250b = _mkBQ(cLOtop, sr, _Q2);
  const _hp250a = _mkHP(cLOtop, sr, _Q1), _hp250b = _mkHP(cLOtop, sr, _Q2);
  const _lp2000a_mid = _mkBQ(cMIDtop, sr, _Q1), _lp2000b_mid = _mkBQ(cMIDtop, sr, _Q2);
  const _hp2000a = _mkHP(cMIDtop, sr, _Q1), _hp2000b = _mkHP(cMIDtop, sr, _Q2);
  const cHItop = Math.min(HI_TOP, sr * 0.45);
  const _lp6000a_hi = _mkBQ(cHItop, sr, _Q1), _lp6000b_hi = _mkBQ(cHItop, sr, _Q2);
  const _hp6000a = _mkHP(cHItop, sr, _Q1), _hp6000b = _mkHP(cHItop, sr, _Q2);
  // air: cHItop..cAIRtop bandpass (이전 hp-only 에서 변경 — air 의 upper edge 도 정의).
  const cAIRtop = Math.min(AIR_TOP, sr * 0.49);
  const _lpAir_a = _mkBQ(cAIRtop, sr, _Q1), _lpAir_b = _mkBQ(cAIRtop, sr, _Q2);

  const chCount = channels.length;
  const stereoShape = shapeMode === 'stereoShape' && chCount > 1;
  const enc = v => Math.max(0, Math.min(255, Math.round((Math.max(-1, Math.min(1, v)) + 1) * 127.5)));
  const encU = v => Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(1, v)) * 255)));
  const envCurve = v => Math.pow(Math.min(1, Math.max(0, v)), 0.86);
  const signedCurve = v => { const a = Math.min(1, Math.abs(v)); const t = Math.pow(a, 0.58); return v < 0 ? -t : t; };

  const raw = new Float32Array(pts * 8);
  const wf = new Uint8Array(pts * 8);
  let pkGlobal = 1e-6;

  // 진행 청크: 10 단계 (raw 루프 진행 중 partial emit). 마지막 step 은 평활화 + 재인코딩 후 'done' 으로.
  const RAW_CHUNK = Math.max(800, Math.floor(pts / 10));
  let lastEmitIdx = 0;

  const emitPartial = (uptoExclusive) => {
    if (uptoExclusive <= lastEmitIdx) return;
    const invG = 1 / Math.max(pkGlobal, 1e-6);
    // 전체 emit 범위를 매번 현재 pkGlobal 로 재정규화 + smoothEnv 적용 — 1pass 색감을 최종(2pass 자리) 과 일치.
    // (이전엔 last chunk 만 새로 인코딩 → 앞쪽 chunk 는 옛 invG 로 정규화돼 더 밝게 보였음)
    // 추가 비용: 전체 raw → wf 재인코딩 O(n), n 최대 ~22만 → ~수ms. emit 빈도 (10회/track) 제한.
    const N = uptoExclusive;
    const lo = new Float32Array(N), mi = new Float32Array(N), hi = new Float32Array(N),
          ai = new Float32Array(N), bd = new Float32Array(N), rm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const ro = i * 8;
      lo[i] = envCurve(raw[ro]     * invG);
      mi[i] = envCurve(raw[ro + 1] * invG);
      hi[i] = envCurve(raw[ro + 2] * invG);
      ai[i] = envCurve(raw[ro + 3] * invG);
      bd[i] = envCurve(raw[ro + 6] * invG);
      rm[i] = envCurve(raw[ro + 7] * invG);
    }
    // attack 0.99 = 즉시 peak. release + smooth (moving avg) 로 envelope decay 모양 제어.
    const loE = movingAverage(smoothEnv(lo, 0.99, RL_LO),  SM_LO);
    const miE = movingAverage(smoothEnv(mi, 0.99, RL_MI),  SM_MI);
    const hiE = movingAverage(smoothEnv(hi, 0.99, RL_HI),  SM_HI);
    const aiE = movingAverage(smoothEnv(ai, 0.99, RL_AIR), SM_AIR);
    const bdE = smoothEnv(bd, 0.99, 0.06);
    for (let i = 0; i < N; i++) {
      const ro = i * 8, o = i * 8;
      wf[o]     = encU(loE[i]);
      wf[o + 1] = encU(miE[i]);
      wf[o + 2] = encU(hiE[i]);
      wf[o + 3] = encU(aiE[i]);
      wf[o + 4] = enc(signedCurve(raw[ro + 4] * invG));
      wf[o + 5] = enc(signedCurve(raw[ro + 5] * invG));
      wf[o + 6] = encU(bdE[i]);
      wf[o + 7] = encU(rm[i]);
    }
    lastEmitIdx = uptoExclusive;
    const slice = wf.slice(0, uptoExclusive * 8);
    self.postMessage({
      type: 'chunk', jobId,
      wf: slice.buffer, done: uptoExclusive, total: pts,
      partialDurMs: analysisDur * 1000 * (uptoExclusive / pts),
      targetRate: effectiveRate
    }, [slice.buffer]);
  };

  for (let i = 0; i < pts; i++) {
    const s0 = i * step;
    let loPk = 0, miPk = 0, hiPk = 0, airPk = 0, fullMn = 0, fullMx = 0, topPk = 0, botPk = 0;
    let sumSq = 0, loSq = 0, miSq = 0, hiSq = 0, airSq = 0;
    for (let j = 0; j < step; j++) {
      let s = 0;
      for (let c = 0; c < chCount; c++) s += channels[c][s0 + j] || 0;
      s /= chCount;
      const midSideMid = stereoShape ? ((channels[0][s0 + j] || 0) + (channels[1][s0 + j] || 0)) * 0.5 : null;
      s = midSideMid == null ? s : midSideMid;
      const topS = stereoShape ? (channels[0][s0 + j] || 0) : s;
      const botS = stereoShape ? (channels[1][s0 + j] || 0) : s;
      sumSq += s * s;
      const bass = _bq(_lp250b, _bq(_lp250a, s));
      const hp250 = _bq(_hp250b, _bq(_hp250a, s));
      const mid = _bq(_lp2000b_mid, _bq(_lp2000a_mid, hp250));
      const hp2000 = _bq(_hp2000b, _bq(_hp2000a, hp250));
      const hi = _bq(_lp6000b_hi, _bq(_lp6000a_hi, hp2000));
      // air: cHItop HP → cAIRtop LP (bandpass).
      const airHp = _bq(_hp6000b, _bq(_hp6000a, hp2000));
      const air = _bq(_lpAir_b, _bq(_lpAir_a, airHp));
      if (!Number.isFinite(bass) || !Number.isFinite(mid) || !Number.isFinite(hi) || !Number.isFinite(air)) continue;
      loSq += bass * bass; miSq += mid * mid; hiSq += hi * hi; airSq += air * air;
      if (Math.abs(bass) > loPk) loPk = Math.abs(bass);
      if (Math.abs(mid) > miPk) miPk = Math.abs(mid);
      if (Math.abs(hi) > hiPk) hiPk = Math.abs(hi);
      if (Math.abs(air) > airPk) airPk = Math.abs(air);
      if (s < fullMn) fullMn = s; if (s > fullMx) fullMx = s;
      const topA = Math.abs(topS), botA = Math.abs(botS);
      if (topA > topPk) topPk = topA;
      if (botA > botPk) botPk = botA;
    }
    const loRms = Math.sqrt(loSq / step), miRms = Math.sqrt(miSq / step), hiRms = Math.sqrt(hiSq / step), airRms = Math.sqrt(airSq / step);
    const ro = i * 8;
    raw[ro]     = Math.max(loPk, loRms * 1.22);
    raw[ro + 1] = Math.max(miPk, miRms * 1.32);
    // hi/air: 순수 frequency band peak/RMS 만 — 이전 trPk (2kHz+ snap) injection 은
    // kick/snare attack transient 가 hi/air 를 강제 boost → bass-heavy 음원도 cyan-blue 색으로 보이는 문제.
    // 색 계산은 rgbTraceColor 의 air boost (1.55x) 가 hi/air 가시성을 보정해 줌.
    raw[ro + 2] = Math.max(hiPk, hiRms * 0.92);
    raw[ro + 3] = Math.max(airPk, airRms * 0.86);
    raw[ro + 4] = stereoShape ? -botPk : fullMn;
    raw[ro + 5] = stereoShape ? topPk : fullMx;
    raw[ro + 6] = Math.sqrt((loSq + miSq + hiSq + airSq) / step);
    raw[ro + 7] = Math.sqrt(sumSq / step);
    const pkBin = Math.max(raw[ro], raw[ro + 1], raw[ro + 2], raw[ro + 3], -fullMn, fullMx);
    if (Number.isFinite(pkBin) && pkBin > pkGlobal) pkGlobal = pkBin;

    if ((i + 1) % RAW_CHUNK === 0) emitPartial(i + 1);
  }
  // 라스트 partial (혹시 RAW_CHUNK 경계에 안 맞아 못 emit 한 잔여 부분)
  if (lastEmitIdx < pts) emitPartial(pts);

  // 평활화 + 최종 재인코딩 (raw 부터 정확한 invG 와 smoothEnv 로 재계산).
  const invG = 1 / pkGlobal;
  const loSrc = new Float32Array(pts), miSrc = new Float32Array(pts), hiSrc = new Float32Array(pts),
        airSrc = new Float32Array(pts), bandSrc = new Float32Array(pts), rmsSrc = new Float32Array(pts);
  for (let i = 0; i < pts; i++) {
    const ro = i * 8;
    loSrc[i]   = envCurve(raw[ro]     * invG);
    miSrc[i]   = envCurve(raw[ro + 1] * invG);
    hiSrc[i]   = envCurve(raw[ro + 2] * invG);
    airSrc[i]  = envCurve(raw[ro + 3] * invG);
    bandSrc[i] = envCurve(raw[ro + 6] * invG);
    rmsSrc[i]  = envCurve(raw[ro + 7] * invG);
  }
  // partial emit 과 동일 release + smooth.
  const loEnv  = movingAverage(smoothEnv(loSrc,  0.99, RL_LO),  SM_LO);
  const miEnv  = movingAverage(smoothEnv(miSrc,  0.99, RL_MI),  SM_MI);
  const hiEnv  = movingAverage(smoothEnv(hiSrc,  0.99, RL_HI),  SM_HI);
  const airEnv = movingAverage(smoothEnv(airSrc, 0.99, RL_AIR), SM_AIR);
  const bandEnv= smoothEnv(bandSrc,0.86, 0.12);
  for (let i = 0; i < pts; i++) {
    const ro = i * 8, o = i * 8;
    wf[o]     = encU(loEnv[i]);
    wf[o + 1] = encU(miEnv[i]);
    wf[o + 2] = encU(hiEnv[i]);
    wf[o + 3] = encU(airEnv[i]);
    wf[o + 4] = enc(signedCurve(raw[ro + 4] * invG));
    wf[o + 5] = enc(signedCurve(raw[ro + 5] * invG));
    wf[o + 6] = encU(bandEnv[i]);
    wf[o + 7] = encU(rmsSrc[i]);
  }

  self.postMessage({
    type: 'done', jobId,
    wf: wf.buffer, totalDurMs: analysisDur * 1000, totalPts: pts, targetRate: effectiveRate
  }, [wf.buffer]);
}
