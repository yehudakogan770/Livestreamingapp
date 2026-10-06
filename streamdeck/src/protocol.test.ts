// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LumoraClient, RETRY_MS, SILENCE_MS, SseParser, baseUrl } from './protocol';
import { FakeTimers, sampleShow } from './testing';

/** A pretend Lumora: answers /api/events with a stream the test writes to, and records posts. */
function fakeLumora(pin = '1234') {
  const encoder = new TextEncoder();
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const posts: { url: string; body: unknown; pin: string | null }[] = [];
  let reachable = true;
  let hold: Promise<void> | null = null;
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (!reachable) throw new TypeError('fetch failed');
    if (headers.get('X-Lumora-Pin') !== pin) return new Response('{"code":"wrongPin"}', { status: 401 });
    if (url.endsWith('/api/events')) {
      const body = new ReadableStream<Uint8Array>({ start: (c) => void streams.push(c) });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    posts.push({ url, body: JSON.parse(String(init?.body)), pin: headers.get('X-Lumora-Pin') });
    if (hold) await hold;
    return new Response('{}', { status: url.endsWith('/api/app') ? 202 : 200 });
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    posts,
    streams,
    send(event: string, data: unknown, to = streams.length - 1) {
      streams[to]!.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    drop(to = streams.length - 1) {
      streams[to]!.close();
    },
    set reachable(v: boolean) {
      reachable = v;
    },
    holdPosts() {
      let release!: () => void;
      hold = new Promise((r) => (release = r));
      return () => {
        hold = null;
        release();
      };
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe('addresses', () => {
  it('uses this computer and the remote’s usual port unless told otherwise', () => {
    expect(baseUrl('')).toBe('http://127.0.0.1:8765');
    expect(baseUrl(undefined)).toBe('http://127.0.0.1:8765');
    expect(baseUrl('192.168.1.20')).toBe('http://192.168.1.20:8765');
    expect(baseUrl(' 192.168.1.20:8770 ')).toBe('http://192.168.1.20:8770');
    expect(baseUrl('http://studio-pc:8766/')).toBe('http://studio-pc:8766');
    expect(baseUrl('[::1]')).toBe('http://[::1]:8765');
  });
});

describe('Server-Sent Events', () => {
  it('reads events split anywhere, with any line endings', () => {
    const p = new SseParser();
    const text = 'event: show\r\ndata: {"a":1}\r\n\r\n: comment\nevent: ping\ndata: {}\n\ndata: x\ndata: y\n\n';
    const got = [];
    for (let i = 0; i < text.length; i += 3) got.push(...p.push(text.slice(i, i + 3)));
    expect(got).toEqual([
      { event: 'show', data: '{"a":1}' },
      { event: 'ping', data: '{}' },
      { event: 'message', data: 'x\ny' },
    ]);
  });
});

describe('the connection to Lumora', () => {
  it('stays off until there is a PIN', () => {
    const lumora = fakeLumora();
    const c = new LumoraClient({ fetch: lumora.fetch, timers: new FakeTimers() });
    c.configure('', '');
    expect(c.connection).toBe('off');
    expect(lumora.streams).toHaveLength(0);
  });

  it('follows the show and what is running, and keeps Lumora’s clock', async () => {
    const lumora = fakeLumora();
    const timers = new FakeTimers();
    const c = new LumoraClient({ fetch: lumora.fetch, timers });
    const seen: string[] = [];
    c.subscribe(() => seen.push(c.connection));
    c.configure('127.0.0.1', '1234');
    await settle();
    expect(c.connection).toBe('connecting');
    lumora.send('show', { now: timers.time + 5000, snapshot: { revision: 1, show: sampleShow() } });
    await settle();
    expect(c.connection).toBe('online');
    expect(c.state?.inputs.map((i) => i.name)).toEqual(['Camera 1', 'Camera 2', 'Slides', 'Doors open']);
    expect(c.now() - timers.now()).toBe(5000);
    lumora.send('app', { recording: true, streaming: false });
    await settle();
    expect(c.state?.app.recording).toBe(true);
    expect(seen).toContain('online');
  });

  it('says when the PIN is wrong, and tries again', async () => {
    const lumora = fakeLumora('9999');
    const timers = new FakeTimers();
    const c = new LumoraClient({ fetch: lumora.fetch, timers });
    c.configure('', '1234');
    await settle();
    expect(c.connection).toBe('wrongPin');
    expect(timers.count).toBe(1);
  });

  it('reconnects by itself when Lumora goes away and comes back', async () => {
    const lumora = fakeLumora();
    const timers = new FakeTimers();
    const c = new LumoraClient({ fetch: lumora.fetch, timers });
    c.configure('', '1234');
    await settle();
    lumora.send('show', { now: 0, snapshot: { show: sampleShow() } });
    await settle();
    expect(c.connection).toBe('online');
    // Lumora closed.
    lumora.reachable = false;
    lumora.drop();
    await settle();
    expect(c.connection).toBe('offline');
    timers.advance(RETRY_MS[0]!);
    await settle();
    expect(c.connection).toBe('offline');
    // Back again: the next try connects.
    lumora.reachable = true;
    timers.advance(RETRY_MS[1]!);
    await settle();
    expect(lumora.streams).toHaveLength(2);
    lumora.send('show', { now: 0, snapshot: { show: sampleShow() } });
    await settle();
    expect(c.connection).toBe('online');
  });

  it('notices a connection that went silent (no ping)', async () => {
    const lumora = fakeLumora();
    const timers = new FakeTimers();
    const c = new LumoraClient({ fetch: lumora.fetch, timers });
    c.configure('', '1234');
    await settle();
    lumora.send('show', { now: 0, snapshot: { show: sampleShow() } });
    await settle();
    timers.advance(SILENCE_MS - 1000);
    lumora.send('ping', { now: 0 });
    await settle();
    timers.advance(SILENCE_MS - 1000);
    expect(c.connection).toBe('online');
    timers.advance(1100);
    expect(c.connection).toBe('offline');
  });

  it('sends each action once, with the PIN, even when pressed again while on its way', async () => {
    const lumora = fakeLumora();
    const c = new LumoraClient({ fetch: lumora.fetch, timers: new FakeTimers() });
    c.configure('', '1234');
    const release = lumora.holdPosts();
    const take = { type: 'take', screen: 'live' };
    const first = c.action(take);
    const again = await c.action(take);
    expect(again).toEqual({ ok: false, duplicate: true });
    release();
    expect(await first).toEqual({ ok: true, status: 200 });
    // Once answered, the next press is sent.
    expect((await c.action(take)).ok).toBe(true);
    expect((await c.command({ command: 'record', on: true })).status).toBe(202);
    expect(lumora.posts.map((p) => [p.url.replace(/^http:\/\/[^/]+/, ''), p.pin])).toEqual([
      ['/api/action', '1234'],
      ['/api/action', '1234'],
      ['/api/app', '1234'],
    ]);
  });

  it('a different action is not held back by one on its way', async () => {
    const lumora = fakeLumora();
    const c = new LumoraClient({ fetch: lumora.fetch, timers: new FakeTimers() });
    c.configure('', '1234');
    const release = lumora.holdPosts();
    const a = c.action({ type: 'setPreview', screen: 'live', sourceId: 'cam1' });
    const b = c.action({ type: 'setPreview', screen: 'live', sourceId: 'cam2' });
    release();
    expect([(await a).ok, (await b).ok]).toEqual([true, true]);
  });
});
