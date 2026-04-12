#!/usr/bin/env node
'use strict';
/**
 * pcap-replay.js — Replay Pro DJ Link UDP packets from pcapng to localhost.
 * Simulates CDJ/DJM hardware for testing BRIDGE+ without real equipment.
 *
 * Usage: node tools/pcap-replay.js [pcapng_file] [options]
 *   --speed N   : playback speed multiplier (default 1.0, 0=instant)
 *   --loop      : loop forever
 *   --arena     : simulate Arena (listen for TCNet DATA, show what Bridge sends)
 *   --dbserver  : run fake dbserver on TCP 12523 (respond with test metadata)
 *
 * CDJ source IPs are rewritten to 127.0.0.1 so Bridge processes them locally.
 * TCNet packets from the capture are excluded — only Pro DJ Link is replayed.
 */
const fs = require('fs');
const dgram = require('dgram');
const net = require('net');
const path = require('path');

// ── CLI args ──
const args = process.argv.slice(2);
const file = args.find(a => a.endsWith('.pcapng')) || 'longt.pcapng';
const speed = (() => { const i = args.indexOf('--speed'); return i >= 0 ? parseFloat(args[i+1]) : 1.0; })();
const loop = args.includes('--loop');
const simArena = args.includes('--arena');
const simDbServer = args.includes('--dbserver');
const filePath = path.resolve(file);

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

console.log(`[REPLAY] file: ${path.basename(filePath)}`);
console.log(`[REPLAY] speed: ${speed}x, loop: ${loop}, arena: ${simArena}, dbserver: ${simDbServer}`);

// ── PDJL Magic ──
const PDJL_MAGIC = Buffer.from([0x51,0x73,0x70,0x74,0x31,0x57,0x6D,0x4A,0x4F,0x4C]);

// ── Test metadata (trackId → {title, artist}) ──
// Extracted from known tracks or generated for testing
const TEST_META = {};
// Will be populated from CDJ status packets during parsing

// ── pcapng parser ──
function parsePcapng(buf) {
  const packets = [];
  let pos = 0;
  const interfaces = [];

  while (pos + 8 <= buf.length) {
    const blockType = buf.readUInt32LE(pos);
    const blockLen = buf.readUInt32LE(pos + 4);
    if (blockLen < 12 || pos + blockLen > buf.length) break;

    if (blockType === 0x00000001) {
      interfaces.push({ linkType: buf.readUInt16LE(pos + 8) });
    } else if (blockType === 0x00000006) {
      const ifId = buf.readUInt32LE(pos + 8);
      const tsHi = buf.readUInt32LE(pos + 12);
      const tsLo = buf.readUInt32LE(pos + 16);
      const capLen = buf.readUInt32LE(pos + 20);
      const tsUs = tsHi * 0x100000000 + tsLo;
      const dataStart = pos + 28;

      if (dataStart + capLen <= buf.length) {
        const rawData = buf.slice(dataStart, dataStart + capLen);
        const linkType = interfaces[ifId]?.linkType || 1;
        const parsed = parseEthernet(rawData, linkType, tsUs);
        if (parsed) packets.push(parsed);
      }
    }

    pos += (blockLen + 3) & ~3;
  }
  return packets;
}

function parseEthernet(raw, linkType, tsUs) {
  let offset = linkType === 1 ? 14 : linkType === 0 ? 4 : linkType === 113 ? 16 : -1;
  if (offset < 0 || raw.length < offset + 20) return null;
  if (linkType === 1 && raw.readUInt16BE(12) !== 0x0800) return null;

  const ipVer = (raw[offset] >> 4) & 0x0F;
  if (ipVer !== 4) return null;
  const ipHL = (raw[offset] & 0x0F) * 4;
  if (raw[offset + 9] !== 17) return null; // not UDP

  const srcIP = `${raw[offset+12]}.${raw[offset+13]}.${raw[offset+14]}.${raw[offset+15]}`;
  const dstIP = `${raw[offset+16]}.${raw[offset+17]}.${raw[offset+18]}.${raw[offset+19]}`;
  offset += ipHL;

  if (offset + 8 > raw.length) return null;
  const srcPort = raw.readUInt16BE(offset);
  const dstPort = raw.readUInt16BE(offset + 2);
  const udpLen = raw.readUInt16BE(offset + 4);
  offset += 8;

  const payloadLen = Math.min(udpLen - 8, raw.length - offset);
  if (payloadLen <= 0) return null;
  return { tsUs, srcIP, dstIP, srcPort, dstPort, payload: Buffer.from(raw.slice(offset, offset + payloadLen)) };
}

