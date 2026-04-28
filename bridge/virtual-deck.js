'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { PDJL } = require('../pdjl/packets');

const BLANK_JPEG = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'renderer', 'assets', 'default-art.jpg'));
  } catch (e) {
    console.warn('[WARN] default-art.jpg not found, using 1x1 black JPEG fallback');
    return Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6ery8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AP0poA//2Q==', 'base64');
  }
})();

function registerVirtualDeck(core, slot, modelName){
  if(slot<0||slot>7) return;
  core.hwMode[slot] = false;
  const key = `cdj${slot+1}`;
  core.devices[key] = {
    type:'CDJ', playerNum:slot+1,
    name: modelName || 'CDJ-3000',
    ip:'127.0.0.1', lastSeen:Date.now(), virtual:true,
    state:{}
  };
  core._syncVirtualDevices();
  core.onDeviceList?.(core.devices);
}

function unregisterVirtualDeck(core, slot){
  if(slot<0||slot>7) return;
  core.hwMode[slot] = true;
  const key = `cdj${slot+1}`;
  if(core.devices[key]?.virtual) delete core.devices[key];
  core._syncVirtualDevices();
  core.onDeviceList?.(core.devices);
}

function setVirtualArt(core, slot, jpegBuf){
  if(slot<0||slot>7) return;
  core._virtualArt[slot] = jpegBuf || BLANK_JPEG;
  const isBuf = Buffer.isBuffer(jpegBuf);
  const hdr = jpegBuf ? `[${jpegBuf[0]?.toString(16)},${jpegBuf[1]?.toString(16)}]` : 'null';
  console.log(`[VDBSRV] slot ${slot} artwork stored: ${jpegBuf?.length||0}B isBuffer=${isBuf} hdr=${hdr}`);
  core._sendArtwork(slot + 1, jpegBuf);
  setTimeout(()=>core._sendArtwork(slot + 1, core._virtualArt[slot]), 500);
  setTimeout(()=>core._sendArtwork(slot + 1, core._virtualArt[slot]), 2000);
  setTimeout(()=>core._sendArtwork(slot + 1, core._virtualArt[slot]), 5000);
}

function sendVirtualCDJStatus(core, playerNum, trackId, bpm){
  if(!core._pdjlAnnSock || !trackId) return;
  try{
    const pktSize = 0x11C;
    const pkt = Buffer.alloc(pktSize);
    PDJL.MAGIC.copy(pkt, 0);
    pkt[0x0A] = PDJL.CDJ;
    pkt[0x0B] = 0x00;
    const nm = 'TCS-SHOWKONTROL';
    Buffer.from(nm,'ascii').copy(pkt, 0x0C, 0, 15);
    pkt[0x20] = 0x03; pkt[0x21] = playerNum & 0xFF;
    pkt.writeUInt16BE(pktSize - 0x24, 0x22);
    pkt[0x24] = playerNum & 0xFF;
    pkt[0x25] = 0x00;
    pkt[0x28] = playerNum & 0xFF;
    pkt[0x29] = 0x03;
    pkt[0x2A] = 0x01;
    pkt[0x2B] = 0x00;
    pkt.writeUInt32BE(trackId >>> 0, 0x2C);

    pkt[0x68] = 0x01;
    pkt[0x75] = 0x01;

    pkt[0x7B] = 0x03;
    pkt[0x89] = (playerNum === 1) ? 0x68 : 0x48;
    pkt[0x8B] = 0xFA;
    const bpmVal = Math.round((bpm||128)*100);
    pkt.writeUInt16BE(bpmVal, 0x92);
    pkt[0x8D] = 0x10; pkt[0x8E] = 0x00; pkt[0x8F] = 0x00;
    pkt[0x99] = 0x10; pkt[0x9A] = 0x00; pkt[0x9B] = 0x00;
    pkt[0xB6] = 0x01;

    try{core._pdjlAnnSock.send(pkt,0,pkt.length,50002,'127.0.0.1');}catch(_){}
    try{core._pdjlAnnSock.send(pkt,0,pkt.length,50001,'127.0.0.1');}catch(_){}
    // PERF: Arena IP 목록은 nodes 가 변할 때만 재계산 — gen counter 가 같으면 캐시 사용.
    //   nodes 변경은 tcnet-handler.registerTCNetNode 가 core._nodesGen 을 증가시킴.
    const curGen = core._nodesGen|0;
    if(core._arenaIpCacheGen !== curGen || !core._arenaIpCache){
      const ips = [];
      for(const n of Object.values(core.nodes||{})){
        if(n?.ip && n.ip!=='127.0.0.1' && (n.name?.includes('Arena') || n.vendor?.includes('Resolume'))){
          ips.push(n.ip);
        }
      }
      core._arenaIpCache = ips;
      core._arenaIpCacheGen = curGen;
    }
    const arenaIPs = core._arenaIpCache;
    for(let i=0;i<arenaIPs.length;i++){
      const ip = arenaIPs[i];
      try{core._pdjlAnnSock.send(pkt,0,pkt.length,50002,ip);}catch(_){}
      try{core._pdjlAnnSock.send(pkt,0,pkt.length,50001,ip);}catch(_){}
    }
    const _summary=`${trackId}_${bpm||128}_${pktSize}`;
    if(core._shouldLogRate(`virt_status_${playerNum}`, 10000, _summary)){
      console.log(`[PDJL-VIRT] CDJ status P${playerNum} trackId=${trackId} bpm=${bpm||128} size=${pktSize}`);
    }
  }catch(e){console.warn('[PDJL-VIRT] status send error:',e.message);}
}

