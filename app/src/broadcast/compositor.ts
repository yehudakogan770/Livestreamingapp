// Draws the Live Screen, exactly as the audience sees it, onto a canvas that
// is recorded and streamed. It follows the same show, clock and rules as the
// output windows (transitions, T-bar, blank, PANIC, failures shown as the
// safe screen), but needs no window on any display.

import type { EngineClient } from '../engine/client';
import type { Countdown } from '../engine/types/Countdown';
import type { EventInfo } from '../engine/types/EventInfo';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { programLayers, type StingerPlay } from '../components/ScreenView';
import { lumaMask } from '../engine/luma';
import { acquireCamera, fullResolution, releaseCamera } from '../engine/cameras';
import { syncMedia } from '../engine/mediaSync';
import { loadFontFor } from '../engine/fonts';
import { eventLogo } from '../engine/brand';
import { effectAt, WORD_OUT_MS, WORD_SPEED, wordEffect, type EffectState } from '../engine/effects';
import { barDesign, barLayout, barRange, glossesOf, pesukimOf, shownText, soundAndMeaning, wholeLayout, wordsOf, type PesukimData } from '../engine/pesukim';
import { overlayLook, overlaysOn } from '../engine/overlays';
import { ChromaKeyer, needsProcessing } from '../engine/chroma';
import { InputVision, shotToView, usesVision } from '../engine/vision';
import { currentSet, setSetLook } from '../visuals/sets';
import { makeRenderer, type Renderer } from '../visuals/renderer';
import { Logo3dRenderer, loadLogo, placeholderLogo } from '../logo3d/renderer';
import { loopVisuals } from '../logo3d/background';
import { browserInfo } from '../engine/browser';
import { logoRect, VisualsPlayer } from '../visuals/player';
import { buildAt, isRtl, textShown, withAlpha } from '../engine/text';
import { clockShown, formatGameClock } from '../engine/score';
import { LYRICS_FADE_MS, sections } from '../engine/lyrics';
import type { Lyrics } from '../engine/types/Lyrics';
import type { Poll } from '../engine/types/Poll';
import type { CommentCard } from '../engine/types/CommentCard';
import type { Raffle } from '../engine/types/Raffle';
import type { Fundraiser } from '../engine/types/Fundraiser';
import type { Wall } from '../engine/types/Wall';
import type { Auction } from '../engine/types/Auction';
import type { ZmanimCard } from '../engine/types/ZmanimCard';
import type { Scripture } from '../engine/types/Scripture';
import type { Trivia } from '../engine/types/Trivia';
import type { Seating } from '../engine/types/Seating';
import { COLUMNS as SEAT_COLUMNS, pageAt, pages as seatPages, ROWS as SEAT_ROWS } from '../engine/seating';
import { ANSWER_LOOK, counts, ranked, taking } from '../engine/trivia';
import { fitSize, indexNow, reference } from '../engine/tanach';
import { scriptureLayout, scriptureText } from '../components/ScriptureView';
import { clockTime, countdownText, hasPlace, nextCandles, zmanimOn } from '../engine/zmanim';
import { formatHebrew, formatHebrewHe } from '../engine/hebcal';
import { civilDate, zmanimRows } from '../components/ZmanimView';
import { amount, BID_FLASH_MS, clock, current, minimum, raisedAt, secondsLeft, SOLD_MS, top as top_ } from '../engine/auction';
import { cardSize, tickerShift, wallCard, wallGrid, wallTicker } from '../engine/wall';
import { CELEBRATE_MS, confetti, drawAt, money, raised } from '../engine/audience';
import { shares } from '../engine/poll';
import { joinShown } from '../engine/join';
import { FrameDelay } from '../engine/frameDelay';
import { dataValues, fill as fillData, withData } from '../engine/data';
import type { Graphic } from '../engine/types/Graphic';
import { entranceAt } from '../engine/graphic';
import type { Scoreboard } from '../engine/types/Scoreboard';
import { creditsMetrics, creditsPage, rollOffset, splitName, wallLayout } from '../engine/credits';
import type { Credits } from '../engine/types/Credits';
import type { TextInput } from '../engine/types/TextInput';
import type { Overlay } from '../engine/types/Overlay';
import { countdownDue, countdownFinished, countdownRemaining, countdownVisible, fadeAmount, formatCountdown, ZERO_HOLD_MS, type Shape } from '../engine/timing';

const FONT = '"Segoe UI", system-ui, sans-serif';
const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
const LOW_BARS = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];

/** A picture the canvas draws from: a video, a camera or an image. */
interface Media {
  key: string;
  el: HTMLVideoElement | HTMLImageElement;
  failed: boolean;
  /** When a failed camera is tried again. */
  retryAt?: number;
  release?: () => void;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - (1 - clamp01(x)) ** 3;

export class ProgramCompositor {
  readonly canvas: HTMLCanvasElement;
  /** Where drawing goes (swapped for a spare canvas while a luma wipe draws the new source). */
  private ctx: CanvasRenderingContext2D;
  private readonly media = new Map<string, Media>();
  private readonly pictures = new Map<string, Media>();
  /** One green-screen keyer per keyed input. */
  private readonly keyers = new Map<string, ChromaKeyer>();
  /** Background removal and auto-framing, per input. */
  private readonly visions = new Map<string, InputVision>();
  /** Pictures put behind people (background removal), by path. */
  private readonly bgPictures = new Map<string, HTMLImageElement>();
  /** Off while the computer is overloaded (the show comes first). */
  smartsAllowed = true;
  private show: Show | null = null;
  private lastSync = 0;
  /** When each source started being drawn (for build-on animations). */
  private starts = new Map<string, number>();
  private drawnBefore = new Set<string>();
  private drawnNow = new Set<string>();
  /** The stinger video being played, if any. */
  private sting: { path: string; el: HTMLVideoElement; startedAt: number } | null = null;
  /** Web pages: the newest captured frame of each, fetched as they come. */
  private readonly pages = new Map<string, { n: number; frame: ImageBitmap | null; busy: boolean; seen: number }>();
  private pageInfo: { port: number | null; captured: boolean } | null = null;
  /** One 3D logo renderer per 3D logo input (false: no WebGL here). */
  private readonly logos = new Map<
    string,
    { url: string | null; fg: HTMLCanvasElement; r: Logo3dRenderer; bg: HTMLCanvasElement; loop: Renderer | null; player: VisualsPlayer } | false
  >();
  /** The stage visuals, drawn once a frame at full size (null: not needed yet, false: no WebGL). */
  private visuals: { canvas: HTMLCanvasElement; r: Renderer; player: VisualsPlayer; at: number } | null | false = null;
  /** Cameras held back to line up with late sound. */
  private delays = new Map<string, FrameDelay & { el: HTMLVideoElement }>();

  constructor(
    private readonly client: EngineClient,
    width = 1920,
    height = 1080,
    /** Which screen it draws (the recording is always the Live Screen). */
    private readonly screen: 'live' | 'back' = 'live',
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This computer cannot draw the picture for recording.');
    // Every font it draws with is loaded (the built-in fonts load only when used).
    const fontProp = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
    if (fontProp?.get && fontProp.set) {
      const { get, set } = fontProp;
      Object.defineProperty(ctx, 'font', {
        get() {
          return get.call(this);
        },
        set(v: string) {
          set.call(this, v);
          loadFontFor(v);
        },
      });
    }
    this.ctx = ctx;
  }

  setShow(show: Show): void {
    this.show = show;
    setSetLook(show.event.brand.accent, show.event.name);
  }

  resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  dispose(): void {
    this.stopSting();
    for (const s of this.show?.sources ?? []) if (s.kind.type === 'camera') fullResolution(`rec:${s.id}`, s.kind.deviceId, false);
    if (this.visuals) this.visuals.r.dispose();
    for (const l of this.logos.values()) {
      if (l) {
        l.r.dispose();
        l.loop?.dispose();
      }
    }
    this.logos.clear();
    this.visuals = null;
    for (const d of this.delays.values()) d.dispose();
    this.delays.clear();
    for (const m of [...this.media.values(), ...this.pictures.values()]) this.drop(m);
    this.media.clear();
    this.pictures.clear();
  }

  /** Draw the Live Screen as it is at `now`. */
  draw(now: number): void {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const show = this.show;
    if (!show) return;
    const h = canvas.height;
    const w = canvas.width;
    this.drawnBefore = this.drawnNow;
    this.drawnNow = new Set();
    for (const id of this.starts.keys()) if (!this.drawnBefore.has(id)) this.starts.delete(id);

    const sc = show.screens[this.screen];
    const { layers, black, white, stinger } = programLayers(show, this.screen, now);
    // Also open what is behind a Pesukim input on air.
    const behind = layers.map((l) => pesukimOf(show, l.id)?.look.behind ?? null);
    // And what is inside a split screen on air.
    for (const l of layers) {
      const k = show.sources.find((x) => x.id === l.id)?.kind;
      if (k?.type === 'split') behind.push(...k.boxes.map((b) => b.sourceId));
      if (k?.type === 'slideshow') {
        behind.push(k.behind);
        const slide = k.slides[k.current];
        if (slide?.type === 'input') behind.push(slide.sourceId);
      }
    }
    const overlays = overlaysOn(show.overlays, this.screen, now);
    this.keep(show, [...layers.map((l) => l.id), sc.preview, ...behind, ...overlays.map(({ o }) => o.sourceId)]);
    if (now - this.lastSync > 150) {
      this.lastSync = now;
      for (const [id, m] of this.media) {
        const src = show.sources.find((s) => s.id === id);
        if (src && m.el instanceof HTMLVideoElement && src.kind.type === 'video') syncMedia(m.el, src, now);
      }
    }

    for (const l of [...layers].sort((a, b) => Number(!!a.top) - Number(!!b.top))) {
      const src = show.sources.find((s) => s.id === l.id);
      if (!src || l.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha = clamp01(l.opacity);
      if (l.shape) {
        ctx.beginPath();
        shapePath(ctx, l.shape, w, h);
        ctx.clip();
      }
      if (l.shift || l.shiftY) ctx.translate(((l.shift ?? 0) / 100) * w, ((l.shiftY ?? 0) / 100) * h);
      if (l.scale !== undefined && l.scale !== 1) {
        ctx.translate(w / 2, h / 2);
        ctx.scale(l.scale, l.scale);
        ctx.translate(-w / 2, -h / 2);
      }
      if (l.blur) ctx.filter = `blur(${(l.blur * h).toFixed(2)}px)`;
      const mask = l.luma && lumaMask(l.luma.pattern, l.luma.p);
      if (mask) {
        // Draw the new source apart, keep it only where the mask shows, then put it on.
        const off = this.offscreen(w, h);
        const main = this.ctx;
        const o = off.getContext('2d')!;
        o.globalCompositeOperation = 'source-over';
        o.clearRect(0, 0, w, h);
        this.ctx = o;
        try {
          this.drawSource(src, show.event, now, w, h);
        } finally {
          this.ctx = main;
        }
        o.globalCompositeOperation = 'destination-in';
        o.drawImage(mask.canvas, 0, 0, w, h);
        o.globalCompositeOperation = 'source-over';
        main.drawImage(off, 0, 0);
      } else this.drawSource(src, show.event, now, w, h);
      ctx.restore();
    }
    this.overlay('#000', black, w, h);
    this.overlay('#fff', white, w, h);
    for (const { o } of overlays) this.drawOverlay(o, show, now, w, h);
    this.drawSting(stinger, now, w, h);
    this.overlay('#000', fadeAmount(sc.blank, sc.blankChangedAt, now, sc.blankFadeMs), w, h);
    const panic = fadeAmount(show.panic, show.panicChangedAt, now);
    if (panic > 0) {
      ctx.save();
      ctx.globalAlpha = panic;
      this.safeScreen(show.event, 'panic', w, h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawSting(play: StingerPlay | undefined, now: number, w: number, h: number) {
    if (!play) {
      this.stopSting();
      return;
    }
    if (!this.sting || this.sting.path !== play.path) {
      this.stopSting();
      const el = document.createElement('video');
      el.crossOrigin = 'anonymous';
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.src = this.client.mediaUrl(play.path);
      this.sting = { path: play.path, el, startedAt: -1 };
    }
    const s = this.sting;
    const at = Math.max(0, (now - play.startedAt) / 1000);
    if (s.startedAt !== play.startedAt || Math.abs(s.el.currentTime - at) > 0.15) {
      s.startedAt = play.startedAt;
      if (s.el.readyState >= 1) s.el.currentTime = at;
      if (s.el.paused) void s.el.play().catch(() => {});
    }
    if (s.el.readyState >= 2) this.ctx.drawImage(s.el, 0, 0, w, h);
  }

  private stopSting() {
    if (!this.sting) return;
    this.sting.el.pause();
    this.sting.el.removeAttribute('src');
    this.sting.el.load();
    this.sting = null;
  }

  /** A poll (mirrors PollView and its CSS; sizes are % of the frame height). */
  private poll(p: Poll, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    const g = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, Math.hypot(w, h) * 0.8);
    g.addColorStop(0, '#1c2433');
    g.addColorStop(1, '#07080b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const shown = joinShown(p.joinUrl, p.joinQr, 'Scan to vote', this.show?.event.wifi, Date.now());
    const join = p.showJoin && p.open && p.joinQr ? this.qr(shown.qr) : null;
    const left = 7 * u;
    const qrW = join ? 34 * u : 0;
    const right = w - 7 * u - (join ? qrW + 6 * u : 0);
    const share = shares(p);
    const total = p.votes.reduce((a, b) => a + b, 0);
    const font = (px: number, weight: number) => `${weight} ${px * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = font(6.4, 800);
    const qLines = this.wrap(p.question, right - left);
    const qH = qLines.length * 6.4 * 1.15 * u;
    const optsH = p.options.length * 9 * u + Math.max(0, p.options.length - 1) * 2 * u;
    const blockH = qH + 4 * u + optsH + (p.showResults ? 5.5 * u : 0);
    let y = Math.max(9 * u, (h - blockH) / 2);
    qLines.forEach((line, i) => ctx.fillText(line, left, y + (i + 0.5) * 6.4 * 1.15 * u));
    y += qH + 4 * u;
    p.options.forEach((o, i) => {
      const ow = right - left;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(left, y, ow, 9 * u, 1.2 * u);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(left, y, ow, 9 * u);
      if (p.showResults) {
        const bg = ctx.createLinearGradient(left, 0, left + ow, 0);
        bg.addColorStop(0, '#2f80ed');
        bg.addColorStop(1, '#56a0ff');
        ctx.fillStyle = bg;
        ctx.fillRect(left, y, ow * (share[i] ?? 0), 9 * u);
      }
      ctx.fillStyle = '#fff';
      ctx.font = font(4.2, 700);
      ctx.textAlign = 'left';
      ctx.fillText(o, left + 3 * u, y + 4.5 * u, ow - 16 * u);
      if (p.showResults) {
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round((share[i] ?? 0) * 100)}%`, left + ow - 3 * u, y + 4.5 * u);
      }
      ctx.restore();
      y += 11 * u;
    });
    if (p.showResults) {
      ctx.fillStyle = '#b8bec8';
      ctx.font = font(3, 400);
      ctx.textAlign = 'left';
      ctx.fillText(`${total} ${total === 1 ? 'vote' : 'votes'}`, left, y + 2 * u);
    }
    if (join) {
      const qx = w - 7 * u - qrW;
      const qy = (h - qrW - 8 * u) / 2;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(qx, qy, qrW, qrW, 1.5 * u);
      ctx.fill();
      if (join.complete && join.naturalWidth) ctx.drawImage(join, qx + 1.5 * u, qy + 1.5 * u, qrW - 3 * u, qrW - 3 * u);
      ctx.textAlign = 'center';
      ctx.font = font(3.4, 700);
      ctx.fillText(shown.label, qx + qrW / 2, qy + qrW + 3 * u, qrW + 8 * u);
      ctx.fillStyle = '#b8bec8';
      ctx.font = font(2.2, 500);
      ctx.fillText(shown.sub, qx + qrW / 2, qy + qrW + 6.5 * u, qrW + 8 * u);
    }
    ctx.restore();
  }

