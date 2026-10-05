// A shared project while it is open: who else is here, who is editing which
// sequence, saving with version checks, others' saves coming in, and the
// review comments. The editor reads `state` like its other stores.

import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Doc } from '../doc';
import type { Project } from '../model/types';
import * as cloud from './cloud';
import { applyChange, type CommentChange, type ReviewComment } from './comments';
import { applyLinks, linksFrom, loadLinks, saveLinks, type Links } from './links';
import { canEdit, clockSkew, editGate, HEARTBEAT_MS, lockReason, lockView, type LockRow, type LockView, type Role } from './lock';
import { bringIn, forUpload, realChange, type Changes } from './merge';
import { pullFlow, saveFlow, type Synced } from './sync';

export interface Me {
  id: string;
  name: string;
}

/** Someone with the project open. */
export interface Here {
  id: string;
  name: string;
  /** The sequence they have open. */
  seq: string;
  editing: boolean;
}

export interface Conflict {
  theirs: Synced;
  /** What both changed (plain words). */
  conflicts: string[];
}

export interface CollabState {
  role: Role;
  version: number;
  /** Others with the project open now. */
  here: Here[];
  locks: LockRow[];
  comments: ReviewComment[];
  saving: boolean;
  /** The last save or load that went wrong (empty: none). */
  problem: string;
  conflict: Conflict | null;
  /** The server answered lately. */
  online: boolean;
  /** Changes every few seconds so lock times are looked at again. */
  tick: number;
  /** A comment to show (picked on the timeline). */
  focus: string | null;
  /** A request to edit that the holder chose to ignore. */
  ignored: string | null;
}

export class Collab {
  state: CollabState;
  private listeners = new Set<() => void>();
  private synced: Synced;
  private links: Links;
  private skew = 0;
  private seq = '';
  private channel: RealtimeChannel | null = null;
  private timers: number[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private stopped = false;
  /** Told when a save of someone else came in (for a short note). */
  onNote: (text: string) => void = () => {};

  constructor(
    readonly id: string,
    role: Role,
    synced: Synced,
    readonly me: Me,
    readonly doc: Doc,
    private readonly db: cloud.Db = cloud.supabaseDb(),
  ) {
    this.synced = synced;
    this.links = loadLinks(id);
    this.state = {
      role,
      version: synced.version,
      here: [],
      locks: [],
      comments: [],
      saving: false,
      problem: '',
      conflict: null,
      online: true,
      tick: 0,
      focus: null,
      ignored: null,
    };
  }

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  private set(change: Partial<CollabState>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...change };
    for (const f of this.listeners) f();
  }

  /** One thing at a time with the server (saves and loads never overlap). */
  private run<T>(f: () => Promise<T>): Promise<T> {
    const next = this.chain.then(f, f);
    this.chain = next.catch(() => {});
    return next;
  }

  start() {
    this.stopped = false;
    this.doc.gate = this.gate;
    this.watch(this.doc.project.open);
    void this.loadComments();
    this.timers.push(
      window.setInterval(() => void this.heartbeat(), HEARTBEAT_MS),
      window.setInterval(() => void this.checkVersion(), 30_000),
      window.setInterval(() => this.set({ tick: this.state.tick + 1 }), 5_000),
    );
    window.addEventListener('beforeunload', this.leave);
    try {
      this.connect();
    } catch {
      // No live updates: the version is still looked at every 30 seconds.
    }
  }