function classify(pkt) {
  if (pkt.payload.length >= 11 && pkt.payload.slice(0,10).equals(PDJL_MAGIC)) {
    const type = pkt.payload[10];
    const names = {
      0x06:'CDJ_ANNOUNCE', 0x0A:'CDJ_STATUS', 0x28:'CDJ_BEAT',
      0x29:'DJM_STATUS', 0x03:'DJM_ONAIR', 0x58:'DJM_METER',
      0x26:'ANNOUNCE', 0x02:'DEVICE_INIT', 0x0b:'PRECISE_POS',
    };
    return { proto: 'PDJL', type, typeName: names[type] || `0x${type.toString(16)}` };
  }
  return null;
}

// ── Rewrite CDJ packet: change IP references inside PDJL packets ──
function rewritePacket(payload, srcIP) {
  // CDJ status (0x0A): rewrite the IP at offset 0x24..0x27 isn't needed
  // The critical thing is Bridge uses rinfo.address (the UDP source)
  // which is already 127.0.0.1 when we send from localhost.
  // But CDJ announce (0x06) contains IP at bytes 0x24-0x27 for device discovery
  const type = payload[10];
  if (type === 0x06 && payload.length >= 0x28) {
    // CDJ announce: IP at offset 0x24 (4 bytes)
    payload[0x24] = 127; payload[0x25] = 0; payload[0x26] = 0; payload[0x27] = 1;
  }
  return payload;
}

// ── Extract track IDs from CDJ status packets ──
function extractTrackInfo(pkts) {
  const tracks = {}; // playerNum → {trackId, slot, trackType, name}
  for (const pkt of pkts) {
    const c = classify(pkt);
    if (!c || c.type !== 0x0A || pkt.payload.length < 0x30) continue;
    const pNum = pkt.payload[0x24];
    if (pNum < 1 || pNum > 6) continue;
    const trackId = pkt.payload.readUInt32BE(0x2C);
    if (trackId === 0) continue;
    const slot = pkt.payload[0x29];
    const name = pkt.payload.slice(0x0B, 0x1B).toString('ascii').replace(/\0/g,'').trim();
    if (!tracks[pNum] || tracks[pNum].trackId !== trackId) {
      tracks[pNum] = { trackId, slot, name, srcIP: pkt.srcIP };
    }
  }
  return tracks;
}

