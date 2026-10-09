// What each key looks like: a 144 × 144 picture drawn from Lumora's state.
// Tally colors follow switchers everywhere: red is on air, green is in Next.

import {
  channelOf,
  findCountdown,
  findInput,
  findMacro,
  findPreset,
  findSlideshow,
  needsHold,
  screenFor,
  secondsOf,
  type KeySettings,
  type Kind,
} from './actions';
import { ICONS, type IconName } from './icons';
import { clock, remaining, tally, type DeckState, type ScreenId } from './show';
import { faderTarget } from './dials';
import type { Connection } from './protocol';

/** idle: nothing special; program: on air (red); preview: in Next (green); on: switched on; warn: needs attention. */
export type Tone = 'idle' | 'program' | 'preview' | 'on' | 'warn';

export interface KeyModel {
  icon: IconName;
  /** The main words (upper case for commands, as typed for names). */
  label: string;
  /** A second, smaller line. */
  sub?: string | null;
  tone: Tone;
  /** Lumora can't be reached (or the PIN is wrong): grayed, with a warning sign. */
  offline?: boolean;
  /** Being held: how far along (0 – 1). */
  hold?: number | null;
}

export const COLORS = {
  background: '#121316',
  text: '#F2F2F3',
  muted: '#8B8E95',
  dim: '#55585E',
  program: '#D7262B',
  preview: '#16A34A',
  on: '#F2F2F3',
  warn: '#E8A10C',
} as const;

