// License Panel — settings 탭의 라이센스 섹션 렌더/이벤트 바인딩.
// renderer/index.html 에서 추출 (Phase 1.1 modularization).
// 라이센스 시스템은 test build 에서 비활성 — UI 만 표시 + IPC 호출 (gating 없음).

(function(){
  'use strict';

  function tr(key,fallback){
    return window.t ? window.t(key,fallback) : fallback;
  }

  function statusText(st){
    if(!st)return tr('lic_status_unavailable','License status unavailable');
    if(st.state==='demo'){
      const days = Number.isFinite(st.daysRemaining) ? st.daysRemaining : null;
      const suffix = days==null ? '' : ` · ${days}${tr('lic_days_remaining_suffix',' days remaining')}`;
      return `${tr('lic_demo_build','Demo build')}${suffix}`;
    }
    if(st.state==='expired')return tr('lic_demo_expired','30일 데모가 종료되었습니다. 테스트 해주셔서 감사합니다.');
    if(st.state==='licensed'){
      const plan = st.plan ? ` · ${st.plan}` : '';
      const who = st.name && st.email ? ` · ${st.name} <${st.email}>` : '';
      return `${tr('lic_licensed','Licensed')}${plan}${who}`;
    }
    return `${st.state||'unknown'}${st.plan?' · '+st.plan:''}`;
  }

  function paintStatus(st){
    const badge=document.getElementById('licStatusBadge');
    const detail=document.getElementById('licStatusDetail');
    if(badge){
      badge.textContent=st?.state==='expired'?'DEMO EXPIRED':(st?.state==='demo'?'DEMO':'LICENSED');
      badge.style.color=st?.state==='expired'?'var(--red)':(st?.state==='demo'?'var(--ylw)':'var(--grn)');
    }
    if(detail)detail.textContent=statusText(st);
  }

  async function refresh(){
    try{paintStatus(await window.bridge?.licenseGetStatus?.());}
    catch(_){paintStatus({state:'disabled',message:tr('lic_system_unavailable','License system unavailable in this build.')});}
  }

  // settings 패널 렌더 후 호출 — root = settings root element
  function bind(rootEl){
    if(!rootEl)return;
    const licEmail=rootEl.querySelector('#licEmail');
    const licSerial=rootEl.querySelector('#licSerial');
    const licMsg=rootEl.querySelector('#licStatusDetail');
    const showResult=(r)=>{
      const st=r?.status||r;
      paintStatus(st);
      if(licMsg&&r?.ok===false&&r?.message)licMsg.textContent=r.message;
      else if(licMsg)licMsg.textContent=statusText(st);
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
