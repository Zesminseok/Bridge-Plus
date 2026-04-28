// Mixer Panel — DJM 실시간 시각화 (Phase 2.4 modularization).
// renderer/index.html 인라인 스크립트에서 추출. 동작 변경 없음.
// 글로벌 lexical env 공유 — inline script 의 _djm* 상태 변수와 cfg/pdjlDevices/onAirCh
// /eqBands/faders/_djmHpCue/_BEAT_FX_NAMES/_BEAT_FX_ASSIGN_NAMES/_COLOR_FX_NAMES/curTab/DECKS
// /_vuDisplayFrom255/_vuDisplayFromBands 등을 직접 참조 (script-top-level 로딩 순서 의존).

const _DJM_PROFILES={
  'V10':     {ch:6, eq:['TRIM','HI','HI MID','LOW MID','LOW','CLR'], ids:['T','H','HM','LM','L','C'], comp:true},
  'V10-LF':  {ch:6, eq:['TRIM','HI','HI MID','LOW MID','LOW','CLR'], ids:['T','H','HM','LM','L','C'], comp:true},
  'A9':      {ch:4, eq:['TRIM','HI','MID','LOW','CLR'], ids:['T','H','M','L','C']},
  '900NXS2': {ch:4, eq:['TRIM','HI','MID','LOW','CLR'], ids:['T','H','M','L','C']},
  '900NXS':  {ch:4, eq:['TRIM','HI','MID','LOW','CLR'], ids:['T','H','M','L','C']},
  '750MK2':  {ch:4, eq:['TRIM','HI','MID','LOW','CLR'], ids:['T','H','M','L','C']},
  '450':     {ch:2, eq:['TRIM','HI','MID','LOW','CLR'], ids:['T','H','M','L','C']},
  '250MK2':  {ch:2, eq:['TRIM','HI','MID','LOW','CLR'], ids:['T','H','M','L','C']},
  'default': {ch:4, eq:['TRIM','HI','MID','LOW','CLR'], ids:['T','H','M','L','C']},
};

let _mxPeaks=[0,0,0,0], _mxBuilt=false;

// Element cache — updateMixer 매 tick (60fps) × 30+ getElementById 절감.
// _mxBuildBody() 후 _mxBuilt=false → 다음 호출 시 자동 rebuild + cache invalidation.
// isConnected 체크로 DOM 재생성 시 stale ref 자동 갱신.
const _mxEls = Object.create(null);
function _mxEl(id){
  let el = _mxEls[id];
  if (el && el.isConnected) return el;
  el = document.getElementById(id);
  if (el) _mxEls[id] = el;
  return el;
}
function _mxClearCache(){ for (const k in _mxEls) delete _mxEls[k]; }

