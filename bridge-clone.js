/**
 * DJ Link Bridge Clone — Prototype
 * 
 * 캡처된 실제 Bridge 패킷 구조를 기반으로 만든 TCNet 송신기.
 * CDJ의 Pro DJ Link 데이터를 읽어 TCNet으로 변환하여 Resolume Arena에 전송합니다.
 * 
 * 사용법:
 *   node bridge-clone.js [--interface eth0] [--broadcast 192.168.0.255]
 * 
 * 의존성:
 *   npm install
 */

const dgram = require('dgram');
const os = require('os');

// ============================================================
// TCNet 프로토콜 상수 (캡처에서 추출)
// ============================================================
const TCNET = {
  MAGIC: Buffer.from('TCN'),           // 매직 바이트
  VERSION: Buffer.from([0x03, 0x05]),   // v3.5
  
  // 메시지 타입
  MSG_OPTIN:   0x02,
  MSG_OPTOUT:  0x03, 
  MSG_STATUS:  0x05,
  MSG_DATA:    0xC8,  // 200
  MSG_TIME:    0xFE,  // 254
  
  // 포트
  PORT_BROADCAST: 60000,   // OptIn, Status 브로드캐스트
  PORT_TIME:      60001,   // Time 패킷 브로드캐스트
  PORT_UNICAST:   60002,   // Data 패킷 유니캐스트
  
  // Bridge 신원 (캡처에서 정확히 추출)
  NODE_ID:      Buffer.from([0x7B, 0xFF]),
  NODE_NAME:    'BRIDGE29',              // 8자 패딩
  NODE_TYPE:    0x02,                     // Master
  NODE_OPTIONS: Buffer.from([0x07, 0x00]),
  VENDOR_NAME:  'PIONEER DJ CORP',       // 16자
  DEVICE_NAME:  'PRODJLINK BRIDGE',      // 16자
  APP_VERSION:  { major: 1, minor: 1, bug: 67 },
  
  // 패킷 크기
  HEADER_SIZE:  24,
  OPTIN_SIZE:   68,
  STATUS_SIZE:  300,
  TIME_SIZE:    154,
};

// ============================================================
// TCNet 헤더 빌더
// ============================================================
class TCNetHeader {
  constructor() {
    this.sequence = 0;
  }
  
  /**
   * 24바이트 공통 헤더 생성
   */
  build(messageType) {
    const buf = Buffer.alloc(TCNET.HEADER_SIZE);
    
    // NodeID (2B)
    TCNET.NODE_ID.copy(buf, 0);
    // Version (2B)
    TCNET.VERSION.copy(buf, 2);
    // Magic "TCN" (3B)
    TCNET.MAGIC.copy(buf, 4);
    // MessageType (1B)
    buf[7] = messageType;
    // NodeName (8B)
    buf.write(TCNET.NODE_NAME.padEnd(8, '\0'), 8, 8, 'ascii');
    // Sequence (1B)
    buf[16] = this.sequence++ & 0xFF;
    // NodeType (1B) — Master
    buf[17] = TCNET.NODE_TYPE;
    // NodeOptions (2B)
    TCNET.NODE_OPTIONS.copy(buf, 18);
    // Timestamp (4B, LE) — 마이크로초
    buf.writeUInt32LE(this.getMicroseconds(), 20);
    
    return buf;
  }
  
  getMicroseconds() {
    // 프로세스 uptime 기반 — uint32 범위 내로 제한 (최대 4,294,967,295)
    const hrtime = process.hrtime();
    const us = (hrtime[0] * 1000000 + Math.floor(hrtime[1] / 1000));
    return us % 0xFFFFFFFF;
  }
}

