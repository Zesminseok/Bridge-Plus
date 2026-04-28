// renderer/history-panel.js
// 히스토리 패널 — ON AIR 10초+ 재생된 트랙을 자동 기록 + CSV export.
// 메인 렌더러 코드에서 _histAddEntry/_histOnAirChange/_histOnNewTrack/_histExport/renderHistory 를
// window 글로벌로 노출 (Phase 2 modularization). DECKS state 는 메인 렌더러 소유.

'use strict';

(function(root){

  const _histLog = [];
  let _histSessionStart = null;

  // 트랙 메타데이터 (ID3 tag, dbserver) 는 외부 파일에서 옴 — XSS 방어용 escape.
  // textContent 는 사용 못 함 (HTML 구조와 텍스트 조합) → 기본 HTML entity escape.
  function _esc(s){
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function _histStartSession(){
    if(!_histSessionStart){
      _histSessionStart = Date.now();
      const el = document.getElementById('histSession');
      if(el) el.textContent = new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
    }
  }

  function _histFinalizeOnAir(dk){
    if(dk._histOnAirStart){
      dk._histOnAirMs = (dk._histOnAirMs||0) + (Date.now() - dk._histOnAirStart);
      dk._histOnAirStart = null;
    }
  }

  function _histAddEntry(slot, dk){
    if(!dk.tn) return;
    // 중복 체크: 같은 곡이 이미 마지막에 추가됐으면 skip
    const last = _histLog[_histLog.length-1];
    if(last && last.slot===slot && last.tn===dk.tn && last.ar===dk.ar) return;
    _histLog.push({
      slot, tn: dk.tn, ar: dk.ar||'', bpm: dk.bpm||0, key: dk.key||'',
      loadTime: dk._histLoadTime||Date.now(), onAirMs: dk._histOnAirMs||0, addedAt: Date.now(),
    });
    renderHistory();
  }

  function _histOnNewTrack(slot, dk){
    _histFinalizeOnAir(dk);
    if((dk._histOnAirMs||0) >= 10000 && dk.tn) _histAddEntry(slot, dk);
    dk._histOnAirMs = 0;
    dk._histOnAirStart = null;
    dk._histLoadTime = Date.now();
  }

  function _histOnAirChange(slot, dk, wasOnAir, isOnAir){
    if(!wasOnAir && isOnAir && dk.ld){
      dk._histOnAirStart = dk._histOnAirStart || Date.now();
    } else if(wasOnAir && !isOnAir && dk._histOnAirStart){
      dk._histOnAirMs = (dk._histOnAirMs||0) + (Date.now() - dk._histOnAirStart);
      dk._histOnAirStart = null;
      if((dk._histOnAirMs||0) >= 10000 && dk.tn) _histAddEntry(slot, dk);
    }
  }

  function _histExport(){
    if(!_histLog.length) return;
    const hdr = '#,TITLE,ARTIST,BPM,KEY,DECK,ON AIR(s),TIME\n';
    const rows = _histLog.map((e,i) =>
      `${i+1},"${e.tn}","${e.ar}",${e.bpm},${e.key},DECK${e.slot+1},${Math.round(e.onAirMs/1000)},${new Date(e.addedAt).toLocaleTimeString('ko-KR')}`
    ).join('\n');
    const url = URL.createObjectURL(new Blob([hdr+rows], {type:'text/csv'}));
    const a = document.createElement('a');
    a.href = url; a.download = 'bridge-history.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function renderHistory(){
    const list = document.getElementById('histList');
    if(!list) return;
    const cnt = document.getElementById('histCount');
    if(cnt) cnt.textContent = _histLog.length;
    const stCnt = document.getElementById('histStatCount');
    if(stCnt) stCnt.textContent = _histLog.length;
    const totalMs = _histLog.reduce((s,e) => s + e.onAirMs, 0);
    const stTime = document.getElementById('histStatTime');
    if(stTime) stTime.textContent = Math.floor(totalMs/60000)+'m'+Math.floor((totalMs%60000)/1000)+'s';
    const bpms = _histLog.filter(e => e.bpm>0);
    const stBpm = document.getElementById('histStatBpm');
    if(stBpm) stBpm.textContent = bpms.length ? (bpms.reduce((s,e) => s + e.bpm, 0)/bpms.length).toFixed(1) : '—';
    if(!_histLog.length){
      list.innerHTML = `<div class="hist-empty"><span class="material-symbols-outlined">music_off</span><span class="hist-empty-tx">아직 기록된 트랙이 없습니다</span><span style="font:400 10px var(--sn);color:var(--tx4)">ON AIR 10초 이상 재생된 트랙이 여기 표시됩니다</span></div>`;
      return;
    }
    const now = Date.now();
    list.innerHTML = [..._histLog].reverse().map((e,ri) => {
      const i = _histLog.length - ri;
      const isNew = now - e.addedAt < 300000;
      const cls = e.onAirMs >= 30000 ? 'full' : 'short';
      const ts = new Date(e.addedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
      const dur = Math.floor(e.onAirMs/60000)+'m'+Math.floor((e.onAirMs%60000)/1000)+'s';
      return `<div class="hist-row ${cls}">
        <span class="hist-idx">${i}</span>
        <div class="hist-art"><img src="assets/default-art.png" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"></div>
        <div class="hist-info"><div class="hist-tn">${_esc(e.tn)}${isNew?'<span class="hist-new">NEW</span>':''}</div><div class="hist-ar">${_esc(e.ar)}</div></div>
        <span class="hist-bpm">${e.bpm?e.bpm.toFixed(1):'—'}</span>
        <span class="hist-key">${_esc(e.key)||'—'}</span>
        <span class="hist-deck">DECK ${e.slot+1}</span>
        <span class="hist-ts">${ts}</span>
        <span class="hist-dur">${dur}</span>
      </div>`;
    }).join('');
  }

  // 글로벌 노출 — 기존 호출 사이트와 호환.
  if(typeof window !== 'undefined'){
    window._histLog = _histLog;
    window._histStartSession = _histStartSession;
    window._histFinalizeOnAir = _histFinalizeOnAir;
    window._histAddEntry = _histAddEntry;
    window._histOnNewTrack = _histOnNewTrack;
    window._histOnAirChange = _histOnAirChange;
    window._histExport = _histExport;
    window.renderHistory = renderHistory;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
