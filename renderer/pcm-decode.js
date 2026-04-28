// PCM Decode — Virtual deck PCM 파이프라인 (Phase 4.16 modularization).
// renderer/index.html 인라인 스크립트에서 추출. 글로벌 lexical env 호환.
// 1) decodeAudioData (메인, 브라우저 내부 워커 활용) → AudioBuffer
// 2) 채널 Float32Array transfer → pcm-worker
// 3) Worker: mono mix + 22kHz peak-preserving 다운샘플 → main 에 transfer (zero-copy)
// 4) 메인은 메타데이터 + samples 보유 (sampleRate/durationMs/totalSamples)

let _pcmWorker = null;
let _pcmJobCounter = 0;
const _pcmJobs = new Map();

function _getPcmWorker(){
  if(_pcmWorker) return _pcmWorker;
  try{
    _pcmWorker = new Worker('pcm-worker.js');
  }catch(err){
    console.warn('[pcm-worker] init failed:', err?.message||err);
    _pcmWorker = null;
    return null;
  }
  _pcmWorker.addEventListener('message', (e)=>{
    const msg = e.data;
    const job = _pcmJobs.get(msg.jobId);
    if(!job) return;
    _pcmJobs.delete(msg.jobId);
    const d = job.deck;
    if(!d) return;
    if(msg.type === 'pcm'){
      // Stale token (트랙 변경) — 결과 폐기
      if(d._loadToken !== job.token){
        d._pcmPromise = null;
        return;
      }
      // ds samples 가 worker 에서 transfer 되어 main 소유. 라이브 렌더 매 프레임 사용.
      d._pcm = {samples: msg.samples, sampleRate: msg.sampleRate, durationMs: msg.durationMs};
      d._pcmPromise = null;
      d._wfDirty = true;
    } else if(msg.type === 'error'){
      console.warn('[pcm-worker]', msg.error);
      if(job.kind === 'pcm') d._pcmPromise = null;
    }
  });
  // Fatal error: pending job 의 deck._pcmPromise 를 정리하지 않으면 line 48 guard 가 영구 차단됨.
  // 모든 inflight job 을 drain → deck 상태 reset → worker singleton 폐기 (다음 호출에서 재생성).
  _pcmWorker.addEventListener('error', (e)=>{
    console.warn('[pcm-worker] fatal', e?.message||e);
    for(const job of _pcmJobs.values()){
      if(job.deck) job.deck._pcmPromise = null;
    }
    _pcmJobs.clear();
    _pcmWorker = null;
  });
  return _pcmWorker;
}

async function _decodePcmFor(d, slot){
  if(!d||d.type==='hw'||d._pcm||d._pcmPromise||!d._audioBlob)return;
  const w = _getPcmWorker();
  if(!w) return;
  const token = d._loadToken||0;
  d._pcmPromise = {pending:true};
  try{
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const ab = await d._audioBlob.arrayBuffer();
    const buf = await ac.decodeAudioData(ab);
    ac.close();
    if(d._loadToken !== token){d._pcmPromise = null; return;}
    if(buf.duration > 600){console.warn('[PCM] track > 10min, skip'); d._pcmPromise = null; return;}
    const nch = buf.numberOfChannels;
    // 채널 데이터 복사 후 transfer (AudioBuffer 의 view 는 transfer 불가)
    const channels = [];
    for(let c=0;c<nch;c++) channels.push(new Float32Array(buf.getChannelData(c)));
    const transferList = channels.map(ch => ch.buffer);
    const jobId = ++_pcmJobCounter;
    const deckId = `s${slot}_${token}`;
    _pcmJobs.set(jobId, {deck:d, kind:'pcm', token, deckId});
    w.postMessage({
      type:'downsample', jobId, deckId,
      channels, sampleRate: buf.sampleRate,
      durationMs: buf.duration*1000, targetRate: 22050
    }, transferList);
    // _pcmPromise 는 worker 응답 처리 시 null 로 해제됨
  }catch(e){
    console.warn('[PCM] decode failed:', e.message);
    d._pcmPromise = null;
  }
}

// Node test sanity export.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _getPcmWorker, _decodePcmFor };
}