// ============================================================
// OptIn 패킷 빌더
// ============================================================
function buildOptInPacket(header, listenerPort, uptime, nodeCount) {
  const buf = Buffer.alloc(TCNET.OPTIN_SIZE);
  
  // 공통 헤더 (24B)
  header.build(TCNET.MSG_OPTIN).copy(buf, 0);
  
  // OptIn Body (44B)
  const body = buf.slice(24);
  
  // NodeCount (2B, LE)
  body.writeUInt16LE(nodeCount || 1, 0);
  // ListenerPort (2B, LE) 
  body.writeUInt16LE(listenerPort || 65156, 2);
  // Uptime (2B, LE) — 초
  body.writeUInt16LE(uptime || 0, 4);
  // 패딩 (2B)
  body.writeUInt16LE(0, 6);
  // VendorName (16B)
  body.write(TCNET.VENDOR_NAME.padEnd(16, '\0'), 8, 16, 'ascii');
  // DeviceName (16B)
  body.write(TCNET.DEVICE_NAME.padEnd(16, '\0'), 24, 16, 'ascii');
  // Version Major
  body[40] = TCNET.APP_VERSION.major;
  // Version Minor
  body[41] = TCNET.APP_VERSION.minor;
  // Version Bug
  body[42] = TCNET.APP_VERSION.bug;
  // 패딩
  body[43] = 0x00;
  
  return buf;
}

// ============================================================
// Status 패킷 빌더 (300 bytes)
// ============================================================
function buildStatusPacket(header, listenerPort) {
  const buf = Buffer.alloc(TCNET.STATUS_SIZE);
  
  // 공통 헤더
  header.build(TCNET.MSG_STATUS).copy(buf, 0);
  
  // Status body (캡처에서 추출한 구조)
  const body = buf.slice(24);
  body.writeUInt16LE(1, 0);                // NodeCount
  body.writeUInt16LE(listenerPort, 2);     // ListenerPort
  body.writeUInt32LE(0, 4);                // 패딩
  body[8] = 0x01;                          // 레이어 설정
  body[9] = 0x02;
  body[10] = 0x03;
  body[11] = 0x04;
  
  // 프레임레이트
  body[59] = 0x1E;  // 30fps
  
  // DeviceName at offset 96 from body start (120 from packet start)
  body.write(TCNET.DEVICE_NAME.padEnd(16, '\0'), 96, 16, 'ascii');
  
  return buf;
}

// ============================================================
// Time 패킷 빌더 (154 bytes) — 핵심!
// ============================================================
function buildTimePacket(header, layers) {
  const buf = Buffer.alloc(TCNET.TIME_SIZE);
  
  // 공통 헤더
  header.build(TCNET.MSG_TIME).copy(buf, 0);
  
  // Time body (130B)
  const body = buf.slice(24);
  
  // Layer 1 데이터 (캡처에서 확인된 구조)
  if (layers[0]) {
    const L = layers[0];
    body.writeUInt32LE(L.totalLength || 0x1B, 0);    // Layer 총 길이 ID
    body.writeUInt32LE(L.trackId || 0x0913, 4);       // 트랙 식별자
    body.writeUInt32LE(L.timecodeMs || 0, 8);         // ★ 타임코드 (밀리초) ★
    body.writeUInt32LE(L.totalLength || 0x1B, 12);    // 반복 또는 추가 데이터
  }
  
  // Layer 2~4 (offset 14~55): 현재 빈 상태 유지
  
  // 레이어 메타 정보 (offset 65~)
  body[65] = layers.filter(l => l).length;  // 활성 레이어 수
  body[66] = layers[0]?.state || 0;          // ★ 재생 상태 ★
  // 0 = 정지, 1 = 재생, 3 = 큐잉, 4 = 로딩
  
  // Layer 상태 바이트 (offset 72~75)
  body[72] = layers[0] ? 0x07 : 0x00;
  body[73] = layers[0] ? 0x06 : 0x00;
  body[74] = layers[0]?.beatPhase || 0x00;   // 비트 위치? 변화하는 값
  body[75] = layers[0] ? 0x06 : 0x00;
  
  // 타임코드 설정 (offset 80~)
  body[80] = 0x01;   // 타임코드 타입
  body[81] = 0x1E;   // 프레임레이트 30fps
  
  return buf;
}

// ============================================================
// Data 패킷 빌더 (기본 상태 122 bytes)
// ============================================================
function buildDataPacket(header, layerIndex, trackInfo) {
  const size = 122;
  const buf = Buffer.alloc(size);
  
  header.build(TCNET.MSG_DATA).copy(buf, 0);
  
  const body = buf.slice(24);
  body[0] = 0x02;  // 데이터 타입
  body[1] = layerIndex || 0x01;
  body[3] = 0x07;  // 레이어 수
  body[5] = 0x03;  // 상태
  
  body[21] = 0x1E;  // 프레임레이트
  
  // BPM (offset 88 from body, bytes 112-115 from packet)
  if (trackInfo?.bpm) {
    // BPM을 밀리BPM으로 (예: 128.00 → 12800)
    body.writeUInt16LE(Math.round(trackInfo.bpm * 100), 88);
  }
  
  return buf;
}

