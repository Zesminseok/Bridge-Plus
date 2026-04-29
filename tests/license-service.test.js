'use strict';

const assert = require('assert');
const license = require('../license-service');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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

test('license service starts a 60 day demo window from first run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-license-'));
  const storePath = path.join(dir, 'license.json');
  const first = Date.UTC(2026, 3, 1, 0, 0, 0);
  const svc = license.createDemoLicenseService({
    storePath,
    now: () => first,
  });

  const status = svc.getStatus();
  assert.strictEqual(status.enabled, true);
  assert.strictEqual(status.state, 'demo');
  assert.strictEqual(status.canRun, true);
  assert.strictEqual(status.plan, 'Demo');
  assert.strictEqual(status.daysRemaining, 60);
  assert.strictEqual(status.demoTotalDays, 60);
  assert.strictEqual(status.firstRunAt, new Date(first).toISOString());
  assert.strictEqual(status.expiresAt, new Date(first + 60 * 24 * 60 * 60 * 1000).toISOString());
});

test('license service expires demo after 60 days and blocks core features', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-license-'));
  const storePath = path.join(dir, 'license.json');
  const first = Date.UTC(2026, 3, 1, 0, 0, 0);
  license.createDemoLicenseService({
    storePath,
    now: () => first,
  }).getStatus();

  const expired = license.createDemoLicenseService({
    storePath,
    now: () => first + 61 * 24 * 60 * 60 * 1000,
  }).getStatus();

  assert.strictEqual(expired.enabled, true);
  assert.strictEqual(expired.state, 'expired');
  assert.strictEqual(expired.canRun, false);
  assert.strictEqual(expired.daysRemaining, 0);
  assert.strictEqual(expired.message, '60일 데모가 종료되었습니다. 테스트 해주셔서 감사합니다.');
});

test('activation rejects malformed license keys while preserving demo status', () => {
  const svc = license.createDemoLicenseService({
    storePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-license-')), 'license.json'),
    now: () => Date.UTC(2026, 3, 1, 0, 0, 0),
  });
  const result = svc.activate({email:'test@example.com', serial:'BRIDGE-TEST'});
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status.enabled, true);
  assert.strictEqual(result.status.canRun, true);
  assert.match(result.message, /invalid/i);
});

test('signed offline license activates core features by email', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-license-')), 'license.json');
  const now = Date.UTC(2026, 3, 29, 0, 0, 0);
  const expiresAt = '2031-04-29T00:00:00.000Z';
  const key = license.createLicenseKey({
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    name: 'Zes',
    email: 'kms5622@gmail.com',
    plan: 'Personal',
    expiresAt,
  });
  assert.match(key, /^BPLUS1\./);
  const svc = license.createDemoLicenseService({
    storePath,
    now: () => now,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  });

  const result = svc.activate({ email: 'KMS5622@gmail.com', serial: key });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status.state, 'licensed');
  assert.strictEqual(result.status.canRun, true);
  assert.strictEqual(result.status.name, 'Zes');
  assert.strictEqual(result.status.email, 'kms5622@gmail.com');
  assert.strictEqual(result.status.expiresAt, expiresAt);
});

test('signed offline license rejects mismatched email', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-license-')), 'license.json');
  const key = license.createLicenseKey({
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    name: 'Zes',
    email: 'kms5622@gmail.com',
    expiresAt: '2031-04-29T00:00:00.000Z',
  });
  const svc = license.createDemoLicenseService({
    storePath,
    now: () => Date.UTC(2026, 3, 29, 0, 0, 0),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  });

  const result = svc.activate({ email: 'other@example.com', serial: key });
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /email/i);
});