  /** The dark background, title (and subtitle) that raffles and fundraisers share (mirrors AudienceViews.css). */
  private audienceBase(title: string, sub: string, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    const g = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, Math.hypot(w, h) * 0.8);
    g.addColorStop(0, '#1c2433');
    g.addColorStop(1, '#07080b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${6.4 * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(title, w / 2, 7 * u + 3.7 * u, w - 14 * u);
    if (sub) {
      ctx.fillStyle = '#c9ccd2';
      ctx.font = `400 ${3.6 * u}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(sub, w / 2, 7 * u + 7.4 * u + 1.5 * u + 2 * u, w - 14 * u);
    }
  }

  private joinCode(url: string, qr: string, label: string, cx: number, cy: number, u: number) {
    const j = joinShown(url, qr, label, this.show?.event.wifi, Date.now());
    const img = this.qr(j.qr);
    const ctx = this.ctx;
    const size = 32 * u;
    const x = cx - size / 2;
    const y = cy - (size + 8 * u) / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 1.5 * u);
    ctx.fill();
    if (img?.complete && img.naturalWidth) ctx.drawImage(img, x + 1.5 * u, y + 1.5 * u, size - 3 * u, size - 3 * u);
    ctx.textAlign = 'center';
    ctx.font = `700 ${3.4 * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(j.label, cx, y + size + 3 * u, size + 8 * u);
    ctx.fillStyle = '#b8bec8';
    ctx.font = `500 ${2.2 * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(j.sub, cx, y + size + 6.5 * u, size + 8 * u);
  }

  private confettiDraw(t: number, w: number, h: number) {
    if (t <= 0 || t >= 1) return;
    const ctx = this.ctx;
    for (const c of confetti(90, t)) {
      ctx.save();
      ctx.translate(c.x * w, c.y * h);
      ctx.rotate(c.r);
      ctx.fillStyle = `hsl(${c.hue} 85% 60%)`;
      ctx.fillRect(0, 0, c.size * h, c.size * 0.6 * h);
      ctx.restore();
    }
  }

  /** A raffle (mirrors RaffleView). */
  private raffle(r: Raffle, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    ctx.save();
    this.audienceBase(r.title, r.prize, w, h);
    const d = drawAt(r, now);
    const font = (px: number, weight: number) => `${weight} ${px * u}px "Segoe UI", system-ui, sans-serif`;
    if (d) {
      const cy = (26 * u + (h - 12 * u)) / 2;
      ctx.fillStyle = '#c9ccd2';
      ctx.font = font(4, 400);
      ctx.fillText(d.done ? 'THE WINNER IS' : 'DRAWING…', w / 2, cy - 12 * u);
      ctx.font = font(11, 800);
      const tw = Math.min(w - 14 * u, ctx.measureText(d.name).width + 12 * u);
      const bh = 17 * u;
      if (d.done) {
        const g = ctx.createLinearGradient(w / 2 - tw / 2, 0, w / 2 + tw / 2, 0);
        g.addColorStop(0, '#f2b233');
        g.addColorStop(1, '#e0473b');
        ctx.fillStyle = g;
      } else ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect(w / 2 - tw / 2, cy + 3 * u - bh / 2, tw, bh, 2 * u);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(d.name, w / 2, cy + 3 * u, tw - 12 * u);
    } else {
      const join = r.showJoin && r.open && r.joinQr;
      const cx = join ? w * 0.35 : w / 2;
      const cy = (26 * u + (h - 12 * u)) / 2;
      ctx.fillStyle = '#fff';
      ctx.font = font(22, 700);
      ctx.fillText(String(r.entries.length), cx, cy - 3 * u);
      ctx.fillStyle = '#c9ccd2';
      ctx.font = font(4, 400);
      ctx.fillText(r.entries.length === 1 ? 'entry' : 'entries', cx, cy + 11 * u);
      if (join) {
        ctx.fillStyle = '#fff';
        this.joinCode(r.joinUrl, r.joinQr, 'Scan to enter', w * 0.66, cy, u);
      }
    }
    const done = d?.done ?? false;
    const earlier = r.winners.slice(0, done ? -1 : r.winners.length - (d ? 1 : 0));
    if (earlier.length) {
      ctx.fillStyle = '#b8bec8';
      ctx.font = font(3, 400);
      const names = earlier.map((id) => r.entries.find((e) => e.id === id)?.name ?? '').join(' · ');
      ctx.fillText(`Winners so far: ${names}`, w / 2, h - 6.5 * u, w - 14 * u);
    }
    if (done && r.draw) this.confettiDraw((now - r.draw.startedAt - r.draw.durationMs) / 5000, w, h);
    ctx.restore();
  }

  /** A fundraiser (mirrors FundraiserView). */
  private fundraiser(f: Fundraiser, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    ctx.save();
    this.audienceBase(f.title, '', w, h);
    const total = raised(f);
    const pct = Math.min(100, (total / Math.max(1, f.goal)) * 100);
    const join = f.showJoin && f.open && f.joinQr;
    const left = 7 * u;
    const right = w - 7 * u - (join ? 32 * u + 6 * u : 0);
    const font = (px: number, weight: number) => `${weight} ${px * u}px "Segoe UI", system-ui, sans-serif`;
    const donors = f.showDonors
      ? f.pledges
          .filter((p) => p.approved)
          .slice(-4)
          .reverse()
      : [];
    const blockH = 14 * u + 3.5 * u + 8 * u + (donors.length ? 3.5 * u + donors.length * 4.4 * u : 0);
    let y = 22 * u + (h - 30 * u - blockH) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = font(14, 700);
    const amount = money(f, total);
    ctx.fillText(amount, left, y + 7 * u);
    const aw = ctx.measureText(amount).width;
    ctx.fillStyle = '#c9ccd2';
    ctx.font = font(4, 400);
    ctx.fillText(`raised of ${money(f, f.goal)}`, left + aw + 2.5 * u, y + 9 * u);
    y += 14 * u + 3.5 * u;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(left, y, right - left, 8 * u, 4 * u);
    ctx.fill();
    const g = ctx.createLinearGradient(left, 0, right, 0);
    g.addColorStop(0, '#27ae60');
    g.addColorStop(1, '#6fdc8c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(left, y, Math.max(8 * u, ((right - left) * pct) / 100), 8 * u, 4 * u);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = font(3.6, 800);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(pct)}%`, right - 2.5 * u, y + 4 * u);
    ctx.textAlign = 'left';
    y += 8 * u + 3.5 * u;
    for (const p of donors) {
      ctx.fillStyle = '#fff';
      ctx.font = font(3.2, 700);
      const n = p.name || 'Anonymous';
      ctx.fillText(n, left, y + 2 * u);
      const nw = ctx.measureText(`${n} `).width;
      ctx.font = font(3.2, 400);
      const rest = `${money(f, p.amount)}${p.message ? ` · ${p.message}` : ''}`;
      ctx.fillText(rest, left + nw, y + 2 * u, right - left - nw);
      y += 4.4 * u;
    }
    if (join) {
      ctx.fillStyle = '#fff';
      this.joinCode(f.joinUrl, f.joinQr, 'Scan to pledge', w - 7 * u - 16 * u, 22 * u + (h - 30 * u) / 2, u);
    }
    const t = (now - f.celebratedAt) / CELEBRATE_MS;
    if (t > 0 && t < 1) {
      const text = pct >= 100 ? 'Goal reached! Thank you!' : `${Math.floor(pct / 25) * 25}% of the goal!`;
      ctx.font = font(4.4, 800);
      ctx.textAlign = 'center';
      const tw = ctx.measureText(text).width + 8 * u;
      ctx.fillStyle = '#f2b233';
      ctx.beginPath();
      ctx.roundRect(w / 2 - tw / 2, 16 * u, tw, 6.8 * u, 3.4 * u);
      ctx.fill();
      ctx.fillStyle = '#1a1206';
      ctx.fillText(text, w / 2, 16 * u + 3.4 * u);
      this.confettiDraw(t, w, h);
    }
    ctx.restore();
  }

  /** A designed graphic (mirrors GraphicView). */
  private graphic(g: Graphic, now: number, since: number, w: number, h: number) {
    const ctx = this.ctx;
    const values = this.show ? dataValues(this.show.data) : undefined;
    for (const e of g.elements) {
      const look = entranceAt(e, now - since);
      const alpha = e.opacity * look.alpha;
      if (alpha <= 0) continue;
      const ew = (e.w / 100) * w;
      const eh = (e.h / 100) * h;
      const x = (e.x / 100) * w + (look.dx / 100) * w;
      const y = (e.y / 100) * h + (look.dy / 100) * h;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + ew / 2, y + eh / 2);
      ctx.scale(look.scale, look.scale);
      ctx.translate(-ew / 2, -eh / 2);
      if (e.kind === 'box') {
        if (e.shadow) {
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 0.02 * h;
          ctx.shadowOffsetY = 0.006 * h;
        }
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.roundRect(0, 0, ew, eh, Math.min((e.radius / 100) * h, ew / 2, eh / 2));
        ctx.fill();
      } else if (e.kind === 'image') {
        const img = e.path ? this.picture(e.path) : null;
        if (img?.complete && img.naturalWidth) {
          const s = Math.min(ew / img.naturalWidth, eh / img.naturalHeight);
          const dw = img.naturalWidth * s;
          const dh = img.naturalHeight * s;
          ctx.drawImage(img, (ew - dw) / 2, (eh - dh) / 2, dw, dh);
        }
      } else {
        const size = (e.size / 100) * h;
        ctx.font = `${e.italic ? 'italic ' : ''}${e.weight} ${size}px "${e.font}", "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = e.color;
        ctx.textBaseline = 'middle';
        ctx.textAlign = e.align;
        if (e.shadow) {
          ctx.shadowColor = 'rgba(0,0,0,0.7)';
          ctx.shadowBlur = 0.012 * h;
          ctx.shadowOffsetY = 0.003 * h;
        }
        const lines = fillData(e.text, values)
          .split('\n')
          .flatMap((l) => this.wrap(l, ew));
        const lh = size * 1.2;
        const tx = e.align === 'center' ? ew / 2 : e.align === 'right' ? ew : 0;
        let ty = (eh - lines.length * lh) / 2 + lh / 2;
        for (const l of lines) {
          ctx.fillText(l, tx, ty);
          ty += lh;
        }
      }
      ctx.restore();
    }
  }

  /** The table finder (mirrors SeatingView and its CSS). */
  private seating(s: Seating, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    const font = (px: number, weight: number) => `${weight} ${px * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    const g = ctx.createRadialGradient(w * 0.5, h * 0.2, 0, w * 0.5, h * 0.2, Math.hypot(w, h) * 0.8);
    g.addColorStop(0, '#2b2233');
    g.addColorStop(1, '#0c0a10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f3dfb0';
    ctx.font = font(6.4, 800);
    const list = s.look === 'list';
    ctx.fillText(s.title, w / 2, (list ? 5 : 9) * u + 4 * u, w - 14 * u);
    if (list) {
      const { page, guests } = pageAt(s, now);
      const left = 6 * u;
      const gap = 5 * u;
      const cw = (w - 12 * u - gap * (SEAT_COLUMNS - 1)) / SEAT_COLUMNS;
      guests.forEach((guest, i) => {
        const c = Math.floor(i / SEAT_ROWS);
        const r = i % SEAT_ROWS;
        const x = left + c * (cw + gap);
        const y = 17 * u + r * 5.6 * u;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(x, y + 5.45 * u, cw, 0.15 * u);
        ctx.font = font(2.8, 700);
        const tw = ctx.measureText(guest.table).width;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#f3dfb0';
        ctx.fillText(guest.table, x + cw, y + 2.8 * u);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = font(2.8, 400);
        ctx.fillText(guest.name, x, y + 2.8 * u, cw - tw - 2 * u);
      });
      ctx.textAlign = 'center';
      if (seatPages(s) > 1) {
        ctx.fillStyle = '#a79fb4';
        ctx.font = font(2.4, 400);
        ctx.fillText(`Page ${page + 1} of ${seatPages(s)}`, w / 2, h - 5.1 * u);
      }
    } else if (s.showJoin && s.open && s.joinQr) {
      const j = joinShown(s.joinUrl, s.joinQr, 'Scan and type your name', this.show?.event.wifi, now);
      const img = this.qr(j.qr);
      const x = w / 2 - 22 * u;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(x, 24 * u, 44 * u, 44 * u, 2 * u);
      ctx.fill();
      if (img?.complete && img.naturalWidth) ctx.drawImage(img, x + 2 * u, 26 * u, 40 * u, 40 * u);
      ctx.font = font(4, 700);
      ctx.fillText(j.label, w / 2, 72 * u, w - 14 * u);
      ctx.fillStyle = '#cfc6d9';
      ctx.font = font(2.4, 400);
      ctx.fillText(j.sub, w / 2, 76.5 * u, w - 14 * u);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = font(5, 400);
      ctx.fillText(`${s.guests.length} guests`, w / 2, 47 * u);
    }
    ctx.restore();
  }

  /** A trivia game (mirrors TriviaView and its CSS). */
  private trivia(t: Trivia, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    const font = (px: number, weight: number) => `${weight} ${px * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    const g = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, Math.hypot(w, h) * 0.8);
    g.addColorStop(0, '#2a1f4d');
    g.addColorStop(1, '#0b0818');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const q = t.questions[t.current];
    if (t.phase === 'join' || !q) {
      ctx.font = font(7, 800);
      ctx.fillText(t.title, w / 2, 11.2 * u, w - 14 * u);
      if (t.showJoin && t.joinQr) {
        const j = joinShown(t.joinUrl, t.joinQr, 'Scan to play', this.show?.event.wifi, now);
        const img = this.qr(j.qr);
        const x = w / 2 - 20 * u;
        ctx.beginPath();
        ctx.roundRect(x, 22 * u, 40 * u, 40 * u, 2 * u);
        ctx.fill();
        if (img?.complete && img.naturalWidth) ctx.drawImage(img, x + 2 * u, 24 * u, 36 * u, 36 * u);
        ctx.font = font(4, 700);
        ctx.fillText(j.label, w / 2, 66 * u);
        ctx.fillStyle = '#c8c0e0';
        ctx.font = font(2.4, 400);
        ctx.fillText(j.sub, w / 2, 70.5 * u, 60 * u);
      } else {
        ctx.font = font(5, 400);
        ctx.fillText('Get your phones ready!', w / 2, 43 * u);
      }
      ctx.fillStyle = '#f2d27a';
      ctx.font = font(4, 400);
      ctx.fillText(`${t.players.length} ${t.players.length === 1 ? 'player' : 'players'}`, w / 2, h - 8.5 * u);
      ctx.restore();
      return;
    }
    if (t.phase === 'leaderboard') {
      ctx.font = font(7, 800);
      ctx.fillText('Leaderboard', w / 2, 11.2 * u);
      const top = ranked(t).slice(0, 8);
      const best = Math.max(1, top[0]?.score ?? 1);
      const left = 30 * u;
      const right = w - 30 * u;
      top.forEach((p, i) => {
        const cy = 20 * u + i * 8.5 * u + 3.5 * u;
        ctx.font = font(3.6, 800);
        ctx.fillStyle = '#f2d27a';
        ctx.fillText(String(i + 1), left + 3 * u, cy);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = font(3.6, 400);
        ctx.fillText(p.name, left + 8.5 * u, cy, 36 * u);
        const bx = left + 8.5 * u + 36 * u + 2.5 * u;
        const bw = right - 14 * u - 2.5 * u - bx;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.roundRect(bx, cy - 1.5 * u, bw, 3 * u, 1.5 * u);
        ctx.fill();
        const gr = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        gr.addColorStop(0, '#7b5cff');
        gr.addColorStop(1, '#f2b233');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.roundRect(bx, cy - 1.5 * u, Math.max(1.5 * u, (bw * p.score) / best), 3 * u, 1.5 * u);
        ctx.fill();
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        ctx.font = font(3.6, 700);
        ctx.fillText(p.score.toLocaleString('en-US'), right, cy);
        ctx.textAlign = 'center';
      });
      ctx.restore();
      return;
    }
    const reveal = t.phase === 'reveal';
    ctx.fillStyle = '#c8c0e0';
    ctx.font = font(2.8, 400);
    ctx.fillText(`Question ${t.current + 1} of ${t.questions.length}`, w / 2, 5.8 * u);
    ctx.fillStyle = '#fff';
    ctx.font = font(5.6, 800);
    const lines = this.wrap(q.text, w - 32 * u).slice(0, 3);
    lines.forEach((l, i) => ctx.fillText(l, w / 2, 9 * u + 12 * u - ((lines.length - 1) * 7 * u) / 2 + i * 7 * u));
    if (!reveal) {
      const left = Math.max(0, Math.ceil((t.askedAt + q.seconds * 1000 - now) / 1000));
      const open = taking(t, now);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(8.5 * u, 17.5 * u, 5.5 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = font(open ? 5 : 2.2, 800);
      ctx.fillText(open ? String(left) : "Time's up!", 8.5 * u, 17.5 * u, 10 * u);
    }
    ctx.fillStyle = '#c8c0e0';
    ctx.font = font(2.6, 400);
    ctx.fillText(`${t.answers.length} answered`, w - 9 * u, 15.7 * u, 12 * u);
    const n = counts(t);
    const top = 38 * u;
    const gap = 2 * u;
    const gw = (w - 10 * u - gap) / 2;
    const rows = Math.ceil(q.options.length / 2);
    const gh = (h - 5 * u - top - gap * (rows - 1)) / rows;
    q.options.forEach((o, i) => {
      const x = 5 * u + (i % 2) * (gw + gap);
      const y = top + Math.floor(i / 2) * (gh + gap);
      ctx.globalAlpha = reveal && i !== q.correct ? 0.28 : 1;
      ctx.fillStyle = ANSWER_LOOK[i]!.color;
      ctx.beginPath();
      ctx.roundRect(x, y, gw, gh, 1.5 * u);
      ctx.fill();
      if (reveal && i === q.correct) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.8 * u;
        ctx.beginPath();
        ctx.roundRect(x - 0.4 * u, y - 0.4 * u, gw + 0.8 * u, gh + 0.8 * u, 1.9 * u);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.font = font(5, 400);
      ctx.fillText(ANSWER_LOOK[i]!.shape, x + 3 * u, y + gh / 2);
      ctx.font = font(4.4, 700);
      const sw = 5 * u + 3 * u;
      ctx.fillText(o, x + 3 * u + sw, y + gh / 2, gw - 6 * u - sw - (reveal ? 8 * u : 0));
      if (reveal) {
        ctx.textAlign = 'right';
        ctx.font = font(5, 700);
        ctx.fillText(String(n[i] ?? 0), x + gw - 3 * u, y + gh / 2);
      }
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  /** Tanach (mirrors ScriptureView and its CSS). */
  private scripture(s: Scripture, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    const t = scriptureText(s);
    const L = scriptureLayout(s);
    ctx.save();
    if (!L.lower) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.3, Math.hypot(w, h) * 0.7);
      g.addColorStop(0, '#13233a');
      g.addColorStop(1, '#04060b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (!t.count) {
      ctx.restore();
      return;
    }
    if (L.lower) {
      ctx.fillStyle = 'rgba(8,12,20,0.88)';
      ctx.beginPath();
      ctx.roundRect(5 * u, 67 * u, w - 10 * u, h - 71 * u, 1.2 * u);
      ctx.fill();
      ctx.fillStyle = '#c9a24a';
      ctx.fillRect(5 * u, 67 * u, 0.8 * u, h - 71 * u);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const block = (text: string, box: { top: number; h: number }, size: number, fontCss: string, color: string, rtl: boolean) => {
      ctx.font = fontCss.replace('SIZE', `${size * u}px`);
      ctx.direction = rtl ? 'rtl' : 'ltr';
      const lines = this.wrap(text, L.width * u);
      const lh = size * 1.4 * u;
      let y = box.top * u + (box.h * u - lines.length * lh) / 2 + lh / 2;
      ctx.fillStyle = color;
      for (const line of lines) {
        ctx.fillText(line, w / 2, y);
        y += lh;
      }
      ctx.direction = 'ltr';
    };
    if (s.lang !== 'en')
      block(
        t.he,
        L.he,
        fitSize(t.he.length, L.width, L.he.h, L.lower ? 4.6 : 7.5),
        '700 SIZE "Frank Ruehl CLM", David, "Times New Roman", serif',
        '#f4e7c5',
        true,
      );
    if (s.lang !== 'he')
      block(t.en, L.en, fitSize(t.en.length, L.width, L.en.h, L.lower ? 3.6 : 5.2), '400 SIZE Georgia, "Times New Roman", serif', '#e8ecf3', false);
    if (s.showRef) {
      const ref = reference(s, indexNow()?.[s.book]?.he);
      const size = L.lower ? 2.2 : 2.8;
      ctx.font = `400 ${size * u}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = '#c9a24a';
      ctx.fillText(`${ref.en} · ${ref.he}`, w / 2, L.ref * u + 1.8 * u, w - 14 * u);
    }
    ctx.restore();
  }

  /** The zmanim (mirrors ZmanimView and its CSS). */
  private zmanim(card: ZmanimCard, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    const font = (px: number, weight: number) => `${weight} ${px * u}px "Segoe UI", system-ui, sans-serif`;
    const place = this.show?.event.place;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const back = () => {
      const g = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, Math.hypot(w, h) * 0.8);
      g.addColorStop(0, '#26203a');
      g.addColorStop(1, '#09080d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };
    if (!hasPlace(place)) {
      if (card.style !== 'bar') back();
      ctx.fillStyle = '#b8bec8';
      ctx.font = font(4, 400);
      ctx.fillText("Choose the event's city: Event → Zmanim and Shabbos…", w / 2, card.style === 'bar' ? h - 8 * u : 42 * u, w - 14 * u);
      ctx.restore();
      return;
    }
    const z = zmanimOn(now, place);
    const he = formatHebrewHe(z.hebrew);
    const en = formatHebrew(z.hebrew);
    if (card.style === 'bar') {
      const top = 87 * u;
      ctx.fillStyle = 'rgba(14,10,24,0.86)';
      ctx.fillRect(0, top, w, 7 * u);
      ctx.fillStyle = '#f2b233';
      ctx.fillRect(0, top, w, 0.3 * u);
      ctx.textAlign = 'left';
      ctx.direction = 'rtl';
      ctx.font = font(3.6, 700);
      const hw = ctx.measureText(he).width;
      ctx.fillStyle = '#f2d27a';
      ctx.textAlign = 'right';
      ctx.fillText(he, 3 * u + hw, top + 3.5 * u);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = font(3.2, 400);
      const tail =
        z.candles !== null && now < z.candles
          ? `Candle lighting ${clockTime(z.candles)} · in ${countdownText(z.candles - now)}`
          : `Sunset ${clockTime(z.sunset)}`;
      ctx.fillText(`${en} · ${tail}`, 3 * u + hw + 3 * u, top + 3.5 * u, w - hw - 9 * u);
      ctx.restore();
      return;
    }
    back();
    ctx.direction = 'rtl';
    ctx.fillStyle = '#f2d27a';
    ctx.font = font(8, 800);
    ctx.fillText(he, w / 2, 13 * u, w - 14 * u);
    ctx.direction = 'ltr';
    if (card.style === 'countdown') {
      const next = nextCandles(now, place);
      const lit = z.candles !== null && now >= z.candles && now - z.candles < 3 * 3_600_000;
      ctx.fillStyle = '#fff';
      if (lit) {
        ctx.font = font(22, 800);
        ctx.fillText('Good Shabbos!', w / 2, 53 * u, w - 14 * u);
      } else if (next !== null) {
        ctx.fillStyle = '#d6d2e4';
        ctx.font = font(5, 400);
        ctx.fillText('Candle lighting in', w / 2, 35 * u);
        ctx.fillStyle = '#fff';
        ctx.font = font(22, 800);
        ctx.fillText(countdownText(next - now), w / 2, 53 * u, w - 14 * u);
        ctx.fillStyle = '#f2d27a';
        ctx.font = font(4, 400);
        ctx.fillText(`${new Date(next).toLocaleDateString('en-US', { weekday: 'long' })} ${clockTime(next)} · ${place.name}`, w / 2, 72.5 * u, w - 14 * u);
      } else {
        ctx.fillStyle = '#f2d27a';
        ctx.font = font(4, 400);
        ctx.fillText('No candle lighting this week', w / 2, 72.5 * u);
      }
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#d6d2e4';
    ctx.font = font(3.6, 400);
    ctx.fillText(`${en} · ${civilDate(now)}`, w / 2, 21.3 * u, w - 14 * u);
    if (z.special.length) {
      ctx.fillStyle = '#f2b233';
      ctx.font = font(3, 700);
      ctx.fillText(z.special.join(' · '), w / 2, 27 * u, w - 14 * u);
    }
    const gx = w / 2 - 55 * u;
    const colW = (110 * u - 6 * u) / 2;
    zmanimRows(z).forEach(([label, t], i) => {
      const x = gx + (i % 2) * (colW + 6 * u);
      const y = 33 * u + Math.floor(i / 2) * 8 * u;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y + 7.8 * u, colW, 0.2 * u);
      ctx.font = font(3.4, 400);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#c9c5d8';
      ctx.fillText(label, x, y + 4 * u);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.font = font(3.4, 700);
      ctx.fillText(clockTime(t), x + colW, y + 4 * u);
    });
    ctx.textAlign = 'center';
    if (z.candles !== null) {
      const bx = w / 2 - 55 * u;
      ctx.fillStyle = 'rgba(242,178,51,0.16)';
      ctx.strokeStyle = '#f2b233';
      ctx.lineWidth = 0.3 * u;
      ctx.beginPath();
      ctx.roundRect(bx, 63 * u, 110 * u, 11 * u, 2 * u);
      ctx.fill();
      ctx.stroke();
      const parts: [string, string, number][] = [
        ['🕯 Candle lighting', '#fff', 400],
        [clockTime(z.candles), '#fff', 700],
      ];
      if (now < z.candles) parts.push([`in ${countdownText(z.candles - now)}`, '#f2d27a', 400]);
      const widths = parts.map(([t, , wt]) => {
        ctx.font = font(4.2, wt);
        return ctx.measureText(t).width;
      });
      let x = w / 2 - (widths.reduce((a, b) => a + b, 0) + 3 * u * (parts.length - 1)) / 2;
      ctx.textAlign = 'left';
      parts.forEach(([t, c, wt], i) => {
        ctx.font = font(4.2, wt);
        ctx.fillStyle = c;
        ctx.fillText(t, x, 68.5 * u);
        x += widths[i]! + 3 * u;
      });
      ctx.textAlign = 'center';
    }
    ctx.fillStyle = '#9a96ab';
    ctx.font = font(2.6, 400);
    ctx.fillText(place.name, w / 2, h - 7.5 * u);
    ctx.restore();
  }

  /** An auction (mirrors AuctionView and its CSS). */
  private auction(a: Auction, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    const font = (px: number, weight: number) => `${weight} ${px * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    const join = a.showJoin && a.open && a.joinQr;
    this.audienceBase(a.title, '', w, h);
    const top = 22 * u;
    const bottom = h - 10 * u;
    const left = 7 * u;
    const right = w - (join ? 45 * u : 7 * u);
    const aw = right - left;
    const ah = bottom - top;
    const it = current(a);
    ctx.textBaseline = 'middle';
    if (!it) {
      ctx.fillStyle = '#8f96a3';
      ctx.font = font(4, 400);
      ctx.textAlign = 'center';
      ctx.fillText('The first item will appear here', left + aw / 2, top + ah / 2);
    } else {
      let ix = left;
      let iw = aw;
      if (it.photo) {
        const pw = Math.min(aw * 0.45, 70 * u);
        const img = this.picture(it.photo);
        if (img?.complete && img.naturalWidth) {
          const sc = Math.min(pw / img.naturalWidth, ah / img.naturalHeight);
          const dw = img.naturalWidth * sc;
          const dh = img.naturalHeight * sc;
          const dx = left + (pw - dw) / 2;
          const dy = top + (ah - dh) / 2;
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(dx, dy, dw, dh, 1.5 * u);
          ctx.clip();
          ctx.drawImage(img, dx, dy, dw, dh);
          ctx.restore();
        }
        ix = left + pw + 5 * u;
        iw = right - ix;
      }
      const center = !it.photo;
      const x = center ? ix + iw / 2 : ix;
      ctx.textAlign = center ? 'center' : 'left';
      const best = top_(it);
      const sold = it.sold;
      const left_ = secondsLeft(a, now);
      ctx.font = font(6, 800);
      const nameLines = this.wrap(it.name, iw).slice(0, 2);
      const rows: { h: number; draw: (y: number) => void }[] = [];
      rows.push({
        h: nameLines.length * 7.2 * u,
        draw: (y) => {
          ctx.fillStyle = '#fff';
          ctx.font = font(6, 800);
          nameLines.forEach((l, i) => ctx.fillText(l, x, y + (i + 0.5) * 7.2 * u, iw));
        },
      });
      if (it.detail)
        rows.push({
          h: 5.2 * u,
          draw: (y) => {
            ctx.fillStyle = '#c9ccd2';
            ctx.font = font(3.2, 400);
            ctx.fillText(it.detail, x, y + u + 2.1 * u, iw);
          },
        });
      rows.push({
        h: 7.6 * u,
        draw: (y) => {
          ctx.fillStyle = sold ? '#ff5a4e' : '#9aa3b2';
          ctx.font = font(2.8, 700);
          this.spacing(0.12 * 2.8 * u);
          ctx.fillText((sold ? 'Sold for' : best ? 'Current bid' : 'Starting bid').toUpperCase(), x, y + 4 * u + 1.8 * u, iw);
          this.spacing(0);
        },
      });
      rows.push({
        h: 14 * u,
        draw: (y) => {
          ctx.fillStyle = now - a.lastBidAt < BID_FLASH_MS ? '#f2b233' : '#fff';
          ctx.font = font(13, 800);
          ctx.fillText(amount(a, best ? best.amount : it.start), x, y + 7 * u, iw);
        },
      });
      if (best)
        rows.push({
          h: 4.6 * u,
          draw: (y) => {
            ctx.fillStyle = '#f2b233';
            ctx.font = font(3.6, 700);
            const n = best.name || 'Anonymous';
            ctx.fillText(sold ? `to ${n}` : n, x, y + 2.3 * u, iw);
          },
        });
      if (!sold && best)
        rows.push({
          h: 5.5 * u,
          draw: (y) => {
            ctx.fillStyle = '#c9ccd2';
            ctx.font = font(3, 400);
            ctx.fillText(`Next bid: ${amount(a, minimum(it))}`, x, y + 1.5 * u + 2 * u, iw);
          },
        });
      if (!sold && left_ !== null)
        rows.push({
          h: 8.5 * u,
          draw: (y) => {
            ctx.font = font(3.6, 800);
            const text = left_ > 0 ? `⏱ ${clock(left_)}` : 'Time is up';
            const tw = ctx.measureText(text).width + 5 * u;
            const px = center ? x - tw / 2 : x;
            ctx.fillStyle = left_ <= 10 ? '#e0473b' : 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.roundRect(px, y + 2.5 * u, tw, 6 * u, 3 * u);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left';
            ctx.fillText(text, px + 2.5 * u, y + 2.5 * u + 3 * u);
            ctx.textAlign = center ? 'center' : 'left';
          },
        });
      let y = top + (ah - rows.reduce((n, r) => n + r.h, 0)) / 2;
      for (const r of rows) {
        r.draw(y);
        y += r.h;
      }
      if (sold) {
        ctx.save();
        ctx.font = font(10, 900);
        const sw = ctx.measureText('SOLD!').width + 8 * u + 2 * u;
        const sh = 12 * u + 2 * u + 2 * u;
        const sx = 9 * u;
        const sy = h - 14 * u - sh;
        ctx.translate(sx + sw / 2, sy + sh / 2);
        ctx.rotate((-10 * Math.PI) / 180);
        ctx.strokeStyle = '#ff5a4e';
        ctx.lineWidth = u;
        ctx.beginPath();
        ctx.roundRect(-sw / 2 + u / 2, -sh / 2 + u / 2, sw - u, sh - u, 2 * u);
        ctx.stroke();
        ctx.fillStyle = '#ff5a4e';
        ctx.textAlign = 'center';
        ctx.fillText('SOLD!', 0, 0);
        ctx.restore();
        this.confettiDraw((now - a.soldAt) / SOLD_MS, w, h);
      }
    }
    if (a.items.length) {
      const raised = raisedAt(a);
      ctx.fillStyle = '#9aa3b2';
      ctx.font = font(2.6, 400);
      ctx.textAlign = 'center';
      const text = `Item ${Math.min(a.current + 1, a.items.length)} of ${a.items.length}${raised > 0 ? ` · Raised so far ${amount(a, raised)}` : ''}`;
      ctx.fillText(text, w / 2, h - 3.5 * u - 1.7 * u, w - 14 * u);
    }
    if (join) {
      ctx.fillStyle = '#fff';
      this.joinCode(a.joinUrl, a.joinQr, 'Scan to bid', w - 7 * u - 16 * u, 24 * u + (h - 32 * u) / 2, u);
    }
    ctx.restore();
  }

  /** A messages wall (mirrors WallView and its CSS). */
  private wall(wl: Wall, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const u = h / 100;
    const font = (px: number, weight: number) => `${weight} ${px * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    if (wl.style === 'ticker') {
      const top = 87 * u;
      const bh = 7 * u;
      ctx.fillStyle = 'rgba(10,12,16,0.85)';
      ctx.fillRect(0, top, w, bh);
      ctx.font = font(2.8, 800);
      const label = wl.title.toUpperCase();
      const lw = ctx.measureText(label).width + 5 * u;
      ctx.fillStyle = '#2f80ed';
      ctx.fillRect(0, top, lw, bh);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, 2.5 * u, top + bh / 2);
      const words = wallTicker(wl);
      ctx.font = font(3.4, 500);
      const area = w - lw;
      const shift = tickerShift(now, area / h, ctx.measureText(words).width / h);
      ctx.beginPath();
      ctx.rect(lw, top, area, bh);
      ctx.clip();
      ctx.fillText(words, lw + area - shift * h, top + bh / 2);
      ctx.restore();
      return;
    }
    const join = wl.showJoin && wl.open && wl.joinQr;
    this.audienceBase(wl.title, join ? wl.prompt : '', w, h);
    const top = 24 * u;
    const bottom = h - 8 * u;
    const left = 7 * u;
    const right = w - (join ? 45 * u : 7 * u);
    const aw = right - left;
    const ah = bottom - top;
    const card = wl.style === 'cards' ? wallCard(wl, now) : null;
    const grid = wl.style === 'grid' ? wallGrid(wl) : [];
    ctx.textBaseline = 'middle';
    if (!card && !grid.length) {
      ctx.fillStyle = '#8f96a3';
      ctx.font = font(4, 400);
      ctx.textAlign = 'center';
      ctx.fillText(join ? 'Be the first — scan the code' : 'Messages will appear here', left + aw / 2, top + ah / 2);
    }
    const contain = (img: HTMLImageElement, x: number, y: number, bw: number, bh: number, radius: number) => {
      const s = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
      const iw = img.naturalWidth * s;
      const ih = img.naturalHeight * s;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + (bw - iw) / 2, y + (bh - ih) / 2, iw, ih, radius);
      ctx.clip();
      ctx.drawImage(img, x + (bw - iw) / 2, y + (bh - ih) / 2, iw, ih);
      ctx.restore();
    };
    if (card) {
      const m = card.m;
      ctx.globalAlpha = card.alpha;
      let tx = left;
      let tw = aw;
      const img = m.photo ? this.picture(m.photo) : null;
      const ready = !!img?.complete && !!img.naturalWidth;
      if (m.photo && !m.text) {
        // A photo on its own, with who sent it underneath.
        const ph = ah - (m.name ? 5.75 * u : 0);
        if (img && ready) contain(img, left, top, aw, ph, 1.5 * u);
        if (m.name) {
          ctx.fillStyle = '#f2b233';
          ctx.font = font(3.4, 700);
          ctx.textAlign = 'center';
          ctx.fillText(`— ${m.name}`, left + aw / 2, top + ph + 1.5 * u + 2.125 * u, aw);
        }
      } else if (m.photo) {
        const pw = Math.min(aw * 0.5, 88 * u);
        if (img && ready) contain(img, left, top, pw, ah, 1.5 * u);
        tx = left + pw + 4 * u;
        tw = right - tx;
      }
      if (m.text || (m.name && !m.photo)) {
        const size = cardSize(m.text, !!m.photo);
        ctx.font = font(size, 600);
        const lines = m.text ? this.wrap(`“${m.text}”`, tw) : [];
        const lh = size * 1.25 * u;
        const block = lines.length * lh + (m.name ? (lines.length ? 2.5 * u : 0) + 3.4 * 1.25 * u : 0);
        let y = top + (ah - block) / 2;
        const photoSide = !!m.photo && tw < aw;
        ctx.textAlign = photoSide ? 'left' : 'center';
        const x = photoSide ? tx : left + aw / 2;
        ctx.fillStyle = '#fff';
        for (const line of lines) {
          ctx.fillText(line, x, y + lh / 2);
          y += lh;
        }
        if (m.name) {
          if (lines.length) y += 2.5 * u;
          ctx.fillStyle = '#f2b233';
          ctx.font = font(3.4, 700);
          ctx.fillText(`— ${m.name}`, x, y + 3.4 * 0.625 * u, tw);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (grid.length) {
      const gap = 2.4 * u;
      const cw = (aw - gap * 2) / 3;
      const ch = (ah - gap) / 2;
      grid.forEach((m, i) => {
        const cx = left + (i % 3) * (cw + gap);
        const cy = top + Math.floor(i / 3) * (ch + gap);
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.beginPath();
        ctx.roundRect(cx, cy, cw, ch, 1.5 * u);
        ctx.fill();
        ctx.clip();
        const pad = 2.4 * u;
        const iw = cw - pad * 2;
        let y = cy + pad;
        const size = m.photo ? 2.6 : 3;
        ctx.font = font(size, 400);
        const lines = m.text ? this.wrap(m.text, iw).slice(0, m.photo ? 2 : 6) : [];
        const lh = size * 1.25 * u;
        const nameH = m.name ? 2.2 * 1.25 * u : 0;
        if (m.photo) {
          const textH = lines.length * lh + (lines.length ? u : 0) + (m.name ? nameH + u : 0);
          const ph = ch - pad * 2 - textH;
          const img = this.picture(m.photo);
          if (img?.complete && img.naturalWidth && ph > 0) {
            const s = Math.max(iw / img.naturalWidth, ph / img.naturalHeight);
            const sw = iw / s;
            const sh = ph / s;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(cx + pad, y, iw, ph, u);
            ctx.clip();
            ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, cx + pad, y, iw, ph);
            ctx.restore();
          }
          y += ph + u;
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = font(size, 400);
        for (const line of lines) {
          ctx.fillText(line, cx + pad, y + lh / 2, iw);
          y += lh;
        }
        if (m.name) {
          ctx.fillStyle = '#f2b233';
          ctx.font = font(2.2, 700);
          const ny = m.photo ? y + u : cy + ch - pad - nameH;
          ctx.fillText(m.name, cx + pad, ny + nameH / 2, iw);
        }
        ctx.restore();
      });
    }
    if (join) {
      ctx.fillStyle = '#fff';
      this.joinCode(wl.joinUrl, wl.joinQr, 'Scan to send', w - 7 * u - 16 * u, top + ah / 2, u);
    }
    ctx.restore();
  }

  /** A chat comment on its card (mirrors CommentView and its CSS). */
  private comment(c: CommentCard, now: number, w: number, h: number) {
    const m = c.comment;
    if (!m) return;
    const ctx = this.ctx;
    const u = h / 100;
    const t = Math.min(1, Math.max(0, (now - c.changedAt) / 450));
    const e = 1 - (1 - t) ** 3;
    const middle = c.place === 'middle';
    const textSize = (middle ? 5 : 3.6) * u;
    const font = (px: number, weight: number) => `${weight} ${px}px "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    ctx.globalAlpha *= e;
    ctx.textBaseline = 'middle';
    ctx.font = font(textSize, 600);
    const maxW = (middle ? 0.76 : 0.62) * w - 2 * 2.8 * u - u;
    const lines = this.wrap(m.text, maxW);
    ctx.font = font(2.8 * u, 700);
    const headW = 4.4 * u + 1.2 * u + ctx.measureText(m.author).width + 12 * u;
    ctx.font = font(textSize, 600);
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const cw = Math.min(maxW, Math.max(headW, textW)) + 2 * 2.8 * u + u;
    const ch = 2 * 2.2 * u + 4.4 * u + u + lines.length * textSize * 1.3;
    const x = middle ? (w - cw) / 2 : 0.05 * w;
    const y = (middle ? (h - ch) / 2 : h - 10 * u - ch) + (1 - e) * 3 * u;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 2 * u;
    ctx.shadowOffsetY = 0.6 * u;
    ctx.fillStyle = 'rgba(13,15,19,0.92)';
    ctx.beginPath();
    ctx.roundRect(x, y, cw, ch, u);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.roundRect(x, y, u, ch, [u, 0, 0, u]);
    ctx.fill();
    const left = x + u + 2.8 * u;
    const headY = y + 2.2 * u + 2.2 * u;
    ctx.beginPath();
    ctx.arc(left + 2.2 * u, headY, 2.2 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = font(2.4 * u, 800);
    ctx.fillText([...m.author.trim()][0]?.toUpperCase() ?? '?', left + 2.2 * u, headY);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#dfe3e8';
    ctx.font = font(2.8 * u, 700);
    ctx.fillText(m.author, left + 5.6 * u, headY);
    const via = { youtube: 'YouTube', twitch: 'Twitch', other: '' }[m.platform];
    if (via) {
      const nw = ctx.measureText(m.author).width;
      ctx.fillStyle = '#9aa0a8';
      ctx.font = font(2 * u, 400);
      ctx.fillText(via, left + 5.6 * u + nw + 1.2 * u, headY);
    }
    ctx.fillStyle = '#fff';
    ctx.font = font(textSize, 600);
    ctx.direction = isRtl(m.text) ? 'rtl' : 'ltr';
    ctx.textAlign = isRtl(m.text) ? 'right' : 'left';
    const tx = isRtl(m.text) ? x + cw - 2.8 * u : left;
    lines.forEach((l, i) => ctx.fillText(l, tx, y + 2.2 * u + 4.4 * u + u + textSize * 1.3 * (i + 0.5)));
    ctx.restore();
  }

  /** A QR code (SVG) as a picture, made once. */
  private qr(svg: string): HTMLImageElement | null {
    const key = `qr:${svg.length}:${svg.slice(-64)}`;
    let m = this.pictures.get(key);
    if (!m) {
      m = this.image(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      this.pictures.set(key, m);
    }
    return m.failed ? null : (m.el as HTMLImageElement);
  }

  /** A song's current slide (mirrors LyricsView and its CSS). */
  private lyrics(l: Lyrics, now: number, w: number, h: number) {
    const text = l.blank ? '' : (sections(l.text)[l.current] ?? '');
    if (!text) return;
    const ctx = this.ctx;
    const s = l.style;
    const k = h / 1080;
    const lines = text.split('\n');
    const size = s.size * k;
    const lineH = size * s.lineHeight;
    const pad = s.boxOn ? s.padding * k : 0;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, Math.max(0, (now - l.changedAt) / LYRICS_FADE_MS));
    ctx.font = `${s.weight} ${size}px "${s.font}", "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.direction = isRtl(text) ? 'rtl' : 'ltr';
    const maxW = w * 0.88;
    const tw = Math.min(maxW, Math.max(...lines.map((x) => ctx.measureText(x).width)));
    const bw = tw + 2 * pad;
    const bh = lines.length * lineH + 2 * pad;
    const bx = (w - bw) / 2;
    const by = l.place === 'low' ? h * 0.93 - bh : (h - bh) / 2;
    if (s.boxOn) {
      ctx.fillStyle = withAlpha(s.boxColor, s.boxOpacity);
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, s.radius * k);
      ctx.fill();
    }
    ctx.textAlign = s.align;
    const ax = s.align === 'center' ? w / 2 : s.align === 'right' ? bx + bw - pad : bx + pad;
    ctx.shadowColor = s.shadow ? 'rgba(0,0,0,0.75)' : 'transparent';
    ctx.shadowBlur = s.shadow ? 14 * k : 0;
    ctx.shadowOffsetY = s.shadow ? 3 * k : 0;
    lines.forEach((line, i) => {
      const y = by + pad + lineH * (i + 0.5);
      if (s.outline > 0) {
        ctx.lineWidth = s.outline * 2 * k;
        ctx.strokeStyle = s.outlineColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, ax, y, maxW);
      }
      ctx.fillStyle = s.color;
      ctx.fillText(line, ax, y, maxW);
    });
    ctx.restore();
  }

  /** A scoreboard (mirrors ScoreboardView and its CSS). */
  private scoreboard(sb: Scoreboard, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const k = h / 1080;
    const clock = formatGameClock(clockShown(sb.clock, now), sb.clock.countDown);
    const font = (px: number, weight = 800) => `${weight} ${px * k}px "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    if (sb.style === 'full') {
      const g = ctx.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, '#1d2430');
      g.addColorStop(1, '#07080b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (sb.title) {
        ctx.fillStyle = '#c9ccd2';
        ctx.font = font(48, 700);
        ctx.fillText(sb.title, w / 2, 70 * k + 30 * k);
      }
      const side = (t: Scoreboard['home'], cx: number) => {
        const cy = h * 0.54;
        ctx.fillStyle = t.color;
        ctx.fillRect(cx - w * 0.14, cy - 230 * k, w * 0.28, 12 * k);
        ctx.fillStyle = '#fff';
        ctx.font = font(64, 700);
        ctx.fillText(t.name, cx, cy - 170 * k);
        ctx.font = font(260);
        ctx.fillText(String(t.score), cx, cy + 20 * k);
      };
      side(sb.home, w * 0.24);
      side(sb.away, w * 0.76);
      ctx.fillStyle = '#fff';
      if (sb.showClock) {
        ctx.font = font(96);
        ctx.fillText(clock, w / 2, h * 0.5);
      }
      if (sb.period) {
        ctx.fillStyle = '#c9ccd2';
        ctx.font = font(44, 600);
        ctx.fillText(sb.period, w / 2, h * 0.5 + 90 * k);
      }
      ctx.restore();
      return;
    }
    const bar = sb.style === 'bar';
    const bh = (bar ? 76 : 56) * k;
    const nameSize = bar ? 34 : 28;
    const scoreSize = bar ? 46 : 34;
    const strip = (bar ? 10 : 8) * k;
    const pad = (bar ? 20 : 14) * k;
    const scoreW = (bar ? 84 : 60) * k;
    const clockSize = bar ? 34 : 28;
    const periodSize = bar ? 22 : 18;
    const measure = (t: string, px: number, weight = 800) => {
      ctx.font = font(px, weight);
      return ctx.measureText(t).width;
    };
    const teamW = (t: Scoreboard['home']) =>
      strip + pad * 2 + measure(bar ? t.name : t.short || t.name, nameSize) + Math.max(scoreW, measure(String(t.score), scoreSize) + pad);
    const hasInfo = !!sb.period || sb.showClock;
    const cw = sb.showClock ? measure(clock, clockSize) : 0;
    const pw = sb.period ? measure(sb.period, periodSize, 600) : 0;
    const infoW = !hasInfo ? 0 : bar ? Math.max(cw, pw) + pad * 2 : cw + pw + pad * (sb.showClock && sb.period ? 3 : 2);
    const total = teamW(sb.home) + teamW(sb.away) + infoW;
    const x0 = bar ? (w - total) / 2 : w * 0.035;
    const y0 = bar ? h * 0.93 - bh : h * 0.05;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16 * k;
    ctx.shadowOffsetY = 4 * k;
    ctx.fillStyle = 'rgba(13,15,19,0.92)';
    ctx.beginPath();
    ctx.roundRect(x0, y0, total, bh, 6 * k);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0, y0, total, bh, 6 * k);
    ctx.clip();
    const cy = y0 + bh / 2;
    const team = (t: Scoreboard['home'], x: number, end: boolean) => {
      const tw = teamW(t);
      const sw = tw - strip - pad * 2 - measure(bar ? t.name : t.short || t.name, nameSize);
      // Strip, name, score (reversed for the away team on the bar).
      const stripX = end ? x + tw - strip : x;
      const scoreX = end ? x : x + tw - sw;
      const nameX = end ? x + sw + pad + (tw - sw - strip - pad * 2) / 2 : x + strip + pad + (tw - sw - strip - pad * 2) / 2;
      ctx.fillStyle = t.color;
      ctx.fillRect(stripX, y0, strip, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(scoreX, y0, sw, bh);
      ctx.fillStyle = '#fff';
      ctx.font = font(nameSize);
      ctx.fillText(bar ? t.name : t.short || t.name, nameX, cy);
      ctx.font = font(scoreSize);
      ctx.fillText(String(t.score), scoreX + sw / 2, cy);
      return x + tw;
    };
    const info = (x: number) => {
      if (!hasInfo) return x;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(x, y0, infoW, bh);
      if (bar) {
        const both = sb.showClock && sb.period;
        ctx.fillStyle = '#fff';
        ctx.font = font(clockSize);
        if (sb.showClock) ctx.fillText(clock, x + infoW / 2, both ? cy - periodSize * 0.55 * k : cy);
        ctx.fillStyle = '#c9ccd2';
        ctx.font = font(periodSize, 600);
        if (sb.period) ctx.fillText(sb.period, x + infoW / 2, both ? cy + clockSize * 0.55 * k : cy);
      } else {
        let cx = x + pad;
        if (sb.showClock) {
          ctx.fillStyle = '#fff';
          ctx.font = font(clockSize);
          ctx.fillText(clock, cx + cw / 2, cy);
          cx += cw + pad;
        }
        if (sb.period) {
          ctx.fillStyle = '#c9ccd2';
          ctx.font = font(periodSize, 600);
          ctx.fillText(sb.period, cx + pw / 2, cy);
        }
      }
      return x + infoW;
    };
    let x = team(sb.home, x0, false);
    if (bar) x = info(x);
    x = team(sb.away, x, bar);
    if (!bar) info(x);
    ctx.restore();
    ctx.restore();
  }

  private off: HTMLCanvasElement | null = null;

  /** A spare canvas the size of the picture (luma wipes). */
  private offscreen(w: number, h: number): HTMLCanvasElement {
    if (!this.off) this.off = document.createElement('canvas');
    if (this.off.width !== w || this.off.height !== h) {
      this.off.width = w;
      this.off.height = h;
    }
    return this.off;
  }

  /** When this source started being drawn, without a break. */
  private since(id: string, now: number): number {
    if (!this.drawnBefore.has(id) && !this.drawnNow.has(id)) this.starts.set(id, now);
    this.drawnNow.add(id);
    return this.starts.get(id) ?? now;
  }

  private overlay(color: string, amount: number, w: number, h: number) {
    if (amount <= 0) return;
    this.ctx.save();
    this.ctx.globalAlpha = clamp01(amount);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.restore();
  }

  // ---- sources ----

  private drawSource(src: Source, event: EventInfo, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const k = src.kind;
    switch (k.type) {
      case 'color':
        ctx.fillStyle = k.color;
        ctx.fillRect(0, 0, w, h);
        return;
      case 'pattern': {
        const top = h * 0.78;
        BARS.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(Math.floor((i * w) / 7), 0, Math.ceil(w / 7) + 1, top);
        });
        LOW_BARS.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(Math.floor((i * w) / 7), top, Math.ceil(w / 7) + 1, h - top);
        });
        return;
      }
      case 'microphone':
        return;
      case 'screen':
      case 'stream': {
        const frame = this.pageFrame(src.id, false);
        if (frame) this.fit(frame, src.fit, w, h);
        return;
      }
      case 'guest': {
        const frame = this.pageFrame(src.id, false);
        if (frame) this.fit(frame, src.fit, w, h);
        return;
      }
      case 'browser': {
        const frame = this.pageFrame(src.id);
        if (frame) this.fit(frame, src.fit, w, h);
        else if (!k.transparent) {
          ctx.fillStyle = '#101216';
          ctx.fillRect(0, 0, w, h);
        }
        return;
      }
      case 'logo3d': {
        const path = k.path || event.logo;
        const url = path ? this.client.mediaUrl(path) : null;
        let l = this.logos.get(src.id);
        if (l === undefined || (l && l.url !== url)) {
          if (l) l.r.dispose();
          const fg = document.createElement('canvas');
          const r = Logo3dRenderer.create(fg);
          if (!r) {
            this.logos.set(src.id, false);
            return;
          }
          const made = { url, fg, r, bg: document.createElement('canvas'), loop: null as Renderer | null, player: new VisualsPlayer() };
          r.setLogo(placeholderLogo());
          if (url)
            void loadLogo(url).then(
              (p) => made.r.setLogo(p),
              () => undefined,
            );
          this.logos.set(src.id, made);
          l = made;
        }
        if (!l) return;
        if (k.background === 'colour') {
          ctx.fillStyle = k.bgColor;
          ctx.fillRect(0, 0, w, h);
        } else if (k.background === 'loop') {
          l.loop ??= makeRenderer(l.bg);
          if (l.loop) {
            l.loop.draw(l.player.frame(loopVisuals(k.bgScene), now), w * 0.6, h * 0.6);
            ctx.drawImage(l.bg, 0, 0, w, h);
          }
        }
        l.r.draw(k, now, w, h);
        ctx.drawImage(l.fg, 0, 0, w, h);
        return;
      }
      case 'visuals': {
        const v = this.visualsFrame(now);
        if (v) ctx.drawImage(v, 0, 0, w, h);
        else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, w, h);
        }
        const vis = this.show?.visuals;
        const logo = vis?.logo.on && !vis.blackout && event.logo ? this.picture(event.logo) : null;
        if (vis && logo?.naturalWidth && this.visuals) {
          const b = logoRect(vis.logo, this.visuals.player.beatPulse, w, h, logo.naturalWidth / logo.naturalHeight);
          ctx.drawImage(logo, b.x, b.y, b.w, b.h);
        }
        return;
      }
      case 'countdown':
        this.countdown(k.timer, k.background, k.logo ?? eventLogo(event), now, w, h);
        return;
      case 'pesukim':
        this.pesukim(k, event, now, w, h);
        return;
      case 'scoreboard':
        this.scoreboard(k, now, w, h);
        return;
      case 'lyrics':
        this.lyrics(k, now, w, h);
        return;
      case 'poll':
        this.poll(k, w, h);
        return;
      case 'comment':
        this.comment(k, now, w, h);
        return;
      case 'raffle':
        this.raffle(k, now, w, h);
        return;
      case 'fundraiser':
        this.fundraiser(k, now, w, h);
        return;
      case 'wall':
        this.wall(k, now, w, h);
        return;
      case 'auction':
        this.auction(k, now, w, h);
        return;
      case 'zmanim':
        this.zmanim(k, now, w, h);
        return;
      case 'scripture':
        this.scripture(k, w, h);
        return;
      case 'trivia':
        this.trivia(k, now, w, h);
        return;
      case 'seating':
        this.seating(k, now, w, h);
        return;
      case 'graphic':
        this.graphic(k, now, this.since(src.id, now), w, h);
        return;
      case 'text':
        this.text(this.show ? withData(k, dataValues(this.show.data)) : k, now, w, h, this.since(src.id, now));
        return;
      case 'credits':
        this.credits(k, now, w, h);
        return;
      case 'slideshow': {
        const ctx = this.ctx;
        ctx.fillStyle = k.background;
        ctx.fillRect(0, 0, w, h);
        const other = (id: string | null) => (id ? this.show?.sources.find((x) => x.id === id && x.kind.type !== 'slideshow') : undefined);
        const behind = other(k.behind);
        if (behind) this.drawSource(behind, event, now, w, h);
        const slide = k.slides[k.current];
        if (!slide) return;
        const ax = (k.area.x / 100) * w;
        const ay = (k.area.y / 100) * h;
        const aw = (k.area.w / 100) * w;
        const ah = (k.area.h / 100) * h;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.beginPath();
        ctx.rect(0, 0, aw, ah);
        ctx.clip();
        // Each new slide fades in over 0.4 s, like the screens.
        ctx.globalAlpha *= k.fade ? ease((now - k.changedAt) / 400) : 1;
        if (slide.type === 'image') {
          const pic = this.picture(slide.path);
          if (pic) this.fit(pic, k.fit, aw, ah);
        } else {
          const inner = other(slide.sourceId);
          if (inner) this.drawSource(inner, event, now, aw, ah);
        }
        ctx.restore();
        return;
      }
      case 'split': {
        const ctx = this.ctx;
        ctx.fillStyle = k.background;
        ctx.fillRect(0, 0, w, h);
        for (const b of k.boxes) {
          const inner = this.show?.sources.find((x) => x.id === b.sourceId);
          const bx = (b.frame.x / 100) * w;
          const by = (b.frame.y / 100) * h;
          const bw = (b.frame.w / 100) * w;
          const bh = (b.frame.h / 100) * h;
          ctx.save();
          ctx.translate(bx, by);
          ctx.beginPath();
          ctx.rect(0, 0, bw, bh);
          ctx.clip();
          if (inner && inner.kind.type !== 'split') this.drawSource(inner, event, now, bw, bh);
          if (k.border) {
            ctx.strokeStyle = k.borderColor;
            ctx.lineWidth = Math.max(2, h / 540);
            ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, bw - ctx.lineWidth, bh - ctx.lineWidth);
          }
          ctx.restore();
        }
        return;
      }
      case 'image':
      case 'video':
      case 'camera': {
        const m = this.media.get(src.id);
        if (!m || m.failed) return this.safeScreen(event, 'failure', w, h);
        const smart = this.smartsAllowed && usesVision(src.background, src.autoFrame);
        if (src.kind.type === 'camera') fullResolution(`rec:${src.id}`, src.kind.deviceId, !!src.autoFrame?.enabled && !src.ptz);
        if (needsProcessing(src.key, src.adjust) || smart) {
          // Green screen, light and color, background and framing: on the graphics card, then draw the processed copy.
          const el = m.el;
          const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
          const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
          let keyer = this.keyers.get(src.id);
          if (!keyer) {
            keyer = new ChromaKeyer();
            this.keyers.set(src.id, keyer);
          }
          const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete;
          let smarts = null;
          if (smart && ready) {
            let v = this.visions.get(src.id);
            if (!v) {
              v = new InputVision();
              this.visions.set(src.id, v);
            }
            // A PTZ camera is steered instead (optical zoom): no digital zoom here.
            const digital = src.ptz ? { ...src.autoFrame, enabled: false } : src.autoFrame;
            v.update(el, iw, ih, src.background, digital, w);
            const set = src.background.mode === 'set' ? currentSet(src.background.set) : null;
            smarts = {
              mask: v.mask,
              bg: src.background,
              picture: set ? set.back : this.bgPicture(src.background.mode === 'picture' ? src.background.picture : null),
              front: set?.front ?? null,
              view: src.autoFrame.enabled && !src.ptz ? shotToView(v.shot) : null,
            };
          }
          if (keyer.works && ready && keyer.draw(el, iw, ih, src.key, src.adjust, 1920, smarts)) {
            this.fit(keyer.canvas, src.fit, w, h);
            return;
          }
        }
        const held = src.kind.type === 'camera' && m.el instanceof HTMLVideoElement ? this.delayed(src.id, m.el, src.videoDelayMs ?? 0) : null;
        this.fit(held ?? m.el, src.fit, w, h);
        return;
      }
    }
  }

  /** A picture to put behind people, loading it the first time. */
  private bgPicture(path: string | null | undefined): HTMLImageElement | null {
    if (!path) return null;
    let img = this.bgPictures.get(path);
    if (!img) {
      img = new Image();
      img.src = this.client.mediaUrl(path);
      this.bgPictures.set(path, img);
    }
    return img;
  }

  /** A camera held back (see FrameDelay); null when it isn't. */
  private delayed(id: string, el: HTMLVideoElement, ms: number): ImageBitmap | null {
    let d = this.delays.get(id);
    if (ms <= 0) {
      if (d) {
        d.dispose();
        this.delays.delete(id);
      }
      return null;
    }
    if (!d || d.el !== el) {
      d?.dispose();
      d = Object.assign(new FrameDelay(el, ms), { el });
      this.delays.set(id, d);
    }
    d.setDelay(ms);
    return d.frame();
  }

  /** Draw a picture filling the frame (contain: whole picture; cover: no bars). */
  /** The newest frame of a web page (and ask for the next one). */
  private pageFrame(id: string, needsCapture = true): ImageBitmap | null {
    if (!this.pageInfo) {
      void browserInfo(() => this.client.browserInfo()).then((i) => (this.pageInfo = i));
      return null;
    }
    const { port, captured } = this.pageInfo;
    if ((needsCapture && !captured) || !port) return null;
    let p = this.pages.get(id);
    if (!p) {
      p = { n: 0, frame: null, busy: false, seen: 0 };
      this.pages.set(id, p);
    }
    p.seen = performance.now();
    if (!p.busy) {
      const page = p;
      page.busy = true;
      void fetch(`http://127.0.0.1:${port}/frame/${encodeURIComponent(id)}?after=${page.n}`)
        .then(async (r) => {
          if (r.status !== 200) return;
          page.n = Number(r.headers.get('X-Frame') ?? page.n);
          const bmp = await createImageBitmap(await r.blob());
          page.frame?.close();
          page.frame = bmp;
        })
        .catch(() => undefined)
        .finally(() => (page.busy = false));
    }
    return p.frame;
  }

  /** This frame of the stage visuals (drawn once however many places show it). */
  private visualsFrame(now: number): HTMLCanvasElement | null {
    if (this.visuals === false || !this.show) return null;
    if (this.visuals === null) {
      const canvas = document.createElement('canvas');
      const r = makeRenderer(canvas);
      if (!r) {
        this.visuals = false;
        return null;
      }
      void document.fonts?.ready.then(() => r.refreshText());
      this.visuals = { canvas, r, player: new VisualsPlayer(), at: -1 };
    }
    const v = this.visuals;
    if (v.at !== now) {
      v.r.draw(v.player.frame(this.show.visuals, now), this.canvas.width, this.canvas.height);
      v.at = now;
    }
    return v.canvas;
  }

  private fit(el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap, fit: Source['fit'], w: number, h: number) {
    const iw = el instanceof HTMLVideoElement ? el.videoWidth : el instanceof HTMLImageElement ? el.naturalWidth : el.width;
    const ih = el instanceof HTMLVideoElement ? el.videoHeight : el instanceof HTMLImageElement ? el.naturalHeight : el.height;
    const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 : el instanceof HTMLImageElement ? el.complete : true;
    if (!ready || !iw || !ih) return;
    const scale = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    try {
      this.ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } catch {
      /* not decodable yet */
    }
  }

  /** What the audience sees instead of something broken, and during PANIC. */
  private safeScreen(event: EventInfo, reason: 'failure' | 'panic', w: number, h: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const choice = reason === 'panic' ? event.panicShows : event.onFailure;
    if (choice !== 'logo') return;
    // The event's logo, or Lumora's until it has one.
    const logo = this.picture(eventLogo(event));
    if (logo) this.centred(logo, w * 0.5, h * 0.5, w, h);
  }

  /** Draw a picture centered, no bigger than maxW × maxH. */
  private centred(el: HTMLImageElement, maxW: number, maxH: number, w: number, h: number, scale = 1) {
    if (!el.complete || !el.naturalWidth) return;
    const s = Math.min(maxW / el.naturalWidth, maxH / el.naturalHeight, 1) * scale;
    const dw = el.naturalWidth * s;
    const dh = el.naturalHeight * s;
    this.ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /** The countdown input (mirrors CountdownView and its CSS). */
  private countdown(timer: Countdown, background: string, logoPath: string | null, now: number, w: number, h: number) {
    const ctx = this.ctx;
    // Background: the color glowing from the middle into black.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / 2, h / 2);
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2 * 1.4);
    bg.addColorStop(0, background);
    bg.addColorStop(1, '#000');
    ctx.fillStyle = bg;
    ctx.fillRect(-1, -1, 2, 2);
    const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
    shade.addColorStop(0, 'rgba(0,0,0,0.55)');
    shade.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    shade.addColorStop(0.8, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();

    const left = countdownRemaining(timer, now);
    const done = countdownFinished(timer, now);
    const due = countdownDue(timer, now);
    const secs = Math.ceil(left / 1000);
    const final = timer.endsAt !== null && !done && secs <= 10;
    const sinceDue = timer.endsAt !== null ? now - (timer.endsAt + ZERO_HOLD_MS) : 0;
    const words = due && timer.atZero.type === 'showText';
    // The numbers fade out over 0.9 s once it is time.
    const numbersGone = !countdownVisible(timer, now) || words;
    const stackAlpha = numbersGone ? 1 - clamp01(sinceDue / 900) : 1;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    if (stackAlpha > 0) {
      ctx.globalAlpha = stackAlpha;
      let size = final ? Math.min(h * 0.5, w * 0.32) : Math.min(h * 0.34, w * 0.22);
      let alpha = 1;
      if (final) {
        // Each of the last ten seconds lands with a beat.
        const t = 1 - (left / 1000 - (secs - 1));
        const beat = t < 0.18 ? 1.25 - (0.25 * t) / 0.18 : 1 - (0.06 * (t - 0.18)) / 0.82;
        alpha = t < 0.18 ? 0.4 + (0.6 * t) / 0.18 : 1;
        size *= beat;
      } else if (done && timer.endsAt !== null) {
        const t = clamp01((now - timer.endsAt) / 600);
        size *= 1.3 - 0.3 * ease(t);
        alpha = ease(t);
      }
      const label = timer.label && !done ? timer.label.toUpperCase() : '';
      const labelSize = h * 0.06;
      const gap = h * 0.02;
      const total = (label ? labelSize + gap : 0) + size;
      const top = h / 2 - total / 2;
      if (label) {
        ctx.font = `700 ${labelSize}px ${FONT}`;
        this.spacing(labelSize * 0.35);
        ctx.globalAlpha = stackAlpha * 0.9;
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = h * 0.03;
        ctx.fillText(label, w / 2 + labelSize * 0.175, top + labelSize / 2);
      }
      ctx.font = `800 ${size}px ${FONT}`;
      this.spacing(0);
      ctx.globalAlpha = stackAlpha * alpha;
      ctx.shadowColor = final ? 'rgba(255,196,120,0.8)' : 'rgba(79,179,191,0.55)';
      ctx.shadowBlur = h * (final ? 0.06 : 0.04);
      ctx.fillText(formatCountdown(left, timer.format), w / 2, top + (label ? labelSize + gap : 0) + size / 2);
    }
    // After zero: the end words or the logo fade in (after half a second).
    const appear = ease((sinceDue - 500) / 1000);
    if (words && appear > 0) {
      ctx.globalAlpha = appear;
      ctx.font = `800 ${Math.min(h * 0.16, w * 0.1)}px ${FONT}`;
      ctx.shadowColor = 'rgba(79,179,191,0.55)';
      ctx.shadowBlur = h * 0.04;
      ctx.fillText(timer.endText, w / 2, h / 2);
    }
    if (due && (timer.atZero.type === 'hide' || timer.atZero.type === 'takeNext') && logoPath && appear > 0) {
      const logo = this.picture(logoPath);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = appear;
      if (logo) this.centred(logo, w * 0.6, h * 0.6, w, h, 0.92 + 0.08 * appear);
    }
    ctx.restore();
  }

  /** Credits (mirrors CreditsView): rolling, pages or a wall of names. */
  private credits(c: Credits, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const k = h / 1080;
    const { lineH, titleH, gap } = creditsMetrics(c);
    const font = (size: number, weight: number) => `${weight} ${size * k}px "${c.font}", "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    ctx.fillStyle = c.background;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.color;
    ctx.textBaseline = 'middle';
    const name = (line: string, cx: number, cy: number, size: number) => {
      const { name: n, role } = splitName(line);
      ctx.font = font(size, 600);
      const nw = ctx.measureText(n).width;
      ctx.font = font(size * 0.62, 400);
      const rw = role ? ctx.measureText(role).width + size * 0.4 * k : 0;
      const x = cx - (nw + rw) / 2;
      ctx.textAlign = 'left';
      ctx.font = font(size, 600);
      ctx.globalAlpha = 1;
      ctx.fillText(n, x, cy);
      if (role) {
        ctx.font = font(size * 0.62, 400);
        ctx.globalAlpha = 0.75;
        ctx.fillText(role, x + nw + size * 0.4 * k, cy);
        ctx.globalAlpha = 1;
      }
    };
    const title = (top: number) => {
      if (!c.title) return;
      ctx.font = font(c.size * 1.8, 700);
      ctx.textAlign = 'center';
      ctx.fillText(c.title, w / 2, top + (titleH * k) / 2);
    };
    if (c.mode === 'roll') {
      const top = h - rollOffset(c, now) * k;
      title(top);
      c.names.forEach((n, i) => {
        const cy = top + (titleH + gap + i * lineH + lineH / 2) * k;
        if (cy > -lineH * k && cy < h + lineH * k) name(n, w / 2, cy, c.size);
      });
    } else if (c.mode === 'pages') {
      const { perPage, page } = creditsPage(c, now);
      const list = c.names.slice(page * perPage, (page + 1) * perPage);
      const top = (h - (titleH + gap + list.length * lineH) * k) / 2;
      title(top);
      list.forEach((n, i) => name(n, w / 2, top + (titleH + gap + i * lineH + lineH / 2) * k, c.size));
    } else {
      const { cols, size } = wallLayout(c);
      const rows = Math.ceil(c.names.length / cols);
      const rowH = size * 1.4;
      const top = (h - (titleH + gap + rows * rowH) * k) / 2;
      title(top);
      const colW = (w * 0.9) / cols;
      // Row by row, like the screens' grid.
      c.names.forEach((n, i) => name(n, w * 0.05 + colW * (i % cols) + colW / 2, top + (titleH + gap + Math.floor(i / cols) * rowH + rowH / 2) * k, size));
    }
    ctx.restore();
  }

  /** A text input (mirrors TextView and its CSS): transparent except the text and its box. */
  private textRect: { x: number; y: number; w: number; h: number } | null = null;

  /** A text input, with the effect it comes on with (and the shine's light). */
  private text(input: TextInput, now: number, w: number, h: number, start = now - 10_000) {
    const st = input.style;
    const entrance = st.animate ? (st.entrance ?? 'build') : 'none';
    const letters = [...(input.text + input.sub)].length;
    const fx = entrance === 'build' || input.layout === 'ticker' ? null : effectAt(entrance, now - start, letters);
    this.textRect = null;
    this.textBody(input, now, w, h, start, fx);
    const r = this.textRect as { x: number; y: number; w: number; h: number } | null;
    if (fx?.shine != null && r) {
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      const bandW = r.w * 0.45;
      const bx = r.x + (fx.shine * 1.6 - 0.6) * r.w;
      const g = ctx.createLinearGradient(bx, 0, bx + bandW, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(bx, r.y, bandW, r.h);
      ctx.restore();
    }
  }

  private textBody(input: TextInput, now: number, w: number, h: number, start: number, fx: EffectState | null) {
    const ctx = this.ctx;
    const t = textShown(input);
    const s = t.style;
    const k = h / 1080;
    const rtl = isRtl(t.text + t.sub);
    const subSize = (s.size * (s.subSize || 60)) / 100;
    // The second line may have its own font and color.
    const font = (size: number, weight: number, second = false) =>
      `${s.italic ? 'italic ' : ''}${weight} ${size * k}px "${second && s.subFont ? s.subFont : s.font}", "Segoe UI", system-ui, sans-serif`;
    // How see-through the whole title is (an overlay's opacity, the entrance).
    let baseAlpha = ctx.globalAlpha;
    const lineH = s.size * s.lineHeight * k;
    const subH = subSize * s.lineHeight * k;
    const pad = s.boxOn ? s.padding * k : 0;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    this.spacing(s.letterSpacing * k);
    const paint = (str: string, x: number, y: number, size: number, weight: number, alpha = 1) => {
      const second = !!t.sub && str === t.sub && str !== t.text;
      ctx.font = font(size, weight, second);
      ctx.globalAlpha = baseAlpha * alpha;
      ctx.shadowColor = s.shadow ? 'rgba(0,0,0,0.6)' : 'transparent';
      ctx.shadowBlur = s.shadow ? 12 * k : 0;
      ctx.shadowOffsetY = s.shadow ? 3 * k : 0;
      if (s.outline > 0) {
        ctx.lineWidth = s.outline * 2 * k;
        ctx.strokeStyle = s.outlineColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(str, x, y);
      }
      ctx.fillStyle = second && s.subColor ? s.subColor : s.color;
      ctx.fillText(str, x, y);
    };
    const box = (x: number, y: number, bw: number, bh: number, radius: number) => {
      if (!s.boxOn) return;
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = withAlpha(s.boxColor, s.boxOpacity);
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, radius);
      ctx.fill();
      ctx.restore();
    };

    if (t.layout === 'ticker') {
      const line = [t.text, t.sub].filter(Boolean).join('   ·   ');
      ctx.font = font(s.size, s.weight);
      const tw = ctx.measureText(line).width;
      const barH = lineH + 2 * s.padding * k;
      const top = h * 0.96 - barH;
      box(0, top, w, barH, 0);
      // Moving along at `speed` px a second, starting just off screen.
      const travel = ((now / 1000) * s.speed * k) % (tw + w);
      ctx.textAlign = 'left';
      ctx.direction = 'ltr';
      const x = rtl ? -tw + travel : w - travel;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, w, barH);
      ctx.clip();
      paint(line, x, top + barH / 2, s.size, s.weight);
      ctx.restore();
      ctx.restore();
      return;
    }

    // The design's own build (the other effects move the whole title, below).
    const b = buildAt(now - start, fx === null);
    const d = s.design ?? 'box';
    const accent = s.accent ?? '#2f80ed';
    const end = s.align === 'right';
    ctx.font = font(s.size, s.weight);
    const mainW = ctx.measureText(t.text).width;
    ctx.font = font(subSize, Math.max(300, s.weight - 200), true);
    const subW = t.sub ? ctx.measureText(t.sub).width : 0;
    const r = s.radius * k;
    // Where a block of size bw × bh goes for this layout.
    const place = (bw: number, bh: number) => {
      if (t.layout === 'lowerThird') {
        const side = (s.x ?? 5) / 100;
        const x = s.align === 'center' ? (w - bw) / 2 : end ? w * (1 - side) - bw : w * side;
        return { x, y: h * (1 - (s.y ?? 10) / 100) - bh };
      }
      return { x: (w - bw) / 2, y: (h - bh) / 2 };
    };
    // The effect it comes on with, about the whole title (its size worked out
    // before drawing, as the screens' CSS does).
    {
      const bwA = Math.max(mainW, subW) + 2 * s.padding * k + (d === 'bar' ? 10 * k : 0);
      const bhA = lineH + (t.sub ? subSize * s.lineHeight * k : 0) + 2 * s.padding * k;
      const { x: bx0, y: by0 } = place(bwA, bhA);
      this.textRect = { x: bx0, y: by0, w: bwA, h: bhA };
      if (fx) {
        const dir = end ? -1 : 1;
        const cx = bx0 + bwA / 2;
        const cy = by0 + bhA / 2;
        baseAlpha *= fx.alpha;
        ctx.globalAlpha = baseAlpha;
        ctx.translate(fx.dx * dir * w, fx.dy * h);
        if (fx.scale !== 1 || fx.scaleY !== 1 || fx.rotate) {
          ctx.translate(cx, cy);
          if (fx.rotate) ctx.rotate((fx.rotate * dir * Math.PI) / 180);
          ctx.scale(fx.scale, fx.scale * fx.scaleY);
          ctx.translate(-cx, -cy);
        }
        if (fx.blur) ctx.filter = `blur(${fx.blur * h}px)`;
        if (fx.reveal < 1) {
          ctx.beginPath();
          if (end) ctx.rect(bx0 + bwA * (1 - fx.reveal), 0, w, h);
          else ctx.rect(0, 0, bx0 + bwA * fx.reveal, h);
          ctx.clip();
        }
      }
    }
    // Reveal a box from its start side as it opens.
    const opened = (x: number, y: number, bw: number, bh: number, p: number) => {
      ctx.beginPath();
      if (end) ctx.rect(x + bw * (1 - p), y, bw * p, bh);
      else ctx.rect(x, y, bw * p, bh);
      ctx.clip();
    };
    const fillBox = (x: number, y: number, bw: number, bh: number, style: string | CanvasGradient) => {
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, r);
      ctx.fill();
      if (s.border) {
        // A line around the box, inside its edge (like the screens' CSS border).
        const lw = s.border * k;
        ctx.lineWidth = lw;
        ctx.strokeStyle = s.borderColor;
        ctx.beginPath();
        ctx.roundRect(x + lw / 2, y + lw / 2, bw - lw, bh - lw, Math.max(0, r - lw / 2));
        ctx.stroke();
      }
      ctx.restore();
    };
    // The words rise in (40% of a line) and fade up.
    const words = (str: string, x: number, y: number, size: number, weight: number, alpha: number, p: number, lh: number) => {
      if (p <= 0) return;
      paint(str, x, y + 0.4 * lh * (1 - p), size, weight, alpha * p);
    };
    const ax = (x: number, bw: number, padL: number, padR: number) => (s.align === 'center' ? x + (padL + bw - padR) / 2 : end ? x + bw - padR : x + padL);
    ctx.textAlign = s.align;

    if (d === 'split') {
      const p = s.padding * k;
      const spx = s.padding * 0.8 * k;
      const spy = s.padding * 0.45 * k;
      const mw = mainW + 2 * p;
      const mh = lineH + 2 * p;
      const sw = subW + 2 * spx;
      const sh = t.sub ? subH + 2 * spy : 0;
      const whole = place(Math.max(mw, sw), mh + sh);
      const mx = s.align === 'center' ? whole.x + (Math.max(mw, sw) - mw) / 2 : end ? whole.x + Math.max(mw, sw) - mw : whole.x;
      const sx = s.align === 'center' ? whole.x + (Math.max(mw, sw) - sw) / 2 : end ? whole.x + Math.max(mw, sw) - sw : whole.x;
      ctx.save();
      opened(mx, whole.y, mw, mh, b.box);
      fillBox(mx, whole.y, mw, mh, accent);
      words(t.text, ax(mx, mw, p, p), whole.y + p + lineH / 2, s.size, s.weight, 1, b.text, lineH);
      ctx.restore();
      if (t.sub) {
        const sy = whole.y + mh;
        ctx.save();
        opened(sx, sy, sw, sh, b.subBox);
        fillBox(sx, sy, sw, sh, withAlpha(s.boxColor, s.boxOpacity));
        words(t.sub, ax(sx, sw, spx, spx), sy + spy + subH / 2, subSize, Math.max(300, s.weight - 200), 0.9, b.sub, subH);
        ctx.restore();
      }
      ctx.restore();
      return;
    }

    if (d === 'underline') {
      const lh = 6 * k;
      const gap = 10 * k;
      const cw = Math.max(mainW, subW);
      const ch = lineH + lh + 2 * gap + (t.sub ? subH : 0);
      const { x, y } = place(cw, ch);
      words(t.text, ax(x, cw, 0, 0), y + lineH / 2, s.size, s.weight, 1, b.text, lineH);
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = accent;
      const lw = cw * b.line;
      ctx.fillRect(end ? x + cw - lw : x, y + lineH + gap, lw, lh);
      ctx.restore();
      if (t.sub) words(t.sub, ax(x, cw, 0, 0), y + lineH + lh + 2 * gap + subH / 2, subSize, Math.max(300, s.weight - 200), 0.9, b.sub, subH);
      ctx.restore();
      return;
    }

    // Box, bar, gradient and glass: one box behind both lines.
    const framed = d === 'glass' || d === 'gradient';
    const p = framed || s.boxOn ? s.padding * k : 0;
    const bar = d === 'bar' ? 10 * k : 0;
    const padL = p + (end ? 0 : bar);
    const padR = p + (end ? bar : 0);
    const contentW = Math.max(mainW, subW);
    const bw = contentW + padL + padR;
    const bh = lineH + (t.sub ? subH : 0) + 2 * p;
    const { x: bx, y: by } = place(bw, bh);
    ctx.save();
    opened(bx, by, bw, bh, b.box);
    if (d === 'gradient') {
      const g = ctx.createLinearGradient(end ? bx + bw : bx, 0, end ? bx + bw - bw * 0.75 : bx + bw * 0.75, 0);
      g.addColorStop(0, accent);
      g.addColorStop(1, withAlpha(s.boxColor, s.boxOpacity));
      fillBox(bx, by, bw, bh, g);
    } else if (d === 'glass') {
      fillBox(bx, by, bw, bh, 'rgba(255,255,255,0.14)');
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, r);
      ctx.stroke();
      ctx.restore();
    } else if (s.boxOn) fillBox(bx, by, bw, bh, withAlpha(s.boxColor, s.boxOpacity));
    const tx = ax(bx, bw, padL, padR);
    words(t.text, tx, by + p + lineH / 2, s.size, s.weight, 1, b.text, lineH);
    if (t.sub) words(t.sub, tx, by + p + lineH + subH / 2, subSize, Math.max(300, s.weight - 200), 0.9, b.sub, subH);
    ctx.restore();
    if (bar) {
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = accent;
      const barH = bh * b.bar;
      ctx.fillRect(end ? bx + bw - bar : bx, by + bh - barH, bar, barH);
      ctx.restore();
    }
    ctx.restore();
  }

  /** One overlay channel in its box, with its animation (mirrors OverlaysView). */
  private drawOverlay(o: Overlay, show: Show, now: number, w: number, h: number) {
    const src = show.sources.find((s) => s.id === o.sourceId);
    const look = overlayLook(o, now);
    if (!src || !look || look.opacity <= 0) return;
    const ctx = this.ctx;
    const bw = (o.frame.w / 100) * w;
    const bh = (o.frame.h / 100) * h;
    ctx.save();
    ctx.globalAlpha = clamp01(look.opacity);
    ctx.translate((o.frame.x / 100) * w + look.dx * bw, (o.frame.y / 100) * h + look.dy * bh);
    if (look.scale !== 1) {
      ctx.translate(bw / 2, bh / 2);
      ctx.scale(look.scale, look.scale);
      ctx.translate(-bw / 2, -bh / 2);
    }
    ctx.beginPath();
    ctx.rect(0, 0, bw * look.reveal, bh);
    ctx.clip();
    // What it shows can have its own entrance (the Pesukim bar), from when it came on.
    this.onSince = o.changedAt;
    this.drawSource(src, show.event, now, bw, bh);
    this.onSince = null;
    ctx.restore();
  }

  /** The 12 Pesukim input (mirrors PesukimView and its CSS). */
  private pesukim(data: PesukimData, event: EventInfo, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const { look, place } = data;
    const bar = look.mode === 'bar';
    if (!bar) {
      ctx.fillStyle = look.background;
      ctx.fillRect(0, 0, w, h);
    }
    const behind = look.behind ? this.show?.sources.find((s) => s.id === look.behind) : undefined;
    if (behind && behind.kind.type !== 'pesukim') this.drawSource(behind, event, now, w, h);
    if (bar) {
      this.pesukimBar(data, now, w, h);
      return;
    }

    const pasuk = data.pesukim[place.pasuk];
    const words = wordsOf(pasuk?.text ?? '');
    const { text, whole } = shownText(data);
    const strip = look.mode === 'strip' && !place.whole && !place.blank && words.length > 0;
    const font = `"${look.font}", "Frank Ruhl Libre", serif`;
    const rtl = (t: string) => /[\u0590-\u05FF]/.test(t);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = h * 0.03;
    ctx.shadowOffsetY = h * 0.006;
    if (place.intro && pasuk && !place.blank) {
      ctx.fillStyle = look.textColor;
      this.pesukimIntro(place.pasuk + 1, pasuk.child, (look.size * 0.6 * h) / 100, w / 2, h / 2, now - place.changedAt);
      ctx.restore();
      return;
    }
    if (text) {
      // Each new word makes its entrance (fade or pop), like the screens.
      const t = clamp01((now - place.changedAt) / (look.wordChange === 'pop' ? 350 : 280));
      const alpha = look.wordChange === 'cut' ? 1 : ease(t);
      const scale = look.wordChange === 'pop' ? 0.82 + 0.18 * ease(t) : 1;
      const size = ((whole ? look.size * 0.42 : look.size) / 100) * h;
      ctx.font = `700 ${size}px ${font}`;
      ctx.fillStyle = look.textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = rtl(text) ? 'rtl' : 'ltr';
      const lines = this.wrap(text, w * 0.9);
      const lineH = size * 1.25;
      const areaH = strip ? h * 0.8 : h;
      const top = areaH / 2 - ((lines.length - 1) * lineH) / 2;
      ctx.globalAlpha = alpha;
      ctx.translate(w / 2, areaH / 2);
      ctx.scale(scale, scale);
      ctx.translate(-w / 2, -areaH / 2);
      lines.forEach((line, i) => ctx.fillText(line, w / 2, top + i * lineH));
      // How the word sounds and what it means, under it.
      const said = soundAndMeaning(data, whole);
      const tr = look.showTranslit ? said.sound : '';
      const en = look.showEnglish ? said.meaning : '';
      const small = whole ? 0.5 : 1;
      let y = top + (lines.length - 1) * lineH + size * 0.62;
      ctx.direction = 'ltr';
      ctx.textBaseline = 'top';
      if (tr) {
        const ts = (look.size * 0.3 * small * h) / 100;
        ctx.font = `italic 600 ${ts}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        y += h * 0.015;
        for (const l of this.wrap(tr, w * 0.9)) {
          ctx.fillText(l, w / 2, y);
          y += ts * 1.25;
        }
      }
      if (en) {
        const es = (look.size * 0.24 * small * h) / 100;
        ctx.font = `500 ${es}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        y += h * 0.006;
        for (const l of this.wrap(en, w * 0.9)) {
          ctx.fillText(l, w / 2, y);
          y += es * 1.25;
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (strip) this.pesukimStrip(words, place.word, look.textColor, font, w, h);
  }

  /** "Pasuk 3" and the child's name, centered on (x, y). */
  private pesukimIntro(n: number, child: string, big: number, x: number, y: number, since: number) {
    const ctx = this.ctx;
    const t = ease(clamp01(since / 400));
    ctx.save();
    ctx.globalAlpha *= t;
    ctx.translate(x, y);
    ctx.scale(0.82 + 0.18 * t, 0.82 + 0.18 * t);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = isRtl(child) ? 'rtl' : 'ltr';
    const small = big * 0.45;
    const total = small * 1.15 + big * 1.15;
    ctx.font = `600 ${small}px "Segoe UI", system-ui, sans-serif`;
    ctx.globalAlpha *= 0.8;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${small * 0.12}px`;
    ctx.fillText(`PASUK ${n}`, 0, -total / 2 + (small * 1.15) / 2);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.globalAlpha /= 0.8;
    ctx.font = `800 ${big}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(child, 0, total / 2 - (big * 1.15) / 2);
    ctx.restore();
  }

  /** The bar along the bottom (mirrors PesukimView's PesukimBar and its CSS). */
  /** When the overlay being drawn came on (for its content's own entrance). */
  private onSince: number | null = null;

  /** Apply an effect's move, size, turn and blur about (cx, cy). */
  private applyEffect(fx: EffectState, cx: number, cy: number, w: number, h: number) {
    const ctx = this.ctx;
    ctx.globalAlpha *= fx.alpha;
    ctx.translate(fx.dx * w, fx.dy * h);
    if (fx.scale !== 1 || fx.scaleY !== 1 || fx.rotate) {
      ctx.translate(cx, cy);
      if (fx.rotate) ctx.rotate((fx.rotate * Math.PI) / 180);
      ctx.scale(fx.scale, fx.scale * fx.scaleY);
      ctx.translate(-cx, -cy);
    }
    if (fx.blur) ctx.filter = `blur(${fx.blur * h}px)`;
  }

  private pesukimBar(data: PesukimData, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const { look, place } = data;
    const pasuk = data.pesukim[place.pasuk];
    const he = wordsOf(pasuk?.text ?? '');
    if (!pasuk || (!he.length && !place.intro)) return;
    // Hide fades the bar out, and showing it again fades it in (like the screens).
    if (!this.pesukimHide || this.pesukimHide.blank !== place.blank) this.pesukimHide = { blank: place.blank, at: this.pesukimHide ? place.changedAt : 0 };
    const hideT = clamp01((now - this.pesukimHide.at) / 350);
    const shown = place.blank ? 1 - hideT : this.pesukimHide.at ? hideT : 1;
    if (shown <= 0) return;
    const u = h / 100;
    const d = barDesign(look.design);
    const L = barLayout(look);
    const x = L.left * u;
    const bw = w - (L.left + L.right) * u;
    // The whole pasuk needs a taller bar (as tall as its lines, like the screens).
    const bh = (place.whole && !place.intro ? wholeLayout(pasuk, look).h : L.h) * u;
    const y = h - L.bottom * u - bh;
    const img = look.barImage && !look.plain ? this.picture(look.barImage) : null;
    const pic = !!look.barImage && !look.plain;
    // No background: just the words, outlined in the second color.
    const bare = look.plain || (!pic && d.id === 'none');
    ctx.save();
    ctx.globalAlpha *= shown;
    // How the bar comes on.
    const barFx = effectAt(look.barIn ?? 'rise', now - (this.onSince ?? now - 10_000));
    this.applyEffect(barFx, x + bw / 2, y + bh / 2, w, h);
    if (barFx.reveal < 1) {
      ctx.beginPath();
      ctx.rect(0, 0, x + bw * barFx.reveal, h);
      ctx.clip();
    }
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, d.radius * u);
    if (pic) {
      ctx.clip();
      if (img?.complete && img.naturalWidth) ctx.drawImage(img, x, y, bw, bh);
    } else if (bare) {
      // Nothing behind the words.
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 4 * u;
      ctx.shadowOffsetY = u;
      const g = ctx.createLinearGradient(0, y, 0, y + bh);
      g.addColorStop(0, d.top);
      g.addColorStop(1, d.bottom);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      ctx.fillStyle = d.edge;
      if (d.frame) {
        ctx.lineWidth = 0.7 * u;
        ctx.strokeStyle = d.edge;
        ctx.stroke();
      } else ctx.fillRect(x, y, bw, 0.5 * u);
      // The pasuk's number in a circle, at the Hebrew end (when chosen).
      if (look.showNumber) {
        const r = (L.badge * u) / 2;
        const cx = x + bw - 2.2 * u - r;
        ctx.beginPath();
        ctx.arc(cx, y + bh / 2, r, 0, Math.PI * 2);
        ctx.fillStyle = d.badge;
        ctx.fill();
        ctx.fillStyle = d.badgeText;
        ctx.font = `800 ${4.4 * u}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(place.pasuk + 1), cx, y + bh / 2);
      }
    }
    const left = x + 3 * u;
    const right = x + bw - (bare || !look.showNumber ? 3 : 13) * u;
    const mid = (left + right) / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 0.8 * u;
    ctx.shadowOffsetY = 0.2 * u;
    ctx.fillStyle = '#fff';
    // The word going away fades while the new one comes on (no blink). With
    // the whole line showing, only a new line comes on; the lit word just moves.
    const [from0] = barRange(data);
    const oneWord = look.barWords !== 'line' && !place.whole;
    const key = `${place.pasuk}:${oneWord ? place.word : from0}:${place.intro}:${place.whole}`;
    const slot = this.pesukimSlot;
    if (!slot || slot.key !== key) this.pesukimSlot = { key, place, since: place.changedAt, before: slot?.place ?? null };
    const cur = this.pesukimSlot!;
    const g = { x, y, bw, bh, u, left, right, mid, bare, L };
    const kind = wordEffect(look.wordChange);
    const out = cur.before && kind !== 'none' ? Math.max(0, 1 - (now - cur.since) / WORD_OUT_MS) : 0;
    if (out > 0 && cur.before) {
      ctx.save();
      ctx.globalAlpha *= out;
      this.pesukimWords(data, cur.before, null, now, g, w, h);
      ctx.restore();
    }
    const letters = [...(he[place.word] ?? '')].length || 6;
    this.pesukimWords(data, place, effectAt(kind, (now - cur.since) / WORD_SPEED, letters), now, g, w, h);
    ctx.restore();
  }

  /** When the Pesukim words were last hidden or shown (for the fade). */
  private pesukimHide: { blank: boolean; at: number } | null = null;

  /** The last Pesukim word shown (for the fade between words). */
  private pesukimSlot: { key: string; place: PesukimData['place']; since: number; before: PesukimData['place'] | null } | null = null;

  /** The bar's words for a moment of the pasuk, with its effect (mirrors PesukimView). */
  private pesukimWords(
    data: PesukimData,
    place: PesukimData['place'],
    wordFx: EffectState | null,
    now: number,
    g: { x: number; y: number; bw: number; bh: number; u: number; left: number; right: number; mid: number; bare: boolean; L: ReturnType<typeof barLayout> },
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    const { look } = data;
    const { x, y, bw, bh, u, left, right, mid, bare, L } = g;
    const pasuk = data.pesukim[place.pasuk];
    if (!pasuk) return;
    const he = wordsOf(pasuk.text);
    ctx.save();
    if (place.intro) {
      this.pesukimIntro(place.pasuk + 1, pasuk.child, 7.2 * u, mid, y + bh / 2, wordFx ? now - place.changedAt : 10_000);
      ctx.restore();
      return;
    }
    if (place.whole) {
      if (wordFx) this.applyEffect(wordFx, x + bw / 2, y + bh / 2, w, h);
      this.pesukimWhole(data, pasuk, g);
      ctx.restore();
      return;
    }
    const [from, to] = barRange({ ...data, place });
    if (wordFx) this.applyEffect(wordFx, x + bw / 2, y + bh / 2, w, h);
    // First line: how it sounds and the Hebrew, side by side; the English under them.
    type Group = { words: string[]; font: string; size: number; rtl: boolean };
    const heG: Group = { words: he, font: `700 ${L.he * u}px "${look.font}", "Frank Ruhl Libre", serif`, size: L.he, rtl: true };
    const tr = wordsOf(pasuk.translit);
    const en = glossesOf(pasuk.english);
    const lines: Group[][] = [
      look.showTranslit && tr.length ? [{ words: tr, font: `italic 600 ${L.tr * u}px "Segoe UI", system-ui, sans-serif`, size: L.tr, rtl: false }, heG] : [heG],
    ];
    if (look.showEnglish && en.length) lines.push([{ words: en, font: `500 ${L.en * u}px "Segoe UI", system-ui, sans-serif`, size: L.en, rtl: false }]);
    const lineH = (line: Group[]) => Math.max(...line.map((g) => g.size)) * 1.3 * u;
    const total = lines.reduce((n, l) => n + lineH(l), 0) + (lines.length - 1) * 0.2 * u;
    let top = y + bh / 2 - total / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    // Room between how it sounds and the Hebrew (no line between them).
    const sep = 8 * u;
    const measure = (g: Group) => {
      ctx.font = g.font;
      const gap = g.size * u * 0.8;
      const items = g.words
        .slice(from, to)
        .map((t, j) => ({ t, i: from + j, ww: t ? ctx.measureText(t).width : 0 }))
        .filter((it) => it.t);
      return { g, gap, items, width: items.reduce((n, it) => n + it.ww, 0) + gap * Math.max(0, items.length - 1) };
    };
    const laid = lines.map((line) => {
      const groups = line.map(measure).filter((m) => m.items.length);
      return { line, groups, width: groups.reduce((n, m) => n + m.width, 0) + sep * Math.max(0, groups.length - 1) };
    });
    if (wordFx && wordFx.reveal < 1) {
      // Letter by letter, across the words themselves (Hebrew from the right).
      const widest = Math.max(0, ...laid.map((l) => l.width));
      const r0 = mid + widest / 2;
      ctx.beginPath();
      ctx.rect(r0 - widest * wordFx.reveal, 0, widest * wordFx.reveal + 2 * u, h);
      ctx.clip();
    }
    for (const l of laid) {
      // Too wide for the bar: squeeze to fit.
      const room = right - left;
      const squeeze = l.width > room ? room / l.width : 1;
      const cy = top + lineH(l.line) / 2;
      ctx.save();
      ctx.translate(mid, cy);
      ctx.scale(squeeze, 1);
      let gx = -l.width / 2;
      l.groups.forEach((m) => {
        ctx.font = m.g.font;
        ctx.direction = m.g.rtl ? 'rtl' : 'ltr';
        let cx = m.g.rtl ? gx + m.width : gx;
        for (const it of m.items) {
          if (m.g.rtl) cx -= it.ww;
          ctx.fillStyle =
            place.whole || it.i < place.word
              ? 'rgba(255,255,255,0.95)'
              : it.i === place.word
                ? look.textColor
                : bare
                  ? 'rgba(255,255,255,0.75)'
                  : 'rgba(255,255,255,0.5)';
          if (bare) {
            ctx.save();
            ctx.lineWidth = 1.1 * u;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = look.outlineColor;
            ctx.strokeText(it.t, cx, 0);
            ctx.restore();
          }
          ctx.fillText(it.t, cx, 0);
          if (m.g.rtl) cx -= m.gap;
          else cx += it.ww + m.gap;
        }
        gx += m.width + sep;
      });
      ctx.restore();
      top += lineH(l.line) + 0.2 * u;
    }
    ctx.restore();
  }

  /** The whole pasuk along the bottom, the word being said lit. */
  private pesukimStrip(words: string[], current: number, color: string, font: string, w: number, h: number) {
    const ctx = this.ctx;
    const size = h * 0.054;
    const gap = w * 0.022;
    ctx.save();
    ctx.font = `700 ${size}px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    const widths = words.map((x) => ctx.measureText(x).width);
    // Lay the words out in lines, right to left for Hebrew.
    const lines: number[][] = [[]];
    let used = 0;
    widths.forEach((ww, i) => {
      const line = lines[lines.length - 1]!;
      if (line.length && used + gap + ww > w * 0.92) {
        lines.push([i]);
        used = ww;
      } else {
        used += (line.length ? gap : 0) + ww;
        line.push(i);
      }
    });
    const lineH = size * 1.3;
    const barH = Math.max(h * 0.16, lines.length * lineH + h * 0.04);
    ctx.fillStyle = 'rgba(6,8,14,0.78)';
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = color;
    ctx.fillRect(0, h - barH, w, h * 0.004);
    const rtl = words.some((x) => /[\u0590-\u05FF]/.test(x));
    lines.forEach((line, li) => {
      const total = line.reduce((n, i) => n + widths[i]!, 0) + gap * (line.length - 1);
      let x = rtl ? w / 2 + total / 2 : w / 2 - total / 2;
      const y = h - barH / 2 - ((lines.length - 1) * lineH) / 2 + li * lineH;
      for (const i of line) {
        const ww = widths[i]!;
        if (rtl) x -= ww;
        ctx.fillStyle = i === current ? color : i < current ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
        ctx.fillText(words[i]!, x, y);
        if (rtl) x -= gap;
        else x += ww + gap;
      }
    });
    ctx.restore();
  }

  /** The whole pasuk in the bar: the Hebrew, how it sounds and the translation, wrapped (mirrors PesukimView). */
  private pesukimWhole(
    data: PesukimData,
    pasuk: PesukimData['pesukim'][number],
    g: { y: number; bh: number; u: number; left: number; right: number; mid: number; bare: boolean },
  ) {
    const ctx = this.ctx;
    const { look } = data;
    const { y, bh, u, left, right, mid, bare } = g;
    const W = wholeLayout(pasuk, look);
    const max = right - left - 8 * u;
    const parts: { lines: string[]; font: string; lineH: number; rtl: boolean }[] = [];
    const add = (text: string, font: string, size: number, lh: number, rtl: boolean) => {
      if (!text) return;
      ctx.font = font;
      parts.push({ lines: this.wrap(text, max), font, lineH: size * lh * u, rtl });
    };
    add(W.he, `700 ${W.heSize * u}px "${look.font}", "Frank Ruhl Libre", serif`, W.heSize, 1.22, true);
    add(W.tr, `italic 600 ${W.small * u}px "Segoe UI", system-ui, sans-serif`, W.small, 1.3, false);
    add(W.en, `500 ${W.small * u}px "Segoe UI", system-ui, sans-serif`, W.small, 1.3, false);
    const gap = 0.8 * u;
    const total = parts.reduce((n, p) => n + p.lines.length * p.lineH, 0) + gap * Math.max(0, parts.length - 1);
    let top = y + bh / 2 - total / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of parts) {
      ctx.font = p.font;
      ctx.direction = p.rtl ? 'rtl' : 'ltr';
      for (const line of p.lines) {
        const cy = top + p.lineH / 2;
        if (bare) {
          ctx.save();
          ctx.lineWidth = 0.8 * u;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = look.outlineColor;
          ctx.strokeText(line, mid, cy);
          ctx.restore();
        }
        ctx.fillStyle = p.rtl ? '#fff' : 'rgba(255,255,255,0.9)';
        ctx.fillText(line, mid, cy);
        top += p.lineH;
      }
      top += gap;
    }
    ctx.direction = 'ltr';
  }

  /** Break text into lines no wider than `max` (with the current font). */
  private wrap(text: string, max: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.ctx.measureText(next).width > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  private spacing(px: number) {
    const c = this.ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
  }

  // ---- media ----

  /** Open what is on air or next, and let go of the rest. */
  private keep(show: Show, ids: (string | null)[]) {
    const wanted = new Set(ids.filter((x): x is string => x !== null));
    const now = performance.now();
    for (const [id, m] of this.media) {
      const src = show.sources.find((s) => s.id === id);
      // A camera that failed is opened again every few seconds (it may be free again).
      if (m.failed && src?.kind.type === 'camera') {
        m.retryAt ??= now + 3000;
        if (now >= m.retryAt) {
          this.drop(m);
          this.media.delete(id);
          continue;
        }
      }
      if (!wanted.has(id) || !src || mediaKey(src) !== m.key) {
        this.drop(m);
        this.media.delete(id);
      }
    }
    for (const id of wanted) {
      if (this.media.has(id)) continue;
      const src = show.sources.find((s) => s.id === id);
      const m = src && this.open(src);
      if (m) this.media.set(id, m);
    }
  }

  private open(src: Source): Media | null {
    const k = src.kind;
    const key = mediaKey(src);
    if (k.type === 'image') return this.image(key, this.client.mediaUrl(k.path));
    if (k.type === 'video') {
      const el = document.createElement('video');
      const m: Media = { key, el, failed: false };
      // Same-origin rules: without this the recording would refuse the picture.
      el.crossOrigin = 'anonymous';
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.onerror = () => (m.failed = true);
      el.src = this.client.mediaUrl(k.path);
      return m;
    }
    if (k.type === 'camera') {
      const el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      const m: Media = {
        key,
        el,
        failed: false,
        release: () => releaseCamera(k.deviceId),
      };
      if (!navigator.mediaDevices?.getUserMedia) {
        m.failed = true;
        return m;
      }
      acquireCamera(k.deviceId).then(
        (stream) => {
          const tracks = stream.getVideoTracks();
          tracks.forEach((t) =>
            t.addEventListener('ended', () => {
              m.failed = true;
            }),
          );
          el.srcObject = stream;
          void el.play().catch(() => {});
        },
        () => (m.failed = true),
      );
      return m;
    }
    return null;
  }

  private image(key: string, url: string): Media {
    const el = new Image();
    const m: Media = { key, el, failed: false };
    el.crossOrigin = 'anonymous';
    el.onerror = () => (m.failed = true);
    el.src = url;
    return m;
  }

  /** A picture by file path (event logo, countdown logo), kept while used. */
  private picture(path: string): HTMLImageElement | null {
    let m = this.pictures.get(path);
    if (!m) {
      m = this.image(path, this.client.mediaUrl(path));
      this.pictures.set(path, m);
    }
    return m.failed ? null : (m.el as HTMLImageElement);
  }

  private drop(m: Media) {
    if (m.el instanceof HTMLVideoElement) {
      m.el.pause();
      m.el.removeAttribute('src');
      m.el.srcObject = null;
      m.el.load();
    }
    m.release?.();
  }
}

/** What a source's picture comes from; a change means opening it again. */
function mediaKey(src: Source): string {
  const k = src.kind;
  switch (k.type) {
    case 'video':
    case 'image':
      return `${k.type}:${k.path}`;
    case 'camera':
      return `camera:${k.deviceId}`;
    default:
      return k.type;
  }
}

/** The outline of a transition's shape, in pixels. */
export function shapePath(ctx: CanvasRenderingContext2D, s: Shape, w: number, h: number): void {
  switch (s.type) {
    case 'rect':
      ctx.rect(s.l * w, s.t * h, w * (1 - s.l - s.r), h * (1 - s.t - s.b));
      return;
    case 'circle':
      ctx.arc(w / 2, h / 2, (s.r * Math.hypot(w, h)) / 2, 0, Math.PI * 2);
      return;
    case 'diamond':
      ctx.moveTo(w / 2, h * (0.5 - s.r));
      ctx.lineTo(w * (0.5 + s.r), h / 2);
      ctx.lineTo(w / 2, h * (0.5 + s.r));
      ctx.lineTo(w * (0.5 - s.r), h / 2);
      ctx.closePath();
  }
}
