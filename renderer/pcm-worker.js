// PCM 다운샘플 — 별도 CPU 코어에서 1회 실행 (메인 스레드 0% blocking).
// AudioContext 는 worker 에서 사용 불가 → decodeAudioData 는 메인에서 수행, 채널별 Float32Array 만 transfer.
// 결과 ds 는 main 에 transfer 후 worker 는 보관하지 않음 (라이브 렌더 모드).

self.addEventListener('message', (e)=>{
  const msg = e.data;
  try{
    if(msg.type === 'downsample'){
      const {deckId, jobId, channels, sampleRate, durationMs, targetRate} = msg;
      const len = channels[0].length;
      const nch = channels.length;
      const mono = new Float32Array(len);
      for(let c=0;c<nch;c++){
        const ch = channels[c];
        for(let i=0;i<len;i++) mono[i] += ch[i];
      }
      if(nch>1) for(let i=0;i<len;i++) mono[i] /= nch;
      const ratio = Math.max(1, Math.round(sampleRate/targetRate));
      const dsRate = sampleRate/ratio;
      const dsLen = Math.ceil(len/ratio);
      const ds = new Float32Array(dsLen);
      for(let i=0;i<dsLen;i++){
        const s = i*ratio, end = Math.min(len, s+ratio);
        let mn=1, mx=-1;
        for(let j=s;j<end;j++){const v=mono[j];if(v<mn)mn=v;if(v>mx)mx=v;}
        ds[i] = Math.abs(mx)>Math.abs(mn)?mx:mn;
      }
      // ds 를 main 으로 transfer (zero-copy). 워커는 자체 보관 안함 (라이브 렌더 모드).
      self.postMessage(
        {type:'pcm', deckId, jobId, samples:ds, sampleRate:dsRate, durationMs, totalSamples:dsLen},
        [ds.buffer]
      );
    }
  }catch(err){
    self.postMessage({type:'error', deckId: msg?.deckId, jobId: msg?.jobId, error: err?.message||String(err)});
  }
});