// ============================================================
// 메인 Bridge Clone 클래스
// ============================================================
class BridgeClone {
  constructor(options = {}) {
    this.broadcastAddr = options.broadcast || '192.168.0.255';
    this.interfaceName = options.interface || null;
    this.listenerPort = options.listenerPort || 65156;
    
    this.header = new TCNetHeader();
    this.socket = null;
    this.startTime = Date.now();
    
    // 현재 상태
    this.layers = [
      null, // Layer 1
      null, // Layer 2
      null, // Layer 3
      null, // Layer 4
    ];
    
    // 타이머
    this.optinTimer = null;
    this.statusTimer = null;
    this.timeTimer = null;
    
    this.running = false;
  }
  
  /**
   * 네트워크 인터페이스 자동 감지
   */
  detectBroadcast() {
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (this.interfaceName && name !== this.interfaceName) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          // 브로드캐스트 주소 계산
          const ip = addr.address.split('.').map(Number);
          const mask = addr.netmask.split('.').map(Number);
          const broadcast = ip.map((octet, i) => octet | (~mask[i] & 255));
          console.log(`[네트워크] ${name}: ${addr.address} → 브로드캐스트 ${broadcast.join('.')}`);
          return broadcast.join('.');
        }
      }
    }
    return '255.255.255.255';
  }
  
  /**
   * Bridge Clone 시작
   */
  async start() {
    console.log('=== DJ Link Bridge Clone ===');
    console.log('캡처 기반 TCNet 프로토콜 구현');
    console.log('');
    
    // 브로드캐스트 주소 감지
    if (!this.broadcastAddr || this.broadcastAddr === 'auto') {
      this.broadcastAddr = this.detectBroadcast();
    }
    
    // UDP 소켓 생성
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    this.socket.on('error', (err) => {
      console.error(`[에러] ${err.message}`);
    });
    
    await new Promise((resolve) => {
      this.socket.bind(() => {
        this.socket.setBroadcast(true);
        console.log(`[시작] 브로드캐스트: ${this.broadcastAddr}`);
        resolve();
      });
    });
    
    this.running = true;
    
    // OptIn keep-alive (매 1초)
    this.sendOptIn();
    this.optinTimer = setInterval(() => this.sendOptIn(), 1000);
    
    // Status (매 2초)
    this.sendStatus();
    this.statusTimer = setInterval(() => this.sendStatus(), 2000);
    
    // Time 패킷 (30fps = 매 33ms)
    this.timeTimer = setInterval(() => this.sendTime(), 33);
    
    console.log('[실행중] OptIn(1s) + Status(2s) + Time(30fps)');
    console.log('[실행중] Resolume에서 Pioneer DJ TCNet을 활성화하세요');
    console.log('');
    
    return this;
  }
  
  /**
   * 정지
   */
  stop() {
    this.running = false;
    clearInterval(this.optinTimer);
    clearInterval(this.statusTimer);
    clearInterval(this.timeTimer);
    
    // OptOut 전송
    const buf = Buffer.alloc(24);
    this.header.build(TCNET.MSG_OPTOUT).copy(buf, 0);
    this.send(buf, TCNET.PORT_BROADCAST);
    
    setTimeout(() => {
      this.socket?.close();
      console.log('[종료] Bridge Clone 정지');
    }, 200);
  }
  
  // ---- 패킷 전송 ----
  
  sendOptIn() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const pkt = buildOptInPacket(this.header, this.listenerPort, uptime, 1);
    this.send(pkt, TCNET.PORT_BROADCAST);
  }
  
  sendStatus() {
    const pkt = buildStatusPacket(this.header, this.listenerPort);
    this.send(pkt, TCNET.PORT_BROADCAST);
  }
  
  sendTime() {
    const pkt = buildTimePacket(this.header, this.layers);
    this.send(pkt, TCNET.PORT_TIME);
  }
  
  send(buffer, port) {
    if (!this.running || !this.socket) return;
    this.socket.send(buffer, 0, buffer.length, port, this.broadcastAddr, (err) => {
      if (err) console.error(`[전송 에러] port ${port}: ${err.message}`);
    });
  }
  
  // ---- 외부 API ----
  
  /**
   * CDJ 레이어 상태 업데이트 (Pro DJ Link에서 읽은 데이터)
   * 
   * @param {number} layerIndex - 0~3 (CDJ 1~4)
   * @param {object} data
   * @param {number} data.timecodeMs - 현재 재생 위치 (밀리초)
   * @param {number} data.state - 0=정지, 1=재생, 3=큐잉, 4=로딩
   * @param {number} data.bpm - 현재 BPM
   * @param {number} data.trackId - 트랙 식별자
   * @param {number} data.totalLength - 트랙 전체 길이 (밀리초)
   * @param {string} data.trackName - 트랙명
   * @param {string} data.artistName - 아티스트명
   */
  updateLayer(layerIndex, data) {
    if (layerIndex < 0 || layerIndex > 3) return;
    
    this.layers[layerIndex] = {
      timecodeMs: data.timecodeMs || 0,
      state: data.state || 0,
      bpm: data.bpm || 0,
      trackId: data.trackId || 0,
      totalLength: data.totalLength || 0,
      trackName: data.trackName || '',
      artistName: data.artistName || '',
      beatPhase: data.beatPhase || 0,
    };
  }
  
  /**
   * CDJ 레이어 제거 (연결 해제)
   */
  removeLayer(layerIndex) {
    if (layerIndex >= 0 && layerIndex <= 3) {
      this.layers[layerIndex] = null;
    }
  }
}

