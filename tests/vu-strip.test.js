'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

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

test('multi-channel VU rebuild keeps a fixed fader control', () => {
  const m = src.match(/function _buildVuStrip\(slot,numCh\)\{([\s\S]*?)\n\}/);
  assert.ok(m, '_buildVuStrip not found');
  assert.ok(m[1].includes('dvu-fader'), 'rebuilt VU strip must include fader');
  assert.ok(m[1].includes('_bindVirtualFader(slot'), 'rebuilt fader must be rebound');
});

test('row layout allows VU column expansion without card/tower width growth', () => {
  assert.ok(src.includes('var(--vu-w,40px)'), 'row grid must use --vu-w');
  assert.ok(src.includes('rowBody.style.setProperty(\'--vu-w\''), '_buildVuStrip must set row --vu-w');
  // Tower 가 multi-VU grid 를 보유. Card 의 multi-VU 분기는 제거됨 (단일 VU 만 사용).
  assert.ok(src.includes('grid-template-columns:repeat(var(--vu-count,2),minmax(0,1fr)) 26px'), 'tower multi VU should reserve fixed fader column');
});
