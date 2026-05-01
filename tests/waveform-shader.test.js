'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const shaderPath = path.join(__dirname, '..', 'renderer', 'waveform-gl.js');
const source = fs.readFileSync(shaderPath, 'utf8');

function shaderConst(name){
  const match = source.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  assert(match, `missing shader const ${name}`);
  return match[1];
}

test('webgl waveform shader exposes 4-band envelope + theme uniform', () => {
  // 셰이더 이름은 _WGL_FS (detail) / _WGL_OV_FS (overview). 색 상수와 가중치는 자주 튜닝되므로
  // 픽셀-perfect 가 아니라 구조 (4-band 입력, theme uniform, rgbTraceColor 함수) 만 검증.
  for (const shaderName of ['_WGL_ZOOM_FS', '_WGL_OV_FS']){
    const shader = shaderConst(shaderName);
    assert.match(shader, /float loEnv\s*=\s*a\.r;/, `${shaderName} missing low envelope channel`);
    assert.match(shader, /float miEnv\s*=\s*a\.g;/, `${shaderName} missing mid envelope channel`);
    assert.match(shader, /float hiEnv\s*=\s*a\.b;/, `${shaderName} missing high envelope channel`);
    assert.match(shader, /float airEnv\s*=\s*a\.a;/, `${shaderName} missing air envelope channel`);
    assert.match(shader, /uniform int\s+uTheme;/, `${shaderName} missing waveform theme uniform`);
    assert.match(shader, /vec3 rgbTraceColor\(vec4 e\)/, `${shaderName} missing RGB trace color helper`);
    assert.match(shader, /vec3 monoTraceColor\(vec4 e\)/, `${shaderName} missing Mono trace color helper`);
    assert.match(shader, /if\s*\(uTheme == 1\)/, `${shaderName} missing RGB theme branch`);
    assert.match(shader, /if\s*\(uTheme == 2\)/, `${shaderName} missing Mono theme branch`);
    assert.doesNotMatch(shader, /uPaletteMode|uViewMode/, `${shaderName} should not expose legacy palette/view uniforms`);
  }
});

