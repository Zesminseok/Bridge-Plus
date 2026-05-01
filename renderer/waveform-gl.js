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
  const gate = h > 0.0001 ? 1 : 0;
  px[dst]     = encU(lo * gate);
  px[dst + 1] = encU(mi * gate);
  px[dst + 2] = encU(hi * gate);
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
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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

  resize(w, h) { const cv = this.gl.canvas; cv.width = w; cv.height = h; this._dirty = true; this._lastDrawKey = ''; this._stripDirty = true; this._stripDrawKey = ''; }

  // ─── Strip 모드 (사전 렌더 비트맵 + GPU 패닝) ───
  // setStrip 호출 시 비트맵 텍스처 보관 + drawStrip 사용 가능. 기존 setData/draw 와 병존.
  // image: HTMLCanvasElement | OffscreenCanvas | ImageBitmap (RGBA premul-mask).
  // durMs: 비트맵 전체가 표현하는 트랙 지속시간.
  // key:   재업로드 skip 키 (동일 데이터면 GPU 업로드 절약).
  setStrip(image, durMs, key, partialFrac = 1.0) {
    const gl = this.gl;
    if (!image) return;
    if (!this._stripProg || !gl.isProgram(this._stripProg)) {
      try { this._initStripPipeline(); } catch (e) { console.warn('[WGL] strip init failed:', e.message); return; }
    }
    const frac = (partialFrac > 0 && partialFrac < 1) ? partialFrac : 1.0;
    if (key && this._stripKey === key && this._stripTex) {
      this._stripDurMs = durMs || 1;
      this._stripPartialFrac = frac;
      this._stripDirty = true;
      return;
    }
    if (this._stripTex) gl.deleteTexture(this._stripTex);
    this._stripTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._stripTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._stripDurMs = durMs || 1;
    this._stripPartialFrac = frac;
    this._stripKey = key || '';
    this._stripDirty = true;
    this._stripDrawKey = '';
  }

  hasStrip() { return !!this._stripTex; }

  clearStrip() {
    if (this._stripTex) { try { this.gl.deleteTexture(this._stripTex); } catch (_) {} this._stripTex = null; }
    this._stripKey = '';
    this._stripDirty = true;
  }

  drawStrip(posMs, zoomMs, centerX) {
    if (!this._stripTex) return;
    if (!this.gl.isProgram(this._stripProg)) { this._stripProg = null; this._stripTex = null; return; }
    const gl = this.gl;
    const cv = gl.canvas;
    const partialFrac = this._stripPartialFrac || 1.0;
    const drawKey = `${cv.width}x${cv.height}|${posMs}|${zoomMs}|${centerX}|${this._stripDurMs}|${partialFrac}`;
    if (!this._stripDirty && this._stripDrawKey === drawKey) return;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.useProgram(this._stripProg);
    gl.bindVertexArray(this._stripVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._stripTex);
    gl.uniform1i(this._stripLocs.tex, 0);
    gl.uniform1f(this._stripLocs.posMs,   posMs);
    gl.uniform1f(this._stripLocs.zoomMs,  zoomMs);
    gl.uniform1f(this._stripLocs.durMs,   this._stripDurMs);
    gl.uniform2f(this._stripLocs.res,     cv.width, cv.height);
    gl.uniform1f(this._stripLocs.centerX, centerX);
    if (this._stripLocs.partialFrac) gl.uniform1f(this._stripLocs.partialFrac, partialFrac);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._stripDirty = false;
    this._stripDrawKey = drawKey;
  }

  _initStripPipeline() {
    const gl = this.gl;
    this._stripProg = this._compileProgram(_WGL_VS, _WGL_STRIP_DETAIL_FS);
    this._stripVao = gl.createVertexArray();
    gl.bindVertexArray(this._stripVao);
    // VBO 핸들 보관 — context recovery 시 destroy 에서 deleteBuffer 안 하면 GPU 메모리 누수.
    if (this._stripVbo) gl.deleteBuffer(this._stripVbo);
    this._stripVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._stripVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this._stripProg, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this._stripLocs = {
      tex:     gl.getUniformLocation(this._stripProg, 'u_strip'),
      posMs:   gl.getUniformLocation(this._stripProg, 'u_posMs'),
      zoomMs:  gl.getUniformLocation(this._stripProg, 'u_zoomMs'),
      durMs:   gl.getUniformLocation(this._stripProg, 'u_durMs'),
      res:     gl.getUniformLocation(this._stripProg, 'u_res'),
      centerX: gl.getUniformLocation(this._stripProg, 'u_centerX'),
      partialFrac: gl.getUniformLocation(this._stripProg, 'u_partialFrac'),
    };
  }

  destroy() {
    const gl = this.gl;
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    if (this._stripTex) gl.deleteTexture(this._stripTex);
    if (this._prog)  gl.deleteProgram(this._prog);
    if (this._stripProg) gl.deleteProgram(this._stripProg);
    if (this._vao)   gl.deleteVertexArray(this._vao);
    if (this._stripVao) gl.deleteVertexArray(this._stripVao);
    if (this._vbo)   gl.deleteBuffer(this._vbo);
    if (this._stripVbo) gl.deleteBuffer(this._stripVbo);
    this._vbo = null; this._stripVbo = null;
    // loseContext() 금지: 캔버스 재사용 시 컨텍스트가 소실된 채로 남아
    // getContext('webgl2')가 소실 컨텍스트를 반환 → createShader()=null 오류
  }

  _initGeometry() {
    const gl = this.gl;
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    if (this._vbo) gl.deleteBuffer(this._vbo);
    this._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
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
      gridBand: gl.getUniformLocation(this._prog, 'uGridBand'),
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
          gridBand: gl.getUniformLocation(this._prog, 'uGridBand'),
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  draw(pos, mode, sharpness = 0, theme = 0, gridBand = 0.24) {
    if (!this._wfTex) return;
    if (!this.gl.isProgram(this._prog)) { this._prog = null; this._wfTex = null; return; }
    const gl = this.gl;
    const cv = gl.canvas;
    const gb = Math.max(0, Math.min(0.4, gridBand || 0));
    const drawKey = `${cv.width}x${cv.height}|${pos}|${mode}|${sharpness}|${theme}|${gb}`;
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
    if (this._locs.gridBand) gl.uniform1f(this._locs.gridBand, gb);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._dirty = false;
    this._lastDrawKey = drawKey;
  }

  resize(w, h) { const cv = this.gl.canvas; cv.width = w; cv.height = h; this._dirty = true; this._lastDrawKey = ''; this._stripDirty = true; this._stripDrawKey = ''; }

  // ─── Strip 모드 (overview) ───
  // setStrip(image[, partialFrac][, key]) — 풀-트랙 비트맵 업로드. drawStrip(pos) 로 렌더.
  // partialFrac: 0~1, 비트맵이 트랙 전체 길이의 어느 비율을 표현하는지 (1=풀, 0.5=반만 분석된 1pass).
  //              partialFrac < 1 이면 캔버스 0..partialFrac 영역만 strip 으로 채우고 나머지는 BG.
  setStrip(image, partialFrac, key) {
    const gl = this.gl;
    if (!image) return;
    if (!this._stripProg || !gl.isProgram(this._stripProg)) {
      try { this._initStripPipeline(); } catch (e) { console.warn('[OV] strip init failed:', e.message); return; }
    }
    this._stripPartialFrac = (partialFrac > 0 && partialFrac < 1) ? partialFrac : 1.0;
    if (key && this._stripKey === key && this._stripTex) {
      this._stripDirty = true; // partialFrac 만 갱신될 수도 있어 dirty
      return;
    }
    if (this._stripTex) gl.deleteTexture(this._stripTex);
    this._stripTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._stripTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._stripKey = key || '';
    this._stripDirty = true;
    this._stripDrawKey = '';
  }

  hasStrip() { return !!this._stripTex; }

  clearStrip() {
    if (this._stripTex) { try { this.gl.deleteTexture(this._stripTex); } catch (_) {} this._stripTex = null; }
    this._stripKey = '';
    this._stripDirty = true;
  }

  drawStrip(pos, gridBand = 0.24) {
    if (!this._stripTex) return;
    if (!this.gl.isProgram(this._stripProg)) { this._stripProg = null; this._stripTex = null; return; }
    const gl = this.gl;
    const cv = gl.canvas;
    const partialFrac = this._stripPartialFrac || 1.0;
    const gb = Math.max(0, Math.min(0.4, gridBand || 0));
    const drawKey = `${cv.width}x${cv.height}|${pos}|${partialFrac}|${gb}`;
    if (!this._stripDirty && this._stripDrawKey === drawKey) return;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.useProgram(this._stripProg);
    gl.bindVertexArray(this._stripVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._stripTex);
    gl.uniform1i(this._stripLocs.tex, 0);
    gl.uniform1f(this._stripLocs.pos, pos);
    gl.uniform2f(this._stripLocs.res, cv.width, cv.height);
    if (this._stripLocs.partialFrac) gl.uniform1f(this._stripLocs.partialFrac, partialFrac);
    if (this._stripLocs.gridBand) gl.uniform1f(this._stripLocs.gridBand, gb);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._stripDirty = false;
    this._stripDrawKey = drawKey;
  }

  _initStripPipeline() {
    const gl = this.gl;
    this._stripProg = this._compileProgram(_WGL_VS, _WGL_STRIP_OV_FS);
    this._stripVao = gl.createVertexArray();
    gl.bindVertexArray(this._stripVao);
    if (this._stripVbo) gl.deleteBuffer(this._stripVbo);
    this._stripVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._stripVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this._stripProg, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this._stripLocs = {
      tex: gl.getUniformLocation(this._stripProg, 'u_strip'),
      pos: gl.getUniformLocation(this._stripProg, 'u_pos'),
      res: gl.getUniformLocation(this._stripProg, 'u_res'),
      partialFrac: gl.getUniformLocation(this._stripProg, 'u_partialFrac'),
      gridBand: gl.getUniformLocation(this._stripProg, 'uGridBand'),
    };
  }

  destroy() {
    const gl = this.gl;
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    if (this._stripTex) gl.deleteTexture(this._stripTex);
    if (this._prog)  gl.deleteProgram(this._prog);
    if (this._stripProg) gl.deleteProgram(this._stripProg);
    if (this._vao)   gl.deleteVertexArray(this._vao);
    if (this._stripVao) gl.deleteVertexArray(this._stripVao);
    if (this._vbo)   gl.deleteBuffer(this._vbo);
    if (this._stripVbo) gl.deleteBuffer(this._stripVbo);
    this._vbo = null; this._stripVbo = null;
    // loseContext() 금지: 캔버스 재사용 시 컨텍스트가 소실된 채로 남아
    // getContext('webgl2')가 소실 컨텍스트를 반환 → createShader()=null 오류
  }

  _initGeometry() {
    const gl = this.gl;
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    if (this._vbo) gl.deleteBuffer(this._vbo);
    this._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
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
// 3band: 대칭 stacked envelope (rekordbox 스타일 부드러운 blob).
// RGB:   pow-boost dominance + saturation push → 다양한 hue.
// Mono:  내부 톤 gradation (dark amber → bright yellow) + mid/hi highlight.
const _WGL_ZOOM_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wf;
uniform float u_posMs;
uniform float u_zoomMs;
uniform float u_durMs;
uniform vec2  u_res;
uniform float u_centerX;
uniform int   u_mode;
uniform int   uTheme;         // 0=3 Band, 1=RGB, 2=Mono
uniform float uSharpness;
out vec4 fragColor;

const vec4 BG    = vec4(0.035, 0.040, 0.055, 1.0);
// 3band 팔레트 — rekordbox 스타일 (blue body + warm orange/brown shoulder + cream core + white highlight).
const vec3 C_LOW = vec3(0.137, 0.392, 0.941);  // BLUE — bass
const vec3 C_MID = vec3(0.706, 0.373, 0.098);  // BROWN — mid
const vec3 C_HI  = vec3(1.000, 0.651, 0.008);  // ORANGE — hi
const vec3 C_AIR = vec3(0.961, 0.922, 0.824);  // cream WHITE — air
// RGB 팔레트 — rekordbox CDJ 매핑 (저음=빨강 → 고음=파랑).
// dwd.wav frequency sweep 으로 검증: 20Hz=빨강, 500Hz=노랑/그린, 5kHz=시안, 16kHz=파랑.
const vec3 R_LOW = vec3(1.000, 0.180, 0.100);  // 빨강 (bass)
const vec3 R_MID = vec3(0.300, 0.960, 0.250);  // 그린 (mid)
const vec3 R_HI  = vec3(0.080, 0.820, 0.980);  // 시안 (treble)
const vec3 R_AIR = vec3(0.080, 0.260, 1.000);  // 파랑 (air)

float dec(float u) { return u * 2.0 - 1.003922; }

float symMask(float y, float h, float aa) {
  float H = max(h, 0.0);
  if (H <= 0.0001) return 0.0;
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

vec3 layer(vec3 base, vec3 color, float mask, float alpha) {
  return mix(base, color, clamp(mask * alpha, 0.0, 1.0));
}

// RGB — Spectral Centroid 1D Gradient. waveform-color.js rgbTraceColor 와 정확 동치.
// rekordbox 스타일 5-stop: RED → ORANGE → GREEN → CYAN-BLUE → BLUE.
vec3 rgbTraceColor(vec4 e) {
  // RGB tuner 도출 — R=lo+mi tint, G=mi+hi/ai bleed, B=mi+hi+ai. SAT 1.3 + max-normalize → 밝기 일관.
  float _lo = max(e.r, 0.0), _mi = max(e.g, 0.0), _hi = max(e.b, 0.0), _ai = max(e.a, 0.0);
  float r = _lo * 3.00 + _mi * 0.10;
  float g = _mi * 1.85 + _hi * 0.45 + _ai * 0.55;
  float b = _mi * 0.45 + _hi * 1.60 + _ai * 3.00;
  float avg = (r + g + b) / 3.0;
  const float SAT = 1.30;
  r = avg + (r - avg) * SAT;
  g = avg + (g - avg) * SAT;
  b = avg + (b - avg) * SAT;
  r = max(r, 0.0); g = max(g, 0.0); b = max(b, 0.0);
  float maxC = max(r, max(g, b));
  if (maxC > 0.001) { r /= maxC; g /= maxC; b /= maxC; }
  else { r = 0.0; g = 0.0; b = 0.0; }
  return vec3(r, g, b);
}

// Mono 톤 — 4-band tonal point 가중평균. waveform-color.js monoColor 와 동치.
vec3 monoTraceColor(vec4 e) {
  // 흰색 더 많이: hi/air 가중치 boost.
  float wLo = max(e.r, 0.0) * 0.95;
  float wMi = max(e.g, 0.0) * 0.95;
  float wHi = max(e.b, 0.0) * 1.20;
  float wAi = max(e.a, 0.0) * 1.45;
  float maxW = max(max(wLo, wMi), max(wHi, wAi));
  if (maxW < 0.001) return vec3(0.5, 0.4, 0.3);
  float pLo = pow(wLo / maxW, 1.5);
  float pMi = pow(wMi / maxW, 1.5);
  float pHi = pow(wHi / maxW, 1.5);
  float pAi = pow(wAi / maxW, 1.5);
  float sum = pLo + pMi + pHi + pAi;
  // 명확한 band 구분 + 흰색 더 많이: hi 베이지 → 밝은 베이지.
  vec3 M_LOW = vec3(0.620, 0.220, 0.030);
  vec3 M_MID = vec3(1.000, 0.620, 0.180);
  vec3 M_HI  = vec3(1.000, 0.940, 0.780);
  vec3 M_AIR = vec3(1.000, 1.000, 1.000);
  return (M_LOW*pLo + M_MID*pMi + M_HI*pHi + M_AIR*pAi) / sum;
}

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
  // 픽셀 snap — 정지 상태 frame 간 sub-pixel jitter 제거 (strip 셰이더와 동일 정책).
  float msPerPx = u_zoomMs / W;
  float posMsSnap = floor(u_posMs / msPerPx + 0.5) * msPerPx;
  float pxMs = posMsSnap + (gl_FragCoord.x - cX) * msPerPx;
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
  // 풀 Catmull-Rom 보간 — texel 경계에서 step 점프 제거 (지글거림 fix).
  // 이전 mix(a1, cr4, 0.45) 는 55% nearest-neighbor 가 남아서 fast scroll 시 envelope 높이가 stair-step.
  vec4 a = clamp(cr4(a0, a1, a2, a3, ft), 0.0, 1.0);
  vec4 b = clamp(cr4(b0, b1, b2, b3, ft), 0.0, 1.0);

  // Detail zoom — rekordbox 처럼 꽉차게 채우되 비트그리드(9px) + 핫큐 chip(14px) 영역 보호.
  // 6% 마진 (0.94) — rekordbox 처럼 envelope 크게.
  float sLow = midY * 0.94;
  float yRel = gl_FragCoord.y - midY;
  const float AA = 0.7;

  float loEnv  = a.r;
  float miEnv  = a.g;
  float hiEnv  = a.b;
  float airEnv = a.a;
  if (u_mode == 4) {
    float hAll = airEnv * sLow;
    if (hAll < 0.001) { fragColor = BG; return; }
    float mHw = symMask(yRel, hAll, AA);
    if (mHw < 0.01) { fragColor = BG; return; }
    vec3 hwCol = clamp(vec3(loEnv, miEnv, hiEnv), 0.0, 1.0);
    fragColor = vec4(mix(BG.rgb, hwCol, mHw), 1.0);
    return;
  }
  // 4-band stack — 그리는 순서: BLUE (outermost) → ORANGE → BROWN → WHITE (innermost top).
  float hLow = clamp(loEnv,  0.0, 1.0) * sLow * 0.95;
  float hMid = clamp(miEnv,  0.0, 1.0) * sLow * 0.85;
  float hHi  = clamp(hiEnv,  0.0, 1.0) * sLow * 0.90;
  float hAir = clamp(airEnv, 0.0, 1.0) * sLow * 1.40;
  hLow = min(hLow, sLow);
  hMid = min(hMid, sLow);
  hHi  = min(hHi,  sLow);
  hAir = min(hAir, sLow);
  // RGB/Mono 모드용: mono envelope (bass 우세, hi/air 기여 적음)
  float peakBand = max(max(loEnv, miEnv * 0.90), max(hiEnv * 0.55, airEnv * 0.32));
  if (peakBand < 0.001) { fragColor = BG; return; }

  float mLow = symMask(yRel, hLow, AA);
  float mMid = symMask(yRel, hMid, AA);
  float mHi  = symMask(yRel, hHi,  AA);
  float mAir = symMask(yRel, hAir, AA);

  if (uTheme == 1) {
    // RGB — rekordbox 풍 vivid hue spectrum, RMS envelope.
    float mPulse = symMask(yRel, peakBand * sLow, AA);
    if (mPulse < 0.01) { fragColor = BG; return; }
    vec3 pulseCol = rgbTraceColor(a);
    float energy = clamp(peakBand, 0.0, 1.0);
    pulseCol *= mix(0.62, 1.22, energy);
    // 중심선 약간 밝게 (rekordbox 처럼 transient highlight)
    float yCore = 1.0 - clamp(abs(yRel) / max(hLow, 1.0), 0.0, 1.0);
    pulseCol += vec3(0.18, 0.18, 0.20) * pow(yCore, 3.0) * energy;
    fragColor = vec4(mix(BG.rgb, clamp(pulseCol, 0.0, 1.0), mPulse), 1.0);
    return;
  }

  if (uTheme == 2) {
    // Mono — rekordbox 풍 4-band tonal map (진한 오렌지 → 호박 → 베이지 → 따뜻한 흰).
    float mMono = symMask(yRel, peakBand * sLow, AA);
    if (mMono < 0.01) { fragColor = BG; return; }
    vec3 monoCol = monoTraceColor(a);
    monoCol *= mix(0.65, 1.10, clamp(peakBand, 0.0, 1.0));
    fragColor = vec4(mix(BG.rgb, clamp(monoCol, 0.0, 1.2), mMono), 1.0);
    return;
  }

  // 4-band stack — BLUE (outer) → ORANGE → BROWN → WHITE (innermost top).
  vec3 col = BG.rgb;
  col = layer(col, C_LOW, mLow, 0.97);
  col = layer(col, C_HI,  mHi,  0.95);
  col = layer(col, C_MID, mMid, 0.94);
  col = layer(col, C_AIR, mAir, 0.96);
  float alpha = max(max(mLow, mMid), max(mHi, mAir));

  if (alpha < 0.01) { fragColor = BG; return; }
  fragColor = vec4(col, 1.0);
}
`;

// ─── Overview waveform fragment shader ──────────────────────────────────────
// Detail (zoom) 과 동일 팔레트 — 색 일관성 유지 + 반파 stacked envelope.
const _WGL_OV_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wf;
uniform float u_pos;
uniform vec2  u_res;
uniform int   u_mode;
uniform int   uTheme;
uniform float uSharpness;
uniform float uGridBand;
out vec4 fragColor;

const vec4 BG        = vec4(0.020, 0.025, 0.035, 1.0);
const vec4 BG_PLAYED = vec4(0.030, 0.035, 0.050, 1.0);
// detail 셰이더와 정확히 동일 팔레트.
const vec3 C_LOW = vec3(0.137, 0.392, 0.941);  // BLUE — bass
const vec3 C_MID = vec3(0.706, 0.373, 0.098);  // BROWN — mid
const vec3 C_HI  = vec3(1.000, 0.651, 0.008);  // ORANGE — hi
const vec3 C_AIR = vec3(0.961, 0.922, 0.824);  // cream WHITE — air
// (구 OV 전용 7-stop 팔레트는 detail 셰이더 통합으로 제거 — rgbTraceColor 가 inline 함수에 동일 R_LO/MI/HI/AI 사용)

float dec(float u) { return u * 2.0 - 1.003922; }

vec3 layer(vec3 base, vec3 color, float mask, float alpha) {
  return mix(base, color, clamp(mask * alpha, 0.0, 1.0));
}

// Detail 셰이더와 정확 동일한 RGB/Mono 공식 — 색 일관성 유지 (centroid 1D gradient).
// rekordbox 스타일 5-stop: RED → ORANGE → GREEN → CYAN-BLUE → BLUE. yellow/violet 제거.
vec3 rgbTraceColor(vec4 e) {
  // RGB tuner 도출 — R=lo+mi tint, G=mi+hi/ai bleed, B=mi+hi+ai. SAT 1.3 + max-normalize → 밝기 일관.
  float _lo = max(e.r, 0.0), _mi = max(e.g, 0.0), _hi = max(e.b, 0.0), _ai = max(e.a, 0.0);
  float r = _lo * 3.00 + _mi * 0.10;
  float g = _mi * 1.85 + _hi * 0.45 + _ai * 0.55;
  float b = _mi * 0.45 + _hi * 1.60 + _ai * 3.00;
  float avg = (r + g + b) / 3.0;
  const float SAT = 1.30;
  r = avg + (r - avg) * SAT;
  g = avg + (g - avg) * SAT;
  b = avg + (b - avg) * SAT;
  r = max(r, 0.0); g = max(g, 0.0); b = max(b, 0.0);
  float maxC = max(r, max(g, b));
  if (maxC > 0.001) { r /= maxC; g /= maxC; b /= maxC; }
  else { r = 0.0; g = 0.0; b = 0.0; }
  return vec3(r, g, b);
}

vec3 monoTraceColor(vec4 e) {
  // 흰색 더 많이: hi/air 가중치 boost.
  float wLo = max(e.r, 0.0) * 0.95;
  float wMi = max(e.g, 0.0) * 0.95;
  float wHi = max(e.b, 0.0) * 1.20;
  float wAi = max(e.a, 0.0) * 1.45;
  float maxW = max(max(wLo, wMi), max(wHi, wAi));
  if (maxW < 0.001) return vec3(0.5, 0.4, 0.3);
  float pLo = pow(wLo / maxW, 1.5);
  float pMi = pow(wMi / maxW, 1.5);
  float pHi = pow(wHi / maxW, 1.5);
  float pAi = pow(wAi / maxW, 1.5);
  float sum = pLo + pMi + pHi + pAi;
  vec3 M_LO = vec3(0.620, 0.220, 0.030);
  vec3 M_MI = vec3(1.000, 0.620, 0.180);
  vec3 M_HIc= vec3(1.000, 0.940, 0.780);
  vec3 M_AI = vec3(1.000, 1.000, 1.000);
  return (M_LO*pLo + M_MI*pMi + M_HIc*pHi + M_AI*pAi) / sum;
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
  float gridBand = clamp(uGridBand, 0.0, 0.4);
  // Grid on: bottom band reserved for beat ticks. Grid off: waveform uses full height.
  float axisY = H * gridBand;
  float topLimit = H * 0.98;
  float t = gl_FragCoord.x / W;

  float curX = u_pos * W;
  if (abs(gl_FragCoord.x - curX) < 0.8) {
    fragColor = vec4(1.0); return;
  }

  float yG = gl_FragCoord.y;
  if (yG < axisY || yG > topLimit) { fragColor = BG; return; }

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
  // 풀 CR — overview 도 동일하게 sub-texel 보간으로 부드럽게.
  vec4 a = clamp(cr4(a0, a1, a2, a3, ft), 0.0, 1.0);
  vec4 b = clamp(cr4(b0, b1, b2, b3, ft), 0.0, 1.0);

  float waveH = topLimit - axisY;
  float yRel = yG - axisY;
  bool played = t < u_pos;
  const float AA = 0.55;

  float loEnv  = a.r;
  float miEnv  = a.g;
  float hiEnv  = a.b;
  float airEnv = a.a;
  if (u_mode == 4) {
    vec3 base = (played ? BG_PLAYED : BG).rgb;
    float hAll = airEnv * waveH * 0.92;
    if (hAll < 0.001) { fragColor = vec4(base, 1.0); return; }
    float mHw = 1.0 - smoothstep(hAll - AA, hAll + AA, yRel);
    vec3 hwCol = clamp(vec3(loEnv, miEnv, hiEnv), 0.0, 1.0);
    vec3 col = mix(base, hwCol, mHw);
    if (played) col *= 0.6;
    fragColor = vec4(col, 1.0);
    return;
  }
  // 4-band stack — 그리는 순서: BLUE (outermost) → ORANGE → BROWN → WHITE (innermost top).
  float hLow = clamp(loEnv,  0.0, 1.0) * waveH * 0.95;
  float hMid = clamp(miEnv,  0.0, 1.0) * waveH * 0.85;
  float hHi  = clamp(hiEnv,  0.0, 1.0) * waveH * 0.90;
  float hAir = clamp(airEnv, 0.0, 1.0) * waveH * 1.40;
  hLow = min(hLow, waveH);
  hMid = min(hMid, waveH);
  hHi  = min(hHi,  waveH);
  hAir = min(hAir, waveH);
  // mono/RGB 용 — bass+mid 우세
  float peakBand = max(max(loEnv, miEnv * 0.90), max(hiEnv * 0.55, airEnv * 0.32));
  if (peakBand < 0.001) { fragColor = played ? BG_PLAYED : BG; return; }
  float mLow = 1.0 - smoothstep(hLow - AA, hLow + AA, yRel);
  float mMid = 1.0 - smoothstep(hMid - AA, hMid + AA, yRel);
  float mHi  = 1.0 - smoothstep(hHi  - AA, hHi  + AA, yRel);
  float mAir = 1.0 - smoothstep(hAir - AA, hAir + AA, yRel);

  if (uTheme == 1) {
    vec3 base = (played ? BG_PLAYED : BG).rgb;
    vec3 pulseCol = rgbTraceColor(a);
    float energy = clamp(peakBand, 0.0, 1.0);
    pulseCol *= mix(0.62, 1.22, energy);
    float hPulse = peakBand * waveH * 0.92;
    float mPulse = 1.0 - smoothstep(hPulse - AA, hPulse + AA, yRel);
    vec3 col = mix(base, clamp(pulseCol, 0.0, 1.0), mPulse);
    if (played) col *= 0.6;
    fragColor = vec4(col, 1.0);
    return;
  }

  if (uTheme == 2) {
    vec3 base = (played ? BG_PLAYED : BG).rgb;
    vec3 monoCol = monoTraceColor(a);
    monoCol *= mix(0.65, 1.10, clamp(peakBand, 0.0, 1.0));
    float hMono = peakBand * waveH * 0.92;
    float mMono = 1.0 - smoothstep(hMono - AA, hMono + AA, yRel);
    vec3 col = mix(base, clamp(monoCol, 0.0, 1.2), mMono);
    if (played) col *= 0.6;
    fragColor = vec4(col, 1.0);
    return;
  }

  vec3 col = (played ? BG_PLAYED : BG).rgb;
  col = layer(col, C_LOW, mLow, 0.97);
  col = layer(col, C_HI,  mHi,  0.95);
  col = layer(col, C_MID, mMid, 0.94);
  col = layer(col, C_AIR, mAir, 0.96);

  if (played) col *= 0.55;
  fragColor = vec4(col, 1.0);
}
`;

// ─── Strip 셰이더 (detail) ───────────────────────────────────────────────────
// 사전 렌더 비트맵을 텍스처 샘플 + 시간/패닝만 — band/envelope 계산 없음 → 지글거림 0.
// uv.y 는 1:1 (canvas H = bitmap H 매핑). 가로는 LINEAR 필터로 자연 보간.
// 약간의 가로 다중-탭 ([1,2,1]) 셰이더 블러는 비트맵 자체에 이미 적용됨 (waveform-strip.js).
const _WGL_STRIP_DETAIL_FS = `#version 300 es
precision highp float;
uniform sampler2D u_strip;
uniform float u_posMs;
uniform float u_zoomMs;
uniform float u_durMs;
uniform vec2  u_res;
uniform float u_centerX;
uniform float u_partialFrac;
out vec4 fragColor;

const vec3 BG = vec3(0.035, 0.040, 0.055);

void main() {
  float W = u_res.x, H = u_res.y;
  float cX = u_centerX * W;
  // posMs 를 canvas 픽셀 단위로 snap — 정지 상태 frame 간 부동소수점 noise (수정 필요)
  // 미세 sub-texel 위치 변동 → LINEAR 보간 결과 frame 간 미세 차이 → 지글거림.
  // 픽셀 quantize 후 sub-pixel 변동 0 → 같은 데이터면 pixel-perfect 동일 출력.
  float msPerPx = u_zoomMs / W;
  float posMsSnap = floor(u_posMs / msPerPx + 0.5) * msPerPx;
  float pxMs = posMsSnap + (gl_FragCoord.x - cX) * msPerPx;
  if (pxMs < 0.0 || pxMs > u_durMs) { fragColor = vec4(BG, 1.0); return; }
  float frac = u_partialFrac > 0.0 ? u_partialFrac : 1.0;
  float trackU = pxMs / max(u_durMs, 1.0);
  if (trackU > frac) { fragColor = vec4(BG, 1.0); return; }
  float u = clamp(trackU / frac, 0.0, 1.0);
  float v = gl_FragCoord.y / H;
  vec4 s = texture(u_strip, vec2(u, v));
  // strip 의 alpha 는 envelope 마스크 — BG 위에 블렌드 (베이크된 색감 보존).
  fragColor = vec4(mix(BG, s.rgb, s.a), 1.0);
}
`;

// ─── Strip 셰이더 (overview) — 반파 (rekordbox 풍 axis 위 단방향) ──────────────
// 풀-트랙 비트맵의 위쪽 절반(v 0.5..1.0)만 샘플 → 반파 envelope.
// strip 비트맵은 대칭이므로 위/아래 어느 쪽이든 동일.
// u_partialFrac: 비트맵이 트랙 전체 길이의 어느 비율을 표현하는지 (1pass progressive 시 < 1).
//                캔버스 0..partialFrac 만 strip 채우고, 나머지는 BG (분석 미완료 영역 정직하게 표시).
const _WGL_STRIP_OV_FS = `#version 300 es
precision highp float;
uniform sampler2D u_strip;
uniform float u_pos;
uniform vec2  u_res;
uniform float u_partialFrac;
uniform float uGridBand;
out vec4 fragColor;

const vec3 BG        = vec3(0.020, 0.025, 0.035);
const vec3 BG_PLAYED = vec3(0.030, 0.035, 0.050);

void main() {
  float W = u_res.x, H = u_res.y;
  float yG = gl_FragCoord.y;
  // Grid on: bottom band reserved for beat ticks. Grid off: waveform uses full height.
  float gridBand = clamp(uGridBand, 0.0, 0.4);
  float axisY = H * gridBand;
  float topLimit = H * 0.98;

  // Playhead 는 별도 overlay canvas (#wovol) 에서 빨강으로 그림 — shader 흰선 중복 제거.
  if (yG < axisY || yG > topLimit) { fragColor = vec4(BG, 1.0); return; }

  float frac = u_partialFrac > 0.0 ? u_partialFrac : 1.0;
  float canvasU = gl_FragCoord.x / W;
  bool played = canvasU < u_pos;
  vec3 base = played ? BG_PLAYED : BG;

  // 분석이 도달하지 않은 영역(canvasU > frac) — strip 데이터 없음, BG 만.
  if (canvasU > frac) { fragColor = vec4(base, 1.0); return; }

  // 캔버스 0..frac 을 strip 0..1 로 매핑 → partial 데이터가 트랙의 정확한 시간 비율 위치에 표시.
  float u = canvasU / frac;
  // axis 근처 (yG=axisY) → strip mid (v=0.5, envelope 가장 진함).
  // top 끝 (yG=topLimit) → strip 위쪽 끝 (v=1.0, envelope 외곽 fade).
  float v = 0.5 + 0.5 * (yG - axisY) / max(topLimit - axisY, 1.0);
  vec4 s = texture(u_strip, vec2(u, v));
  vec3 col = mix(base, s.rgb, s.a);
  if (played) col *= 0.6;
  fragColor = vec4(col, 1.0);
}
`;
