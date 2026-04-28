// NXS2 beat anchor predictor — bridge-core.js 에서 추출 (Phase 5.1).
// 두 함수 모두 self-contained: instance state / socket / 외부 dep 없음.
// 동작 보존: 입력 → 출력 동일 (input/output contract preservation).
'use strict';

// CDJ-2000NXS2 의 trackBeats 카운트 (정수) 를 ms 로 변환.
// bpm 이 양수이고 beatCount 가 양수일 때만 의미.
function nxs2BeatCountToMs(beatCount, bpm){
  const bn = Number(beatCount) || 0;
  const b = Number(bpm) || 0;
  if(!(bn > 0) || !(b > 0)) return 0;
  return Math.round(bn * 60000 / b);
}

// 내부 예측 위치 (extrapolated) 와 새로 들어온 beat-anchor 간 차이가
// half-beat 안이면 예측 유지 (jitter 흡수). reverse / 0 / negative 케이스 거부.
function shouldKeepPredictedBeatAnchor(predictedMs, beatMs, bpm, isReverse=false){
  const predicted = Number(predictedMs) || 0;
  const anchored = Number(beatMs) || 0;
  const trackBpm = Number(bpm) || 0;
  if(!(predicted > 0) || !(anchored > 0) || isReverse) return false;
  const delta = Math.abs(anchored - predicted);
  const halfBeatMs = trackBpm > 0 ? Math.max(120, 30000 / trackBpm) : 250;
  return delta < halfBeatMs;
}

module.exports = { nxs2BeatCountToMs, shouldKeepPredictedBeatAnchor };
