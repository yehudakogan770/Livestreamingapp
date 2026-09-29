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
import { acquireCamera, releaseCamera } from '../engine/cameras';
import { syncMedia } from '../engine/mediaSync';
import { pesukimOf, shownText, wordsOf, type PesukimData } from '../engine/pesukim';
import { overlayLook, overlaysOn } from '../engine/overlays';
import { ChromaKeyer, needsProcessing } from '../engine/chroma';
import { makeRenderer, type Renderer } from '../visuals/renderer';
import { Logo3dRenderer, loadLogo, placeholderLogo } from '../logo3d/renderer';
import { loopVisuals } from '../logo3d/background';
import { browserInfo } from '../engine/browser';
import { logoRect, VisualsPlayer } from '../visuals/player';
import { buildAt, isRtl, withAlpha } from '../engine/text';
import { clockShown, formatGameClock } from '../engine/score';
import { LYRICS_FADE_MS, sections } from '../engine/lyrics';
import type { Lyrics } from '../engine/types/Lyrics';
import type { Poll } from '../engine/types/Poll';
import type { CommentCard } from '../engine/types/CommentCard';
import type { Raffle } from '../engine/types/Raffle';
import type { Fundraiser } from '../engine/types/Fundraiser';
import type { Wall } from '../engine/types/Wall';
import { cardSize, tickerShift, wallCard, wallGrid, wallTicker } from '../engine/wall';
import { CELEBRATE_MS, confetti, drawAt, money, raised } from '../engine/audience';
import { shares } from '../engine/poll';
import { joinShown } from '../engine/join';
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
    this.ctx = ctx;
  }

  setShow(show: Show): void {
    this.show = show;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  dispose(): void {
    this.stopSting();
    if (this.visuals) this.visuals.r.dispose();
    for (const l of this.logos.values()) {
      if (l) {
        l.r.dispose();
        l.loop?.dispose();
      }
    }
    this.logos.clear();
    this.visuals = null;
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
    // A vertical frame shows the middle of the 16:9 picture.
    const h = canvas.height;
    const w = canvas.width > h ? canvas.width : Math.round((h * 16) / 9);
    if (w !== canvas.width) ctx.translate(-(w - canvas.width) / 2, 0);
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
        this.countdown(k.timer, k.background, k.logo ?? event.logo, now, w, h);
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
      case 'text':
        this.text(k, now, w, h, this.since(src.id, now));
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
        if (needsProcessing(src.key, src.adjust)) {
          // Green screen: key the frame on the graphics card, then draw the keyed copy.
          const el = m.el;
          const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
          const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
          let keyer = this.keyers.get(src.id);
          if (!keyer) {
            keyer = new ChromaKeyer();
            this.keyers.set(src.id, keyer);
          }
          if (keyer.works && (el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete) && keyer.draw(el, iw, ih, src.key, src.adjust)) {
            this.fit(keyer.canvas, src.fit, w, h);
            return;
          }
        }
        this.fit(m.el, src.fit, w, h);
        return;
      }
    }
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
    if (choice !== 'logo' || !event.logo) return;
    const logo = this.picture(event.logo);
    if (logo) this.centred(logo, w * 0.5, h * 0.5, w, h);
  }

  /** Draw a picture centred, no bigger than maxW × maxH. */
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
    // Background: the colour glowing from the middle into black.
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
    if (due && timer.atZero.type === 'hide' && logoPath && appear > 0) {
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
  private text(t: TextInput, now: number, w: number, h: number, start = now - 10_000) {
    const ctx = this.ctx;
    const s = t.style;
    const k = h / 1080;
    const rtl = isRtl(t.text + t.sub);
    const font = (size: number, weight: number) => `${weight} ${size * k}px "${s.font}", "Segoe UI", system-ui, sans-serif`;
    const lineH = s.size * s.lineHeight * k;
    const subSize = s.size * 0.6;
    const subH = subSize * s.lineHeight * k;
    const pad = s.boxOn ? s.padding * k : 0;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    this.spacing(s.letterSpacing * k);
    const paint = (str: string, x: number, y: number, size: number, weight: number, alpha = 1) => {
      ctx.font = font(size, weight);
      ctx.globalAlpha = alpha;
      ctx.shadowColor = s.shadow ? 'rgba(0,0,0,0.6)' : 'transparent';
      ctx.shadowBlur = s.shadow ? 12 * k : 0;
      ctx.shadowOffsetY = s.shadow ? 3 * k : 0;
      if (s.outline > 0) {
        ctx.lineWidth = s.outline * 2 * k;
        ctx.strokeStyle = s.outlineColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(str, x, y);
      }
      ctx.fillStyle = s.color;
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

    const b = buildAt(now - start, s.animate ?? false);
    const d = s.design ?? 'box';
    const accent = s.accent ?? '#2f80ed';
    const end = s.align === 'right';
    ctx.font = font(s.size, s.weight);
    const mainW = ctx.measureText(t.text).width;
    ctx.font = font(subSize, Math.max(300, s.weight - 200));
    const subW = t.sub ? ctx.measureText(t.sub).width : 0;
    const r = s.radius * k;
    // Where a block of size bw × bh goes for this layout.
    const place = (bw: number, bh: number) => {
      if (t.layout === 'lowerThird') {
        const x = s.align === 'center' ? (w - bw) / 2 : end ? w * 0.95 - bw : w * 0.05;
        return { x, y: h * 0.9 - bh };
      }
      return { x: (w - bw) / 2, y: (h - bh) / 2 };
    };
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
      ctx.globalAlpha = 1;
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, r);
      ctx.fill();
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
    this.drawSource(src, show.event, now, bw, bh);
    ctx.restore();
  }

  /** The 12 Pesukim input (mirrors PesukimView and its CSS). */
  private pesukim(data: PesukimData, event: EventInfo, now: number, w: number, h: number) {
    const ctx = this.ctx;
    const { look, place } = data;
    ctx.fillStyle = look.background;
    ctx.fillRect(0, 0, w, h);
    const behind = look.behind ? this.show?.sources.find((s) => s.id === look.behind) : undefined;
    if (behind && behind.kind.type !== 'pesukim') this.drawSource(behind, event, now, w, h);

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
    if (look.showName && pasuk?.child && !place.blank) {
      ctx.font = `600 ${h * 0.034}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.direction = 'ltr';
      ctx.fillText(`Pasuk ${place.pasuk + 1} · ${pasuk.child}`, w * 0.04, h * 0.04);
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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (strip) this.pesukimStrip(words, place.word, look.textColor, font, w, h);
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
    for (const [id, m] of this.media) {
      const src = show.sources.find((s) => s.id === id);
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
          tracks.forEach((t) => t.addEventListener('ended', () => (m.failed = true)));
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
