// dbserver client orchestrator — bridge-core.js 에서 추출 (Phase 5.4).
// requestMetadata / refreshAllMetadata / requestArtwork / scheduleDbFollowUps:
//   dbserver client 진입점 + 후속 요청 staggering. 본문은 dbserver-client.js 가 처리.
// 동작 보존 — 입력/출력/타이밍/캐시 키 모두 그대로.
'use strict';

const { _dbgLog } = require('./dbserver-client');

// ── HW track 변경 직후 metadata 요청 ───────────────────────────────────
// cacheKey 기반 dedup. force=true 면 8s, 아니면 30s TTL.
// 실패 시 캐시 invalidate → 다음 트리거에서 재시도 가능.
function requestMetadata(core, ip, slot, trackId, playerNum, force=false, trackType=1){
  if(!ip || !trackId) return;
  const cacheKey = `${ip}_${slot}_${trackId}`;
  if(!core._metaReqCache) core._metaReqCache = {};
  const now = Date.now();
  const prev = core._metaReqCache[cacheKey];
  const ttlMs = force ? 8000 : 30000;
  if(prev && (now - prev.time) < ttlMs) return;
  core._metaReqCache[cacheKey] = { time: now, force: !!force };
  _dbgLog(`[META] P${playerNum} fetch ip=${ip} slot=${slot} tt=${trackType} tid=${trackId}`);
  core._dbserverMetadata(ip, slot, trackId, playerNum, trackType).then(()=>{
    _dbgLog(`[META] P${playerNum} fetch OK tid=${trackId}`);
  }).catch(e=>{
    _dbgLog(`[META] P${playerNum} fetch FAIL tid=${trackId}: ${e.message}`);
    if(core._shouldLogRate(`db_meta_fail_${cacheKey}`, 10000, e.message)){
      console.warn(`[DBSRV] metadata request failed: ${e.message}`);
    }
    delete core._metaReqCache[cacheKey];
  });
}

// 시작 직후 모든 로드된 트랙에 대해 metadata 재요청 (force=true).
function refreshAllMetadata(core){
  for(const [key,dev] of Object.entries(core.devices)){
    if(dev.type==='CDJ' && dev.state?.trackId>0 && dev.state?.hasTrack){
      const s=dev.state;
      const srcDev = core.devices['cdj'+s.trackDeviceId];
      const ip = srcDev?.ip || dev.ip;
      requestMetadata(core, ip, s.slot||3, s.trackId, s.playerNum, true, s.trackType||1);
    }
  }
}

// album art 단독 요청. cache hit 면 즉시 emit.
function requestArtwork(core, ip, slot, artworkId, playerNum){
  if(!ip || !artworkId) return;
  const cacheKey = `art_${ip}_${slot}_${artworkId}`;
  if(core._artCache[cacheKey]){
    core.onAlbumArt?.(playerNum, core._artCache[cacheKey]);
    return;
  }
  core._dbserverArtwork(ip, slot, artworkId, playerNum, cacheKey).catch(e=>{
    if(core._shouldLogRate(`db_art_fail_${cacheKey}`, 10000, e.message)){
      console.warn(`[DBSRV] artwork request failed: ${e.message}`);
    }
  });
}

// metadata 직후 무거운 후속 요청 (waveform/cue/beatgrid/structure) 을
// 시간차 발송 — HW 트랙 로드 시 병렬 TCP 폭주로 UI/audio 가 stall 되는 것 방지.
// token 으로 같은 player 의 새 트랙이 들어오면 이전 token 의 timer 들 무효화.
function scheduleDbFollowUps(core, ip, slot, trackId, playerNum, trackType, artworkId){
  if(!core._dbFollowTimers) core._dbFollowTimers = {};
  const key = `p${playerNum}`;
  const prev = core._dbFollowTimers[key];
  if(prev?.timers){
    prev.timers.forEach(t=>clearTimeout(t));
  }
  const token = `${ip}_${slot}_${trackId}_${Date.now()}`;
  const timers = [];
  const alive = ()=>core._dbFollowTimers?.[key]?.token===token;
  const defer = (delay, fn)=>{
    const timer = setTimeout(()=>{
      if(!alive()) return;
      fn().catch(e=>{
        if(core._shouldLogRate(`db_follow_fail_${playerNum}_${delay}`, 10000, e.message)){
          console.warn(`[DBSRV] P${playerNum} follow-up failed:`, e.message);
        }
      });
    }, delay);
    timers.push(timer);
  };
  core._dbFollowTimers[key] = { token, timers };

  if(artworkId){
    defer(0, ()=>core._dbserverArtwork(ip, slot, artworkId, playerNum, `art_${ip}_${slot}_${artworkId}`));
  }
  defer(180, ()=>core._dbserverWaveform(ip, slot, trackId, playerNum, trackType));
  defer(520, ()=>core._dbserverWaveformDetail(ip, slot, trackId, playerNum, trackType));
  defer(920, ()=>core._dbserverWaveformNxs2(ip, slot, trackId, playerNum, trackType));
  defer(1280, ()=>core._dbserverCuePoints(ip, slot, trackId, playerNum, trackType));
  defer(1640, ()=>core._dbserverBeatGrid(ip, slot, trackId, playerNum, trackType));
  defer(2320, ()=>core._dbserverSongStructure(ip, slot, trackId, playerNum, trackType));
}

module.exports = { requestMetadata, refreshAllMetadata, requestArtwork, scheduleDbFollowUps };