function startVirtualDbServer(core){
  const REAL_PORT = 12524;

  core._dbSrv = net.createServer(sock=>{
    sock.on('error',()=>{});
    sock.once('data', d=>{
      const str = d.slice(4).toString('ascii').replace(/\0/g,'');
      if(str === 'RemoteDBServer'){
        const resp = Buffer.alloc(2);
        resp.writeUInt16BE(REAL_PORT, 0);
        sock.write(resp);
        console.log(`[VDBSRV] port discovery -> ${REAL_PORT}`);
      }
      sock.end();
    });
  });
  core._dbSrv.on('error', e=>{
    console.warn(`[VDBSRV] port 12523 bind failed: ${e.message} (rekordbox/CDJ already binding?)`);
  });
  const _vdbBindIp = (core.pdjlBindAddr && core.pdjlBindAddr !== 'auto') ? core.pdjlBindAddr : '0.0.0.0';
  core._dbSrv.listen(12523, _vdbBindIp, ()=>{
    console.log(`[VDBSRV] port discovery listening on ${_vdbBindIp}:12523`);
  });

  core._dbSrvProto = net.createServer(sock=>{
    sock.on('error',e=>console.warn('[VDBSRV] sock error:',e.message));
    console.log(`[VDBSRV] Arena connected to proto port ${REAL_PORT} from ${sock.remoteAddress}`);
    let phase = 'greeting';
    let buf = Buffer.alloc(0);

    sock.on('data', d=>{
      buf = Buffer.concat([buf, d]);

      if(phase === 'greeting'){
        if(buf.length >= 5 && buf[0] === 0x11){
          const player = buf.readUInt32BE(1);
          sock._vdbPlayer = player;
          console.log(`[VDBSRV] greeting from player ${player}`);
          sock.write(core._dbNum4(player));
          buf = buf.slice(5);
          phase = 'setup';
        }
        return;
      }

      if(phase === 'setup'){
        if(buf.length >= 15){
          const typeOff = 10;
          if(buf[typeOff] === 0x10){
            const reqType = buf.readUInt16BE(typeOff+1);
            if(reqType === 0x0000){
              const setupTxId = buf.readUInt32BE(6);
              const argc = buf[14] || 0;
              const setupLen = 15 + 5 + argc + argc * 5;
              console.log(`[VDBSRV] SETUP received txId=0x${setupTxId.toString(16)} argc=${argc} msgLen=${setupLen}`);
              const resp = core._dbBuildMsg(setupTxId, 0x4000, [core._dbArg4(1)]);
              sock.write(resp);
              phase = 'ready';
              buf = buf.length > setupLen ? buf.slice(setupLen) : Buffer.alloc(0);
              if(buf.length < 15) return;
            } else {
              console.log(`[VDBSRV] no SETUP from client, handling reqType=0x${reqType.toString(16)} directly`);
              phase = 'ready';
            }
          } else {
            return;
          }
        } else {
          return;
        }
      }

      if(buf.length >= 15){
        core._handleVDbRequest(sock, buf);
        buf = Buffer.alloc(0);
      }
    });
  });
  core._dbSrvProto.on('error', e=>{
    console.warn(`[VDBSRV] proto port ${REAL_PORT} bind failed: ${e.message}`);
  });
  core._dbSrvProto.listen(REAL_PORT, _vdbBindIp, ()=>{
    console.log(`[VDBSRV] protocol server listening on ${REAL_PORT}`);
  });
}

