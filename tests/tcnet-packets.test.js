'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const corePath = path.join(__dirname, '..', 'bridge-core.js');
const core = require(corePath);

function test(name, fn){
  try{
    fn();
    console.log(`ok - ${name}`);
  }catch(err){
    console.error(`not ok - ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

function loadPrivateBuilders(){
  const source = fs.readFileSync(corePath, 'utf8');
  const Module = require('module');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    // bridge-core.js 가 './pdjl/packets' 같은 상대경로를 require 하도록 corePath 기준 require 사용
    require: Module.createRequire(corePath),
    __dirname: path.dirname(corePath),
    __filename: corePath,
    Buffer,
    console,
    process,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(`${source}\nmodule.exports.__test = { mkMixerData, nxs2BeatCountToMs, shouldKeepPredictedBeatAnchor, parsePDJL };`, sandbox, { filename: corePath });
  return sandbox.module.exports.__test;
}

function makeRequest(dataType, layer){
  const msg = Buffer.alloc(core.TC.H + 2);
  msg.writeUInt16LE(0x1234, 0);
  msg[2] = 3;
  msg[3] = 5;
  msg.write('TCN', 4, 'ascii');
  msg[7] = 0x14;
  msg.write('ARENA\0\0\0', 8, 8, 'ascii');
  msg[17] = 4;
  msg[core.TC.H] = dataType;
  msg[core.TC.H + 1] = layer;
  return msg;
}

test('TCNet Request body is parsed as dataType then layer', () => {
  const bridge = new core.BridgeCore({ tcnetIface: '127.0.0.1' });
  bridge.layers[1] = { trackName: 'Layer 2', artistName: 'Artist', trackId: 222, state: core.STATE.PLAYING };
  bridge.layers[3] = { trackName: 'Layer 4', artistName: 'Wrong', trackId: 444, state: core.STATE.PLAYING };
  const sent = [];
  bridge._uc = (pkt) => sent.push(pkt);

  bridge._handleTCNetMsg(makeRequest(core.TC.DT_META, 2), { address: '127.0.0.1', port: 65032 }, 'test');

  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0][core.TC.H], core.TC.DT_META);
  assert.strictEqual(sent[0][core.TC.H + 1], 2);
  assert.strictEqual(sent[0].readUInt32LE(543), 222);
});

test('Status Layer Source uses TCNet absolute byte 34/body offset 10', () => {
  const pkt = core.mkStatus(65032, {}, [{ state: core.STATE.PLAYING, trackId: 1, deviceName: 'CDJ' }], [255], [true]);
  assert.strictEqual(pkt[34], 1);
  assert.strictEqual(pkt[32], 0);
});

test('TCNet header minor matches Arena-compatible v3.5', () => {
  const pkt = core.mkDataMeta(1, { artistName: 'A', trackName: 'T', trackId: 7 });
  assert.strictEqual(pkt[2], 3);
  assert.strictEqual(pkt[3], 5);
});

test('Metadata text is UTF-32LE like PRO DJ LINK Bridge', () => {
  const pkt = core.mkDataMeta(1, { artistName: 'AB', trackName: '희망', trackId: 7 });
  assert.strictEqual(pkt[29], 0x41);
  assert.strictEqual(pkt[30], 0x00);
  assert.strictEqual(pkt[31], 0x00);
  assert.strictEqual(pkt[32], 0x00);
  assert.strictEqual(pkt[33], 0x42);
  assert.strictEqual(pkt[285], 0x6c);
  assert.strictEqual(pkt[286], 0xd7);
  assert.strictEqual(pkt[289], 0xdd);
  assert.strictEqual(pkt[290], 0xb9);
});

test('MixerData channel block follows TCNet V3.5 field order', () => {
  const { mkMixerData } = loadPrivateBuilders();
  const pkt = mkMixerData([99], 'DJM-900NXS2', { eq: [[10, 20, 30, 40]], xfAssign: [2], xfader: 123, masterLvl: 231 });
  const body = pkt.slice(core.TC.H);
  const off = 101;

  assert.strictEqual(body[75], 123);
  assert.strictEqual(body[off + 1], 99);
  assert.strictEqual(body[off + 2], 99);
  assert.strictEqual(body[off + 3], 10);
  assert.strictEqual(body[off + 4], 0);
  assert.strictEqual(body[off + 5], 20);
  assert.strictEqual(body[off + 6], 30);
  assert.strictEqual(body[off + 7], 0);
  assert.strictEqual(body[off + 8], 40);
  assert.strictEqual(body[off + 13], 2);
});

test('DJM 0x57 subscribe matches native macOS bridge bitmask', () => {
  const pkt = core.buildDjmSubscribePacket('darwin');
  assert.strictEqual(pkt.slice(0, 10).compare(core.PDJL.MAGIC), 0);
  assert.strictEqual(pkt[0x0A], 0x57);
  assert.strictEqual(pkt[0x1f], 0x01);
  assert.strictEqual(pkt[0x20], 0x00);
  assert.strictEqual(pkt[0x21], 0xfe);
  assert.strictEqual(pkt[0x22], 0x00);
  assert.strictEqual(pkt[0x23], 0x04);
  assert.strictEqual(pkt[0x24], 0x01);
});

test('DJM 0x57 subscribe matches official bridge Windows bitmask', () => {
  const pkt = core.buildDjmSubscribePacket('win32');
  assert.strictEqual(pkt.slice(0, 10).compare(core.PDJL.MAGIC), 0);
  assert.strictEqual(pkt[0x0A], 0x57);
  assert.strictEqual(pkt[0x1f], 0x01);
  assert.strictEqual(pkt[0x20], 0x00);
  assert.strictEqual(pkt[0x21], 0xff);
  assert.strictEqual(pkt[0x22], 0x00);
  assert.strictEqual(pkt[0x23], 0x04);
  assert.strictEqual(pkt[0x24], 0x01);
});

test('DJM path does not keep a dedicated unicast keepalive helper', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes('const sendDjmAnn='), false);
  assert.strictEqual(source.includes('DJM keepalive #'), false);
});

test('DJM handlers do not trigger bridge join re-entry', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes('_bridgeJoinFn'), false);
});

test('PDJL announce path uses selected interface identity instead of iterating all interfaces', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes('for(const iface of getAllInterfaces()){\n        if(!iface.internal&&iface.broadcast&&iface.broadcast!==\'127.255.255.255\'){\n          const pkt=buildPdjlBridgeKeepalivePacket(iface.address,iface.mac||pdjlMAC,spoofPlayer);'), false);
  assert.strictEqual(source.includes('const ifaces = getAllInterfaces().filter(i=>!i.internal&&i.broadcast&&i.broadcast!==\'127.255.255.255\');'), false);
  assert.strictEqual(source.includes('getAllInterfaces()\n        .filter(i=>!i.internal && i.broadcast && i.broadcast!==\'127.255.255.255\')\n        .map(i=>i.broadcast)\n        .concat([\'255.255.255.255\'])'), false);
});

test('PDJL announce path stays on the selected interface broadcast only', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes("if(iface) return [iface.broadcast, '255.255.255.255'];"), false);
});

test('DJM subscribe sockets preserve Windows path and use macOS ephemeral bridge socket', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes("process.platform==='win32'"), true);
  assert.strictEqual(source.includes('this._pdjlSocketByPort?.[50001]'), true);
  assert.strictEqual(source.includes('this._djmSubAuxSock.bind(0, pdjlIP'), true);
  assert.strictEqual(source.includes("process.platform==='darwin'\n        ? [this._djmSubAuxSock].filter(Boolean)"), true);
});

test('macOS bridge notify uses DJM bridge socket', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes("const notifySock = process.platform==='darwin'\n        ? this._djmSubAuxSock"), true);
  assert.strictEqual(source.includes('[PDJL-DIAG] mac 0x55 src='), true);
});

test('macOS bridge join timing matches STC reference capture pattern', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes("const macJoin = process.platform==='darwin';"), true);
  assert.strictEqual(source.includes('const HELLO_GAP = macJoin ? 300 : 110;'), true);
  assert.strictEqual(source.includes('const CLAIM_GAP = macJoin ? 500 : 150;'), true);
  assert.strictEqual(source.includes('const HELLO_N = macJoin ? 2 : 14;'), true);
  assert.strictEqual(source.includes('const CLAIM_N = macJoin ? 11 : 22;'), true);
  assert.strictEqual(source.includes('},1500);'), true);
});

test('Windows PDJL sockets bind to the selected interface IP', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes("const autoPdjlIface = (process.platform==='win32' && !this._shouldDelayWinAutoPdjl())"), true);
  assert.strictEqual(source.includes("const bindAddr = process.platform==='win32' ? winBindIp : undefined;"), true);
  assert.strictEqual(source.includes('s.bind(50000, pdjlIP, ()=>{ try{s.setBroadcast(true);}catch(_){} });'), true);
});

test('Windows auto PDJL selection prefers link-local interfaces before TCNet localAddr', () => {
  // Phase 5.9: 본문이 bridge/network-helpers.js 로 이동 — module 측 검증.
  const netHelpers = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'network-helpers.js'), 'utf8');
  assert.match(netHelpers, /function isLinkLocalIp\(ip\)\{/);
  assert.match(netHelpers, /const linkLocal = ifaces\.find\(iface=>isLinkLocalIp\(iface\.address\)\);/);
  // bridge-core 는 wrapper + 사용처 보존
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes('const autoIface = this._pickAutoPdjlIface();'), true);
});

test('Windows auto mode delays initial PDJL announce until a remote device is detected', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes('_shouldDelayWinAutoPdjl(){'), true);
  assert.strictEqual(source.includes("console.log('[PDJL] Windows auto mode: delaying announce until remote PDJL device is detected');"), true);
  assert.strictEqual(source.includes("console.log('[PDJL] Windows auto mode: waiting for remote PDJL after rebind reset');"), true);
  assert.strictEqual(source.includes("const autoPdjlIface = (process.platform==='win32' && !this._shouldDelayWinAutoPdjl())"), true);
});

test('PDJL bridge hello matches hardware-capture layout', () => {
  const pkt = core.buildPdjlBridgeHelloPacket(5);
  assert.strictEqual(pkt.length, 37);
  assert.strictEqual(pkt.toString('hex'), '5173707431576d4a4f4c0a005443532d53484f574b4f4e54524f4c00000000000101002505');
});

test('PDJL bridge claim uses device id at byte 0x31', () => {
  const pkt = core.buildPdjlBridgeClaimPacket('169.254.1.10', '02:00:00:00:00:01', 1, 5, 'darwin');
  assert.strictEqual(pkt[0x0A], 0x02);
  assert.strictEqual(pkt[0x30], 0x05);
  assert.strictEqual(pkt[0x31], 0x00);
  assert.strictEqual(pkt.slice(0x24, 0x28).toString('hex'), 'a9fe010a');
  assert.strictEqual(pkt.slice(0x28, 0x2e).toString('hex'), '020000000001');
});

test('PDJL bridge claim macOS check byte uses STC formula mac[5] XOR (counter*3 + 0xFB)', () => {
  const mac = '00:e0:4c:68:07:08';
  const macLast = 0x08;
  for(let n=1;n<=11;n++){
    const expected = (macLast ^ ((n*3 + 0xFB) & 0xFF)) & 0xFF;
    const pkt = core.buildPdjlBridgeClaimPacket('169.254.182.136', mac, n, 5, 'darwin');
    assert.strictEqual(pkt[0x2E], expected, `n=${n}`);
    assert.strictEqual(pkt[0x2F], n);
  }
});

test('PDJL bridge claim preserves current Windows check-byte formula', () => {
  const ip = '169.254.56.19';
  const mac = 'c8:4d:44:24:13:b2';
  const expected = [0xea,0xeb,0xe8,0xe9,0xee,0xef,0xec,0xed];
  for(let i=0;i<expected.length;i++){
    const pkt = core.buildPdjlBridgeClaimPacket(ip, mac, i+1, 5, 'win32');
    assert.strictEqual(pkt[0x2E], expected[i]);
    assert.strictEqual(pkt[0x2F], i+1);
  }
});

test('PDJL bridge keepalive matches native macOS bridge role bytes', () => {
  // macOS native bridge path: identity byte 0xF9, byte 0x30=0x03,
  // 0x34=playerNum, 0x35=0x20 device-type role.
  const pkt = core.buildPdjlBridgeKeepalivePacket('169.254.1.10', '02:00:00:00:00:01', 5, 'darwin');
  assert.strictEqual(pkt.length, 54);
  assert.strictEqual(pkt[0x0A], 0x06);
  assert.strictEqual(pkt[0x24], 0xF9);
  assert.strictEqual(pkt[0x30], 0x03);
  assert.strictEqual(pkt[0x34], 0x05);
  assert.strictEqual(pkt[0x35], 0x20);
});

test('PDJL bridge keepalive preserves Windows role byte', () => {
  const pkt = core.buildPdjlBridgeKeepalivePacket('169.254.1.10', '02:00:00:00:00:01', 5, 'win32');
  assert.strictEqual(pkt[0x30], 0x08);
});

test('Windows dbserver keepalive uses TCS-SHOWKONTROL name (Pioneer pcap-verified)', () => {
  // 95B keepalive identity must match the compatibility fixture for device recognition.
  // (이전엔 'BRIDGE+' 사용했으나 CDJ 가 dbserver 인식 못 해 cue/meta 미수신 가능성)
  const pkt = core.buildDbServerKeepalivePacket('169.254.1.10', '02:00:00:00:00:01', 5, 'win32');
  assert.strictEqual(pkt.length, 95);
  assert.strictEqual(pkt[0x0A], 0x06);
  assert.strictEqual(pkt.toString('ascii', 0x0C, 0x1B).replace(/\0+$/,''), 'TCS-SHOWKONTROL');
  assert.strictEqual(pkt[0x20], 0x01);
  assert.strictEqual(pkt[0x21], 0x01);
  assert.strictEqual(pkt[0x23], 0x36);
  assert.strictEqual(pkt[0x24], 0x05);
  assert.strictEqual(pkt.slice(0x26, 0x2c).toString('hex'), '020000000001');
  assert.strictEqual(pkt.slice(0x2c, 0x30).toString('hex'), 'a9fe010a');
  assert.strictEqual(pkt[0x35], 0x20);
  assert.strictEqual(pkt.toString('ascii', 54, 69), 'PIONEER DJ CORP');
  assert.strictEqual(pkt.toString('ascii', 74, 90), 'PRODJLINK BRIDGE');
  assert.strictEqual(pkt[94], 0x43);
});

test('PDJL bridge notify is a single 44B packet matching Pioneer Bridge / STC layout', () => {
  const pkt = core.buildBridgeNotifyPacket(5, 'darwin');
  assert.strictEqual(pkt.length, 44);
  assert.strictEqual(pkt[0x0A], 0x55);
  assert.strictEqual(pkt[31], 0x01);
  assert.strictEqual(pkt[32], 0x00);
  assert.strictEqual(pkt[33], 0x8B);
  assert.strictEqual(pkt[34], 0x08);
  assert.strictEqual(pkt[39], 0x01);
  assert.strictEqual(pkt[40], 0x05);
  assert.strictEqual(pkt[41], 0x01);
  assert.strictEqual(pkt[42], 0x03);
  assert.strictEqual(pkt[43], 0x01);
});

test('bridge notify emits a single packet on both platforms (no darwin burst)', () => {
  const macPkts = core.buildBridgeNotifyPacketsForDevice(5, 'darwin', {
    name:'CDJ-3000', devType:0x03, state:{slot:0x03, trackType:0x03},
  });
  const winPkts = core.buildBridgeNotifyPacketsForDevice(5, 'win32', {});
  assert.strictEqual(macPkts.length, 1);
  assert.strictEqual(winPkts.length, 1);
  assert.strictEqual(macPkts[0].toString('hex'), winPkts[0].toString('hex'));
});

test('renderer consumes dedicated DJM stereo master meter peaks', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const mixerSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'mixer-panel.js'), 'utf8');
  const source = indexSrc + '\n' + mixerSrc; // mixer 코드는 mixer-panel.js 로 이동 (Phase 2.4)
  assert.strictEqual(source.includes('if(d.masterL!=null)_djmMasterVuL=d.masterL;'), true);
  assert.strictEqual(source.includes('if(d.masterR!=null)_djmMasterVuR=d.masterR;'), true);
  assert.strictEqual(source.includes('if(d.masterLBands!=null)_djmMasterLBands=d.masterLBands;'), true);
  assert.strictEqual(source.includes('if(d.masterRBands!=null)_djmMasterRBands=d.masterRBands;'), true);
  assert.strictEqual(source.includes('const hasStereoMasterVu=(_djmMasterVuL>0||_djmMasterVuR>0)||(_djmMasterLBands?.length>0)||(_djmMasterRBands?.length>0);'), true);
  assert.strictEqual(source.includes('function _vuDisplayFrom255(v,gain=1.7,gamma=0.72){'), true);
  assert.strictEqual(source.includes('function _vuDisplayFromBands(bands,gain=2.2,gamma=0.72){'), true);
});

test('renderer treats master cue as button state', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const mixerSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'mixer-panel.js'), 'utf8');
  const source = indexSrc + '\n' + mixerSrc;
  assert.strictEqual(source.includes("const _masterCueOn=!!(_djmMasterCue||_djmMasterCueB||_djmHpCueLink||_djmHpCueLinkB);"), true);
  assert.strictEqual(source.includes("if(_mcueBtn)_mcueBtn.classList.toggle('on',_masterCueOn);"), true);
  assert.strictEqual(source.includes("_mxSetAuxToggle('mxCueMasterAux',_masterCueOn,'ylw');"), true);
});

test('bridge forwards DJM stereo master meter peaks to renderer', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes('this.onDJMMeter?.({ch:p.ch, spectrum:p.spectrum, masterL:p.masterL, masterR:p.masterR, masterLBands:p.masterLBands, masterRBands:p.masterRBands});'), true);
});

test('dbserver follow-up requests are staggered instead of firing all at once', () => {
  // Phase 5.4: _scheduleDbFollowUps 본문이 bridge/dbserver-orchestrator.js 로 이동.
  // _dbserverMetadata 본문이 bridge/dbserver-client.js 에서 core._scheduleDbFollowUps 호출.
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'dbserver-client.js'), 'utf8');
  assert.strictEqual(cliSource.includes('core._scheduleDbFollowUps(ip, slot, trackId, playerNum, tt, meta.artworkId||0);'), true);
  // defer 호출은 orchestrator 모듈 본체 안에서 발생 — core.* 형태로 wrapper 재진입.
  const orchSource = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'dbserver-orchestrator.js'), 'utf8');
  assert.strictEqual(orchSource.includes('defer(520, ()=>core._dbserverWaveformDetail(ip, slot, trackId, playerNum, trackType));'), true);
  assert.strictEqual(orchSource.includes('defer(1640, ()=>core._dbserverBeatGrid(ip, slot, trackId, playerNum, trackType));'), true);
});

test('virtual waveform bin rate constants exist', () => {
  // VIRTUAL_WF_RATE=120 (overview), HW_WF_RATE=150, RGB_WF_FINE_RATE 는 fine path 가 no-op 으로 변환된 후
  // 상수 자체는 존재 (값은 변경 가능). VIRTUAL 만 강제 검증.
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(source, /const VIRTUAL_WF_(?:RATE|\\u\{52\}ATE)\s*=\s*120/, 'overview bin rate constant');
  assert.match(source, /const HW_WF_(?:RATE|\\u\{52\}ATE)\s*=\s*150/, 'hardware bin rate constant');
});

test('deck UI repaint is throttled separately from TCNet tick', () => {
  // Waveform 은 outer rAF 네이티브 속도 (디스플레이 refresh 에 sync — ProMotion 120Hz, 60Hz 모니터 60fps).
  // 다른 deck UI 는 30fps (_DECK_UI_TICK_MS).
  // 사용자 선호: '웨이브폼은 디스플레이 리프레시, 나머지는 30프레임'.
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(source, /const _DECK_UI_TICK_MS\s*=\s*1000\s*\/\s*30/, 'deck UI throttle should be 30fps');
  // outer rAF 본문에 시간 gate (1000/120 등) 가 다시 들어오지 않았는지.
  assert.ok(!/const _TICK_MS\s*=/.test(source), '_TICK_MS gate 가 다시 추가됨 (rAF 네이티브 속도 회귀)');
  // _rafTick 안에서 requestAnimationFrame + tick() 호출 — idle 체크 후 풀레이트 경로 보존.
  assert.match(source, /function _rafTick\(\)\{[\s\S]{0,400}requestAnimationFrame\(_rafTick\);[\s\S]{0,40}tick\(\);/);
  assert.match(source, /const shouldPaintDeckUi=deckUiVisible&&\(now-_lastDeckUiPaint>=_DECK_UI_TICK_MS\)/, 'deck UI gate');
});

test('idle downshift — 창 가시성 기반 (visible: rAF, hidden: 1Hz)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  // visibility 기반 — 시간 기반 _IDLE_THRESHOLD_MS 가 사라짐 (사용자 요구)
  assert.ok(!/const _IDLE_THRESHOLD_MS/.test(source), '_IDLE_THRESHOLD_MS 시간 idle 가 다시 추가됨');
  // 창 hidden 시 1Hz timer
  assert.match(source, /const _HIDDEN_TICK_MS = 1000/);
  // visibilitychange listener
  assert.match(source, /document\.addEventListener\('visibilitychange', _onVisibilityChange\)/);
  // 시작 시 창 상태에 따라 분기
  assert.match(source, /if\(document\.hidden\)\{[\s\S]{0,200}_idleMode = true/);
  // bumpActivity 는 no-op 으로 보존 (IPC 핸들러 호출은 그대로)
  assert.match(source, /function bumpActivity\(\)\{/);
});

test('deck VU repaint is throttled separately from waveform redraw', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.strictEqual(source.includes('const _DECK_VU_TICK_MS=1000/30;'), true);
  assert.strictEqual(source.includes("const shouldPaintDeckVu=deckUiVisible&&(now-_lastDeckVuPaint>=_DECK_VU_TICK_MS);"), true);
  assert.strictEqual(source.includes('if(shouldPaintDeckVu){'), true);
});

test('mixer repaint is throttled at 30fps (사용자 선호)', () => {
  // 웨이브폼 외 모든 UI 30fps 고정 — mixer 도 60→30fps 로 cap.
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.strictEqual(source.includes('const _MIXER_TICK_MS=1000/30;'), true);
  assert.strictEqual(source.includes("if(curTab==='mixer'&&_mixerDirty){"), true);
  assert.strictEqual(source.includes('if(now-_lastMixerPaint>=_MIXER_TICK_MS){'), true);
});

test('link phaser follows the selected BPM source phase, not only raw Link status', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.strictEqual(source.includes('function _computeDeckPhase(slot){'), true);
  assert.strictEqual(source.includes('function _computeLinkSourcePhase(now=Date.now()){'), true);
  assert.strictEqual(source.includes('const srcPhase=_computeLinkSourcePhase(now);'), true);
});

test('virtual fine waveform path fully removed', () => {
  // rgbWfFine 2pass 분석은 제거되었고 호출 사이트도 정리됨. 1pass progressive 만 사용.
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.doesNotMatch(source, /function\s+_scheduleRgbFineBuild/, 'stub should be removed');
  assert.doesNotMatch(source, /function\s+_wfEnsureRgbFine/, 'stub should be removed');
  // _wfRenderDataForDeck/Strip 의 fallback 체인에 rgbWfFine 안 들어감.
  assert.match(source, /function _wfRenderDataForDeck\(d\)\{[\s\S]*?d\?\.rgbWf\|\|d\?\.rgbWfDetail[\s\S]*?\}/, 'render data lookup should not include rgbWfFine fallback');
});

test('virtual waveform build throttles partial repaints', () => {
  // YIELD_MS 는 main-thread 분석 시절의 상수. 현재는 rgbwf-worker.js 가 별 스레드에서 돌아 yield 불필요.
  // 핵심 검증: _queuePartialWaveformPaint 가 1pass progressive 페인트를 throttle 하는지.
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(indexSrc, /function _queuePartialWaveformPaint\(slot,\s*d,\s*minInterval=120\)/, 'partial paint throttle helper');
  assert.match(indexSrc, /if\(partial&&_wfLen\(partial\)>2\)_queuePartialWaveformPaint\(slot,d,120\);/, 'load handler should queue partial repaints');
});

test('virtual PDJL status logging is throttled instead of printing every packet', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.strictEqual(source.includes('_shouldLogRate(key, intervalMs=3000, summary=null){'), true);
  assert.strictEqual(source.includes("if(this._shouldLogRate(`virt_status_${playerNum}`, 10000, _summary)){"), true);
});

test('dbserver failure warnings are rate-limited to avoid repeated spam', () => {
  // Phase 5.4: orchestrator 모듈로 이동 — core._shouldLogRate 호출.
  const orchSource = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'dbserver-orchestrator.js'), 'utf8');
  assert.strictEqual(orchSource.includes("if(core._shouldLogRate(`db_meta_fail_${cacheKey}`, 10000, e.message)){"), true);
  assert.strictEqual(orchSource.includes("if(core._shouldLogRate(`db_art_fail_${cacheKey}`, 10000, e.message)){"), true);
  assert.strictEqual(orchSource.includes("if(core._shouldLogRate(`db_follow_fail_${playerNum}_${delay}`, 10000, e.message)){"), true);
});

test('NXS2 beat count position matches beat-derived formula', () => {
  const { nxs2BeatCountToMs } = loadPrivateBuilders();
  assert.strictEqual(nxs2BeatCountToMs(64, 128), 30000);
  assert.strictEqual(nxs2BeatCountToMs(0, 128), 0);
  assert.strictEqual(nxs2BeatCountToMs(12, 0), 0);
});

test('NXS2 backward beat anchor keeps predicted playhead for small snapbacks', () => {
  const { shouldKeepPredictedBeatAnchor } = loadPrivateBuilders();
  assert.strictEqual(shouldKeepPredictedBeatAnchor(10000, 9850, 133, false), true);
  assert.strictEqual(shouldKeepPredictedBeatAnchor(10000, 8700, 133, false), false);
  assert.strictEqual(shouldKeepPredictedBeatAnchor(10000, 9850, 133, true), false);
});

test('NXS2 status ignores non-duration trackBeats and missing position fraction', () => {
  const { parsePDJL } = loadPrivateBuilders();
  const pkt = Buffer.alloc(0x120);
  Buffer.from('Qspt1WmJOL', 'ascii').copy(pkt, 0);
  pkt[0x0a] = 0x0a;
  Buffer.from('CDJ-2000NXS2', 'ascii').copy(pkt, 0x0b);
  pkt[0x21] = 0xd2; // observed in pcap; fallback player byte is 0x24
  pkt[0x24] = 4;
  pkt[0x29] = 3;
  pkt.writeUInt32BE(2846, 0x2c);
  pkt[0x7b] = core.STATE.PLAYING;
  pkt.writeUInt16BE(12600, 0x92);
  pkt.writeUInt32BE(32, 0xa0);
  pkt.writeUInt32BE(256, 0xb4);

  const parsed = parsePDJL(pkt);
  assert.strictEqual(parsed.playerNum, 4);
  assert.strictEqual(parsed.isNXS2, true);
  assert.strictEqual(parsed._trackBeatsRaw, 256);
  assert.strictEqual(parsed.trackBeats, 0);
  assert.strictEqual(parsed.positionFraction, 0);
});

test('NXS2 type 0x0b packet is not treated as CDJ-3000 precise position', () => {
  const { parsePDJL } = loadPrivateBuilders();
  const pkt = Buffer.from(
    '5173707431576d4a4f4c0b43444a2d323030304e58533200000000000000000200ee00185900c507c500c500c500c1a9c500c500c500c5003aff3aff',
    'hex'
  );

  assert.strictEqual(parsePDJL(pkt), null);
});
