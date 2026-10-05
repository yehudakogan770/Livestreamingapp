// The two trackers. Each is given frames one after another (forward or
// backward: they don't mind) and says where the thing it follows is now.
//  - Point: one spot (its position).
//  - Region: a box (its position, size and turn), from many spots inside it
//    that agree with each other.
import {
  alignSimilarity,
  applySim,
  goodFeatures,
  lucasKanade,
  matchTemplate,
  ncc,
  patch,
  pyramid,
  robustSimilarity,
  sample,
  simAngle,
  simScale,
  type Gray,
  type Similarity,
} from './math';

/** Where the followed thing is: pixels of the analyzed picture, size (1: as at the start) and turn (degrees). */
export interface Pose {
  x: number;
  y: number;
  scale: number;
  angle: number;
  /** It was found in this frame (false: lost, stop here). */
  ok: boolean;
  /** How sure (0–1). */
  score: number;
}

const LEVELS = 4;

export class PointTracker {
  private prev: Gray[];
  private x: number;
  private y: number;
  private vx = 0;
  private vy = 0;
  /** What the spot looks like (updated slowly when its look changes). */
  private ref: Float32Array;
  private refPyr: Gray[];
  private refX: number;
  private refY: number;

  constructor(
    first: Gray,
    x: number,
    y: number,
    private r = 10,
  ) {
    this.prev = pyramid(first, LEVELS);
    this.x = x;
    this.y = y;
    this.ref = patch(first, x, y, r);
    this.refPyr = this.prev;
    this.refX = x;
    this.refY = y;
  }

  /** Start again from a known place (a point set by hand). */
  reset(img: Gray, x: number, y: number) {
    this.prev = pyramid(img, LEVELS);
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.ref = patch(img, x, y, this.r);
    this.refPyr = this.prev;
    this.refX = x;
    this.refY = y;
  }

  step(next: Gray): Pose {
    const pyr = pyramid(next, LEVELS);
    const guess: [number, number] = [this.x + this.vx, this.y + this.vy];
    let flow = lucasKanade(this.prev, pyr, this.x, this.y, this.r, guess);
    let score = flow.ok ? ncc(this.ref, patch(next, flow.x, flow.y, this.r)) : -1;
    // Lost frame to frame (a fast move, a blur): look around for the spot's look.
    if (score < 0.7) {
      const found = matchTemplate(next, this.ref, this.r, Math.round(guess[0]), Math.round(guess[1]), 24, 2);
      if (found.score > Math.max(0.6, score)) {
        flow = { x: found.x, y: found.y, ok: true, detail: flow.detail };
        score = found.score;
      }
    }
    if (!flow.ok || score < 0.5) return { x: this.x, y: this.y, scale: 1, angle: 0, ok: false, score: Math.max(0, score) };
    // Small errors add up frame after frame: line it up with the spot's look again.
    const back = lucasKanade(this.refPyr.slice(0, 2), pyr.slice(0, 2), this.refX, this.refY, this.r, [flow.x, flow.y], 20);
    if (back.ok && Math.hypot(back.x - flow.x, back.y - flow.y) < 1.5) {
      const s = ncc(this.ref, patch(next, back.x, back.y, this.r));
      if (s >= score - 0.01) {
        flow = back;
        score = s;
      }
    }
    this.vx = flow.x - this.x;
    this.vy = flow.y - this.y;
    this.x = flow.x;
    this.y = flow.y;
    this.prev = pyr;
    // Its look changed (it turns, the light changes): remember the new look.
    if (score < 0.85) {
      this.ref = patch(next, this.x, this.y, this.r);
      this.refPyr = pyr;
      this.refX = this.x;
      this.refY = this.y;
    }
    return { x: this.x, y: this.y, scale: 1, angle: 0, ok: true, score: Math.max(0, Math.min(1, score)) };
  }
}

