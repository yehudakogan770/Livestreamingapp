// Instant replay: while it is on, the last minute of the Live Screen (picture
// and Stream mix) is kept in memory as short pieces, each starting on a
// whole picture. A replay is the last few seconds, saved and lined up as a
// playlist video, in slow motion if wanted.

/** Length of each piece. */
const PIECE_MS = 3000;
/** How much is kept. */
export const KEEP_MS = 60_000;

export interface Piece {
  blob: Blob;
  start: number;
  end: number;
}

/** H.264 for replays when this WebView can also play it back: it is encoded on the graphics card where there is one (VP9 and VP8 mostly on the processor). */
const H264_REPLAY: [record: string, play: string][] = [
  ['video/x-matroska;codecs=avc1,opus', 'video/x-matroska; codecs="avc1.640028, opus"'],
  ['video/webm;codecs=h264,opus', 'video/webm; codecs="avc1.640028, opus"'],
];

/** The best format for replays (VP9/VP8 WebM play back everywhere Lumora runs). */
export function replayType(canPlay: (type: string) => boolean = defaultCanPlay): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const h264 = H264_REPLAY.find(([rec, play]) => MediaRecorder.isTypeSupported(rec) && canPlay(play));
  if (h264) return h264[0];
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function defaultCanPlay(type: string): boolean {
  return typeof document !== 'undefined' && document.createElement('video').canPlayType(type) === 'probably';
}

/** The file ending for a replay piece. */
export function replayExt(type: string): 'mkv' | 'webm' {
  return type.includes('matroska') ? 'mkv' : 'webm';
}

/** The pieces covering the last `ms` before `now`, oldest first. */
export function piecesFor(pieces: Piece[], ms: number, now: number): Piece[] {
  const from = now - ms;
  return pieces.filter((p) => p.end > from);
}

export class ReplayBuffer {
  private pieces: Piece[] = [];
  private current: { rec: MediaRecorder; start: number; chunks: Blob[] } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly mime: string;

  constructor(private readonly stream: MediaStream) {
    const t = replayType();
    if (!t) throw new Error('This computer can’t record replays.');
    this.mime = t;
    this.next();
    this.timer = setInterval(() => this.next(), PIECE_MS);
  }

  /** Start a new piece, then finish the one before (they overlap a moment, so nothing is missed). */
  private next(): Promise<void> {
    const old = this.current;
    const rec = new MediaRecorder(this.stream, { mimeType: this.mime, videoBitsPerSecond: 8_000_000 });
    const piece = { rec, start: Date.now(), chunks: [] as Blob[] };
    rec.ondataavailable = (e) => e.data.size && piece.chunks.push(e.data);
    rec.start();
    this.current = piece;
    if (!old) return Promise.resolve();
    return new Promise((resolve) => {
      old.rec.onstop = () => {
        const end = Date.now();
        this.pieces.push({ blob: new Blob(old.chunks, { type: this.mime }), start: old.start, end });
        this.pieces = this.pieces.filter((p) => p.end > end - KEEP_MS);
        resolve();
      };
      old.rec.stop();
    });
  }

  /** The last `ms`, as finished pieces (the one being recorded is finished now). */
  async take(ms: number): Promise<Piece[]> {
    await this.next();
    return piecesFor(this.pieces, ms, Date.now());
  }

  /** How many seconds are kept now. */
  get seconds(): number {
    const first = this.pieces[0];
    return first ? Math.round((Date.now() - first.start) / 1000) : 0;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current && this.current.rec.state !== 'inactive') this.current.rec.stop();
    this.current = null;
    this.pieces = [];
  }
}