  async stop() {
    window.removeEventListener('beforeunload', this.leave);
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.doc.gate === this.gate) this.doc.gate = null;
    this.leave();
    this.seq = '';
    if (this.channel) void this.db.removeChannel(this.channel);
    this.channel = null;
    this.stopped = true;
  }

  /** Let go of the sequence being edited (closing, or leaving the program). */
  private leave = () => {
    if (this.seq && this.view(this.seq).kind === 'mine') void cloud.releaseLock(this.id, this.seq, this.db).catch(() => {});
  };

  private connect() {
    const ch = this.db.channel(`lumora-edit:${this.id}`, { config: { presence: { key: this.me.id }, broadcast: { self: false } } });
    ch.on('presence', { event: 'sync' }, () => {
      const seen = new Map<string, Here>();
      for (const list of Object.values(ch.presenceState<Here>()))
        for (const h of list) if (h.id !== this.me.id) seen.set(h.id, { id: h.id, name: h.name, seq: h.seq, editing: h.editing });
      this.set({ here: [...seen.values()] });
    })
      .on('broadcast', { event: 'saved' }, (m: { payload?: { version?: number } }) => {
        if ((m.payload?.version ?? 0) > this.synced.version) void this.pull();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'editor_locks', filter: `project_id=eq.${this.id}` }, () => void this.refreshLocks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'editor_comments', filter: `project_id=eq.${this.id}` }, (c) =>
        this.set({ comments: applyChange(this.state.comments, c as unknown as CommentChange, this.id) }),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.announce();
      });
    this.channel = ch;
  }

  /** Tell the others where I am. */
  private announce() {
    void this.channel
      ?.track({ id: this.me.id, name: this.me.name, seq: this.seq, editing: this.view(this.seq).kind === 'mine' } satisfies Here)
      .catch(() => {});
  }

  /** The lock on a sequence, as it stands for me now. */
  view(seq: string): LockView {
    return lockView(
      this.state.locks.find((l) => l.seq_id === seq),
      this.me.id,
      Date.now() + this.skew,
    );
  }

  /** May this change be made (see Doc.gate)? */
  gate = (before: Project, after: Project): string | null =>
    editGate(before, after, this.state.role, (seq) =>
      lockReason(this.view(seq), before.sequences.find((s) => s.id === seq)?.name ?? 'this sequence', seq === before.open, this.state.online),
    );

  /** The sequence on the timeline changed: edit it if nobody else is. */
  watch(seq: string) {
    if (seq === this.seq) return;
    const old = this.seq;
    if (old && this.view(old).kind === 'mine')
      void cloud
        .releaseLock(this.id, old, this.db)
        .then(() => this.refreshLocks())
        .catch(() => {});
    this.seq = seq;
    this.set({ ignored: null });
    void this.heartbeat();
  }

  /** Renew my lock (or take it if it is free); everyone else just looks. */
  private async heartbeat() {
    if (this.stopped || !this.seq) return;
    try {
      if (canEdit(this.state.role)) {
        const { row, serverNow } = await cloud.takeLock(this.id, this.seq, this.db);
        this.skew = clockSkew(serverNow, Date.now());
        const locks = this.state.locks.filter((l) => l.seq_id !== this.seq);
        this.set({ locks: row ? [...locks, row] : locks, online: true });
        // The others' locks may have changed too.
        await this.refreshLocks();
      } else await this.refreshLocks();
    } catch {
      this.set({ online: false });
    }
    this.announce();
  }

  private async refreshLocks() {
    try {
      this.set({ locks: await cloud.readLocks(this.id, this.db), online: true });
    } catch {
      this.set({ online: false });
    }
  }

  /** Ask the person editing the open sequence to let me edit it. */
  async ask() {
    await cloud.requestLock(this.id, this.seq, this.db);
    await this.refreshLocks();
  }

  /** Give the open sequence to the person who asked for it. */
  async handOver() {
    if (this.doc.state.dirty) await this.save();
    await cloud.handOver(this.id, this.seq, this.db);
    await this.refreshLocks();
    this.announce();
  }

  /** Keep editing (hide the request until someone asks again). */
  ignore(name: string) {
    this.set({ ignored: name });
  }

  /** Save my changes as a new version (others' saves in between are brought in). */
  save(opts: { note?: string; keep?: boolean } = {}): Promise<void> {
    return this.run(async () => {
      if (!canEdit(this.state.role) || this.state.conflict || this.stopped) return;
      const sent = this.doc.project;
      // Only file places changed here: nothing new to put online.
      if (!realChange(this.synced.base, sent)) {
        this.rememberLinks();
        this.doc.saved();
        return;
      }
      this.set({ saving: true });
      try {
        const api = {
          save: (base: number, doc: Project) => cloud.saveShared(this.id, base, doc, opts, this.db),
          load: async () => {
            const o = await cloud.openShared(this.id, this.db);
            return { version: o.version, base: o.doc };
          },
        };
        const r = await saveFlow(api, this.synced, sent);
        const untouched = this.doc.project === sent;
        this.bring(r.brought);
        if (r.kind === 'conflict') {
          this.set({ saving: false, conflict: { theirs: r.theirs, conflicts: r.conflicts }, problem: '' });
          return;
        }
        this.synced = r.synced;
        this.rememberLinks();
        if (untouched) this.doc.saved();
        this.set({ saving: false, version: r.synced.version, problem: '', online: true });
        void this.channel?.send({ type: 'broadcast', event: 'saved', payload: { version: r.synced.version, by: this.me.name } }).catch(() => {});
      } catch (e) {
        this.set({ saving: false, problem: cloud.plain(e).message });
      }
    });
  }

  private bring(brought: Changes[]) {
    if (brought.length) this.doc.rebase((p) => applyLinks(brought.reduce(bringIn, p), this.links));
  }

  /** Others may have saved (a quick look at the version number). */
  private async checkVersion() {
    try {
      const v = await cloud.latestVersion(this.id, this.db);
      this.set({ online: true });
      if (v > this.synced.version) await this.pull();
    } catch {
      this.set({ online: false });
    }
  }

  /** Bring in someone else's save. */
  pull(): Promise<void> {
    return this.run(async () => {
      if (this.state.conflict || this.stopped) return;
      try {
        const o = await cloud.openShared(this.id, this.db);
        if (o.role !== this.state.role) this.set({ role: o.role });
        const r = pullFlow(this.synced, this.doc.project, { version: o.version, base: o.doc });
        if (r.kind === 'same') return;
        if (r.kind === 'conflict') {
          this.set({ conflict: { theirs: r.theirs, conflicts: r.conflicts } });
          return;
        }
        const wasClean = !this.doc.state.dirty;
        this.bring([r.changes]);
        this.synced = r.synced;
        if (wasClean) this.doc.saved();
        this.set({ version: r.synced.version, problem: '' });
        this.onNote(`Brought in version ${r.synced.version}`);
      } catch (e) {
        this.set({ problem: cloud.plain(e).message });
      }
    });
  }

  /** After a conflict: take their version, dropping my unsaved changes. */
  reloadTheirs() {
    const c = this.state.conflict;
    if (!c) return;
    this.synced = c.theirs;
    this.doc.replace(applyLinks(c.theirs.base, this.links));
    this.set({ conflict: null, version: c.theirs.version });
  }

  /** After a conflict: keep theirs here and put mine online as a new project. Returns its id. */
  async saveMineAsCopy(): Promise<string> {
    const mine = this.doc.project;
    const id = await cloud.shareProject({ ...mine, name: `${mine.name} (my copy)` }, this.db);
    // The copy has my own file places.
    saveLinks(id, {});
    this.reloadTheirs();
    return id;
  }

  /** Go back to an earlier version: it becomes the newest one (nothing is lost). */
  restore(version: number, old: Project): Promise<void> {
    return this.run(async () => {
      if (!canEdit(this.state.role)) throw new Error('You can view this project but not change it.');
      const note = `Restored version ${version}`;
      let latest = this.synced;
      for (let i = 0; i < 3; i++) {
        // Media that is still shared keeps the newest shared file places.
        const doc = forUpload(old, latest.base);
        const v = await cloud.saveShared(this.id, latest.version, doc, { note, keep: true }, this.db);
        if (v !== null) {
          this.synced = { version: v, base: doc };
          this.doc.replace(applyLinks(doc, this.links));
          this.set({ version: v, conflict: null, problem: '' });
          void this.channel?.send({ type: 'broadcast', event: 'saved', payload: { version: v, by: this.me.name } }).catch(() => {});
          return;
        }
        const o = await cloud.openShared(this.id, this.db);
        latest = { version: o.version, base: o.doc };
      }
      throw new Error('Others keep saving this project. Try again in a moment.');
    });
  }

  /** Files found on this computer (they stay here, not online). */
  rememberLinks() {
    this.links = linksFrom(this.doc.project, this.synced.base, this.links);
    saveLinks(this.id, this.links);
  }

  private async loadComments() {
    try {
      this.set({ comments: await cloud.listComments(this.id, this.db) });
    } catch (e) {
      this.set({ problem: cloud.plain(e).message });
    }
  }

  async addComment(seq: string, frame: number, text: string) {
    const c = await cloud.addComment(this.id, seq, frame, text, this.db);
    this.set({ comments: applyChange(this.state.comments, { eventType: 'INSERT', new: toRow(c), old: {} }, this.id), focus: c.id });
  }

  async resolve(c: ReviewComment, resolved: boolean) {
    const before = this.state.comments;
    this.set({ comments: before.map((x) => (x.id === c.id ? { ...x, resolved } : x)) });
    try {
      await cloud.setResolved(c.id, resolved, this.db);
    } catch (e) {
      this.set({ comments: before });
      throw e;
    }
  }

  async remove(c: ReviewComment) {
    await cloud.deleteComment(c.id, this.db);
    this.set({ comments: this.state.comments.filter((x) => x.id !== c.id) });
  }

  focus(id: string | null) {
    this.set({ focus: id });
  }
}

const toRow = (c: ReviewComment) => ({
  id: c.id,
  seq_id: c.seq,
  frame: c.frame,
  author: c.author,
  author_name: c.authorName,
  text: c.text,
  resolved: c.resolved,
  created_at: new Date(c.at).toISOString(),
});

const NONE: CollabState | null = null;
const noop = () => () => {};

/** The shared project's state, or null for a project on this computer only. */
export function useCollab(c: Collab | null): CollabState | null {
  return useSyncExternalStore(c ? c.subscribe : noop, () => (c ? c.state : NONE));
}
