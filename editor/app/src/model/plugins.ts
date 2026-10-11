// VST3 effects on sound clips. A plug-in effect keeps which plug-in it is
// and its saved settings (the plug-in's own state); its parameters are shown
// from the last time they were read. Sound goes through the clip's plug-ins
// first (before its other effects), worked out ahead in the background: the
// stretch of the file the clip plays is made into a WAV that playback and the
// film use (see player/plugins.ts and export/plugins.ts).
import { remapSpan } from './remap';
import type { Clip, Effect, MediaItem } from './types';

/** A plug-in parameter as last read. */
export interface PluginParam {
  id: number;
  title: string;
  units: string;
  /** 0: continuous, 1: on/off, more: that many steps. */
  steps: number;
  default: number;
  value: number;
  text: string;
  bypass: boolean;
}

/** What a VST3 effect keeps (in the effect's `d`). */
export interface PluginData {
  path: string;
  cid: string;
  name: string;
  vendor: string;
  /** The plug-in's saved settings (base64), '' for its own defaults. */
  state: string;
  params: PluginParam[];
}

/** An effect found on the computer. */
export interface FoundPlugin {
  path: string;
  cid: string;
  name: string;
  vendor: string;
  version: string;
  subCategories: string;
}

export const isPlugin = (e: Pick<Effect, 'type'>): boolean => e.type === 'vst3';

export function pluginOf(e: Effect): PluginData | null {
  const d = e.d as Partial<PluginData> | undefined;
  if (!isPlugin(e) || !d || typeof d.path !== 'string' || typeof d.cid !== 'string') return null;
  return {
    path: d.path,
    cid: d.cid,
    name: typeof d.name === 'string' ? d.name : 'Plug-in',
    vendor: typeof d.vendor === 'string' ? d.vendor : '',
    state: typeof d.state === 'string' ? d.state : '',
    params: Array.isArray(d.params) ? (d.params as PluginParam[]) : [],
  };
}

/** A new effect for a plug-in found on the computer. */
export function newPluginEffect(f: FoundPlugin, id: string): Effect {
  const d: PluginData = { path: f.path, cid: f.cid, name: f.name, vendor: f.vendor, state: '', params: [] };
  return { id, type: 'vst3', on: true, p: {}, d: d as unknown as Record<string, unknown> };
}

/** One link of the chain the helper runs. */
export interface ChainLink {
  path: string;
  cid: string;
  state: string | null;
}

/** A clip's switched-on plug-ins, in order. */
export function pluginChain(c: Clip): ChainLink[] {
  return c.effects.flatMap((e) => {
    const d = e.on ? pluginOf(e) : null;
    return d ? [{ path: d.path, cid: d.cid, state: d.state || null }] : [];
  });
}

/** How much earlier sound is run through first, so reverbs and delays are already ringing where the clip starts (seconds). */
export const PREROLL = 2;

/**
 * The stretch of the file the plug-ins run on: from a little before the
 * first second the clip plays to the last (seconds), and so where the made
 * file starts in the original.
 */
export function pluginSpan(c: Clip, m: MediaItem, fps: number): { from: number; seconds: number } | null {
  const src = c.source;
  if (src.kind !== 'media') return null;
  const span = c.remap ? remapSpan(c.remap, c.length) : { min: 0, max: c.length };
  const a = src.in + (Math.min(span.min, span.max) * c.speed) / fps;
  const b = src.in + (Math.max(span.min, span.max) * c.speed) / fps;
  const from = Math.max(0, Math.min(a, b) - PREROLL);
  const to = Math.min(m.duration > 0 ? m.duration : Infinity, Math.max(a, b) + 0.5);
  if (!(to > from)) return null;
  // Whole tenths of a second, so small trims reuse what was made.
  const f = Math.floor(from * 10) / 10;
  return { from: f, seconds: Math.ceil((to - f) * 10) / 10 };
}
