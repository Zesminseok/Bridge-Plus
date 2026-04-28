# Bridge Clone 프로토타입 제작 가이드

PC 또는 Mac에서 프로토타입을 빌드하고 실행하는 전체 과정입니다.

---

## 1단계: Node.js 설치

### Mac
```bash
# Homebrew가 없다면 먼저 설치
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js 20 LTS 설치
brew install node@20
```

### Windows
1. https://nodejs.org 접속
2. **LTS** 버전 다운로드 (20.x 이상)
3. 설치 (기본 옵션 유지)

### 확인
```bash
node --version    # v20.x.x 이상
npm --version     # 10.x.x 이상
```

---

## 2단계: 프로젝트 생성

```bash
# 원하는 위치에 폴더 생성
mkdir bridge-clone
cd bridge-clone

# npm 프로젝트 초기화
npm init -y
```

---

## 3단계: 파일 배치

Claude에서 받은 파일들을 bridge-clone 폴더에 넣습니다:

```
bridge-clone/
├── package.json          ← 아래 내용으로 교체
├── bridge-clone.js       ← TCNet 송신기 (이미 받은 파일)
├── verify-packets.js     ← 패킷 검증 (이미 받은 파일)
├── main.js               ← Electron 메인 프로세스 (아래에서 생성)
├── preload.js            ← Electron preload (아래에서 생성)
└── renderer/
    └── index.html         ← GUI 화면 (아래에서 생성)
```

---

## 4단계: package.json 업데이트

기존 package.json을 이 내용으로 교체합니다:

```json
{
  "name": "bridge-clone",
  "version": "0.1.0",
  "description": "DJ Link Bridge Clone - CDJ to Resolume via TCNet",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "headless": "node bridge-clone.js --broadcast=auto",
    "verify": "node verify-packets.js"
  },
  "license": "MIT",
  "devDependencies": {
    "electron": "^33.0.0"
  }
}
```

---

## 5단계: 의존성 설치

```bash
cd bridge-clone
npm install
```

Electron 다운로드에 시간이 좀 걸립니다 (200MB 정도).

---

## 6단계: Electron 메인 프로세스 (main.js)

`main.js` 파일을 생성합니다:

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { BridgeClone } = require('./bridge-clone');

let mainWindow;
let bridge;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0c10',
    titleBarStyle: 'hiddenInset',  // Mac 스타일
    frame: process.platform === 'darwin' ? true : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('renderer/index.html');
  
  // 개발 중에는 DevTools 열기
  // mainWindow.webContents.openDevTools();
}

// Bridge 시작/정지
ipcMain.handle('bridge:start', async (event, options) => {
  try {
    bridge = new BridgeClone(options);
    await bridge.start();
    
    // 상태 업데이트를 렌더러에 전달 (30fps)
    const statusInterval = setInterval(() => {
      if (!bridge?.running) { clearInterval(statusInterval); return; }
      mainWindow?.webContents.send('bridge:status', {
        running: bridge.running,
        layers: bridge.layers,
        uptime: Math.floor((Date.now() - bridge.startTime) / 1000),
      });
    }, 100);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('bridge:stop', async () => {
  bridge?.stop();
  return { success: true };
});

ipcMain.handle('bridge:getNetworks', async () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4') {
        result.push({ name, address: addr.address, mac: addr.mac, internal: addr.internal });
      }
    }
  }
  return result;
});

