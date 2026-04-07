# WebGL Waveform + UI/TCNet Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 2D canvas waveform rendering with WebGL2 (GPU-accelerated, no flickering), fix TCNet device naming, fix virtual deck play state + album art, and polish UI layout.

**Architecture:** New `renderer/waveform-gl.js` exports `WaveformGL` (zoom) and `OverviewGL` (overview) classes using WebGL2 RGBA32F textures. A transparent 2D overlay canvas handles beat grid / cue points / cursor. `renderer/index.html` is modified to load these classes and use them. `bridge-core.js` gets vendor/device name and auto-numbered node name changes.

**Tech Stack:** WebGL2, GLSL ES 3.00, 2D Canvas (overlay), Electron/Node.js

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `renderer/waveform-gl.js` | **Create** | `WaveformGL` + `OverviewGL` classes, shader programs, texture upload |
| `renderer/index.html` | **Modify** | Load waveform-gl.js, replace `getContext('2d')` on zoom/overview, add overlay canvas, fix UI layout, add ArtNet badge, fix state transmission |
| `bridge-core.js` | **Modify** | VENDOR/DEVICE names, auto-numbered node name |

---

### Task 1: Create WaveformGL class (zoom waveform, WebGL2)

**Files:**
- Create: `renderer/waveform-gl.js`

- [ ] **Step 1: Create waveform-gl.js with WaveformGL class**