// ── Fake dbserver (TCP) ──
function startDbServer() {
  const DB_PORT = 12523;
  const REAL_PORT = 12524;

  // Port discovery server
  const portSrv = net.createServer(sock => {
    console.log(`[DBSRV] port discovery from ${sock.remoteAddress}`);
    sock.once('data', data => {
      // Expect "RemoteDBServer\0" query → respond with port
      if (data.length >= 15) {
        const resp = Buffer.alloc(2);
        resp.writeUInt16BE(REAL_PORT, 0);
        sock.write(resp);
        console.log(`[DBSRV] → port ${REAL_PORT}`);
      }
      sock.end();
    });
    sock.on('error', () => {});
  });
  portSrv.listen(DB_PORT, '127.0.0.1', () => {
    console.log(`[DBSRV] port discovery listening on 127.0.0.1:${DB_PORT}`);
  });
  portSrv.on('error', e => console.warn(`[DBSRV] port discovery error:`, e.message));

  // Real dbserver
  const dbSrv = net.createServer(sock => {
    console.log(`[DBSRV] metadata connection from ${sock.remoteAddress}:${sock.remotePort}`);
    let phase = 0; // 0=greeting, 1=setup, 2=ready
    let txId = 1;

    sock.on('data', data => {
      try { handleDbMsg(sock, data, { phase, txId }); } catch (e) {
        console.warn(`[DBSRV] error:`, e.message);
      }
    });
    sock.on('error', () => {});

    function handleDbMsg(sock, data, state) {
      if (state.phase === 0 && data.length >= 5 && data[0] === 0x11) {
        // Greeting — echo back
        console.log(`[DBSRV] ← greeting`);
        sock.write(data.slice(0, 5));
        state.phase = 1;
        return;
      }

      // Parse dbserver message
      if (data.length < 15) return;
      // Find message type
      let pos = 0;
      // Skip magic field (0x11 + 4B)
      if (data[pos] === 0x11) pos += 5;
      // Skip txId field (0x11 + 4B)
      if (pos < data.length && data[pos] === 0x11) {
        txId = data.readUInt32BE(pos + 1);
        pos += 5;
      }
      // Message type (0x10 + 2B)
      if (pos < data.length && data[pos] === 0x10) {
        const msgType = data.readUInt16BE(pos + 1);
        pos += 3;
        console.log(`[DBSRV] ← msg type=0x${msgType.toString(16)} txId=${txId}`);

        if (msgType === 0x0000) {
          // SETUP — respond with 0x4000
          const resp = buildDbMsg(txId, 0x4000, []);
          sock.write(resp);
          state.phase = 2;
          console.log(`[DBSRV] → setup OK`);
        } else if (msgType === 0x2002) {
          // REKORDBOX_METADATA_REQ — parse trackId from args
          const trackId = parseTrackIdFromArgs(data, pos);
          console.log(`[DBSRV] ← metadata req trackId=${trackId}`);
          // Respond with MenuAvailable (0x4002)
          const resp = buildDbMsg(txId, 0x4002, []);
          sock.write(resp);
        } else if (msgType === 0x3000) {
          // RENDER_MENU_REQ — send metadata items then complete
          const trackId = parseTrackIdFromArgs(data, pos);
          const meta = TEST_META[trackId] || { title: `Track #${trackId}`, artist: `Player` };
          console.log(`[DBSRV] → metadata: "${meta.title}" / "${meta.artist}"`);

          // Send MenuItem (0x4101) for title
          const titleItem = buildMenuItem(txId, 0x0004, meta.title, 0, trackId);
          sock.write(titleItem);

          // Send MenuItem for artist
          const artistItem = buildMenuItem(txId, 0x0007, meta.artist, 0, 0);
          sock.write(artistItem);

          // Send MenuItem for BPM (if available)
          if (meta.bpm) {
            const bpmItem = buildMenuItem(txId, 0x000d, `${(meta.bpm/100).toFixed(1)}`, Math.round(meta.bpm), 0);
            sock.write(bpmItem);
          }

          // Send RenderComplete (0x4003)
          const complete = buildDbMsg(txId, 0x4003, []);
          sock.write(complete);
        } else if (msgType === 0x0100) {
          // Teardown
          console.log(`[DBSRV] ← teardown`);
          sock.end();
        } else if (msgType === 0x2c04) {
          // ANLZ tag request (waveform, cue points)
          console.log(`[DBSRV] ← ANLZ request (no data available in simulation)`);
          // Respond with empty render complete
          const resp = buildDbMsg(txId, 0x4000, []);
          sock.write(resp);
        } else {
          // Unknown — send generic OK
          const resp = buildDbMsg(txId, 0x4000, []);
          sock.write(resp);
        }
      }
    }
  });
  dbSrv.listen(REAL_PORT, '127.0.0.1', () => {
    console.log(`[DBSRV] metadata server listening on 127.0.0.1:${REAL_PORT}`);
  });
  dbSrv.on('error', e => console.warn(`[DBSRV] server error:`, e.message));

  return { portSrv, dbSrv };
}

