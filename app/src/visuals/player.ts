// Turns the show's visuals state and the clock into one frame's settings.
// A port of Stage Visuals Live's frame(): each screen runs its own player,
// and since the beat comes from the shared anchor they all stay together.
//
// Smoothness (as in the original): every scene runs on its own clock, so
// speed changes and resyncs never make it jump; sliders glide instead of
// snapping; color-set changes blend.

import type { Visuals } from '../engine/types/Visuals';
import type { VisualsFx } from '../engine/types/VisualsFx';
import type { VisualsLogo } from '../engine/types/VisualsLogo';
import { hexRgb, palMat, sceneRow, type SceneRow } from './data';
import type { Frame } from './renderer';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth01 = (x: number) => x * x * (3 - 2 * x);
const GLIDE = ['zoom', 'panX', 'panY', 'hue', 'sat', 'con', 'glow', 'trail', 'echo', 'echoRot', 'rgb', 'pix', 'vig', 'scan', 'ov'] as const;
type Glide = (typeof GLIDE)[number];
const PAL_MS = 700;

/** The beat at `now` (mirrors Visuals::beat_at). */
export function beatAt(v: Visuals, now: number): number {
  return v.anchorBeat + ((now - v.anchorAt) * v.bpm) / 60000;
}

/** How far the change to the current scene is, 0 – 1. */
export function fadeMix(v: Visuals, beat: number): number {
  if (!v.from) return 1;
  if (v.fadeLen > 0) return clamp((beat - v.fadeStart) / v.fadeLen, 0, 1);
  return beat >= v.fadeStart ? 1 : 0;
}

export class VisualsPlayer {
  private G: Partial<Record<Glide, number>> = {};
  private clocks = new Map<string, { lb: number; ph: number }>();
  private speedV: number | null = null;
  private brightV: number | null = null;
  private palMode: string | null = null;
  private palFrom: string | null = null;
  private palAt = 0;
  private rotAcc = 0;
  private hueAcc = 0;
  private lastRb: number | null = null;
  private lastT: number | null = null;
  private blackV = 0;
  private textV = 0;
  private kick = 0;
  private shown = '';
  /** The flash on the beat in the last frame, 0 – 1 (the logo pulses with it). */
  beatPulse = 0;

