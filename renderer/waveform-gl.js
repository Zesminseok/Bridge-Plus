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

    const px = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = wfData[i];
      const h = p.h || Math.max(Math.abs(p.mn||0), Math.abs(p.mx||0)) || 0;
      px[i*4]   = Math.min(255, (p.r || 0) * 255) | 0;
      px[i*4+1] = Math.min(255, (p.g || 0) * 255) | 0;
      px[i*4+2] = Math.min(255, (p.b || 0) * 255) | 0;
      px[i*4+3] = Math.min(255, h * 255) | 0;
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
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
    const px = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = wfData[i];
      const h = p.h || Math.max(Math.abs(p.mn||0), Math.abs(p.mx||0)) || 0;
      px[i*4]   = Math.min(255, (p.r || 0) * 255) | 0;
      px[i*4+1] = Math.min(255, (p.g || 0) * 255) | 0;
      px[i*4+2] = Math.min(255, (p.b || 0) * 255) | 0;
      px[i*4+3] = Math.min(255, h * 255) | 0;
    }
    if (this._wfTex) gl.deleteTexture(this._wfTex);
    this._wfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._wfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

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
  if (mode == 1) {
    float tot = bass + midf + treble + 0.001;
    float rn = bass/tot, gn = midf/tot, bn = treble/tot;
    return vec3(
      gn*1.0  + bn*1.0,
      rn*0.333 + gn*0.651 + bn*1.0,
      rn*0.882 + bn*1.0
    );
  } else if (mode == 2) {
    float e = min(1.0, sqrt(bass*bass + midf*midf + treble*treble));
    float w = treble / (bass + midf + treble + 0.001);
    float br = pow(e, 0.55);
    return vec3(br*0.0 + w*0.667, br*0.333 + w*0.529, br*0.690 + w*0.310);
  } else {
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

  float curX = u_pos * W;
  if (abs(gl_FragCoord.x - curX) < 0.8) {
    fragColor = vec4(1.0, 1.0, 1.0, 1.0); return;
  }

  float halfH = h * mid * 0.95;
  float yDist = abs(gl_FragCoord.y - mid);
  if (halfH < 0.5 || yDist > halfH) {
    if (t < u_pos) fragColor = vec4(0.04, 0.04, 0.06, 1.0);
    else fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 col = wfColor(bass, midf, treble, u_mode);
  float brightness = 1.0 - (yDist / halfH) * 0.75;
  if (t < u_pos) brightness *= 0.45;
  fragColor = vec4(col * brightness, 1.0);
}
`;
