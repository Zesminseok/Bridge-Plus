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

const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
const id3ParserPath = path.join(__dirname, '..', 'renderer', 'id3-parser.js');
const renderer = fs.readFileSync(rendererPath, 'utf8');
// ID3 frame parsing → renderer/id3-parser.js (Phase 4.13). Test 검색 범위 = renderer + id3-parser.
const id3Source = (fs.existsSync(id3ParserPath) ? fs.readFileSync(id3ParserPath, 'utf8') : '') + '\n' + renderer;

test('ID3 BPM parsing accepts standard TBPM and common TXXX BPM frames', () => {
  assert.match(id3Source, /function _id3ParseBpm\(txt\)/, 'missing shared BPM text parser');
  assert.match(id3Source, /if\(fid==='TBPM'&&txt\)\{const b=_id3ParseBpm\(txt\);if\(b>0\)\{tags\.bpm=b;tags\.bpmSource='TBPM';\}\}/, 'TBPM should populate metadata BPM source');
  assert.match(id3Source, /if\(fid==='TXXX'&&!tags\.bpm\)/, 'TXXX BPM fallback should be inspected');
  assert.match(id3Source, /desc==='bpm'\|\|desc==='tempo'\|\|desc==='trackbpm'/, 'TXXX fallback should accept BPM-like descriptions');
  assert.match(id3Source, /tags\.bpmSource='TXXX:'\+txxx\.desc;/, 'TXXX fallback should retain the source description');
});

test('virtual deck waits for ID3 before choosing analyzed BPM', () => {
  assert.match(renderer, /d\._id3Promise=Promise\.resolve\(null\)/, 'loadFile should reset ID3 promise state');
  assert.match(renderer, /d\._id3Promise=readID3Tags\(f\)\.then\(tags=>/, 'ID3 read should be represented as a promise');
  assert.match(renderer, /Promise\.resolve\(d\._id3Promise\|\|Promise\.resolve\(\)\)\.then\(\(\)=>analyzeBPM\(audioBlob\)\)/, 'BPM analysis should wait for ID3 parse completion');
  assert.match(renderer, /const finalBpm=d\._id3Bpm\|\|analyzedFinal;/, 'ID3 BPM should take priority over analyzed BPM');
});

test('analyzed BPM snaps close integer dance tempos for stable display', () => {
  // _normalizeAnalyzedBpm → renderer/bpm-analysis.js (Phase 4.15). 두 파일 모두 검색.
  const bpmPath = path.join(__dirname, '..', 'renderer', 'bpm-analysis.js');
  const bpmSource = (fs.existsSync(bpmPath) ? fs.readFileSync(bpmPath, 'utf8') : '') + '\n' + renderer;
  assert.match(bpmSource, /function _normalizeAnalyzedBpm\(bpm\)/, 'missing analyzed BPM normalizer');
  assert.match(bpmSource, /Math\.abs\(b-r\)<=0\.35\?r:Math\.round\(b\*10\)\/10/, 'analysis should snap close integer tempos and otherwise keep one decimal');
  assert.match(renderer, /d\._bpmSource=d\._id3Bpm\?d\._id3BpmSource:\(analyzedFinal!==analyzedBpm\?'analysis-snap':'analysis'\);/, 'BPM source should show whether analysis was snapped');
});
