// Pro DJ Link 패킷 빌더 — bridge-core.js 에서 추출 (Phase 4.8 modularization).
// 순수 함수 + 상수 (네트워크/소켓 의존성 없음).

const PDJL = {
  MAGIC: Buffer.from([0x51,0x73,0x70,0x74,0x31,0x57,0x6D,0x4A,0x4F,0x4C]),
  CDJ:0x0A, DJM:0x39, DJM2:0x29, ANN:0x06,
  CDJ_BEAT:0x28,   // CDJ beat packet (port 50002, 96B) — beat timing only
  CDJ_WF:0x56,     // CDJ waveform preview (port 50002, ~1420B)
  DJM_ONAIR:0x03,  // DJM Channels On-Air (port 50001, 45B)
  DJM_METER:0x58,  // DJM VU Metering (port 50001, 524B)
};

// keepalive byte 0x24 identity — 검증된 고정값 (random 시도 시 Windows 연결 실패).
//   Windows: 0xBD — DJM 연결 성공
//   Mac    : 0xDA — 과거 정상 동작 이력 유지
function pdjlBridgeAnnounceId(platform=process.platform){
  return platform==='darwin' ? 0xDA : 0xBD;
}

function pdjlIdentityByteFromMac(mac, platform=process.platform){
  return pdjlBridgeAnnounceId(platform);
}

function pdjlBridgeName(platform=process.platform){
  return 'TCS-SHOWKONTROL';
}

function buildPdjlBridgeHelloPacket(deviceId=5, platform=process.platform){
  const p=Buffer.alloc(37);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x0A;
  p[0x0B]=0x00;
  Buffer.from(pdjlBridgeName(platform),'ascii').copy(p,0x0C,0,15);
  p[0x20]=0x01;
  p[0x21]=0x01;
  p[0x22]=0x00;
  p[0x23]=0x25;
  p[0x24]=deviceId&0xFF;
  return p;
}

function buildPdjlBridgeClaimPacket(annIP, annMAC, seqN=1, deviceId=5, platform=process.platform){
  const cIP=String(annIP||'0.0.0.0').split('.').map(Number);
  const cMAC=String(annMAC||'00:00:00:00:00:00').split(':').map(h=>parseInt(h,16));
  const p=Buffer.alloc(50);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x02;
  p[0x0B]=0x00;
  Buffer.from(pdjlBridgeName(platform),'ascii').copy(p,0x0C,0,15);
  p[0x20]=0x01;
  p[0x21]=0x01;
  p[0x22]=0x00;
  p[0x23]=0x32;
  for(let i=0;i<4;i++) p[0x24+i]=cIP[i]||0;
  for(let i=0;i<6;i++) p[0x28+i]=cMAC[i]||0;
  // pcap 확정: Pioneer 공식 브리지 claim byte 0x2E checksum
  //   Mac/Win 공통 공식: MAC[5] XOR (0x57 + seqN)
  //   예: MAC[5]=0xB2, seqN=1 → 0xB2^0x58 = 0xEA (win-bridge.pcapng 일치)
  //   (0424_.pcapng 의 다른 공식은 세션마다 달라 신뢰 불가 — 과거 정상 동작 공식 유지)
  p[0x2E]=((cMAC[5]||0) ^ ((0x57 + seqN) & 0xFF)) & 0xFF;
  p[0x2F]=seqN&0xFF;
  // pcap 확정: Pioneer 공식 브리지 claim byte 0x30 = deviceId (Mac/Windows 동일)
  p[0x30]=deviceId&0xFF;
  p[0x31]=0x00;
  return p;
}

