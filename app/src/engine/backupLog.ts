// What the backup lineup did (./backup.ts): the notices the control window
// shows, and the record the test event reports from.

import type { Notice } from './backup';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';

export const SCREEN_NAME: Record<ScreenId, string> = { live: 'Live Screen', back: 'Back Screen', monitor: 'Monitor' };

/** One notice, with the names as they were when it happened. */
export interface BackupNote extends Notice {
  id: number;
  /** Wall-clock time (for "at 8:42 PM"). */
  wallAt: number;
  fromName: string;
  toName: string | null;
}

/** What the backup lineup did, newest last: shown as notices, kept for the test event's report. */
export class BackupLog {
  private notes: BackupNote[] = [];
  private open: BackupNote[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;

  push(n: Notice, show: Show, wallAt = Date.now()): BackupNote {
    const name = (id: string | null) => (id === null ? null : (show.sources.find((s) => s.id === id)?.name ?? 'an input'));
    const note: BackupNote = { ...n, id: this.nextId++, wallAt, fromName: name(n.from) ?? '', toName: name(n.to) };
    this.notes = [...this.notes.slice(-199), note];
    // A newer word about the same input on the same screen replaces the older one.
    this.open = [...this.open.filter((x) => !(x.screen === n.screen && x.from === n.from)), note].slice(-4);
    this.changed();
    return note;
  }

  dismiss(id: number): void {
    const before = this.open.length;
    this.open = this.open.filter((x) => x.id !== id);
    if (this.open.length !== before) this.changed();
  }

  /** Forget the notices about an input (it was taken back by hand). */
  settle(screen: ScreenId, from: string): void {
    const before = this.open.length;
    this.open = this.open.filter((x) => !(x.screen === screen && x.from === from));
    if (this.open.length !== before) this.changed();
  }

  all = (): BackupNote[] => this.notes;
  active = (): BackupNote[] => this.open;
  since(id: number): BackupNote[] {
    return this.notes.filter((n) => n.id > id);
  }
  lastId(): number {
    return this.nextId - 1;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private changed() {
    for (const l of this.listeners) l();
  }
}

/** This window's backup log. */
export const backupLog = new BackupLog();

export const clockTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

/** What a notice says, in plain words. */
export function noteText(n: BackupNote): string {
  const where = n.screen === 'live' ? '' : ` on the ${SCREEN_NAME[n.screen]}`;
  switch (n.kind) {
    case 'switched':
      return `${n.fromName} lost: switched to ${n.toName ?? 'the next input'}${where}`;
    case 'allDown':
      return `${n.fromName} lost, and nothing in the backup lineup has a picture${where}: the audience sees the logo`;
    case 'back':
      return `${n.fromName} is back`;
    case 'switchedBack':
      return `${n.fromName} is back: switched back to it${where}`;
  }
}
