// Draws the Live Screen, exactly as the audience sees it, onto a canvas that
// is recorded and streamed. It follows the same show, clock and rules as the
// output windows (transitions, T-bar, blank, PANIC, failures shown as the
// safe screen), but needs no window on any display.

import type { EngineClient } from '../engine/client';
import type { Countdown } from '../engine/types/Countdown';
import type { EventInfo } from '../engine/types/EventInfo';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { programLayers } from '../components/ScreenView';
import { acquireCamera, releaseCamera } from '../engine/cameras';
import { syncMedia } from '../engine/mediaSync';
import { pesukimOf, shownText, wordsOf, type PesukimData } from '../engine/pesukim';
import { overlayLook, overlaysOn } from '../engine/overlays';
import { isRtl, withAlpha } from '../engine/text';
import { creditsMetrics, creditsPage, rollOffset, splitName, wallLayout } from '../engine/credits';
import type { Credits } from '../engine/types/Credits';
import type { TextInput } from '../engine/types/TextInput';
import type { Overlay } from '../engine/types/Overlay';
import { countdownDue, countdownFinished, countdownRemaining, countdownVisible, fadeAmount, formatCountdown, ZERO_HOLD_MS } from '../engine/timing';

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
  private readonly ctx: CanvasRenderingContext2D;
  private readonly media = new Map<string, Media>();
  private readonly pictures = new Map<string, Media>();
  private show: Show | null = null;
  private lastSync = 0;

  constructor(
    private readonly client: EngineClient,
    width = 1920,
    height = 1080,
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
    for (const m of [...this.media.values(), ...this.pictures.values()]) this.drop(m);
    this.media.clear();
    this.pictures.clear();
  }

  /** Draw the Live Screen as it is at `now`. */
  draw(now: number): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const show = this.show;
    if (!show) return;

    const sc = show.screens.live;
    const { layers, black } = programLayers(show, 'live', now);
    // Also open what is behind a Pesukim input on air.
    const behind = layers.map((l) => pesukimOf(show, l.id)?.look.behind ?? null);
    const overlays = overlaysOn(show.overlays, 'live', now);
    this.keep(show, [...layers.map((l) => l.id), sc.preview, ...behind, ...overlays.map(({ o }) => o.sourceId)]);
    if (now - this.lastSync > 150) {
      this.lastSync = now;
      for (const [id, m] of this.media) {
        const src = show.sources.find((s) => s.id === id);
        if (src && m.el instanceof HTMLVideoElement && src.kind.type === 'video') syncMedia(m.el, src, now);
      }
    }

    for (const l of layers) {
      const src = show.sources.find((s) => s.id === l.id);
      if (!src || l.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha = clamp01(l.opacity);
      if (l.shift) ctx.translate((l.shift / 100) * w, 0);
      // Wipe: the incoming picture is revealed from the left.
      const wipe = l.clip && /inset\(0 ([\d.]+)% 0 0\)/.exec(l.clip);
      if (wipe) {
        ctx.beginPath();
        ctx.rect(0, 0, w * (1 - Number(wipe[1]) / 100), h);
        ctx.clip();
      }
      this.drawSource(src, show.event, now, w, h);
      ctx.restore();
    }
    this.overlay('#000', black, w, h);
    for (const { o } of overlays) this.drawOverlay(o, show, now, w, h);
    this.overlay('#000', fadeAmount(sc.blank, sc.blankChangedAt, now), w, h);
    const panic = fadeAmount(show.panic, show.panicChangedAt, now);
    if (panic > 0) {
      ctx.save();
      ctx.globalAlpha = panic;
      this.safeScreen(show.event, 'panic', w, h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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
      case 'countdown':
        this.countdown(k.timer, k.background, k.logo ?? event.logo, now, w, h);
        return;
      case 'pesukim':
        this.pesukim(k, event, now, w, h);
        return;
      case 'text':
        this.text(k, now, w, h);
        return;
      case 'credits':
        this.credits(k, now, w, h);
        return;
      case 'image':
      case 'video':
      case 'camera': {
        const m = this.media.get(src.id);
        if (!m || m.failed) return this.safeScreen(event, 'failure', w, h);
        this.fit(m.el, src.fit, w, h);
        return;
      }
    }
  }

  /** Draw a picture filling the frame (contain: whole picture; cover: no bars). */
  private fit(el: HTMLVideoElement | HTMLImageElement, fit: Source['fit'], w: number, h: number) {
    const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete;
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
  private text(t: TextInput, now: number, w: number, h: number) {
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

    ctx.font = font(s.size, s.weight);
    const mainW = ctx.measureText(t.text).width;
    ctx.font = font(subSize, Math.max(300, s.weight - 200));
    const subW = t.sub ? ctx.measureText(t.sub).width : 0;
    const contentW = Math.max(mainW, subW);
    const contentH = lineH + (t.sub ? subH : 0);
    const bw = contentW + 2 * pad;
    const bh = contentH + 2 * pad;
    let bx: number;
    let by: number;
    if (t.layout === 'lowerThird') {
      const left = w * 0.05;
      const right = w * 0.95;
      bx = s.align === 'center' ? (w - bw) / 2 : s.align === 'right' ? right - bw : left;
      by = h * 0.9 - bh;
    } else {
      bx = (w - bw) / 2;
      by = (h - bh) / 2;
    }
    box(bx, by, bw, bh, s.radius * k);
    // Lines line up by the chosen alignment inside the box (left and right
    // are absolute, as in the screens' CSS, for Hebrew too).
    const ax = s.align === 'center' ? bx + bw / 2 : s.align === 'right' ? bx + bw - pad : bx + pad;
    ctx.textAlign = s.align;
    paint(t.text, ax, by + pad + lineH / 2, s.size, s.weight);
    if (t.sub) paint(t.sub, ax, by + pad + lineH + subH / 2, subSize, Math.max(300, s.weight - 200), 0.9);
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
