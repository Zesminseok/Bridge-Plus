'use strict';
// Phase 5.3c — dbserver client helpers extracted from bridge-core.js
const os    = require('os');
const path  = require('path');
const fs    = require('fs');

// 디버그 로그 — Desktop 우선, CloudStorage 동기화 폴더면 tmpdir 폴백.
// freeze 회피: ① console.log 사용 안 함 ② Desktop 이 CloudStorage 로 redirect 되어 있으면 skip.
function _resolveDbgLogPath(){
  const home = os.homedir();
  // CloudStorage(Dropbox/iCloud/OneDrive) 동기화 폴더는 write 마다 동기화 → freeze 유발. 회피.
  const isCloudSynced = (p) => {
    try{
      const real = fs.realpathSync(path.dirname(p));
      return /CloudStorage|Dropbox|iCloud|com~apple~CloudDocs|OneDrive/.test(real);
    }catch(_){ return false; }
  };
  // 1순위: Desktop (사용자 접근성). 동기화 폴더이거나 실패하면 tmpdir 로 폴백.
  const candidates = [
    path.join(home, 'Desktop', 'bridge-debug.log'),
    path.join(home, '바탕 화면', 'bridge-debug.log'),
    path.join(os.tmpdir(), 'bridge-debug.log'),
  ];
  for(const p of candidates){
    try{
      const dir = path.dirname(p);
      fs.mkdirSync(dir, { recursive: true });
      // CloudStorage 동기화 폴더는 skip
      if(isCloudSynced(p)) continue;
      fs.writeFileSync(p, '');
      return p;
    }catch(_){}
  }
  return null;
}
const _DBG_LOG_PATH = _resolveDbgLogPath();
let _dbgLogInited = false;
let _dbgLogQueue = [];
let _dbgLogFlushScheduled = false;
function _dbgLogFlush(){
  if(!_DBG_LOG_PATH || _dbgLogQueue.length===0){ _dbgLogFlushScheduled=false; return; }
  const chunk = _dbgLogQueue.join('');
  _dbgLogQueue = [];
  fs.appendFile(_DBG_LOG_PATH, chunk, ()=>{ _dbgLogFlushScheduled=false; });
}
function _dbgLog(msg){
  // console.log 제거 — Electron production 빌드에서 stdout 파이프 버퍼 풀(64KB) 시 동기 블록 → UI freeze.
  if(!_DBG_LOG_PATH) return;
  try{
    if(!_dbgLogInited){
      // 초기 헤더 비동기 write — sync 사용 안 함.
      _dbgLogQueue.push(`=== BRIDGE+ debug log — started ${new Date().toISOString()} ===\nlog path: ${_DBG_LOG_PATH}\n`);
      _dbgLogInited = true;
    }
    _dbgLogQueue.push(`[${new Date().toISOString()}] ${msg}\n`);
    if(!_dbgLogFlushScheduled){
      _dbgLogFlushScheduled = true;
      setImmediate(_dbgLogFlush);
    }
  }catch(_){}
}

