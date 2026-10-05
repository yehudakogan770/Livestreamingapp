// Automatic speaker names: listens to each speaker's microphone and decides
// when someone has really started talking (not a cough or a laugh), so their
// name title comes on by itself. Runs in the control window.

import { useEffect, useRef } from 'react';
import type { EngineClient } from './client';
import type { Show } from './types/Show';
import type { SpeakerNames } from './types/SpeakerNames';
import { TEXT_TEMPLATES } from './text';
import { useSound } from '../audio/SoundContext';

/** A microphone this loud (after its fader) is someone talking. */
const TALKING = 0.06;
/** Talking this long (short pauses allowed) is a speaker, not a cough. */
const FOR_MS = 1500;
const PAUSE_MS = 500;

export class SpeakerWatch {
  private talkingSince = new Map<string, number>();
  private lastLoud = new Map<string, number>();
  private shownAt = new Map<string, number>();
  private lastShow = -Infinity;

  /**
   * The levels now (microphone → 0 – 1). Returns the microphone whose
   * speaker's name should come on now, or null.
   */
  feed(levels: Map<string, number>, s: Pick<SpeakerNames, 'holdS' | 'againMin'>, now: number): string | null {
    for (const [mic, level] of levels) {
      if (level >= TALKING) {
        if (!this.talkingSince.has(mic) || now - (this.lastLoud.get(mic) ?? 0) > PAUSE_MS) this.talkingSince.set(mic, now);
        this.lastLoud.set(mic, now);
      } else if (now - (this.lastLoud.get(mic) ?? 0) > PAUSE_MS) this.talkingSince.delete(mic);
    }
    // A name on air stays its full time.
    if (now - this.lastShow < s.holdS * 1000) return null;
    let best: string | null = null;
    let longest = 0;
    for (const [mic, since] of this.talkingSince) {
      const talked = now - since;
      if (talked >= FOR_MS && talked > longest) {
        best = mic;
        longest = talked;
      }
    }
    if (!best) return null;
    const last = this.shownAt.get(best);
    if (last !== undefined && now - last < s.againMin * 60_000) return null;
    this.shownAt.set(best, now);
    this.lastShow = now;
    return best;
  }

  /** The name was put on by hand: the same rules apply from now. */
  shown(mic: string, now: number): void {
    this.shownAt.set(mic, now);
    this.lastShow = now;
  }
}

/** Put a speaker's name title on air now (making the title input the first time). */
export async function showSpeaker(show: Show, client: EngineClient, mic: string): Promise<void> {
  const s = show.speakers;
  const person = s.people.find((p) => p.mic === mic);
  if (!person?.name) return;
  let id = s.titleSource ?? null;
  const existing = id ? show.sources.find((x) => x.id === id && x.kind.type === 'text') : null;
  const template = TEXT_TEMPLATES.find((t) => t.layout === 'lowerThird') ?? TEXT_TEMPLATES[0]!;
  const look = existing && existing.kind.type === 'text' ? existing.kind : { type: 'text' as const, ...template.make() };
  const text = { layout: look.layout, style: look.style, text: person.name, sub: person.title };
  if (!existing) {
    id = `speaker-names-${Date.now().toString(36)}`;
    await client.dispatch({ type: 'addSource', source: { id, name: 'Speaker names', kind: { type: 'text', ...text } } });
    await client.dispatch({ type: 'setSpeakerNames', speakers: { ...s, titleSource: id } });
  } else await client.dispatch({ type: 'updateText', id: id!, text });
  const overlay = show.overlays[s.channel];
  if (overlay?.sourceId !== id) await client.dispatch({ type: 'setOverlaySource', channel: s.channel, sourceId: id });
  await client.dispatch({ type: 'updateOverlay', channel: s.channel, patch: { autoHideMs: Math.round(s.holdS * 1000), screens: ['live'] } });
  await client.dispatch({ type: 'setOverlayOn', channel: s.channel, value: true });
}

/** Watch the speakers' microphones and put their names on (control window). */
export function useSpeakerNames(show: Show | null, client: EngineClient): void {
  const sound = useSound();
  const showRef = useRef(show);
  showRef.current = show;
  const on = !!show?.speakers?.on && (show.speakers.people.length ?? 0) > 0;
  useEffect(() => {
    if (!on || !sound) return;
    const watch = new SpeakerWatch();
    const id = setInterval(() => {
      const sh = showRef.current;
      if (!sh?.speakers.on) return;
      const levels = new Map(sh.speakers.people.filter((p) => p.name).map((p) => [p.mic, sound.levels.get(p.mic) ?? 0]));
      const mic = watch.feed(levels, sh.speakers, Date.now());
      if (mic) void showSpeaker(sh, client, mic).catch(() => {});
    }, 100);
    return () => clearInterval(id);
  }, [on, sound, client]);
}