// ============================================================
// 데모: 가짜 재생 시뮬레이션
// ============================================================
async function demo() {
  const args = process.argv.slice(2);
  const broadcast = args.find(a => a.startsWith('--broadcast='))?.split('=')[1];
  const iface = args.find(a => a.startsWith('--interface='))?.split('=')[1];
  
  const bridge = new BridgeClone({
    broadcast: broadcast || 'auto',
    interface: iface,
  });
  
  await bridge.start();
  
  // 데모: 2초 후 트랙 로딩 시뮬레이션
  setTimeout(() => {
    console.log('[데모] Layer 1: 트랙 로딩...');
    bridge.updateLayer(0, {
      state: 4,  // 로딩
      timecodeMs: 0,
      bpm: 128.0,
      trackId: 0x0913,
      totalLength: 240000,  // 4분
      trackName: 'Test Track',
      artistName: 'Test Artist',
    });
  }, 2000);
  
  // 4초 후 재생 시작
  let playStartTime = null;
  setTimeout(() => {
    console.log('[데모] Layer 1: 재생 시작!');
    playStartTime = Date.now();
    
    // 매 33ms마다 타임코드 업데이트 (실제로는 CDJ에서 읽어올 값)
    const playTimer = setInterval(() => {
      if (!bridge.running) { clearInterval(playTimer); return; }
      
      const elapsed = Date.now() - playStartTime;
      bridge.updateLayer(0, {
        state: 1,  // 재생중
        timecodeMs: elapsed,
        bpm: 128.0,
        trackId: 0x0913,
        totalLength: 240000,
        trackName: 'Test Track',
        artistName: 'Test Artist',
        beatPhase: Math.floor((elapsed / (60000 / 128)) % 8),
      });
      
      // 10초마다 현재 위치 출력
      if (Math.floor(elapsed / 10000) !== Math.floor((elapsed - 33) / 10000)) {
        const sec = Math.floor(elapsed / 1000);
        const ms = elapsed % 1000;
        console.log(`[재생] ${Math.floor(sec/60)}:${(sec%60).toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')} (${bridge.layers[0]?.bpm} BPM)`);
      }
    }, 33);
  }, 4000);
  
  // Ctrl+C 처리
  process.on('SIGINT', () => {
    console.log('\n[종료 요청]');
    bridge.stop();
    process.exit(0);
  });
  
  console.log('[데모] 2초 후 트랙 로딩 → 4초 후 재생 시작');
  console.log('[데모] Ctrl+C로 종료');
}

// 모듈 또는 직접 실행
if (require.main === module) {
  demo().catch(console.error);
} else {
  module.exports = { BridgeClone, TCNET, buildOptInPacket, buildStatusPacket, buildTimePacket, buildDataPacket };
}