async function dbserverMetadata(core, ip, slot, trackId, playerNum, trackType=1){
    // Spoof as player 7 to avoid conflict with CDJs 1-6
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;

      // Send REKORDBOX_METADATA_REQ (type 0x2002)
      // trackType: 1=RB (rekordbox analyzed), 2=Unanalyzed, 5=AudioCD
      const tt = trackType || 1;
      const txId = 1;
      const rmst = core._dbRMST(spoofPlayer, 0x01, slot, tt);
      const metaReq = core._dbBuildMsg(txId, 0x2002, [rmst, core._dbArg4(trackId)]);
      sock.write(metaReq);
      const menuAvail = await core._dbReadResponse(sock);
      // Send RENDER_MENU_REQ (type 0x3000) to get all items
      // CRITICAL: must use txId+1 (different from metadata req) — CDJ requires sequential txIds
      const renderReq = core._dbBuildMsg(txId+1, 0x3000, [
        rmst, core._dbArg4(0), core._dbArg4(64),
        core._dbArg4(0), core._dbArg4(64), core._dbArg4(0)
      ]);
      sock.write(renderReq);
      const fullResp = await core._dbReadFullResponse(sock);

      // Parse menu items
      const items = core._dbParseItems(fullResp);
      const meta = {};
      for(const item of items){
        if(item.msgType===0x4101){
          // MENU_ITEM: args[3]=label1(str), args[5]=label2(str), args[6]=itemType(num), args[8]=artworkId
          const itemType = item.args[6]?.val || 0;
          const label1 = item.args[3]?.val || '';
          const label2 = item.args[5]?.val || '';
          switch(itemType){
            case 0x0004: meta.title=label1; meta.artworkId=item.args[8]?.val||0; break;
            case 0x0007: meta.artist=label1||label2; break;  // try label2 as fallback
            case 0x0002: meta.album=label1||label2; break;
            case 0x000b: meta.duration=item.args[1]?.val||0; break;
            case 0x000d: meta.bpm=(item.args[1]?.val||0)/100; break;
            case 0x000f: meta.key=label1; break;
            case 0x0006: meta.genre=label1||label2; break;
            // 0x0011/0x0014/0x0010: bitrate/fileKind/fileSize 후보 — CDJ 응답에 미포함이므로
            // 별도 트랙 정보 쿼리(metadata-archive 또는 menu_request type=0x1000) 가 필요. 일단 매핑만 남겨둠.
            case 0x0011: meta.bitrate=item.args[1]?.val||0; break;
            case 0x0014: meta.fileKind=label1||label2; break;
            case 0x0010: meta.fileSize=item.args[1]?.val||0; break;
            // 실측 (2026-04-26 NXS2/CDJ-3000 mixed): label / 원곡자(alt artist) / 등록일
            case 0x000e: meta.label=label1||label2; break;
            case 0x0028: meta.altArtist=label1||label2; break;
            case 0x002e: meta.dateAdded=label1; break;
            default:
              // 진단: 알 수 없는 itemType 도 한 번씩 로그로 남겨 ID 매핑 확인
              if(label1 || label2){
                _dbgLog(`[META-UNK] P${playerNum} itemType=0x${itemType.toString(16).padStart(4,'0')} label1="${label1}" label2="${label2}" num=${item.args[1]?.val||0}`);
              }
          }
        }
      }

      // Store metadata into layer so TCNet DATA packets include it
      const li = playerNum - 1;
      if(li >= 0 && li < 8 && core.layers[li]){
        if(meta.title)  core.layers[li].trackName  = meta.title;
        if(meta.artist) core.layers[li].artistName = meta.artist;
        // Invalidate MetaData packet cache so it gets rebuilt with new names
        if(core._metaCache && core._metaCache[li]) core._metaCache[li] = null;
      }

      // Emit metadata — include durationMs (precise ms) so renderer can skip integer*1000 conversion
      if(meta.title||meta.artist){
        const layerLen = (li >= 0 && li < 8 && core.layers[li]?.totalLength) || 0;
        const durationMs = layerLen > 0 ? layerLen : (meta.duration > 0 ? meta.duration * 1000 : 0);
        core.onTrackMetadata?.(playerNum, {...meta, durationMs});
      }

      // Keep the pooled dbserver TCP session open; idle TTL handles teardown.

      // Stagger heavy follow-up requests so HW track load does not create a burst
      // of parallel TCP work that stalls UI/audio on slower systems.
      core._scheduleDbFollowUps(ip, slot, trackId, playerNum, tt, meta.artworkId||0);
    }catch(e){
      if(session) session.invalidate();
      throw e;
    }finally{
      if(session) session.release();
    }
  }

