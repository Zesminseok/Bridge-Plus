// Pro DJ Link compatible packet builders.
//
// DISCLAIMER: BRIDGE+ is an independent third-party application created via
// observation of network traffic and publicly available compatibility
// information. It is NOT affiliated with, endorsed by, or sponsored by
// AlphaTheta Corporation or any related entity. Identifier strings used
// below are required only for compatibility with existing equipment and
// are not used in user-facing branding contexts.

const PDJL = {
  MAGIC: Buffer.from([0x51,0x73,0x70,0x74,0x31,0x57,0x6D,0x4A,0x4F,0x4C]),
  CDJ:0x0A, DJM:0x39, DJM2:0x29, ANN:0x06,
  CDJ_BEAT:0x28,   // CDJ beat packet (port 50002, 96B) — beat timing only
  CDJ_WF:0x56,     // CDJ waveform preview (port 50002, ~1420B)
  DJM_ONAIR:0x03,  // DJM Channels On-Air (port 50001, 45B)
  DJM_METER:0x58,  // DJM VU Metering (port 50001, 524B)
};

// keepalive byte 0x24 identity — Windows 검증값 통일 (mac 도 동일).
function pdjlBridgeAnnounceId(/*platform=process.platform*/){
  return 0xBD;
}

function pdjlIdentityByteFromMac(/*mac, platform=process.platform*/){
  return 0xBD;
}

function pdjlBridgeName(platform=process.platform){
  return 'TCS-SHOWKONTROL';
}

function pdjlClaimCheckByte(macLast, seqN /*, platform=process.platform */){
  // Windows fullcap4 공식 통일 — macOS 도 동일.
  const seq = seqN & 0xFF;
  const mac = macLast & 0xFF;
  return (mac ^ ((0x57 + seq) & 0xFF)) & 0xFF;
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
  p[0x2E]=pdjlClaimCheckByte(cMAC[5]||0, seqN, platform);
  p[0x2F]=seqN&0xFF;
  // Set claim byte 0x30 to deviceId (observed compatible value, Mac/Windows 동일).
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
  // Keepalive byte 0x30 — Windows fullcap4 검증값으로 통일.
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
  // Use the subscribe capability mask expected by target devices.
  // Windows fullcap4 0xFF 로 통일 (mac 도 동일).
  p[33]=0xFF;
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
  p[0x35]=0x20;
  Buffer.from('PIONEER DJ CORP','ascii').copy(p,54,0,15);
  Buffer.from('PRODJLINK BRIDGE','ascii').copy(p,74,0,16);
  p[94]=0x43;
  return p;
}

function buildBridgeNotifyPacket(deviceId=5, platform=process.platform){
  // Single 44-byte 0x55 bridge notify (matches Pioneer Bridge captures + STC reference).
  // Identical layout on macOS and Windows.
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

function buildBridgeNotifyPacketsForDevice(deviceId=5, platform=process.platform/*, dev */){
  return [buildBridgeNotifyPacket(deviceId, platform)];
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
  buildBridgeNotifyPacketsForDevice,
  hasPDJLMagic,
  readPDJLNameField,
};
