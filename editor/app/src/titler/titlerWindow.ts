// Lumora Studio's Titler window: the designer in its own window (like
// Lumora's), talking to the editor window. The Titler window asks for the
// title of the clip it was opened for; "Use in this clip" sends the design
// back and the editor puts it into the clip (or adds a new title clip, which
// the window then keeps working on). Messages go by Tauri events in the app
// and by a BroadcastChannel in a browser.

import type { TitleProject, Values } from '../../../../titler/src/core/types';

export type TitlerMsg =
  /** The window is open (or was asked for another clip): what is in `target`? */
  | { kind: 'hello'; target: string | null }
  /** The editor's answer: the clip's title (null: a new title), its field values and name. */
  | { kind: 'open'; asked: string | null; target: string | null; project: TitleProject | null; values: Values; name: string }
  /** Use this design in `target` (null: add a new title clip at the playhead). */
  | { kind: 'use'; target: string | null; project: TitleProject; seq: number }
  /** Done: the clip it is in now (a new clip's id). */
  | { kind: 'used'; seq: number; target: string | null; name: string; error?: string };

export interface Channel {
  send(m: TitlerMsg): void;
  listen(fn: (m: TitlerMsg) => void): () => void;
}

const EVENT = 'studio-titler';

/** The channel between Studio's windows (Tauri events in the app, a BroadcastChannel in a browser). */
export async function studioChannel(inApp: boolean): Promise<Channel> {
  if (inApp) {
    const ev = await import('@tauri-apps/api/event');
    return {
      send: (m) => void ev.emit(EVENT, m),
      listen: (fn) => {
        let un: (() => void) | null = null;
        let gone = false;
        void ev.listen<TitlerMsg>(EVENT, (e) => fn(e.payload)).then((u) => (gone ? u() : (un = u)));
        return () => {
          gone = true;
          un?.();
        };
      },
    };
  }
  const bc = new BroadcastChannel(EVENT);
  return {
    send: (m) => bc.postMessage(m),
    listen: (fn) => {
      const on = (e: MessageEvent<TitlerMsg>) => fn(e.data);
      bc.addEventListener('message', on);
      return () => bc.removeEventListener('message', on);
    },
  };
}

/** What the editor window needs to answer the Titler window. */
export interface EditorSide {
  /** A title clip's design, values and name (undefined: no such clip). */
  clip(id: string): { project: TitleProject; values: Values; name: string } | undefined;
  /** Put a design into a clip. */
  use(project: TitleProject, id: string): unknown;
  /** Add a new title clip; returns its id ('' when it could not be added). */
  add(project: TitleProject): string;
}

/** The editor window's side: answers the Titler window. Returns how to stop. */
export function serveTitler(ch: Channel, side: EditorSide): () => void {
  return ch.listen((m) => {
    if (m.kind === 'hello') {
      const c = m.target ? side.clip(m.target) : undefined;
      ch.send({
        kind: 'open',
        asked: m.target,
        target: c ? m.target : null,
        project: c ? (JSON.parse(JSON.stringify(c.project)) as TitleProject) : null,
        values: c?.values ?? {},
        name: c?.name ?? '',
      });
    } else if (m.kind === 'use') {
      try {
        if (m.target && side.clip(m.target)) {
          side.use(m.project, m.target);
          ch.send({ kind: 'used', seq: m.seq, target: m.target, name: side.clip(m.target)?.name ?? m.project.name });
        } else {
          const id = side.add(m.project);
          ch.send(
            id
              ? { kind: 'used', seq: m.seq, target: id, name: m.project.name }
              : { kind: 'used', seq: m.seq, target: null, name: '', error: 'There is no free video track for the title.' },
          );
        }
      } catch (e) {
        ch.send({ kind: 'used', seq: m.seq, target: m.target, name: '', error: e instanceof Error ? e.message : String(e) });
      }
    }
  });
}

/** The Titler window's side: ask for a clip, and send designs back. */
export class TitlerClient {
  private seq = 0;
  private waiting = new Map<number, (m: Extract<TitlerMsg, { kind: 'used' }>) => void>();
  private un: () => void;
  /** The clip it works on (null: a new title, until it is added). */
  target: string | null;
  private asked: string | null;

  constructor(
    private readonly ch: Channel,
    target: string | null,
    private readonly onOpen: (m: Extract<TitlerMsg, { kind: 'open' }>) => void,
  ) {
    this.target = target;
    this.asked = target;
    this.un = ch.listen((m) => {
      if (m.kind === 'open' && m.asked === this.asked) {
        this.target = m.target;
        onOpen(m);
      }
      if (m.kind === 'used') {
        const w = this.waiting.get(m.seq);
        if (w) {
          this.waiting.delete(m.seq);
          w(m);
        }
      }
    });
  }

  /** Ask for a clip's title (the window was opened, or asked for another clip). */
  ask(target: string | null): void {
    this.target = target;
    this.asked = target;
    this.ch.send({ kind: 'hello', target });
  }

  /** Send a design to the clip (or as a new one); resolves with where it went. */
  use(project: TitleProject, timeoutMs = 5000): Promise<{ target: string | null; name: string }> {
    const seq = ++this.seq + Math.floor(Math.random() * 1e6) * 1000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(seq);
        reject(new Error('Lumora Studio did not answer. Is its window still open?'));
      }, timeoutMs);
      this.waiting.set(seq, (m) => {
        clearTimeout(timer);
        if (m.error) return reject(new Error(m.error));
        this.target = m.target;
        resolve({ target: m.target, name: m.name });
      });
      this.ch.send({ kind: 'use', target: this.target, project, seq });
    });
  }

  close(): void {
    this.un();
  }
}