```javascript
// renderer/waveform-gl.js
'use strict';

/**
 * WaveformGL — GPU-accelerated zoom waveform renderer.
 * Uses a WebGL2 RGBA32F texture: R=bass, G=mid, B=treble, A=height (all 0-1).
 * Fragment shader samples the texture per fragment → no CPU loop per frame.
 */
class WaveformGL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this._wfTex = null;
    this._wfLen = 0;
    this._wfDurMs = 1;
    this._prog = this._compileProgram(_WGL_VS, _WGL_ZOOM_FS);
    this._initGeometry();
    this._locs = {
      wf:      gl.getUniformLocation(this._prog, 'u_wf'),
      posMs:   gl.getUniformLocation(this._prog, 'u_posMs'),
      zoomMs:  gl.getUniformLocation(this._prog, 'u_zoomMs'),
      durMs:   gl.getUniformLocation(this._prog, 'u_durMs'),
      res:     gl.getUniformLocation(this._prog, 'u_res'),
      centerX: gl.getUniformLocation(this._prog, 'u_centerX'),
      mode:    gl.getUniformLocation(this._prog, 'u_mode'),
    };
  }

  /** Upload wfData array of {r,g,b,h} (0-1) to GPU texture. */
  setData(wfData, wfDurMs) {
    const gl = this.gl;
    const n = wfData.length;
    if (n < 2) return;
    this._wfLen = n;
    this._wfDurMs = wfDurMs || 1;

    const px = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = wfData[i];
      px[i*4]   = p.r || 0;
      px[i*4+1] = p.g || 0;
      px[i*4+2] = p.b || 0;
      px[i*4+3] = p.h || 0;
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 1, 0, gl.RGBA, gl.FLOAT, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Render waveform. mode: 0=rgb 1=3band 2=blue */
  draw(posMs, zoomMs, centerX, mode) {
    if (!this._wfTex) return;
    const gl = this.gl;
    const cv = gl.canvas;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.useProgram(this._prog);
    gl.bindVertexArray(this._vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.uniform1i(this._locs.wf, 0);
    gl.uniform1f(this._locs.posMs,   posMs);
    gl.uniform1f(this._locs.zoomMs,  zoomMs);
    gl.uniform1f(this._locs.durMs,   this._wfDurMs);
    gl.uniform2f(this._locs.res,     cv.width, cv.height);
    gl.uniform1f(this._locs.centerX, centerX);
    gl.uniform1i(this._locs.mode,    mode | 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  resize(w, h) { const cv = this.gl.canvas; cv.width = w; cv.height = h; }

  destroy() {
    const gl = this.gl;
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    if (this._prog)  gl.deleteProgram(this._prog);
    if (this._vao)   gl.deleteVertexArray(this._vao);
  }

  _initGeometry() {
    const gl = this.gl;
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1
    ]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this._prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  _compileProgram(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error('[WGL] shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('[WGL] link: ' + gl.getProgramInfoLog(p));
    return p;
  }
}

/**
 * OverviewGL — GPU-accelerated full-track overview bar renderer.
 * Same texture approach; renders full track compressed to canvas width.
 */
class OverviewGL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this._wfTex = null;
    this._wfLen = 0;
    this._prog = this._compileProgram(_WGL_VS, _WGL_OV_FS);
    this._initGeometry();
    this._locs = {
      wf:   gl.getUniformLocation(this._prog, 'u_wf'),
      pos:  gl.getUniformLocation(this._prog, 'u_pos'),   // 0-1 playback position
      res:  gl.getUniformLocation(this._prog, 'u_res'),
      mode: gl.getUniformLocation(this._prog, 'u_mode'),
    };
  }

  setData(wfData) {
    const gl = this.gl;
    const n = wfData.length;
    if (n < 2) return;
    this._wfLen = n;
    const px = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = wfData[i];
      px[i*4]   = p.r || 0;
      px[i*4+1] = p.g || 0;
      px[i*4+2] = p.b || 0;
      px[i*4+3] = p.h || 0;
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 1, 0, gl.RGBA, gl.FLOAT, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** pos: 0-1 playback position for cursor line, mode: 0=rgb 1=3band 2=blue */
  draw(pos, mode) {
    if (!this._wfTex) return;
    const gl = this.gl;
    const cv = gl.canvas;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.useProgram(this._prog);
    gl.bindVertexArray(this._vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.uniform1i(this._locs.wf,   0);
    gl.uniform1f(this._locs.pos,  pos);
    gl.uniform2f(this._locs.res,  cv.width, cv.height);
    gl.uniform1i(this._locs.mode, mode | 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  resize(w, h) { const cv = this.gl.canvas; cv.width = w; cv.height = h; }

  destroy() {
    const gl = this.gl;
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    if (this._prog)  gl.deleteProgram(this._prog);
    if (this._vao)   gl.deleteVertexArray(this._vao);
  }

  _initGeometry() {
    const gl = this.gl;
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1
    ]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this._prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  _compileProgram(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error('[WGL] shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('[WGL] link: ' + gl.getProgramInfoLog(p));
    return p;
  }
}

// ─── Shared vertex shader ────────────────────────────────────────────────────
const _WGL_VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// ─── Zoom waveform fragment shader ──────────────────────────────────────────
const _WGL_ZOOM_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wf;
uniform float u_posMs;
uniform float u_zoomMs;
uniform float u_durMs;
uniform vec2  u_res;
uniform float u_centerX;
uniform int   u_mode;
out vec4 fragColor;

vec3 wfColor(float bass, float midf, float treble, int mode) {
  float mx = max(max(bass, midf), max(treble, 0.001));
  if (mode == 1) { // 3band: bass=blue, mid=amber, treble=white
    float tot = bass + midf + treble + 0.001;
    float rn = bass/tot, gn = midf/tot, bn = treble/tot;
    return vec3(
      gn*1.0  + bn*1.0,
      rn*0.333 + gn*0.651 + bn*1.0,
      rn*0.882 + bn*1.0
    );
  } else if (mode == 2) { // blue/rekordbox
    float e = min(1.0, sqrt(bass*bass + midf*midf + treble*treble));
    float w = treble / (bass + midf + treble + 0.001);
    float br = pow(e, 0.55);
    return vec3(br*0.0 + w*0.667, br*0.333 + w*0.529, br*0.690 + w*0.310);
  } else { // rgb
    return vec3(pow(bass/mx,1.5), pow(midf/mx,1.5), pow(treble/mx,1.5));
  }
}

void main() {
  float W = u_res.x, H = u_res.y, mid = H * 0.5;
  float cX = u_centerX * W;
  float msPerPx = u_zoomMs / W;
  float pxMs = u_posMs + (gl_FragCoord.x - cX) * msPerPx;

  if (pxMs < 0.0 || pxMs > u_durMs) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
  }
  float t = clamp(pxMs / u_durMs, 0.0, 1.0);
  vec4 wf = texture(u_wf, vec2(t, 0.5));
  float bass = wf.r, midf = wf.g, treble = wf.b, h = wf.a;

  float halfH = h * mid * 0.95;
  float yDist = abs(gl_FragCoord.y - mid);

  if (halfH < 0.5 || yDist > halfH) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
  }
  vec3 col = wfColor(bass, midf, treble, u_mode);
  float brightness = 1.0 - (yDist / halfH) * 0.75;
  fragColor = vec4(col * brightness, 1.0);
}
`;

// ─── Overview waveform fragment shader ──────────────────────────────────────
const _WGL_OV_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wf;
uniform float u_pos;
uniform vec2  u_res;
uniform int   u_mode;
out vec4 fragColor;

vec3 wfColor(float bass, float midf, float treble, int mode) {
  float mx = max(max(bass, midf), max(treble, 0.001));
  if (mode == 1) {
    float tot = bass + midf + treble + 0.001;
    float rn = bass/tot, gn = midf/tot, bn = treble/tot;
    return vec3(gn*1.0+bn*1.0, rn*0.333+gn*0.651+bn*1.0, rn*0.882+bn*1.0);
  } else if (mode == 2) {
    float e = min(1.0, sqrt(bass*bass+midf*midf+treble*treble));
    float w = treble/(bass+midf+treble+0.001);
    float br = pow(e,0.55);
    return vec3(br*0.0+w*0.667, br*0.333+w*0.529, br*0.690+w*0.310);
  } else {
    return vec3(pow(bass/mx,1.5), pow(midf/mx,1.5), pow(treble/mx,1.5));
  }
}

