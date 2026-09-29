// Stage visuals rules shared by the demo engine (mirrors crates/engine/src/visuals.rs).

import { BANKS } from '../visuals/data';
import { beatAt, defaultFx } from '../visuals/player';
import type { SceneRef } from './types/SceneRef';
import type { Visuals } from './types/Visuals';
import type { VisualsPatch } from './types/VisualsPatch';

export { beatAt };
export const LOOK_SLOTS = 8;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Mirrors Visuals::default. */
export function defaultVisuals(): Visuals {
  return {
    bpm: 100,
    anchorAt: 0,
    anchorBeat: 0,
    scene: { bank: 1, scene: 0 },
    from: null,
    fadeStart: 0,
    fadeLen: 0,
    nextAuto: null,
    settings: {
      flash: 1,
      speed: 1,
      bright: 1,
      palette: 'scene',
      fade: -1,
      quantize: 'beat',
      autoBars: 0,
      autoRandom: false,
      bankTempo: true,
      flashEvery: 1,
      strobeDiv: 2,
      slowBlackout: false,
      quality: 1,
      safe: true,
    },
    fx: defaultFx(),
    text: { on: false, words: '', font: 'clean', color: '#ffffff', size: 0.6, y: 0, pulse: 0.3 },
    strobe: false,
    blackout: false,
    invert: false,
    frozen: null,
    flashAt: 0,
    looks: Array<null>(LOOK_SLOTS).fill(null),
    favourites: [],
    logo: { on: false, place: 'corner', size: 0.18, pulse: 0.3 },
  };
}

export const sceneExists = (r: SceneRef) => r.scene < (BANKS[r.bank]?.scenes.length ?? 0);

export function setBpm(v: Visuals, bpm: number, now: number) {
  v.anchorBeat = beatAt(v, now);
  v.anchorAt = now;
  v.bpm = Math.round(clamp(bpm, 40, 220) * 10) / 10;
  planAuto(v, now);
}

export function syncToOne(v: Visuals, now: number) {
  const b = Math.round(beatAt(v, now) / 4) * 4;
  v.anchorBeat = b;
  v.anchorAt = now;
  if (v.frozen !== null) v.frozen = b;
  v.nextAuto = null;
  planAuto(v, now);
}

function planAuto(v: Visuals, now: number) {
  const bars = v.settings.autoBars;
  if (bars <= 0) v.nextAuto = null;
  else if (v.nextAuto === null) v.nextAuto = (Math.floor(Math.floor(beatAt(v, now) / 4) / bars) + 1) * bars * 4;
}

export function launch(v: Visuals, to: SceneRef, now: number) {
  if (!sceneExists(to)) return;
  const pending = v.fadeStart > beatAt(v, now);
  if (to.bank === v.scene.bank && to.scene === v.scene.scene && !pending) return;
  if (to.bank !== v.scene.bank && v.settings.bankTempo) setBpm(v, BANKS[to.bank]!.bpm, now);
  const beat = beatAt(v, now);
  const q = v.settings.quantize;
  const at = q === 'now' ? beat : q === 'beat' ? Math.ceil(beat) : Math.ceil(beat / 4) * 4;
  if (!pending) v.from = { ...v.scene };
  v.scene = { ...to };
  v.fadeStart = at;
  v.fadeLen = v.settings.fade < 0 ? BANKS[to.bank]!.fade : v.settings.fade;
  v.nextAuto = null;
  planAuto(v, now);
}

export function step(v: Visuals, dir: number, now: number) {
  const n = BANKS[v.scene.bank]!.scenes.length;
  launch(v, { bank: v.scene.bank, scene: (v.scene.scene + (dir < 0 ? n - 1 : 1)) % n }, now);
}

export const visualsDue = (v: Visuals, now: number) => v.frozen === null && v.nextAuto !== null && beatAt(v, now) >= v.nextAuto;

export function autoChange(v: Visuals, now: number) {
  const n = BANKS[v.scene.bank]!.scenes.length;
  const i = v.settings.autoRandom && n > 1 ? (v.scene.scene + 1 + Math.floor(Math.random() * (n - 1))) % n : (v.scene.scene + 1) % n;
  const q = v.settings.quantize;
  v.settings.quantize = 'now';
  launch(v, { bank: v.scene.bank, scene: i }, now);
  v.settings.quantize = q;
}

export function applyPatch(v: Visuals, p: VisualsPatch, now: number) {
  if (p.settings) {
    if (p.settings.autoBars !== v.settings.autoBars) v.nextAuto = null;
    v.settings = structuredClone(p.settings);
  }
  if (p.fx) v.fx = structuredClone(p.fx);
  if (p.text) v.text = { ...p.text, words: p.text.words.slice(0, 60) };
  if (p.strobe !== undefined) v.strobe = p.strobe;
  if (p.blackout !== undefined) v.blackout = p.blackout;
  if (p.invert !== undefined) v.invert = p.invert;
  if (p.favourites) {
    const seen = new Set<string>();
    v.favourites = p.favourites.filter((f) => sceneExists(f) && !seen.has(`${f.bank}:${f.scene}`) && !!seen.add(`${f.bank}:${f.scene}`)).slice(0, 300);
  }
  if (p.logo) v.logo = { ...p.logo, size: clamp(p.logo.size, 0.05, 0.6) };
  if (p.freeze !== undefined && p.freeze !== (v.frozen !== null)) v.frozen = p.freeze ? beatAt(v, now) : null;
  const f = v.fx;
  f.zoom = clamp(f.zoom, 0.5, 3);
  f.kal = Math.min(12, f.kal);
  f.mirror = Math.min(3, f.mirror);
  v.settings.autoBars = Math.min(64, v.settings.autoBars);
  if (v.settings.safe) v.strobe = false;
  planAuto(v, now);
}

/** Keep (store) or bring back a look. Throws a reason when the slot is empty. */
export function look(v: Visuals, slot: number, store: boolean, now: number) {
  if (slot < 0 || slot >= LOOK_SLOTS) throw new Error('there are 8 looks');
  if (store) {
    v.looks[slot] = { scene: { ...v.scene }, fx: structuredClone(v.fx) };
    return;
  }
  const l = v.looks[slot];
  if (!l) throw new Error('nothing is saved there');
  v.fx = structuredClone(l.fx);
  launch(v, l.scene, now);
}
