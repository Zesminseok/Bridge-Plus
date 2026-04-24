// renderer/waveform-gl.js
'use strict';

function _wglIsPackedWaveform(wfData) {
  return wfData instanceof Uint8Array && wfData._packed;
}

function _wglWaveformLength(wfData) {
  return _wglIsPackedWaveform(wfData) ? Math.floor(wfData.length / 8) : (wfData?.length || 0);
}

// Texture layout for STACKED packed virtual waveforms:
//   Row 0 RGBA = low_env, mid_env, hi_env, air_env (unsigned u8)
//   Row 1 RGBA = full_mn,  full_mx,  band_env, rms_raw
// Legacy HW path (object {r,g,b,h}): row 0 = band envelopes, row 1 = signed full contour.
function _wglWritePoint(px, row1, dstIdx, wfData, srcIdx) {
  const dst = dstIdx * 4;
  const dstShape = row1 + dst;
  if (_wglIsPackedWaveform(wfData)) {
    const src = srcIdx * 8;
    px[dst]       = wfData[src];
    px[dst + 1]   = wfData[src + 1];
    px[dst + 2]   = wfData[src + 2];
    px[dst + 3]   = wfData[src + 3];
    px[dstShape]     = wfData[src + 4];
    px[dstShape + 1] = wfData[src + 5];
    px[dstShape + 2] = wfData[src + 6];
    px[dstShape + 3] = wfData[src + 7];
    return;
  }
  // HW path: {r:low, g:mid, b:hi} band amplitudes -> symmetric envelope contract
  const p = wfData[srcIdx] || {};
  const enc = v => Math.max(0, Math.min(255, Math.round((Math.max(-1, Math.min(1, v)) + 1) * 127.5)));
  const encU = v => Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(1, v)) * 255)));
  const lo = Math.min(1, Math.max(0, p.r || 0));
  const mi = Math.min(1, Math.max(0, p.g || 0));
  const hi = Math.min(1, Math.max(0, p.b || 0));
  const h = Math.min(1, Math.max(0, p.h || Math.max(lo, mi, hi)));
  px[dst]     = encU(lo);
  px[dst + 1] = encU(mi);
  px[dst + 2] = encU(hi);
  px[dst + 3] = encU(h);
  px[dstShape]     = enc(p.mn !== undefined ? p.mn : -h);
  px[dstShape + 1] = enc(p.mx !== undefined ? p.mx : h);
  px[dstShape + 2] = encU(h);
  px[dstShape + 3] = encU(h);
}

// Peak-preserving pool for stacked-layout bytes.
// Row 0 envelopes: MAX all channels. Row 1: full_mn MIN, full_mx MAX, envelope MAX.
function _wglPoolRow(dst, dstOff, src, srcRow, j0, j1, isRow1) {
  let a = isRow1 ? 255 : 0, b = 0, c = 0, d = 0;
  for (let j = j0; j < j1; j++) {
    const o = srcRow + j * 4;
    if (isRow1) {
      if (src[o] < a) a = src[o];
      if (src[o + 1] > b) b = src[o + 1];
    } else {
      if (src[o] > a) a = src[o];
      if (src[o + 1] > b) b = src[o + 1];
    }
    if (src[o + 2] > c) c = src[o + 2];
    if (src[o + 3] > d) d = src[o + 3];
  }
  dst[dstOff]     = a;
  dst[dstOff + 1] = b;
  dst[dstOff + 2] = c;
  dst[dstOff + 3] = d;
}

/**
 * WaveformGL — GPU-accelerated zoom waveform renderer.
 * Uses a WebGL2 RGBA texture: R=bass, G=body, B=presence, A=air/height (all 0-1).
 * Fragment shader samples the texture per fragment → no CPU loop per frame.
 */
