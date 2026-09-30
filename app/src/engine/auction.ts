// A live auction (mirrors crates/engine/src/auction.rs), and what it shows at
// a moment — the same in every window and the recording.

import type { Auction } from './types/Auction';
import type { AuctionItem } from './types/AuctionItem';
import type { Bid } from './types/Bid';

const MAX_ITEMS = 200;
const MAX_BIDS = 5000;
const MAX_BID = 100_000_000;
/** A bid in the last moments adds this much time. */
export const EXTEND_MS = 15_000;
/** How long "Sold!" celebrates, ms. */
export const SOLD_MS = 5000;
/** How long the screen flashes after a new bid, ms. */
export const BID_FLASH_MS = 1200;

const clean = (s: string, max: number) =>
  [...s.trim()]
    .filter((c) => c >= ' ')
    .slice(0, max)
    .join('');

export function defaultAuction(): Auction {
  return {
    title: 'Live auction',
    currency: '$',
    items: [],
    current: 0,
    open: false,
    endsAt: null,
    lastBidAt: 0,
    soldAt: 0,
    nextId: 0,
    joinUrl: '',
    joinQr: '',
    showJoin: true,
  };
}

export function newItem(): AuctionItem {
  return { id: 0, name: '', detail: '', photo: '', start: 100, step: 10, bids: [], sold: false };
}

/** The highest bid (the earlier one wins a tie). */
export function top(it: AuctionItem): Bid | null {
  let best: Bid | null = null;
  for (const b of it.bids) if (!best || b.amount > best.amount || (b.amount === best.amount && b.at < best.at)) best = b;
  return best;
}

export const minimum = (it: AuctionItem) => {
  const t = top(it);
  return t ? t.amount + it.step : it.start;
};

export const raisedAt = (a: Auction) => a.items.filter((it) => it.sold).reduce((n, it) => n + (top(it)?.amount ?? 0), 0);

export const current = (a: Auction): AuctionItem | null => a.items[a.current] ?? null;

/** "$1,250" */
export const amount = (a: Auction, n: number) => `${a.currency}${Math.round(n).toLocaleString('en-US')}`;

/** Seconds left to bid (null: no countdown). */
export const secondsLeft = (a: Auction, now: number) => (a.endsAt === null ? null : Math.max(0, Math.ceil((a.endsAt - now) / 1000)));

/** "1:05" */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---- the same rules as the engine, for the browser demo ----

export function setItem(a: Auction, item: AuctionItem): boolean {
  const it = {
    ...item,
    name: clean(item.name, 80),
    detail: clean(item.detail, 140),
    start: Math.min(MAX_BID, Math.max(1, Math.floor(item.start))),
    step: Math.min(MAX_BID, Math.max(1, Math.floor(item.step))),
  };
  if (it.id === 0) {
    if (a.items.length >= MAX_ITEMS) return false;
    a.nextId += 1;
    a.items.push({ ...it, id: a.nextId, bids: [], sold: false });
    return true;
  }
  const old = a.items.find((x) => x.id === it.id);
  if (!old) return false;
  Object.assign(old, { name: it.name, detail: it.detail, photo: it.photo, start: it.start, step: it.step });
  return true;
}

export function removeItem(a: Auction, id: number): void {
  const at = a.items.findIndex((x) => x.id === id);
  a.items = a.items.filter((x) => x.id !== id);
  if (at >= 0 && at < a.current) a.current -= 1;
  else if (at === a.current) a.endsAt = null;
  if (a.current >= a.items.length) a.current = Math.max(0, a.items.length - 1);
}

/** A bid, or why not. */
export function placeBid(a: Auction, item: number, name: string, value: number, phone: boolean, now: number): string | null {
  if (phone && !a.open) return 'bidding is closed';
  const it = a.items[a.current];
  if (!it || it.id !== item) return 'that item is not being sold now';
  if (it.sold) return 'bidding is closed';
  if (a.endsAt !== null && now >= a.endsAt) return 'time is up for this item';
  const min = minimum(it);
  if (!(value >= min) || value > MAX_BID || it.bids.length >= MAX_BIDS) return `the bid must be at least ${min}`;
  a.nextId += 1;
  it.bids.push({ id: a.nextId, name: clean(name, 40), amount: Math.floor(value), at: now });
  a.lastBidAt = now;
  if (a.endsAt !== null && a.endsAt - now < EXTEND_MS) a.endsAt = now + EXTEND_MS;
  return null;
}
