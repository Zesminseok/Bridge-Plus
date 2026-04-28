// 네트워크 인터페이스 선택 helper — bridge-core.js 에서 추출 (Phase 5.9).
// 순수 함수 + 인스턴스 상태 의존이 적은 유틸. 동작 보존.
'use strict';

// 169.254.x.x — RFC 3927 link-local 주소.
function isLinkLocalIp(ip){
  return typeof ip==='string' && ip.startsWith('169.254.');
}

// 원격 IP 와 같은 서브넷에 있는 로컬 인터페이스 찾기 (CIDR mask 적용).
function findLocalIfaceForRemote(remoteIp, getAllInterfaces){
  if(!remoteIp) return null;
  const parts = remoteIp.split('.').map(Number);
  if(parts.length !== 4 || parts.some(n=>!(n>=0&&n<=255))) return null;
  for(const iface of getAllInterfaces()){
    if(iface.internal || !iface.netmask || !iface.address) continue;
    if(iface.address==='127.0.0.1') continue;
    const iIP = iface.address.split('.').map(Number);
    const mask = iface.netmask.split('.').map(Number);
    if(iIP.length!==4 || mask.length!==4) continue;
    let match = true;
    for(let i=0;i<4;i++){
      if((iIP[i] & mask[i]) !== (parts[i] & mask[i])){ match = false; break; }
    }
    if(match) return iface;
  }
  return null;
}

// auto 모드일 때 PDJL 인터페이스 자동 선택.
//   Windows: link-local 우선 (169.254.x — DJM 이 link-local 에 자주 있음)
//   기타: localAddr 우선 → 첫 non-internal iface fallback
function pickAutoPdjlIface(localAddr, getAllInterfaces){
  const ifaces = getAllInterfaces().filter(iface=>!iface.internal && iface.address && iface.address!=='127.0.0.1');
  if(!ifaces.length) return null;
  if(process.platform==='win32'){
    const linkLocal = ifaces.find(iface=>isLinkLocalIp(iface.address));
    if(linkLocal) return linkLocal;
  }
  if(localAddr){
    const localMatch = ifaces.find(iface=>iface.address===localAddr);
    if(localMatch) return localMatch;
  }
  return ifaces[0] || null;
}

// Windows + auto 모드일 때 PDJL announce 를 약간 지연시킬지 — DJM/CDJ 발견 후 link-local 매칭.
function shouldDelayWinAutoPdjl(pdjlBindAddr){
  return process.platform==='win32'
    && (!pdjlBindAddr || pdjlBindAddr==='auto' || pdjlBindAddr==='0.0.0.0');
}

module.exports = {
  isLinkLocalIp,
  findLocalIfaceForRemote,
  pickAutoPdjlIface,
  shouldDelayWinAutoPdjl,
};