class WaveformGL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available');
    this.canvas = canvas;
    this.gl = gl;
    gl.clearColor(0.067, 0.075, 0.094, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this._wfTex = null;
    this._wfLen = 0;
    this._wfDurMs = 1;
    this._dirty = true;
    this._lastDrawKey = '';
    this._oscilloscope = 0;
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
      theme:   gl.getUniformLocation(this._prog, 'uTheme'),
      sharpness: gl.getUniformLocation(this._prog, 'uSharpness'),
    };
  }

  /** Upload wfData array of {r,g,b,a,h} (0-1) to GPU texture. */
  setData(wfData, wfDurMs) {
    const gl = this.gl;
    const n = _wglWaveformLength(wfData);
    if (n < 2) return;
    // Recover from WebGL context reset (canvas.width assignment clears GPU state)
    if (!this._prog || !gl.isProgram(this._prog)) {
      try {
        this._prog = this._compileProgram(_WGL_VS, _WGL_ZOOM_FS);
        this._vao = null;
        this._initGeometry();
        this._locs = {
          wf:      gl.getUniformLocation(this._prog, 'u_wf'),
          posMs:   gl.getUniformLocation(this._prog, 'u_posMs'),
          zoomMs:  gl.getUniformLocation(this._prog, 'u_zoomMs'),
          durMs:   gl.getUniformLocation(this._prog, 'u_durMs'),
          res:     gl.getUniformLocation(this._prog, 'u_res'),
          centerX: gl.getUniformLocation(this._prog, 'u_centerX'),
          mode:    gl.getUniformLocation(this._prog, 'u_mode'),
          theme:   gl.getUniformLocation(this._prog, 'uTheme'),
          sharpness: gl.getUniformLocation(this._prog, 'uSharpness'),
        };
      } catch(e) { console.warn('[WGL] recover failed:', e.message); return; }
    }
    this._wfLen = n;
    this._wfDurMs = wfDurMs || 1;
    this._dirty = true;
    this._lastDrawKey = '';

    // 2-row texture: row 0 = (R,G,B,A) band peaks, row 1 = (mx_enc, mn_enc, 0, 255) signed envelope
    const px = new Uint8Array(n * 4 * 2);
    const row1 = n * 4;
    for (let i = 0; i < n; i++) _wglWritePoint(px, row1, i, wfData, i);
    // Cap at GPU MAX_TEXTURE_SIZE — PEAK max-pool (max for mx, MIN for mn to preserve neg peaks)
    const maxTex = Math.min(16384, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
    const canvasPx = Math.max(1, this.canvas.width);
    const target = Math.max(256, Math.min(maxTex, canvasPx * 4));
    let texN = n, texPx = px;
    if (n > target) {
      texN = target;
      texPx = new Uint8Array(texN * 4 * 2);
      const tRow1 = texN * 4;
      const stride = n / texN;
      for (let i = 0; i < texN; i++) {
        const j0 = Math.floor(i * stride);
        const j1 = Math.min(n, Math.max(j0 + 1, Math.floor((i + 1) * stride)));
        _wglPoolRow(texPx, i*4, px, 0, j0, j1, false);
        _wglPoolRow(texPx, tRow1 + i*4, px, row1, j0, j1, true);
      }
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texN, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, texPx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._winKey = '';
  }

  /** Upload only a window of the detail waveform at native resolution (no downsample). */
  setWindowData(wfData, startIdx, endIdx, sliceDurMs) {
    const gl = this.gl;
    const len = _wglWaveformLength(wfData);
    if (len < 2) return;
    startIdx = Math.max(0, Math.min(len - 2, startIdx | 0));
    endIdx = Math.max(startIdx + 2, Math.min(len, endIdx | 0));
    const n = endIdx - startIdx;
    const winKey = startIdx + '_' + endIdx + '_' + n;
    if (this._winKey === winKey && this._wfTex) {
      if (sliceDurMs) this._wfDurMs = sliceDurMs;
      return;
    }
    if (!this._prog || !gl.isProgram(this._prog)) {
      try {
        this._prog = this._compileProgram(_WGL_VS, _WGL_ZOOM_FS);
        this._vao = null;
        this._initGeometry();
        this._locs = {
          wf:   gl.getUniformLocation(this._prog, 'u_wf'),
          posMs:gl.getUniformLocation(this._prog, 'u_posMs'),
          zoomMs: gl.getUniformLocation(this._prog, 'u_zoomMs'),
          durMs: gl.getUniformLocation(this._prog, 'u_durMs'),
          res:  gl.getUniformLocation(this._prog, 'u_res'),
          centerX: gl.getUniformLocation(this._prog, 'u_centerX'),
          mode: gl.getUniformLocation(this._prog, 'u_mode'),
          theme: gl.getUniformLocation(this._prog, 'uTheme'),
          sharpness: gl.getUniformLocation(this._prog, 'uSharpness'),
        };
      } catch(e) { console.warn('[WGL] wgl recover failed:', e.message); return; }
    }
    // 2-row texture: row 0 = band RGBA, row 1 = signed envelope (mx_enc, mn_enc)
    const px = new Uint8Array(n * 4 * 2);
    const row1 = n * 4;
    for (let i = 0; i < n; i++) _wglWritePoint(px, row1, i, wfData, startIdx + i);
    // PEAK-preserving downsample if slice still exceeds GPU cap (rare for window view)
    const maxTex = Math.min(16384, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
    const canvasPx = Math.max(1, this.canvas.width);
    const target = Math.max(256, Math.min(maxTex, canvasPx * 4));
    let texN = n, texPx = px;
    if (n > target) {
      texN = target;
      texPx = new Uint8Array(texN * 4 * 2);
      const tRow1 = texN * 4;
      const stride = n / texN;
      for (let i = 0; i < texN; i++) {
        const j0 = Math.floor(i * stride);
        const j1 = Math.min(n, Math.max(j0 + 1, Math.floor((i + 1) * stride)));
        _wglPoolRow(texPx, i*4, px, 0, j0, j1, false);
        _wglPoolRow(texPx, tRow1 + i*4, px, row1, j0, j1, true);
      }
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texN, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, texPx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._wfLen = n;
    this._wfDurMs = sliceDurMs || 1;
    this._winKey = winKey;
    this._dirty = true;
    this._lastDrawKey = '';
  }

  /** Render waveform. mode keeps data layout. */
  draw(posMs, zoomMs, centerX, mode, sharpness = 0, theme = 0) {
    if (!this._wfTex) return;
    // Detect WebGL context reset: canvas.width assignment clears all GPU objects
    if (!this.gl.isProgram(this._prog)) { this._prog = null; this._wfTex = null; return; }
    const gl = this.gl;
    const cv = gl.canvas;
    const drawKey = `${cv.width}x${cv.height}|${posMs}|${zoomMs}|${centerX}|${mode}|${sharpness}|${theme}`;
    if (!this._dirty && this._lastDrawKey === drawKey) return;
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
    gl.uniform1i(this._locs.theme,   theme | 0);
    gl.uniform1f(this._locs.sharpness, Math.max(0, Math.min(1, sharpness || 0)));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._dirty = false;
    this._lastDrawKey = drawKey;
  }

  resize(w, h) { const cv = this.gl.canvas; cv.width = w; cv.height = h; this._dirty = true; this._lastDrawKey = ''; }

  destroy() {
    const gl = this.gl;
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    if (this._prog)  gl.deleteProgram(this._prog);
    if (this._vao)   gl.deleteVertexArray(this._vao);
    // loseContext() 금지: 캔버스 재사용 시 컨텍스트가 소실된 채로 남아
    // getContext('webgl2')가 소실 컨텍스트를 반환 → createShader()=null 오류
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
      if (!s) throw new Error('createShader null — context lost=' + gl.isContextLost());
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
 */
class OverviewGL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available');
    this.canvas = canvas;
    this.gl = gl;
    gl.clearColor(0.067, 0.075, 0.094, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this._wfTex = null;
    this._dirty = true;
    this._lastDrawKey = '';
    this._prog = this._compileProgram(_WGL_VS, _WGL_OV_FS);
    this._initGeometry();
    this._locs = {
      wf:   gl.getUniformLocation(this._prog, 'u_wf'),
      pos:  gl.getUniformLocation(this._prog, 'u_pos'),
      res:  gl.getUniformLocation(this._prog, 'u_res'),
      mode: gl.getUniformLocation(this._prog, 'u_mode'),
      theme: gl.getUniformLocation(this._prog, 'uTheme'),
      sharpness: gl.getUniformLocation(this._prog, 'uSharpness'),
    };
  }

  setData(wfData) {
    const gl = this.gl;
    const n = _wglWaveformLength(wfData);
    if (n < 2) return;
    // Recover from WebGL context reset
    if (!this._prog || !gl.isProgram(this._prog)) {
      try {
        this._prog = this._compileProgram(_WGL_VS, _WGL_OV_FS);
        this._vao = null;
        this._initGeometry();
        this._locs = {
          wf:   gl.getUniformLocation(this._prog, 'u_wf'),
          pos:  gl.getUniformLocation(this._prog, 'u_pos'),
          res:  gl.getUniformLocation(this._prog, 'u_res'),
          mode: gl.getUniformLocation(this._prog, 'u_mode'),
          theme: gl.getUniformLocation(this._prog, 'uTheme'),
          sharpness: gl.getUniformLocation(this._prog, 'uSharpness'),
        };
      } catch(e) { console.warn('[WGL] ovgl recover failed:', e.message); return; }
    }
    const px = new Uint8Array(n * 4 * 2);
    const row1 = n * 4;
    this._dirty = true;
    this._lastDrawKey = '';
    for (let i = 0; i < n; i++) _wglWritePoint(px, row1, i, wfData, i);

    const maxTex = Math.min(16384, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
    const canvasPx = Math.max(1, this.canvas.width);
    const target = Math.max(256, Math.min(maxTex, canvasPx * 4));
    let texN = n, texPx = px;
    if (n > target) {
      texN = target;
      texPx = new Uint8Array(texN * 4 * 2);
      const tRow1 = texN * 4;
      const stride = n / texN;
      for (let i = 0; i < texN; i++) {
        const j0 = Math.floor(i * stride);
        const j1 = Math.min(n, Math.max(j0 + 1, Math.floor((i + 1) * stride)));
        _wglPoolRow(texPx, i*4, px, 0, j0, j1, false);
        _wglPoolRow(texPx, tRow1 + i*4, px, row1, j0, j1, true);
      }
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texN, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, texPx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  draw(pos, mode, sharpness = 0, theme = 0) {
    if (!this._wfTex) return;
    if (!this.gl.isProgram(this._prog)) { this._prog = null; this._wfTex = null; return; }
    const gl = this.gl;
    const cv = gl.canvas;
    const drawKey = `${cv.width}x${cv.height}|${pos}|${mode}|${sharpness}|${theme}`;
    if (!this._dirty && this._lastDrawKey === drawKey) return;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.useProgram(this._prog);
    gl.bindVertexArray(this._vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.uniform1i(this._locs.wf,   0);
    gl.uniform1f(this._locs.pos,  pos);
    gl.uniform2f(this._locs.res,  cv.width, cv.height);
    gl.uniform1i(this._locs.mode, mode | 0);
    gl.uniform1i(this._locs.theme, theme | 0);
    gl.uniform1f(this._locs.sharpness, Math.max(0, Math.min(1, sharpness || 0)));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._dirty = false;
    this._lastDrawKey = drawKey;
  }

  resize(w, h) { const cv = this.gl.canvas; cv.width = w; cv.height = h; this._dirty = true; this._lastDrawKey = ''; }

  destroy() {
    const gl = this.gl;
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    if (this._prog)  gl.deleteProgram(this._prog);
    if (this._vao)   gl.deleteVertexArray(this._vao);
    // loseContext() 금지: 캔버스 재사용 시 컨텍스트가 소실된 채로 남아
    // getContext('webgl2')가 소실 컨텍스트를 반환 → createShader()=null 오류
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
      if (!s) throw new Error('createShader null — context lost=' + gl.isContextLost());
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
// Stacked 3-band symmetric solid fill (rekordbox style):
//   row0 RGBA are temporally smoothed band-energy envelopes.
//   row1 RG keeps the full signed contour for subtle oscilloscope edge detail.
const _WGL_ZOOM_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wf;
uniform float u_posMs;
uniform float u_zoomMs;
uniform float u_durMs;
uniform vec2  u_res;
uniform float u_centerX;
uniform int   u_mode;         // legacy, unused
uniform int   uTheme;         // 0=3 Band, 1=RGB
uniform float uSharpness;     // legacy, unused
out vec4 fragColor;

const vec4 BG    = vec4(0.035, 0.040, 0.055, 1.0);
const vec3 C_LOW = vec3(0.000, 0.333, 0.886);  // #0055e2
const vec3 C_MID = vec3(0.710, 0.431, 0.157);  // #b56e28
const vec3 C_HI  = vec3(1.000, 1.000, 1.000);  // #ffffff
const vec3 C_AIR = vec3(1.000, 0.965, 0.878);  // #fff6e0

float dec(float u) { return u * 2.0 - 1.003922; } // (u - 128/255) * 2

float symMask(float y, float h, float aa) {
  float H = max(h, 0.0);
  float lower = smoothstep(-H - aa, -H + aa, y);
  float upper = 1.0 - smoothstep(H - aa, H + aa, y);
  return lower * upper;
}

float signedMask(float y, float mn, float mx, float aa) {
  float lo = min(mn, mx);
  float hi = max(mn, mx);
  float lower = smoothstep(lo - aa, lo + aa, y);
  float upper = 1.0 - smoothstep(hi - aa, hi + aa, y);
  return lower * upper;
}

float scaledSignedMask(float y, float mn, float mx, float scale, float aa) {
  float c = (mn + mx) * 0.5;
  float lo = mix(c, mn, clamp(scale, 0.0, 1.0));
  float hi = mix(c, mx, clamp(scale, 0.0, 1.0));
  return signedMask(y, lo, hi, aa);
}

vec3 layer(vec3 base, vec3 color, float mask, float alpha) {
  return mix(base, color, clamp(mask * alpha, 0.0, 1.0));
}

vec3 rgbTraceColor(vec4 e) {
  float low = max(e.r, 0.0);
  float mid = max(e.g, 0.0);
  float high = max(e.b + e.a * 0.55, 0.0);
  float sum = low + mid + high;
  if (sum <= 0.0001) return C_MID;
  low /= sum;
  mid /= sum;
  high /= sum;
  return C_LOW * low + C_MID * mid + C_HI * high;
}

// Catmull-Rom cubic spline (uniform, 4 control points; passes through p1 at t=0, p2 at t=1)
vec4 cr4(vec4 p0, vec4 p1, vec4 p2, vec4 p3, float t) {
  float t2 = t*t, t3 = t2*t;
  return 0.5 * ((2.0*p1)
              + (-p0 + p2) * t
              + (2.0*p0 - 5.0*p1 + 4.0*p2 - p3) * t2
              + (-p0 + 3.0*p1 - 3.0*p2 + p3) * t3);
}

void main() {
  float W = u_res.x, H = u_res.y, midY = H * 0.5;
  float cX = u_centerX * W;
  float pxMs = u_posMs + (gl_FragCoord.x - cX) * (u_zoomMs / W);
  if (pxMs < 0.0 || pxMs > u_durMs) { fragColor = BG; return; }

  float tU = clamp(pxMs / u_durMs, 0.0, 1.0);
  int sx = textureSize(u_wf, 0).x;
  float fx = tU * float(sx) - 0.5;
  int ix  = clamp(int(floor(fx)), 0, sx - 1);
  float ft = clamp(fx - float(ix), 0.0, 1.0);
  int im  = clamp(ix - 1, 0, sx - 1);
  int ip  = clamp(ix + 1, 0, sx - 1);
  int iq  = clamp(ix + 2, 0, sx - 1);
  vec4 a0 = texelFetch(u_wf, ivec2(im, 0), 0);
  vec4 a1 = texelFetch(u_wf, ivec2(ix, 0), 0);
  vec4 a2 = texelFetch(u_wf, ivec2(ip, 0), 0);
  vec4 a3 = texelFetch(u_wf, ivec2(iq, 0), 0);
  vec4 b0 = texelFetch(u_wf, ivec2(im, 1), 0);
  vec4 b1 = texelFetch(u_wf, ivec2(ix, 1), 0);
  vec4 b2 = texelFetch(u_wf, ivec2(ip, 1), 0);
  vec4 b3 = texelFetch(u_wf, ivec2(iq, 1), 0);
  vec4 a = mix(a1, clamp(cr4(a0, a1, a2, a3, ft), 0.0, 1.0), 0.35);
  vec4 b = mix(b1, clamp(cr4(b0, b1, b2, b3, ft), 0.0, 1.0), 0.35);

  // Detail zoom — 상/하 여백 확보 (핫큐 라벨, 메모리큐 삼각형 공간).
  // 0.94 → 0.80 으로 축소: 위 10%, 아래 10% 마진 확보.
  float sLow = midY * 0.80;
  float sMid = midY * 0.64;
  float sHi  = midY * 0.34;
  float sAir = midY * 0.19;
  float yRel = gl_FragCoord.y - midY;
  const float AA = 0.55;

  float loEnv = a.r;
  float miEnv = a.g;
  float hiEnv = a.b;
  float airEnv = a.a;
  float loT = loEnv * sLow;
  float miT = miEnv * sMid;
  float hiT = hiEnv * sHi;
  float airT = airEnv * sAir;
  float fullMn = dec(b.r) * sLow;
  float fullMx = dec(b.g) * sLow;

  float mShape = signedMask(yRel, fullMn, fullMx, AA);
  float mLow = mShape;
  float mMid = scaledSignedMask(yRel, fullMn, fullMx, 0.26 + miEnv * 0.54, AA);
  float mHi  = scaledSignedMask(yRel, fullMn, fullMx, 0.16 + hiEnv * 0.42, AA);
  float mAir = scaledSignedMask(yRel, fullMn, fullMx, 0.12 + airEnv * 0.28, AA);

  if (uTheme == 1) {
    float rgbMn = mix(dec(b1.r), dec(b.r), 0.28) * sLow;
    float rgbMx = mix(dec(b1.g), dec(b.g), 0.28) * sLow;
    float mPulse = signedMask(yRel, rgbMn, rgbMx, 0.38);
    if (mPulse < 0.01) { fragColor = BG; return; }
    vec3 pulseCol = rgbTraceColor(mix(a1, a, 0.18));
    pulseCol *= mix(0.72, 1.18, clamp(max(max(a1.r, a1.g), max(a1.b, a1.a)), 0.0, 1.0));
    fragColor = vec4(mix(BG.rgb, clamp(pulseCol, 0.0, 1.0), mPulse), 1.0);
    return;
  }

  vec3 col = BG.rgb;
  col = layer(col, C_LOW, mLow, 0.98);
  col = layer(col, C_MID, mMid, 0.96);
  col = layer(col, C_HI,  mHi, 0.82);
  col = layer(col, C_AIR, mAir, 0.56);
  float alpha = max(max(mLow, mMid), max(mHi, mAir));

  if (alpha < 0.01) { fragColor = BG; return; }
  fragColor = vec4(col, 1.0);
}
`;

// ─── Overview waveform fragment shader ──────────────────────────────────────
// Same stacked 3-band algorithm as zoom, plus playhead line and played-section dim.
const _WGL_OV_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wf;
uniform float u_pos;
uniform vec2  u_res;
uniform int   u_mode;
uniform int   uTheme;
uniform float uSharpness;
out vec4 fragColor;

const vec4 BG        = vec4(0.035, 0.040, 0.055, 1.0);
const vec4 BG_PLAYED = vec4(0.050, 0.055, 0.075, 1.0);
const vec3 C_LOW = vec3(0.000, 0.333, 0.886);
const vec3 C_MID = vec3(0.710, 0.431, 0.157);
const vec3 C_HI  = vec3(1.000, 1.000, 1.000);
const vec3 C_AIR = vec3(1.000, 0.965, 0.878);

float dec(float u) { return u * 2.0 - 1.003922; }

float symMask(float y, float h, float aa) {
  float H = max(h, 0.0);
  float lower = smoothstep(-H - aa, -H + aa, y);
  float upper = 1.0 - smoothstep(H - aa, H + aa, y);
  return lower * upper;
}

float signedMask(float y, float mn, float mx, float aa) {
  float lo = min(mn, mx);
  float hi = max(mn, mx);
  float lower = smoothstep(lo - aa, lo + aa, y);
  float upper = 1.0 - smoothstep(hi - aa, hi + aa, y);
  return lower * upper;
}

float scaledSignedMask(float y, float mn, float mx, float scale, float aa) {
  float c = (mn + mx) * 0.5;
  float lo = mix(c, mn, clamp(scale, 0.0, 1.0));
  float hi = mix(c, mx, clamp(scale, 0.0, 1.0));
  return signedMask(y, lo, hi, aa);
}

vec3 layer(vec3 base, vec3 color, float mask, float alpha) {
  return mix(base, color, clamp(mask * alpha, 0.0, 1.0));
}

vec3 rgbTraceColor(vec4 e) {
  float low = max(e.r, 0.0);
  float mid = max(e.g, 0.0);
  float high = max(e.b + e.a * 0.55, 0.0);
  float sum = low + mid + high;
  if (sum <= 0.0001) return C_MID;
  low /= sum;
  mid /= sum;
  high /= sum;
  return C_LOW * low + C_MID * mid + C_HI * high;
}

vec4 cr4(vec4 p0, vec4 p1, vec4 p2, vec4 p3, float t) {
  float t2 = t*t, t3 = t2*t;
  return 0.5 * ((2.0*p1)
              + (-p0 + p2) * t
              + (2.0*p0 - 5.0*p1 + 4.0*p2 - p3) * t2
              + (-p0 + 3.0*p1 - 3.0*p2 + p3) * t3);
}

void main() {
  float W = u_res.x, H = u_res.y;
  // CDJ-3000 스타일: 상단 15% = hot cue 라벨, 하단 25% = memory cue 마커, 중앙 60% = 대칭 파형.
  // WebGL gl_FragCoord.y 는 bottom=0 → top=H. midY 를 bottom 기준 55% 에 두어 위 마진(15%) 작고 아래 마진(25%) 큼.
  float midY = H * 0.55;
  float t = gl_FragCoord.x / W;

  float curX = u_pos * W;
  if (abs(gl_FragCoord.x - curX) < 0.8) {
    fragColor = vec4(1.0); return;
  }

  int sx = textureSize(u_wf, 0).x;
  float fx = t * float(sx) - 0.5;
  int ix  = clamp(int(floor(fx)), 0, sx - 1);
  float ft = clamp(fx - float(ix), 0.0, 1.0);
  int im  = clamp(ix - 1, 0, sx - 1);
  int ip  = clamp(ix + 1, 0, sx - 1);
  int iq  = clamp(ix + 2, 0, sx - 1);
  vec4 a0 = texelFetch(u_wf, ivec2(im, 0), 0);
  vec4 a1 = texelFetch(u_wf, ivec2(ix, 0), 0);
  vec4 a2 = texelFetch(u_wf, ivec2(ip, 0), 0);
  vec4 a3 = texelFetch(u_wf, ivec2(iq, 0), 0);
  vec4 b0 = texelFetch(u_wf, ivec2(im, 1), 0);
  vec4 b1 = texelFetch(u_wf, ivec2(ix, 1), 0);
  vec4 b2 = texelFetch(u_wf, ivec2(ip, 1), 0);
  vec4 b3 = texelFetch(u_wf, ivec2(iq, 1), 0);
  vec4 a = mix(a1, clamp(cr4(a0, a1, a2, a3, ft), 0.0, 1.0), 0.35);
  vec4 b = mix(b1, clamp(cr4(b0, b1, b2, b3, ft), 0.0, 1.0), 0.35);

  // 피크 스케일 — 대칭이지만 midY 를 살짝 아래로 두고 상단 마진 확보.
  float sLow = H * 0.30;
  float sMid = H * 0.23;
  float sHi  = H * 0.12;
  float sAir = H * 0.07;
  float yRel = gl_FragCoord.y - midY;
  bool played = t < u_pos;
  const float AA = 0.55;

  float loEnv = a.r;
  float miEnv = a.g;
  float hiEnv = a.b;
  float airEnv = a.a;
  // 대칭 파형 — midY 중심 상하로. 스케일은 H 기준.
  float fullMn = dec(b.r) * sLow;
  float fullMx = dec(b.g) * sLow;
  float mShape = signedMask(yRel, fullMn, fullMx, AA);
  float mLow = mShape;
  float mMid = scaledSignedMask(yRel, fullMn, fullMx, 0.26 + miEnv * 0.54, AA);
  float mHi  = scaledSignedMask(yRel, fullMn, fullMx, 0.16 + hiEnv * 0.42, AA);
  float mAir = scaledSignedMask(yRel, fullMn, fullMx, 0.12 + airEnv * 0.28, AA);

  if (uTheme == 1) {
    vec3 base = (played ? BG_PLAYED : BG).rgb;
    vec3 pulseCol = rgbTraceColor(mix(a1, a, 0.18));
    pulseCol *= mix(0.74, 1.14, clamp(max(max(a1.r, a1.g), max(a1.b, a1.a)), 0.0, 1.0));
    vec3 col = mix(base, clamp(pulseCol, 0.0, 1.0), mLow);
    if (played) col *= 0.55;
    fragColor = vec4(col, 1.0);
    return;
  }

  vec3 col = (played ? BG_PLAYED : BG).rgb;
  col = layer(col, C_LOW, mLow, 0.98);
  col = layer(col, C_MID, mMid, 0.96);
  col = layer(col, C_HI,  mHi, 0.82);
  col = layer(col, C_AIR, mAir, 0.56);

  if (played) col *= 0.55;
  fragColor = vec4(col, 1.0);
}
`;
