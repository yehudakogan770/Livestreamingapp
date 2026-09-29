// Raffles and fundraisers (mirrors crates/engine/src/audience.rs), and how
// their animations look at a moment — the same in every window and the
// recording.

import type { Fundraiser } from './types/Fundraiser';
import type { Raffle } from './types/Raffle';

export const DRAW_MS = 6000;
const MAX_ENTRIES = 20_000;
const MAX_PLEDGE = 100_000_000;

const clean = (s: string, max: number) =>
  [...s.trim()]
    .filter((c) => c >= ' ')
    .slice(0, max)
    .join('');

export function defaultRaffle(): Raffle {
  return {
    title: 'Raffle',
    prize: '',
    entries: [],
    open: false,
    winners: [],
    draw: null,
    repeatWinners: false,
    nextId: 0,
    joinUrl: '',
    joinQr: '',
    showJoin: true,
  };
}

export function defaultFundraiser(): Fundraiser {
  return {
    title: 'Help us reach our goal',
    currency: '$',
    goal: 10_000,
    starting: 0,
    pledges: [],
    open: false,
    autoApprove: false,
    showDonors: true,
    nextId: 0,
    celebratedAt: 0,
    joinUrl: '',
    joinQr: '',
    showJoin: true,
  };
}

export function raffleEnter(r: Raffle, name: string): boolean {
  const n = clean(name, 40);
  if (!n || r.entries.length >= MAX_ENTRIES) return false;
  r.nextId += 1;
  r.entries.push({ id: r.nextId, name: n });
  return true;
}

export const eligible = (r: Raffle) => r.entries.map((e) => e.id).filter((id) => r.repeatWinners || !r.winners.includes(id));

export function raffleDraw(r: Raffle, now: number): boolean {
  const pool = eligible(r);
  if (!pool.length) return false;
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  r.winners.push(pick);
  r.draw = { startedAt: now, winner: pick, durationMs: DRAW_MS };
  return true;
}

/** What the draw shows at `now`: a name spinning by, or the winner. */
export function drawAt(r: Raffle, now: number): { name: string; done: boolean; t: number } | null {
  const d = r.draw;
  if (!d || !r.entries.length) return null;
  const t = Math.min(1, Math.max(0, (now - d.startedAt) / d.durationMs));
  const wi = Math.max(
    0,
    r.entries.findIndex((e) => e.id === d.winner),
  );
  const n = r.entries.length;
  // Fast at first, slowing down, landing on the winner.
  const steps = Math.min(60, 20 + n * 2);
  const ease = 1 - (1 - t) ** 3;
  const left = steps - Math.floor(ease * steps);
  const at = (((wi - left) % n) + n) % n;
  return { name: r.entries[at]!.name, done: t >= 1, t };
}

export const raised = (f: Fundraiser) => f.starting + f.pledges.filter((p) => p.approved).reduce((a, p) => a + p.amount, 0);
const quarters = (f: Fundraiser) => Math.min(4, Math.floor((raised(f) * 4) / Math.max(1, f.goal)));

export function withCelebration(f: Fundraiser, now: number, change: () => void): void {
  const before = quarters(f);
  change();
  if (quarters(f) > before) f.celebratedAt = now;
}

export function pledgeTo(f: Fundraiser, name: string, amount: number, message: string, approved: boolean, now: number): boolean {
  if (!(amount > 0) || amount > MAX_PLEDGE || f.pledges.length >= MAX_ENTRIES) return false;
  f.nextId += 1;
  const p = { id: f.nextId, name: clean(name, 40), amount: Math.floor(amount), message: clean(message, 140), at: now, approved };
  withCelebration(f, now, () => f.pledges.push(p));
  return true;
}

/** "$12,340" */
export const money = (f: Fundraiser, n: number) => `${f.currency}${Math.round(n).toLocaleString('en-US')}`;

/** How long the celebration lasts, ms. */
export const CELEBRATE_MS = 4000;

/** Confetti pieces for a celebration or a winner, at progress t (0 – 1): the same everywhere. */
export function confetti(count: number, t: number): { x: number; y: number; r: number; hue: number; size: number }[] {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const rnd = a - Math.floor(a);
    const b = Math.sin(i * 78.233) * 12345.678;
    const rnd2 = b - Math.floor(b);
    out.push({
      x: rnd,
      y: -0.1 + t * (0.9 + rnd2 * 0.6) + Math.sin(t * 8 + i) * 0.02,
      r: t * 12 * (rnd2 - 0.5),
      hue: Math.floor(rnd * 360),
      size: 0.008 + rnd2 * 0.012,
    });
  }
  return out;
}
