// Macros: named lists of steps (with waits) run by a button, a key, the
// Stream Deck, the control API, or every day at a set time. The engine runs
// the steps (crates/engine/src/macros.rs); this file has what the control
// window needs around them: keys, recording what the operator does, and the
// daily time (kept as a trigger that runs the macro).

import type { Action } from '../engine/types/Action';
import type { Macro } from '../engine/types/Macro';
import type { Step } from '../engine/types/Step';
import type { Trigger } from '../engine/types/Trigger';

/** Most steps in one macro (the engine's limit). */
export const MAX_STEPS = 50;
/** Longest wait the engine takes, ms. */
const MAX_WAIT_MS = 10 * 60 * 1000;

export function newMacroId(): string {
  return `mac-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- keys ----------

/** A key press as a name: "Ctrl+Shift+5", "F7", "Alt+M". Null for a modifier on its own. */
export function keyName(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad[0-9]$/.test(e.code)) key = `Num${e.code.slice(6)}`;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key;
  else if (e.key === ' ') key = 'Space';
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean);
  return [...mods, key].join('+');
}

/**
 * Can a macro use this key? Plain letters, numbers, Enter, Space and the like
 * already do things in Lumora (and are typed in boxes), so a macro key needs
 * Ctrl or Alt, or is a function key (F1 – F4 choose the screen).
 */
export function hotkeyProblem(name: string): string | null {
  if (!name) return null;
  const parts = name.split('+');
  const key = parts[parts.length - 1] ?? '';
  const fn = /^F([5-9]|1[0-9]|2[0-4])$/.test(key);
  if (/^F[1-4]$/.test(key) && parts.length === 1) return 'F1 – F4 choose the screen. Pick another key.';
  if (!fn && !parts.includes('Ctrl') && !parts.includes('Alt')) return 'Use Ctrl or Alt with it (for example Ctrl+1), or a key from F5 to F12.';
  if (['Ctrl+Z', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+S', 'Ctrl+W', 'Ctrl+Q', 'Ctrl+R', 'Alt+F4'].includes(name))
    return 'That key is already used by Windows or Lumora.';
  return null;
}

/** The macro a key runs. */
export function macroForKey(macros: readonly Macro[], name: string | null): Macro | null {
  if (!name) return null;
  return macros.find((m) => m.hotkey && m.hotkey === name && m.steps.length > 0) ?? null;
}

/** Another macro already has this key. */
export function hotkeyTaken(macros: readonly Macro[], id: string, name: string): Macro | null {
  return (name && macros.find((m) => m.id !== id && m.hotkey === name)) || null;
}

// ---------- recording what the operator does ----------

/** The step an action stands for, when it has one. */
export function stepFromAction(a: Action): Step | null {
  switch (a.type) {
    case 'setPreview':
      return a.screen === 'monitor' ? null : { type: 'preview', screen: a.screen, sourceId: a.sourceId };
    case 'take':
      if (a.screen === 'monitor') return null;
      return a.transition ? { type: 'take', screen: a.screen, transition: a.transition } : { type: 'take', screen: a.screen };
    case 'cutTo':
      return a.screen === 'monitor' ? null : { type: 'cutTo', screen: a.screen, sourceId: a.sourceId };
    case 'setBlank':
      return { type: 'blank', screens: a.screens, value: a.value };
    case 'setOverlayOn':
      return { type: 'overlay', channel: a.channel, value: a.value };
    case 'startCountdown':
      return { type: 'startCountdown', sourceId: a.id };
    case 'pauseCountdown':
      return { type: 'pauseCountdown', sourceId: a.id };
    case 'resetCountdown':
      return { type: 'resetCountdown', sourceId: a.id };
    case 'play':
      return { type: 'play', sourceId: a.id };
    case 'pause':
      return { type: 'pause', sourceId: a.id };
    case 'pickPreset':
      return a.id ? { type: 'preset', presetId: a.id } : null;
    case 'setBackFollowsLive':
      return { type: 'backFollowsLive', value: a.value };
    case 'dataStep':
      return { type: 'dataStep', delta: a.delta < 0 ? -1 : 1 };
    case 'runMacro':
      return { type: 'macro', macroId: a.id };
    case 'updateMonitor':
      if (a.patch.messageOn === false) return { type: 'clearMonitorMessage' };
      return a.patch.message != null && a.patch.messageOn ? { type: 'monitorMessage', text: a.patch.message } : null;
    default:
      return null;
  }
}

/**
 * Records what the operator does into steps, with the pauses between as
 * waits (rounded to a tenth of a second; pauses under a quarter second are
 * left out, so a quick double action stays quick).
 */
export class MacroRecorder {
  private steps: Step[] = [];
  private last = 0;
  private on = false;

  get recording(): boolean {
    return this.on;
  }

  get count(): number {
    return this.steps.length;
  }

  start(now: number): void {
    this.steps = [];
    this.last = now;
    this.on = true;
  }

  capture(a: Action, now: number): void {
    if (!this.on || this.steps.length >= MAX_STEPS) return;
    const step = stepFromAction(a);
    if (!step) return;
    const gap = Math.min(MAX_WAIT_MS, Math.round((now - this.last) / 100) * 100);
    if (this.steps.length > 0 && gap >= 250 && this.steps.length < MAX_STEPS - 1) this.steps.push({ type: 'wait', ms: gap });
    this.steps.push(step);
    this.last = now;
  }

  stop(): Step[] {
    this.on = false;
    const out = this.steps;
    this.steps = [];
    return out;
  }
}

/** The one recorder the control window uses. */
export const macroRecorder = new MacroRecorder();

// ---------- every day at a set time ----------

/** The trigger that runs a macro at a clock time. */
export const timeTriggerId = (macroId: string) => `macro-at-${macroId}`;

/** The minute of the day the macro runs at by itself (null: it doesn't). */
export function macroTime(triggers: readonly Trigger[], macroId: string): number | null {
  const t = triggers.find((x) => x.id === timeTriggerId(macroId));
  return t && t.enabled && t.when.type === 'atTime' ? t.when.minute : null;
}

/** The triggers with the macro's daily time set (a minute of the day) or removed (null). */
export function withMacroTime(triggers: readonly Trigger[], m: Pick<Macro, 'id' | 'name'>, minute: number | null, utcOffsetMin: number): Trigger[] {
  const id = timeTriggerId(m.id);
  const rest = triggers.filter((t) => t.id !== id);
  if (minute === null) return rest;
  return [
    ...rest,
    {
      id,
      name: `Macro: ${m.name}`.slice(0, 80),
      enabled: true,
      when: { type: 'atTime', minute: Math.max(0, Math.min(24 * 60 - 1, Math.round(minute))), utcOffsetMin },
      steps: [{ type: 'macro', macroId: m.id }],
      lastFired: 0,
    },
  ];
}
