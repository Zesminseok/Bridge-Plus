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
        };
      } catch(e) { console.warn('[WGL] recover failed:', e.message); return; }
    }
    this._wfLen = n;
    this._wfDurMs = wfDurMs || 1;

    const px = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = wfData[i];
      const h = p.h || Math.max(Math.abs(p.mn||0), Math.abs(p.mx||0)) || 0;
      px[i*4]   = Math.min(255, (p.r || 0) * 255) | 0;
      px[i*4+1] = Math.min(255, (p.g || 0) * 255) | 0;
      px[i*4+2] = Math.min(255, (p.b || 0) * 255) | 0;
      px[i*4+3] = Math.min(255, h * 255) | 0;
    }
    // Cap texture width at GPU MAX_TEXTURE_SIZE — long tracks (>109s at 150pts/s) exceed 16384 limit
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    let texN = n, texPx = px;
    if (n > maxTex) {
      texN = maxTex;
      texPx = new Uint8Array(texN * 4);
      const ratio = (n - 1) / (texN - 1);
      for (let i = 0; i < texN; i++) {
        const fi = i * ratio, i0 = Math.min(n-1, fi|0), i1 = Math.min(n-1, i0+1), t = fi-i0;
        texPx[i*4]   = (px[i0*4]   * (1-t) + px[i1*4]   * t) | 0;
        texPx[i*4+1] = (px[i0*4+1] * (1-t) + px[i1*4+1] * t) | 0;
        texPx[i*4+2] = (px[i0*4+2] * (1-t) + px[i1*4+2] * t) | 0;
        texPx[i*4+3] = (px[i0*4+3] * (1-t) + px[i1*4+3] * t) | 0;
      }
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texN, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texPx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Render waveform. mode: 0=rgb 1=3band 2=blue */
  draw(posMs, zoomMs, centerX, mode) {
    if (!this._wfTex) return;
    // Detect WebGL context reset: canvas.width assignment clears all GPU objects
    // gl.isProgram() returns false for handles invalidated by context reset
    if (!this.gl.isProgram(this._prog)) { this._prog = null; this._wfTex = null; return; }
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
 */
class OverviewGL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this._wfTex = null;
    this._prog = this._compileProgram(_WGL_VS, _WGL_OV_FS);
    this._initGeometry();
    this._locs = {
      wf:   gl.getUniformLocation(this._prog, 'u_wf'),
      pos:  gl.getUniformLocation(this._prog, 'u_pos'),
      res:  gl.getUniformLocation(this._prog, 'u_res'),
      mode: gl.getUniformLocation(this._prog, 'u_mode'),
    };
  }

  setData(wfData) {
    const gl = this.gl;
    const n = wfData.length;
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
        };
      } catch(e) { console.warn('[WGL] ovgl recover failed:', e.message); return; }
    }
    const px = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = wfData[i];
      const h = p.h || Math.max(Math.abs(p.mn||0), Math.abs(p.mx||0)) || 0;
      px[i*4]   = Math.min(255, (p.r || 0) * 255) | 0;
      px[i*4+1] = Math.min(255, (p.g || 0) * 255) | 0;
      px[i*4+2] = Math.min(255, (p.b || 0) * 255) | 0;
      px[i*4+3] = Math.min(255, h * 255) | 0;
    }
    // Cap at GPU MAX_TEXTURE_SIZE
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    let texN = n, texPx = px;
    if (n > maxTex) {
      texN = maxTex;
      texPx = new Uint8Array(texN * 4);
      const ratio = (n - 1) / (texN - 1);
      for (let i = 0; i < texN; i++) {
        const fi = i * ratio, i0 = Math.min(n-1, fi|0), i1 = Math.min(n-1, i0+1), t = fi-i0;
        texPx[i*4]   = (px[i0*4]   * (1-t) + px[i1*4]   * t) | 0;
        texPx[i*4+1] = (px[i0*4+1] * (1-t) + px[i1*4+1] * t) | 0;
        texPx[i*4+2] = (px[i0*4+2] * (1-t) + px[i1*4+2] * t) | 0;
        texPx[i*4+3] = (px[i0*4+3] * (1-t) + px[i1*4+3] * t) | 0;
      }
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texN, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texPx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  draw(pos, mode) {
    if (!this._wfTex) return;
    if (!this.gl.isProgram(this._prog)) { this._prog = null; this._wfTex = null; return; }
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
// Wavypy-style stacked 3-band: bass(outer/blue) → mid(amber) → treble(inner/white)
// sqrt scaling for dynamic range; independent heights; Rekordbox color palette
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

void main() {
  float W = u_res.x, H = u_res.y, midY = H * 0.5;
  float cX = u_centerX * W;
  float pxMs = u_posMs + (gl_FragCoord.x - cX) * (u_zoomMs / W);

  if (pxMs < 0.0 || pxMs > u_durMs) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
  }
  vec4 wf = texture(u_wf, vec2(clamp(pxMs / u_durMs, 0.0, 1.0), 0.5));
  float bass = wf.r, midf = wf.g, treble = wf.b;

  float yDist = abs(gl_FragCoord.y - midY);
  float scale = midY * 0.95;

  if (u_mode == 2) {
    // Blue mono
    float e = sqrt(max(bass, max(midf, treble)));
    float h = e * scale;
    float alpha = 1.0 - smoothstep(h - 1.2, h + 1.2, yDist);
    if (alpha < 0.005) { fragColor = vec4(0.0,0.0,0.0,1.0); return; }
    fragColor = vec4(vec3(0.05, 0.35, 1.0) * e * alpha, 1.0);
    return;
  }

  // Wavypy 3-band: sqrt scaling preserves dynamics even in loud music
  // Raw peak values: bass/midf/treble are in [0,1] (PEAK per step window)
  float B = sqrt(bass);                         // 0-1 with sqrt compression
  float M = sqrt(midf);
  float T = min(1.0, sqrt(treble) * 1.4);       // treble is quieter, mild boost

  // Independent heights: bass outermost, treble innermost
  // No clamping or nesting — each band reflects its own amplitude
  float bH = B * scale;
  float mH = M * 0.68 * scale;
  float tH = T * 0.40 * scale;

  // Rekordbox 3-band palette: bass=#0055E1 (deep blue), mid=#FFA600 (amber), treble=#FFFFFF (white)
  vec3 bassCol = vec3(0.0,  0.333, 0.882);
  vec3 midCol  = vec3(1.0,  0.651, 0.0);
  vec3 trebCol = vec3(1.0,  1.0,   1.0);

  float AA = 1.0;
  float inBass = 1.0 - smoothstep(bH - AA, bH + AA, yDist);
  if (inBass < 0.005) { fragColor = vec4(0.0,0.0,0.0,1.0); return; }

  float inMid  = 1.0 - smoothstep(mH - AA, mH + AA, yDist);
  float inTreb = 1.0 - smoothstep(tH - AA, tH + AA, yDist);

  // Layer: start bass, overlay mid, overlay treble (innermost on top)
  vec3 col = bassCol;
  col = mix(col, midCol,  inMid);
  col = mix(col, trebCol, inTreb);

  // Slight brightness dim in quiet sections
  float bright = mix(0.55, 1.0, B);
  fragColor = vec4(col * bright * inBass, 1.0);
}
`;

// ─── Overview waveform fragment shader ──────────────────────────────────────
// Wavypy-style: same palette + sqrt scaling, with playhead and played-section dim
const _WGL_OV_FS = `#version 300 es
precision highp float;
uniform sampler2D u_wf;
uniform float u_pos;
uniform vec2  u_res;
uniform int   u_mode;
out vec4 fragColor;

void main() {
  float W = u_res.x, H = u_res.y, midY = H * 0.5;
  float t = gl_FragCoord.x / W;
  vec4 wf = texture(u_wf, vec2(t, 0.5));
  float bass=wf.r, midf=wf.g, treble=wf.b;

  // Playhead line
  float curX = u_pos * W;
  if (abs(gl_FragCoord.x - curX) < 0.8) {
    fragColor = vec4(1.0, 1.0, 1.0, 1.0); return;
  }

  float yDist = abs(gl_FragCoord.y - midY);
  float scale = midY * 0.95;
  bool played = t < u_pos;

  if (u_mode == 2) {
    float e = sqrt(max(bass, max(midf, treble)));
    float h = e * scale;
    float alpha = 1.0 - smoothstep(h - 0.6, h + 0.6, yDist);
    if (alpha < 0.005) {
      fragColor = played ? vec4(0.04,0.04,0.06,1.0) : vec4(0.0,0.0,0.0,1.0);
      return;
    }
    float dim = played ? 0.4 : 1.0;
    fragColor = vec4(vec3(0.05,0.35,1.0) * e * alpha * dim, 1.0);
    return;
  }

  float B = sqrt(bass);
  float M = sqrt(midf);
  float T = min(1.0, sqrt(treble) * 1.4);

  float bH = B * scale;
  float mH = M * 0.68 * scale;
  float tH = T * 0.40 * scale;

  float AA = 0.6;
  float inBass = 1.0 - smoothstep(bH - AA, bH + AA, yDist);
  if (inBass < 0.005) {
    fragColor = played ? vec4(0.04,0.04,0.06,1.0) : vec4(0.0,0.0,0.0,1.0);
    return;
  }

  float inMid  = 1.0 - smoothstep(mH - AA, mH + AA, yDist);
  float inTreb = 1.0 - smoothstep(tH - AA, tH + AA, yDist);

  vec3 col = vec3(0.0, 0.333, 0.882);            // bass blue
  col = mix(col, vec3(1.0, 0.651, 0.0),  inMid); // mid amber
  col = mix(col, vec3(1.0, 1.0,   1.0),  inTreb);// treble white

  float bright = mix(0.55, 1.0, B);
  float dim = played ? 0.38 : 1.0;
  fragColor = vec4(col * bright * inBass * dim, 1.0);
}
`;
