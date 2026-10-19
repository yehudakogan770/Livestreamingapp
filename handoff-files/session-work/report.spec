@@@
export interface EngineMeasured {
  adapter: string | null;
===
export interface EngineMeasured {
  adapter: string | null;
  /** Why the engine is on that card (automatic: the high-performance one; chosen in Settings → Engine). */
  adapterChoice: string | null;
  /** Each output window as last seen: its colors (SDR or HDR) and the card that showed it. */
  outputs: { output: string; color: string; presentedBy: string; copied: boolean }[];
@@@
  /** Each feed as last seen while it ran. */
  feeds: { id: number; kind: string; framesIn: number; framesDropped: number; audioSeconds: number; silenceSeconds: number; error: string | null }[];
}
===
  /**
   * Each feed as last seen while it ran. `route`: how its picture reached the
   * encoder (handed over on the graphics card — zero-copy — or read back, and why).
   */
  feeds: {
    id: number;
    kind: string;
    framesIn: number;
    framesDropped: number;
    audioSeconds: number;
    silenceSeconds: number;
    error: string | null;
    route: string | null;
    zeroCopy: boolean | null;
  }[];
}
@@@
    : {
        adapter: null,
        frames: 0,
===
    : {
        adapter: null,
        adapterChoice: null,
        outputs: [],
        frames: 0,
@@@
  m.adapter = s.adapter ? `${s.adapter.name} (${s.adapter.backend}, ${s.adapter.kind})` : m.adapter;
===
  m.adapter = s.adapter ? `${s.adapter.name} (${s.adapter.backend}, ${s.adapter.kind})` : m.adapter;
  m.adapterChoice = s.adapter?.choice ?? m.adapterChoice;
  if (s.outputCards?.length)
    m.outputs = s.outputCards.map((c) => ({ output: c.output, color: c.color, presentedBy: c.presentedBy, copied: c.copied }));
@@@
      error: f.error ?? f.stats?.error ?? null,
    };
===
      error: f.error ?? f.stats?.error ?? null,
      route: f.route?.path ?? null,
      zeroCopy: f.route ? f.route.zeroCopy : null,
    };
@@@
    ['Engine', `Unified (beta) on ${e.adapter ?? 'an unknown graphics card'}`],
===
    ['Engine', `Unified (beta) on ${e.adapter ?? 'an unknown graphics card'}${e.adapterChoice ? `: ${e.adapterChoice}` : ''}`],
@@@
  for (const f of e.feeds)
    rows.push([
      `Engine feed: ${FEED_NAMES[f.kind] ?? f.kind}`,
      `${f.framesIn} frames, ${f.framesDropped} late${f.kind !== 'input' ? `; sound ${f.audioSeconds} s (${f.silenceSeconds} s filled with silence)` : ''}${f.error ? `; ${f.error}` : ''}`,
    ]);
  return rows;
===
  for (const f of e.feeds)
    rows.push([
      `Engine feed: ${FEED_NAMES[f.kind] ?? f.kind}`,
      `${f.framesIn} frames, ${f.framesDropped} late${f.kind !== 'input' ? `; sound ${f.audioSeconds} s (${f.silenceSeconds} s filled with silence)` : ''}${f.route ? `; ${f.route}` : ''}${f.error ? `; ${f.error}` : ''}`,
    ]);
  for (const o of e.outputs)
    rows.push([`Engine window: ${o.output}`, `${o.color}, shown by ${o.presentedBy}${o.copied ? ' (copied across from the engine’s card)' : ''}`]);
  return rows;
