// The audience page (src-tauri/remote/vote.html), run as a phone would:
// word clouds, ratings and questions with votes.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../../src-tauri/remote/vote.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)![1]!;

interface Sent {
  url: string;
  body: Record<string, unknown> | null;
}

function audience(extra: Record<string, unknown> = {}) {
  return {
    polls: [
      { id: 'w', round: 3, question: 'One word for today?', options: [], kind: 'words' },
      { id: 'r', round: 1, question: 'How was the talk?', options: ['1', '2', '3', '4', '5'], kind: 'rating' },
    ],
    questions: true,
    qna: {
      open: true,
      moderate: false,
      list: [
        { id: 7, author: 'Ana', text: 'Will the slides be shared?', votes: 4, answered: false, mine: false },
        { id: 2, author: '', text: 'When is lunch?', votes: 1, answered: true, mine: true },
      ],
    },
    raffles: [],
    fundraisers: [],
    walls: [],
    auctions: [],
    trivia: [],
    seating: [],
    now: Date.now(),
    event: 'Product launch',
    ...extra,
  };
}

let sent: Sent[] = [];

async function open(data = audience()) {
  document.body.innerHTML = '<main id="app"></main>';
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
      if (url.startsWith('/api/audience')) return new Response(JSON.stringify(data), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
  new Function(script)();
  await vi.advanceTimersByTimeAsync(10);
}

const app = () => document.getElementById('app')!;

describe('the audience page', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lists questions with their votes, and votes one up', async () => {
    await open();
    const rows = [...app().querySelectorAll('.q')];
    expect(rows.map((r) => r.querySelector('.q__text')?.textContent)).toEqual(['Will the slides be shared?', 'When is lunch?']);
    expect(rows[1]!.textContent).toContain('Answered');
    const up = rows[0]!.querySelector<HTMLButtonElement>('button.up')!;
    expect(up.textContent).toBe('4');
    up.click();
    await vi.advanceTimersByTimeAsync(10);
    const vote = sent.find((s) => s.url === '/api/ask/vote');
    expect(vote?.body).toMatchObject({ question: 7, up: true });
    expect(rows[1]!.querySelector<HTMLButtonElement>('button.up')!.disabled).toBe(true);
  });

  it('sends words to a word cloud, three at most', async () => {
    await open();
    const box = [...app().querySelectorAll('section')].find((s) => s.textContent?.includes('One word for today?'))!;
    for (let i = 0; i < 3; i++) {
      const input = box.isConnected
        ? box.querySelector<HTMLInputElement>('input')
        : [...app().querySelectorAll('section')].find((s) => s.textContent?.includes('One word'))!.querySelector<HTMLInputElement>('input');
      input!.value = `word ${i}`;
      input!.dispatchEvent(new Event('input'));
      input!.parentElement!.querySelector<HTMLButtonElement>('button')!.click();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(sent.filter((s) => s.url === '/api/word').map((s) => s.body?.text)).toEqual(['word 0', 'word 1', 'word 2']);
    expect(sent.find((s) => s.url === '/api/word')?.body).toMatchObject({ id: 'w', round: 3 });
    expect(app().textContent).toContain('Watch for your words on the screen');
  });

  it('rates with stars, then takes one comment', async () => {
    await open();
    const section = () => [...app().querySelectorAll('section')].find((s) => s.textContent?.includes('How was the talk?'))!;
    const stars = section().querySelectorAll<HTMLButtonElement>('button.star');
    expect(stars).toHaveLength(5);
    stars[3]!.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.find((s) => s.url === '/api/vote')?.body).toMatchObject({ id: 'r', option: 3 });
    expect(section().querySelectorAll('button.star.is-on')).toHaveLength(4);
    const text = section().querySelector('textarea')!;
    text.value = 'Clear and useful';
    text.dispatchEvent(new Event('input'));
    [...section().querySelectorAll('button')].find((b) => b.textContent === 'Send the comment')!.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.filter((s) => s.url === '/api/vote').at(-1)?.body).toMatchObject({ option: 3, comment: 'Clear and useful' });
    expect(section().textContent).toContain('Thank you for your rating and your comment.');
  });

  it('sends reactions with each tap', async () => {
    await open(audience({ reactions: [{ id: 'rx' }] }));
    const buttons = [...app().querySelectorAll<HTMLButtonElement>('button.react')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Love', 'Haha', 'Wow', 'Yes']);
    buttons[1]!.click();
    buttons[3]!.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.filter((s) => s.url === '/api/react').map((s) => s.body)).toEqual([
      expect.objectContaining({ id: 'rx', kind: 1 }),
      expect.objectContaining({ id: 'rx', kind: 3 }),
    ]);
  });

  it('says when questions wait for the hosts', async () => {
    await open(audience({ qna: { open: true, moderate: true, list: [] } }));
    expect(app().textContent).toContain('The hosts read each question before it is listed here.');
    expect(app().querySelector('.q')).toBeNull();
  });
});
