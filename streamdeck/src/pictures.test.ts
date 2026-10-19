// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Deck, PICTURE_MS, PICTURE_STALE_MS, type Surface } from './deck';
import { heldMove, ptzRequest, request } from './actions';
import { keyModel, renderSvg } from './keys';
import { base64, LumoraClient } from './protocol';
import { deckState, NO_APP } from './show';
import { FakeTimers, sampleShow } from './testing';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A show whose second camera can move (PTZ). */
function ptzShow() {
  const show = sampleShow();
  (show.sources as Record<string, unknown>[])[1]!.ptz = { protocol: 'visca', host: '10.0.0.9', port: 52381 };
  return show;
}

function setup(pictures: Record<string, Uint8Array | null> = { cam1: JPEG }) {
  const timers = new FakeTimers();
  const posts: string[] = [];
  const asked: string[] = [];
  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/picture?id=')) {
      const id = decodeURIComponent(u.split('id=')[1]!);
      asked.push(id);
      const p = pictures[id];
      return p ? new Response(new Blob([p as Uint8Array<ArrayBuffer>]), { status: 200 }) : new Response(null, { status: 204 });
    }
    if (init?.method === 'POST') {
      posts.push(u.replace(/^http:\/\/[^/]+/, ''));
      return new Response('{"ok":true}', { status: 200 });
    }
    return new Response(new ReadableStream(), { status: 200 });
  }) as typeof globalThis.fetch;
  const client = new LumoraClient({ fetch, timers });
  const images = new Map<string, string[]>();
  const alerts: string[] = [];
  const surface: Surface = {
    setImage: (id, image) => images.set(id, [...(images.get(id) ?? []), decodeURIComponent(image)]),
    showAlert: (id) => alerts.push(id),
    showOk: () => {},
    saveGlobal: () => {},
  };
  const deck = new Deck(client, surface, timers);
  deck.setGlobal({ pin: '1234' });
  client.message({ event: 'show', data: JSON.stringify({ now: timers.time, snapshot: { show: ptzShow() } }) });
  return { deck, client, timers, posts, asked, images, alerts, pictures };
}

const settle = () => new Promise((r) => setTimeout(r, 5));
const last = (images: Map<string, string[]>, id: string) => images.get(id)!.at(-1)!;

describe('input pictures on keys', () => {
  it('fetches each shown input once a second and draws it, framed in the tally color', async () => {
    const { deck, timers, asked, images } = setup();
    deck.appear('a', 'input', { input: 'cam1' });
    deck.appear('b', 'input', { input: 'cam1' });
    deck.appear('c', 'input', { input: 'cam2', picture: false });
    timers.advance(PICTURE_MS);
    await settle();
    expect(asked).toEqual(['cam1']);
    const svg = last(images, 'a');
    expect(svg).toContain(`xlink:href="data:image/jpeg;base64,${base64(JPEG)}"`);
    // On air: the frame is red.
    expect(svg).toContain('fill="#D7262B"');
    expect(last(images, 'c')).not.toContain('<image');
  });

  it('drops a picture that stopped coming, and stops asking when no key shows one', async () => {
    const { deck, timers, asked, images, pictures } = setup();
    deck.appear('a', 'input', { input: 'cam1' });
    timers.advance(PICTURE_MS);
    await settle();
    expect(last(images, 'a')).toContain('<image');
    pictures.cam1 = null;
    for (let t = 0; t <= PICTURE_STALE_MS; t += PICTURE_MS) {
      timers.advance(PICTURE_MS);
      await settle();
    }
    expect(last(images, 'a')).not.toContain('<image');
    deck.disappear('a');
    const before = asked.length;
    timers.advance(PICTURE_MS * 3);
    await settle();
    expect(asked.length).toBe(before);
  });

  it('shows the warning look, not a stale picture, while Lumora is unreachable', () => {
    const state = deckState(sampleShow(), NO_APP);
    const m = keyModel('input', { input: 'cam1' }, { state, connection: 'offline', deck: 'live', now: 0, picture: 'data:image/jpeg;base64,AAAA' });
    expect(renderSvg(m)).not.toContain('<image');
  });
});

describe('PTZ keys', () => {
  const state = () => deckState(ptzShow(), NO_APP);
  it('recall a saved shot or go home with one press', () => {
    expect(request('ptz', { input: 'cam2', shot: '3' }, state(), 'live')).toEqual({ to: 'do', command: 'ptz', query: { input: '2', preset: '3' } });
    expect(request('ptz', { input: 'cam2', move: 'home' }, state(), 'live')).toEqual({ to: 'do', command: 'ptz', query: { input: '2', move: 'home' } });
    expect(request('ptz', { input: 'cam1' }, state(), 'live')).toEqual({ to: 'none', why: 'not a PTZ camera' });
    expect(request('ptz', {}, state(), 'live')).toEqual({ to: 'none', why: 'choose a camera' });
  });

  it('move while held and stop when let go', async () => {
    expect(heldMove('ptz', { move: 'left' })).toBe(true);
    expect(heldMove('ptz', { move: 'home' })).toBe(false);
    expect(ptzRequest({ input: 'cam2', move: 'zoomin', speed: '100' }, state(), 'start')).toEqual({
      to: 'do',
      command: 'ptz',
      query: { input: '2', zoom: 'in', speed: '100' },
    });
    expect(ptzRequest({ input: 'cam2', move: 'zoomin' }, state(), 'stop')).toEqual({ to: 'do', command: 'ptz', query: { input: '2', zoom: 'stop' } });
    const { deck, posts } = setup();
    deck.appear('p', 'ptz', { input: 'cam2', move: 'left' });
    deck.keyDown('p');
    await settle();
    deck.keyUp('p');
    await settle();
    expect(posts).toEqual(['/api/do/ptz?input=2&move=left&speed=50', '/api/do/ptz?input=2&move=stop']);
  });

  it('say which camera and what the key does', () => {
    const m = keyModel('ptz', { input: 'cam2', shot: '4' }, { state: state(), connection: 'online', deck: 'live', now: 0 });
    expect([m.label, m.sub, m.tone]).toEqual(['Camera 2', 'Shot 4', 'preview']);
    const not = keyModel('ptz', { input: 'cam1' }, { state: state(), connection: 'online', deck: 'live', now: 0 });
    expect([not.sub, not.tone]).toEqual(['Not PTZ', 'warn']);
  });
});
