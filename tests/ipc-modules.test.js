'use strict';

const assert = require('assert');
const path = require('path');

function test(name, fn){
  try { fn(); console.log(`ok - ${name}`); }
  catch(err){ console.error(`not ok - ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ─── main/ipc-link.js ──────────────────────────────────────────────────

test('ipc-link: exports registerLinkIpc', () => {
  const mod = require(path.join(__dirname, '..', 'main', 'ipc-link'));
  assert.strictEqual(typeof mod.registerLinkIpc, 'function');
});

test('ipc-link: registers link:setEnabled, link:setTempo, link:getStatus, link:alignBeat', () => {
  const { registerLinkIpc } = require(path.join(__dirname, '..', 'main', 'ipc-link'));
  const handles = new Set(), listens = new Set();
  const fakeIpc = {
    handle: (ch) => handles.add(ch),
    on: (ch) => listens.add(ch),
  };
  const fakeLink = {
    setEnabled: () => {}, setTempo: () => {}, getStatus: () => ({}), alignBeat: () => true,
  };
  registerLinkIpc(fakeIpc, fakeLink);
  assert.ok(handles.has('link:setEnabled'), 'missing link:setEnabled handle');
  assert.ok(handles.has('link:getStatus'), 'missing link:getStatus handle');
  assert.ok(handles.has('link:alignBeat'), 'missing link:alignBeat handle');
  assert.ok(listens.has('link:setTempo'), 'missing link:setTempo on');
});

test('ipc-link: link:setEnabled forwards to link.setEnabled and returns getStatus', () => {
  const { registerLinkIpc } = require(path.join(__dirname, '..', 'main', 'ipc-link'));
  let setEnabledArg = null;
  const handlers = {};
  const fakeIpc = {
    handle: (ch, fn) => { handlers[ch] = fn; },
    on: () => {},
  };
  const fakeLink = {
    setEnabled: (en) => { setEnabledArg = en; },
    getStatus: () => ({ enabled: setEnabledArg, peers: 0 }),
  };
  registerLinkIpc(fakeIpc, fakeLink);
  const result = handlers['link:setEnabled'](null, { enabled: true });
  assert.strictEqual(setEnabledArg, true);
  assert.deepStrictEqual(result, { enabled: true, peers: 0 });
});

// ─── main/ipc-app.js ───────────────────────────────────────────────────

test('ipc-app: exports registerAppIpc', () => {
  const mod = require(path.join(__dirname, '..', 'main', 'ipc-app'));
  assert.strictEqual(typeof mod.registerAppIpc, 'function');
});

test('ipc-app: registers bridge:cpuUsage, bridge:cleanupZombies, app:getVersion', () => {
  const { registerAppIpc } = require(path.join(__dirname, '..', 'main', 'ipc-app'));
  const handles = new Set();
  const fakeIpc = { handle: (ch) => handles.add(ch), on: () => {} };
  const fakeApp = { getAppMetrics: () => [] };
  const fakeCleanup = { runCleanup: async () => ({}) };
  registerAppIpc(fakeIpc, { app: fakeApp, appRoot: '/tmp', cleanupSvc: fakeCleanup });
  assert.ok(handles.has('bridge:cpuUsage'));
  assert.ok(handles.has('bridge:cleanupZombies'));
  assert.ok(handles.has('app:getVersion'));
});

test('ipc-app: bridge:cpuUsage returns cpu + memMB shape', () => {
  const { registerAppIpc } = require(path.join(__dirname, '..', 'main', 'ipc-app'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  const fakeApp = { getAppMetrics: () => [{ cpu: { percentCPUUsage: 12.5 } }, { cpu: { percentCPUUsage: 5.0 } }] };
  registerAppIpc(fakeIpc, { app: fakeApp, appRoot: '/tmp', cleanupSvc: { runCleanup: async () => ({}) } });
  const r = handlers['bridge:cpuUsage']();
  assert.strictEqual(r.cpu, 17.5);
  assert.ok(typeof r.memMB === 'number' && r.memMB > 0, 'memMB should be positive integer');
});

// ─── main/ipc-bridge-simple.js ─────────────────────────────────────────

test('ipc-bridge-simple: exports registerBridgeSimpleIpc', () => {
  const mod = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  assert.strictEqual(typeof mod.registerBridgeSimpleIpc, 'function');
});

test('ipc-bridge-simple: forwards updateLayer to bridge', () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = {
    handle: (ch, fn) => { handlers[ch] = fn; },
    on: (ch, fn) => { handlers[ch] = fn; },
  };
  let updatedLayer = null;
  const fakeBridge = {
    updateLayer: (i, data) => { updatedLayer = { i, data }; },
    faders: [0, 0, 0, 0],
  };
  registerBridgeSimpleIpc(fakeIpc, () => fakeBridge);
  const result = handlers['bridge:updateLayer'](null, { i: 1, data: { x: 1 } });
  assert.deepStrictEqual(updatedLayer, { i: 1, data: { x: 1 } });
  assert.deepStrictEqual(result, { ok: true });
});

test('ipc-bridge-simple: setFader clamps val to [0, 255]', () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = {
    handle: (ch, fn) => { handlers[ch] = fn; },
    on: (ch, fn) => { handlers[ch] = fn; },
  };
  const fakeBridge = { faders: [0, 0, 0, 0] };
  registerBridgeSimpleIpc(fakeIpc, () => fakeBridge);
  handlers['bridge:setFader'](null, { i: 0, val: 999 });
  handlers['bridge:setFader'](null, { i: 1, val: -50 });
  handlers['bridge:setFader'](null, { i: 2, val: 128 });
  assert.strictEqual(fakeBridge.faders[0], 255);
  assert.strictEqual(fakeBridge.faders[1], 0);
  assert.strictEqual(fakeBridge.faders[2], 128);
});

test('ipc-bridge-simple: handlers tolerate null bridge (no crash)', () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = {
    handle: (ch, fn) => { handlers[ch] = fn; },
    on: (ch, fn) => { handlers[ch] = fn; },
  };
  registerBridgeSimpleIpc(fakeIpc, () => null);
  // Should not throw with null bridge
  const r1 = handlers['bridge:updateLayer'](null, { i: 0, data: {} });
  const r2 = handlers['bridge:registerVirtualDeck'](null, { slot: 0, model: 'CDJ-3000' });
  const r3 = handlers['bridge:setHWMode'](null, { i: 0, en: true });
  assert.deepStrictEqual(r1, { ok: true });
  assert.deepStrictEqual(r2, { ok: true });
  assert.deepStrictEqual(r3, { ok: true });
});

test('ipc-bridge-simple: rebindTCNet returns err on bridge throw', async () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = {
    handle: (ch, fn) => { handlers[ch] = fn; },
    on: (ch, fn) => { handlers[ch] = fn; },
  };
  const fakeBridge = { rebindTCNet: async () => { throw new Error('test fail'); } };
  registerBridgeSimpleIpc(fakeIpc, () => fakeBridge);
  const r = await handlers['bridge:rebindTCNet'](null, { addr: '0.0.0.0' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.err, 'test fail');
});

// ─── main/ipc-artnet.js ─────────────────────────────────────────────────

test('ipc-artnet: exports registerArtnetIpc + registers all artnet:* channels', () => {
  const { registerArtnetIpc } = require(path.join(__dirname, '..', 'main', 'ipc-artnet'));
  const handles = new Set(), listens = new Set();
  const fakeIpc = { handle: (ch) => handles.add(ch), on: (ch) => listens.add(ch) };
  const fakeArtnet = {
    start: async () => ({}), stop: () => {}, setUnicast: () => {}, setPollReply: () => {},
    setSync: () => {}, setDmxHz: () => {}, setTimecode: () => {}, setFps: () => {},
    forceResync: () => {}, setDmx: () => {}, clearDmx: () => {},
  };
  registerArtnetIpc(fakeIpc, fakeArtnet);
  ['artnet:start','artnet:setUnicast','artnet:setPollReply','artnet:setSync','artnet:setDmxHz',
   'artnet:stop','artnet:setFps','artnet:forceResync','artnet:clearDmx'].forEach(ch =>
     assert.ok(handles.has(ch), `missing handle: ${ch}`));
  ['artnet:setTc','artnet:setDmx'].forEach(ch =>
    assert.ok(listens.has(ch), `missing on: ${ch}`));
});

// ─── renderer/id3-parser.js ─────────────────────────────────────────────

test('id3-parser: exports decode/parse helpers + BPM range validation', () => {
  const mod = require(path.join(__dirname, '..', 'renderer', 'id3-parser'));
  assert.strictEqual(typeof mod._id3DecodeText, 'function');
  assert.strictEqual(typeof mod._id3ParseBpm, 'function');
  assert.strictEqual(typeof mod._id3DecodeTxxx, 'function');
  assert.strictEqual(typeof mod._id3ApplyTextFrame, 'function');
});

test('id3-parser: _id3ParseBpm — only accepts 20-300 range, comma → dot', () => {
  const { _id3ParseBpm } = require(path.join(__dirname, '..', 'renderer', 'id3-parser'));
  assert.strictEqual(_id3ParseBpm('128'), 128);
  assert.strictEqual(_id3ParseBpm('128.50'), 128.5);
  assert.strictEqual(_id3ParseBpm('128,50'), 128.5);  // comma → dot (i18n)
  assert.strictEqual(_id3ParseBpm('5'), 0);            // < 20 rejected
  assert.strictEqual(_id3ParseBpm('500'), 0);          // > 300 rejected
  assert.strictEqual(_id3ParseBpm(''), 0);
  assert.strictEqual(_id3ParseBpm(null), 0);
});

test('id3-parser: _id3ApplyTextFrame — TBPM frame populates tags.bpm', () => {
  const { _id3ApplyTextFrame } = require(path.join(__dirname, '..', 'renderer', 'id3-parser'));
  const tags = {};
  // ISO-8859-1 (encoding 0) frame: "128"
  const fdata = new Uint8Array([0, 0x31, 0x32, 0x38]);
  _id3ApplyTextFrame(tags, 'TBPM', fdata);
  assert.strictEqual(tags.bpm, 128);
  assert.strictEqual(tags.bpmSource, 'TBPM');
});

// ─── renderer/bpm-analysis.js ───────────────────────────────────────────

test('bpm-analysis: exports _normalizeAnalyzedBpm + detectAudioStart + analyzeBPM', () => {
  const mod = require(path.join(__dirname, '..', 'renderer', 'bpm-analysis'));
  assert.strictEqual(typeof mod._normalizeAnalyzedBpm, 'function');
  assert.strictEqual(typeof mod.detectAudioStart, 'function');
  assert.strictEqual(typeof mod.analyzeBPM, 'function');
});

test('bpm-analysis: _normalizeAnalyzedBpm — snaps to integer when <=0.35 off', () => {
  const { _normalizeAnalyzedBpm } = require(path.join(__dirname, '..', 'renderer', 'bpm-analysis'));
  // Within 0.35 of integer → snap to integer.
  assert.strictEqual(_normalizeAnalyzedBpm(127.8), 128);
  assert.strictEqual(_normalizeAnalyzedBpm(128.2), 128);
  assert.strictEqual(_normalizeAnalyzedBpm(128.34), 128);
  // Beyond 0.35 → keep one decimal.
  assert.strictEqual(_normalizeAnalyzedBpm(128.5), 128.5);
  assert.strictEqual(_normalizeAnalyzedBpm(127.4), 127.4);
  // Edge cases.
  assert.strictEqual(_normalizeAnalyzedBpm(0), 0);
  assert.strictEqual(_normalizeAnalyzedBpm(-50), 0);
  assert.strictEqual(_normalizeAnalyzedBpm(null), 0);
});

test('bpm-analysis: detectAudioStart — returns sample-position ms above -69dB threshold', () => {
  const { detectAudioStart } = require(path.join(__dirname, '..', 'renderer', 'bpm-analysis'));
  // Signal: zeros for 100 samples, then loud sine wave.
  const sr = 44100;
  const ch = new Float32Array(sr); // 1 second
  // First 0.5s silent, then 0.5s loud (amplitude 0.5).
  const start = Math.floor(sr * 0.5);
  for (let i = start; i < ch.length; i++) ch[i] = 0.5 * Math.sin(2*Math.PI*440*i/sr);
  const ms = detectAudioStart(ch, sr);
  assert.ok(ms >= 480 && ms <= 520, `should detect onset around 500ms, got ${ms.toFixed(1)}`);
});

// ─── main/ipc-license.js ────────────────────────────────────────────────

// ─── main/audio-decode.js ───────────────────────────────────────────────

test('audio-decode: exports findFFmpeg, tempFiles, cleanupTempFiles, registerAudioDecodeIpc', () => {
  const mod = require(path.join(__dirname, '..', 'main', 'audio-decode'));
  assert.strictEqual(typeof mod.findFFmpeg, 'function');
  assert.strictEqual(typeof mod.cleanupTempFiles, 'function');
  assert.strictEqual(typeof mod.registerAudioDecodeIpc, 'function');
  assert.ok(mod.tempFiles instanceof Set || Array.isArray(mod.tempFiles), 'tempFiles should be Set/Array');
});

test('audio-decode: registerAudioDecodeIpc registers bridge:decodeAudio handler', () => {
  const { registerAudioDecodeIpc } = require(path.join(__dirname, '..', 'main', 'audio-decode'));
  const handles = new Set();
  const fakeIpc = { handle: (ch) => handles.add(ch), on: (ch) => handles.add(ch) };
  registerAudioDecodeIpc(fakeIpc, { getWin: () => null });
  assert.ok(handles.size > 0, 'should register at least one handler');
});

// ─── main/cleanup.js ────────────────────────────────────────────────────

test('cleanup: exports runCleanup function', () => {
  const mod = require(path.join(__dirname, '..', 'main', 'cleanup'));
  assert.strictEqual(typeof mod.runCleanup, 'function');
});

// ─── main/ipc-bridge-iface.js ───────────────────────────────────────────

test('ipc-bridge-iface: exports registerBridgeIfaceIpc + registers iface handlers', () => {
  const mod = require(path.join(__dirname, '..', 'main', 'ipc-bridge-iface'));
  assert.strictEqual(typeof mod.registerBridgeIfaceIpc, 'function');
  const handles = new Set();
  const fakeIpc = { handle: (ch) => handles.add(ch), on: () => {} };
  mod.registerBridgeIfaceIpc(fakeIpc, {
    getBridge: () => null,
    sendInterfaces: () => [],
    sendArtTimeCode: () => {},
  });
  assert.ok(handles.has('bridge:getInterfaces'));
  assert.ok(handles.has('bridge:refreshInterfaces'));
  assert.ok(handles.has('bridge:artTimeCode'));
});

test('ipc-bridge-iface: getInterfaces calls sendInterfaces with manual reason', () => {
  const { registerBridgeIfaceIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-iface'));
  const handlers = {};
  let lastReason = null;
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  registerBridgeIfaceIpc(fakeIpc, {
    getBridge: () => null,
    sendInterfaces: (reason) => { lastReason = reason; return [{ name: 'en0' }]; },
    sendArtTimeCode: () => {},
  });
  const result = handlers['bridge:getInterfaces']();
  assert.strictEqual(lastReason, 'manual');
  assert.deepStrictEqual(result, [{ name: 'en0' }]);
});

test('ipc-bridge-iface: refreshInterfaces tolerates null bridge', async () => {
  const { registerBridgeIfaceIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-iface'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  registerBridgeIfaceIpc(fakeIpc, {
    getBridge: () => null,
    sendInterfaces: () => [{ name: 'en0' }],
    sendArtTimeCode: () => {},
  });
  const result = await handlers['bridge:refreshInterfaces']();
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.interfaces, [{ name: 'en0' }]);
});

// ─── main/ipc-bridge-start.js ───────────────────────────────────────────

test('ipc-bridge-start: exports registerBridgeStartIpc + registers start/stop', () => {
  const mod = require(path.join(__dirname, '..', 'main', 'ipc-bridge-start'));
  assert.strictEqual(typeof mod.registerBridgeStartIpc, 'function');
  const handles = new Set();
  const fakeIpc = { handle: (ch) => handles.add(ch), on: () => {} };
  // Minimal stub — should register without errors.
  class FakeBridgeCore { constructor(){} async start(){} stop(){} }
  mod.registerBridgeStartIpc(fakeIpc, {
    setBridge: () => {}, getBridge: () => null,
    setIfaceSig: () => {},
    getIv: () => null, clearIv: () => {},
    getWin: () => null,
    BridgeCore: FakeBridgeCore,
    getAllInterfaces: () => [], interfaceSignature: () => '',
    push: () => {},
  });
  assert.ok(handles.has('bridge:start'));
  assert.ok(handles.has('bridge:stop'));
});

test('ipc-bridge-start: stop calls bridge.stop and clearIv', async () => {
  const { registerBridgeStartIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-start'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  let stopped = false, ivCleared = false;
  const fakeBridge = { stop: () => { stopped = true; } };
  registerBridgeStartIpc(fakeIpc, {
    setBridge: () => {}, getBridge: () => fakeBridge,
    setIfaceSig: () => {},
    getIv: () => null, clearIv: () => { ivCleared = true; },
    getWin: () => null,
    BridgeCore: class { async start(){} stop(){} },
    getAllInterfaces: () => [], interfaceSignature: () => '',
    push: () => {},
  });
  const r = await handlers['bridge:stop']();
  assert.strictEqual(stopped, true);
  assert.strictEqual(ivCleared, true);
  assert.deepStrictEqual(r, { ok: true });
});

test('ipc-license: exports registerLicenseIpc + tolerates null service', () => {
  const mod = require(path.join(__dirname, '..', 'main', 'ipc-license'));
  assert.strictEqual(typeof mod.registerLicenseIpc, 'function');
  // Should not throw with minimal stubs.
  const handles = new Set();
  const fakeIpc = { handle: (ch) => handles.add(ch), on: () => {} };
  // license-service interface (disabled-by-default stub).
  const fakeSvc = {
    isEnabled: () => false,
    getStatus: () => ({ enabled: false }),
    activate: async () => ({ ok: false }),
    deactivate: async () => ({ ok: true }),
  };
  mod.registerLicenseIpc(fakeIpc, fakeSvc);
  assert.ok(handles.size > 0, 'should register at least one license handler');
});
