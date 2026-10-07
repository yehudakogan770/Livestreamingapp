import { describe, expect, it } from 'vitest';
import { clickerAction, clickerMove, clickerTarget, loadClicker, saveClicker } from './clicker';
import { emptyShow } from './client';
import { demoApply } from './demo';
import { defaultSlideshow } from './slideshow';
import type { Show } from './types/Show';

function withSlides(): Show {
  const sh = {
    ...defaultSlideshow(),
    slides: [
      { type: 'image' as const, path: '/1.png' },
      { type: 'image' as const, path: '/2.png' },
    ],
  };
  const show = demoApply(emptyShow(), { type: 'addSource', source: { id: 'talk', name: 'Talk', kind: { type: 'slideshow', ...sh } } }, 0);
  for (const sc of ['live', 'back'] as const) show.screens[sc] = { ...show.screens[sc], preview: null, program: null };
  return show;
}

describe('presentation clickers', () => {
  it('Page Down / → next, Page Up / ← back, B or . black; other keys are left alone', () => {
    expect(clickerMove('PageDown')).toBe('next');
    expect(clickerMove('ArrowRight')).toBe('next');
    expect(clickerMove('PageUp')).toBe('previous');
    expect(clickerMove('ArrowLeft')).toBe('previous');
    expect(clickerMove('b')).toBe('black');
    expect(clickerMove('B')).toBe('black');
    expect(clickerMove('.')).toBe('black');
    for (const k of ['Enter', 'a', '1', 'Escape', 'F5', ' ']) expect(clickerMove(k)).toBeNull();
  });

  it('work on the slideshow on air (or in Next on this screen), else nothing', () => {
    const show = withSlides();
    expect(clickerTarget(show, 'live')).toBeNull();
    show.screens.back.program = 'talk';
    expect(clickerTarget(show, 'live')?.id).toBe('talk');
    show.screens.live.preview = 'talk';
    expect(clickerTarget(show, 'live')).toMatchObject({ id: 'talk', where: 'next' });
    // The Monitor shows text only: the Live screen's slideshow.
    expect(clickerTarget(show, 'monitor')?.id).toBe('talk');
  });

  it('send the slideshow actions; black toggles', () => {
    const show = withSlides();
    show.screens.live.program = 'talk';
    const t = clickerTarget(show, 'live')!;
    expect(clickerAction('next', t)).toEqual({ type: 'slideNext', id: 'talk' });
    expect(clickerAction('previous', t)).toEqual({ type: 'slidePrevious', id: 'talk' });
    expect(clickerAction('black', t)).toEqual({ type: 'slideBlack', id: 'talk', value: true });
    expect(clickerAction('black', { ...t, sh: { ...t.sh, black: true } })).toEqual({ type: 'slideBlack', id: 'talk', value: false });
  });

  it('the setting is remembered on this computer', () => {
    saveClicker(true);
    expect(loadClicker()).toBe(true);
    saveClicker(false);
    expect(loadClicker()).toBe(false);
  });
});
