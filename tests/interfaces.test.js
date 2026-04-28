'use strict';

const assert = require('assert');
const core = require('../bridge-core');

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

const sample = [
  {name:'en0',address:'192.168.0.10',netmask:'255.255.255.0',broadcast:'192.168.0.255',mac:'aa:bb:cc:00:00:01',internal:false},
  {name:'en5',address:'169.254.1.20',netmask:'255.255.0.0',broadcast:'169.254.255.255',mac:'aa:bb:cc:00:00:02',internal:false},
];

test('interface signature is order-insensitive and ignores labels', () => {
  const a = core.interfaceSignature(sample);
  const b = core.interfaceSignature([
    {...sample[1], hwPort:'USB 10/100/1000 LAN'},
    {...sample[0], hwPort:'Wi-Fi'},
  ]);
  assert.strictEqual(a, b);
});

test('sanitize interface selection falls back to auto when address disappears', () => {
  assert.strictEqual(core.sanitizeInterfaceSelection('192.168.0.10', sample), '192.168.0.10');
  assert.strictEqual(core.sanitizeInterfaceSelection('10.0.0.5', sample), null);
  assert.strictEqual(core.sanitizeInterfaceSelection('127.0.0.1', sample), '127.0.0.1');
  assert.strictEqual(core.sanitizeInterfaceSelection('', sample), null);
});
