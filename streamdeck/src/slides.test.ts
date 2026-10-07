// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { kindOf, request, uuid, type Request } from './actions';
import { keyModel } from './keys';
import { deckState, NO_APP } from './show';
import { sampleShow } from './testing';

const body = (r: Request) => ('body' in r ? r.body : null);

/** The sample show with two slideshows: "Slides" (3 slides, on air on the Back screen, on slide 2) and "Talk" (in Next on Live). */
function show() {
  const s = sampleShow();
  const sources = s.sources as Record<string, unknown>[];
  sources[2] = { id: 'slides', name: 'Slides', kind: { type: 'slideshow', current: 1, slides: [{}, {}, {}] } };
  sources.push({ id: 'talk', name: 'Talk', kind: { type: 'slideshow', current: 0, slides: [{}, {}] } });
  (s.screens as Record<string, Record<string, unknown>>).live!.preview = 'talk';
  return s;
}
const state = () => deckState(show(), NO_APP);
const ctx = (deck: 'live' | 'back' = 'back') => ({ state: state(), connection: 'online' as const, deck, now: 0 });

describe('slide keys', () => {
  it('next, previous and first slide on the slideshow on air', () => {
    expect(body(request('slidenext', {}, state(), 'back'))).toEqual({ type: 'slideNext', id: 'slides' });
    expect(body(request('slideback', {}, state(), 'back'))).toEqual({ type: 'slidePrevious', id: 'slides' });
    expect(body(request('slidefirst', {}, state(), 'back'))).toEqual({ type: 'slideGo', id: 'slides', index: 0 });
    for (const k of ['slidenext', 'slideback', 'slidefirst'] as const) expect(kindOf(uuid(k))).toBe(k);
  });

  it('the deck’s own screen first (in Next there), or the slideshow the key chose', () => {
    expect(body(request('slidenext', {}, state(), 'live'))).toEqual({ type: 'slideNext', id: 'talk' });
    expect(body(request('slidenext', { slideshow: 'talk' }, state(), 'back'))).toEqual({ type: 'slideNext', id: 'talk' });
    // An event opened again: found by its name.
    expect(body(request('slidenext', { slideshow: 'old-id', slideshowName: 'Talk' }, state(), 'back'))).toEqual({ type: 'slideNext', id: 'talk' });
    expect(request('slidenext', { slideshow: 'gone' }, state(), 'back')).toEqual({ to: 'none', why: 'no slideshow' });
    expect(request('slidenext', {}, deckState({ sources: [] }, NO_APP), 'live')).toEqual({ to: 'none', why: 'no slideshow' });
  });

  it('shows the slide number on the key, red on air and green in Next', () => {
    expect(keyModel('slidenext', {}, ctx('back'))).toMatchObject({ label: 'NEXT SLIDE', sub: '2 / 3', tone: 'program' });
    expect(keyModel('slideback', {}, ctx('live'))).toMatchObject({ label: 'BACK', sub: '1 / 2', tone: 'preview' });
    expect(keyModel('slidefirst', {}, ctx('back'))).toMatchObject({ label: 'FIRST SLIDE', sub: '2 / 3' });
    expect(keyModel('slidenext', {}, { ...ctx(), state: deckState({ sources: [] }, NO_APP) }).sub).toBe('No slideshow');
  });
});
