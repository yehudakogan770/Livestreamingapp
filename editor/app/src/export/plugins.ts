// The film's sound with VST3 effects: each clip with plug-ins plays the WAV
// its plug-ins made (from the stretch of the file it uses) instead of the
// file, without the plug-in effects (they are in the WAV); everything after
// them (the clip's other effects, its track, buses and the mix) is as usual.
import { rate } from '../model/seq';
import { isPlugin, pluginChain, pluginSpan, type ChainLink } from '../model/plugins';
import type { Clip, MediaItem, Project } from '../model/types';

/** Makes (or finds already made) a stretch of a file through plug-ins: the WAV's path. */
export type RenderPlugins = (path: string, from: number, seconds: number, chain: ChainLink[]) => Promise<string>;

/** Every clip with plug-ins, its sound made through them; `progress` is told how many of how many. */
export async function withPluginsRendered(p: Project, render: RenderPlugins, progress: (done: number, total: number) => void = () => {}): Promise<Project> {
  const todo: { seq: string; clip: Clip; media: MediaItem; chain: ChainLink[]; span: { from: number; seconds: number } }[] = [];
  for (const s of p.sequences) {
    const fps = rate(s);
    for (const c of s.clips) {
      if (c.source.kind !== 'media' || !c.enabled) continue;
      const chain = pluginChain(c);
      if (!chain.length) continue;
      const src = c.source;
      const m = p.media.find((x) => x.id === src.media);
      if (!m?.hasAudio) continue;
      const span = pluginSpan(c, m, fps);
      if (span) todo.push({ seq: s.id, clip: c, media: m, chain, span });
    }
  }
  if (!todo.length) return p;
  const media: MediaItem[] = [];
  const swap = new Map<string, Clip>();
  for (const [i, t] of todo.entries()) {
    progress(i, todo.length);
    const path = await render(t.media.missing && t.media.proxy ? t.media.proxy : t.media.path, t.span.from, t.span.seconds, t.chain);
    const id = `plugins:${t.clip.id}`;
    media.push({
      id,
      name: `${t.media.name} (plug-ins)`,
      path,
      proxy: null,
      kind: 'audio',
      duration: t.span.seconds,
      width: 0,
      height: 0,
      fps: 0,
      hasVideo: false,
      hasAudio: true,
      bin: null,
    });
    const src = t.clip.source as Extract<Clip['source'], { kind: 'media' }>;
    swap.set(`${t.seq}/${t.clip.id}`, {
      ...t.clip,
      source: { ...src, media: id, in: src.in - t.span.from },
      effects: t.clip.effects.filter((e) => !isPlugin(e)),
    });
  }
  progress(todo.length, todo.length);
  return {
    ...p,
    media: [...p.media, ...media],
    sequences: p.sequences.map((s) => ({ ...s, clips: s.clips.map((c) => swap.get(`${s.id}/${c.id}`) ?? c) })),
  };
}
