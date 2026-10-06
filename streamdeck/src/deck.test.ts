// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Deck, type Surface } from './deck';
import { HOLD_MS } from './actions';
import { LumoraClient, type SseMessage } from './protocol';
import { FakeTimers, sampleShow } from './testing';

/** A deck connected to a pretend Lumora that records what is sent. */
function setup() {
  const timers = new FakeTimers();
  const sent: unknown[] = [];
  const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      sent.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200 });
    }
    // The live updates are fed by hand below.
    return new Response(new ReadableStream(), { status: 200 });
  }) as typeof globalThis.fetch;
  const client = new LumoraClient({ fetch, timers });
  const images = new Map<string, string[]>();
  const alerts: string[] = [];
  const saved: unknown[] = [];
  const surface: Surface = {
    setImage: (id, image) => images.set(id, [...(images.get(id) ?? []), decodeURIComponent(image)]),
    showAlert: (id) => alerts.push(id),
    showOk: () => {},
    saveGlobal: (s) => saved.push(s),
  };
  const deck = new Deck(client, surface, timers);
  deck.setGlobal({ pin: '1234' });
  const feed = (m: SseMessage) => client.message(m);
  feed({ event: 'show', data: JSON.stringify({ now: timers.time, snapshot: { show: sampleShow() } }) });
  return { deck, client, timers, sent, images, alerts, saved, feed };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe('the deck', () => {
  it('sends one action per press, however often the key repeats', async () => {
    const { deck, sent, timers } = setup();
    deck.appear('k1', 'take', {});
    deck.keyDown('k1');
    deck.keyDown('k1');
    timers.advance(500);
    deck.keyDown('k1');
    deck.keyUp('k1');
    await settle();
    expect(sent).toEqual([{ type: 'take', screen: 'live' }]);
  });

  it('redraws a key only when its picture changes', () => {
    const { deck, images, feed, timers } = setup();
    deck.appear('in', 'input', { input: 'cam2' });
    expect(images.get('in')).toHaveLength(1);
    expect(images.get('in')![0]).toContain('#16A34A');
    // The same show again: nothing to redraw.
    feed({ event: 'show', data: JSON.stringify({ now: timers.time, snapshot: { show: sampleShow() } }) });
    expect(images.get('in')).toHaveLength(1);
    // Taken to air: now red.
    const show = sampleShow();
    (show.screens as { live: { program: string } }).live.program = 'cam2';
    feed({ event: 'show', data: JSON.stringify({ now: timers.time, snapshot: { show } }) });
    expect(images.get('in')).toHaveLength(2);
    expect(images.get('in')![1]).toContain('#D7262B');
  });

  it('PANIC waits for the hold, and shows its progress', async () => {
    const { deck, sent, timers, images } = setup();
    deck.appear('p', 'panic', {});
    deck.keyDown('p');
    timers.advance(HOLD_MS / 2);
    await settle();
    expect(sent).toEqual([]);
    expect(images.get('p')!.at(-1)).toContain('Keep holding');
    timers.advance(HOLD_MS);
    await settle();
    expect(sent).toEqual([{ type: 'panic', value: true }]);
    deck.keyUp('p');
  });

  it('letting go of PANIC early sends nothing and says so', async () => {
    const { deck, sent, timers, alerts } = setup();
    deck.appear('p', 'panic', {});
    deck.keyDown('p');
    timers.advance(300);
    deck.keyUp('p');
    timers.advance(HOLD_MS * 2);
    await settle();
    expect(sent).toEqual([]);
    expect(alerts).toEqual(['p']);
  });

  it('the Screen key moves every key to the Back screen and remembers it', async () => {
    const { deck, sent, saved, timers } = setup();
    deck.appear('s', 'screen', {});
    deck.appear('t', 'take', {});
    deck.keyDown('s');
    deck.keyUp('s');
    expect(saved).toEqual([{ pin: '1234', screen: 'back' }]);
    timers.advance(500);
    deck.keyDown('t');
    deck.keyUp('t');
    await settle();
    expect(sent).toEqual([{ type: 'take', screen: 'back' }]);
  });

  it('shows a warning on every key when Lumora goes away', () => {
    const { deck, client, images } = setup();
    deck.appear('t', 'take', {});
    client.stop();
    (client as unknown as { setConnection(c: string): void }).setConnection('offline');
    expect(images.get('t')!.at(-1)).toContain('Lumora offline');
  });

  it('countdown keys count down by themselves', () => {
    const { deck, feed, timers, images } = setup();
    const show = sampleShow();
    (show.sources as { kind: { timer?: { endsAt: number | null } } }[])[3]!.kind.timer!.endsAt = timers.time + 10_000;
    feed({ event: 'show', data: JSON.stringify({ now: timers.time, snapshot: { show } }) });
    deck.appear('c', 'countdown', {});
    expect(images.get('c')!.at(-1)).toContain('>0:10<');
    timers.advance(3000);
    expect(images.get('c')!.at(-1)).toContain('>0:07<');
    deck.disappear('c');
    expect(timers.count).toBeLessThanOrEqual(1);
  });

  it('flashes the recording and streaming keys when Lumora could not do what they asked', () => {
    const { deck, feed, alerts } = setup();
    deck.appear('live', 'golive', {});
    deck.appear('take', 'take', {});
    feed({ event: 'app', data: JSON.stringify({ error: { message: 'Choose where to stream first', at: 5 } }) });
    expect(alerts).toEqual(['live']);
    // The same problem again is not news.
    feed({ event: 'app', data: JSON.stringify({ error: { message: 'Choose where to stream first', at: 5 }, recording: true }) });
    expect(alerts).toEqual(['live']);
  });

  it('gives the settings panel the lists to choose from', () => {
    const { deck } = setup();
    const l = deck.lists();
    expect(l.connection).toBe('online');
    expect(l.inputs.map((i) => i.name)).toEqual(['Camera 1', 'Camera 2', 'Slides', 'Doors open']);
    expect(l.presets.map((p) => p.name)).toEqual(['Welcome', 'Speeches']);
    expect(l.overlays[0]).toEqual({ channel: 1, name: 'Slides' });
    expect(l.countdowns).toEqual([{ id: 'cd', name: 'Doors open' }]);
  });
});