ipcMain.handle('bridge:updateLayer', async (event, { index, data }) => {
  bridge?.updateLayer(index, data);
  return { success: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  bridge?.stop();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

---

## 7단계: Preload 스크립트 (preload.js)

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  start: (options) => ipcRenderer.invoke('bridge:start', options),
  stop: () => ipcRenderer.invoke('bridge:stop'),
  getNetworks: () => ipcRenderer.invoke('bridge:getNetworks'),
  updateLayer: (index, data) => ipcRenderer.invoke('bridge:updateLayer', { index, data }),
  onStatus: (callback) => {
    ipcRenderer.on('bridge:status', (event, data) => callback(data));
  },
});
```

---

## 8단계: GUI 화면 (renderer/index.html)

```bash
mkdir renderer
```

`renderer/index.html` 파일을 생성합니다:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bridge Clone</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
:root {
  --bg: #0a0c10; --bg2: rgba(255,255,255,0.02); --bg3: rgba(255,255,255,0.04);
  --border: rgba(255,255,255,0.06); --tx: #e2e8f0; --tx2: #94a3b8; --tx3: #475569;
  --green: #34d399; --blue: #60a5fa; --yellow: #fbbf24; --red: #f87171;
  --mono: 'DM Mono', monospace; --sans: 'DM Sans', -apple-system, sans-serif;
}
body { background: var(--bg); color: var(--tx); font-family: var(--sans); -webkit-app-region: drag; }
button, select, input { -webkit-app-region: no-drag; }
.header { padding: 14px 24px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); background: var(--bg2); }
.logo { display:flex; align-items:center; gap:10px; }
.logo-icon { width:28px; height:28px; border-radius:6px; background:linear-gradient(135deg,#1e293b,#0f172a); border:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center; font:700 12px var(--mono); color:var(--green); }
.logo-text { font:700 13px var(--sans); }
.logo-ver { font:400 10px var(--mono); color:var(--tx3); }

.tabs { display:flex; padding:0 24px; border-bottom:1px solid var(--border); }
.tab { padding:11px 18px; font:600 11px var(--sans); letter-spacing:0.08em; cursor:pointer; border:none; background:transparent; color:var(--tx3); position:relative; transition:color .2s; }
.tab.active { color:var(--tx); }
.tab.active::after { content:''; position:absolute; bottom:0; left:18px; right:18px; height:2px; background:var(--green); border-radius:2px 2px 0 0; }

.content { padding:20px 24px 80px; }

.status-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:20px; }
.status-card { background:var(--bg2); border:1px solid var(--border); border-radius:8px; padding:10px 14px; }
.status-label { font:500 10px var(--sans); color:var(--tx3); letter-spacing:0.06em; margin-bottom:4px; }
.badge { padding:2px 8px; border-radius:4px; font:500 11px var(--mono); display:inline-block; }
.badge-green { background:rgba(52,211,153,0.1); color:var(--green); }
.badge-red { background:rgba(248,113,113,0.1); color:var(--red); }
.badge-blue { background:rgba(96,165,250,0.1); color:var(--blue); }
.badge-dim { background:rgba(255,255,255,0.06); color:var(--tx2); }

.deck-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.deck { background:var(--bg2); border:1px solid var(--border); border-radius:10px; padding:14px 16px; position:relative; overflow:hidden; transition:border-color .3s; }
.deck.playing { border-color: rgba(52,211,153,0.3); }
.deck-shimmer { position:absolute; top:0; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent,var(--green),transparent); animation:shimmer 2s ease-in-out infinite; display:none; }
.deck.playing .deck-shimmer { display:block; }
.deck-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.deck-id { font:500 11px var(--mono); color:var(--tx3); letter-spacing:0.08em; }
.deck.playing .deck-id { color:var(--green); }
.deck-tc { font:500 26px var(--mono); color:#334155; letter-spacing:-0.02em; line-height:1; margin-bottom:10px; font-variant-numeric:tabular-nums; }
.deck.playing .deck-tc { color:var(--tx); }
.deck-info { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.deck-info-label { font:400 10px var(--sans); color:var(--tx3); letter-spacing:0.04em; }
.deck-info-value { font:500 14px var(--mono); color:#334155; }
.deck.playing .deck-info-value { color:var(--tx); }
.deck-track { margin-top:10px; padding-top:10px; border-top:1px solid var(--bg3); }
.deck-track-name { font:400 12px var(--sans); color:#cbd5e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.deck-track-artist { font:400 11px var(--sans); color:var(--tx3); margin-top:2px; }

.section-label { font:500 11px var(--sans); color:var(--tx3); letter-spacing:0.06em; margin-bottom:8px; }
.setting-group { background:var(--bg2); border:1px solid var(--border); border-radius:8px; padding:2px 16px; margin-bottom:16px; }
.setting-row { display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid var(--bg3); }
.setting-row:last-child { border-bottom:none; }
.setting-label { font:400 12px var(--sans); color:var(--tx2); }
.setting-value { font:400 12px var(--mono); color:var(--tx); }

.dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
.dot-green { background:var(--green); }
.dot-red { background:var(--red); }
.dot-dim { background:#1e293b; }
.dot-pulse { animation: pulse 2s ease-in-out infinite; }

.btn { padding:8px 18px; border-radius:6px; font:500 12px var(--sans); cursor:pointer; border:none; transition: all .15s; letter-spacing:0.02em; }
.btn-green { background:var(--green); color:#0a0c10; }
.btn-green:hover { background:#4ade80; }
.btn-red { background:rgba(248,113,113,0.15); color:var(--red); border:1px solid rgba(248,113,113,0.2); }
.btn-red:hover { background:rgba(248,113,113,0.25); }

.bottombar { position:fixed; bottom:0; left:0; right:0; padding:8px 24px; background:rgba(10,12,16,0.95); border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; backdrop-filter:blur(12px); -webkit-app-region: no-drag; }
.bottombar-decks { display:flex; gap:14px; }
.bottombar-deck { display:flex; align-items:center; gap:5px; font:400 10px var(--mono); color:#334155; }

@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
@keyframes shimmer { 0%{opacity:0.3} 50%{opacity:1} 100%{opacity:0.3} }
@keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
</style>
</head>
<body>

<div class="header">
  <div class="logo">
    <div class="logo-icon">B</div>
    <div>
      <div class="logo-text">Bridge Clone</div>
      <div class="logo-ver">v0.1.0 prototype</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <span class="dot dot-green dot-pulse" id="statusDot"></span>
    <span style="font:400 11px var(--mono);color:var(--tx3)" id="statusText">READY</span>
    <button class="btn btn-green" id="startBtn" onclick="toggleBridge()">START</button>
  </div>
</div>

<div class="tabs">
  <button class="tab active" data-tab="link" onclick="switchTab('link')">LINK</button>
  <button class="tab" data-tab="tcnet" onclick="switchTab('tcnet')">TCNET</button>
  <button class="tab" data-tab="settings" onclick="switchTab('settings')">SETTINGS</button>
</div>

<div class="content" id="content">
  <!-- Filled by JS -->
</div>

<div class="bottombar">
  <div class="bottombar-decks" id="bottomDecks"></div>
  <div style="font:400 10px var(--mono);color:#334155" id="bottomStats">TCNet TX: 0 pkts</div>
</div>

<script>
// ========== State ==========
let currentTab = 'link';
let bridgeRunning = false;
let state = {
  running: false,
  uptime: 0,
  layers: [null, null, null, null],
  tcnetOnline: false,
  packetCount: 0,
};

// ========== Demo simulation (Electron 없이 테스트용) ==========
let demoMode = typeof window.bridge === 'undefined';
if (demoMode) {
  console.log('Demo mode — Electron bridge API not available');
  state.layers = [
    { state:1, timecodeMs:54230, bpm:128.0, pitch:0.0, trackName:'Demo Track', artistName:'Demo Artist' },
    { state:1, timecodeMs:127800, bpm:126.0, pitch:-2.1, trackName:'Opus', artistName:'Eric Prydz' },
    null, null
  ];
  state.tcnetOnline = true;
  state.running = true;
  bridgeRunning = true;
  
  setInterval(() => {
    state.uptime++;
    state.packetCount += 30;
    state.layers.forEach(l => { if (l?.state === 1) l.timecodeMs += 100; });
    render();
  }, 100);
}

// ========== Electron IPC ==========
if (!demoMode) {
  window.bridge.onStatus((data) => {
    state = { ...state, ...data, tcnetOnline: data.running };
    render();
  });
}

async function toggleBridge() {
  if (demoMode) { bridgeRunning = !bridgeRunning; state.running = bridgeRunning; render(); return; }
  
  if (bridgeRunning) {
    await window.bridge.stop();
    bridgeRunning = false;
    state.running = false;
  } else {
    const result = await window.bridge.start({ broadcast: 'auto' });
    if (result.success) { bridgeRunning = true; state.running = true; }
    else alert('Start failed: ' + result.error);
  }
  render();
}

// ========== Rendering ==========
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  render();
}

function formatTC(ms) {
  if (!ms && ms !== 0) return '--:--:--:--';
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  const s = Math.floor((ms%60000)/1000), f = Math.floor((ms%1000)/33.33);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(f).padStart(2,'0')}`;
}

