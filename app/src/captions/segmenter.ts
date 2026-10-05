// Cuts live sound (16 kHz) into phrases for the speech model: it notices
// when someone starts and stops talking, hands over each finished phrase,
// and, while they talk, the phrase so far (so words appear as they're said).

export type Piece = { kind: 'partial' | 'final'; audio: Float32Array };

const RATE = 16000;
const FRAME = 480; // 30 ms
const START_FRAMES = 3; // 90 ms of speech starts a phrase
const END_MS = 600; // this much quiet ends it
const MAX_S = 8; // a long phrase is handed over in parts
const PARTIAL_MS = 1000;
const PREROLL_FRAMES = 10; // keep 300 ms before the start, so first words aren't clipped

export class Segmenter {
  private floor = 0.002;
  private loud = 0;
  private quietMs = 0;
  private speaking = false;
  private frames: Float32Array[] = [];
  private preroll: Float32Array[] = [];
  private rest = new Float32Array(0);
  private sincePartial = 0;

  /** Feed more sound; returns the phrases (or phrases so far) ready for the model. */
  push(chunk: Float32Array): Piece[] {
    const out: Piece[] = [];
    let buf = chunk;
    if (this.rest.length) {
      buf = new Float32Array(this.rest.length + chunk.length);
      buf.set(this.rest);
      buf.set(chunk, this.rest.length);
    }
    let i = 0;
    for (; i + FRAME <= buf.length; i += FRAME) this.frame(buf.slice(i, i + FRAME), out);
    this.rest = buf.slice(i);
    return out;
  }

  private frame(f: Float32Array, out: Piece[]) {
    let sum = 0;
    for (const v of f) sum += v * v;
    const rms = Math.sqrt(sum / f.length);
    const voice = rms > Math.max(0.004, this.floor * 3);
    // The background level follows the quiet moments.
    if (!voice) this.floor = this.floor * 0.98 + rms * 0.02;
    const ms = (FRAME / RATE) * 1000;
    if (!this.speaking) {
      this.preroll.push(f);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      this.loud = voice ? this.loud + 1 : 0;
      if (this.loud >= START_FRAMES) {
        this.speaking = true;
        this.frames = [...this.preroll];
        this.preroll = [];
        this.quietMs = 0;
        this.sincePartial = 0;
      }
      return;
    }
    this.frames.push(f);
    this.quietMs = voice ? 0 : this.quietMs + ms;
    this.sincePartial += ms;
    const lengthS = (this.frames.length * FRAME) / RATE;
    if (this.quietMs >= END_MS || lengthS >= MAX_S) {
      out.push({ kind: 'final', audio: join(this.frames) });
      this.frames = [];
      this.speaking = lengthS >= MAX_S && this.quietMs < END_MS;
      this.loud = 0;
      this.sincePartial = 0;
    } else if (this.sincePartial >= PARTIAL_MS && lengthS >= 1) {
      this.sincePartial = 0;
      out.push({ kind: 'partial', audio: join(this.frames) });
    }
  }
}

function join(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => out.set(f, i * FRAME));
  return out;
}
