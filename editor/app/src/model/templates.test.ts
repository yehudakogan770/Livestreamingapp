import { describe, expect, it } from 'vitest';
import { valueAt } from './anim';
import { current } from './seq';
import { addTemplate, parseSaved, templateById, templateClip, templateFromClip, templateLook, TITLE_TEMPLATES } from './templates';
import { emptyProject, type Anim, type TextData } from './types';

describe('title templates', () => {
  it('has two dozen, each with its own id, in every group', () => {
    expect(TITLE_TEMPLATES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(TITLE_TEMPLATES.map((t) => t.id)).size).toBe(TITLE_TEMPLATES.length);
    const groups = new Set(TITLE_TEMPLATES.map((t) => t.group));
    for (const g of ['Lower thirds', 'Titles', 'End cards', 'Social', 'Quotes', 'Chapters', 'Countdowns', 'Buttons']) expect(groups.has(g as never)).toBe(true);
  });

  it('makes valid clips at any frame rate (keyframes in order, inside the clip)', () => {
    for (const fps of [24, 30, 60]) {
      for (const t of TITLE_TEMPLATES) {
        const c = templateClip(t, 'v2', 100, fps);
        expect(c.length).toBe(Math.round(t.seconds * fps));
        expect(c.source.kind).toBe('text');
        for (const v of Object.values(c.motion)) {
          if (typeof v !== 'object' || !v) continue;
          const keys = (v as Anim).k;
          for (let i = 1; i < keys.length; i++) expect((keys[i] as { t: number }).t).toBeGreaterThan((keys[i - 1] as { t: number }).t);
          for (const k of keys) expect(k.t).toBeLessThan(c.length);
        }
      }
    }
    // Squeezed into a very short clip, still in order.
    const look = templateLook({ ...templateById('ti-impact')!, seconds: 0.1 }, 3, 30);
    const keys = (look.motion.scale as Anim).k.map((k) => k.t);
    expect(keys).toEqual([...new Set(keys)].sort((a, b) => a - b));
  });

  it('moves: a push-in grows, credits roll up, a punch lands', () => {
    const cinema = templateClip(templateById('ti-cinema')!, 'v', 0, 30);
    expect(valueAt(cinema.motion.scale, cinema.length - 1)).toBeGreaterThan(valueAt(cinema.motion.scale, 0));
    const credits = templateClip(templateById('end-credits')!, 'v', 0, 30);
    expect(valueAt(credits.motion.y, 0)).toBeGreaterThan(0);
    expect(valueAt(credits.motion.y, credits.length - 1)).toBeLessThan(0);
    const impact = templateClip(templateById('ti-impact')!, 'v', 0, 30);
    expect(valueAt(impact.motion.scale, 0)).toBeGreaterThan(100);
    expect(valueAt(impact.motion.scale, 30)).toBe(100);
  });

  it('goes on a free track above the pictures, or the track it was dropped on', () => {
    const p = emptyProject('T');
    const s = current(p);
    const [v1, v2, v3] = s.tracks.filter((t) => t.kind === 'video');
    const r = addTemplate(p, templateById('lt-bar')!, 30, 30);
    const c = current(r.project).clips.find((x) => x.id === r.id);
    expect(c?.track).toBe(v2?.id);
    expect(c?.start).toBe(30);
    const again = addTemplate(r.project, templateById('lt-bar')!, 30, 30);
    expect(current(again.project).clips.find((x) => x.id === again.id)?.track).toBe(v3?.id);
    const dropped = addTemplate(p, templateById('cd-big')!, 0, 30, v1?.id);
    expect(current(dropped.project).clips.find((x) => x.id === dropped.id)?.track).toBe(v1?.id);
  });

  it('saves your own titles, motion and all', () => {
    const c = templateClip(templateById('so-share')!, 'v', 0, 25);
    const mine = templateFromClip(
      { ...c, source: { kind: 'text', text: { ...(c.source as { text: TextData }).text, text: 'Mine', color: '#123456' } } },
      'My share',
      25,
    );
    expect(mine?.group).toBe('My templates');
    const back = parseSaved(JSON.stringify([mine, { junk: true }, 7]));
    expect(back).toHaveLength(1);
    const again = templateClip(back[0]!, 'v', 0, 25);
    expect(again.source.kind === 'text' && again.source.text.text).toBe('Mine');
    expect(again.source.kind === 'text' && again.source.text.color).toBe('#123456');
    expect(again.motion.scale).toEqual(c.motion.scale);
    expect(parseSaved('not json')).toEqual([]);
    expect(templateFromClip({ ...c, source: { kind: 'color', color: '#000' } }, 'x', 25)).toBeNull();
  });

  it('has a large library with one id each, every group shown', () => {
    const ids = TITLE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TITLE_TEMPLATES.length).toBeGreaterThanOrEqual(45);
    expect(new Set(TITLE_TEMPLATES.map((t) => t.group))).toEqual(
      new Set(['Lower thirds', 'Titles', 'Event', 'End cards', 'Social', 'Quotes', 'Chapters', 'Countdowns', 'Buttons']),
    );
    // Word-by-word titles bring their animators with them.
    const look = templateLook(TITLE_TEMPLATES.find((t) => t.id === 'ti-kinetic')!, 150, 30);
    expect(look.text.animators?.[0]?.by).toBe('word');
  });
});