  /** Settings for the frame at `now` (ms, same clock as the engine). */
  frame(v: Visuals, now: number): Frame {
    const beat = beatAt(v, now);
    const st = v.settings;
    const F = v.fx;
    const rb = v.frozen ?? beat;
    const dB = this.lastRb === null ? 0 : clamp(rb - this.lastRb, -1, 1);
    this.lastRb = rb;
    const dt = this.lastT === null ? 0 : clamp((now - this.lastT) / 1000, 0, 0.1);
    this.lastT = now;
    const k60 = dt * 60;
    const ease = (tc: number) => 1 - Math.exp(-dt / tc);
    const approach = (val: number, to: number, f: number) => val + (to - val) * (1 - Math.pow(1 - f, k60));
    const gk = ease(0.12);
    const target: Record<Glide, number> = {
      zoom: F.zoom,
      panX: F.panX,
      panY: F.panY,
      hue: F.hue,
      sat: F.sat,
      con: F.con,
      glow: F.glow,
      trail: F.trail,
      echo: F.echo,
      echoRot: F.echoRot,
      rgb: F.rgb,
      pix: F.pix,
      vig: F.vig,
      scan: F.scan,
      ov: F.ov,
    };
    const G = this.G as Record<Glide, number>;
    for (const key of GLIDE) G[key] = G[key] === undefined ? target[key] : G[key] + (target[key] - G[key]) * gk;
    this.speedV = this.speedV === null ? st.speed : this.speedV + (st.speed - this.speedV) * ease(0.25);
    this.brightV = this.brightV === null ? st.bright : this.brightV + (st.bright - this.brightV) * gk;
    this.rotAcc = (this.rotAcc + (F.spin * dB * Math.PI) / 8) % (Math.PI * 2);
    this.hueAcc = (this.hueAcc + F.hueCycle * dB * 0.5) % (Math.PI * 2);

    // The flash on the beat (stronger on beat 1).
    let bp = 0;
    const ev = st.flashEvery;
    if (v.frozen === null && ev > 0) {
      const phB = (rb / ev - Math.floor(rb / ev)) * ev;
      bp = Math.exp(-phB * 6) * (ev === 1 ? (((Math.floor(rb) % 4) + 4) % 4 === 0 ? 1 : 0.6) : 1);
    }
    const mix = fadeMix(v, beat);
    // A hard cut kicks.
    const showing = mix >= 1 ? `${v.scene.bank}:${v.scene.scene}` : this.shown;
    if (showing !== this.shown) {
      if (this.shown && v.fadeLen === 0) this.kick = Math.max(this.kick, 0.5);
      this.shown = showing;
    }
    this.kick *= Math.pow(0.9, k60);
    const sinceFlash = now - v.flashAt;
    const whiteFlash = v.flashAt > 0 && sinceFlash >= 0 && sinceFlash < 3000 ? Math.pow(0.85, sinceFlash / (1000 / 60)) : 0;
    this.beatPulse = bp;
    // Safe mode: gentler flashes, no strobe.
    const flashMax = st.safe ? 0.5 : 1;
    const pulse = Math.max(bp, this.kick);
    this.blackV = approach(this.blackV, v.blackout ? 1 : 0, st.slowBlackout ? 0.03 : 0.15);
    this.textV = approach(this.textV, v.text.on ? 1 : 0, 0.12);
    const white = Math.min(flashMax, Math.max(v.strobe && !st.safe && (beat * st.strobeDiv) % 1 < 0.3 ? 1 : 0, whiteFlash));
    const mixE = smooth01(mix);

    const cur = v.scene;
    const prev = v.from ?? cur;
    const ovRef = F.ovScene;
    const s1 = sceneRow(cur.bank, cur.scene);
    const s0 = sceneRow(prev.bank, prev.scene);
    const s2 = sceneRow(ovRef.bank, ovRef.scene);
    const speed = this.speedV;
    const refs = [prev, cur, ovRef];
    const rows = [s0, s1, s2];
    const rates = rows.map((r) => r[3] * speed);
    const adv = clamp(dB, 0, 0.5);
    const seen = new Set<string>();
    const clk = refs.map((r, n) => {
      const k = `${r.bank}:${r.scene}`;
      let c = this.clocks.get(k);
      if (!c) {
        const lb = ((rb % 64) + 64) % 64;
        c = { lb, ph: lb * rates[n]! };
        this.clocks.set(k, c);
      }
      if (!seen.has(k)) {
        seen.add(k);
        c.lb += adv;
        c.ph += adv * rates[n]!;
      }
      return c;
    });
    for (const k of this.clocks.keys()) if (!seen.has(k)) this.clocks.delete(k);

    if (this.palMode === null) this.palMode = st.palette;
    if (st.palette !== this.palMode) {
      this.palFrom = this.palMode;
      this.palMode = st.palette;
      this.palAt = now;
    }
    const pe = this.palFrom === null ? 1 : smooth01(clamp((now - this.palAt) / PAL_MS, 0, 1));
    if (pe >= 1) this.palFrom = null;
    const pkey = (mode: string, sc: SceneRow) => (mode === 'scene' ? sc[2] : mode);
    const pmat = (sc: SceneRow) => {
      const a = palMat(pkey(this.palMode!, sc));
      if (this.palFrom === null) return a;
      const b = palMat(pkey(this.palFrom, sc));
      return a.map((x, i) => b[i]! + (x - b[i]!) * pe);
    };
    const t = v.text;
    return {
      beat: rb,
      b0: clk[0]!.lb,
      b1: clk[1]!.lb,
      b2: clk[2]!.lb,
      pulse,
      mix: mixE,
      m0: s0[1],
      m1: s1[1],
      m2: s2[1],
      p0: pmat(s0),
      p1: pmat(s1),
      p2: pmat(s2),
      s0: clk[0]!.ph,
      s1: clk[1]!.ph,
      s2: clk[2]!.ph,
      f0: s0[4] * st.flash * flashMax,
      f1: s1[4] * st.flash * flashMax,
      f2: s2[4] * st.flash * flashMax,
      k0: s0[5],
      k1: s1[5],
      k2: s2[5],
      ov: G.ov,
      ovMode: F.ovMode,
      zoom: G.zoom * (1 + F.pump * bp * 0.35),
      rot: this.rotAcc,
      panX: G.panX,
      panY: G.panY,
      kal: F.kal,
      mirror: F.mirror,
      trail: G.trail,
      echo: G.echo,
      echoRot: G.echoRot,
      rgb: G.rgb,
      pix: G.pix,
      hue: (G.hue + this.hueAcc) % (Math.PI * 2),
      sat: G.sat,
      con: G.con,
      glow: G.glow,
      post: F.post,
      bright: this.brightV,
      white,
      black: this.blackV,
      inv: v.invert ? 1 : 0,
      scan: G.scan,
      vig: G.vig,
      q: st.quality,
      text: { on: this.textV, str: t.words, font: t.font, col: hexRgb(t.color), scale: t.size * (1 + bp * t.pulse * 0.12), y: t.y },
    };
  }
}

/** Effects back to the scene as designed (the overlay layer's choice is kept). */
export function resetFx(fx: VisualsFx): VisualsFx {
  return { ...defaultFx(), ovMode: fx.ovMode, ovScene: fx.ovScene };
}

/** Mirrors VisualsFx::default. */
export function defaultFx(): VisualsFx {
  return {
    zoom: 1,
    spin: 0,
    panX: 0,
    panY: 0,
    pump: 0,
    kal: 0,
    mirror: 0,
    hue: 0,
    hueCycle: 0,
    sat: 1,
    con: 1,
    glow: 0,
    trail: 0,
    echo: 0,
    echoRot: 0,
    rgb: 0,
    pix: 0,
    post: 0,
    scan: 0,
    vig: 0,
    ov: 0,
    ovMode: 1,
    ovScene: { bank: 0, scene: 0 },
  };
}

/**
 * Where the event logo goes on the visuals, in pixels of a W×H frame
 * (`aspect` is the logo's width / height). Grows a little on the beat.
 */
export function logoRect(logo: VisualsLogo, pulse: number, W: number, H: number, aspect: number): { x: number; y: number; w: number; h: number } {
  const scale = 1 + pulse * logo.pulse * 0.12;
  let h = H * logo.size * scale;
  let w = h * (aspect || 1);
  // Never wider than most of the screen.
  if (w > W * 0.8) {
    w = W * 0.8;
    h = w / (aspect || 1);
  }
  const m = H * 0.05;
  const cx = logo.place === 'corner' ? W - m - (H * logo.size * (aspect || 1)) / 2 : W / 2;
  const cy = logo.place === 'corner' ? m + (H * logo.size) / 2 : logo.place === 'bottom' ? H - m * 1.6 - (H * logo.size) / 2 : H / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
