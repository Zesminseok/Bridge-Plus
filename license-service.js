'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEMO_TOTAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const LICENSE_PREFIX = 'BPLUS1';
const DEFAULT_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAuq33vfcxGHnRSRzy1TdLMBIiAWK1ScQ3OsxZJDCHk0Y=
-----END PUBLIC KEY-----`;

function defaultStorePath(){
  if(process.env.BRIDGE_LICENSE_STORE) return process.env.BRIDGE_LICENSE_STORE;
  try{
    const { app } = require('electron');
    if(app?.getPath) return path.join(app.getPath('userData'), 'license-demo.json');
  }catch(_){}
  return path.join(os.homedir(), '.bridge-plus-license-demo.json');
}

function ensureDir(filePath){
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readStore(storePath){
  try{
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }catch(_){
    return {};
  }
}

function writeStore(storePath, data){
  ensureDir(storePath);
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

function toIso(ms){
  return new Date(ms).toISOString();
}

function clampInt(n, lo, hi){
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function normalizeEmail(email){
  return String(email||'').trim().toLowerCase();
}

function b64urlEncode(input){
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(input){
  const s = String(input||'').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - s.length % 4) % 4), 'base64');
}

function stablePayload(payload){
  const out = {
    product: String(payload.product || 'BRIDGE+'),
    name: String(payload.name || '').trim(),
    email: normalizeEmail(payload.email),
    plan: String(payload.plan || 'Personal'),
    issuedAt: payload.issuedAt ? new Date(payload.issuedAt).toISOString() : new Date().toISOString(),
    expiresAt: new Date(payload.expiresAt).toISOString(),
    features: Array.isArray(payload.features) ? payload.features.map(String).sort() : ['bridge', 'hardware', 'tcnet'],
  };
  if(!out.name) throw new Error('license name is required');
  if(!out.email || !out.email.includes('@')) throw new Error('valid license email is required');
  if(!Number.isFinite(Date.parse(out.expiresAt))) throw new Error('valid expiresAt is required');
  return out;
}

function createLicenseKey({ privateKeyPem, ...payload }={}){
  if(!privateKeyPem) throw new Error('privateKeyPem is required');
  const body = stablePayload(payload);
  const json = JSON.stringify(body);
  const payloadB64 = b64urlEncode(json);
  const sig = crypto.sign(null, Buffer.from(json), crypto.createPrivateKey(privateKeyPem));
  return `${LICENSE_PREFIX}.${payloadB64}.${b64urlEncode(sig)}`;
}

function verifyLicenseKey(serial, publicKeyPem=DEFAULT_PUBLIC_KEY_PEM){
  try{
    const parts = String(serial||'').trim().split('.');
    if(parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return { ok:false, message:'Invalid license key format.' };
    const jsonBuf = b64urlDecode(parts[1]);
    const sig = b64urlDecode(parts[2]);
    const ok = crypto.verify(null, jsonBuf, crypto.createPublicKey(publicKeyPem), sig);
    if(!ok) return { ok:false, message:'License signature is invalid.' };
    const payload = JSON.parse(jsonBuf.toString('utf8'));
    return { ok:true, payload: stablePayload(payload) };
  }catch(e){
    return { ok:false, message:e.message || 'License key could not be verified.' };
  }
}

function createDemoLicenseService(options={}){
  const storePath = options.storePath || defaultStorePath();
  const nowFn = typeof options.now === 'function' ? options.now : Date.now;
  const publicKeyPem = options.publicKeyPem || DEFAULT_PUBLIC_KEY_PEM;

  function nowMs(){
    const n = Number(nowFn());
    return Number.isFinite(n) ? n : Date.now();
  }

  function loadOrInit(){
    const now = nowMs();
    const data = readStore(storePath);
    let firstRunMs = Date.parse(data.firstRunAt || '');
    if(!Number.isFinite(firstRunMs)){
      firstRunMs = now;
      writeStore(storePath, {
        firstRunAt: toIso(firstRunMs),
        lastCheckedAt: toIso(now),
      });
      return { firstRunMs, lastCheckedMs: now };
    }
    const lastCheckedMs = Date.parse(data.lastCheckedAt || '') || firstRunMs;
    if(now > lastCheckedMs){
      writeStore(storePath, {
        ...data,
        firstRunAt: toIso(firstRunMs),
        lastCheckedAt: toIso(now),
      });
    }
    return { firstRunMs, lastCheckedMs };
  }

  function getStatus(){
    const now = nowMs();
    const store = readStore(storePath);
    if(store.licenseKey){
      const verified = verifyLicenseKey(store.licenseKey, publicKeyPem);
      if(verified.ok){
        const p = verified.payload;
        const expiresMs = Date.parse(p.expiresAt);
        if(now < expiresMs){
          return {
            enabled: true,
            state: 'licensed',
            canRun: true,
            plan: p.plan,
            name: p.name,
            email: p.email,
            serial: 'configured',
            firstRunAt: store.firstRunAt || null,
            issuedAt: p.issuedAt,
            expiresAt: p.expiresAt,
            features: p.features,
            daysRemaining: clampInt(Math.ceil((expiresMs - now) / DAY_MS), 0, 36500),
            activations: null,
            lastCheckedAt: toIso(now),
            message: `Licensed to ${p.name} <${p.email}>.`,
          };
        }
        return {
          enabled: true,
          state: 'license_expired',
          canRun: false,
          plan: p.plan,
          name: p.name,
          email: p.email,
          serial: 'configured',
          issuedAt: p.issuedAt,
          expiresAt: p.expiresAt,
          features: p.features,
          daysRemaining: 0,
          activations: null,
          lastCheckedAt: toIso(now),
          message: 'License expired. Core bridge features are disabled.',
        };
      }
    }
    const { firstRunMs } = loadOrInit();
    const expiresMs = firstRunMs + DEMO_TOTAL_DAYS * DAY_MS;
    const remainingMs = Math.max(0, expiresMs - now);
    const daysRemaining = clampInt(Math.ceil(remainingMs / DAY_MS), 0, DEMO_TOTAL_DAYS);
    const canRun = now < expiresMs;
    return {
      enabled: true,
      state: canRun ? 'demo' : 'expired',
      canRun,
      plan: 'Demo',
      email: '',
      serial: '',
      firstRunAt: toIso(firstRunMs),
      expiresAt: toIso(expiresMs),
      demoTotalDays: DEMO_TOTAL_DAYS,
      daysRemaining,
      activations: null,
      lastCheckedAt: toIso(now),
      message: canRun
        ? `Demo build: ${daysRemaining} day${daysRemaining===1?'':'s'} remaining.`
        : `${DEMO_TOTAL_DAYS}일 데모가 종료되었습니다. 테스트 해주셔서 감사합니다.`,
    };
  }

  function activate(input={}){
    const email = String(input.email||'').trim();
    const serial = String(input.serial||'').trim();
    const verified = verifyLicenseKey(serial, publicKeyPem);
    if(!verified.ok){
      return {
        ok: false,
        message: verified.message,
        status: { ...getStatus(), email: normalizeEmail(email), serial: serial ? 'invalid' : '' },
      };
    }
    const payload = verified.payload;
    if(normalizeEmail(email) !== payload.email){
      return {
        ok: false,
        message: 'License email does not match.',
        status: { ...getStatus(), email: normalizeEmail(email), serial: 'mismatch' },
      };
    }
    if(nowMs() >= Date.parse(payload.expiresAt)){
      return {
        ok: false,
        message: 'License expired. Core bridge features are disabled.',
        status: { ...getStatus(), email: payload.email, serial: 'expired' },
      };
    }
    const store = readStore(storePath);
    writeStore(storePath, {
      ...store,
      licenseKey: serial,
      licenseActivatedAt: toIso(nowMs()),
    });
    return {
      ok: true,
      message: `Licensed to ${payload.name} <${payload.email}>.`,
      status: getStatus(),
    };
  }

  function deactivate(){
    const store = readStore(storePath);
    delete store.licenseKey;
    delete store.licenseActivatedAt;
    writeStore(storePath, store);
    return {
      ok: true,
      message: 'License removed. Demo status restored.',
      status: getStatus(),
    };
  }

  function refresh(){
    return {
      ok: true,
      message: getStatus().message,
      status: getStatus(),
    };
  }

  return {
    getStatus,
    activate,
    deactivate,
    refresh,
  };
}

const defaultService = createDemoLicenseService();

module.exports = {
  DEMO_TOTAL_DAYS,
  DEFAULT_PUBLIC_KEY_PEM,
  LICENSE_PREFIX,
  normalizeEmail,
  createLicenseKey,
  verifyLicenseKey,
  createDemoLicenseService,
  getStatus: defaultService.getStatus,
  activate: defaultService.activate,
  deactivate: defaultService.deactivate,
  refresh: defaultService.refresh,
};