void main() {
  float W = u_res.x, H = u_res.y, mid = H * 0.5;
  float t = gl_FragCoord.x / W;
  vec4 wf = texture(u_wf, vec2(t, 0.5));
  float bass=wf.r, midf=wf.g, treble=wf.b, h=wf.a;

  // Cursor line: 1px white at playback position
  float curX = u_pos * W;
  if (abs(gl_FragCoord.x - curX) < 0.8) {
    fragColor = vec4(1.0, 1.0, 1.0, 1.0); return;
  }

  float halfH = h * mid * 0.95;
  float yDist = abs(gl_FragCoord.y - mid);
  if (halfH < 0.5 || yDist > halfH) {
    // Played portion: dark tint on left of cursor
    if (t < u_pos) fragColor = vec4(0.04, 0.04, 0.06, 1.0);
    else fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 col = wfColor(bass, midf, treble, u_mode);
  float brightness = 1.0 - (yDist / halfH) * 0.75;
  // Dim played portion
  if (t < u_pos) brightness *= 0.45;
  fragColor = vec4(col * brightness, 1.0);
}
`;
```

- [ ] **Step 2: Commit**

```bash
cd /Users/zes2021/Library/CloudStorage/Dropbox/claude_projects/bridge-clone
git add renderer/waveform-gl.js
git commit -m "feat: WaveformGL + OverviewGL — WebGL2 GPU-accelerated waveform renderers"
```

---

### Task 2: Integrate WebGL into index.html — zoom waveform

**Files:**
- Modify: `renderer/index.html`

The zoom canvas (`wzc`) gets a WebGL2 context via `WaveformGL`. A transparent overlay canvas (`wzov`) is added on top for beat grid / cue points / position cursor (2D canvas). The `buildWaveformCache` / `drawZoomWaveform` functions are replaced with `WaveformGL` calls. Overlay drawing is extracted into `drawZoomOverlay`.

- [ ] **Step 1: Load waveform-gl.js in index.html `<head>`**

Find: `</style></head><body>` (line ~253)

Add before `</style>`:
```html
</style>
<script src="./waveform-gl.js"></script>
</head><body>
```

- [ ] **Step 2: Add overlay canvas to zoom waveform HTML template**

Find the zoom canvas element in the deck HTML template (search `id="dwz\${slot}"`):
```html
<div class="dwz" id="dwz${slot}"><canvas id="wzc${slot}"></canvas><div class="dvm-st">...
```

Replace with (adds `wzov` transparent overlay):
```html
<div class="dwz" id="dwz${slot}" style="position:relative"><canvas id="wzc${slot}" style="position:absolute;top:0;left:0;width:100%;height:100%"></canvas><canvas id="wzov${slot}" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none"></canvas><div class="dvm-st">...
```

Note: The rest of the `dwz` div contents (VU meter, wf-key, wf-bpm, dzoom-btns) remain unchanged after the two canvases.

- [ ] **Step 3: Replace canvas context init for zoom (bindDeck + loadedmetadata)**

Find in `bindDeck` / `_initAudio -> loadedmetadata`:
```javascript
const wzc=document.getElementById('wzc'+slot);if(wzc){d.wzCtx=wzc.getContext('2d');...}
```

Replace with:
```javascript
const wzc=document.getElementById('wzc'+slot);
if(wzc){
  const p=wzc.parentElement;
  const w=p?.offsetWidth||280, h=p?.offsetHeight||64;
  wzc.width=w; wzc.height=h;
  try{
    d.wgl=new WaveformGL(wzc);
    d.wzCtx=null; // WebGL path
  }catch(e){
    console.warn('[WGL] fallback to 2D:',e);
    d.wzCtx=wzc.getContext('2d'); // CPU fallback
  }
  // Overlay canvas for beat grid/cue/cursor
  const wzov=document.getElementById('wzov'+slot);
  if(wzov){d.wovCtx2=wzov.getContext('2d');wzov.width=w;wzov.height=h;}
}
```

Also update `bindDeck` resize for expanded decks — find `// resize canvases for expanded width`:
```javascript
if(d.wgl) d.wgl.resize(newW, h);
else if(wzc) { wzc.width=newW; ... }
const wzov=document.getElementById('wzov'+slot);
if(wzov&&d.wovCtx2){ wzov.width=newW; d.wovCtx2=wzov.getContext('2d'); }
```

- [ ] **Step 4: Add `drawZoomOverlay` function (beat grid + cue points + cursor)**

Add after the existing `drawZoomWaveform` function:

```javascript
// Zoom overlay — beat grid, cue points, position cursor (2D canvas on top of WebGL)
function drawZoomOverlay(slot, prog){
  const d=DECKS[slot];if(!d||!d.wovCtx2)return;
  const wzov=document.getElementById('wzov'+slot);if(!wzov||!wzov.width)return;
  const W=wzov.width,H=wzov.height,ctx=d.wovCtx2;
  const pos=Math.max(0,Math.min(1,prog||0));
  const dur=d.dur,posMs=pos*dur;
  const wfData=d?.rgbWfDetail||d?.rgbWf;
  const isDetail=!!d.rgbWfDetail;
  const wfDur=isDetail?((wfData?.length||0)/150*1000):(dur||1);
  const cX=Math.round(cfg.wfCenter==='left'?W*0.25:W/2);
  const viewMs=d.zoomMs||8000,msPerPx=viewMs/W;

  ctx.clearRect(0,0,W,H);

  // Beat grid
  if(d.bpm>0&&dur>0){
    const viewL=posMs-cX*msPerPx,viewR=posMs+(W-cX)*msPerPx;
    ctx.font='bold 9px "DM Mono",monospace';
    if(d._beatGrid&&d._beatGrid.length>0){
      const bg=d._beatGrid;
      let lo=0,hi=bg.length-1;
      while(lo<hi){const mid2=(lo+hi)>>1;if(bg[mid2].timeMs<viewL)lo=mid2+1;else hi=mid2;}
      for(let i=Math.max(0,lo-1);i<bg.length;i++){
        const bt=bg[i];if(bt.timeMs>viewR)break;
        const bpx=Math.round((bt.timeMs-posMs)/msPerPx+cX);
        if(bpx<1||bpx>=W-1)continue;
        if(bt.beatInBar===1){
          ctx.fillStyle='rgba(255,140,0,.55)';ctx.fillRect(bpx-.5,0,1,H);
          ctx.fillStyle='rgba(255,165,0,.95)';ctx.fillText('1',bpx+2,H-2);
        }else{
          ctx.fillStyle='rgba(255,255,255,.2)';ctx.fillRect(bpx-.5,H*.25,1,H*.75);
          ctx.fillStyle='rgba(255,255,255,.5)';ctx.fillText(bt.beatInBar,bpx+2,H-2);
        }
      }
    }else if(d.bpm>0){
      const beatMs=60000/(d.baseBpm||d.bpm);
      const anchor=d._barAnchorMs||0;
      const firstB=Math.ceil((posMs-cX*msPerPx-anchor)/beatMs);
      const lastB=Math.floor((posMs+(W-cX)*msPerPx-anchor)/beatMs);
      for(let b=firstB;b<=lastB;b++){
        const bMs=anchor+b*beatMs;
        const bpx=Math.round((bMs-posMs)/msPerPx+cX);
        if(bpx<1||bpx>=W-1)continue;
        const barNum=((b%4)+4)%4+1;
        if(barNum===1){ctx.fillStyle='rgba(255,140,0,.55)';ctx.fillRect(bpx-.5,0,1,H);ctx.fillStyle='rgba(255,165,0,.95)';ctx.fillText('1',bpx+2,H-2);}
        else{ctx.fillStyle='rgba(255,255,255,.2)';ctx.fillRect(bpx-.5,H*.25,1,H*.75);ctx.fillStyle='rgba(255,255,255,.5)';ctx.fillText(barNum,bpx+2,H-2);}
      }
    }
  }

  // Cue points
  const _cueColorsZ={0:'#ff1744',1:'#ff9100',2:'#ffd600',3:'#00e676',4:'#00b0ff',5:'#d500f9',6:'#ff4081',7:'#e0e0e0'};
  if(d.cuePoints&&dur>0){
    ctx.font='bold 8px "DM Mono",monospace';
    for(const cue of d.cuePoints){
      const cpx=Math.round((cue.timeMs-posMs)/msPerPx+cX);
      if(cpx<0||cpx>=W)continue;
      const col=cue.type==='hot'?(_cueColorsZ[cue.colorId]||'#00e676'):'#fff';
      ctx.fillStyle=col+'99';ctx.fillRect(cpx-.5,0,1,H);
      ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(cpx-3,0);ctx.lineTo(cpx+3,0);ctx.lineTo(cpx,5);ctx.closePath();ctx.fill();
      if(cue.type==='hot'&&cue.hotCueNum>0){
        const lbl=String.fromCharCode(64+cue.hotCueNum);
        ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(cpx+1,0,9,10);
        ctx.fillStyle=col;ctx.fillText(lbl,cpx+2,9);
      }
    }
  }

  // Main cue point
  if(d.cp>0&&dur>0){
    const cpx=Math.round((d.cp*1000-posMs)/msPerPx+cX);
    if(cpx>=0&&cpx<W){
      ctx.fillStyle='rgba(251,191,36,.9)';ctx.fillRect(cpx-.5,0,1,H);
      ctx.beginPath();ctx.moveTo(cpx-3,0);ctx.lineTo(cpx+3,0);ctx.lineTo(cpx,4);ctx.closePath();ctx.fillStyle='rgba(251,191,36,1)';ctx.fill();
    }
  }

  // Position cursor
  const phGrd=ctx.createLinearGradient(cX-8,0,cX+8,0);
  phGrd.addColorStop(0,'rgba(255,255,255,0)');
  phGrd.addColorStop(.5,'rgba(255,255,255,.18)');
  phGrd.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=phGrd;ctx.fillRect(cX-8,0,16,H);
  ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillRect(cX-.5,0,1,H);

  // bar.beat overlay
  if(d._barBeat){
    ctx.fillStyle='rgba(0,0,0,.78)';
    const bw=ctx.measureText(d._barBeat).width;
    ctx.fillRect(cX-bw/2-4,1,bw+8,15);
    ctx.fillStyle='rgba(255,255,255,.9)';ctx.font='bold 9px "DM Mono",monospace';
    ctx.fillText(d._barBeat,cX-bw/2,12);
  }
}
```

- [ ] **Step 5: Update `drawZoomWaveform` to use WebGL path**

Find the start of `drawZoomWaveform`:
```javascript
function drawZoomWaveform(slot,prog){
  const d=DECKS[slot];
  const wfData=d?.rgbWfDetail||d?.rgbWf;
  if(!d||!wfData||!d.wzCtx)return;
```

Replace the entire function with a short dispatcher:
```javascript
function drawZoomWaveform(slot,prog){
  const d=DECKS[slot];
  const wfData=d?.rgbWfDetail||d?.rgbWf;
  if(!d||!wfData)return;
  const pos=Math.max(0,Math.min(1,prog||0));

  if(d.wgl){
    // GPU path
    const isDetail=!!d.rgbWfDetail;
    const wfDurMs=isDetail?((wfData.length/150)*1000):(d.dur||1);
    const modeMap={'rgb':0,'3band':1,'blue':2};
    const mode=modeMap[cfg.wfColor]??0;
    const cX=cfg.wfCenter==='left'?0.25:0.5;
    d.wgl.draw(pos*d.dur, d.zoomMs||8000, wfDurMs, cX, mode);
    drawZoomOverlay(slot,prog);
    return;
  }
  // CPU fallback (2D canvas — original code follows)
  if(!d.wzCtx)return;
  // [KEEP ORIGINAL drawZoomWaveform 2D code here as fallback — from ctx.fillStyle='#000' to end of function]
}
```

Note: Keep the full original 2D canvas drawing code after the GPU path's `return` as fallback.

- [ ] **Step 6: Update `setData` call when waveform is ready**

Find locations where `buildWaveformCache(slot)` is called and add `d.wgl?.setData(...)` alongside:

Search for all `buildWaveformCache(slot)` calls. After each one (or replacing for WebGL path), add:
```javascript
if(d.wgl){
  const wfData=d.rgbWfDetail||d.rgbWf;
  const isDetail=!!d.rgbWfDetail;
  const wfDurMs=isDetail?((wfData.length/150)*1000):(d.dur||1);
  d.wgl.setData(wfData, wfDurMs);
}
```

- [ ] **Step 7: Commit**

```bash
git add renderer/index.html
git commit -m "feat: integrate WaveformGL into zoom waveform (GPU-accelerated, no flicker)"
```

---

### Task 3: Integrate OverviewGL into index.html — overview waveform

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: Replace overview canvas context init**

Find (in bindDeck and loadedmetadata):
```javascript
const wov=document.getElementById('wov'+slot);if(wov){d.wovCtx=wov.getContext('2d');...}
```

Replace with:
```javascript
const wov=document.getElementById('wov'+slot);
if(wov){
  const p=wov.parentElement;
  const w=p?.offsetWidth||280, h=p?.offsetHeight||14;
  wov.width=w; wov.height=h;
  try{
    d.ovgl=new OverviewGL(wov);
    d.wovCtx=null;
  }catch(e){
    console.warn('[OvGL] fallback:',e);
    d.wovCtx=wov.getContext('2d');
  }
}
```

- [ ] **Step 2: Update `setData` for overview GL**

After each place `drawOverview(slot, 0)` is called on track load, add:
```javascript
if(d.ovgl){
  d.ovgl.setData(d.rgbWfDetail||d.rgbWf);
}
```

- [ ] **Step 3: Update `drawOverview` to dispatch to GPU path**

Find the start of `drawOverview`:
```javascript
function drawOverview(slot,prog){
  const d=DECKS[slot];if(!d||!d.wovCtx)return;
```

Add GPU dispatch at the top:
```javascript
function drawOverview(slot,prog){
  const d=DECKS[slot];if(!d)return;
  const pos=Math.max(0,Math.min(1,prog||0));
  if(d.ovgl&&(d.rgbWfDetail||d.rgbWf)){
    const modeMap={'rgb':0,'3band':1,'blue':2};
    d.ovgl.draw(pos, modeMap[cfg.wfColor]??0);
    // Draw cue points / memory cues on overview via 2D canvas overlay
    _drawOverviewCues(slot, pos);
    return;
  }
  if(!d.wovCtx)return;
  // [KEEP original 2D drawOverview code as fallback]
}
```

- [ ] **Step 4: Add `_drawOverviewCues` for 2D cue overlay on overview**

Since the overview WebGL shader handles the waveform and cursor, cue points need a 2D overlay. The simplest approach is to reuse the `wov` canvas by switching context type — but WebGL and 2D contexts can't share a canvas. Instead, draw cue points by temporarily using an approach where we use the WebGL canvas for the waveform and use the existing `wovCtx` field on a separate overlay... 

Simpler alternative: Encode cue point positions as lines IN the overview shader, OR just skip cue point drawing on overview for now (cue points are visible on zoom waveform which is more important).

Use this simpler approach — cue points on overview are cosmetic, skip for now:
```javascript
function _drawOverviewCues(slot, pos){
  // Overview cue points drawn only in CPU fallback path.
  // GPU overview shows waveform + playback cursor only.
}
```

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html
git commit -m "feat: integrate OverviewGL — GPU-accelerated full-track overview"
```

---

### Task 4: TCNet device/node name

**Files:**
- Modify: `bridge-core.js` lines ~24-27, ~672-677

- [ ] **Step 1: Update VENDOR and DEVICE names**

Find:
```javascript
  VENDOR: 'PIONEER DJ CORP', DEVICE: 'PRODJLINK BRIDGE',
```

Replace with:
```javascript
  VENDOR: 'BRIDGE+', DEVICE: 'BRIDGE+',
```

- [ ] **Step 2: Change node name auto-assignment to Bridge01..Bridge08**

Find:
```javascript
    if(!this._nameSet){
      const suffix = String(Math.floor(Math.random()*900)+100);
      TC.NNAME = 'BRIDGE' + suffix;
      this._nameSet = true;
      console.log(`[TCNet] name=${TC.NNAME}`);
    }
```

Replace with:
```javascript
    if(!this._nameSet){
      // Find first unused Bridge01..Bridge08 number
      const existingNames = new Set(Object.values(this.nodes).map(n=>n.name));
      let suffix = '01';
      for(let n=1; n<=8; n++){
        const candidate = 'Bridge' + String(n).padStart(2,'0');
        if(!existingNames.has(candidate)){ suffix = String(n).padStart(2,'0'); break; }
      }
      TC.NNAME = 'Bridge' + suffix;
      this._nameSet = true;
      console.log(`[TCNet] name=${TC.NNAME}`);
    }
```

- [ ] **Step 3: Commit**

```bash
git add bridge-core.js
git commit -m "fix: TCNet vendor/device name → BRIDGE+, node name Bridge01..Bridge08 auto-assign"
```

---

### Task 5: Virtual deck play state + album art fix

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: Fix play state — send PAUSED(5) when loaded but not playing**

Find in `tick()` (inside `Object.keys(DECKS).forEach`):
```javascript
      window.bridge.updateLayer(slot,{
        state:d.pl?3:d.cu?7:0,
```

Replace with:
```javascript
      window.bridge.updateLayer(slot,{
        state:d.pl?3:d.cu?7:(d.ld?5:0),
```

- [ ] **Step 2: Fix album art — send art after START is clicked**

Find the re-register loop after `start()` (around line 2284):
```javascript
    for(const [slot,d] of Object.entries(DECKS)){
      if(d.type==='virtual') window.bridge.registerVirtualDeck(Number(slot),'CDJ-3000');
    }
```

Replace with:
```javascript
    for(const [slot,d] of Object.entries(DECKS)){
      if(d.type==='virtual'){
        window.bridge.registerVirtualDeck(Number(slot),'CDJ-3000');
        // Re-send artwork if available (was loaded before START)
        if(d._artRawB64 && window.bridge?.setVirtualArt){
          window.bridge.setVirtualArt(Number(slot), d._artRawB64);
        }
      }
    }
```

- [ ] **Step 3: Store art base64 on deck object when loaded**

Find where `setVirtualArt` is called on track load (around line 1564):
```javascript
      if(tags._artRaw && window.bridge?.setVirtualArt){
        const u8=new Uint8Array(tags._artRaw);
        let b64='';const chunk=8192;
        for(let i=0;i<u8.length;i+=chunk) b64+=String.fromCharCode(...u8.subarray(i,i+chunk));
        window.bridge.setVirtualArt(slot, btoa(b64));
      }
```

Replace with:
```javascript
      if(tags._artRaw){
        const u8=new Uint8Array(tags._artRaw);
        let b64='';const chunk=8192;
        for(let i=0;i<u8.length;i+=chunk) b64+=String.fromCharCode(...u8.subarray(i,i+chunk));
        d._artRawB64=btoa(b64); // store for re-send after START
        if(window.bridge?.setVirtualArt && E && run){
          window.bridge.setVirtualArt(slot, d._artRawB64);
        }
      }
```

- [ ] **Step 4: Clear stored art on eject**

Find the deck state reset (where `artUrl` is cleared, around `Object.assign(d,{...artUrl:null...})`). Add `_artRawB64` to the reset:

Find:
```javascript
Object.assign(d,{ld:false,pl:false,...,artUrl:null,
```

Add `_artRawB64:null,` to the same Object.assign:
```javascript
Object.assign(d,{ld:false,pl:false,...,artUrl:null,_artRawB64:null,
```

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html
git commit -m "fix: virtual deck play state PAUSED(5) when stopped, album art re-send after START"
```

---

### Task 6: UI — 2-row track info + artist below title

**Files:**
- Modify: `renderer/index.html` (CSS + HTML templates)

Current layout:
```
[title]                    · [artist]
[BPM] [key] / [scale] [time] / [total]
```

Target layout:
```
[title]
· [artist]
[time] / [total]
[BPM] · [key] / [scale]
```

- [ ] **Step 1: Update CSS for new track info rows**

Find and update `.dktn` and `.dktn-info` styles. Find:
```css
.dktn{padding:0 0 3px;display:flex;align-items:baseline;gap:4px;min-width:0;overflow:hidden}
```

Replace with:
```css
.dktn{padding:0 0 2px;display:flex;flex-direction:column;gap:0;min-width:0;overflow:hidden}
.dktn-row{display:flex;align-items:baseline;gap:6px;min-width:0;overflow:hidden}
```

Find and replace `.dktn-a` style:
```css
.dktn-a{font:400 10px var(--sn);color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;max-width:160px;min-width:0}
```
Replace with:
```css
.dktn-a{font:400 10px var(--sn);color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
```

Remove `.dktn-info` override (or update it):
```css
.dktn-info{padding:0 0 3px;gap:8px;justify-content:flex-start;flex-wrap:nowrap}
```
Replace with:
```css
.dktn-time-row{font:500 10px var(--mn);color:var(--tx3);font-variant-numeric:tabular-nums;padding:0 0 1px}
.dktn-bpm-row{font:500 10px var(--mn);color:var(--tx3);padding:0 0 3px}
.dk[data-st="play"] .dktn-time-row,.dk[data-st="hwplay"] .dktn-time-row,.dk[data-st="cue"] .dktn-time-row{color:var(--tx2)}
.dk[data-st="play"] .dktn-bpm-row,.dk[data-st="hwplay"] .dktn-bpm-row,.dk[data-st="cue"] .dktn-bpm-row{color:var(--tx2)}
```

- [ ] **Step 2: Update loaded deck HTML template — track info section**

Find (in `makeDeck` function, loaded deck template):
```javascript
      <div class="dktn"><span class="dktn-t" id="dtn${slot}">${d.tn||'—'}</span><span class="dktn-a" id="dta${slot}">${d.ar?` · ${d.ar}`:''}</span></div>
      <div class="dktn dktn-info"><span class="dbk-hd" id="dbk${slot}">—</span><span class="dktn-time" id="dtime${slot}">0:00.00 / --:--.---</span></div>
```

Replace with:
```javascript
      <div class="dktn">
        <div class="dktn-row"><span class="dktn-t" id="dtn${slot}">${d.tn||'—'}</span></div>
        <div class="dktn-row"><span class="dktn-a" id="dta${slot}">${d.ar?`· ${d.ar}`:''}</span></div>
        <div class="dktn-time-row" id="dtime${slot}">0:00.00 / --:--.---</div>
        <div class="dktn-bpm-row" id="dbk${slot}">—</div>
      </div>
```

- [ ] **Step 3: Update HW unloaded deck template similarly**

Find:
```javascript
        <div class="dktn"><span class="dktn-t" style="color:var(--tx4)">—</span></div>
        <div class="dktn dktn-info"><span class="dbk-hd" style="color:var(--tx4)">— BPM</span><span class="dktn-time">--:--.--- / --:--.---</span></div>
```

Replace with:
```javascript
        <div class="dktn">
          <div class="dktn-row"><span class="dktn-t" style="color:var(--tx4)">—</span></div>
          <div class="dktn-time-row" style="color:var(--tx4)">--:--.--- / --:--.---</div>
          <div class="dktn-bpm-row" style="color:var(--tx4)">— BPM</div>
        </div>
```

- [ ] **Step 4: Update JS that writes to `dbk${slot}` and `dtime${slot}`**

Search for all assignments to `id="dbk"` elements and `id="dtime"` elements. The JS likely does:
```javascript
document.getElementById('dbk'+slot).textContent = ...
document.getElementById('dtime'+slot).textContent = ...
```

These IDs are preserved in Step 2, so JS doesn't need changes. BUT: verify the content format. The BPM row should be `117 BPM · 7A / Dm` and time row `0:00.000 / 4:36.923`.

Search for where `dbk` is set and ensure BPM format shows correctly. Find assignments like:
```javascript
document.getElementById('dbk'+slot)?.textContent=`${bpm} BPM${key?` · ${key}`:''}`
```

These should be correct already. If `.dktn-info` class was used on the container, remove references to it in JS.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html
git commit -m "ui: artist below title, time row 1 / BPM+key row 2 in deck info"
```

---

### Task 7: ArtNet status badge in status bar

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: Add ArtNet badge HTML in sbar**

Find:
```html
  <div class="sbar">
    <div class="sc"><div class="scl">TCNet</div><span class="bd br" id="stBadge">OFFLINE</span></div>
    <div class="sc"><div class="scl">ARENA 노드</div><span class="bd bb" id="stArena">0</span></div>
    <div class="sc"><div class="scl">활성 덱</div><span class="bd bm" id="stDecks">0</span></div>
    <div class="sc"><div class="scl">UPTIME</div><span class="bd bm" id="stUp">—</span></div>
  </div>
```

Replace with:
```html
  <div class="sbar">
    <div class="sc"><div class="scl">TCNet</div><span class="bd br" id="stBadge">OFFLINE</span></div>
    <div class="sc"><div class="scl">ArtNet</div><span class="bd br" id="stArtnet">OFF</span></div>
    <div class="sc"><div class="scl">ARENA 노드</div><span class="bd bb" id="stArena">0</span></div>
    <div class="sc"><div class="scl">활성 덱</div><span class="bd bm" id="stDecks">0</span></div>
    <div class="sc"><div class="scl">UPTIME</div><span class="bd bm" id="stUp">—</span></div>
  </div>
```

- [ ] **Step 2: Update ArtNet badge in `updateHeader`**

Find `updateHeader` function, after `document.getElementById('stUp').textContent=...`:
```javascript
  document.getElementById('stUp').textContent=run?Math.floor(up/60)+'m '+(up%60)+'s':'—';
  document.getElementById('stAlert').classList.toggle('hide',run);
```

Add after `stUp` line:
```javascript
  // ArtNet active = any output layer has 'art' enabled
  const artActive=run&&Object.values(OUT).some(o=>o.art);
  const stAn=document.getElementById('stArtnet');
  if(stAn){
    stAn.className='bd '+(artActive?'bg':'br');
    stAn.textContent=artActive?'ACTIVE':'OFF';
  }
```

- [ ] **Step 3: Commit**

```bash
git add renderer/index.html
git commit -m "ui: ArtNet ACTIVE/OFF status badge in status bar"
```

---

### Task 8: Final — push to GitHub

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

Expected output: `main -> main` with all commits.

---

## Self-Review

**Spec coverage:**
1. ✅ WebGL zoom waveform → Tasks 1-2
2. ✅ WebGL overview → Task 3
3. ✅ TCNet device/node name → Task 4
4. ✅ Play state fix → Task 5
5. ✅ Album art fix → Task 5
6. ✅ UI 2-row layout → Task 6
7. ✅ ArtNet badge → Task 7

**Placeholder scan:**
- Task 5 Step 3: `E && run` condition is explicit — art sent only when bridge is running.
- Task 2 Step 5: Note to keep original 2D canvas code as fallback is explicit.
- Task 3 Step 4: `_drawOverviewCues` is a no-op stub — explicitly noted as intentional simplification.

**Type consistency:**
- `d.wgl` (WaveformGL instance) used consistently across Tasks 1-2
- `d.ovgl` (OverviewGL instance) used consistently in Task 3
- `d.wovCtx2` (2D overlay context) introduced in Task 2, used in Task 2 Step 4
- `d._artRawB64` introduced in Task 5 Step 3, cleared in Step 4, used in Step 2
- IDs `dtc${slot}`, `dbk${slot}`, `dtime${slot}` preserved from original — no JS changes needed
