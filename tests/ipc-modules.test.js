'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

function test(name, fn){
  try { fn(); console.log(`ok - ${name}`); }
  catch(err){ console.error(`not ok - ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ─── bridge-core.js — dbserver TCP session reuse ───────────────────────

test('bridge-core: dbserver methods use session acquisition instead of direct connect', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bridge-core.js'), 'utf8');
  assert.match(src, /async _dbAcquire\(ip, spoofPlayer\)\{/);
  for(const name of [
    '_dbserverMetadata',
    '_dbserverWaveform',
    '_dbserverWaveformDetail',
    '_dbserverWaveformNxs2',
    '_dbserverCuePointsExt',
    '_dbserverCuePointsNxs2',
    '_dbserverCuePointsStd',
    '_dbserverBeatGrid',
    '_dbserverSongStructure',
    '_dbserverArtwork',
  ]){
    const start = src.indexOf(`async ${name}(`);
    assert.ok(start >= 0, `${name} missing`);
    const next = src.indexOf('\n  async ', start + 1);
    const body = src.slice(start, next > start ? next : src.indexOf('\n}', start));
    assert.ok(body.includes('this._dbAcquire(ip, spoofPlayer)'), `${name} should acquire pooled session`);
    assert.strictEqual(body.includes('this._dbConnect(ip, spoofPlayer)'), false, `${name} should not open direct TCP session`);
    assert.ok(body.includes('session.release()'), `${name} should release pooled session`);
  }
});

test('bridge-core: dbserver session pool has idle TTL, invalidation, and stop cleanup', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bridge-core.js'), 'utf8');
  assert.match(src, /this\._dbSessions\s*=\s*new Map\(\)/);
  assert.match(src, /const DB_SESSION_IDLE_MS = 30000/);
  assert.match(src, /sock\.once\('error', onDead\)/);
  assert.match(src, /sock\.once\('close', onDead\)/);
  assert.match(src, /clearTimeout\(entry\.idleTimer\)/);
  assert.match(src, /this\._dbSessions\.clear\(\)/);
});

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

// ─── Security: IPC input validation ────────────────────────────────────

test('security: ipc-bridge-simple rejects out-of-range layer index', () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } };
  let touched = false;
  const fakeBridge = { updateLayer: () => { touched = true; }, faders: [0,0,0,0] };
  registerBridgeSimpleIpc(fakeIpc, () => fakeBridge);
  // 음수, 8 이상, NaN, string — 모두 reject.
  for (const bad of [-1, 8, 100, NaN, 'evil', null, undefined, 1.5]) {
    const r = handlers['bridge:updateLayer'](null, { i: bad, data: {} });
    assert.strictEqual(r.ok, false, `i=${bad} should be rejected`);
  }
  assert.strictEqual(touched, false, 'bridge.updateLayer must NOT be called for invalid input');
  // 합법 index — OK.
  const r2 = handlers['bridge:updateLayer'](null, { i: 0, data: {} });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(touched, true);
});

test('security: ipc-bridge-simple setVirtualArt rejects oversized base64 (DoS prevention)', () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } };
  let setArtCalled = false;
  registerBridgeSimpleIpc(fakeIpc, () => ({ setVirtualArt: () => { setArtCalled = true; } }));
  // 8MB base64 string (>5MB cap × 1.4 = ~7MB) — reject.
  const huge = 'A'.repeat(8 * 1024 * 1024);
  const r = handlers['bridge:setVirtualArt'](null, { slot: 0, jpegBase64: huge });
  assert.strictEqual(r.ok, false, 'oversized art should be rejected');
  assert.strictEqual(setArtCalled, false, 'setVirtualArt must NOT be called');
});

test('security: ipc-bridge-simple registerVirtualDeck rejects oversized model name', () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } };
  registerBridgeSimpleIpc(fakeIpc, () => ({ registerVirtualDeck: () => {} }));
  const longName = 'X'.repeat(100);
  const r = handlers['bridge:registerVirtualDeck'](null, { slot: 0, model: longName });
  assert.strictEqual(r.ok, false, 'long model name should be rejected');
});

test('security: ipc-app validates app metadata (no input → no crash)', () => {
  // ipc-app 은 input parameter 없는 handler 만 — sanity check 만.
  const { registerAppIpc } = require(path.join(__dirname, '..', 'main', 'ipc-app'));
  const handles = new Set();
  const fakeIpc = { handle: (ch) => handles.add(ch), on: () => {} };
  registerAppIpc(fakeIpc, {
    app: { getAppMetrics: () => [] },
    appRoot: '/tmp',
    cleanupSvc: { runCleanup: async () => ({}) },
  });
  assert.ok(handles.size === 3, 'should register 3 handlers');
});

// ─── Security: CSP meta + escape coverage ──────────────────────────────

test('security: CSP meta tag present (Electron-friendly, blocks remote origin)', () => {
  const fs = require('fs');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(renderer, /<meta\s+http-equiv="Content-Security-Policy"/, 'CSP meta tag missing');
  assert.match(renderer, /default-src\s+'self'/, 'CSP default-src should be self');
  assert.match(renderer, /img-src[^"]*data:[^"]*blob:/, 'CSP img-src should allow data + blob');
});

test('security: device list escapes PDJL packet data (XSS prevention)', () => {
  const fs = require('fs');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  // renderPDJL 내 d.name/ip/type 은 _escHtml 통과해야 (외부 패킷 source).
  assert.match(renderer, /_escHtml\(d\.type\)/, 'PDJL device type should be escaped');
  assert.match(renderer, /_escHtml\(d\.name/, 'PDJL device name should be escaped');
  assert.match(renderer, /_escHtml\(d\.ip\)/, 'PDJL device ip should be escaped');
  // renderTcnet 도 동일.
  assert.match(renderer, /_escHtml\(n\.name\)/, 'TCNet node name should be escaped');
  assert.match(renderer, /_escHtml\(n\.ip\)/, 'TCNet node ip should be escaped');
});

// ─── pdjl/network.js — interface helpers ───────────────────────────────

test('pdjl/network: exports interface helpers', () => {
  const mod = require(path.join(__dirname, '..', 'pdjl', 'network'));
  assert.strictEqual(typeof mod.getAllInterfaces, 'function');
  assert.strictEqual(typeof mod.interfaceSignature, 'function');
  assert.strictEqual(typeof mod.sanitizeInterfaceSelection, 'function');
  assert.strictEqual(typeof mod.detectBroadcastFor, 'function');
  assert.strictEqual(typeof mod.pdjlBroadcastTargets, 'function');
});

test('pdjl/network: getAllInterfaces returns lo0 + system interfaces', () => {
  const { getAllInterfaces } = require(path.join(__dirname, '..', 'pdjl', 'network'));
  const ifs = getAllInterfaces();
  assert.ok(ifs.length >= 1, 'at least lo0 should be present');
  const lo = ifs.find(i => i.address === '127.0.0.1');
  assert.ok(lo, 'lo0 entry should be present');
  assert.strictEqual(lo.internal, true);
});

test('pdjl/network: sanitizeInterfaceSelection filters invalid', () => {
  const { sanitizeInterfaceSelection } = require(path.join(__dirname, '..', 'pdjl', 'network'));
  const fakeIfs = [{ address: '192.168.1.10' }, { address: '127.0.0.1' }];
  assert.strictEqual(sanitizeInterfaceSelection('auto', fakeIfs), null);
  assert.strictEqual(sanitizeInterfaceSelection('0.0.0.0', fakeIfs), null);
  assert.strictEqual(sanitizeInterfaceSelection('', fakeIfs), null);
  assert.strictEqual(sanitizeInterfaceSelection('192.168.1.10', fakeIfs), '192.168.1.10');
  assert.strictEqual(sanitizeInterfaceSelection('192.168.99.99', fakeIfs), null); // not in list
  assert.strictEqual(sanitizeInterfaceSelection('127.0.0.1', fakeIfs), '127.0.0.1');
});

// ─── renderer/util-html.js — XSS 방지 escape ────────────────────────────

test('util-html: _escHtml escapes <>"\'& correctly', () => {
  const { _escHtml } = require(path.join(__dirname, '..', 'renderer', 'util-html'));
  assert.strictEqual(_escHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(_escHtml('hello "world"'), 'hello &quot;world&quot;');
  assert.strictEqual(_escHtml("a&b<c>d'e"), 'a&amp;b&lt;c&gt;d&#39;e');
  assert.strictEqual(_escHtml(null), '');
  assert.strictEqual(_escHtml(undefined), '');
  assert.strictEqual(_escHtml(123), '123');
  // Realistic PDJL device name attack — img onerror injection.
  // 핵심: raw `<` 가 escape 되어 HTML parser 가 tag 로 인식 못 함.
  const malicious = '<img src=x onerror="alert(\'xss\')">';
  const safe = _escHtml(malicious);
  assert.ok(!safe.includes('<img'), 'should not contain raw <img tag (escaped to &lt;img)');
  assert.ok(!safe.includes('"alert'), 'should not contain raw "alert (quote escaped)');
  assert.ok(safe.startsWith('&lt;'), 'should start with escaped <');
});

// ─── renderer/pcm-decode.js ─────────────────────────────────────────────

test('pcm-decode: exports _getPcmWorker + _decodePcmFor', () => {
  const mod = require(path.join(__dirname, '..', 'renderer', 'pcm-decode'));
  assert.strictEqual(typeof mod._getPcmWorker, 'function');
  assert.strictEqual(typeof mod._decodePcmFor, 'function');
});

test('pcm-decode: _decodePcmFor returns early on null/hw deck', async () => {
  const { _decodePcmFor } = require(path.join(__dirname, '..', 'renderer', 'pcm-decode'));
  // Null deck — should not throw.
  await _decodePcmFor(null, 0);
  // HW deck — should not start decode.
  const hwDeck = { type: 'hw', _audioBlob: null };
  await _decodePcmFor(hwDeck, 0);
  assert.strictEqual(hwDeck._pcmPromise, undefined, 'HW deck should not get _pcmPromise set');
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

test('ipc-bridge-start: packs color/height waveform pts before IPC send', () => {
  const { registerBridgeStartIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-start'));
  const handlers = {};
  const sent = [];
  let bridgeInstance = null;
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  const fakeWin = {
    isDestroyed: () => false,
    webContents: { send: (ch, d) => sent.push({ ch, d }) },
  };
  class FakeBridgeCore {
    constructor(){ bridgeInstance = this; this.running = false; }
    start(){}
    stop(){}
  }
  registerBridgeStartIpc(fakeIpc, {
    setBridge: () => {}, getBridge: () => null,
    setIfaceSig: () => {},
    getIv: () => null, clearIv: () => {},
    getWin: () => fakeWin,
    BridgeCore: FakeBridgeCore,
    getAllInterfaces: () => [], interfaceSignature: () => '',
    push: () => {},
  });
  handlers['bridge:start'](null, {});
  bridgeInstance.onWaveformDetail(2, { pts: [{ color: 1, height: 31 }, { color: 15, height: 255 }], wfType: 'detail' });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].ch, 'bridge:wfdetail');
  assert.ok(sent[0].d.pts instanceof Uint8Array, 'pts should be packed Uint8Array');
  assert.deepStrictEqual([...sent[0].d.pts], [1, 31, 15, 255]);
  assert.strictEqual(sent[0].d.playerNum, 2);
  assert.strictEqual(sent[0].d.wfType, 'detail');
});

test('ipc-bridge-start: leaves incompatible waveform point shapes unpacked', () => {
  const { registerBridgeStartIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-start'));
  const handlers = {};
  const sent = [];
  let bridgeInstance = null;
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  const fakeWin = {
    isDestroyed: () => false,
    webContents: { send: (ch, d) => sent.push({ ch, d }) },
  };
  class FakeBridgeCore {
    constructor(){ bridgeInstance = this; this.running = false; }
    start(){}
    stop(){}
  }
  registerBridgeStartIpc(fakeIpc, {
    setBridge: () => {}, getBridge: () => null,
    setIfaceSig: () => {},
    getIv: () => null, clearIv: () => {},
    getWin: () => fakeWin,
    BridgeCore: FakeBridgeCore,
    getAllInterfaces: () => [], interfaceSignature: () => '',
    push: () => {},
  });
  handlers['bridge:start'](null, {});
  const pts = [{ low: 0.2, mid: 0.4, hi: 0.8 }];
  bridgeInstance.onWaveformDetail(1, { pts, wfType: 'nxs2_3band' });
  assert.strictEqual(sent[0].ch, 'bridge:wfdetail');
  assert.strictEqual(sent[0].d.pts, pts);
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

// ─── SECURITY regression: ipc-bridge-simple input validation ─────────────

test('ipc-bridge-simple: setVirtualArt rejects oversized base64', async () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  const fakeBridge = { setVirtualArt: () => { throw new Error('should not be called'); } };
  registerBridgeSimpleIpc(fakeIpc, () => fakeBridge);
  // 5MB cap → base64 길이 ceil(5MB/3)*4 ≈ 6_990_508. 그 이상 길이 = 거부.
  const tooBig = 'A'.repeat(7_000_000);
  const res = await handlers['bridge:setVirtualArt'](null, { slot: 0, jpegBase64: tooBig });
  assert.strictEqual(res.ok, false, 'oversized base64 should be rejected');
});

test('ipc-bridge-simple: rebindTCNet rejects unknown bind addr', async () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  let called = false;
  const fakeBridge = {
    rebindTCNet: async () => { called = true; },
    getAllInterfaces: () => [{ address: '192.168.1.10' }],
  };
  registerBridgeSimpleIpc(fakeIpc, () => fakeBridge);
  const res = await handlers['bridge:rebindTCNet'](null, { addr: '8.8.8.8' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(called, false, 'rebind should not run for unknown addr');
});

test('ipc-bridge-simple: rebindTCNet accepts auto and enumerated addr', async () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  const calls = [];
  const fakeBridge = {
    rebindTCNet: async (a) => { calls.push(a); },
    getAllInterfaces: () => [{ address: '192.168.1.10' }],
  };
  registerBridgeSimpleIpc(fakeIpc, () => fakeBridge);
  const r1 = await handlers['bridge:rebindTCNet'](null, { addr: 'auto' });
  const r2 = await handlers['bridge:rebindTCNet'](null, { addr: '192.168.1.10' });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r2.ok, true);
  assert.deepStrictEqual(calls, ['auto', '192.168.1.10']);
});

test('ipc-bridge-simple: setTCNetMode whitelist (auto/client/server only)', async () => {
  const { registerBridgeSimpleIpc } = require(path.join(__dirname, '..', 'main', 'ipc-bridge-simple'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  let lastMode = null;
  const fakeBridge = { setTCNetMode: (m) => { lastMode = m; } };
  registerBridgeSimpleIpc(fakeIpc, () => fakeBridge);
  const bad = await handlers['bridge:setTCNetMode'](null, { mode: 'evil' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(lastMode, null);
  const good = await handlers['bridge:setTCNetMode'](null, { mode: 'server' });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(lastMode, 'server');
});

// ─── SECURITY regression: ipc-artnet input validation ────────────────────

test('ipc-artnet: start rejects malformed destIp', async () => {
  const { registerArtnetIpc } = require(path.join(__dirname, '..', 'main', 'ipc-artnet'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  let started = false;
  const fakeArtnet = { setFps: () => {}, start: async () => { started = true; return { ok: true }; } };
  registerArtnetIpc(fakeIpc, fakeArtnet);
  const res = await handlers['artnet:start'](null, { destIp: 'not.an.ip', destPort: 6454 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(started, false);
});

test('ipc-artnet: setDmx truncates oversized payload to 512 bytes', () => {
  const { registerArtnetIpc } = require(path.join(__dirname, '..', 'main', 'ipc-artnet'));
  const listeners = {};
  const fakeIpc = { handle: () => {}, on: (ch, fn) => { listeners[ch] = fn; } };
  let lastBuf = null;
  const fakeArtnet = { setDmx: (buf) => { lastBuf = buf; } };
  registerArtnetIpc(fakeIpc, fakeArtnet);
  const huge = new Uint8Array(2048).fill(7);
  listeners['artnet:setDmx'](null, { data: huge, universe: 0 });
  assert.ok(lastBuf, 'setDmx should be called');
  assert.strictEqual(lastBuf.length, 512, 'payload should be capped to 512 bytes');
});

// ─── SECURITY regression: audio-decode path traversal ────────────────────

test('audio-decode: rejects unsupported extension', async () => {
  const { registerAudioDecodeIpc } = require(path.join(__dirname, '..', 'main', 'audio-decode'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  registerAudioDecodeIpc(fakeIpc, { getWin: () => null });
  const res = await handlers['bridge:decodeAudio'](null, { filePath: '/etc/passwd', slot: 0 });
  assert.strictEqual(res.ok, false);
  assert.ok(/unsupported/i.test(res.err));
});

test('audio-decode: rejects symlink', async () => {
  const fs = require('fs');
  const os = require('os');
  const { registerAudioDecodeIpc } = require(path.join(__dirname, '..', 'main', 'audio-decode'));
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} };
  registerAudioDecodeIpc(fakeIpc, { getWin: () => null });
  // /etc/passwd 를 가리키는 .mp3 symlink 만들어 거부 확인.
  const link = path.join(os.tmpdir(), `bridge_test_${Date.now()}.mp3`);
  try { fs.unlinkSync(link); } catch (_) {}
  fs.symlinkSync('/etc/passwd', link);
  try {
    const res = await handlers['bridge:decodeAudio'](null, { filePath: link, slot: 0 });
    assert.strictEqual(res.ok, false);
    assert.ok(/symlink|denied/i.test(res.err));
  } finally {
    try { fs.unlinkSync(link); } catch (_) {}
  }
});

// ─── SECURITY: worker postMessage 입력 검증 ──────────────────────────

test('pcm-worker: input validation guards present', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pcm-worker.js'), 'utf8');
  assert.match(src, /_MAX_SAMPLES/);
  assert.match(src, /_MAX_CHANNELS/);
  assert.match(src, /Array\.isArray\(channels\)/);
  assert.match(src, /channels\[0\] instanceof Float32Array/);
  assert.match(src, /Number\.isFinite\(sampleRate\)/);
});

test('rgbwf-worker: input validation guards present', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'rgbwf-worker.js'), 'utf8');
  assert.match(src, /_RGBWF_MAX_SAMPLES/);
  assert.match(src, /_RGBWF_MAX_CHANNELS/);
  assert.match(src, /Array\.isArray\(channels\)/);
  assert.match(src, /Number\.isFinite\(sampleRate\)/);
  assert.match(src, /Number\.isFinite\(durationMs\)/);
});

// ─── SECURITY: main.js web-contents-created 가드 ───────────────────────

test('main.js: web-contents-created deny-by-default guards present', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /web-contents-created/);
  assert.match(src, /setWindowOpenHandler/);
  assert.match(src, /will-navigate/);
  assert.match(src, /will-attach-webview/);
  assert.match(src, /webSecurity:\s*true/);
});

test('main.js: BrowserWindow sandbox:true 적용 (main + splash)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // main + splash 두 BrowserWindow 모두 sandbox:true 명시.
  const matches = src.match(/sandbox:\s*true/g) || [];
  assert.ok(matches.length >= 2, `expected ≥2 sandbox:true (main+splash), got ${matches.length}`);
});

test('preload.js: on* 함수가 listener remover 클로저 반환 (누수 방지)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(src, /removeListener/);
  // _on 헬퍼가 정의되어 있는지
  assert.match(src, /function _on\(channel, cb\)\{/);
  // on* 채널 등록이 _on / _onArgless 로 통일됐는지 (직접 ipcRenderer.on(...) 호출 부재)
  // 단, _on / _onArgless 안의 ipcRenderer.on 두 개는 허용.
  const directOnCalls = (src.match(/ipcRenderer\.on\(/g) || []).length;
  assert.ok(directOnCalls === 2, `expected exactly 2 ipcRenderer.on (inside _on helpers), got ${directOnCalls}`);
});

// ─── BridgeCore split — bridge/beat-anchor.js ──────────────────────────

test('beat-anchor: nxs2BeatCountToMs converts beat count to ms', () => {
  const { nxs2BeatCountToMs } = require(path.join(__dirname, '..', 'bridge', 'beat-anchor'));
  assert.strictEqual(nxs2BeatCountToMs(120, 120), 60000);  // 120 beats @ 120 BPM = 60s
  assert.strictEqual(nxs2BeatCountToMs(0, 120), 0);
  assert.strictEqual(nxs2BeatCountToMs(120, 0), 0);
  assert.strictEqual(nxs2BeatCountToMs(null, 120), 0);
  assert.strictEqual(nxs2BeatCountToMs('abc', 120), 0);
});

test('beat-anchor: shouldKeepPredictedBeatAnchor half-beat jitter window', () => {
  const { shouldKeepPredictedBeatAnchor } = require(path.join(__dirname, '..', 'bridge', 'beat-anchor'));
  // 120 BPM → halfBeat = 30000/120 = 250ms
  assert.strictEqual(shouldKeepPredictedBeatAnchor(1000, 1100, 120), true);   // 100ms diff < 250ms
  assert.strictEqual(shouldKeepPredictedBeatAnchor(1000, 1300, 120), false);  // 300ms diff > 250ms
  assert.strictEqual(shouldKeepPredictedBeatAnchor(1000, 1100, 120, true), false); // reverse 거부
  assert.strictEqual(shouldKeepPredictedBeatAnchor(0, 1000, 120), false);     // predicted=0 거부
});

// ─── pcm-decode worker error drain ───────────────────────────────────────

test('pcm-decode: worker fatal error drains pending jobs', () => {
  // pcm-decode 는 browser global (Worker, AudioContext) 의존이지만,
  // _getPcmWorker 의 error 핸들러 동작만 isolate 해서 검증.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pcm-decode.js'), 'utf8');
  // drain 로직이 source 에 있는지 (회귀 가드 — 향후 누가 이 핸들러를 줄여도 잡힘).
  assert.ok(/_pcmJobs\.values\(\)/.test(src), 'fatal handler should iterate _pcmJobs');
  assert.ok(/_pcmJobs\.clear\(\)/.test(src), 'fatal handler should clear _pcmJobs');
  assert.ok(/_pcmWorker\s*=\s*null/.test(src), 'fatal handler should reset _pcmWorker');
  assert.ok(/_pcmPromise\s*=\s*null/.test(src), 'fatal handler should reset deck _pcmPromise');
});