test('3band drawing order: BLUE → ORANGE → BROWN → WHITE (innermost top)', () => {
  // 4-band stack 그리는 순서 — WHITE 가장 위/안쪽, BLUE 가장 outer.
  // C_LOW 가 먼저, 그 다음 C_HI (ORANGE), C_MID (BROWN), C_AIR (WHITE).
  const glPath = path.join(__dirname, '..', 'renderer', 'waveform-gl.js');
  const stripPath = path.join(__dirname, '..', 'renderer', 'waveform-strip.js');
  const gl = fs.readFileSync(glPath, 'utf8');
  const strip = fs.readFileSync(stripPath, 'utf8');
  // GLSL: layer call 순서가 BLUE→ORANGE→BROWN→WHITE 이어야.
  const orderRe = /layer\(col,\s*C_LOW[\s\S]*?layer\(col,\s*C_HI[\s\S]*?layer\(col,\s*C_MID[\s\S]*?layer\(col,\s*C_AIR/;
  assert.match(gl, orderRe, 'GLSL layer order must be BLUE → ORANGE → BROWN → WHITE');
  // CPU strip: 동일 순서.
  const stripOrderRe = /WFC\.C_LOW[\s\S]*?WFC\.C_HI[\s\S]*?WFC\.C_MID[\s\S]*?WFC\.C_AIR/;
  assert.match(strip, stripOrderRe, 'strip CPU layer order must be BLUE → ORANGE → BROWN → WHITE');
});

test('virtual analysis stores smoothed 4-band envelopes (worker-based)', () => {
  // Phase 2.5 이후 분석 로직은 rgbwf-worker.js 로 이전. 셰이더와 다르게 worker 는 graceful 한
  // 코드 변화 (filter 컷오프, smoothEnv release 값 등) 가 잦으므로 구조만 검증.
  const workerPath = path.join(__dirname, '..', 'renderer', 'rgbwf-worker.js');
  const worker = fs.readFileSync(workerPath, 'utf8');
  assert.match(worker, /function smoothEnv\(src,\s*attack,\s*release\)/, 'worker missing temporal envelope smoothing');
  // packed waveform 8-byte stride: lo, mid, hi, air, mn, mx, band, rms.
  assert.match(worker, /wf\[o\]\s*=\s*encU\(loEnv\[i\]\)/, 'packed waveform missing low envelope');
  assert.match(worker, /wf\[o \+ 1\]\s*=\s*encU\(miEnv\[i\]\)/, 'packed waveform missing mid envelope');
  assert.match(worker, /wf\[o \+ 2\]\s*=\s*encU\(hiEnv\[i\]\)/, 'packed waveform missing high envelope');
  assert.match(worker, /wf\[o \+ 3\]\s*=\s*encU\(airEnv\[i\]\)/, 'packed waveform missing air envelope');
  // 4-band cutoffs (LO_TOP/MID_TOP/HI_TOP/AIR_TOP) — message override 가능 (theme-aware 분석).
  assert.match(worker, /LO_TOP\s*=\s*[^;]+/, 'worker missing LO_TOP cutoff');
  assert.match(worker, /MID_TOP\s*=\s*[^;]+/, 'worker missing MID_TOP cutoff');
  assert.match(worker, /HI_TOP\s*=\s*[^;]+/, 'worker missing HI_TOP cutoff');
  assert.match(worker, /AIR_TOP\s*=\s*[^;]+/, 'worker missing AIR_TOP cutoff (air bandpass upper edge)');
  // theme-aware 분석 — message 의 cutoffs/releases/smooth 를 override 로 받음.
  assert.match(worker, /cutoffs,\s*releases,\s*smooth/, 'worker should accept cutoffs/releases/smooth from message');
  assert.match(worker, /Number\.isFinite\(pkBin\)/, 'worker should ignore non-finite filter peaks');
  // movingAverage post-pass — smooth slider 용 추가 후처리 함수.
  assert.match(worker, /function movingAverage\(src,\s*kernel\)/, 'worker missing movingAverage helper');
  assert.match(worker, /movingAverage\(smoothEnv\(loSrc/, 'final pass should chain movingAverage(smoothEnv(...)) for lo');
  assert.match(worker, /movingAverage\(smoothEnv\(airSrc/, 'final pass should chain movingAverage(smoothEnv(...)) for air');
  // Air bandpass — 이전 hp-only 에서 cAIRtop LP 추가 (4-band 정의 완성).
  assert.match(worker, /_lpAir_a/, 'worker missing air bandpass low-pass filter');
  assert.match(worker, /const air = _bq\(_lpAir_b/, 'air should be bandpass (HP+LP) not pure HP');
  // effectiveRate 메시징 — 짧은 트랙의 색 시간축 정렬 fix (recent).
  assert.match(worker, /effectiveRate\s*=\s*pts\s*\/\s*analysisDur/, 'worker should compute effective rate from actual pts');
  assert.match(worker, /targetRate:\s*effectiveRate/, 'worker should report effective rate (not requested target)');
});

test('theme-aware analysis — WF_THEME_PRESETS + per-theme cache + cutoffs override', () => {
  // RGB 와 3band 가 별도 frequency 분석 사용 (Phase 4.0 / 4.14).
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const analysisPath = path.join(__dirname, '..', 'renderer', 'waveform-analysis.js');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const analysis = fs.readFileSync(analysisPath, 'utf8');
  // index.html 에 theme presets 정의.
  assert.match(renderer, /WF_THEME_PRESETS\s*=\s*\{/, 'WF_THEME_PRESETS dict missing');
  assert.match(renderer, /'3band':\s*\{[\s\S]*?cutoffs:[\s\S]*?releases:[\s\S]*?smooth:/, '3band preset missing fields');
  assert.match(renderer, /'rgb':\s*\{[\s\S]*?cutoffs:[\s\S]*?releases:[\s\S]*?smooth:/, 'rgb preset missing fields');
  // _wfThemePreset accessor + per-theme cache.
  assert.match(renderer, /function _wfThemePreset\(theme\)/, '_wfThemePreset accessor missing');
  assert.match(renderer, /d\._wfByTheme/, 'per-theme cache d._wfByTheme missing');
  // Theme switch handler — re-analyze on miss.
  assert.match(renderer, /function _wfRebuildForCurrentTheme\(\)/, '_wfRebuildForCurrentTheme missing');
  // buildRGBWaveform 이 analysisOpts 받음.
  assert.match(analysis, /analysisOpts/, 'buildRGBWaveform should accept analysisOpts');
  assert.match(analysis, /msg\.cutoffs\s*=\s*analysisOpts\.cutoffs/, 'analysisOpts.cutoffs forwarded to worker');
});

test('virtual waveform duration follows media metadata to avoid MP3 decode padding drift', () => {
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const wfAnalysisPath = path.join(__dirname, '..', 'renderer', 'waveform-analysis.js');
  const workerPath = path.join(__dirname, '..', 'renderer', 'rgbwf-worker.js');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const worker = fs.existsSync(workerPath) ? fs.readFileSync(workerPath, 'utf8') : '';
  const analysis = fs.existsSync(wfAnalysisPath) ? fs.readFileSync(wfAnalysisPath, 'utf8') : '';
  assert.match(renderer, /function _wfDurMsForDeck\(d,arr\)\{[^}]*arr\._durationMs/, 'duration helper should prefer packed waveform metadata duration');
  assert.match(analysis, /async function buildRGBWaveform\(blob,\s*onChunk,\s*targetDurMs/, 'analysis should expose buildRGBWaveform with metadata duration param');
  assert.match(worker, /const analysisDur\s*=\s*Math\.max\(0\.001,\s*\(targetDurMs &&\s*targetDurMs\s*>\s*0\)/, 'worker should use media metadata duration when available');
  assert.match(worker, /totalDurMs:\s*analysisDur\s*\*\s*1000/, 'worker should report total duration in done message');
  assert.match(renderer, /buildRGBWaveform\(audioBlob,\(done,partial\)=>/, 'loader should pass progress callback');
  assert.match(renderer, /buildRGBWaveform\(audioBlob,[\s\S]*?,d\.dur(?:,[\s\S]*?)?\)/, 'loader should pass media metadata duration into waveform analysis');
});

test('virtual analysis progressively uploads waveform chunks while decoding', () => {
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const wfAnalysisPath = path.join(__dirname, '..', 'renderer', 'waveform-analysis.js');
  const renderer = fs.readFileSync(rendererPath, 'utf8') + '\n' + (fs.existsSync(wfAnalysisPath)?fs.readFileSync(wfAnalysisPath,'utf8'):'');
  assert.match(renderer, /if\(partial&&_wfLen\(partial\)>2\)_queuePartialWaveformPaint\(slot,d,120\);/, 'partial waveform chunks should be scheduled for throttled repaint during analysis');
});

test('renderer exposes 3 waveform themes (3 Band, RGB, Mono)', () => {
  // 3 가지 테마. wfTheme 기본값은 'rgb' (사용자 선호 매핑). Mono 추가됨.
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  assert.match(renderer, /let wfTheme=\(v=>\(v==='3band'\|\|v==='mono'\|\|v==='rgb'\)\?v:'rgb'\)/, 'renderer should accept 3 themes with rgb default');
  assert.match(renderer, /function _wfThemeMode\(\)\{return wfTheme==='rgb'\?1:\(wfTheme==='mono'\?2:0\);\}/, 'theme mode mapping: rgb=1 mono=2 3band=0');
  assert.match(renderer, /d\.wgl\.draw\([\s\S]*?_wfThemeMode\(\)\);/, 'zoom waveform should pass theme into WebGL renderer');
  assert.match(renderer, /d\.ovgl\.draw\([\s\S]*?_wfThemeMode\(\)\);/, 'overview waveform should pass theme into WebGL renderer');
  assert.doesNotMatch(renderer, /wfPalette|wf_palette|wfViewMode|wf_view_mode|wfColor|Palette|wfPaletteSel|wfViewModeSel|_WF_VIEW_TO_UNIFORM|_wfEffectiveViewMode/, 'renderer still exposes legacy waveform theme/mode controls');
  assert.doesNotMatch(source, /uPaletteMode|uViewMode|paletteMode|viewMode/, 'WebGL renderer still carries legacy palette/view mode plumbing');
  // Bin rate 상수 — Phase 2.5 정착 값.
  assert.match(renderer, /const VIRTUAL_WF_\\u\{52\}ATE\s*=\s*120/, 'virtual waveform rate constant');
  assert.match(renderer, /const HW_WF_\\u\{52\}ATE\s*=\s*150/, 'hardware waveform rate constant');
  // _wfRenderDataForDeck: virtual 우선순위 rgbWf 첫번째 (rgbWfFine 은 no-op 으로 후순위).
  assert.match(renderer, /function _wfRenderDataForDeck\(d\)\{[^}]*d\?\.type==='hw'/, '_wfRenderDataForDeck branches on hw vs virtual');
});

test('overview overlay markers use static OffscreenCanvas cache', () => {
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  assert.match(renderer, /d\._ovOverlayCache/, 'overview overlay cache property missing');
  assert.match(renderer, /trackId\}\|\$\{cuesHash\}\|\$\{beatsHash\}\|\$\{W2\}\|\$\{H2\}\|\$\{wfTheme\}/, 'overview overlay cache key should include track/cues/beats/size/theme');
  assert.match(renderer, /new OffscreenCanvas\(W2,H2\)/, 'overview overlay cache should render static markers into OffscreenCanvas');
  assert.match(renderer, /olCtx\.drawImage\(d\._ovOverlayCache\.canvas,0,0\)/, 'overview overlay cache hit should blit once to the overlay context');
  assert.match(renderer, /if\(!_ovHasOffscreenCanvas\)\{[\s\S]*_drawOverviewOverlayStatic\(olCtx\);[\s\S]*_drawOverviewPlayhead\(olCtx\);[\s\S]*return;/, 'no-OffscreenCanvas fallback should run full overlay redraw');
});

test('2d fallback cache uses signed min/max peaks', () => {
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const wfAnalysisPath = path.join(__dirname, '..', 'renderer', 'waveform-analysis.js');
  const renderer = fs.readFileSync(rendererPath, 'utf8') + '\n' + (fs.existsSync(wfAnalysisPath)?fs.readFileSync(wfAnalysisPath,'utf8'):'');
  assert.match(renderer, /const mx0=p0\.mx!==undefined\?p0\.mx:h0/, 'fallback missing mx positive peak path');
  assert.match(renderer, /const mn0=p0\.mn!==undefined\?p0\.mn:-h0/, 'fallback missing mn negative peak path');
  assert.match(renderer, /tops2\[px\]=mid-_shapePeak\(mx\)\*mid\*0\.95/, 'fallback top contour is not signed');
  assert.match(renderer, /bots2\[px\]=mid\+_shapePeak\(-mn\)\*mid\*0\.95/, 'fallback bottom contour is not signed');
});

test('detail strip masks unanalysed waveform tail', () => {
  const glPath = path.join(__dirname, '..', 'renderer', 'waveform-gl.js');
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const gl = fs.readFileSync(glPath, 'utf8');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const shader = shaderConst('_WGL_STRIP_DETAIL_FS');
  assert.match(shader, /uniform float u_partialFrac;/, 'detail strip shader should accept partial fraction');
  assert.match(shader, /if\s*\(trackU > frac\)\s*\{\s*fragColor = vec4\(BG, 1\.0\);\s*return;\s*\}/, 'detail strip should blank unavailable tail');
  assert.match(shader, /trackU \/ frac/, 'detail strip should map partial data into analysed fraction only');
  assert.match(gl, /setStrip\(image,\s*durMs,\s*key,\s*partialFrac = 1\.0\)/, 'WaveformGL.setStrip should accept partialFrac');
  assert.match(renderer, /d\.wgl\.setStrip\(d\._stripBitmap,\s*totalDur,\s*key,\s*partialFrac\)/, 'detail strip cache hit should pass full duration and partialFrac');
  assert.match(renderer, /d\.wgl\.setStrip\(bm,\s*totalDur,\s*key,\s*partialFrac\)/, 'detail strip upload should pass full duration and partialFrac');
});

test('waveform renderers blank true silence instead of anti-alias filling it', () => {
  const stripPath = path.join(__dirname, '..', 'renderer', 'waveform-strip.js');
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const strip = fs.readFileSync(stripPath, 'utf8');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const zoom = shaderConst('_WGL_ZOOM_FS');
  const overview = shaderConst('_WGL_OV_FS');
  assert.match(strip, /if\s*\(H <= 0\.0001\)\s*return 0;/, 'CPU strip symMask should return transparent for zero-height bins');
  assert.match(zoom, /if\s*\(H <= 0\.0001\)\s*return 0\.0;/, 'detail WebGL symMask should return transparent for zero-height bins');
  assert.match(zoom, /if\s*\(peakBand < 0\.001\)\s*\{\s*fragColor = BG;\s*return;\s*\}/, 'detail WebGL should blank zero-energy samples');
  assert.match(overview, /if\s*\(peakBand < 0\.001\)\s*\{\s*fragColor = played \? BG_PLAYED : BG;\s*return;\s*\}/, 'overview WebGL should blank zero-energy samples');
  assert.match(zoom, /if\s*\(u_mode == 4\)\s*\{[\s\S]*float hAll = airEnv \* sLow;[\s\S]*if\s*\(hAll < 0\.001\)/, 'detail WebGL HW legacy mode should use height alpha as envelope');
  assert.match(overview, /if\s*\(u_mode == 4\)\s*\{[\s\S]*float hAll = airEnv \* waveH \* 0\.92;[\s\S]*if\s*\(hAll < 0\.001\)/, 'overview WebGL HW legacy mode should use height alpha as envelope');
  assert.match(renderer, /const on=h>0\.0001\?1:0;[\s\S]*out\[i\]=\{r:r\*on,g:g\*on,b:b\*on,h,mn:-h,mx:h\};/, 'HW color conversion should gate RGB by height');
});

test('virtual waveform analysis mixes all decoded channels', () => {
  // Phase 2.5 이후 채널 수집/믹스 로직은 waveform-analysis.js + rgbwf-worker.js 로 이전.
  // analysis: getChannelData 로 각 채널 수집 → worker 로 transfer
  // worker: per-sample 채널 합산 + chCount 로 평균
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const wfAnalysisPath = path.join(__dirname, '..', 'renderer', 'waveform-analysis.js');
  const workerPath = path.join(__dirname, '..', 'renderer', 'rgbwf-worker.js');
  const corpus = fs.readFileSync(rendererPath, 'utf8')
    + '\n' + (fs.existsSync(wfAnalysisPath)?fs.readFileSync(wfAnalysisPath,'utf8'):'')
    + '\n' + (fs.existsSync(workerPath)?fs.readFileSync(workerPath,'utf8'):'');
  // analysis 가 channels 배열을 numberOfChannels 만큼 모음.
  assert.match(corpus, /for\s*\(let c\s*=\s*0;\s*c\s*<\s*nch;\s*c\+\+\)\s*channels\.push/, 'analysis does not collect all decoded channels');
  // worker 가 채널 합산 + 평균.
  assert.match(corpus, /for\s*\(let c\s*=\s*0;\s*c\s*<\s*chCount;\s*c\+\+\)\s*s\s*\+=\s*channels\[c\]\[s0\s*\+\s*j\]/, 'worker does not sum channels per sample');
  assert.match(corpus, /s\s*\/=\s*chCount/, 'worker does not average mixed channels');
});

test('virtual rekordbox PWV7 import preserves waveform height in signed envelope', () => {
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const wfAnalysisPath = path.join(__dirname, '..', 'renderer', 'waveform-analysis.js');
  const renderer = fs.readFileSync(rendererPath, 'utf8') + '\n' + (fs.existsSync(wfAnalysisPath)?fs.readFileSync(wfAnalysisPath,'utf8'):'');
  assert.match(renderer, /const h=Math\.max\(p\.low\|\|0,p\.mid\|\|0,p\.hi\|\|0\)\/255;/, 'PWV7 import does not compute normalized height');
  assert.match(renderer, /return\{h,mn:-h,mx:h,r:\(p\.low\|\|0\)\/255,g:\(p\.mid\|\|0\)\/255,b:\(p\.hi\|\|0\)\/255\};/, 'PWV7 import does not copy height into signed envelope');
});