async function dbserverWaveform(core, ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      const wfRmst = core._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const wfReq = core._dbBuildMsg(1, 0x2004, [
        wfRmst, core._dbArg4(0), core._dbArg4(trackId), core._dbArg4(0),
        {tag:0x03, data:core._dbBinary(Buffer.alloc(0))}
      ]);
      sock.write(wfReq);
      const wfResp = await core._dbReadFullResponse(sock);
      // Find largest Binary field — contains waveform data
      let wfData=null;
      for(let i=0;i<wfResp.length-5;i++){
        if(wfResp[i]===0x14){
          const len=wfResp.readUInt32BE(i+1);
          if(len>100&&len<100000&&i+5+len<=wfResp.length){
            wfData=wfResp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(wfData&&wfData.length>0){
        const pts=[];
        for(let i=0;i<wfData.length;i++){
          pts.push({height:wfData[i]&0x1F, color:(wfData[i]>>5)&0x07});
        }
        core.onWaveformPreview?.(playerNum, {seg:0, pts, wfType:'preview'});
      } else {
      }
    }catch(e){
      if(session) session.invalidate();
      throw e;
    }finally{if(session) session.release();}
  }

async function dbserverWaveformDetail(core, ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      // 0x2904 = WAVE_DETAIL_REQ — 150 segments/sec, full resolution
      const wfRmst = core._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const wfReq = core._dbBuildMsg(1, 0x2904, [
        wfRmst, core._dbArg4(trackId), core._dbArg4(0)
      ]);
      sock.write(wfReq);
      const wfResp = await core._dbReadFullResponse(sock);
      // Find largest Binary field (tag 0x14)
      let wfData=null;
      for(let i=0;i<wfResp.length-5;i++){
        if(wfResp[i]===0x14){
          const len=wfResp.readUInt32BE(i+1);
          if(len>400&&len<500000&&i+5+len<=wfResp.length){
            wfData=wfResp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(wfData&&wfData.length>19){
        // Skip 19-byte header junk (LEADING_DBSERVER_JUNK_BYTES)
        const data = wfData.slice(19);
        const pts=[];
        for(let i=0;i<data.length;i++){
          pts.push({height:data[i]&0x1F, color:(data[i]>>5)&0x07});
        }
        // Waveform detail = 150 pts/sec
        // rekordbox 분석 시 실제 오디오 파일 길이 기반 → ms 정밀도 확보 가능한 유일한 소스
        core._wfTrackLen = core._wfTrackLen || {};
        core._wfTrackLen[playerNum] = Math.round(pts.length * 1000 / 150);
        core.onWaveformDetail?.(playerNum, {pts, wfType:'detail', trackLenMs:core._wfTrackLen[playerNum]});
      } else {
      }
    }catch(e){
      if(session) session.invalidate();
      console.warn(`[DBSRV] P${playerNum} waveform detail failed:`,e.message);
    }finally{if(session) session.release();}
  }

async function dbserverWaveformNxs2(core, ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      // PWV7 magic = 0x50575637 ("PWV7" big-endian)
      const rmst = core._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const req = core._dbBuildMsg(1, 0x2c04, [
        rmst, core._dbArg4(trackId), core._dbArg4(0),
        core._dbArg4(0x50575637) // PWV7 tag magic
      ]);
      sock.write(req);
      const resp = await core._dbReadFullResponse(sock);
      // Find binary field (tag 0x14) containing raw ANLZ tag data
      let anlzData=null;
      for(let i=0;i<resp.length-5;i++){
        if(resp[i]===0x14){
          const len=resp.readUInt32BE(i+1);
          if(len>100&&len<2000000&&i+5+len<=resp.length){
            anlzData=resp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(!anlzData||anlzData.length<20){
        return;
      }
      // Parse ANLZ tag structure — find PWV7 tag
      let pos=0;
      while(pos<anlzData.length-12){
        const tag=anlzData.toString('ascii',pos,pos+4);
        const tHL=anlzData.readUInt32BE(pos+4);
        const tTL=anlzData.readUInt32BE(pos+8);
        if(tag==='PWV7'){
          const dataStart=pos+tHL;
          const dataLen=tTL-tHL;
          const entries=Math.floor(dataLen/3);
          if(entries>10){
            // PWV7: 3 bytes/entry = mid, hi, low (0-255 each)
            const pts=[];
            for(let j=0;j<entries;j++){
              const off=dataStart+j*3;
              pts.push({
                low:anlzData[off+2]/255,
                mid:anlzData[off]/255,
                hi:anlzData[off+1]/255,
              });
            }
            core.onWaveformDetail?.(playerNum, {pts, wfType:'nxs2_3band'});
            return;
          }
        }
        if(tTL===0)break;
        pos+=tTL;
      }
    }catch(e){
      if(session) session.invalidate();
      console.warn(`[DBSRV] P${playerNum} nxs2 waveform failed:`,e.message);
    }finally{if(session) session.release();}
  }

async function dbserverCuePoints(core, ip, slot, trackId, playerNum, trackType){
    // Orchestrator only: the concrete cue fetchers below acquire pooled dbserver sessions.
    // 우선순위: EXT(0x2b04, 색상+코멘트) → STD(0x2104, 36바이트 stride) → ANLZ(0x2c04 폴백).
    // RMST menu 필드는 DATA 카테고리 = 0x08 (cue/beat/wf 데이터 fetch 공통).
    let cues = null;
    try{ cues = await core._dbserverCuePointsExt(ip, slot, trackId, playerNum, trackType); }
    catch(e){ console.warn(`[DBSRV] cue EXT P${playerNum} err:`, e.message); }
    if(!cues||cues.length===0){
      try{ cues = await core._dbserverCuePointsStd(ip, slot, trackId, playerNum, trackType); }
      catch(e){ console.warn(`[DBSRV] cue STD P${playerNum} err:`, e.message); }
    }
    if(!cues||cues.length===0){
      // 마지막 폴백 — 0x2c04 ANLZ tag (구형 NXS 일부에서만 작동)
      try{ cues = await core._dbserverCuePointsNxs2(ip, slot, trackId, playerNum, trackType); }
      catch(e){ console.warn(`[DBSRV] cue NXS2 P${playerNum} err:`, e.message); }
    }
    if(cues&&cues.length>0){
      // bridge-core 에 큐 포인트 캐싱 — NXS2 메모리큐 정확한 ms / 루프 길이 활용용.
      if(!core._cuePoints) core._cuePoints = {};
      core._cuePoints[playerNum] = cues;
      core.onCuePoints?.(playerNum, cues);
      const hot=cues.filter(c=>c.type==='hot').length;
      const mem=cues.filter(c=>c.type==='memory').length;
      const lp=cues.filter(c=>c.type==='loop').length;
      const sample=cues.slice(0,3).map(c=>`${c.type[0]}@${c.timeMs}`).join(',');
    } else {
    }
  }

async function dbserverCuePointsExt(core, ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      // CUE_LIST_EXT_REQ — RMST(menu=DATA=0x08, slot) + trackId + 0 (3 args).
      const rmst = core._dbRMST(spoofPlayer, 0x08, slot, trackType||1);
      const req = core._dbBuildMsg(1, 0x2b04, [
        rmst, core._dbArg4(trackId), core._dbArg4(0),
      ]);
      sock.write(req);
      const resp = await core._dbReadFullResponse(sock);
      const items = core._dbParseItems(resp);
      // 응답 메시지(0x4e02) 의 args[3] = 바이너리 블롭, args[4] = entry count
      const cueMsg = items.find(it=>it.msgType===0x4e02);
      if(!cueMsg||!cueMsg.args||!cueMsg.args[3]||cueMsg.args[3].type!=='blob'){
        return null;
      }
      const blob = cueMsg.args[3].val;
      const totalCount = cueMsg.args[4]?.val || 0;
      if(!blob||blob.length<8||totalCount<=0) return null;
      const cues = [];
      let p = 0;
      let safety = 0;
      while(p+8<=blob.length && safety<256){
        safety++;
        const entrySize = blob.readUInt32LE(p);
        if(entrySize<8 || p+entrySize>blob.length) break;
        const hotCue   = blob[p+4]||0;
        const typeFlag = blob[p+6]||0;
        const timeMs   = blob.readUInt32LE(p+12);
        const loopEnd  = blob.readUInt32LE(p+16);
        let colorId=0, colorR=0, colorG=0, colorB=0, comment='';
        if(entrySize>=0x23) colorId = blob[p+0x22]||0;
        if(entrySize>0x49){
          const commentSize = blob.readUInt16LE(p+0x48);
          if(commentSize>0 && p+0x4A+commentSize*2<=p+entrySize){
            // UTF-16LE char count = commentSize? (Java 원본은 byte count 일 수도 — 안전을 위해
            // commentSize byte 로 가정하고 끝까지 0x00 만나면 stop)
            for(let j=0;j<commentSize-1 && p+0x4A+j+1<p+entrySize;j+=2){
              const ch=blob.readUInt16LE(p+0x4A+j);
              if(ch===0)break;
              comment+=String.fromCharCode(ch);
            }
            const cOff = p + 0x4E + commentSize;
            if(cOff+3 < p+entrySize){
              colorR = blob[cOff+1]||0;
              colorG = blob[cOff+2]||0;
              colorB = blob[cOff+3]||0;
            }
          }
        }
        let type;
        if(hotCue>0) type='hot';
        else if(typeFlag===2) type='loop';
        else type='memory';
        cues.push({
          name:comment, timeMs, hotCueNum:hotCue, colorId, type,
          loopEndMs: type==='loop' ? loopEnd : 0,
          colorR, colorG, colorB,
        });
        p += entrySize;
      }
      cues.sort((a,b)=>a.timeMs-b.timeMs);
      return cues.length>0 ? cues : null;
    }catch(e){
      if(session) session.invalidate();
      console.warn(`[DBSRV] P${playerNum} cue ext failed:`,e.message);
      return null;
    }finally{if(session) session.release();}
  }

async function dbserverCuePointsNxs2(core, ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      // 진단 결과 (0.9.3.37 로그): 응답 0x4f02 / arg[2]=0 → 빈 응답.
      // 다중 조합 시도 — slot 변형 + PCO2/PCOB magic + EXT marker 변형.
      // 첫 번째 binary blob 받는 조합 선택.
      let txCounter = 1;
      let anlzData = null;
      const attempts = [
        // [slot, magic, extMarker, label]
        [slot,    0x50434F32, 0x45585400, 'PCO2 + EXT(BE)'],
        [slot,    0x50434F32, 0x00545845, 'PCO2 + EXT(LE)'],
        [slot,    0x50434F32, 0x00000000, 'PCO2 + 0'],
        [slot,    0x50434F42, 0x00000000, 'PCOB + 0'],
        [slot,    0x50434F42, 0x45585400, 'PCOB + EXT(BE)'],
        ...(slot!==4 ? [
          [4, 0x50434F32, 0x45585400, 'slot4 PCO2+EXT'],
          [4, 0x50434F42, 0x00000000, 'slot4 PCOB+0'],
        ] : []),
      ];
      for(const [trySlot, magic, extM, label] of attempts){
        const rmst = core._dbRMST(spoofPlayer, 0x01, trySlot, trackType||1);
        const req = core._dbBuildMsg(txCounter++, 0x2c04, [
          rmst, core._dbArg4(trackId),
          core._dbArg4(magic), core._dbArg4(extM),
        ]);
        sock.write(req);
        const resp = await core._dbReadFullResponse(sock);
        let blobsFound = 0;
        for(let i=0;i<resp.length-5;i++){
          if(resp[i]===0x14){
            const len=resp.readUInt32BE(i+1);
            if(len>20&&len<500000&&i+5+len<=resp.length){
              blobsFound++;
              if(!anlzData) anlzData=resp.slice(i+5,i+5+len);
            }
          }
        }
        if(anlzData && anlzData.length>=20){
          break;
        }
      }
      if(!anlzData||anlzData.length<20){
        return null;
      }
      // ANLZ blob 선형 스캔으로 모든 PCO2 섹션 수집 (hot cue 섹션 + memory cue
      // 섹션 2 개 존재 가능). 엔트리가 PCP2 아니면 최대 200B 까지 forward scan.
      const cues=[];
      const size=anlzData.length;
      for(let i=0;i<=size-20;i++){
        // "PCO2" 시그니처 탐색
        if(anlzData[i]!==0x50||anlzData[i+1]!==0x43||anlzData[i+2]!==0x4F||anlzData[i+3]!==0x32) continue;
        const lenHeader=anlzData.readUInt32BE(i+4);
        const numCues=anlzData.readUInt16BE(i+16);   // PCO2 섹션 헤더 +16 = numCues
        if(numCues===0||numCues>200) continue;
        let entryOff=i+lenHeader;
        for(let c=0;c<numCues;c++){
          if(entryOff+12>size) break;
          // PCP2 마법 확인, 아니면 가까운 PCP2 까지 스캔 (≤200B)
          if(anlzData[entryOff]!==0x50||anlzData[entryOff+1]!==0x43
             ||anlzData[entryOff+2]!==0x50||anlzData[entryOff+3]!==0x32){
            let found=-1;
            for(let scan=entryOff;scan<=size-12&&scan<entryOff+200;scan++){
              if(anlzData[scan]===0x50&&anlzData[scan+1]===0x43
                 &&anlzData[scan+2]===0x50&&anlzData[scan+3]===0x32){ found=scan; break; }
            }
            if(found<0) break;
            entryOff=found;
          }
          const entryLen=anlzData.readUInt32BE(entryOff+8);
          if(entryLen>4096||entryLen<0x1D||entryOff+entryLen>size){
            entryOff+=Math.max(12,entryLen||12);
            continue;
          }
          const e=entryOff;
          const hotCue=anlzData.readUInt32BE(e+0x0C);
          const ctype =anlzData[e+0x10];
          const timeMs=anlzData.readUInt32BE(e+0x14);
          const loopMs=anlzData.readUInt32BE(e+0x18);
          if(ctype===0){ entryOff+=entryLen; continue; }  // type=0 은 invalid/placeholder entry
          // type 결정: hotCue 가 있으면 무조건 'hot' (CDJ 표시 우선순위와 동일).
          // 그 다음 ctype===2 만 'loop' (loopMs 는 hot/memory 에서 garbage 일 수 있어 type 판정에 안 씀).
          // 이전 로직은 loopMs!==0 이면 무조건 'loop' 로 덮어써서 hot/memory 가 모두 loop 로 분류됨 →
          // 루프 영역만 보이고 큐 마커 미표시. 사용자 "루프는 잘 됨" 단서로 발견.
          let type;
          if(hotCue>0) type='hot';
          else if(ctype===2) type='loop';
          else type='memory';
          const validLoop = type==='loop' && loopMs!==0 && loopMs!==0xFFFFFFFF;
          const cue={
            name:'', timeMs, hotCueNum:hotCue, colorId:anlzData[e+0x1C],
            type, loopEndMs:validLoop?loopMs:0,
            colorR:30, colorG:200, colorB:60,
          };
          // Comment + RGB
          if(entryLen>=0x2C){
            try{
              const commentBytes=anlzData.readUInt32BE(e+0x28);
              if(commentBytes>0&&commentBytes<512){
                // UTF-16BE 수동 디코딩 — Node.js Buffer 는 'utf16be' 미지원 (Latin-1 fallback → 한글/일본어 깨짐).
                // _dbReadField 와 동일 패턴: readUInt16BE 루프 + null 종료.
                let _name='';
                const _end=Math.min(e+0x2C+commentBytes, anlzData.length-1);
                for(let _j=e+0x2C;_j<_end;_j+=2){
                  const _ch=anlzData.readUInt16BE(_j);
                  if(_ch===0)break;
                  _name+=String.fromCharCode(_ch);
                }
                cue.name=_name;
                const colorOff=e+0x2C+commentBytes;
                if(colorOff+3<e+entryLen){
                  cue.colorR=anlzData[colorOff+1];
                  cue.colorG=anlzData[colorOff+2];
                  cue.colorB=anlzData[colorOff+3];
                }
              }
            }catch(_){}
          }
          if(cue.colorId===0){
            if(type==='memory'){cue.colorR=200;cue.colorG=30;cue.colorB=30;}
            else if(type==='loop'){cue.colorR=255;cue.colorG=136;cue.colorB=0;}
          }
          cues.push(cue);
          entryOff+=entryLen;
        }
      }
      if(cues.length>0){
        cues.sort((a,b)=>a.timeMs-b.timeMs);
        return cues;
      }
      // PCO2 tag not found — try PCOB fallback within same response
      pos=0;
      while(pos<anlzData.length-12){
        const tag=anlzData.toString('ascii',pos,pos+4);
        const tHL=anlzData.readUInt32BE(pos+4);
        const tTL=anlzData.readUInt32BE(pos+8);
        if(tag==='PCOB'){
          const numCues=anlzData.readUInt16BE(pos+0x12);
          const cues=[];
          let ePos=pos+tHL;
          for(let ci=0;ci<numCues&&ePos<pos+tTL-12;ci++){
            const entTag=anlzData.toString('ascii',ePos,ePos+4);
            if(entTag!=='PCPT')break;
            const eTL=anlzData.readUInt32BE(ePos+8);
            if(eTL<0x24){ePos+=eTL||1;continue;}
            const hotCue=anlzData.readUInt32BE(ePos+0x0C);
            const ctype=anlzData[ePos+0x1C];
            const timeMs=anlzData.readUInt32BE(ePos+0x20);
            const loopMs=anlzData.readUInt32BE(ePos+0x24);
            // PCP2 와 동일: hot 우선 → ctype=2 만 loop → 나머지 memory.
            let type;
            if(hotCue>0) type='hot';
            else if(ctype===2) type='loop';
            else type='memory';
            const validLoop=type==='loop'&&loopMs>0&&loopMs!==0xFFFFFFFF;
            cues.push({
              name:'', timeMs, hotCueNum:hotCue, colorId:0, type,
              loopEndMs:validLoop?loopMs:0,
              colorR:type==='memory'?200:type==='loop'?255:30,
              colorG:type==='memory'?30:type==='loop'?136:200,
              colorB:type==='memory'?30:type==='loop'?0:60,
            });
            ePos+=eTL;
          }
          return cues;
        }
        if(tTL===0)break;
        pos+=tTL;
      }
      return null;
    }catch(e){
      if(session) session.invalidate();
      console.warn(`[DBSRV] P${playerNum} PCO2 cue points failed:`,e.message);
      return null;
    }finally{if(session) session.release();}
  }

async function dbserverCuePointsStd(core, ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      // CUE_LIST_REQ — RMST(menu=DATA=0x08, slot) + trackId (2 args).
      const rmst = core._dbRMST(spoofPlayer, 0x08, slot, trackType||1);
      const req = core._dbBuildMsg(1, 0x2104, [
        rmst, core._dbArg4(trackId),
      ]);
      sock.write(req);
      const resp = await core._dbReadFullResponse(sock);
      const items = core._dbParseItems(resp);
      const cueMsg = items.find(it=>it.msgType===0x4702);
      if(!cueMsg||!cueMsg.args||!cueMsg.args[3]||cueMsg.args[3].type!=='blob'){
        return null;
      }
      const blob = cueMsg.args[3].val;
      if(!blob||blob.length<36) return null;
      const stride = 36;
      const cues = [];
      // half-frame → ms: value * 1000 / 150. 정확히 20/3 배 (= 6.6667).
      const hfToMs = (hf)=>Math.round(hf * 1000 / 150);
      for(let off=0; off+stride<=blob.length; off+=stride){
        const loopFlag    = blob[off]||0;
        const cueFlag     = blob[off+1]||0;
        const hotCue      = blob[off+2]||0;
        if(cueFlag===0 && hotCue===0) continue; // inactive slot
        const timeMs      = hfToMs(blob.readUInt32LE(off+12));
        const loopEndMs   = hfToMs(blob.readUInt32LE(off+16));
        let type;
        if(hotCue>0) type='hot';
        else if(loopFlag!==0) type='loop';
        else type='memory';
        cues.push({
          name:'', timeMs, hotCueNum:hotCue, colorId:0, type,
          loopEndMs: type==='loop' ? loopEndMs : 0,
          colorR: type==='memory'?200:type==='loop'?255:30,
          colorG: type==='memory'?30:type==='loop'?136:200,
          colorB: type==='memory'?30:type==='loop'?0:60,
        });
      }
      cues.sort((a,b)=>a.timeMs-b.timeMs);
      return cues.length>0 ? cues : null;
    }catch(e){
      if(session) session.invalidate();
      console.warn(`[DBSRV] P${playerNum} cue std failed:`,e.message);
      return null;
    }finally{if(session) session.release();}
  }

async function dbserverBeatGrid(core, ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      // 0x2204 = BEAT_GRID_REQ
      const rmst = core._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      const req = core._dbBuildMsg(1, 0x2204, [
        rmst, core._dbArg4(trackId), core._dbArg4(0)
      ]);
      sock.write(req);
      const resp = await core._dbReadFullResponse(sock);
      // Find Binary field (tag 0x14) containing beat grid data
      let bgData=null;
      for(let i=0;i<resp.length-5;i++){
        if(resp[i]===0x14){
          const len=resp.readUInt32BE(i+1);
          if(len>20&&len<2000000&&i+5+len<=resp.length){
            bgData=resp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(bgData&&bgData.length>20){
        // Beat grid format: 20-byte header + 16-byte entries (LITTLE ENDIAN)
        // Entry: beat_within_bar(2B LE) + tempo(2B LE, BPM×100) + time_ms(4B LE) + 8B unknown
        const hdrSize=20;
        const entrySize=16;
        const numEntries=Math.floor((bgData.length-hdrSize)/entrySize);
        const beats=[];
        let totalBpm=0, bpmCount=0;
        for(let e=0;e<numEntries;e++){
          const off=hdrSize+e*entrySize;
          if(off+entrySize>bgData.length)break;
          const beatInBar=bgData.readUInt16LE(off);
          const tempoRaw=bgData.readUInt16LE(off+2);
          const timeMs=bgData.readUInt32LE(off+4);
          const bpm=tempoRaw/100;
          if(bpm>0&&bpm<999){ totalBpm+=bpm; bpmCount++; }
          beats.push({beatInBar, bpm, timeMs});
        }
        const baseBpm=bpmCount>0?Math.round(totalBpm/bpmCount*100)/100:0;
        if(beats.length>0){
          core._beatGrids[playerNum] = beats;
          // Estimate track end: last beat timeMs + one beat interval (best available for NXS2)
          const lastB = beats[beats.length-1];
          if(lastB.bpm > 0 || baseBpm > 0){
            core._bgTrackLen = core._bgTrackLen || {};
            // baseBpm = 전체 비트 평균 BPM → 마지막 beat BPM보다 정확
            const estBpm = baseBpm > 0 ? baseBpm : lastB.bpm;
            core._bgTrackLen[playerNum] = Math.round(lastB.timeMs + 60000/estBpm);
          }
          core.onBeatGrid?.(playerNum, {beats, baseBpm});
        } else {
        }
      } else {
      }
    }catch(e){
      if(session) session.invalidate();
      console.warn(`[DBSRV] P${playerNum} beat grid failed:`,e.message);
    }finally{if(session) session.release();}
  }

async function dbserverSongStructure(core, ip, slot, trackId, playerNum, trackType){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      const rmst = core._dbRMST(spoofPlayer, 0x04, slot, trackType||1);
      // PSSI magic: 'P'(0x50)'S'(0x53)'S'(0x53)'I'(0x49) BE UInt32 = 0x50535349
      const req = core._dbBuildMsg(1, 0x2c04, [
        rmst, core._dbArg4(trackId), core._dbArg4(0), core._dbArg4(0x50535349)
      ]);
      sock.write(req);
      const resp = await core._dbReadFullResponse(sock);
      // ANLZ binary blob 추출
      let anlzData=null;
      for(let i=0;i<resp.length-5;i++){
        if(resp[i]===0x14){
          const len=resp.readUInt32BE(i+1);
          if(len>40 && len<200000 && i+5+len<=resp.length){
            anlzData=resp.slice(i+5,i+5+len);
            break;
          }
        }
      }
      if(!anlzData || anlzData.length<40){
        return;
      }
      // ANLZ 태그 리스트 순회 → PSSI 섹션 위치 찾기
      let pssiStart=-1, pssiEnd=-1;
      let pos=0;
      while(pos<anlzData.length-12){
        const tag=anlzData.toString('ascii',pos,pos+4);
        const tHL=anlzData.readUInt32BE(pos+4);
        const tTL=anlzData.readUInt32BE(pos+8);
        if(tag==='PSSI'){ pssiStart=pos; pssiEnd=pos+tTL; break; }
        if(tTL===0||tTL>anlzData.length-pos)break;
        pos+=tTL;
      }
      if(pssiStart<0){
        return;
      }
      const body = anlzData.slice(pssiStart, pssiEnd);
      // PSSI body layout (big-endian):
      //  0:  "PSSI"
      //  4:  u4 len_header
      //  8:  u4 len_tag
      // 12:  u4 len_entry_bytes (or padding)
      // 16:  u2 mood_high          (1=intro, 2=up, 3=down, 5=chorus, 6=outro)
      // 18:  u2 entry_count
      // 20:  u2 raw_mood           (>20 이면 XOR 난독화 적용)
      // 22:  u2 end_beat
      // 24:  u2 bank               (하이레벨 뱅크 기호)
      // 26:  u2 padding
      // 28:  entries[ ] 24B each
      if(body.length<32){
        return;
      }
      const hiMood = body.readUInt16BE(16);
      const entryCount = body.readUInt16BE(18);
      const rawMood = body.readUInt16BE(20);
      const endBeat = body.readUInt16BE(22);
      const entriesStart = 28;
      if(entryCount<=0 || entryCount>300){
        return;
      }
      if(entriesStart + entryCount*24 > body.length){
        return;
      }
      // XOR 난독화 (raw_mood > 20 일 때)
      // key = XOR_MASK[i%19] + endBeat, applied from entriesStart
      const buf = Buffer.from(body); // writable copy
      if(rawMood > 20){
        const XOR_MASK = Buffer.from([
          0xCB,0xE1,0xEE,0xFA,0xE5,0xEE,0xAD,0xEE,0xE9,0xD2,
          0xE9,0xEB,0xE1,0xE9,0xF3,0xE8,0xE9,0xF4,0xE1
        ]);
        const eb = endBeat & 0xFF;
        const total = entryCount*24;
        for(let i=0;i<total;i++){
          const m = (XOR_MASK[i%19] + eb) & 0xFF;
          buf[entriesStart+i] = buf[entriesStart+i] ^ m;
        }
      }
      // 비트그리드 준비 (없으면 BPM+anchor로 추정)
      const beatGrid = core._beatGrids && core._beatGrids[playerNum];
      const b2ms = (beat)=>{
        if(beatGrid && beat>=1 && beat<=beatGrid.length) return beatGrid[beat-1].timeMs;
        return 0;
      };
      // entries 파싱
      const phrases = [];
      for(let e=0;e<entryCount;e++){
        const off = entriesStart + e*24;
        const idx  = buf.readUInt16BE(off+0);
        const beat = buf.readUInt16BE(off+2);
        const kind = buf.readUInt16BE(off+4);
        const timeMs = b2ms(beat);
        const meta = core._phraseKindMeta(hiMood, kind);
        phrases.push({ index:idx, beat, kind, timeMs, label:meta.label, color:meta.color });
      }
      // 트랙 종료 시각
      let endMs = b2ms(endBeat);
      if(!endMs){
        if(beatGrid && beatGrid.length>0) endMs = beatGrid[beatGrid.length-1].timeMs;
        else if(core._bgTrackLen && core._bgTrackLen[playerNum]) endMs = core._bgTrackLen[playerNum];
      }
      // 시각순 정렬 + 유효한 엔트리만
      phrases.sort((a,b)=>a.timeMs-b.timeMs);
      const valid = phrases.filter(p=>p.timeMs>=0);
      if(valid.length>0){
        core._songStructures = core._songStructures || {};
        core._songStructures[playerNum] = { phrases:valid, endMs, mood:hiMood };
        core.onSongStructure?.(playerNum, { phrases:valid, endMs, mood:hiMood });
      }
    }catch(e){
      if(session) session.invalidate();
      console.warn(`[DBSRV] P${playerNum} song structure failed:`,e.message);
    }finally{if(session) session.release();}
  }

async function dbserverArtwork(core, ip, slot, artworkId, playerNum, cacheKey){
    const spoofPlayer = 5;
    let session;
    try{
      session = await core._dbAcquire(ip, spoofPlayer);
      const sock = session.sock;
      const artRmst = core._dbRMST(spoofPlayer, 0x08, slot, 0x01);
      const artReq = core._dbBuildMsg(1, 0x2003, [artRmst, core._dbArg4(artworkId)]);
      sock.write(artReq);
      const artResp = await core._dbReadFullResponse(sock);
      // Find JPEG or PNG
      let imgStart = artResp.indexOf(Buffer.from([0xFF,0xD8]));
      let imgEnd = imgStart>=0 ? artResp.lastIndexOf(Buffer.from([0xFF,0xD9])) : -1;
      let mime = 'image/jpeg';
      if(imgStart<0){
        imgStart = artResp.indexOf(Buffer.from([0x89,0x50,0x4E,0x47]));
        if(imgStart>=0){ imgEnd = artResp.length; mime = 'image/png'; }
      }
      if(imgStart>=0 && imgEnd>imgStart){
        const img = artResp.slice(imgStart, mime==='image/jpeg'?imgEnd+2:imgEnd);
        const b64 = `data:${mime};base64,` + img.toString('base64');
        core._artCache[cacheKey] = b64;
        core.onAlbumArt?.(playerNum, b64);
        // Store in virtual dbserver — Arena fetches via ProDJ Link dbserver protocol
        core.setVirtualArt(playerNum-1, img);
      } else {
      }
    }catch(e){
      if(session) session.invalidate();
      throw e;
    }finally{if(session) session.release();}
  }

// 프레이즈 종류 → 라벨/색상 맵. mood_high 에 따라 의미 변동.
// dbserverSongStructure 전용 helper. 순수 함수.
function phraseKindMeta(hiMood, kind){
  const COL_INTRO='#2c5fe0', COL_VERSE='#32be5a', COL_VERSE2='#30a8a0';
  const COL_BRIDGE='#8844cc', COL_CHORUS='#e04080', COL_OUTRO='#2c5fe0';
  const COL_UP='#f59e0b', COL_DOWN='#64748b', COL_DEFAULT='#6b7280';
  if(hiMood===1){
    if(kind===1) return {label:'Intro', color:COL_INTRO};
    if(kind===2) return {label:'Verse', color:COL_VERSE};
    if(kind===3) return {label:'Bridge', color:COL_BRIDGE};
    if(kind===5) return {label:'Chorus', color:COL_CHORUS};
    if(kind===6) return {label:'Outro', color:COL_OUTRO};
  }
  if(hiMood===2){
    if(kind>=1 && kind<=3) return {label:`Up${kind}`, color:COL_UP};
    if(kind===5) return {label:'Chorus', color:COL_CHORUS};
    if(kind===6) return {label:'Outro', color:COL_OUTRO};
  }
  if(hiMood===3){
    if(kind>=1 && kind<=3) return {label:`Down${kind}`, color:COL_DOWN};
    if(kind===5) return {label:'Chorus', color:COL_CHORUS};
    if(kind===6) return {label:'Outro', color:COL_OUTRO};
  }
  const DEF={1:{label:'Intro',color:COL_INTRO},2:{label:'Verse',color:COL_VERSE},
    3:{label:'Verse2',color:COL_VERSE2},4:{label:'Bridge',color:COL_BRIDGE},
    5:{label:'Chorus',color:COL_CHORUS},6:{label:'Outro',color:COL_OUTRO}};
  return DEF[kind] || {label:`P${kind}`, color:COL_DEFAULT};
}

module.exports = {
  dbserverMetadata, dbserverWaveform, dbserverWaveformDetail, dbserverWaveformNxs2,
  dbserverCuePoints, dbserverCuePointsExt, dbserverCuePointsNxs2, dbserverCuePointsStd,
  dbserverBeatGrid, dbserverSongStructure, dbserverArtwork,
  phraseKindMeta,
};
