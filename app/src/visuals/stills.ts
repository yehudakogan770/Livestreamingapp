// Still pictures of the scenes for the scene buttons, drawn with the real
// shaders. One small drawing context makes them all (one at a time, between
// frames), and each is kept once made.

import { useEffect, useState } from 'react';
import { defaultVisuals } from '../engine/visuals';
import { makeRenderer, type Renderer } from './renderer';
import { VisualsPlayer } from './player';

const W = 192;
const H = 108;
/** A beat part-way into a scene, so it looks like it does when playing. */
const BEAT = 6.4;

const made = new Map<string, string>();
const waiting = new Map<string, Set<(url: string) => void>>();
let renderer: Renderer | null | false = null;
let canvas: HTMLCanvasElement | null = null;
let timer = 0;

/** One picture: the scene with its own look, no flash, no effects. */
function draw(bank: number, scene: number, palette: string): string | null {
  if (renderer === false) return null;
  if (!renderer || renderer.lost()) {
    canvas = document.createElement('canvas');
    renderer = makeRenderer(canvas) ?? false;
    if (!renderer) return null;
  }
  const v = defaultVisuals();
  v.scene = { bank, scene };
  v.anchorBeat = BEAT;
  v.settings = { ...v.settings, palette, flash: 0, flashEvery: 0 };
  renderer.draw(new VisualsPlayer().frame(v, 0), W, H);
  // Read straight after drawing (the picture is cleared once shown).
  return canvas!.toDataURL('image/jpeg', 0.85);
}

/** Makes the next picture someone is waiting for, then the next (letting the page draw in between). */
function next() {
  timer = 0;
  const first = waiting.keys().next();
  if (first.done) return;
  const key = first.value;
  const wanted = waiting.get(key)!;
  waiting.delete(key);
  const [bank, scene, palette] = key.split('|');
  let url: string | null = null;
  try {
    url = draw(Number(bank), Number(scene), palette!);
  } catch {
    renderer = false;
  }
  if (url) {
    made.set(key, url);
    for (const f of wanted) f(url);
  }
  if (renderer === false) waiting.clear();
  else if (waiting.size) timer = window.setTimeout(next, 16);
}

/** A still picture of the scene in these colors (null until made, or when the computer can't draw them). */
export function useSceneStill(bank: number, scene: number, palette: string): string | null {
  const key = `${bank}|${scene}|${palette}`;
  const [url, setUrl] = useState<string | null>(() => made.get(key) ?? null);
  useEffect(() => {
    const have = made.get(key);
    setUrl(have ?? null);
    if (have || renderer === false) return;
    const f = (u: string) => setUrl(u);
    const list = waiting.get(key) ?? new Set();
    list.add(f);
    waiting.set(key, list);
    if (!timer) timer = window.setTimeout(next, 16);
    return () => {
      list.delete(f);
      if (!list.size && waiting.get(key) === list) waiting.delete(key);
    };
  }, [key]);
  return url;
}
