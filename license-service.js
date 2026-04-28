'use strict';

const LICENSE_SYSTEM_ENABLED = false;

const DISABLED_STATUS = Object.freeze({
  enabled: LICENSE_SYSTEM_ENABLED,
  state: 'disabled',
  canRun: true,
  plan: 'Test build',
  email: '',
  serial: '',
  expiresAt: null,
  activations: null,
  lastCheckedAt: null,
  message: 'License system disabled in test builds.',
});

function getStatus(){
  return {...DISABLED_STATUS};
}

function activate(input={}){
  const email = String(input.email||'').trim();
  const serial = String(input.serial||'').trim();
  return {
    ok: false,
    message: DISABLED_STATUS.message,
    status: {...DISABLED_STATUS, email, serial: serial ? 'configured' : ''},
  };
}

function deactivate(){
  return {
    ok: true,
    message: DISABLED_STATUS.message,
    status: getStatus(),
  };
}

function refresh(){
  return {
    ok: true,
    message: DISABLED_STATUS.message,
    status: getStatus(),
  };
}

module.exports = {
  LICENSE_SYSTEM_ENABLED,
  getStatus,
  activate,
  deactivate,
  refresh,
};
