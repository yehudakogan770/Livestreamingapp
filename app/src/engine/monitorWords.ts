// The stage monitor drawn on a canvas, for the unified engine: the Monitor
// is one of the engine's own windows there, and its words — the clock, the
// countdown, the message or the song's words with what comes next, the
// teleprompter, the candle-lighting band, flashing and blanking — are the
// Live Screen's overlay renderer's plane `mon`. It follows MonitorScreen.tsx
// and MonitorScreen.css (same layouts, sizes and colors; the text shrinks to
// fit as useFitText does).

import { sections } from './lyrics';
import type { Show } from './types/Show';
import type { Prompter } from './types/Prompter';
import type { TextSize } from './types/TextSize';
import { FLASH_MS, countdownFinished, countdownRemaining, fadeAmount, formatCountdown } from './timing';
import { mainCountdown } from './countdowns';
import { clockTime, hasPlace, zmanimOn } from './zmanim';
import { prompterAt } from '../components/PrompterView';

const SIZE: Record<TextSize, number> = { s: 0.55, m: 0.75, l: 1, xl: 1.3 };
const FONT = "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, system-ui, sans-serif";
const MONO = "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, 'SF Mono', 'Liberation Mono', monospace";

/** What the monitor shows at `now` (MonitorScreen's state, without drawing). */
export interface MonitorModel {
  layout: 'full' | 'stack' | 'split';
  clock: { time: string; period: string | null } | null;
  timer: { text: string; tag: string; urgent: boolean; paused: boolean } | null;
  message: string | null;
  /** A song on air: its words keep their line breaks. */
  song: boolean;
  nextLines: string | null;
  size: number;
  shabbos: { text: string; urgent: boolean } | null;
  prompter: Prompter | null;
  /** Blank and PANIC (0.6): black over everything. */
  dark: number;
  flash: boolean;
}

export function monitorModel(show: Show, now: number): MonitorModel {
  const sc = show.screens.monitor;
  const m = show.monitor;
  const mainId = mainCountdown(show);
  const main = show.sources.find((x) => x.id === mainId)?.kind;
  const c = main?.type === 'countdown' ? main.timer : null;
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: !m.clock24h }).formatToParts(new Date(now));
  const time = parts
    .filter((x) => x.type !== 'dayPeriod')
    .map((x) => x.value)
    .join('')
    .trim();
  const period = parts.find((x) => x.type === 'dayPeriod')?.value ?? null;
  const left = c ? countdownRemaining(c, now) : 0;
  const done = c ? countdownFinished(c, now) : false;
  const songSrc = show.sources.find((x) => x.id === show.screens.live.program)?.kind;
  const song = (m.showLyrics ?? true) && songSrc?.type === 'lyrics' ? songSrc : null;
  const slides = song ? sections(song.text) : [];
  const message = m.messageOn && m.message ? m.message : song ? (song.blank ? '—' : (slides[song.current] ?? '')) : null;
  const nextLines = song && !(m.messageOn && m.message) ? (slides[song.current + (song.blank ? 0 : 1)] ?? null) : null;
  const place = show.event.place;
  const candles = hasPlace(place) && place.warnMonitor ? zmanimOn(now, place).candles : null;
  const toCandles = candles === null ? null : candles - now;
  const shabbos =
    candles !== null && toCandles !== null && toCandles > -15 * 60_000 && toCandles <= 3_600_000
      ? {
          text:
            toCandles > 0 ? `Candle lighting in ${Math.ceil(toCandles / 60_000)} min · ${clockTime(candles)}` : `Candle lighting was at ${clockTime(candles)}`,
          urgent: toCandles <= 10 * 60_000,
        }
      : null;
  return {
    layout: m.layout,
    clock: m.showClock ? { time, period } : null,
    timer:
      m.showTimer && c
        ? {
            text: done && c.atZero.type === 'showText' ? c.endText : formatCountdown(left, c.format === 'auto' ? 'minSec' : c.format),
            tag: c.endsAt === null ? 'COUNTDOWN · WAITING' : 'TIME LEFT',
            urgent: c.endsAt !== null && left < 60_000,
            paused: c.endsAt === null,
          }
        : null,
    message,
    song: !!song,
    nextLines,
    size: SIZE[m.textSize],
    shabbos,
    prompter: m.prompter?.on ? m.prompter : null,
    dark: Math.max(fadeAmount(sc.blank, sc.blankChangedAt, now, sc.blankFadeMs), fadeAmount(show.panic, show.panicChangedAt, now) * 0.6),
    flash: now - sc.flashAt < FLASH_MS && Math.floor((now - sc.flashAt) / 300) % 2 === 0,
  };
}

/** Whether the monitor changes from one moment to the next (a running countdown, a flash, the prompter rolling, a fade). */
export function monitorMoving(show: Show, now: number): boolean {
  const sc = show.screens.monitor;
  return now - sc.flashAt < FLASH_MS || (!!show.monitor.prompter?.on && show.monitor.prompter.since !== null);
}