function _mxKnobSVG(id,sz){
  const r=sz/2-3,cx=sz/2,cy=sz/2;
  return`<svg id="${id}" viewBox="0 0 ${sz} ${sz}" width="${sz}" height="${sz}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2.5"/>
    <path id="${id}arc" fill="none" stroke="rgba(135,135,255,.5)" stroke-width="2.5" stroke-linecap="round" d="M${cx},${cy}"/>
    <line id="${id}tick" x1="${cx}" y1="${cy-r+2}" x2="${cx}" y2="${cy-r+6}" stroke="rgba(255,255,255,.85)" stroke-width="1.5" stroke-linecap="round" transform="rotate(0,${cx},${cy})"/>
  </svg>`;
}
function _mxKnobUpdate(id,norm,sz,isLevel=false){
  const r=sz/2-3,cx=sz/2,cy=sz/2;
  const deg=norm*135;
  const tickEl=_mxEl(id+'tick');
  if(tickEl)tickEl.setAttribute('transform',`rotate(${deg},${cx},${cy})`);
  const arcEl=_mxEl(id+'arc');
  if(!arcEl)return;
  const pt=(a)=>{const r2=a*Math.PI/180;return[cx+r*Math.sin(r2),cy-r*Math.cos(r2)];};
  if(isLevel){
    const span=deg-(-135);
    if(span<2){arcEl.setAttribute('d','');return;}
    const [sx,sy]=pt(-135);
    const [nx,ny]=pt(deg);
    const large=span>180?1:0;
    arcEl.setAttribute('d',`M${sx.toFixed(2)},${sy.toFixed(2)} A${r},${r} 0 ${large} 1 ${nx.toFixed(2)},${ny.toFixed(2)}`);
    arcEl.setAttribute('stroke','rgba(180,180,180,.55)');
  } else {
    const absDeg=Math.abs(deg);
    if(absDeg<2){arcEl.setAttribute('d','');return;}
    const [ox,oy]=pt(0);
    const [nx,ny]=pt(deg);
    const d=norm>=0
      ?`M${ox.toFixed(2)},${oy.toFixed(2)} A${r},${r} 0 0 1 ${nx.toFixed(2)},${ny.toFixed(2)}`
      :`M${nx.toFixed(2)},${ny.toFixed(2)} A${r},${r} 0 0 1 ${ox.toFixed(2)},${oy.toFixed(2)}`;
    arcEl.setAttribute('d',d);
    arcEl.setAttribute('stroke',norm>0.05?'rgba(135,135,255,.7)':norm<-0.05?'rgba(255,100,100,.6)':'rgba(200,200,200,.4)');
  }
}
function _mxMountKnob(hostId,id,sz){
  const host=_mxEl(hostId);
  if(!host||host.dataset.knobMounted==='1')return;
  host.innerHTML=_mxKnobSVG(id,sz);
  host.dataset.knobMounted='1';
}
function _mxEnsureAuxKnobs(){
  const AUX_SZ=32, ISO_SZ=26, MASTER_SZ=46, BFX_SZ=54, CFX_SZ=26;
  [
    ['mxBalKnobHost','mxBalKnob'],['mxBoothKnobHost','mxBoothKnob'],
    ['mxHpMixKnobHost','mxHpMixKnob'],['mxHpLevelKnobHost','mxHpLevelKnob'],
    ['mxMicHiKnobHost','mxMicHiKnob'],['mxMicLoKnobHost','mxMicLoKnob'],
    ['mxBthHiKnobHost','mxBthHiKnob'],['mxBthLoKnobHost','mxBthLoKnob'],
    ['mxHpMixBKnobHost','mxHpMixBKnob'],['mxHpLevelBKnobHost','mxHpLevelBKnob'],
    ['mxFltResoKnobHost','mxFltResoKnob'],
  ].forEach(([host,id])=>_mxMountKnob(host,id,AUX_SZ));
  // Beat FX knob — 키워서 크게 (54px)
  _mxMountKnob('mxBfxLvlKnobHost','mxBfxLvlKnob',BFX_SZ);
  // Color FX knob — 20% 작게 (32→26px)
  _mxMountKnob('mxCfxKnobHost','mxCfxKnob',CFX_SZ);
  // ISOLATOR HI/MID/LOW — 가로 일렬, 작은 사이즈
  [['mxIsoHiKnobHost','mxIsoHiKnob'],['mxIsoMidKnobHost','mxIsoMidKnob'],['mxIsoLoKnobHost','mxIsoLoKnob']]
    .forEach(([host,id])=>_mxMountKnob(host,id,ISO_SZ));
  // MASTER LEVEL knob — 큰 사이즈
  _mxMountKnob('mxMVolHost','mxMVol',MASTER_SZ);
}
function _mxSetAuxToggle(id,on,extraCls=''){
  const el=_mxEl(id);
  if(!el)return;
  el.className=`mx-aux-toggle${extraCls?` ${extraCls}`:''}${on?' on':''}`;
}
function _mxSetAuxPill(id,on,extraCls=''){
  const el=_mxEl(id);
  if(!el)return;
  el.className=`mx-aux-pill${extraCls?` ${extraCls}`:''}${on?' on':''}`;
}