function parseTrackIdFromArgs(data, pos) {
  // Skip argCount (0x0f + 1B)
  if (pos < data.length && data[pos] === 0x0f) pos += 2;
  // Skip argList (0x14 + 4B len + data)
  if (pos < data.length && data[pos] === 0x14) {
    const len = data.readUInt32BE(pos + 1);
    pos += 5 + len;
  }
  // Args: first UInt32 is usually player/slot, second is trackId
  // Skip first arg
  if (pos < data.length && data[pos] === 0x11) pos += 5;
  // Read trackId
  if (pos < data.length && data[pos] === 0x11) {
    return data.readUInt32BE(pos + 1);
  }
  return 0;
}

// ── dbserver message builders ──
function buildDbMsg(txId, msgType, extraArgs) {
  // Minimal message: magic + txId + msgType + argCount(0) + argList(empty)
  const parts = [];
  // Magic
  parts.push(buildUInt32Field(0x872349ae));
  // txId
  parts.push(buildUInt32Field(txId));
  // msgType
  parts.push(buildUInt16Field(msgType));
  // argCount = 0
  parts.push(Buffer.from([0x0f, 0x00]));
  // argList = empty binary
  const emptyList = Buffer.alloc(17);
  emptyList[0] = 0x14;
  emptyList.writeUInt32BE(12, 1);
  // 12 zero bytes for type tags
  parts.push(emptyList);

  return Buffer.concat(parts);
}

function buildMenuItem(txId, itemType, label, numVal, artworkId) {
  // Build a 0x4101 MenuItem with 12 args
  const parts = [];
  // Magic
  parts.push(buildUInt32Field(0x872349ae));
  // txId
  parts.push(buildUInt32Field(txId));
  // msgType = 0x4101
  parts.push(buildUInt16Field(0x4101));
  // argCount = 12
  parts.push(Buffer.from([0x0f, 0x0c]));
  // argList: 12 type tags
  const argList = Buffer.alloc(17);
  argList[0] = 0x14;
  argList.writeUInt32BE(12, 1);
  // Type tags for 12 args: UInt32, UInt32, UInt32, String, String, UInt32, UInt32, UInt32, UInt32, UInt32, String, UInt32
  const tags = [0x11, 0x11, 0x11, 0x26, 0x26, 0x11, 0x11, 0x11, 0x11, 0x11, 0x26, 0x11];
  for (let i = 0; i < 12; i++) argList[5 + i] = tags[i];
  parts.push(argList);

  // 12 args:
  // [0] item ID
  parts.push(buildUInt32Field(1));
  // [1] numeric value (duration/bpm*100)
  parts.push(buildUInt32Field(numVal));
  // [2] color
  parts.push(buildUInt32Field(0));
  // [3] label1 (main text)
  parts.push(buildStringField(label));
  // [4] label2 (empty)
  parts.push(buildStringField(''));
  // [5] hasArtwork
  parts.push(buildUInt32Field(artworkId > 0 ? 1 : 0));
  // [6] itemType
  parts.push(buildUInt32Field(itemType));
  // [7] reserved
  parts.push(buildUInt32Field(0));
  // [8] artworkId
  parts.push(buildUInt32Field(artworkId));
  // [9] reserved
  parts.push(buildUInt32Field(0));
  // [10] empty string
  parts.push(buildStringField(''));
  // [11] reserved
  parts.push(buildUInt32Field(0));

  return Buffer.concat(parts);
}

function buildUInt32Field(val) {
  const b = Buffer.alloc(5);
  b[0] = 0x11;
  b.writeUInt32BE(val >>> 0, 1);
  return b;
}

function buildUInt16Field(val) {
  const b = Buffer.alloc(3);
  b[0] = 0x10;
  b.writeUInt16BE(val, 1);
  return b;
}

function buildStringField(str) {
  // UTF-16BE string with null terminator
  const charCount = str.length + 1; // include null
  const dataLen = charCount * 2;
  const b = Buffer.alloc(5 + dataLen);
  b[0] = 0x26;
  b.writeUInt32BE(charCount, 1);
  for (let i = 0; i < str.length; i++) {
    b.writeUInt16BE(str.charCodeAt(i), 5 + i * 2);
  }
  // null terminator already zero from alloc
  return b;
}