function render() {
  const c = document.getElementById('content');
  const dot = document.getElementById('statusDot');
  const stxt = document.getElementById('statusText');
  const btn = document.getElementById('startBtn');
  
  dot.className = `dot ${state.running ? 'dot-green dot-pulse' : 'dot-red'}`;
  stxt.textContent = state.running ? 'ONLINE' : 'OFFLINE';
  btn.textContent = state.running ? 'STOP' : 'START';
  btn.className = `btn ${state.running ? 'btn-red' : 'btn-green'}`;
  
  // Bottom bar
  const bd = document.getElementById('bottomDecks');
  bd.innerHTML = state.layers.map((l, i) =>
    `<div class="bottombar-deck"><span class="dot ${l?.state===1?'dot-green dot-pulse':l?'dot-green':'dot-dim'}"></span>D${i+1}</div>`
  ).join('');
  document.getElementById('bottomStats').textContent = `TCNet TX: ${state.packetCount?.toLocaleString() || 0} pkts`;
  
  if (currentTab === 'link') renderLink(c);
  else if (currentTab === 'tcnet') renderTCNet(c);
  else renderSettings(c);
}

function renderLink(c) {
  const active = state.layers.filter(l => l).length;
  const um = Math.floor(state.uptime/60), us = state.uptime % 60;
  
  c.innerHTML = `
    <div class="status-row">
      <div class="status-card"><div class="status-label">PRO DJ LINK</div><span class="badge ${state.running?'badge-green':'badge-red'}">${state.running?'ONLINE':'OFFLINE'}</span></div>
      <div class="status-card"><div class="status-label">DEVICES</div><span class="badge badge-blue">${active}</span></div>
      <div class="status-card"><div class="status-label">UPTIME</div><span class="badge badge-dim">${um}m ${us}s</span></div>
    </div>
    <div class="section-label">PLAYER STATUS</div>
    <div class="deck-grid">
      ${state.layers.map((d, i) => {
        const playing = d?.state === 1;
        return `<div class="deck ${playing?'playing':''}">
          <div class="deck-shimmer"></div>
          <div class="deck-header">
            <span class="deck-id">DECK ${i+1}</span>
            <span class="badge ${playing?'badge-green':d?.state===4?'badge-blue':'badge-dim'}">
              ${playing?'PLAY':d?.state===4?'LOAD':d?.state===3?'CUE':'STOP'}</span>
          </div>
          <div class="deck-tc">${formatTC(d?.timecodeMs)}</div>
          <div class="deck-info">
            <div><div class="deck-info-label">BPM</div><div class="deck-info-value">${d?.bpm?.toFixed(1)||'---.-'}</div></div>
            <div><div class="deck-info-label">PITCH</div><div class="deck-info-value">${d?.pitch?`${d.pitch>0?'+':''}${d.pitch.toFixed(1)}%`:'0.0%'}</div></div>
          </div>
          ${d?.trackName?`<div class="deck-track"><div class="deck-track-name">${d.trackName}</div><div class="deck-track-artist">${d.artistName||'Unknown'}</div></div>`:''}
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderTCNet(c) {
  c.innerHTML = `
    <div style="background:rgba(52,211,153,0.04);border:1px solid rgba(52,211,153,0.15);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="dot dot-green dot-pulse"></span>
        <div>
          <div style="font:500 12px var(--sans);color:var(--green)">TCNet Online</div>
          <div style="font:400 11px var(--mono);color:var(--tx3)">Node: BRIDGE29 | Mode: SERVER</div>
        </div>
      </div>
      <span class="badge badge-green">30 FPS</span>
    </div>
    
    <div class="section-label">NETWORK DEVICES</div>
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;padding:7px 14px;background:var(--bg3);border-bottom:1px solid var(--border)">
        ${['NODE','FUNCTION','VERSION','STATUS'].map(h => `<div style="font:500 10px var(--sans);color:var(--tx3);letter-spacing:0.06em">${h}</div>`).join('')}
      </div>
      ${[
        {node:'BRIDGE29',func:'SERVER',ver:'V3.5'},
        {node:'Arena',func:'CLIENT',ver:'V7.25'},
      ].map((d,i) => `
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;padding:9px 14px;${i===0?'border-bottom:1px solid var(--bg3)':''}">
          <div style="font:400 12px var(--mono);color:var(--tx)">${d.node}</div>
          <div><span class="badge ${d.func==='SERVER'?'badge-green':'badge-blue'}">${d.func}</span></div>
          <div style="font:400 12px var(--mono);color:var(--tx2)">${d.ver}</div>
          <div><span class="dot dot-green"></span></div>
        </div>
      `).join('')}
    </div>
    
    <div class="section-label">PACKET STATISTICS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
      ${[
        {l:'TIME',v:state.packetCount,color:'var(--green)'},
        {l:'OPTIN',v:Math.floor(state.uptime),color:'var(--blue)'},
        {l:'STATUS',v:Math.floor(state.uptime/2),color:'var(--yellow)'},
        {l:'DATA',v:Math.floor(state.packetCount/10),color:'#a78bfa'},
      ].map(p => `
        <div class="status-card" style="text-align:center">
          <div class="status-label">${p.l}</div>
          <div style="font:500 16px var(--mono);color:${p.color};font-variant-numeric:tabular-nums">${p.v.toLocaleString()}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSettings(c) {
  const row = (label, value) => `<div class="setting-row"><span class="setting-label">${label}</span><span class="setting-value">${value}</span></div>`;
  
  c.innerHTML = `
    <div class="section-label">TCNET CONFIGURATION</div>
    <div class="setting-group">
      ${row('Node Name', 'BRIDGE%%')}
      ${row('Node Mode', 'AUTO')}
      ${row('Frame Rate', '30 fps')}
      ${row('Auto Start', 'ON')}
    </div>
    <div class="section-label">NETWORK</div>
    <div class="setting-group">
      ${row('Interface', 'AUTO')}
      ${row('Broadcast', 'Auto Detect')}
      ${row('TCNet Ports', '60000-60002')}
      ${row('Listener Port', '65156')}
    </div>
    <div class="section-label">PRO DJ LINK</div>
    <div class="setting-group">
      ${row('Link Mode', 'ALWAYS ON')}
      ${row('Virtual CDJ ID', '5')}
    </div>
    <div class="section-label">ABOUT</div>
    <div class="setting-group">
      ${row('Application', 'Bridge Clone')}
      ${row('Version', '0.1.0-prototype')}
      ${row('Protocol', 'TCNet v3.5')}
      ${row('Based On', 'Pioneer DJ Bridge v1.1.8')}
    </div>
  `;
}

// Initial render
render();
</script>
</body>
</html>
```

---

## 9단계: 실행!

### Electron GUI 모드 (권장)
```bash
cd bridge-clone
npx electron .
```

### GUI 없이 헤드리스 모드
```bash
node bridge-clone.js --broadcast=auto
```

### 패킷 검증만
```bash
node verify-packets.js
```

---

## 10단계: Resolume에서 확인

1. Bridge Clone을 실행한 상태로
2. Resolume Arena 실행
3. **View → Pioneer DJ TCNet** 활성화
4. Preferences → General → Pioneer DJ Network Interface에서 같은 네트워크 선택
5. 툴바에 Pioneer 플레이어가 나타나는지 확인

---

## 문제 해결

### "Cannot find module 'electron'" 에러
```bash
npm install electron --save-dev
```

### 네트워크 관련 에러
- 방화벽에서 UDP 60000-60002, 65023 포트 허용
- Wi-Fi와 Ethernet이 동시에 켜져 있으면 인터페이스 충돌 가능
- `--broadcast=192.168.x.255` 로 직접 지정 시도

### Mac에서 "App is damaged" 경고
```bash
xattr -cr bridge-clone/node_modules/electron
```

### Resolume에서 노드가 안 보이는 경우
- Bridge Clone과 Resolume이 같은 서브넷인지 확인
- Windows 방화벽에서 Node.js에 네트워크 접근 허용
- `node bridge-clone.js --broadcast=255.255.255.255` 시도

---

## 다음 단계 (Stage 3)

프로토타입이 작동하면 `prolink-connect` 라이브러리를 추가하여
실제 CDJ에서 데이터를 읽어옵니다:

```bash
npm install prolink-connect
```

```javascript
const { bringOnline } = require('prolink-connect');

async function connectCDJ() {
  const network = await bringOnline();
  await network.autoconfigFromPeers();
  await network.connect();
  
  network.statusEmitter.on('status', (status) => {
    bridge.updateLayer(status.deviceId - 1, {
      timecodeMs: status.playPosition,
      state: status.isPlaying ? 1 : 0,
      bpm: status.trackBPM * (status.effectivePitch / 100),
      trackName: status.trackTitle,
      artistName: status.trackArtist,
    });
  });
}
```
