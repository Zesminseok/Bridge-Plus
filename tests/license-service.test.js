'use strict';

const assert = require('assert');
const license = require('../license-service');

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

test('license service is disabled by default and never gates test builds', () => {
  const status = license.getStatus();
  assert.strictEqual(status.enabled, false);
  assert.strictEqual(status.state, 'disabled');
  assert.strictEqual(status.canRun, true);
});

test('activation stub accepts input shape but performs no real activation', () => {
  const result = license.activate({email:'test@example.com', serial:'BRIDGE-TEST'});
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status.enabled, false);
  assert.strictEqual(result.status.canRun, true);
  assert.match(result.message, /disabled/i);
});
