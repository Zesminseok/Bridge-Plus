// License Panel — settings 탭의 라이센스 섹션 렌더/이벤트 바인딩.
// renderer/index.html 에서 추출 (Phase 1.1 modularization).
// 라이센스 시스템은 test build 에서 비활성 — UI 만 표시 + IPC 호출 (gating 없음).

(function(){
  'use strict';

  function statusText(st){
    if(!st)return 'License status unavailable';
    if(st.state==='disabled')return st.message||'License system disabled in test builds.';
    return `${st.state||'unknown'}${st.plan?' · '+st.plan:''}`;
  }

  function paintStatus(st){
    const badge=document.getElementById('licStatusBadge');
    const detail=document.getElementById('licStatusDetail');
    if(badge){
      badge.textContent=st?.enabled?'ACTIVE':'TEST BUILD';
      badge.style.color=st?.enabled?'var(--grn)':'var(--ylw)';
    }
    if(detail)detail.textContent=statusText(st);
  }

  async function refresh(){
    try{paintStatus(await window.bridge?.licenseGetStatus?.());}
    catch(_){paintStatus({state:'disabled',message:'License system unavailable in this build.'});}
  }

  // settings 패널 렌더 후 호출 — root = settings root element
  function bind(rootEl){
    if(!rootEl)return;
    const licEmail=rootEl.querySelector('#licEmail');
    const licSerial=rootEl.querySelector('#licSerial');
    const licMsg=rootEl.querySelector('#licStatusDetail');
    const showResult=(r)=>{
      paintStatus(r?.status||r);
      if(licMsg&&r?.message)licMsg.textContent=r.message;
    };
    rootEl.querySelector('#btnLicActivate')?.addEventListener('click',async()=>
      showResult(await window.bridge?.licenseActivate?.(licEmail?.value||'',licSerial?.value||'')));
    rootEl.querySelector('#btnLicRefresh')?.addEventListener('click',async()=>
      showResult(await window.bridge?.licenseRefresh?.()));
    rootEl.querySelector('#btnLicDeactivate')?.addEventListener('click',async()=>
      showResult(await window.bridge?.licenseDeactivate?.()));
    refresh();
  }

  window.BridgeLicensePanel={ bind, refresh };
})();
