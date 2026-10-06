// Autosave and crash recovery: every so often the project is written to the
// recovery folder (the last few versions are kept as backups), with a marker
// saying the project is open. A clean close takes the marker away; a marker
// found at start means Lumora Studio didn't close properly, and the newest
// autosave can be restored.
import type { Doc } from '../doc';
import type { Project } from '../model/types';
import { inApp } from '../native';
import { manageNative, type RecoveryEntry } from './native';

export interface Marker {
  key: string;
  name: string;
  /** The project file (empty when it was never saved). */
  path: string;
  /** This run of the program. */
  session: string;
  /** When it was last autosaved, and when it was last saved to its own file (ms since 1970). */
  backupAt: number;
  savedAt: number;
}

export interface Backup {
  name: string;
  key: string;
  at: number;
}

export const AUTOSAVE_EVERY = 60_000;
export const KEEP_BACKUPS = 10;
/** Backups of projects not opened for this long are cleared away. */
export const MAX_AGE = 30 * 24 * 3600_000;

/** A short, stable name for a project file (FNV-1a). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The project's name in the recovery folder: from its file, or (never saved) from this session. */
export const projectKey = (path: string, session: string): string => (path ? `p${hashText(path.toLowerCase())}` : `u${session.replace(/[^a-z0-9]/gi, '')}`);

export const backupName = (key: string, at: number): string => `${key}--${Math.round(at)}.lumoraedit`;
export const markerName = (key: string): string => `${key}.session.json`;

export function parseBackup(name: string): Backup | null {
  const m = /^([a-z0-9]+)--(\d+)\.lumoraedit$/i.exec(name);
  return m ? { name, key: m[1] as string, at: Number(m[2]) } : null;
}

/** A project's backups, newest first. */
export function backupsOf(entries: readonly { name: string }[], key: string): Backup[] {
  return entries
    .map((e) => parseBackup(e.name))
    .filter((b): b is Backup => !!b && b.key === key)
    .sort((a, b) => b.at - a.at);
}

/** The backups to delete: all but the newest `keep` of a project, and any not touched for `maxAge`. */
export function toPrune(entries: readonly { name: string }[], key: string, keep: number, now: number, maxAge = MAX_AGE): string[] {
  const old = entries
    .map((e) => parseBackup(e.name))
    .filter((b): b is Backup => !!b && b.key !== key && now - b.at > maxAge)
    .map((b) => b.name);
  return [...backupsOf(entries, key).slice(Math.max(0, keep)).map((b) => b.name), ...old];
}

/** Is an autosave due? (Changed since the last one, and the time has come.) */
export function shouldBackup(changes: number, backedUp: number, lastAt: number, now: number, every = AUTOSAVE_EVERY): boolean {
  return changes !== backedUp && now - lastAt >= every;
}

export function parseMarker(text: string): Marker | null {
  try {
    const m = JSON.parse(text) as Partial<Marker>;
    if (typeof m.key !== 'string' || typeof m.session !== 'string') return null;
    return { key: m.key, name: String(m.name ?? 'Untitled'), path: String(m.path ?? ''), session: m.session, backupAt: Number(m.backupAt) || 0, savedAt: Number(m.savedAt) || 0 };
  } catch {
    return null;
  }
}

export interface Recoverable {
  marker: Marker;
  backup: Backup;
}

/**
 * Projects left open by an earlier run that has gone (a crash): their newest
 * autosave, when it holds work the project file doesn't (newer than its last
 * save, or never saved at all).
 */
export function recoverable(markers: readonly Marker[], entries: readonly { name: string }[], session: string): Recoverable[] {
  const out: Recoverable[] = [];
  for (const m of markers) {
    if (m.session === session) continue;
    const latest = backupsOf(entries, m.key)[0];
    if (!latest) continue;
    if (m.path && latest.at <= m.savedAt) continue;
    out.push({ marker: m, backup: latest });
  }
  return out.sort((a, b) => b.backup.at - a.backup.at);
}

/** This run of the program. */
export const SESSION = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const text = (p: Project): string => JSON.stringify({ ...p, media: p.media.map(({ missing: _m, ...m }) => m) });

