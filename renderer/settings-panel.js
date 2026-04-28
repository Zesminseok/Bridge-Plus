// Settings Panel — renderSettings 추출 (Phase 2.3 modularization).
// renderer/index.html 인라인 스크립트에서 분리. top-level 로 로드하여
// 글로벌 lexical env 의 cfg/audioDevs/allIfaces/wfTheme/wfSharpness/_saveCfg/
// _probeAndFillChSels/_wfPersistAndApply/renderDecks/window.bridge/window.BridgeLicensePanel
// 등을 직접 참조 (script-top-level 로딩 순서 의존).

function renderSettings(){
  const el=document.getElementById('pgSettings');
  const devOpts=audioDevs.map(d=>`<option value="${d.deviceId}" ${cfg.aoId===d.deviceId?'selected':''}>${d.label||'Output '+d.deviceId.slice(0,8)}</option>`).join('');
  // network interface options
  const ifaceOpts=(ifaces,field)=>{
    const sel=cfg[field]||'';
    const loopSel=sel==='127.0.0.1'?'selected':'';
    const loopOpt=`<option value="127.0.0.1" ${loopSel}>lo0 (localhost 127.0.0.1) — Arena 같은 맥</option>`;
    const netOpts=ifaces.filter(i=>!i.internal).map(i=>{
      const label=i.hwPort||i.name;
      const suffix=i.address.startsWith('169.254')?'  (링크로컬 CDJ)':'';
      return`<option value="${i.address}" ${sel===i.address?'selected':''}>${i.name} — ${i.address} (${label})${suffix}</option>`;
    }).join('');
    return `<option value="">자동 감지</option>${loopOpt}${netOpts}`;
  };

  // 언어 드롭다운 옵션 빌드 (i18n.js 의 supported list 기반)
  let langOpts = '<option value="auto">'+ (window.t?window.t('lbl_auto_detect','Auto-detect'):'Auto-detect') +'</option>';
  if (window.BridgeI18n) {
    const cur = window.BridgeI18n.getSavedPref();
    const names = window.BridgeI18n.languageNames;
    window.BridgeI18n.supported.forEach(code => {
      langOpts += `<option value="${code}" ${cur===code?'selected':''}>${names[code]||code}</option>`;
    });
  }

  el.innerHTML=`
    <div class="sl" data-i18n="lbl_language">언어</div>
    <div class="sgr">
      <div class="srw"><span class="srl" data-i18n="lbl_language">Language</span><select class="ss" id="langSel">${langOpts}</select></div>
    </div>
    <div class="sl" data-i18n="set_deck_layout">덱 레이아웃</div>
    <div class="sgr">
      <div class="srw"><span class="srl" data-i18n="set_layout_theme">레이아웃 테마</span><select class="ss" id="layoutSel">
        <option value="tower" ${cfg.layout==='tower'?'selected':''}>Tower</option>
        <option value="row" ${cfg.layout==='row'?'selected':''}>Row</option>
        <option value="card" ${cfg.layout==='card'?'selected':''}>Simple</option>
        <option value="observatory" ${cfg.layout==='observatory'?'selected':''}>Observatory</option>
      </select></div>
    </div>
    <div class="sl" data-i18n="set_waveform">웨이브폼 설정</div>
    <div class="sgr">
      <div class="srw"><span class="srl">Theme</span><select class="ss" id="wfThemeSel"><option value="3band" ${wfTheme==='3band'?'selected':''}>3 Band</option><option value="rgb" ${wfTheme==='rgb'?'selected':''}>RGB</option><option value="mono" ${wfTheme==='mono'?'selected':''}>Mono</option></select></div>
      <div class="srw"><span class="srl">Sharpness</span><div style="display:flex;align-items:center;gap:6px"><input type="range" id="wfSharpnessSl" min="0" max="1" step="0.05" value="${wfSharpness}" title="0=sharp 1=legacy 3-tap smoothing" style="width:120px"><span id="wfSharpnessLbl" style="font:400 10px var(--mn);color:var(--tx3);width:32px;text-align:right">${wfSharpness.toFixed(2)}</span></div></div>
      <div class="srw"><span class="srl">플레이헤드 위치</span><select class="ss" id="wfCenterSel"><option value="center" ${cfg.wfCenter==='center'?'selected':''}>중앙 (Center)</option><option value="left" ${cfg.wfCenter==='left'?'selected':''}>좌측 (Left 25%)</option></select></div>
      <div class="srw"><span class="srl">비트 그리드 — 오버뷰</span><select class="ss" id="wfBeatStyleOverviewSel">
        <option value="none" ${wfBeatStyleOverview==='none'?'selected':''}>없음</option>
        <option value="phrase" ${wfBeatStyleOverview==='phrase'?'selected':''}>Phrase 만 (16비트)</option>
        <option value="balanced" ${wfBeatStyleOverview==='balanced'?'selected':''}>균형 (다운비트 + Phrase)</option>
        <option value="detailed" ${wfBeatStyleOverview==='detailed'?'selected':''}>상세 (모든 비트)</option>
        <option value="phrase-band" ${wfBeatStyleOverview==='phrase-band'?'selected':''}>Phrase 강조 (밴드)</option>
        <option value="hybrid" ${wfBeatStyleOverview==='hybrid'?'selected':''}>하이브리드</option>
      </select></div>
      <div class="srw"><span class="srl">비트 그리드 — 디테일</span><select class="ss" id="wfBeatStyleDetailSel">
        <option value="none" ${wfBeatStyleDetail==='none'?'selected':''}>없음</option>
        <option value="phrase" ${wfBeatStyleDetail==='phrase'?'selected':''}>Phrase 만 (16비트)</option>
        <option value="balanced" ${wfBeatStyleDetail==='balanced'?'selected':''}>균형 (다운비트 + Phrase)</option>
        <option value="detailed" ${wfBeatStyleDetail==='detailed'?'selected':''}>상세 (모든 비트)</option>
        <option value="phrase-band" ${wfBeatStyleDetail==='phrase-band'?'selected':''}>Phrase 강조 (밴드)</option>
        <option value="hybrid" ${wfBeatStyleDetail==='hybrid'?'selected':''}>하이브리드</option>
      </select></div>
      <div class="srw"><span class="srl">Phrase 표시</span><select class="ss" id="wfPhraseStyleSel">
        <option value="none" ${wfPhraseStyle==='none'?'selected':''}>없음</option>
        <option value="margin" ${wfPhraseStyle==='margin'?'selected':''}>Margin Tick (minimal)</option>
        <option value="label" ${wfPhraseStyle==='label'?'selected':''}>Mood 라벨 (INTRO/CHORUS/DROP)</option>
        <option value="cycle" ${wfPhraseStyle==='cycle'?'selected':''}>Color Cycling</option>
      </select></div>
      <div class="srw"><span class="srl">큐 마커 스타일</span><select class="ss" id="wfCueStyleSel">
        <option value="chip" ${wfCueStyle==='chip'?'selected':''}>Chip — 라벨 (A/B/C)</option>
        <option value="pill" ${wfCueStyle==='pill'?'selected':''}>Pill — 캡슐</option>
        <option value="diamond" ${wfCueStyle==='diamond'?'selected':''}>Diamond — 마름모</option>
        <option value="bardot" ${wfCueStyle==='bardot'?'selected':''}>Bar+Dot — 풀 막대</option>
        <option value="flag" ${wfCueStyle==='flag'?'selected':''}>Flag — 펜타곤</option>
        <option value="stripe" ${wfCueStyle==='stripe'?'selected':''}>Stripe — 컬러 띠</option>
      </select></div>
    </div>
    <div class="sl" data-i18n="set_license">라이선스</div>
    <div class="sgr">
      <div class="srw"><span class="srl">상태</span><span id="licStatusBadge" class="srv" style="color:var(--ylw)">TEST BUILD</span></div>
      <div class="srw"><span class="srl">이메일</span><input id="licEmail" type="email" autocomplete="off" placeholder="user@example.com" style="background:rgba(255,255,255,.06);border:1px solid var(--bdr2);border-radius:5px;padding:3px 7px;color:var(--tx);font:400 11px var(--mn);outline:none;width:190px;text-align:right"></div>
      <div class="srw"><span class="srl">시리얼 코드</span><input id="licSerial" type="text" autocomplete="off" placeholder="BRIDGE-XXXX-XXXX" style="background:rgba(255,255,255,.06);border:1px solid var(--bdr2);border-radius:5px;padding:3px 7px;color:var(--tx);font:400 11px var(--mn);outline:none;width:190px;text-align:right"></div>
      <div class="srw"><span class="srl">관리</span><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="mode-btn" id="btnLicActivate" style="height:24px;padding:0 10px">Activate</button><button class="mode-btn" id="btnLicRefresh" style="height:24px;padding:0 10px">Refresh</button><button class="mode-btn" id="btnLicDeactivate" style="height:24px;padding:0 10px">Deactivate</button></div></div>
      <div class="srw"><span class="srl">메시지</span><span id="licStatusDetail" class="srv" style="max-width:260px;text-align:right;color:var(--tx3)">License system disabled in test builds.</span></div>
    </div>
    <div class="sl" data-i18n="set_tcnet">TCNet 설정</div>
    <div class="sgr">
      <div class="srw"><span class="srl">Node Name <span style="font:400 9px var(--mn);color:var(--tx4)">(%%=자동번호, 최대8자)</span></span><input type="text" value="${cfg.nm}" data-cfg="nm" placeholder="Bridge%%" style="background:rgba(255,255,255,.06);border:1px solid var(--bdr2);border-radius:5px;padding:3px 7px;color:var(--tx);font:400 11px var(--mn);outline:none;width:110px;text-align:right" maxlength="9"></div>
      <div class="srw"><span class="srl">TCNet 인터페이스</span><select class="ss" data-cfg="tcnetIface">${ifaceOpts(allIfaces,'tcnetIface')}</select></div>
      <div class="srw"><span class="srl">Frame Rate</span><select class="ss" data-cfg="fps">${['24','25','29.97','30'].map(o=>`<option ${cfg.fps===o?'selected':''}>${o}</option>`).join('')}</select></div>
      <div class="srw"><span class="srl">TCNet 모드</span><select class="ss" data-cfg="tcnetMode">${[['auto','Auto'],['server','Server'],['client','Client']].map(([v,l])=>`<option value="${v}" ${cfg.tcnetMode===v?'selected':''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="sl" data-i18n="set_pdjl">Pro DJ Link 설정</div>
    <div class="sgr">
      <div class="srw"><span class="srl">Pro DJ Link 인터페이스</span><select class="ss" data-cfg="pdjlIface">${ifaceOpts(allIfaces,'pdjlIface')}</select></div>
      <div class="srw"><span class="srl">인터페이스 목록</span><button class="mode-btn" id="btnIfaceRefresh" style="height:24px;padding:0 10px">새로고침</button></div>
    </div>
    <div class="sl" data-i18n="set_audio_out">오디오 출력</div>
    <div class="sgr">
      <div class="srw"><span class="srl">출력 장치</span><select class="ss" data-cfg="ao" style="max-width:200px"><option value="">시스템 기본</option>${devOpts}</select></div>
      <div class="srw"><span class="srl">출력 채널</span><div style="display:flex;align-items:center;gap:6px"><select class="ss" data-cfg="aoChPair" style="max-width:120px" disabled><option>감지 중…</option></select><span id="aoChAutoLbl" style="font:400 9px var(--mn);color:var(--grn);display:none">AUTO</span></div></div>
    </div>
    <div class="al alw" style="margin-top:8px">
      <span class="dot" style="width:5px;height:5px;flex-shrink:0;background:var(--ylw)"></span>
      <div style="font:400 10px var(--sn);color:var(--ylw)">
        <b>두 NIC 환경:</b> TCNet 인터페이스 = 공유기 LAN (192.168.x.x), Pro DJ Link 인터페이스 = CDJ 이더넷 (169.254.x.x).<br>
        인터페이스·모드 변경은 실시간 적용됩니다.
      </div>
    </div>
    <div class="sl mt" data-i18n="set_smpte">SMPTE 타임코드 출력</div>
    <div class="sgr">
      <div class="srw"><span class="srl">프레임레이트</span><select class="ss" data-cfg="tcFps">${['24','25','29.97','30'].map(o=>`<option value="${o}" ${cfg.tcFps===o?'selected':''}>${o} fps</option>`).join('')}</select></div>
      <div class="srw"><span class="srl">레이턴시 보정</span><div style="display:flex;align-items:center;gap:6px"><input type="number" step="1" min="-5000" max="5000" value="${cfg.tcOffsetMs|0}" data-cfg="tcOffsetMs" style="background:rgba(255,255,255,.06);border:1px solid var(--bdr2);border-radius:5px;padding:3px 7px;color:var(--tx);font:400 11px var(--mn);outline:none;width:90px;text-align:right"><span style="font:400 10px var(--mn);color:var(--tx3)">ms (LTC/MTC/Art-Net 공통, + 면 TC 앞섬)</span></div></div>
      ${['A','B','M'].map(lyr=>`<div class="srw"><span class="srl">LTC — Layer ${lyr}</span><div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap"><select class="ss" data-cfg="tcLtc${lyr}" style="max-width:180px"><option value="">시스템 기본</option>${audioDevs.map(d=>`<option value="${d.deviceId}" ${cfg[`tcLtc${lyr}`]===d.deviceId?'selected':''}>${d.label||d.deviceId.slice(0,14)}</option>`).join('')}</select><select class="ss" data-cfg="tcLtc${lyr}Ch" style="width:72px" disabled><option>감지 중…</option></select></div></div>`).join('')}
      <div class="srw"><span class="srl">MTC MIDI 출력</span><select class="ss" id="midiOutSel" style="max-width:200px"><option value="">—</option></select></div>
    </div>
    <div class="al alw" style="margin-top:6px;margin-bottom:4px">
      <span class="dot" style="width:5px;height:5px;flex-shrink:0;background:var(--ylw)"></span>
      <div style="font:400 10px var(--sn);color:var(--ylw)">LTC는 음원과 다른 장치로 출력해야 합니다. 덱 카드의 [TC] 버튼으로 모드를 선택하세요.</div>
    </div>
    <div class="sl mt">문제 해결</div>
    <div class="sgr">
      <div class="srw"><span class="srl">잔여 프로세스 정리</span><button id="btnCleanupZombies" class="ss" style="cursor:pointer;width:auto;padding:4px 10px">실행</button></div>
      <div id="cleanupZombiesResult" style="font:400 10px var(--mn);color:var(--tx3);padding:0 2px;margin-top:-2px;display:none;white-space:pre-line;line-height:1.4"></div>
    </div>
    <div class="al alw" style="margin-top:6px;margin-bottom:4px">
      <span class="dot" style="width:5px;height:5px;flex-shrink:0;background:var(--ylw)"></span>
      <div style="font:400 10px var(--sn);color:var(--ylw)">Arena 에 TCNet 이 계속 연결됨으로 표시되거나 포트 충돌 시 사용. 현재 인스턴스는 유지하고 좀비/포트 점유만 정리합니다.</div>
    </div>
    <div class="sl mt">정보</div>
    <div class="sgr">
      <div class="srw"><span class="srl">Version</span><span class="srv" id="appVerLbl">…</span></div>
    </div>`;

  // 동적 버전 표시 — main process 가 package.json + .build-number 합쳐서 반환
  if(window.bridge?.getAppVersion){
    window.bridge.getAppVersion().then(v=>{
      const el2 = document.getElementById('appVerLbl');
      if(el2) el2.textContent = v;
    }).catch(()=>{});
  }

  // 좀비 프로세스 정리 버튼 (외부 DJ Link 브릿지 + BRIDGE+ 좀비 + 포트 점유)
  const _btnCz = el.querySelector('#btnCleanupZombies');
  const _outCz = el.querySelector('#cleanupZombiesResult');
  if(_btnCz && _outCz && window.bridge?.cleanupZombies){
    _btnCz.addEventListener('click', async ()=>{
      _btnCz.disabled = true;
      const orig = _btnCz.textContent;
      _btnCz.textContent = '정리 중…';
      _outCz.style.display = 'block';
      _outCz.style.color = 'var(--tx3)';
      _outCz.textContent = '실행 중…';
      try{
        const r = await window.bridge.cleanupZombies();
        if(!r || r.ok===false){
          _outCz.style.color = 'var(--red,#f55)';
          _outCz.textContent = '실패: ' + (r?.error||'unknown');
        }else{
          const procs = (r.killedProcs||[]).map(p=>`  • ${p.name} (PID ${p.pid})`).join('\n');
          const ports = (r.killedPorts||[]).map(p=>`  • port ${p.port}/${p.proto} (PID ${p.pid})`).join('\n');
          const remaining = (r.remaining||[]).map(p=>`  • port ${p.port}/${p.proto} (PID ${p.pid})`).join('\n');
          const lines = [];
          lines.push(`자기 PID 보호: ${r.selfPid}`);
          lines.push(`종료된 프로세스: ${(r.killedProcs||[]).length}개${procs?'\n'+procs:''}`);
          lines.push(`해제된 포트: ${(r.killedPorts||[]).length}개${ports?'\n'+ports:''}`);
          if((r.remaining||[]).length){
            lines.push(`⚠ 잔여 점유: ${r.remaining.length}개\n${remaining}`);
            _outCz.style.color = 'var(--ylw)';
          }else{
            lines.push('✅ 모든 포트 해제 완료');
            _outCz.style.color = 'var(--grn,#5f5)';
          }
          _outCz.textContent = lines.join('\n');
        }
      }catch(e){
        _outCz.style.color = 'var(--red,#f55)';
        _outCz.textContent = '오류: '+e.message;
      }
      _btnCz.disabled = false;
      _btnCz.textContent = orig;
    });
  }

  el.querySelectorAll('[data-cfg]').forEach(inp=>{
    inp.addEventListener('change',e=>{
      const k=inp.dataset.cfg;
      if(k==='ao'){
        cfg.aoId=e.target.value;
        // Invalidate cache and re-probe for new device
        delete _devChCache[e.target.value||'__default__'];
        const aoChSel=el.querySelector('[data-cfg="aoChPair"]');
        if(aoChSel){aoChSel.disabled=true;aoChSel.innerHTML='<option>감지 중…</option>';}
        _probeDevChannels(e.target.value).then(max=>{
          if(aoChSel){
            const cur=parseInt(cfg.aoChPair)||0;
            _fillChSelPair(aoChSel,max,cur<Math.floor(max/2)?cur:0);
            cfg.aoChPair=parseInt(aoChSel.value)||0;
            aoChSel.disabled=false;
          }
          _rebuildAuRouting();_saveCfg();
        });
        return;
      }
      else if(k==='aoChPair'){cfg.aoChPair=parseInt(e.target.value)||0;_rebuildAuRouting();}
      else if(k==='tcFps'){cfg.tcFps=e.target.value;_saveCfg();window.bridge.artnetSetFps?.(cfg.tcFps);return;}
      else if(/^tcLtc[ABM]$/.test(k)){
        const layer=k.slice(-1);
        delete _devChCache[e.target.value||'__default__'];
        const ltcChSel=el.querySelector(`[data-cfg="tcLtc${layer}Ch"]`);
        if(ltcChSel){ltcChSel.disabled=true;ltcChSel.innerHTML='<option>감지 중…</option>';}
        _probeDevChannels(e.target.value).then(max=>{
          if(ltcChSel){
            const cur=parseInt(cfg[`tcLtc${layer}Ch`])||0;
            _fillChSelMono(ltcChSel,max,cur<max?cur:0);
            cfg[`tcLtc${layer}Ch`]=parseInt(ltcChSel.value)||0;
            ltcChSel.disabled=false;
          }
          _ltcSetDevice(layer,e.target.value,cfg[`tcLtc${layer}Ch`]);
          _saveCfg();
        });
        return;
      }
      else if(/^tcLtc[ABM]Ch$/.test(k)){
        const layer=k.slice(5,6); // 'A','B','M'
        _ltcSetDevice(layer,cfg[`tcLtc${layer}`],parseInt(e.target.value)||0);
      }
      else if(k==='tcArtnetIp'||k==='tcArtnetPort'){cfg[k]=e.target.value;_saveCfg();_artnetRestartIfEnabled();return;}
      else if(k==='anIface'){cfg[k]=e.target.value;_saveCfg();_artnetRestartIfEnabled();return;}
      else if(k==='anDmxUniverse'){cfg[k]=parseInt(e.target.value)||0;_saveCfg();return;}
      else if(k==='anDmxSource'){cfg[k]=e.target.value;_saveCfg();if(cfg.anDmxSource==='off')window.bridge.artnetClearDmx?.();return;}
      else if(k==='tcOffsetMs'){
        const v=parseInt(e.target.value);
        cfg.tcOffsetMs = Number.isFinite(v) ? Math.max(-5000,Math.min(5000,v)) : 0;
        _saveCfg();
        // offset 변경 시 Art-Net 엔진에 즉시 resync 요청 (다음 tick 이 새 offset 반영)
        if(_artEnabled) _artForceResync();
        return;
      }
      else if(k==='anUnicastIp'){cfg[k]=e.target.value.trim();_saveCfg();_artnetRestartIfEnabled();return;}
      else if(k==='anDmxHz'){
        const v=parseInt(e.target.value);
        cfg.anDmxHz=Number.isFinite(v)?Math.max(10,Math.min(50,v)):40;
        _saveCfg();window.bridge.artnetSetDmxHz?.(cfg.anDmxHz);return;
      }
      else if(k==='linkSource'){cfg[k]=e.target.value;_saveCfg();const row=document.getElementById('linkDeckRow');if(row)row.style.display=(cfg[k]==='deck')?'':'none';return;}
      else if(k==='linkDeckIdx'){cfg[k]=parseInt(e.target.value)||0;_saveCfg();return;}
      else if(k==='tcnetIface'){cfg[k]=e.target.value;_saveCfg();if(E&&run)window.bridge.rebindTCNet(e.target.value||null);return;}
      else if(k==='pdjlIface'){cfg[k]=e.target.value;_saveCfg();if(E&&run)window.bridge.rebindPDJL(e.target.value||null);return;}
      else if(k==='tcnetMode'){cfg[k]=e.target.value;_saveCfg();if(E&&run)window.bridge.setTCNetMode(e.target.value||'auto');return;}
      else cfg[k]=e.target.value;
      _saveCfg();
    });
  });
  // Probe audio devices and fill channel selectors (async — updates after render)
  _probeAndFillChSels(el);
  // Language dropdown
  const langSel=el.querySelector('#langSel');
  if(langSel && window.BridgeI18n){
    langSel.onchange=e=>{ window.BridgeI18n.setLang(e.target.value); };
  }
  // Waveform settings
  const wfThemeSel=el.querySelector('#wfThemeSel');
  if(wfThemeSel){wfThemeSel.value=wfTheme;wfThemeSel.onchange=e=>{const v=e.target.value;wfTheme=(v==='rgb'||v==='mono'||v==='3band')?v:'rgb';_wfPersistAndApply();};}
  const wfBeatStyleOverviewSel=el.querySelector('#wfBeatStyleOverviewSel');
  if(wfBeatStyleOverviewSel){wfBeatStyleOverviewSel.onchange=e=>{
    wfBeatStyleOverview=e.target.value;
    _wfWriteLS('wf_beat_style_overview',wfBeatStyleOverview);
    _wfInvalidateAndRedraw();
  };}
  const wfBeatStyleDetailSel=el.querySelector('#wfBeatStyleDetailSel');
  if(wfBeatStyleDetailSel){wfBeatStyleDetailSel.onchange=e=>{
    wfBeatStyleDetail=e.target.value;
    _wfWriteLS('wf_beat_style_detail',wfBeatStyleDetail);
    _wfInvalidateAndRedraw();
  };}
  const wfPhraseStyleSel=el.querySelector('#wfPhraseStyleSel');
  if(wfPhraseStyleSel){wfPhraseStyleSel.onchange=e=>{
    wfPhraseStyle=e.target.value;
    _wfWriteLS('wf_phrase_style',wfPhraseStyle);
    _wfInvalidateAndRedraw();
  };}
  const wfCueStyleSel=el.querySelector('#wfCueStyleSel');
  if(wfCueStyleSel){wfCueStyleSel.onchange=e=>{
    wfCueStyle=e.target.value;
    _wfWriteLS('wf_cue_style',wfCueStyle);
    _wfInvalidateAndRedraw();
  };}
  const wfSharpnessSl=el.querySelector('#wfSharpnessSl');
  if(wfSharpnessSl){wfSharpnessSl.value=String(wfSharpness);wfSharpnessSl.oninput=e=>{wfSharpness=Math.max(0,Math.min(1,Number(e.target.value)||0));const l=el.querySelector('#wfSharpnessLbl');if(l)l.textContent=wfSharpness.toFixed(2);_wfPersistAndApply();};}
  // License 패널 — renderer/license-panel.js 모듈로 위임
  window.BridgeLicensePanel?.bind(el);
  const wfCenterSel=el.querySelector('#wfCenterSel');
  if(wfCenterSel){wfCenterSel.value=cfg.wfCenter||'left';wfCenterSel.onchange=e=>{cfg.wfCenter=e.target.value;_saveCfg();};}
  // Layout 테마 — body data-layout 속성과 cfg.layout 동기화 + renderDecks 재호출
  const layoutSel=el.querySelector('#layoutSel');
  if(layoutSel){layoutSel.value=cfg.layout||'default';layoutSel.onchange=e=>{
    cfg.layout=e.target.value;_saveCfg();
    document.body.dataset.layout=cfg.layout;
    // Layout 변경 = DOM rebuild → 모든 paint-cache key 무효화 (BPM/타이틀/모델 등 재렌더 강제)
    try{
      // DECKS 는 Object — Object.values 로 순회. 직접 for...of 는 동작 안 함.
      if(typeof DECKS !== 'undefined'){
        for(const d of Object.values(DECKS)){
          if(!d) continue;
          d._lastBpmKey = null; d._lastHwlKey = null; d._lastBgKey = null;
          d._lastDidKey = null; d._lastDrawKey = null; d._lastFillKey = null;
          d._lastMcKey = null;
        }
      }
    }catch(_){}
    try{renderDecks();}catch(_){}
    // Force marquee re-measure on next tick — layout change can make titles newly overflow/underflow
    document.querySelectorAll('[id^="dtn"]').forEach(el=>{delete el.dataset.mqChecked;el.classList.remove('scrolling');});
  };}
  // MIDI output device list
  const midiSel=el.querySelector('#midiOutSel');
  if(midiSel&&_midiAccess){
    midiSel.innerHTML='<option value="">—</option>';
    for(const [id,o] of _midiAccess.outputs){
      const opt=document.createElement('option');
      opt.value=id;opt.textContent=o.name;
      if(cfg.tcMidiOutId===id)opt.selected=true;
      midiSel.appendChild(opt);
    }
    midiSel.onchange=e=>{cfg.tcMidiOutId=e.target.value;_mtcSelectOutput(e.target.value);};
  } else if(midiSel){
    _mtcInit().then(()=>{if(_midiAccess)renderSettings();});
  }
  // sync selected values
  el.querySelector('[data-cfg="tcnetIface"]').value=cfg.tcnetIface||'';
  el.querySelector('[data-cfg="pdjlIface"]').value=cfg.pdjlIface||'';
  el.querySelector('[data-cfg="tcnetMode"]').value=cfg.tcnetMode||'auto';
  const btnIfaceRefresh=el.querySelector('#btnIfaceRefresh');
  if(btnIfaceRefresh)btnIfaceRefresh.onclick=async()=>{
    if(!E)return;
    const r=await window.bridge.refreshInterfaces?.();
    allIfaces=r?.interfaces||await window.bridge.getInterfaces()||[];
    const ips=new Set(allIfaces.map(i=>i.address));ips.add('127.0.0.1');
    let changed=false;
    if(cfg.tcnetIface&&!ips.has(cfg.tcnetIface)){cfg.tcnetIface='';changed=true;}
    if(cfg.pdjlIface&&!ips.has(cfg.pdjlIface)){cfg.pdjlIface='';changed=true;}
    if(changed)_saveCfg();
    renderSettings();
  };
  // Art-Net controls
  const chkAn=el.querySelector('#chkAnEnabled');
  if(chkAn)chkAn.onchange=async e=>{
    cfg.anEnabled=e.target.checked;_saveCfg();
    if(cfg.anEnabled){
      const r=await _artnetStart();
      _artEnabled=!!r?.ok;
      _updateArtnetUi(_artEnabled);
      if(!r?.ok){e.target.checked=false;cfg.anEnabled=false;_saveCfg();alert('Art-Net 엔진 시작 실패: '+(r?.err||'unknown'));}
    } else {
      await window.bridge.artnetStop?.();
      _artEnabled=false;_updateArtnetUi(false);
    }
  };
  const chkDmx=el.querySelector('#chkAnDmxEn');
  if(chkDmx)chkDmx.onchange=e=>{
    cfg.anDmxEnabled=e.target.checked;_saveCfg();
    if(!cfg.anDmxEnabled)window.bridge.artnetClearDmx?.();
  };
  // Art-Net 확장 체크박스 핸들러
  const chkAnUni=el.querySelector('#chkAnUnicast');
  if(chkAnUni)chkAnUni.onchange=e=>{
    cfg.anUnicast=e.target.checked;_saveCfg();
    const ipIn=el.querySelector('[data-cfg="anUnicastIp"]');
    if(ipIn) ipIn.disabled=!cfg.anUnicast;
    window.bridge.artnetSetUnicast?.(cfg.anUnicast,cfg.anUnicastIp||'');
  };
  const chkAnPoll=el.querySelector('#chkAnPoll');
  if(chkAnPoll)chkAnPoll.onchange=e=>{
    cfg.anPollReply=e.target.checked;_saveCfg();
    window.bridge.artnetSetPollReply?.(cfg.anPollReply);
    _artnetRestartIfEnabled(); // PollReply 는 listener 리바인드 필요
  };
  const chkAnSync=el.querySelector('#chkAnSync');
  if(chkAnSync)chkAnSync.onchange=e=>{
    cfg.anSync=e.target.checked;_saveCfg();
    window.bridge.artnetSetSync?.(cfg.anSync);
  };
  // Ableton Link 체크박스
  const chkLink=el.querySelector('#chkLinkEnabled');
  if(chkLink)chkLink.onchange=async e=>{
    cfg.linkEnabled=e.target.checked;_saveCfg();
    const st=await window.bridge.linkSetEnabled?.(cfg.linkEnabled);
    _updateLinkUi(st);
    if(cfg.linkEnabled && st && !st.available){
      alert('abletonlink 네이티브 모듈이 설치되어 있지 않습니다.\n'
          + '터미널에서 다음을 실행하세요:\n\n'
          + '  npm i abletonlink\n'
          + '  npx electron-rebuild\n\n'
          + '그 후 BRIDGE+ 를 재시작하세요.');
    }
  };
}