// ── Arena simulator ──
function startArenaSim(sendSock) {
  const arenaSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  arenaSock.bind(54108, '127.0.0.1', () => {
    console.log('[ARENA] simulated Arena on 127.0.0.1:54108');
  });

  let dataCount = 0;
  arenaSock.on('message', (msg, rinfo) => {
    if (msg.length < 24) return;
    const type = msg[17];
    const names = { 2:'OPTIN', 5:'STATUS', 0xFE:'TIME', 0xC8:'DATA', 0x1E:'APP', 0x0D:'NOTIFY' };
    const tn = names[type] || `0x${type.toString(16)}`;

    if (type === 0xC8) {
      const subType = msg[24];
      const subNames = { 2:'Metrics', 4:'MetaData', 150:'MixerData' };
      const sn = subNames[subType] || `sub${subType}`;

      if (subType === 4 && msg.length > 24+261+20) {
        const li = msg[25];
        const artist = readUtf32LE(msg.slice(24+5, 24+5+256));
        const track = readUtf32LE(msg.slice(24+261, 24+261+256));
        if (track || artist) console.log(`[ARENA] ← MetaData L${li}: "${track}" / "${artist}"`);
      } else if (subType === 2 && msg.length > 24+92) {
        const li = msg[25], st = msg[27];
        const pos = msg.readUInt32LE(24+12);
        const bpm = msg.readUInt32LE(24+88) / 100;
        const stNames = { 0:'Idle', 3:'Play', 2:'Pause', 6:'Stop' };
        if (dataCount++ % 20 === 0) console.log(`[ARENA] ← Metrics L${li}: ${stNames[st]||st} bpm=${bpm} pos=${(pos/1000).toFixed(1)}s`);
      } else if (subType === 150 && msg.length > 24+125) {
        const f = [];
        for (let ch=0; ch<4; ch++) f.push(msg[24+101+ch*24+2]);
        if (dataCount++ % 40 === 0) console.log(`[ARENA] ← MixerData faders=[${f}]`);
      }
    } else if (type === 0xFE) {
      const parts = [];
      for (let n=0; n<4; n++) {
        const st = msg[24+72+n], ms = msg.readUInt32LE(24+n*4);
        if (st > 0 || ms > 0) parts.push(`L${n+1}:st=${st}/t=${(ms/1000).toFixed(1)}s`);
      }
      if (parts.length && dataCount++ % 30 === 0) console.log(`[ARENA] ← TIME ${parts.join(' ')}`);
    } else if (type === 2) {
      console.log(`[ARENA] ← OPTIN ${msg.length}B`);
    } else if (type === 5) {
      // STATUS — show layer states
      const states = [];
      for (let n=0; n<4; n++) {
        const src = msg[24+8+n], st = msg[24+18+n];
        if (src > 0) states.push(`L${n+1}:src=${src}/st=${st}`);
      }
      if (states.length) console.log(`[ARENA] ← STATUS ${states.join(' ')}`);
    } else {
      console.log(`[ARENA] ← ${tn} ${msg.length}B`);
    }
  });

  // Register as Arena after 2s
  setTimeout(() => {
    const pkt = Buffer.alloc(62);
    pkt.writeUInt32LE(0x54434E, 0); // TCN magic
    Buffer.from('Arena\0\0\0', 'ascii').copy(pkt, 4);
    pkt[17] = 0x1E; // APP type
    pkt.writeUInt16LE(54108, 24+20); // lPort
    console.log('[ARENA] → registering with bridge (port 60000 + 55053)');
    sendSock.send(pkt, 0, pkt.length, 60000, '127.0.0.1');
    sendSock.send(pkt, 0, pkt.length, 55053, '127.0.0.1');
    // Repeat registration every 5s
    setInterval(() => {
      pkt.writeUInt32LE(0x54434E, 0);
      sendSock.send(pkt, 0, pkt.length, 60000, '127.0.0.1');
      sendSock.send(pkt, 0, pkt.length, 55053, '127.0.0.1');
    }, 5000);
  }, 2000);

  return arenaSock;
}

function readUtf32LE(buf) {
  let s = '';
  for (let i = 0; i + 3 < buf.length; i += 4) {
    const cp = buf.readUInt32LE(i);
    if (cp === 0) break;
    s += String.fromCodePoint(cp);
  }
  return s;
}