/**
 * Autosaves the project while it is open. `path()` is where the project
 * file is (it can change with Save as); `saved()` says it was just saved there.
 */
export class Autosaver {
  private changes = 0;
  private backedUp = 0;
  private lastAt = 0;
  private savedAt = 0;
  private timer = 0;
  private stopDoc: () => void = () => {};
  private lastProject: Project | null = null;
  private key = '';
  private writing = false;

  constructor(
    private doc: Doc,
    private path: () => string,
    private every = AUTOSAVE_EVERY,
    private keep = KEEP_BACKUPS,
  ) {}

  start() {
    if (!inApp()) return;
    this.key = projectKey(this.path(), SESSION);
    this.lastProject = this.doc.project;
    this.lastAt = Date.now();
    this.stopDoc = this.doc.subscribe(() => {
      if (this.doc.project !== this.lastProject) {
        this.lastProject = this.doc.project;
        this.changes += 1;
      }
      if (!this.doc.state.dirty && this.path()) this.savedAt = Date.now();
    });
    void this.mark();
    this.timer = window.setInterval(() => void this.tick(), Math.min(this.every, 15_000));
  }

  /** The project file moved (Save as): its backups go under its new name from now on. */
  moved() {
    const was = this.key;
    this.key = projectKey(this.path(), SESSION);
    if (was !== this.key) {
      void manageNative.recoveryRemove(markerName(was)).catch(() => undefined);
      void this.mark();
    }
  }

  private async mark() {
    // Nothing unsaved: the project file is as new as this autosave.
    if (this.path() && !this.doc.state.dirty) this.savedAt = Date.now();
    const m: Marker = { key: this.key, name: this.doc.project.name, path: this.path(), session: SESSION, backupAt: this.lastAt, savedAt: this.savedAt };
    await manageNative.recoveryWrite(markerName(this.key), JSON.stringify(m)).catch(() => undefined);
  }

  /** Autosave now if anything changed. */
  async tick(force = false) {
    if (this.writing) return;
    const now = Date.now();
    if (!force && !shouldBackup(this.changes, this.backedUp, this.lastAt, now, this.every)) return;
    if (this.changes === this.backedUp) return;
    this.writing = true;
    const changes = this.changes;
    try {
      await manageNative.recoveryWrite(backupName(this.key, now), text(this.doc.project));
      this.backedUp = changes;
      this.lastAt = now;
      await this.mark();
      const entries = await manageNative.recoveryList();
      for (const name of toPrune(entries, this.key, this.keep, now)) await manageNative.recoveryRemove(name).catch(() => undefined);
    } catch {
      // Tried again next time.
    } finally {
      this.writing = false;
    }
  }

  /** A clean close: the marker goes (the backups stay, for Restore backup). */
  async stop() {
    clearInterval(this.timer);
    this.stopDoc();
    if (!inApp() || !this.key) return;
    await manageNative.recoveryRemove(markerName(this.key)).catch(() => undefined);
  }

  get projectKey(): string {
    return this.key;
  }
}

/** Projects to offer to restore at start (a crash left them open). */
export async function findRecoverable(): Promise<Recoverable[]> {
  if (!inApp()) return [];
  const entries: RecoveryEntry[] = await manageNative.recoveryList().catch(() => []);
  const markers: Marker[] = [];
  for (const e of entries.filter((x) => x.name.endsWith('.session.json'))) {
    const m = parseMarker(await manageNative.recoveryRead(e.name).catch(() => ''));
    if (m) markers.push(m);
  }
  return recoverable(markers, entries, SESSION);
}

/** Forget a crashed project's marker (its backups stay). */
export const dismissRecovery = (r: Recoverable): Promise<void> => manageNative.recoveryRemove(markerName(r.marker.key)).catch(() => undefined);

/** A project's backups (newest first). */
export async function listBackups(key: string): Promise<Backup[]> {
  if (!inApp() || !key) return [];
  return backupsOf(await manageNative.recoveryList().catch(() => []), key);
}