/** `text` wrapped into lines no wider than `max` (words; long words broken anywhere; `pre` keeps line breaks). */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, max: number, pre: boolean): string[] {
  const out: string[] = [];
  for (const para of pre ? text.split('\n') : [text.replace(/\s+/g, ' ')]) {
    let line = '';
    for (const word of para.split(' ')) {
      const tryLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(tryLine).width <= max || !line) {
        line = tryLine;
        // A word wider than the line is broken anywhere (overflow-wrap: anywhere).
        while (ctx.measureText(line).width > max && line.length > 1) {
          let n = line.length - 1;
          while (n > 1 && ctx.measureText(line.slice(0, n)).width > max) n--;
          out.push(line.slice(0, n));
          line = line.slice(n);
        }
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Draw the stage monitor for `show` at `now` on a canvas `W` × `H`. */
export function drawMonitorWords(ctx: CanvasRenderingContext2D, W: number, H: number, show: Show, now: number): void {
  const m = monitorModel(show, now);
  const ch = H / 100;
  const cw = W / 100;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const top = m.shabbos && !m.prompter ? 10 * ch : 0;

  /** A clock or countdown cell centered at (x, y): its tag above its number. */
  const cell = (kind: 'clock' | 'timer', x: number, y: number, num: number, tagPx = 3.2 * ch) => {
    const tag = kind === 'clock' ? 'TIME' : (m.timer?.tag ?? '');
    const text = kind === 'clock' ? (m.clock?.time ?? '') : (m.timer?.text ?? '');
    const small = kind === 'clock' ? m.clock?.period : null;
    const total = tagPx * 1.25 + num;
    const y0 = y - total / 2;
    ctx.font = `700 ${tagPx}px ${FONT}`;
    ctx.fillStyle = '#8e9096';
    ctx.fillText(tag, x, y0 + tagPx * 0.6);
    ctx.font = `700 ${num}px ${MONO}`;
    ctx.fillStyle = kind === 'timer' && m.timer?.urgent ? '#ff5a4f' : kind === 'timer' && m.timer?.paused ? '#a9abb0' : '#fff';
    const ny = y0 + tagPx * 1.25 + num / 2;
    if (small) {
      const big = ctx.measureText(text).width;
      ctx.font = `700 ${num * 0.35}px ${MONO}`;
      const sw = ctx.measureText(small).width + num * 0.35 * 0.25;
      ctx.font = `700 ${num}px ${MONO}`;
      ctx.textAlign = 'left';
      const x0 = x - (big + sw) / 2;
      ctx.fillText(text, x0, ny);
      ctx.font = `700 ${num * 0.35}px ${MONO}`;
      ctx.fillStyle = '#a9abb0';
      ctx.fillText(small, x0 + big + num * 0.35 * 0.25, ny + num * 0.25);
      ctx.textAlign = 'center';
    } else ctx.fillText(text, x, ny);
  };
  const cells = (): ('clock' | 'timer')[] => [...(m.clock ? ['clock' as const] : []), ...(m.timer ? ['timer' as const] : [])];

  /** The message (and a song's next lines) in a box, shrunk to fit. */
  const messageBox = (x: number, y: number, w: number, h: number, base: number) => {
    let nextH = 0;
    const nextFont = 3.4 * ch;
    let nextLines: string[] = [];
    if (m.nextLines) {
      ctx.font = `400 ${nextFont}px ${FONT}`;
      nextLines = wrapText(ctx, m.nextLines, w * 0.9, true);
      nextH = 2 * ch + 1.5 * ch + 3.2 * ch * 1.3 + nextLines.length * nextFont * 1.3;
    }
    const text = m.message ?? '';
    const pad = 3 * cw;
    let size = base * m.size;
    let lines: string[] = [];
    const fits = () => {
      ctx.font = `800 ${size}px ${FONT}`;
      lines = wrapText(ctx, text, Math.max(10, w - 2 * pad), m.song);
      return lines.length * size * 1.1 <= (h - nextH) * 0.92;
    };
    if (!fits()) {
      let lo = 6;
      let hi = size;
      for (let i = 0; i < 14 && hi - lo > 0.5; i++) {
        size = (lo + hi) / 2;
        if (fits()) lo = size;
        else hi = size;
      }
      size = lo;
      fits();
    }
    const blockH = lines.length * size * 1.1 + nextH;
    let ty = y + (h - blockH) / 2;
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${size}px ${FONT}`;
    for (const l of lines) {
      ctx.fillText(l, x + w / 2, ty + (size * 1.1) / 2);
      ty += size * 1.1;
    }
    if (m.nextLines) {
      ty += 2 * ch;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      const lw = Math.max(...nextLines.map((l) => ctx.measureText(l).width), 10);
      ctx.fillRect(x + w / 2 - lw / 2, ty, lw, 2);
      ty += 1.5 * ch;
      ctx.font = `700 ${3.2 * ch}px ${FONT}`;
      ctx.fillStyle = '#8e9096';
      ctx.fillText('NEXT', x + w / 2, ty + 3.2 * ch * 0.65);
      ty += 3.2 * ch * 1.3;
      ctx.font = `400 ${nextFont}px ${FONT}`;
      ctx.fillStyle = '#9aa0a8';
      for (const l of nextLines) {
        ctx.fillText(l, x + w / 2, ty + (nextFont * 1.3) / 2);
        ty += nextFont * 1.3;
      }
    }
  };

  const body = H - top;
  if (m.prompter) {
    drawPrompter(ctx, W, H, m.prompter, now);
  } else if (m.layout === 'full') {
    const list = cells();
    if (m.message) {
      const strip = list.length ? 26 * ch : 0;
      const gap = list.length ? 4 * ch : 0;
      messageBox(0, top, W, body - strip - gap, 13 * ch);
      if (list.length) {
        const sy = top + body - strip;
        ctx.fillStyle = '#2c3038';
        ctx.fillRect(0, sy, W, 0.4 * ch);
        list.forEach((k, i) => cell(k, (W / list.length) * (i + 0.5), sy + strip / 2, 13 * ch));
      }
    } else {
      const num = Math.min(28 * ch, 15 * cw);
      list.forEach((k, i) => cell(k, (W / (list.length + 1)) * (i + 1), top + body / 2, num, 4 * ch));
    }
  } else if (m.layout === 'stack') {
    const list = cells();
    const areaH = list.length ? body * 0.62 : body;
    messageBox(0, top, W, areaH, 13 * ch);
    if (list.length) {
      ctx.fillStyle = '#2c3038';
      ctx.fillRect(0, top + areaH - 0.4 * ch, W, 0.4 * ch);
      list.forEach((k, i) => cell(k, (W / list.length) * (i + 0.5), top + areaH + (body - areaH) / 2, 17 * ch));
    }
  } else {
    const list = cells();
    const areaW = list.length ? W * 0.62 : W;
    messageBox(0, top, areaW, body, 10 * ch);
    if (list.length) {
      ctx.fillStyle = '#2c3038';
      ctx.fillRect(areaW - 0.4 * ch, top, 0.4 * ch, body);
      const num = Math.min(18 * ch, 9 * cw);
      list.forEach((k, i) => cell(k, areaW + (W - areaW) / 2, top + (body / list.length) * (i + 0.5), num));
    }
  }
  if (m.shabbos) {
    ctx.fillStyle = m.shabbos.urgent ? '#b3261e' : '#3b2a08';
    ctx.fillRect(0, 0, W, 10 * ch);
    ctx.font = `800 ${5.5 * ch}px ${FONT}`;
    ctx.fillStyle = m.shabbos.urgent ? '#fff' : '#ffd98a';
    ctx.fillText(m.shabbos.text, W / 2, 5 * ch);
  }
  if (m.flash) {
    const b = 2 * cw;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, b);
    ctx.fillRect(0, H - b, W, b);
    ctx.fillRect(0, 0, b, H);
    ctx.fillRect(W - b, 0, b, H);
  }
  if (m.dark > 0) {
    ctx.globalAlpha = Math.min(1, m.dark);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

/** The teleprompter (PrompterView): the script moving up past the reading line. */
function drawPrompter(ctx: CanvasRenderingContext2D, W: number, H: number, p: Prompter, now: number): void {
  const ch = H / 100;
  const at = prompterAt(p, now);
  ctx.save();
  if (p.mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const size = p.size * ch;
  ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  const lines = wrapText(ctx, p.script || 'Type the script in the Monitor tab.', W * 0.84, true);
  let y = (35 - at) * ch;
  for (const l of lines) {
    if (y > -size * 2 && y < H + size) ctx.fillText(l, W * 0.08, y + (size * 1.35) / 2);
    y += size * 1.35;
  }
  const lineTop = (35 + p.size * 0.1) * ch;
  const lineH = p.size * 1.15 * ch;
  ctx.fillStyle = 'rgba(242, 178, 51, 0.12)';
  ctx.fillRect(0, lineTop, W, lineH);
  ctx.fillStyle = 'rgba(242, 178, 51, 0.5)';
  ctx.fillRect(0, lineTop, W, 0.3 * ch);
  ctx.fillRect(0, lineTop + lineH - 0.3 * ch, W, 0.3 * ch);
  ctx.font = `400 ${p.size * 0.8 * ch}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = '#f2b233';
  ctx.fillText('▶', W * 0.02, (35 + p.size * 0.2) * ch + p.size * 0.4 * ch);
  ctx.restore();
  ctx.textAlign = 'center';
}