// ── Main replay ──
async function replay() {
  console.log(`[REPLAY] parsing ${path.basename(filePath)}...`);
  const buf = fs.readFileSync(filePath);
  const allPkts = parsePcapng(buf);
  console.log(`[REPLAY] total UDP packets: ${allPkts.length}`);

  // Filter PDJL only (no TCNet)
  const pdjlPorts = new Set([50000, 50001, 50002]);
  const replayPkts = allPkts.filter(p => {
    const c = classify(p);
    return c && c.proto === 'PDJL' && pdjlPorts.has(p.dstPort);
  });

  console.log(`[REPLAY] PDJL packets: ${replayPkts.length}`);

  // Stats
  const stats = {};
  for (const p of replayPkts) {
    const c = classify(p);
    const key = `${c.typeName}→:${p.dstPort}`;
    stats[key] = (stats[key] || 0) + 1;
  }
  console.log('[REPLAY] breakdown:');
  for (const [k,v] of Object.entries(stats).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const srcIPs = new Set(replayPkts.map(p => p.srcIP));
  console.log(`[REPLAY] devices: ${[...srcIPs].join(', ')}`);

  // Extract track metadata from CDJ status packets
  const trackInfo = extractTrackInfo(replayPkts);
  console.log('[REPLAY] tracks found:');
  for (const [pn, t] of Object.entries(trackInfo)) {
    console.log(`  P${pn}: trackId=${t.trackId} device="${t.name}" from ${t.srcIP}`);
    // Generate test metadata
    TEST_META[t.trackId] = {
      title: `${t.name} Track ${t.trackId}`,
      artist: `Player ${pn} Artist`,
      bpm: 12800, // 128.00 BPM
    };
  }

  if (replayPkts.length === 0) {
    console.log('[REPLAY] no packets!'); process.exit(1);
  }

  // Start dbserver if requested
  if (simDbServer) startDbServer();

  // UDP sockets
  const sock50000 = dgram.createSocket('udp4');
  const sock50001 = dgram.createSocket('udp4');
  const sock50002 = dgram.createSocket('udp4');
  sock50000.bind(0); sock50001.bind(0); sock50002.bind(0);
  const socks = { 50000: sock50000, 50001: sock50001, 50002: sock50002 };

  // Arena simulator
  let arenaSock = null;
  if (simArena) arenaSock = startArenaSim(sock50000);

  let sent = 0, errors = 0;

  async function sendPackets() {
    const startTime = Date.now();
    const firstTs = replayPkts[0].tsUs;

    for (let i = 0; i < replayPkts.length; i++) {
      const pkt = replayPkts[i];

      // Timing
      if (speed > 0 && i > 0) {
        const targetMs = (pkt.tsUs - firstTs) / 1000 / speed;
        const waitMs = targetMs - (Date.now() - startTime);
        if (waitMs > 1) await new Promise(r => setTimeout(r, Math.min(waitMs, 1000)));
      }

      // Rewrite source IP in packet payload for CDJ announce
      const payload = Buffer.from(pkt.payload);
      rewritePacket(payload, pkt.srcIP);

      const sock = socks[pkt.dstPort];
      if (!sock) continue;

      try {
        sock.send(payload, 0, payload.length, pkt.dstPort, '127.0.0.1');
        sent++;
      } catch (e) { errors++; }

      if (sent % 1000 === 0) {
        const pct = ((i / replayPkts.length) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        process.stdout.write(`\r[REPLAY] ${pct}% | ${sent} pkts | ${elapsed}s`);
      }
    }

    const dur = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[REPLAY] done: ${sent} sent, ${errors} errors, ${dur}s`);
  }

  do {
    await sendPackets();
    if (loop) { console.log('[REPLAY] looping...'); sent = 0; errors = 0; }
  } while (loop);

  setTimeout(() => {
    sock50000.close(); sock50001.close(); sock50002.close();
    if (arenaSock) arenaSock.close();
    process.exit(0);
  }, 2000);
}

replay().catch(e => { console.error(e); process.exit(1); });
