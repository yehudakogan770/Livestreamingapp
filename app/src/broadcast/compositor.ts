// Draws the Live Screen, exactly as the audience sees it, onto a canvas that
// is recorded and streamed. It follows the same show, clock and rules as the
// output windows (transitions, T-bar, blank, PANIC, failures shown as the
// safe screen), but needs no window on any display.

import type { EngineClient } from "../engine/client";
import type { Countdown } from "../engine/types/Countdown";
import type { EventInfo } from "../engine/types/EventInfo";
import type { Show } from "../engine/types/Show";
import type { Source } from "../engine/types/Source";
import { programLayers } from "../components/ScreenView";
import { acquireCamera, releaseCamera } from "../engine/cameras";
import { syncMedia } from "../engine/mediaSync";
import {
  countdownDue,
  countdownFinished,
  countdownRemaining,
  countdownVisible,
  fadeAmount,
  formatCountdown,
  ZERO_HOLD_MS,
} from "../engine/timing";

const FONT = '"Segoe UI", system-ui, sans-serif';
const BARS = [
  "#c0c0c0",
  "#c0c000",
  "#00c0c0",
  "#00c000",
  "#c000c0",
  "#c00000",
  "#0000c0",
];
const LOW_BARS = [
  "#0000c0",
  "#131313",
  "#c000c0",
  "#131313",
  "#00c0c0",
  "#131313",
  "#c0c0c0",
];

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
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx)
      throw new Error("This computer cannot draw the picture for recording.");
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
    for (const m of [...this.media.values(), ...this.pictures.values()])
      this.drop(m);
    this.media.clear();
    this.pictures.clear();
  }

  /** Draw the Live Screen as it is at `now`. */
  draw(now: number): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const show = this.show;
    if (!show) return;

    const sc = show.screens.live;
    const { layers, black } = programLayers(show, "live", now);
    this.keep(show, [...layers.map((l) => l.id), sc.preview]);
    if (now - this.lastSync > 150) {
      this.lastSync = now;
      for (const [id, m] of this.media) {
        const src = show.sources.find((s) => s.id === id);
        if (
          src &&
          m.el instanceof HTMLVideoElement &&
          src.kind.type === "video"
        )
          syncMedia(m.el, src, now);
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
    this.overlay("#000", black, w, h);
    this.overlay("#000", fadeAmount(sc.blank, sc.blankChangedAt, now), w, h);
    const panic = fadeAmount(show.panic, show.panicChangedAt, now);
    if (panic > 0) {
      ctx.save();
      ctx.globalAlpha = panic;
      this.safeScreen(show.event, "panic", w, h);
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

  private drawSource(
    src: Source,
    event: EventInfo,
    now: number,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    const k = src.kind;
    switch (k.type) {
      case "color":
        ctx.fillStyle = k.color;
        ctx.fillRect(0, 0, w, h);
        return;
      case "pattern": {
        const top = h * 0.78;
        BARS.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(Math.floor((i * w) / 7), 0, Math.ceil(w / 7) + 1, top);
        });
        LOW_BARS.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(
            Math.floor((i * w) / 7),
            top,
            Math.ceil(w / 7) + 1,
            h - top,
          );
        });
        return;
      }
      case "microphone":
        return;
      case "countdown":
        this.countdown(k.timer, k.background, k.logo ?? event.logo, now, w, h);
        return;
      case "image":
      case "video":
      case "camera": {
        const m = this.media.get(src.id);
        if (!m || m.failed) return this.safeScreen(event, "failure", w, h);
        this.fit(m.el, src.fit, w, h);
        return;
      }
    }
  }

  /** Draw a picture filling the frame (contain: whole picture; cover: no bars). */
  private fit(
    el: HTMLVideoElement | HTMLImageElement,
    fit: Source["fit"],
    w: number,
    h: number,
  ) {
    const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const ih =
      el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    const ready =
      el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete;
    if (!ready || !iw || !ih) return;
    const scale =
      fit === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    try {
      this.ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } catch {
      /* not decodable yet */
    }
  }

  /** What the audience sees instead of something broken, and during PANIC. */
  private safeScreen(
    event: EventInfo,
    reason: "failure" | "panic",
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const choice = reason === "panic" ? event.panicShows : event.onFailure;
    if (choice !== "logo" || !event.logo) return;
    const logo = this.picture(event.logo);
    if (logo) this.centred(logo, w * 0.5, h * 0.5, w, h);
  }

  /** Draw a picture centred, no bigger than maxW × maxH. */
  private centred(
    el: HTMLImageElement,
    maxW: number,
    maxH: number,
    w: number,
    h: number,
    scale = 1,
  ) {
    if (!el.complete || !el.naturalWidth) return;
    const s =
      Math.min(maxW / el.naturalWidth, maxH / el.naturalHeight, 1) * scale;
    const dw = el.naturalWidth * s;
    const dh = el.naturalHeight * s;
    this.ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /** The countdown input (mirrors CountdownView and its CSS). */
  private countdown(
    timer: Countdown,
    background: string,
    logoPath: string | null,
    now: number,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    // Background: the colour glowing from the middle into black.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / 2, h / 2);
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2 * 1.4);
    bg.addColorStop(0, background);
    bg.addColorStop(1, "#000");
    ctx.fillStyle = bg;
    ctx.fillRect(-1, -1, 2, 2);
    const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
    shade.addColorStop(0, "rgba(0,0,0,0.55)");
    shade.addColorStop(0.55, "rgba(0,0,0,0.25)");
    shade.addColorStop(0.8, "rgba(0,0,0,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();

    const left = countdownRemaining(timer, now);
    const done = countdownFinished(timer, now);
    const due = countdownDue(timer, now);
    const secs = Math.ceil(left / 1000);
    const final = timer.endsAt !== null && !done && secs <= 10;
    const sinceDue =
      timer.endsAt !== null ? now - (timer.endsAt + ZERO_HOLD_MS) : 0;
    const words = due && timer.atZero.type === "showText";
    // The numbers fade out over 0.9 s once it is time.
    const numbersGone = !countdownVisible(timer, now) || words;
    const stackAlpha = numbersGone ? 1 - clamp01(sinceDue / 900) : 1;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    if (stackAlpha > 0) {
      ctx.globalAlpha = stackAlpha;
      let size = final
        ? Math.min(h * 0.5, w * 0.32)
        : Math.min(h * 0.34, w * 0.22);
      let alpha = 1;
      if (final) {
        // Each of the last ten seconds lands with a beat.
        const t = 1 - (left / 1000 - (secs - 1));
        const beat =
          t < 0.18 ? 1.25 - (0.25 * t) / 0.18 : 1 - (0.06 * (t - 0.18)) / 0.82;
        alpha = t < 0.18 ? 0.4 + (0.6 * t) / 0.18 : 1;
        size *= beat;
      } else if (done && timer.endsAt !== null) {
        const t = clamp01((now - timer.endsAt) / 600);
        size *= 1.3 - 0.3 * ease(t);
        alpha = ease(t);
      }
      const label = timer.label && !done ? timer.label.toUpperCase() : "";
      const labelSize = h * 0.06;
      const gap = h * 0.02;
      const total = (label ? labelSize + gap : 0) + size;
      const top = h / 2 - total / 2;
      if (label) {
        ctx.font = `700 ${labelSize}px ${FONT}`;
        this.spacing(labelSize * 0.35);
        ctx.globalAlpha = stackAlpha * 0.9;
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = h * 0.03;
        ctx.fillText(label, w / 2 + labelSize * 0.175, top + labelSize / 2);
      }
      ctx.font = `800 ${size}px ${FONT}`;
      this.spacing(0);
      ctx.globalAlpha = stackAlpha * alpha;
      ctx.shadowColor = final
        ? "rgba(255,196,120,0.8)"
        : "rgba(79,179,191,0.55)";
      ctx.shadowBlur = h * (final ? 0.06 : 0.04);
      ctx.fillText(
        formatCountdown(left, timer.format),
        w / 2,
        top + (label ? labelSize + gap : 0) + size / 2,
      );
    }
    // After zero: the end words or the logo fade in (after half a second).
    const appear = ease((sinceDue - 500) / 1000);
    if (words && appear > 0) {
      ctx.globalAlpha = appear;
      ctx.font = `800 ${Math.min(h * 0.16, w * 0.1)}px ${FONT}`;
      ctx.shadowColor = "rgba(79,179,191,0.55)";
      ctx.shadowBlur = h * 0.04;
      ctx.fillText(timer.endText, w / 2, h / 2);
    }
    if (due && timer.atZero.type === "hide" && logoPath && appear > 0) {
      const logo = this.picture(logoPath);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = appear;
      if (logo)
        this.centred(logo, w * 0.6, h * 0.6, w, h, 0.92 + 0.08 * appear);
    }
    ctx.restore();
  }

  private spacing(px: number) {
    const c = this.ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
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
    if (k.type === "image")
      return this.image(key, this.client.mediaUrl(k.path));
    if (k.type === "video") {
      const el = document.createElement("video");
      const m: Media = { key, el, failed: false };
      // Same-origin rules: without this the recording would refuse the picture.
      el.crossOrigin = "anonymous";
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.onerror = () => (m.failed = true);
      el.src = this.client.mediaUrl(k.path);
      return m;
    }
    if (k.type === "camera") {
      const el = document.createElement("video");
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
            t.addEventListener("ended", () => (m.failed = true)),
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
    el.crossOrigin = "anonymous";
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
      m.el.removeAttribute("src");
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
    case "video":
    case "image":
      return `${k.type}:${k.path}`;
    case "camera":
      return `camera:${k.deviceId}`;
    default:
      return k.type;
  }
}
