// Minimal Ableton Link binding — BPM-only sync surface used by BRIDGE+.
// Intentionally smaller than upstream node-abletonlink: no event callbacks,
// no audio-thread variant, no play-state sync. The main process polls these
// getters from a JS interval, which avoids ThreadSafeFunction abort crashes
// observed with the v0.2.0-beta.0 upstream binding.

export declare class Link {
  constructor(initialBpm?: number);
  enable(on: boolean): void;
  setBpm(bpm: number): void;
  getBpm(): number;
  getBeat(): number;
  getPhase(): number;
  getNumPeers(): number;
  /** Force-align the session beat (for tap downbeat / master-deck sync). */
  setBeat(beat: number): void;
}

export default Link;
