// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  actionFor,
  clickerKey,
  clockText,
  describe as say,
  elapsedText,
  nextIndex,
  pickSlideshow,
  pinFromHash,
  predict,
  remaining,
  slideLabel,
  swipe,
  type SlidesView,
  type ViewSlideshow,
} from './slides-core.js';

const sh = (over: Partial<ViewSlideshow> = {}): ViewSlideshow => ({
  id: 'talk',
  name: 'Talk',
  onAir: 'live',
  inNext: false,
  current: 0,
  black: false,
  looping: false,
  slides: [
    { type: 'image', v: 'a', notes: 'Hello' },
    { type: 'image', v: 'b' },
    { type: 'input', name: 'Video' },
  ],
  ...over,
});

const view = (shows: ViewSlideshow[]): SlidesView => ({ event: 'Gala', locked: false, allowBlack: false, slideshows: shows, countdown: null });

describe('the speaker’s slides page', () => {
  it('a clicker paired with the speaker’s laptop: Page Down / Page Up / arrows, B or . black', () => {
    expect(clickerKey('PageDown')).toBe('next');
    expect(clickerKey('ArrowRight')).toBe('next');
    expect(clickerKey(' ')).toBe('next');
    expect(clickerKey('PageUp')).toBe('previous');
    expect(clickerKey('ArrowLeft')).toBe('previous');
    expect(clickerKey('b')).toBe('black');
    expect(clickerKey('.')).toBe('black');
    expect(clickerKey('x')).toBeNull();
  });

  it('swipe left for the next slide, right for the one before; scrolling is not a swipe', () => {
    expect(swipe(-120, 10, 200)).toBe('next');
    expect(swipe(120, -5, 200)).toBe('previous');
    expect(swipe(-30, 0, 200)).toBeNull();
    expect(swipe(-80, 120, 200)).toBeNull();
    expect(swipe(-200, 0, 2000)).toBeNull();
  });

  it('follows the slideshow on air unless another was chosen here', () => {
    const a = sh();
    const b = sh({ id: 'other', name: 'Other', onAir: null });
    expect(pickSlideshow(view([a, b]), null)?.id).toBe('talk');
    expect(pickSlideshow(view([a, b]), 'other')?.id).toBe('other');
    expect(pickSlideshow(view([a, b]), 'removed')?.id).toBe('talk');
    expect(pickSlideshow(view([]), null)).toBeNull();
    expect(pickSlideshow(null, null)).toBeNull();
  });

  it('moves (shown at once, before the computer answers) and the actions it sends', () => {
    expect(predict(sh(), 'next').current).toBe(1);
    expect(predict(sh({ current: 2 }), 'next').current).toBe(2);
    expect(predict(sh({ current: 2, looping: true }), 'next').current).toBe(0);
    expect(predict(sh({ current: 1 }), 'previous').current).toBe(0);
    expect(predict(sh(), 'previous').current).toBe(0);
    // Black: a click first brings the slides back, on the same slide.
    expect(predict(sh(), 'black').black).toBe(true);
    expect(predict(sh({ black: true, current: 1 }), 'next')).toMatchObject({ black: false, current: 1 });
    expect(actionFor('next', sh())).toEqual({ type: 'slideNext', id: 'talk' });
    expect(actionFor('previous', sh())).toEqual({ type: 'slidePrevious', id: 'talk' });
    expect(actionFor('black', sh({ black: true }))).toEqual({ type: 'slideBlack', id: 'talk', value: false });
    expect(nextIndex(sh({ current: 2 }))).toBeNull();
  });

  it('words and times', () => {
    expect(slideLabel(sh({ current: 1 }))).toBe('Slide 2 of 3');
    expect(slideLabel(sh({ slides: [] }))).toBe('No slides yet');
    expect(remaining({ endsAt: 70_000, remainingMs: 5 }, 10_000)).toBe(60_000);
    expect(remaining({ endsAt: null, remainingMs: 5000 }, 10_000)).toBe(5000);
    expect(clockText(65_000)).toBe('1:05');
    expect(clockText(3_723_000)).toBe('1:02:03');
    expect(elapsedText(59_999)).toBe('0:59');
    expect(pinFromHash('#pin=503917')).toBe('503917');
    expect(pinFromHash('#x=1&pin=4821')).toBe('4821');
    expect(pinFromHash('#pin=abc')).toBeNull();
    expect(pinFromHash('')).toBeNull();
    expect(say('speakerLocked')).toMatch(/paused/);
    expect(say('disconnected')).toMatch(/disconnected/);
    expect(say(undefined)).toMatch(/did not accept/);
  });
});