function _mxDetectProfile(djmDevs){
  for(const d of djmDevs){
    const n=d.name||'';
    for(const [key,prof] of Object.entries(_DJM_PROFILES)){
      if(key==='default')continue;
      if(n.toUpperCase().includes(key.toUpperCase()))return{key,prof};
    }
  }
  return{key:'default',prof:_DJM_PROFILES['default']};
}
function _mxBuildBody(){
  const body=_mxEl('mxBody');if(!body)return;
  const KSZ=30, prof=_djmProfile;
  const nCh=prof.ch;
  // 페이더 눈금 — 단순 dash 11개 (라벨 없이, V10 실물처럼)
  const MARK_COUNT=11;
  const markHtml=Array.from({length:MARK_COUNT},(_,i)=>`<div class="mx-fdr-mark" style="bottom:${(i/(MARK_COUNT-1))*100}%"></div>`).join('');
  const vuBoxes=(i)=>Array.from({length:12},(_,j)=>`<div class="mx-vu-box" id="mxVu${i}_${j}"></div>`).join('');
  const isV10=!!_djmIsV10;
  let html='';
  for(let i=0;i<nCh;i++){
    let knobsHtml='';
    prof.eq.forEach((lbl,ki)=>{
      knobsHtml+=`<div class="mx-knob">${_mxKnobSVG('mx'+prof.ids[ki]+i,KSZ)}<span class="mx-knob-lbl">${lbl}</span></div>`;
    });
    // V10 전용: per-channel FILTER 행 (EQ 행 아래, CUE 위)
    const filterRow=isV10?`<div class="mx-ch-filter">
      ${_mxKnobSVG('mxFltCh'+i,28)}
      <span class="mx-ch-filter-lbl">FILTER</span>
      <span class="mx-ch-filter-pend">pcap pending</span>
    </div>`:'';
    html+=`<div class="mx-ch" id="mxCh${i}">
      <div class="mx-ch-hdr"><span class="mx-ch-lbl">CH${i+1}</span><span class="mx-ch-air">ON AIR</span></div>
      <div class="mx-knobs">${knobsHtml}</div>
      ${filterRow}
      <div class="mx-cue"><span class="mx-cue-btn" id="mxCue${i}">CUE</span></div>
      <div class="mx-fdr-area">
        <div class="mx-fdr-col"><div class="mx-fdr-track"></div><div class="mx-fdr-cap" id="mxFdrCap${i}" style="bottom:0"></div><div class="mx-fdr-marks">${markHtml}</div></div>
        <div class="mx-vu-col"><div class="mx-vu-boxes">${vuBoxes(i)}</div></div>
      </div>
      <span class="mx-ab mx-ab-thru" id="mxAb${i}">THRU</span>
    </div>`;
  }
  body.innerHTML=html;
  _mxBuilt=true;
  _mxClearCache();
}

