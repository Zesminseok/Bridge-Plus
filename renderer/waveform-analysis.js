// Waveform Analysis — Worker 래퍼.
// 기존 메인 스레드 LR4 biquad 캐스케이드 (~1-3s blocking) 를 rgbwf-worker.js 로 이전.
// 메인 스레드는 decodeAudioData (브라우저 내부 비동기) 만 수행 → HW 재생/TCNet 패킷 처리 영향 0%.
// onChunk 는 worker 의 partial 메시지 (raw 분석 진행 ~10단계) 마다 호출 → progressive paint.

let _rgbWfWorker = null;
const _rgbWfJobs = new Map();
let _rgbWfJobCounter = 0;

function _getRgbWfWorker() {
  if (_rgbWfWorker) return _rgbWfWorker;
  try {
    _rgbWfWorker = new Worker('rgbwf-worker.js');
  } catch (err) {
    console.warn('[rgbWf-worker] init failed:', err?.message || err);
    _rgbWfWorker = null;
    return null;
  }
  _rgbWfWorker.addEventListener('message', (e) => {
    const msg = e.data;
    const job = _rgbWfJobs.get(msg.jobId);
    if (!job) return;
    if (msg.type === 'chunk') {
      const partial = new Uint8Array(msg.wf);
      partial._packed = true;
      partial._rate = msg.targetRate || job.targetRate;
      partial._durationMs = msg.partialDurMs;
      partial._stacked = true;
      try { job.onChunk?.(msg.done, partial); } catch (_) { /* swallow */ }
    } else if (msg.type === 'done') {
      const wf = new Uint8Array(msg.wf);
      wf._packed = true;
      wf._rate = msg.targetRate || job.targetRate;
      wf._durationMs = msg.totalDurMs;
      wf._stacked = true;
      _rgbWfJobs.delete(msg.jobId);
      job.resolve(wf);
    } else if (msg.type === 'error') {
      console.warn('[rgbWf-worker]', msg.error);
      _rgbWfJobs.delete(msg.jobId);
      job.resolve(null);
    }
  });
  _rgbWfWorker.addEventListener('error', (e) => console.warn('[rgbWf-worker] fatal', e?.message || e));
  return _rgbWfWorker;
}

async function buildRGBWaveform(blob, onChunk, targetDurMs, targetRate = VIRTUAL_WF_RATE, shapeMode = 'mono', analysisOpts) {
  try {
    const ac = new (self.AudioContext || self.webkitAudioContext)();
    const ab = await blob.arrayBuffer();
    const buf = await ac.decodeAudioData(ab);
    ac.close();
    const w = _getRgbWfWorker();
    if (!w) {
      console.warn('[rgbWf] worker unavailable, returning null');
      return null;
    }
    const nch = Math.max(1, buf.numberOfChannels);
    const channels = [];
    // AudioBuffer view 는 transfer 불가 → 각 채널 복사 후 buffer transfer
    for (let c = 0; c < nch; c++) channels.push(new Float32Array(buf.getChannelData(c)));
    const transferList = channels.map(ch => ch.buffer);
    return await new Promise((resolve) => {
      const jobId = ++_rgbWfJobCounter;
      _rgbWfJobs.set(jobId, { resolve, onChunk, targetRate });
      // analysisOpts 가 있으면 worker default (3band project) 대신 theme-specific cutoffs/releases/smooth 사용.
      const msg = {
        type: 'analyze', jobId,
        channels, sampleRate: buf.sampleRate, durationMs: buf.duration * 1000,
        targetDurMs, targetRate, shapeMode,
      };
      if (analysisOpts) {
        if (analysisOpts.cutoffs) msg.cutoffs = analysisOpts.cutoffs;
        if (analysisOpts.releases) msg.releases = analysisOpts.releases;
        if (analysisOpts.smooth) msg.smooth = analysisOpts.smooth;
      }
      w.postMessage(msg, transferList);
    });
  } catch (e) {
    console.warn('[rgbWf]', e);
    return null;
  }
}