function buildPdjlBridgeKeepalivePacket(annIP, annMAC, deviceId=5, platform=process.platform){
  const aIP=String(annIP||'0.0.0.0').split('.').map(Number);
  const aMAC=String(annMAC||'00:00:00:00:00:00').split(':').map(h=>parseInt(h,16));
  const p=Buffer.alloc(54);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x06;
  p[0x0B]=0x00;
  Buffer.from(pdjlBridgeName(platform),'ascii').copy(p,0x0C,0,15);
  p[0x20]=0x01;
  p[0x21]=0x01;
  p[0x22]=0x00;
  p[0x23]=0x36;
  p[0x24]=pdjlIdentityByteFromMac(annMAC, platform);
  p[0x25]=0x00;
  for(let i=0;i<6;i++) p[0x26+i]=aMAC[i]||0;
  for(let i=0;i<4;i++) p[0x2C+i]=aIP[i]||0;
  // pcap 확정: keepalive byte 0x30
  //   Mac (ceo_2): 0x07, (0424_/mac_pioneer): 0x08 — 세션마다 변동
  //   Windows (fullcap4): 0x08
  // 가장 최근 mac_pioneer (DJM 작동 확정) + Win = 0x08 → 통일.
  p[0x30]=0x08;
  p[0x34]=deviceId&0xFF;
  p[0x35]=0x20;
  return p;
}

function buildDjmSubscribePacket(platform=process.platform){
  const p=Buffer.alloc(40);
  PDJL.MAGIC.copy(p,0);
  p[10]=0x57;
  Buffer.from(pdjlBridgeName(platform),'ascii').copy(p,11,0,15);
  p[31]=0x01;
  p[32]=0x00;
  // pcap 확정: 0x57 subscribe byte 33 bitmask
  //   Mac    (ceo_2):    0xE1 (fader + VU + onair)
  //   Windows (fullcap4): 0xFF (전체 subscribe)
  p[33]=platform==='darwin' ? 0xE1 : 0xFF;
  p[34]=0x00;
  p[35]=0x04;
  p[36]=0x01;
  return p;
}

function buildDbServerKeepalivePacket(annIP, annMAC, deviceId=5, platform=process.platform){
  const aIP=String(annIP||'0.0.0.0').split('.').map(Number);
  const aMAC=String(annMAC||'00:00:00:00:00:00').split(':').map(h=>parseInt(h,16));
  const p=Buffer.alloc(95);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x06;
  const bridgeName = pdjlBridgeName(platform);
  Buffer.from(bridgeName,'ascii').copy(p,0x0C,0,Math.min(bridgeName.length, 20));
  p[0x20]=0x01;
  p[0x21]=0x01;
  p[0x23]=0x36;
  p[0x24]=deviceId&0xFF;
  for(let i=0;i<6;i++) p[0x26+i]=aMAC[i]||0;
  for(let i=0;i<4;i++) p[0x2C+i]=aIP[i]||0;
  p[0x35]=0x64;
  Buffer.from('PIONEER DJ CORP','ascii').copy(p,54,0,15);
  Buffer.from('PRODJLINK BRIDGE','ascii').copy(p,74,0,16);
  p[94]=0x43;
  return p;
}

function buildBridgeNotifyPacket(deviceId=5, platform=process.platform){
  const p=Buffer.alloc(44);
  PDJL.MAGIC.copy(p,0);
  p[0x0A]=0x55;
  Buffer.from(pdjlBridgeName(platform),'ascii').copy(p,0x0B,0,15);
  p[31]=0x01;
  p[32]=0x00;
  p[33]=0x8B;
  p[34]=0x08;
  p[39]=0x01;
  p[40]=deviceId&0xFF;
  p[41]=0x01;
  p[42]=0x03;
  p[43]=0x01;
  return p;
}

function hasPDJLMagic(msg){
  if(!msg || msg.length < PDJL.MAGIC.length) return false;
  for(let i=0;i<PDJL.MAGIC.length;i++) if(msg[i]!==PDJL.MAGIC[i]) return false;
  return true;
}

function readPDJLNameField(msg){
  if(!msg || msg.length <= 0x0B) return '';
  const end = Math.min(0x1B, msg.length);
  if(end <= 0x0B) return '';
  return msg.slice(0x0B, end).toString('ascii').replace(/\0/g,'').trim();
}

module.exports={
  PDJL,
  pdjlBridgeAnnounceId,
  pdjlIdentityByteFromMac,
  pdjlBridgeName,
  buildPdjlBridgeHelloPacket,
  buildPdjlBridgeClaimPacket,
  buildPdjlBridgeKeepalivePacket,
  buildDjmSubscribePacket,
  buildDbServerKeepalivePacket,
  buildBridgeNotifyPacket,
  hasPDJLMagic,
  readPDJLNameField,
};
