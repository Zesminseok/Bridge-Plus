// BPM Analysis — Spectral Flux + Generalized Autocorrelation (Phase 4.15 modularization).
// renderer/index.html 인라인 스크립트에서 추출. Pure audio analysis — global state 없음.
// FFT window=1024, hop=512, kick-focused energy onset → autocorrelation peak picking.
// Detect first audio position above -69dB (amplitude ≈ 0.000355).
// 글로벌 lexical env 호환 — script-top-level 로딩으로 같은 이름 그대로 참조 가능.

function _normalizeAnalyzedBpm(bpm){
  const b=Number(bpm)||0;
  if(!(b>0))return 0;
  const r=Math.round(b);
  return Math.abs(b-r)<=0.35?r:Math.round(b*10)/10;
}

function detectAudioStart(ch, sr){
  const threshold=Math.pow(10, -69/20); // -69dB → ~0.000355
  const winSamples=Math.round(sr*0.005); // 5ms window for RMS
  for(let i=0;i<ch.length-winSamples;i+=winSamples){
    let sum=0;
    for(let j=0;j<winSamples;j++){const s=ch[i+j]||0;sum+=s*s;}
    if(Math.sqrt(sum/winSamples)>=threshold) return i/sr*1000; // ms
  }
  return 0;
}

async function analyzeBPM(blob){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:44100});
    const ab=await blob.arrayBuffer();
    const buf=await ctx.decodeAudioData(ab);
    ctx.close();
    const ch=buf.getChannelData(0),sr=buf.sampleRate;

    // --- Energy-based onset detection (much faster than DFT) ---
    const hopSz=256, frameSz=1024;
    // Analyse 45 seconds from the middle for stable BPM
    const maxSamples=Math.min(ch.length, sr*45);
    const startSample=Math.max(0, Math.floor((ch.length-maxSamples)/2));
    const nFrames=Math.floor((maxSamples-frameSz)/hopSz);
    if(nFrames<100) return {bpm:0,startMs:0};

    // Low-pass filter for kick detection (< 200Hz)
    const aLP=Math.min(1, 2*Math.PI*200/sr);
    // Compute sub-band energy per frame (kick-focused)
    const energy=new Float32Array(nFrames);
    let lp=0;
    for(let f=0;f<nFrames;f++){
      const off=startSample+f*hopSz;
      let eLow=0,eFull=0;
      for(let i=0;i<frameSz;i++){
        const s=ch[off+i]||0;
        lp+=aLP*(s-lp);
        eLow+=lp*lp;
        eFull+=s*s;
      }
      // Weighted: 70% kick energy + 30% full energy for better transient detection
      energy[f]=0.7*eLow/frameSz + 0.3*eFull/frameSz;
    }

    // Onset detection: energy derivative (positive flux)
    const onset=new Float32Array(nFrames);
    for(let f=1;f<nFrames;f++){
      const d=energy[f]-energy[f-1];
      onset[f]=d>0?d:0;
    }

    // Adaptive threshold: local mean + 1.5*std in 0.5s windows
    const winFrames=Math.round(500/(hopSz/sr*1000));
    const peaks=new Float32Array(nFrames);
    for(let f=0;f<nFrames;f++){
      const lo=Math.max(0,f-winFrames),hi=Math.min(nFrames,f+winFrames);
      let sum=0,sum2=0,cnt=0;
      for(let i=lo;i<hi;i++){sum+=onset[i];sum2+=onset[i]*onset[i];cnt++;}
      const mean=sum/cnt,std=Math.sqrt(sum2/cnt-mean*mean);
      peaks[f]=onset[f]>(mean+1.5*std)?onset[f]:0;
    }

    // Autocorrelation on onset peaks
    const hopMs=hopSz/sr*1000;
    const minLag=Math.round(60000/(200*hopMs)); // 200 BPM
    const maxLag=Math.round(60000/(60*hopMs));   // 60 BPM
    const corrLen=Math.min(nFrames, Math.round(20000/hopMs));
    const corr=new Float32Array(maxLag+1);

    for(let lag=minLag;lag<=Math.min(maxLag,nFrames-1);lag++){
      let c=0;
      for(let i=0;i<corrLen&&i+lag<nFrames;i++) c+=peaks[i]*peaks[i+lag];
      corr[lag]=c;
    }

    // Find peaks in correlation
    const cPeaks=[];
    for(let lag=minLag+1;lag<maxLag&&lag<nFrames-1;lag++){
      if(corr[lag]>corr[lag-1]&&corr[lag]>corr[lag+1]&&corr[lag]>0){
        // Parabolic interpolation for sub-frame precision
        const a2=corr[lag-1],b2=corr[lag],c2=corr[lag+1];
        const denom=a2-2*b2+c2;
        const frac=denom!==0?(a2-c2)/(2*denom):0;
        cPeaks.push({lag:lag+frac,val:b2});
      }
    }
    cPeaks.sort((a,b)=>b.val-a.val);
    if(cPeaks.length===0) return {bpm:0,startMs:0};

    // Octave analysis: check multiples
    let bestLag=cPeaks[0].lag;
    const bestVal=cPeaks[0].val;

    // Check half-lag (double BPM) — prefer faster tempo if strong
    const halfLag=bestLag/2;
    if(halfLag>=minLag){
      // Find correlation near halfLag
      const hIdx=Math.round(halfLag);
      const hVal=corr[Math.max(minLag,Math.min(maxLag,hIdx))]||0;
      if(hVal>bestVal*0.6) bestLag=halfLag;
    }
    // Check 2x lag (half BPM) — if much stronger, use it
    const dblLag=bestLag*2;
    if(dblLag<=maxLag){
      const dIdx=Math.round(dblLag);
      const dVal=corr[Math.max(minLag,Math.min(maxLag,dIdx))]||0;
      if(dVal>bestVal*1.3) bestLag=dblLag;
    }

    let bpm=60000/(bestLag*hopMs);
    // Normalize to 70-180 BPM range (DJ standard for electronic/dance)
    while(bpm>180) bpm/=2;
    while(bpm<70) bpm*=2;
    // Round to nearest 0.1
    bpm=Math.round(bpm*10)/10;

    // Detect audio start at -69dB
    const startMs=detectAudioStart(ch,sr);

    return {bpm, startMs, numberOfChannels: buf.numberOfChannels||2};
  }catch(e){console.warn('[BPM]',e);return {bpm:0,startMs:0,numberOfChannels:2};}
}

// Node test — module.exports.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _normalizeAnalyzedBpm, detectAudioStart, analyzeBPM };
}
