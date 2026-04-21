// renderer/waveform-gl.js
'use strict';

/**
 * WaveformGL — GPU-accelerated zoom waveform renderer.
 * Uses a WebGL2 RGBA texture: R=bass, G=body, B=presence, A=air/height (all 0-1).
 * Fragment shader samples the texture per fragment → no CPU loop per frame.
 */
class WaveformGL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    gl.clearColor(0.067, 0.075, 0.094, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this._wfTex = null;
    this._wfLen = 0;
    this._wfDurMs = 1;
    this._dirty = true;
    this._lastDrawKey = '';
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

  /** Upload wfData array of {r,g,b,a,h} (0-1) to GPU texture. */
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
    this._dirty = true;
    this._lastDrawKey = '';

    const px = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = wfData[i];
      // Alpha channel is overloaded: Virtual=air-band peak (p.a), HW=precomputed height (p.h).
      // Fallback order preserves HW mode 3/4 rendering.
      const aCh = (p.a !== undefined ? p.a : (p.h || 0));
      px[i*4]   = Math.min(255, (p.r || 0) * 255) | 0;
      px[i*4+1] = Math.min(255, (p.g || 0) * 255) | 0;
      px[i*4+2] = Math.min(255, (p.b || 0) * 255) | 0;
      px[i*4+3] = Math.min(255, aCh * 255) | 0;
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
    const drawKey = `${cv.width}x${cv.height}|${posMs}|${zoomMs}|${centerX}|${mode}`;
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
    this._dirty = true;
    this._lastDrawKey = '';
    for (let i = 0; i < n; i++) {
      const p = wfData[i];
      // Alpha: Virtual=air band peak (p.a), HW=precomputed height (p.h) — fallback keeps HW rendering.
      const aCh = (p.a !== undefined ? p.a : (p.h || 0));
      px[i*4]   = Math.min(255, (p.r || 0) * 255) | 0;
      px[i*4+1] = Math.min(255, (p.g || 0) * 255) | 0;
      px[i*4+2] = Math.min(255, (p.b || 0) * 255) | 0;
      px[i*4+3] = Math.min(255, aCh * 255) | 0;
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
    const drawKey = `${cv.width}x${cv.height}|${pos}|${mode}`;
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
const vec4 BG = vec4(0.067, 0.075, 0.094, 1.0);

vec4 sampleSmooth(float t) {
  float texel = 1.0 / float(textureSize(u_wf, 0).x);
  vec4 a = texture(u_wf, vec2(clamp(t - texel, 0.0, 1.0), 0.5)) * 0.08;
  a += texture(u_wf, vec2(clamp(t,             0.0, 1.0), 0.5)) * 0.84;
  a += texture(u_wf, vec2(clamp(t + texel, 0.0, 1.0), 0.5)) * 0.08;
  return a;
}

void main() {
  float W = u_res.x, H = u_res.y, midY = H * 0.5;
  float cX = u_centerX * W;
  float pxMs = u_posMs + (gl_FragCoord.x - cX) * (u_zoomMs / W);

  if (pxMs < 0.0 || pxMs > u_durMs) {
    fragColor = BG; return;
  }
  vec4 wf = sampleSmooth(clamp(pxMs / u_durMs, 0.0, 1.0));
  float bass = wf.r, midf = wf.g, treble = wf.b;

  float yDist = abs(gl_FragCoord.y - midY);
  float scale = midY * 0.95;

  if (u_mode == 2) {
    // Blue mono
    float e = sqrt(max(bass, max(midf, treble)));
    float h = e * scale;
    float alpha = 1.0 - smoothstep(h - 1.2, h + 1.2, yDist);
    if (alpha < 0.005) { fragColor = BG; return; }
    fragColor = vec4(vec3(0.05, 0.35, 1.0) * e * alpha, 1.0);
    return;
  }

  // ── Mode 4: HW Native RGB — CDJ colors displayed as-is ──
  if (u_mode == 4) {
    float h = wf.a;  // alpha channel = pre-computed height
    float outerH = h * scale;
    float AA = 1.0;
    float inside = 1.0 - smoothstep(outerH - AA, outerH + AA, yDist);
    if (inside < 0.005) { fragColor = BG; return; }
    // Normalize brightness: max channel → full brightness
    float mx = max(bass, max(midf, treble));
    vec3 col = mx > 0.001 ? vec3(bass, midf, treble) / mx : vec3(0.3);
    fragColor = vec4(col * inside, 1.0);
    return;
  }

  // ── Mode 0/1/3: 3-band waveform ──
  float B = bass, M = midf, T = treble;

  // beat-link standard: Bass=Blue(#2053D9), Mid=Amber(#F2AA3C), Treble=White
  vec3 bassCol = vec3(0.125, 0.325, 0.85);   // #2053D9
  vec3 midCol  = vec3(0.95,  0.667, 0.235);  // #F2AA3C
  vec3 trebCol = vec3(1.0,   1.0,   1.0);    // #FFFFFF

  float outerH, inside;
  vec3 col;

  if (u_mode == 3) {
    // HW PWV7 3-band — 자체 튜닝 셰이더 (GPU fragment 경로):
    //   B=low, M=mid, T=high. hiRatio=T/(B+M+T) → 저음 파랑→고음 흰색 그라디언트
    //   AA=1.0 smoothstep 으로 edge antialiasing, 저바이어스 0.45 로 중음 명시성 확보
    float h = wf.a;
    outerH = h * scale;
    float AA = 1.0;
    inside = 1.0 - smoothstep(outerH - AA, outerH + AA, yDist);
    float ridge = 1.0 - smoothstep(1.0, 4.5, abs(yDist - outerH));
    if (inside < 0.005 && ridge < 0.005) { fragColor = BG; return; }
    float total = B + M + T + 0.001;
    float hiR = T / total;
    col = vec3(hiR, 0.45 + hiR * 0.55, 1.0);
  } else {
    // Virtual: rekordbox-style stacked 4-band waveform.
    float bV = max(B, 0.0);
    float mV = max(M, 0.0);
    float pV = max(T, 0.0);
    float tV = max(wf.a, 0.0);
    float bH = pow(bV, 0.87) * scale;
    float mH = pow(mV, 0.87) * scale;
    float pH = pow(pV, 0.87) * scale;
    float tH = pow(tV, 0.87) * scale * 0.78;
    outerH = max(max(bH, mH), max(pH, tH));
    float AA = 1.0;
    float bMask = 1.0 - smoothstep(bH - AA, bH + AA, yDist);
    float mMask = 1.0 - smoothstep(mH - AA, mH + AA, yDist);
    float pMask = 1.0 - smoothstep(pH - AA, pH + AA, yDist);
    float tMask = 1.0 - smoothstep(tH - AA, tH + AA, yDist);
    inside = 1.0 - smoothstep(outerH - AA, outerH + AA, yDist);
    if (inside < 0.005) { fragColor = BG; return; }
    vec3 lowCol = vec3(0.05, 0.23, 0.42);
    vec3 bodyCol = vec3(1.0, 0.42, 0.17);
    vec3 presCol = vec3(0.95, 0.72, 0.32);
    vec3 airCol  = vec3(1.0, 0.94, 0.82);
    col = lowCol * bMask;
    col = mix(col, bodyCol, mMask);
    col = mix(col, presCol, pMask * 0.55);
    col = mix(col, airCol, tMask * 0.65);
    inside = max(max(bMask, mMask), max(pMask, tMask));
  }

  fragColor = vec4(clamp(col, 0.0, 1.0) * inside, 1.0);
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
const vec4 BG = vec4(0.067, 0.075, 0.094, 1.0);
const vec4 BG_PLAYED = vec4(0.090, 0.098, 0.122, 1.0);

vec4 sampleSmooth(float t) {
  float texel = 1.0 / float(textureSize(u_wf, 0).x);
  vec4 a = texture(u_wf, vec2(clamp(t - texel, 0.0, 1.0), 0.5)) * 0.08;
  a += texture(u_wf, vec2(clamp(t,             0.0, 1.0), 0.5)) * 0.84;
  a += texture(u_wf, vec2(clamp(t + texel, 0.0, 1.0), 0.5)) * 0.08;
  return a;
}

void main() {
  float W = u_res.x, H = u_res.y, midY = H * 0.5;
  float t = gl_FragCoord.x / W;
  vec4 wf = sampleSmooth(t);
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
      fragColor = played ? BG_PLAYED : BG;
      return;
    }
    float dim = played ? 0.4 : 1.0;
    fragColor = vec4(vec3(0.05,0.35,1.0) * e * alpha * dim, 1.0);
    return;
  }

  // ── Mode 4: HW Native RGB — CDJ colors as-is ──
  if (u_mode == 4) {
    float h = wf.a;
    float outerH = h * scale;
    float AA2 = 0.6;
    float inside = 1.0 - smoothstep(outerH - AA2, outerH + AA2, yDist);
    if (inside < 0.005) {
      fragColor = played ? BG_PLAYED : BG; return;
    }
    float mx = max(bass, max(midf, treble));
    vec3 col = mx > 0.001 ? vec3(bass, midf, treble) / mx : vec3(0.3);
    float dim = played ? 0.38 : 1.0;
    fragColor = vec4(col * inside * dim, 1.0);
    return;
  }

  // ── Mode 1/3: 3-band ──
  float B = bass, M = midf, T = treble;

  // beat-link standard colors (used by mode 3 / HW)
  vec3 bassCol = vec3(0.125, 0.325, 0.85);
  vec3 midCol  = vec3(0.95,  0.667, 0.235);
  vec3 trebCol = vec3(1.0,   1.0,   1.0);

  float outerH, inside;
  vec3 col;

  if (u_mode == 3) {
    // HW PWV7 3-band — 오버뷰 전용 축소 경로 (blue→white spectrum, AA=0.6)
    float h = wf.a;
    outerH = h * scale;
    float AA2 = 0.6;
    inside = 1.0 - smoothstep(outerH - AA2, outerH + AA2, yDist);
    float ridge = 1.0 - smoothstep(0.7, 3.5, abs(yDist - outerH));
    if (inside < 0.005 && ridge < 0.005) { fragColor = played ? BG_PLAYED : BG; return; }
    float total = B + M + T + 0.001;
    float hiR = T / total;
    col = vec3(hiR, 0.45 + hiR * 0.55, 1.0);
  } else {
    // Virtual: rekordbox-style stacked 4-band waveform.
    float bV = max(B, 0.0);
    float mV = max(M, 0.0);
    float pV = max(T, 0.0);
    float tV = max(wf.a, 0.0);
    float bH = pow(bV, 0.87) * scale;
    float mH = pow(mV, 0.87) * scale;
    float pH = pow(pV, 0.87) * scale;
    float tH = pow(tV, 0.87) * scale * 0.78;
    outerH = max(max(bH, mH), max(pH, tH));
    float AA2 = 0.6;
    float bMask = 1.0 - smoothstep(bH - AA2, bH + AA2, yDist);
    float mMask = 1.0 - smoothstep(mH - AA2, mH + AA2, yDist);
    float pMask = 1.0 - smoothstep(pH - AA2, pH + AA2, yDist);
    float tMask = 1.0 - smoothstep(tH - AA2, tH + AA2, yDist);
    inside = 1.0 - smoothstep(outerH - AA2, outerH + AA2, yDist);
    if (inside < 0.005) { fragColor = played ? BG_PLAYED : BG; return; }
    vec3 lowCol = vec3(0.05, 0.23, 0.42);
    vec3 bodyCol = vec3(1.0, 0.42, 0.17);
    vec3 presCol = vec3(0.95, 0.72, 0.32);
    vec3 airCol  = vec3(1.0, 0.94, 0.82);
    col = lowCol * bMask;
    col = mix(col, bodyCol, mMask);
    col = mix(col, presCol, pMask * 0.55);
    col = mix(col, airCol, tMask * 0.65);
    inside = max(max(bMask, mMask), max(pMask, tMask));
  }

  float dim = played ? 0.38 : 1.0;
  fragColor = vec4(clamp(col, 0.0, 1.0) * inside * dim, 1.0);
}
`;
