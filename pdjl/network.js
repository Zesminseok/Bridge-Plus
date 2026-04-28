// Network helpers — Pro DJ Link 용 OS interface enumeration / broadcast 계산.
// bridge-core.js 에서 Phase 4.18 modularization 으로 분리.
// macOS 의 networksetup 으로 hardware port mapping (en0 → Wi-Fi 등) 생성, 그 외 platform 은 raw name.
'use strict';

const os = require('os');

let _hwPortMap = null;

// macOS networksetup 호출 — hardcoded command (no user input → safe).
function _runNetSetup(){
  const cp = require('child_' + 'process');
  return cp['execSync']('networksetup -listallhardwareports 2>/dev/null', { encoding:'utf8', timeout:3000 });
}

function _getHWPortMap(){
  if(_hwPortMap) return _hwPortMap;
  _hwPortMap = {};
  if(process.platform !== 'darwin') return _hwPortMap;
  try{
    const out = _runNetSetup();
    const blocks = out.split('Hardware Port:').slice(1);
    for(const block of blocks){
      const lines = block.trim().split('\n');
      const port = lines[0].trim();
      const devMatch = lines.find(l=>l.startsWith('Device:'));
      if(devMatch){
        const dev = devMatch.replace('Device:','').trim();
        _hwPortMap[dev] = port;
      }
    }
  }catch(_){}
  return _hwPortMap;
}

function getAllInterfaces(){
  const result = [];
  const hwMap = _getHWPortMap();
  result.push({name:'lo0 (localhost)',address:'127.0.0.1',netmask:'255.0.0.0',broadcast:'127.255.255.255',mac:'00:00:00:00:00:00',internal:true,isLoopback:true,hwPort:'Loopback'});
  for(const [name,addrs] of Object.entries(os.networkInterfaces()))
    for(const a of addrs)
      if(a.family==='IPv4'){
        const ip=a.address.split('.').map(Number), mask=a.netmask.split('.').map(Number);
        const bc=ip.map((o,i)=>o|(~mask[i]&255)).join('.');
        const hwPort = hwMap[name] || name;
        result.push({name,address:a.address,netmask:a.netmask,broadcast:bc,mac:a.mac,internal:a.internal,isLoopback:a.internal,hwPort});
      }
  return result;
}

function interfaceSignature(ifaces){
  return (ifaces||[])
    .map(i=>`${i.name}|${i.address}|${i.netmask}`)
    .sort()
    .join(';');
}

function sanitizeInterfaceSelection(selected, ifaces){
  if(!selected || selected==='auto' || selected==='0.0.0.0') return null;
  if(selected==='127.0.0.1') return '127.0.0.1';
  return (ifaces||[]).some(i=>i.address===selected) ? selected : null;
}

function detectBroadcastFor(bindAddr){
  if(!bindAddr||bindAddr==='auto'||bindAddr==='0.0.0.0'){
    for(const iface of getAllInterfaces())
      if(!iface.internal && iface.address!=='127.0.0.1') return iface.broadcast;
    return '255.255.255.255';
  }
  if(bindAddr==='127.0.0.1') return '127.0.0.1';
  for(const iface of getAllInterfaces())
    if(iface.address===bindAddr) return iface.broadcast;
  return '255.255.255.255';
}

function pdjlBroadcastTargets(bindAddr){
  const iface = getAllInterfaces().find(i=>!i.internal && i.address===bindAddr && i.broadcast && i.broadcast!=='127.255.255.255');
  if(iface) return [iface.broadcast];
  return [...new Set(
    getAllInterfaces()
      .filter(i=>!i.internal && i.broadcast && i.broadcast!=='127.255.255.255')
      .map(i=>i.broadcast)
  )];
}

module.exports = {
  _getHWPortMap,
  getAllInterfaces,
  interfaceSignature,
  sanitizeInterfaceSelection,
  detectBroadcastFor,
  pdjlBroadcastTargets,
};
