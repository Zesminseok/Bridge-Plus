'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const audioPath = process.argv[2];
if (!audioPath) {
  console.error('usage: electron tools/electron_analyze_waveform.js <audio-file>');
  process.exit(2);
}

function jsString(s) {
  return JSON.stringify(s);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  ipcMain.once('analysis-result', (_ev, text) => {
    console.log(text);
    app.quit();
  });
  ipcMain.once('analysis-error', (_ev, text) => {
    console.error(text);
    app.exit(1);
  });

  const html = `<!doctype html><meta charset="utf-8"><script>
const { ipcRenderer } = require('electron');
const filePath = ${jsString(path.resolve(audioPath))};

function mkBQ(fc,sr,Q){
  const w=2*Math.PI*fc/sr,sn=Math.sin(w),cs=Math.cos(w),al=sn/(2*Q),a0=1+al;
  return{b0:((1-cs)/2)/a0,b1:(1-cs)/a0,b2:((1-cs)/2)/a0,a1:(-2*cs)/a0,a2:(1-al)/a0,w1:0,w2:0};
}
function mkHP(fc,sr,Q){
  const w=2*Math.PI*fc/sr,sn=Math.sin(w),cs=Math.cos(w),al=sn/(2*Q),a0=1+al;
  return{b0:((1+cs)/2)/a0,b1:-(1+cs)/a0,b2:((1+cs)/2)/a0,a1:(-2*cs)/a0,a2:(1-al)/a0,w1:0,w2:0};
}
function bq(f,x){const y=f.b0*x+f.w1;f.w1=f.b1*x-f.a1*y+f.w2;f.w2=f.b2*x-f.a2*y;return y;}
function pct(a,p){if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[Math.max(0,Math.min(s.length-1,Math.floor((s.length-1)*p)))];}
function avg(a){return a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);}
function active(a,t){return a.filter(x=>x>t).length/Math.max(1,a.length);}

function analyze(chans,sr,cfg,fromSec,toSec){
  const Q1=0.5412,Q2=1.3066;
  let lpLoA=mkBQ(cfg.low,sr,Q1),lpLoB=mkBQ(cfg.low,sr,Q2);
  let hpLoA=mkHP(cfg.low,sr,Q1),hpLoB=mkHP(cfg.low,sr,Q2);
  let lpMidA=mkBQ(cfg.mid,sr,Q1),lpMidB=mkBQ(cfg.mid,sr,Q2);
  let hpMidA=mkHP(cfg.mid,sr,Q1),hpMidB=mkHP(cfg.mid,sr,Q2);
  const airCut=Math.min(cfg.air,sr*0.45);
  let lpAirA=mkBQ(airCut,sr,Q1),lpAirB=mkBQ(airCut,sr,Q2);
  let hpAirA=mkHP(airCut,sr,Q1),hpAirB=mkHP(airCut,sr,Q2);
  const step=Math.max(1,Math.floor(sr/150));
  const start=Math.max(0,Math.floor(fromSec*sr));
  const end=Math.min(chans[0].length,Math.floor(toSec*sr));
  const lo=[],mi=[],hi=[],air=[],total=[];
  let pkGlobal=1e-6;
  for(let i=start;i<end;i+=step){
    const jEnd=Math.min(end,i+step);
    let loPk=0,miPk=0,hiPk=0,airPk=0,loSq=0,miSq=0,hiSq=0,airSq=0,valid=0;
    for(let j=i;j<jEnd;j++){
      let s=0;for(let c=0;c<chans.length;c++)s+=chans[c][j]||0;s/=chans.length;
      const low=bq(lpLoB,bq(lpLoA,s));
      const hpLow=bq(hpLoB,bq(hpLoA,s));
      const mid=bq(lpMidB,bq(lpMidA,hpLow));
      const hpMid=bq(hpMidB,bq(hpMidA,hpLow));
      const high=bq(lpAirB,bq(lpAirA,hpMid));
      const airy=bq(hpAirB,bq(hpAirA,hpMid));
      if(!Number.isFinite(low)||!Number.isFinite(mid)||!Number.isFinite(high)||!Number.isFinite(airy))continue;
      loPk=Math.max(loPk,Math.abs(low));miPk=Math.max(miPk,Math.abs(mid));hiPk=Math.max(hiPk,Math.abs(high));airPk=Math.max(airPk,Math.abs(airy));
      loSq+=low*low;miSq+=mid*mid;hiSq+=high*high;airSq+=airy*airy;valid++;
    }
    valid=Math.max(1,valid);
    const lv=Math.max(loPk,Math.sqrt(loSq/valid)*1.2);
    const mv=Math.max(miPk,Math.sqrt(miSq/valid)*1.2);
    const hv=Math.max(hiPk,Math.sqrt(hiSq/valid)*1.1);
    const av=Math.max(airPk,Math.sqrt(airSq/valid)*1.0);
    pkGlobal=Math.max(pkGlobal,lv,mv,hv,av);
    lo.push(lv);mi.push(mv);hi.push(hv);air.push(av);total.push(Math.max(lv,mv,hv,av));
  }
  const curve=v=>Math.pow(Math.min(1,Math.max(0,v/pkGlobal)),cfg.pow);
  const L=lo.map(curve),M=mi.map(curve),H=hi.map(curve),A=air.map(curve);
  return [
    'CONFIG '+cfg.name+' low='+cfg.low+' mid='+cfg.mid+' air='+airCut+' pow='+cfg.pow,
    '  avg    low '+avg(L).toFixed(3)+' mid '+avg(M).toFixed(3)+' high '+avg(H).toFixed(3)+' air '+avg(A).toFixed(3),
    '  p90    low '+pct(L,.9).toFixed(3)+' mid '+pct(M,.9).toFixed(3)+' high '+pct(H,.9).toFixed(3)+' air '+pct(A,.9).toFixed(3),
    '  active low '+active(L,.18).toFixed(2)+' mid '+active(M,.18).toFixed(2)+' high '+active(H,.18).toFixed(2)+' air '+active(A,.18).toFixed(2)
  ].join('\\n');
}

(async()=>{
  try{
    const fs = require('fs');
    const ab = fs.readFileSync(filePath).buffer.slice(fs.readFileSync(filePath).byteOffset);
    const ac = new AudioContext();
    const buf = await ac.decodeAudioData(ab);
    const chans=Array.from({length:buf.numberOfChannels},(_,i)=>buf.getChannelData(i));
    const configs=[
      {name:'current',low:250,mid:2000,air:6000,pow:.72},
      {name:'lower-low',low:120,mid:1800,air:7000,pow:.82},
      {name:'very-low',low:90,mid:1600,air:8000,pow:.86}
    ];
    const windows=[[60,74],[0,buf.duration]];
    let out='FILE sr '+buf.sampleRate+' channels '+buf.numberOfChannels+' duration '+buf.duration.toFixed(3)+'s';
    for(const w of windows){
      out+='\\n\\nWINDOW '+w[0].toFixed(1)+'-'+w[1].toFixed(1)+'s';
      for(const cfg of configs)out+='\\n'+analyze(chans,buf.sampleRate,cfg,w[0],w[1]);
    }
    ipcRenderer.send('analysis-result',out);
  }catch(e){ipcRenderer.send('analysis-error',e.stack||String(e));}
})();
</script>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
});