function updateMixer(){
  if(curTab!=='mixer')return;
  const djmDevs=pdjlDevices.filter(d=>d.type==='DJM');
  const det=_mxDetectProfile(djmDevs);
  if(det.key!==_djmModelKey){_djmModelKey=det.key;_djmProfile=det.prof;_djmChCount=det.prof.ch;_mxBuilt=false;}
  if(!_mxBuilt)_mxBuildBody();
  _mxEnsureAuxKnobs();
  const mxModel=_mxEl('mxModel');
  const mxOffline=_mxEl('mxOffline');
  const connected=djmDevs.length>0;
  if(mxModel)mxModel.textContent=connected?djmDevs.map(d=>d.name).join(', '):'DJM 미연결';
  if(mxOffline)mxOffline.style.display=connected?'none':'';
  const mxEmpty=_mxEl('mxEmpty');
  const mxContent=_mxEl('mxContent');
  if(mxEmpty)mxEmpty.style.display=connected?'none':'';
  if(mxContent){if(connected)mxContent.classList.add('mx-content-on');else{mxContent.classList.remove('mx-content-on');mxContent.style.display='none';}}
  if(!connected)return;
  // V10-only 섹션 일괄 show/hide (CSS .is-v10[hidden] 매칭)
  const v10Sections=document.querySelectorAll('.mx-section.is-v10');
  v10Sections.forEach(sec=>{
    const id=sec.id;
    let show=!!_djmIsV10;
    if(id==='mxBoothEqGroup'||id==='mxHpBGroup'){show=_djmIsV10||_djmModelKey==='A9';}
    if(show)sec.removeAttribute('hidden');else sec.setAttribute('hidden','');
  });
  const KSZ=30, prof=_djmProfile, nCh=prof.ch;
  for(let i=0;i<nCh;i++){
    const air=!!onAirCh[i];
    const rawMeter=_djmChVu[i]||0;
    const meterBands=Array.isArray(_djmSpectrum?.[i])?_djmSpectrum[i]:null;
    const meter=meterBands?_vuDisplayFromBands(meterBands,2.15,0.72):_vuDisplayFrom255(rawMeter,2.05,0.7);
    const chEl=_mxEl('mxCh'+i);
    if(chEl)chEl.classList.toggle('on-air',air);
    {
      const eq=eqBands[i]||[128,128,128,128];
      const eqMap={T:0, H:1, M:2, L:3, C:4, HM:1, LM:2};
      if(prof.ids.length>=6)Object.assign(eqMap,{T:0,H:1,HM:2,LM:3,L:4,C:null});
      const _levelIds=new Set(['T','C']);
      prof.ids.forEach(id=>{
        const bi=eqMap[id];
        const norm=bi!=null?(((eq[bi]??128)-128)/128):0;
        _mxKnobUpdate('mx'+id+i,norm,KSZ,_levelIds.has(id));
      });
    }
    const fv=(faders[i]||0)/255;
    const fPct=fv*100;
    const cap=_mxEl('mxFdrCap'+i);
    if(cap)cap.style.bottom='calc('+fPct+'% - 5px)';
    const lit=Math.round(meter*12);
    for(let j=0;j<12;j++){
      const seg=_mxEl(`mxVu${i}_${j}`);
      if(!seg)continue;
      const cls=j>=11?'lit-r':j>=8?'lit-y':'lit-g';
      seg.className='mx-vu-box'+(j<lit?' '+cls:'');
    }
    if(!_mxPeaks[i])_mxPeaks[i]=0;
    if(meter>_mxPeaks[i])_mxPeaks[i]=meter;
    else _mxPeaks[i]=Math.max(meter,_mxPeaks[i]*0.97);
    const cueBtn=_mxEl('mxCue'+i);
    if(cueBtn)cueBtn.classList.toggle('on',!!(_djmHpCue&(1<<i)));
  }
  const xfKnob=_mxEl('mxXfKnob');
  if(xfKnob)xfKnob.style.left=(_djmXfader/255*100)+'%';
  const hasStereoMasterVu=(_djmMasterVuL>0||_djmMasterVuR>0)||(_djmMasterLBands?.length>0)||(_djmMasterRBands?.length>0);
  const hasMonoMasterVu=_djmMasterVu>0;
  const monoMasterVuNorm=_vuDisplayFrom255(_djmMasterVu,2.0,0.7);
  const mL=hasStereoMasterVu?(_djmMasterLBands?_vuDisplayFromBands(_djmMasterLBands,2.2,0.72):_vuDisplayFrom255(_djmMasterVuL,2.1,0.7)):(hasMonoMasterVu?monoMasterVuNorm:_vuDisplayFrom255(Math.round(((_djmChVu[0]||0)*0.6)+((_djmChVu[2]||0)*0.4)),2.0,0.7));
  const mR=hasStereoMasterVu?(_djmMasterRBands?_vuDisplayFromBands(_djmMasterRBands,2.2,0.72):_vuDisplayFrom255(_djmMasterVuR,2.1,0.7)):(hasMonoMasterVu?monoMasterVuNorm:_vuDisplayFrom255(Math.round(((_djmChVu[1]||0)*0.6)+((_djmChVu[3]||0)*0.4)),2.0,0.7));
  let clipping=false;
  ['L','R'].forEach((side,si)=>{
    const lv=si===0?mL:mR;
    const lit=Math.round(lv*12);
    if(lv>0.97)clipping=true;
    for(let j=0;j<12;j++){
      const dot=_mxEl('mxMDot'+side+j);
      if(!dot)continue;
      const cls=j>=11?'lit-r':j>=8?'lit-y':'lit-g';
      dot.className='mx-master-dot'+(j<lit?' '+cls:'');
    }
  });
  const clipEl=_mxEl('mxClip');
  if(clipEl)clipEl.classList.toggle('on',clipping);
  const MSZ=46;
  const mVolNorm=(((_djmMasterLvl||0)/127.5)-1);
  _mxKnobUpdate('mxMVol',Math.max(-1,Math.min(1,mVolNorm)),MSZ,true);
  for(let i=0;i<nCh;i++){
    const abEl=_mxEl('mxAb'+i);
    if(abEl){
      const asgn=_djmChXfAssign[i]||0;
      abEl.textContent=asgn===1?'A':asgn===2?'B':'THRU';
      abEl.className='mx-ab '+(asgn===1?'mx-ab-a':asgn===2?'mx-ab-b':'mx-ab-thru');
    }
    const cueEl=_mxEl('mxCue'+i);
    if(cueEl)cueEl.classList.toggle('on',!!(_djmChCueA[i]||_djmChCueB[i]));
  }
  const activeDk=Object.values(DECKS).find(d=>d.type==='hw'&&d.pl&&d.bpm>0);
  const mxBpm=_mxEl('mxMasterBpm');
  if(mxBpm)mxBpm.textContent=activeDk?activeDk.bpm.toFixed(2):'—';
  const AUX_SZ=32, ISO_SZ=26;
  const _masterCueOn=!!(_djmMasterCue||_djmMasterCueB||_djmHpCueLink||_djmHpCueLinkB);
  const _mcueBtn=_mxEl('mxCueMaster');
  if(_mcueBtn)_mcueBtn.classList.toggle('on',_masterCueOn);
  _mxSetAuxToggle('mxCueMasterAux',_masterCueOn,'ylw');
  const _bv=_mxEl('mxBalVal');
  _mxKnobUpdate('mxBalKnob',Math.max(-1,Math.min(1,((_djmMasterBal||128)-128)/128)),AUX_SZ,false);
  if(_bv){
    const bd=_djmMasterBal-128;
    _bv.textContent=bd===0?'C':(bd<0?'L'+(-bd):'R'+bd);
  }
  const _bbv=_mxEl('mxBoothVal');
  _mxKnobUpdate('mxBoothKnob',Math.max(-1,Math.min(1,((_djmBoothLvl||0)/127.5)-1)),AUX_SZ,true);
  if(_bbv)_bbv.textContent=String(_djmBoothLvl);
  const _hmv=_mxEl('mxHpMixVal');
  _mxKnobUpdate('mxHpMixKnob',Math.max(-1,Math.min(1,((_djmHpMixing||128)-128)/128)),AUX_SZ,false);
  if(_hmv){
    const hd=_djmHpMixing-128;
    _hmv.textContent=hd===0?'C':(hd<0?hd:'+'+hd);
  }
  const _hv=_mxEl('mxHpVal');
  _mxKnobUpdate('mxHpLevelKnob',Math.max(-1,Math.min(1,((_djmHpLevel||0)/127.5)-1)),AUX_SZ,true);
  if(_hv)_hv.textContent=String(_djmHpLevel);
  _mxSetAuxPill('mxEqIso',_djmEqCurve===0);
  _mxSetAuxPill('mxEqStd',_djmEqCurve!==0&&_djmEqCurve!==2);
  _mxSetAuxPill('mxEqHot',_djmEqCurve===2,'hot');
  _mxSetAuxPill('mxFdrLong',_djmFaderCurve===0);
  _mxSetAuxPill('mxFdrStd',_djmFaderCurve!==0&&_djmFaderCurve!==2);
  _mxSetAuxPill('mxFdrSharp',_djmFaderCurve===2,'hot');
  const _bfxSel=_mxEl('mxBfxSel');
  if(_bfxSel)_bfxSel.textContent=_BEAT_FX_NAMES[_djmBeatFxSel]||'—';
  // Beat FX knob 크기 ↑ — AUX_SZ(46) 보다 크게 (54px host 에 맞춤)
  _mxKnobUpdate('mxBfxLvlKnob',Math.max(-1,Math.min(1,((_djmBeatFxLevel||0)/127.5)-1)),54,true);
  // mxBfxLvlVal 텍스트 제거 (사용자 요청: 노브만 보이게)
  _mxSetAuxToggle('mxBfxOn',!!_djmBeatFxOn,'pur');
  const _bfxAsn=_mxEl('mxBfxAssign');
  if(_bfxAsn)_bfxAsn.textContent=_BEAT_FX_ASSIGN_NAMES[_djmBeatFxAssign]||('?'+_djmBeatFxAssign);
  _mxSetAuxPill('mxFxFLo',_djmFxFreqLo);
  _mxSetAuxPill('mxFxFMid',_djmFxFreqMid);
  _mxSetAuxPill('mxFxFHi',_djmFxFreqHi);
  const _sr=_mxEl('mxSndRtn');
  if(_sr)_sr.textContent='SND/RTN '+_djmSendReturn;
  const _cfxSel=_mxEl('mxCfxSel');
  if(_cfxSel){_cfxSel.textContent=_COLOR_FX_NAMES[_djmColorFxSel]||('#'+_djmColorFxSel);_cfxSel.style.opacity=_djmColorFxSel===255?0.4:1;}
  _mxKnobUpdate('mxCfxKnob',Math.max(-1,Math.min(1,((_djmColorFxParam||128)-128)/128)),26,false);
  const _cfxVal=_mxEl('mxCfxVal');
  if(_cfxVal){const cd=_djmColorFxParam-128;_cfxVal.textContent=cd===0?'0':(cd<0?cd:'+'+cd);}
  _mxKnobUpdate('mxMicHiKnob',Math.max(-1,Math.min(1,((_djmMicEqHi||128)-128)/128)),AUX_SZ,false);
  _mxKnobUpdate('mxMicLoKnob',Math.max(-1,Math.min(1,((_djmMicEqLo||128)-128)/128)),AUX_SZ,false);
  const _micHiVal=_mxEl('mxMicHiVal');
  const _micLoVal=_mxEl('mxMicLoVal');
  if(_micHiVal){const v=_djmMicEqHi-128;_micHiVal.textContent=v===0?'0':(v<0?v:'+'+v);}
  if(_micLoVal){const v=_djmMicEqLo-128;_micLoVal.textContent=v===0?'0':(v<0?v:'+'+v);}
  // BOOTH EQ section 가시성: V10/A9 시에만 (위쪽 .is-v10 일괄 처리에서 mxBoothEqGroup 분기 처리됨)
  _mxKnobUpdate('mxBthHiKnob',Math.max(-1,Math.min(1,((_djmBoothEqHi||128)-128)/128)),AUX_SZ,false);
  _mxKnobUpdate('mxBthLoKnob',Math.max(-1,Math.min(1,((_djmBoothEqLo||128)-128)/128)),AUX_SZ,false);
  const _bthHiVal=_mxEl('mxBthHiVal');
  const _bthLoVal=_mxEl('mxBthLoVal');
  if(_bthHiVal){const v=_djmBoothEqHi-128;_bthHiVal.textContent=v===0?'0':(v<0?v:'+'+v);}
  if(_bthLoVal){const v=_djmBoothEqLo-128;_bthLoVal.textContent=v===0?'0':(v<0?v:'+'+v);}
  _mxSetAuxToggle('mxBthEqBtn',!!_djmBoothEqBtn);
  // HEADPHONES B section 가시성: V10/A9 (위 일괄 처리에서 분기)
  _mxKnobUpdate('mxHpLevelBKnob',Math.max(-1,Math.min(1,((_djmHpLevelB||0)/127.5)-1)),AUX_SZ,true);
  _mxKnobUpdate('mxHpMixBKnob',Math.max(-1,Math.min(1,((_djmHpMixingB||128)-128)/128)),AUX_SZ,false);
  const _hpValB=_mxEl('mxHpValB');
  if(_hpValB)_hpValB.textContent=String(_djmHpLevelB);
  const _hpMixB=_mxEl('mxHpMixB');
  if(_hpMixB){
    const v=_djmHpMixingB-128;
    _hpMixB.textContent=v===0?'C':(v<0?v:'+'+v);
  }
  _mxSetAuxToggle('mxHpLinkB',!!_djmHpCueLinkB,'ylw');
  // V10 전용 섹션 데이터 업데이트 (가시성은 위에서 [hidden] 으로 일괄 처리)
  if(_djmIsV10){
    _mxSetAuxPill('mxFltLPF',_djmFilterLPF,'pur');
    _mxSetAuxPill('mxFltHPF',_djmFilterHPF,'pur');
    _mxKnobUpdate('mxFltResoKnob',Math.max(-1,Math.min(1,((_djmFilterReso||128)-128)/128)),AUX_SZ,false);
    const _flr=_mxEl('mxFltResoVal');
    if(_flr){
      const v=_djmFilterReso-128;
      _flr.textContent=v===0?'0':(v<0?v:'+'+v);
    }
    _mxSetAuxToggle('mxIsoOn',!!_djmIsolatorOn,'pur');
    _mxKnobUpdate('mxIsoHiKnob',Math.max(-1,Math.min(1,((_djmIsolatorHi||128)-128)/128)),ISO_SZ,false);
    _mxKnobUpdate('mxIsoMidKnob',Math.max(-1,Math.min(1,((_djmIsolatorMid||128)-128)/128)),ISO_SZ,false);
    _mxKnobUpdate('mxIsoLoKnob',Math.max(-1,Math.min(1,((_djmIsolatorLo||128)-128)/128)),ISO_SZ,false);
    [['mxIsoHiVal',_djmIsolatorHi],['mxIsoMidVal',_djmIsolatorMid],['mxIsoLoVal',_djmIsolatorLo]].forEach(([id,val])=>{
      const el=_mxEl(id);
      if(!el)return;
      const v=val-128;
      el.textContent=v===0?'0':(v<0?v:'+'+v);
    });
    _mxSetAuxToggle('mxMmxOn',!!_djmMasterMixOn,'pur');
    const _ms=_mxEl('mxMmxSize');if(_ms)_ms.textContent=_djmMasterMixSize;
    const _mt=_mxEl('mxMmxTime');if(_mt)_mt.textContent=_djmMasterMixTime;
    const _mtn=_mxEl('mxMmxTone');if(_mtn)_mtn.textContent=_djmMasterMixTone;
    const _ml=_mxEl('mxMmxLvl');if(_ml)_ml.textContent=_djmMasterMixLevel;
  }
  if(_djmLogOpen&&_djmLog.length){
    const logEl=_mxEl('mxLogPanel');
    if(logEl){logEl.textContent=_djmLog.slice(-40).join('\n');logEl.scrollTop=logEl.scrollHeight;}
  }
}
