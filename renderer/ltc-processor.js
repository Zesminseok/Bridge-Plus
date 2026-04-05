/**
 * SMPTE LTC (Linear Time Code) AudioWorklet Processor
 * Biphase Mark Code (BMC) encoding — 2-channel (A=left, B=right)
 * Each channel independently encodes HH:MM:SS:FF at configured fps
 */
class LTCProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ch = [this._mkCh(), this._mkCh()];
    this.port.onmessage = ({data}) => {
      const c = this.ch[data.ch & 1];
      if(data.cmd === 'setPos') {
        c.fps = data.fps || 25;
        c.spb = Math.round(sampleRate / c.fps / 80 / 2); // samples per half-bit
        c.hh = data.hh|0; c.mm = data.mm|0; c.ss = data.ss|0; c.ff = data.ff|0;
        c.running = !!data.running;
        this._encode(c);
      }
    };
  }

  _mkCh() {
    const c = {
      fps: 25, spb: Math.round(sampleRate / 25 / 80 / 2),
      bits: new Uint8Array(80), phase: 1,
      bitIdx: 0, half: 0, sc: 0, running: false,
      hh: 0, mm: 0, ss: 0, ff: 0,
    };
    this._encode(c);
    return c;
  }

  _encode(c) {
    const b = c.bits;
    b.fill(0);
    const {hh, mm, ss, ff} = c;
    // Frame units / tens
    const fu = ff % 10, ft = Math.floor(ff / 10);
    b[0]=(fu>>0)&1; b[1]=(fu>>1)&1; b[2]=(fu>>2)&1; b[3]=(fu>>3)&1;
    b[8]=(ft>>0)&1; b[9]=(ft>>1)&1;
    // Seconds units / tens
    const su = ss % 10, st = Math.floor(ss / 10);
    b[16]=(su>>0)&1; b[17]=(su>>1)&1; b[18]=(su>>2)&1; b[19]=(su>>3)&1;
    b[24]=(st>>0)&1; b[25]=(st>>1)&1; b[26]=(st>>2)&1;
    // Minutes units / tens
    const mu = mm % 10, mt = Math.floor(mm / 10);
    b[32]=(mu>>0)&1; b[33]=(mu>>1)&1; b[34]=(mu>>2)&1; b[35]=(mu>>3)&1;
    b[40]=(mt>>0)&1; b[41]=(mt>>1)&1; b[42]=(mt>>2)&1;
    // Hours units / tens
    const hu = hh % 10, ht = Math.floor(hh / 10);
    b[48]=(hu>>0)&1; b[49]=(hu>>1)&1; b[50]=(hu>>2)&1; b[51]=(hu>>3)&1;
    b[56]=(ht>>0)&1; b[57]=(ht>>1)&1;
    // Sync word bits 64-79: 0011111111111101 (MSB-first)
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1].forEach((v,i) => b[64+i]=v);
    // Polarity correction bit 27: ensure even number of 1-bits in bits 0-63
    let ones = 0;
    for(let i=0;i<64;i++) if(i!==27) ones += b[i];
    b[27] = ones & 1; // make total even
  }

  _tick(c) {
    if(!c.running) return 0;
    if(c.sc === 0) {
      if(c.half === 0) {
        c.phase = -c.phase; // start-of-bit transition
      } else {
        if(c.bits[c.bitIdx] === 1) c.phase = -c.phase; // mid-bit for bit=1
      }
    }
    const v = c.phase * 0.85;
    if(++c.sc >= c.spb) {
      c.sc = 0;
      c.half ^= 1;
      if(c.half === 0) {
        if(++c.bitIdx >= 80) {
          c.bitIdx = 0;
          // Advance to next frame
          if(++c.ff >= c.fps) { c.ff=0; if(++c.ss>=60){c.ss=0;if(++c.mm>=60){c.mm=0;if(++c.hh>=24)c.hh=0;}}}
          this._encode(c);
        }
      }
    }
    return v;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1];
    if(!L) return true;
    const n = L.length;
    for(let i=0; i<n; i++) {
      L[i] = this._tick(this.ch[0]);
      if(R) R[i] = this._tick(this.ch[1]);
    }
    return true;
  }
}
registerProcessor('ltc-processor', LTCProcessor);