function handleVDbRequest(core, sock, buf){
  try{
    const msg = core._parseDbRequest(buf);
    if(!msg) return;
    const { txId: actualTxId, type: reqType, args } = msg;
    console.log(`[VDBSRV] request type=0x${reqType.toString(16)} txId=${actualTxId} args=[${args.join(',')}]`);

    if(reqType === 0x2002){
      const trackIdReq = args[1] || 0;
      sock._vdbTrackId = trackIdReq;
      if(trackIdReq) core._lastVdbTrackId = trackIdReq;
      console.log(`[VDBSRV] meta req trackId=${trackIdReq} greeting=${sock._vdbPlayer||'?'}`);
      sock.write(core._dbBuildMsg(actualTxId, 0x4002, [core._dbArg4(1)]));
    } else if(reqType === 0x3000){
      const tid = sock._vdbTrackId || core._lastVdbTrackId || 0;
      let title='BRIDGE+', artist='', artSlot=-1;
      for(let i=0;i<8;i++){
        const ld=core.layers[i];
        if(ld && ((tid && ld.trackId===tid) || (!tid && ld.trackName))){
          title=ld.trackName||'';artist=ld.artistName||'';artSlot=i;break;
        }
      }
      const art = artSlot>=0 ? core._virtualArt[artSlot] : core._findVirtualArt();
      const artworkId = art ? (tid || (core.layers.find(l=>l?.trackId)?.trackId) || 1) : 0;
      const item=core._dbBuildMenuItem(actualTxId, title, artist, artworkId);
      const done=core._dbBuildMsg(actualTxId+1, 0x4003, [core._dbArg4(1)]);
      sock.write(Buffer.concat([item, done]));
      console.log(`[VDBSRV] render menu: title="${title}" artSlot=${artSlot} artworkId=${artworkId} tid=${tid}`);
    } else if(reqType === 0x2003){
      const reqArtId = args[1] || 0;
      const artBuf = core._findArtByTrackId(reqArtId)
        || core._findArtByTrackId(sock._vdbTrackId)
        || core._findVirtualArt();
      if(artBuf){
        const isJpeg = artBuf[0]===0xFF && artBuf[1]===0xD8;
        console.log(`[VDBSRV] artwork req artId=${reqArtId} connTrackId=${sock._vdbTrackId||0} -> ${artBuf.length}B ${isJpeg?'JPEG':'?'}`);
        const artResp = core._dbBuildArtResponse(actualTxId, artBuf);
        sock.write(artResp, ()=>{
          console.log('[VDBSRV] artwork sent OK, closing conn');
          sock.end();
        });
      } else {
        console.log(`[VDBSRV] artwork req artId=${reqArtId} -> sending blank JPEG`);
        const artResp = core._dbBuildArtResponse(actualTxId, BLANK_JPEG);
        sock.write(artResp, ()=>sock.end());
      }
    } else if(reqType === 0x0100){
      sock.end();
    } else {
      console.log(`[VDBSRV] unhandled reqType=0x${reqType.toString(16)}, sending empty done`);
      sock.write(core._dbBuildMsg(actualTxId, 0x4003, [core._dbArg4(0)]), ()=>sock.end());
    }
  }catch(e){
    console.warn(`[VDBSRV] handleRequest error: ${e.message}`);
  }
}

function findVirtualArt(core){
  for(const slot of Object.keys(core._virtualArt)){
    const buf=core._virtualArt[slot];
    if(buf&&buf.length>100) return buf;
  }
  return null;
}

module.exports = {
  registerVirtualDeck,
  unregisterVirtualDeck,
  setVirtualArt,
  sendVirtualCDJStatus,
  startVirtualDbServer,
  handleVDbRequest,
  findVirtualArt,
  BLANK_JPEG,
};