const TONES: Record<Tone, { bg: string; fg: string; sub: string }> = {
  idle: { bg: COLORS.background, fg: COLORS.text, sub: COLORS.muted },
  program: { bg: COLORS.program, fg: '#FFFFFF', sub: '#FFE3E3' },
  preview: { bg: COLORS.preview, fg: '#FFFFFF', sub: '#DFF7E7' },
  on: { bg: COLORS.on, fg: COLORS.background, sub: '#45484E' },
  warn: { bg: COLORS.warn, fg: COLORS.background, sub: '#3A2A00' },
};

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Fit words onto at most `lines` lines of `width` characters, with "…" when cut short. */
export function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const w = word.length > width ? `${word.slice(0, width - 1)}…` : word;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ` ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  const last = kept[lines - 1]!;
  if (!last.endsWith('…')) kept[lines - 1] = last.length < width ? `${last}…` : `${last.slice(0, width - 1)}…`;
  return kept;
}

/** About how wide a line is at a font size (capitals are wider). */
export function textWidth(line: string, size: number): number {
  let w = 0;
  for (const c of line) w += c === ' ' ? 0.28 : /[A-Z0-9]/.test(c) ? 0.68 : 0.55;
  return w * size;
}

/** The largest size at which every line fits across the key. */
function fontSize(lines: string[]): number {
  return [28, 24, 21, 18].find((size) => lines.every((l) => textWidth(l, size) <= 128)) ?? 16;
}

const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

/** The key's picture as SVG. */
export function renderSvg(m: KeyModel): string {
  const t = TONES[m.offline ? 'idle' : m.tone];
  const fg = m.offline ? COLORS.dim : t.fg;
  const sub = m.offline ? COLORS.muted : t.sub;
  const label = m.label.trim();
  const lines = label.length > 9 ? wrap(label, 11, m.sub ? 1 : 2) : [label];
  const size = fontSize(lines);
  const parts: string[] = [];
  parts.push(`<rect width="144" height="144" fill="${t.bg}"/>`);
  // The icon above the words (smaller when there are two lines of words).
  const iconSize = lines.length > 1 || m.sub ? 46 : 54;
  const iconY = lines.length > 1 && m.sub ? 12 : 18;
  const scale = iconSize / 24;
  parts.push(
    `<g transform="translate(${(144 - iconSize) / 2} ${iconY}) scale(${scale})" fill="none" stroke="${fg}" color="${fg}" ` +
      `stroke-width="${(1.7 * 2.25) / scale}" stroke-linecap="round" stroke-linejoin="round">${ICONS[m.icon]}</g>`,
  );
  let y = iconY + iconSize + size + 4;
  for (const l of lines) {
    parts.push(`<text x="72" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${fg}">${escape(l)}</text>`);
    y += size + 2;
  }
  if (m.sub) {
    const s = wrap(m.sub, 14, 1)[0] ?? '';
    parts.push(
      `<text x="72" y="${Math.min(y + 14, 136)}" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="500" fill="${sub}">${escape(s)}</text>`,
    );
  }
  if (m.offline) {
    parts.push(
      `<g transform="translate(104 8) scale(1.35)" fill="none" stroke="${COLORS.warn}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS.warning}</g>`,
    );
  }
  if (m.hold != null) {
    const w = Math.round(136 * Math.min(1, Math.max(0, m.hold)));
    parts.push(`<rect x="4" y="4" width="136" height="8" rx="4" fill="${COLORS.background}" opacity="0.55"/>`);
    parts.push(`<rect x="4" y="4" width="${w}" height="8" rx="4" fill="${COLORS.warn}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join('')}</svg>`;
}

/** The picture as Stream Deck takes it. */
export const dataUrl = (svg: string): string => `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;

export interface KeyContext {
  state: DeckState | null;
  connection: Connection;
  /** The screen the keys work on (the Screen key). */
  deck: ScreenId;
  /** Lumora's clock now. */
  now: number;
  /** Being held: how far along (0 – 1). */
  hold?: number | null;
}

const SCREEN_NAME: Record<ScreenId, string> = { live: 'LIVE', back: 'BACK' };

const OFFLINE_WORDS: Partial<Record<Connection, string>> = {
  off: 'Set up',
  connecting: 'Connecting',
  offline: 'Lumora offline',
  wrongPin: 'Wrong PIN',
};

/** What a key shows now. */
export function keyModel(kind: Kind, s: KeySettings, ctx: KeyContext): KeyModel {
  const m = baseModel(kind, s, ctx);
  if (s.label?.trim()) m.label = s.label.trim();
  if (ctx.connection !== 'online' && kind !== 'screen') {
    m.offline = true;
    m.sub = OFFLINE_WORDS[ctx.connection] ?? m.sub;
  }
  if (ctx.hold != null) {
    m.hold = ctx.hold;
    m.sub = 'Keep holding';
  }
  return m;
}

function baseModel(kind: Kind, s: KeySettings, { state, deck, now }: KeyContext): KeyModel {
  const screen = screenFor(s, deck);
  // Say which screen when it isn't the Live one (the usual).
  const onScreen = screen === 'back' ? 'Back screen' : null;
  switch (kind) {
    case 'take':
      return { icon: 'take', label: 'TAKE', sub: onScreen ?? (s.transition ? s.transition.toUpperCase() : null), tone: 'idle' };
    case 'cut':
      return { icon: 'cut', label: 'CUT', sub: onScreen, tone: 'idle' };
    case 'blank': {
      const blank = !!state?.screens[screen].blank;
      return { icon: 'blank', label: s.mode === 'ftb' ? 'FTB' : 'BLANK', sub: blank ? 'Black now' : onScreen, tone: blank ? 'warn' : 'idle' };
    }
    case 'mute': {
      const t = state ? faderTarget(state, s) : null;
      if (!t) return { icon: 'mute', label: s.targetName || 'MUTE', sub: state ? 'Choose' : null, tone: 'idle' };
      return { icon: 'mute', label: t.name, sub: t.level.muted ? 'Muted' : `${Math.round(t.level.volume * 100)}%`, tone: t.level.muted ? 'program' : 'idle' };
    }
    case 'panic': {
      const on = !!state?.panic;
      return { icon: 'panic', label: 'PANIC', sub: on ? 'Hold to end' : 'Hold', tone: on ? 'program' : 'idle' };
    }
    case 'input': {
      const input = state ? findInput(state, s) : undefined;
      if (!input) return { icon: 'input', label: s.inputName || 'INPUT', sub: state ? 'Choose input' : null, tone: 'idle' };
      const t = state ? tally(state, input.id, screen) : 'none';
      return {
        icon: 'input',
        label: input.name,
        sub: t === 'program' ? 'On air' : t === 'preview' ? 'In Next' : `Input ${input.number}`,
        tone: t === 'none' ? 'idle' : t,
      };
    }
    case 'overlay': {
      const ch = channelOf(s);
      const o = state?.overlays[ch - 1];
      return {
        icon: 'overlay',
        label: o?.name || `OVERLAY ${ch}`,
        sub: o?.on ? `Overlay ${ch} on` : o?.inNext ? `Overlay ${ch} in Next` : `Overlay ${ch}`,
        tone: o?.on ? 'program' : o?.inNext ? 'preview' : 'idle',
      };
    }
    case 'preset': {
      if (s.preset === 'next' || s.preset === 'previous')
        return { icon: 'preset', label: s.preset === 'next' ? 'NEXT' : 'PREVIOUS', sub: 'Preset', tone: 'idle' };
      const p = state ? findPreset(state, s) : undefined;
      if (!p) return { icon: 'preset', label: s.presetName || 'PRESET', sub: state ? 'Choose preset' : null, tone: 'idle' };
      return { icon: 'preset', label: p.name, sub: `Preset ${p.number}`, tone: state?.activePreset === p.id ? 'on' : 'idle' };
    }
    case 'macro': {
      const m = state ? findMacro(state, s) : undefined;
      if (!m) return { icon: 'macro', label: s.macroName || 'MACRO', sub: state ? 'Choose macro' : null, tone: 'idle' };
      return { icon: 'macro', label: m.name, sub: `Macro ${m.number}`, tone: 'idle' };
    }
    case 'replay': {
      const label = `${secondsOf(s)}s${s.slow ? ' ½×' : ''}`;
      return state?.app.replay
        ? { icon: 'replay', label, sub: 'Replay', tone: 'idle' }
        : { icon: 'replay', label: 'REPLAY', sub: 'Press to arm', tone: 'idle' };
    }
    case 'record': {
      const on = !!state?.app.recording;
      return { icon: 'record', label: 'REC', sub: on ? (needsHold('record', s, state) ? 'Hold to stop' : 'Recording') : null, tone: on ? 'program' : 'idle' };
    }
    case 'golive': {
      const app = state?.app;
      if (app?.streaming) return { icon: 'live', label: app.rehearsal ? 'REHEARSING' : 'LIVE', sub: 'Hold to end', tone: app.rehearsal ? 'warn' : 'program' };
      return { icon: 'live', label: app?.rehearsal ? 'REHEARSE' : 'GO LIVE', sub: 'Hold', tone: 'idle' };
    }
    case 'countdown': {
      const c = state ? findCountdown(state, s) : undefined;
      if (!c) return { icon: 'countdown', label: 'COUNTDOWN', sub: state ? 'None in show' : null, tone: 'idle' };
      return { icon: 'countdown', label: clock(remaining(c, now)), sub: c.name, tone: c.running ? 'on' : 'idle' };
    }
    case 'nextcue':
      return { icon: 'cue', label: 'NEXT CUE', sub: state?.run.next ?? (state && !state.run.cues ? 'No cues' : null), tone: 'idle' };
    case 'screen':
      return { icon: 'screen', label: SCREEN_NAME[deck], sub: 'Screen', tone: deck === 'back' ? 'on' : 'idle' };
    case 'rehearsal': {
      const on = !!state?.app.rehearsal;
      return { icon: 'rehearsal', label: 'REHEARSAL', sub: on ? 'On' : 'Off', tone: on ? 'warn' : 'idle' };
    }
    case 'backup': {
      const on = !!state?.backup;
      return { icon: 'backup', label: 'BACKUP', sub: state ? (on ? 'Lineup on' : 'Lineup off') : null, tone: on ? 'on' : 'idle' };
    }
    case 'slidenext':
    case 'slideback':
    case 'slidefirst': {
      const icon = kind === 'slidenext' ? 'slideNext' : kind === 'slideback' ? 'slideBack' : 'slideFirst';
      const label = kind === 'slidenext' ? 'NEXT SLIDE' : kind === 'slideback' ? 'BACK' : 'FIRST SLIDE';
      const sh = state ? findSlideshow(state, s, deck) : undefined;
      if (!sh) return { icon, label, sub: state ? 'No slideshow' : null, tone: 'idle' };
      // The slide showing now, like "3 / 12". Red while on air, green while in Next.
      return {
        icon,
        label,
        sub: sh.count ? `${sh.current + 1} / ${sh.count}` : 'No slides',
        tone: sh.onAir ? 'program' : sh.inNext ? 'preview' : 'idle',
      };
    }
  }
}