/** A box: its center and size (pixels of the analyzed picture). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PlanarTracker {
  private prev: Gray[];
  /** Each spot: where it is now, and where it sits in the box itself (from its center, at the starting size and turn). */
  private pts: { x: number; y: number; ox: number; oy: number }[] = [];
  private cx: number;
  private cy: number;
  private scale = 1;
  private angle = 0;
  private wanted: number;
  /** The region's look: spots on a grid in the box's own terms, and the picture's values there. */
  private grid: [number, number][] = [];
  private look = new Float32Array(0);

  constructor(
    first: Gray,
    private box: Box,
    private max = 48,
  ) {
    this.prev = pyramid(first, LEVELS);
    this.cx = box.x;
    this.cy = box.y;
    const step = Math.max(2, Math.sqrt((box.w * box.h) / 1600));
    for (let y = -box.h / 2 + step / 2; y < box.h / 2; y += step) for (let x = -box.w / 2 + step / 2; x < box.w / 2; x += step) this.grid.push([x, y]);
    this.remember(first);
    this.seed(first);
    this.wanted = this.pts.length;
  }

  /** The box as a move + size + turn from its own terms into the picture. */
  private get sim(): Similarity {
    const a = (this.angle * Math.PI) / 180;
    return { a: this.scale * Math.cos(a), b: this.scale * Math.sin(a), tx: this.cx, ty: this.cy };
  }

  /** Remember what the region looks like now. */
  private remember(img: Gray) {
    const s = this.sim;
    this.look = Float32Array.from(this.grid, ([x, y]) => {
      const [px, py] = applySim(s, x, y);
      return sample(img, px, py);
    });
  }

  /** Spots it follows right now (for drawing, and tests). */
  get points(): [number, number][] {
    return this.pts.map((p) => [p.x, p.y]);
  }

  reset(img: Gray, x: number, y: number, scale = this.scale, angle = this.angle) {
    this.prev = pyramid(img, LEVELS);
    this.cx = x;
    this.cy = y;
    this.scale = scale;
    this.angle = angle;
    this.pts = [];
    this.remember(img);
    this.seed(img);
  }

  /** A point of the picture in the box's own terms (from its center, at the starting size and turn). */
  private toBox(x: number, y: number): [number, number] {
    const a = (-this.angle * Math.PI) / 180;
    const dx = x - this.cx;
    const dy = y - this.cy;
    return [(dx * Math.cos(a) - dy * Math.sin(a)) / this.scale, (dx * Math.sin(a) + dy * Math.cos(a)) / this.scale];
  }

  /** Is a point inside the box as it is now (moved, sized, turned)? */
  private inside(x: number, y: number, shrink = 0.9): boolean {
    const [u, v] = this.toBox(x, y);
    return Math.abs(u) <= (this.box.w / 2) * shrink && Math.abs(v) <= (this.box.h / 2) * shrink;
  }

  /** Find spots to follow inside the box (keeping the ones it has). */
  private seed(img: Gray) {
    const more = goodFeatures(img, (x, y) => this.inside(x, y), this.max, Math.max(4, Math.min(this.box.w, this.box.h) / 12));
    for (const [x, y] of more) {
      if (this.pts.length >= this.max) break;
      if (this.pts.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < 9)) continue;
      const [ox, oy] = this.toBox(x, y);
      this.pts.push({ x, y, ox, oy });
    }
  }

  step(next: Gray): Pose {
    const pyr = pyramid(next, LEVELS);
    const moved: { x: number; y: number; ox: number; oy: number }[] = [];
    for (const p of this.pts) {
      const f = lucasKanade(this.prev, pyr, p.x, p.y, 7);
      if (f.ok && f.detail >= 0.5) moved.push({ ...p, x: f.x, y: f.y });
    }
    // The box's place, size and turn: the best fit from where each spot sits in the box to where it is now
    // (measured from the start every time, so small errors don't add up).
    const fit =
      moved.length >= 3
        ? robustSimilarity(
            moved.map((p) => [p.ox, p.oy]),
            moved.map((p) => [p.x, p.y]),
          )
        : null;
    const kept = fit ? fit.inliers.filter(Boolean).length : 0;
    if (!fit || kept < 3) return { x: this.cx, y: this.cy, scale: this.scale, angle: this.angle, ok: false, score: 0 };
    // Then line the whole region up with its look, for an exact size and turn.
    let sim = fit.sim;
    const exact = alignSimilarity(next, this.grid, this.look, sim);
    const near = Math.hypot(exact.sim.tx - sim.tx, exact.sim.ty - sim.ty) < 3 && Math.abs(simScale(exact.sim) / simScale(sim) - 1) < 0.05;
    if (near && exact.score > 0.6) sim = exact.sim;
    this.cx = sim.tx;
    this.cy = sim.ty;
    this.scale = simScale(sim);
    this.angle = simAngle(sim);
    // Its look changed (light, a turn away): remember the new look.
    if (!near || exact.score < 0.8) this.remember(next);
    this.pts = moved.filter((p, i) => fit.inliers[i] && this.inside(p.x, p.y, 1.05));
    this.prev = pyr;
    // Spots were lost (hidden, left the box): find new ones.
    if (this.pts.length < Math.max(6, this.wanted * 0.6)) this.seed(next);
    return { x: this.cx, y: this.cy, scale: this.scale, angle: this.angle, ok: true, score: Math.min(1, kept / Math.max(1, moved.length)) };
  }
}
