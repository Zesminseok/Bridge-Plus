// Bridge start/stop IPC — main.js 에서 Phase 3.12 modularization 으로 분리.
// closure 의존 multi: bridge / iv / _ifaceSig 변수가 모두 reassigned 되므로
// setter/getter 형식으로 deps injection.
'use strict';

function _packColorHeightPtsForIpc(pts) {
  if (!Array.isArray(pts) || pts.length === 0) return pts;
  const packed = new Uint8Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p || !Number.isInteger(p.color) || !Number.isInteger(p.height)) return pts;
    if (p.color < 0 || p.color > 15 || p.height < 0 || p.height > 255) return pts;
    const o = i * 2;
    packed[o] = p.color;
    packed[o + 1] = p.height;
  }
  return packed;
}

function _packWaveformForIpc(wf) {
  if (!wf || !Array.isArray(wf.pts)) return wf;
  const pts = _packColorHeightPtsForIpc(wf.pts);
  return pts === wf.pts ? wf : { ...wf, pts };
}

function registerBridgeStartIpc(ipcMain, deps) {
  const {
    setBridge, getBridge,
    setIfaceSig,
    getIv, clearIv,
    getWin,
    BridgeCore,
    getAllInterfaces, interfaceSignature,
    push,
  } = deps;

  ipcMain.handle('bridge:start', async (_, opts) => {
    try {
      const cur = getBridge();
      if (cur?.running) {
        cur.stop();
        // wait for socket release before rebinding (macOS port reuse)
        await new Promise(r => setTimeout(r, 300));
      }
      const newBridge = new BridgeCore(opts || {});
      setBridge(newBridge);
      setIfaceSig(interfaceSignature(getAllInterfaces()));
      const _send = (ch, d) => {
        try {
          const w = getWin();
          if (w && !w.isDestroyed()) w.webContents.send(ch, d);
        } catch (_) { /* swallow */ }
      };
      newBridge.onNodeDiscovered = n => _send('tcnet:node', n);
      newBridge.onCDJStatus = (li, s) => _send('bridge:cdj', { layerIndex: li, status: s });
      newBridge.onDJMStatus = f => _send('bridge:djm', {
        // core
        name: f.name, isV10: f.isV10, numCh: f.numCh,
        faders: f.channel || f, onAir: f.onAir, eq: f.eq, hasRealFaders: f.hasRealFaders,
        cueBtn: f.cueBtn, cueBtnB: f.cueBtnB, xfAssign: f.xfAssign, chExtra: f.chExtra,
        xfader: f.xfader, masterLvl: f.masterLvl, masterCue: f.masterCue, masterCueB: f.masterCueB,
        masterBalance: f.masterBalance, eqCurve: f.eqCurve, faderCurve: f.faderCurve, xfCurve: f.xfCurve,
        // Isolator (A9/V10)
        isolatorOn: f.isolatorOn, isolatorHi: f.isolatorHi, isolatorMid: f.isolatorMid, isolatorLo: f.isolatorLo,
        // Booth (+EQ A9/V10)
        boothLvl: f.boothLvl, boothEqHi: f.boothEqHi, boothEqLo: f.boothEqLo, boothEqBtn: f.boothEqBtn,
        // HP A/B
        hpCueCh: f.hpCueCh, hpCueLink: f.hpCueLink, hpCueLinkB: f.hpCueLinkB,
        hpMixing: f.hpMixing, hpMixingB: f.hpMixingB, hpLevel: f.hpLevel, hpLevelB: f.hpLevelB,
        // Beat FX
        fxFreqLo: f.fxFreqLo, fxFreqMid: f.fxFreqMid, fxFreqHi: f.fxFreqHi,
        beatFxSel: f.beatFxSel, beatFxAssign: f.beatFxAssign, beatFxLevel: f.beatFxLevel, beatFxOn: f.beatFxOn,
        multiIoSel: f.multiIoSel, sendReturn: f.sendReturn,
        // Mic
        micEqHi: f.micEqHi, micEqLo: f.micEqLo,
        // Filter (V10)
        filterLPF: f.filterLPF, filterHPF: f.filterHPF, filterReso: f.filterReso,
        // Color FX + Send Ext
        colorFxSel: f.colorFxSel, sendExt1: f.sendExt1, sendExt2: f.sendExt2, colorFxParam: f.colorFxParam,
        // Master Mix (V10)
        masterMixOn: f.masterMixOn, masterMixSize: f.masterMixSize,
        masterMixTime: f.masterMixTime, masterMixTone: f.masterMixTone, masterMixLevel: f.masterMixLevel,
        // diagnostics
        pktType: f.pktType, pktLen: f.pktLen, rawHex: f.rawHex,
      });
      let _djmMeterLastTs = 0;
      newBridge.onDJMMeter = d => {
        const now = Date.now();
        if (now - _djmMeterLastTs < 33) return; // ~30Hz cap to renderer (source ~50Hz)
        _djmMeterLastTs = now;
        _send('bridge:djmmeter', d);
      };
      newBridge.onTCMixerVU = d => _send('bridge:tcmixervu', d);
      newBridge.onDeviceList = devs => {
        // stale(>10s) 기기 필터링 — UI에 유령 장치/쓰레기값 남지 않도록.
        const now = Date.now();
        const active = Object.values(devs || {}).filter(
          d => d && (now - (d.lastSeen || 0)) < 10000 && d.name !== 'BRIDGE+' && d.ip !== '127.0.0.1'
        );
        _send('pdjl:devices', active);
      };
      newBridge.onWaveformPreview = (pn, wf) => _send('bridge:wfpreview', { playerNum: pn, ..._packWaveformForIpc(wf) });
      newBridge.onWaveformDetail  = (pn, wf) => _send('bridge:wfdetail',  { playerNum: pn, ..._packWaveformForIpc(wf) });
      newBridge.onCuePoints       = (pn, cues) => _send('bridge:cuepoints', { playerNum: pn, cues });
      newBridge.onBeatGrid        = (pn, bg) => _send('bridge:beatgrid', { playerNum: pn, ...bg });
      newBridge.onSongStructure   = (pn, ss) => _send('bridge:songstruct', { playerNum: pn, ...ss });
      newBridge.onAlbumArt        = (pn, b64) => _send('bridge:albumart', { playerNum: pn, art: b64 });
      newBridge.onTrackMetadata   = (pn, meta) => _send('bridge:trackmeta', { playerNum: pn, ...meta });
      await newBridge.start(); push();
      // Re-request metadata for already-loaded tracks — retry at 3s.
      setTimeout(() => getBridge()?.refreshAllMetadata(), 3000);
      return {
        ok: true,
        pdjlPort: newBridge.getPDJLPort(),
        broadcastAddr: newBridge.broadcastAddr,
        nodeName: newBridge.nodeName || 'BRIDGE+',
      };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  });

  ipcMain.handle('bridge:stop', async () => {
    getBridge()?.stop();
    clearIv();
    return { ok: true };
  });
}

module.exports = { registerBridgeStartIpc, _packColorHeightPtsForIpc, _packWaveformForIpc };
