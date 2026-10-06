// Keeping the person's event safe while the test event runs.
//
// The test switches Lumora to a temporary show (src-tauri/src/testevent.rs
// puts the person's show and settings aside in a marker file first). Whatever
// happens — the test finishes, the person presses Stop, a step throws — every
// "undo" registered here runs, newest first, each exactly once, and one that
// fails never stops the others. If putting the show back fails, the marker
// stays and Lumora puts it back the next time it starts.

export interface UndoResult {
  name: string;
  ok: boolean;
  error?: string;
}

export class Undo {
  private tasks: { name: string; run: () => Promise<unknown> | unknown }[] = [];
  private ran = false;

  /** Something to undo at the end (runs before what was added earlier). */
  add(name: string, run: () => Promise<unknown> | unknown): void {
    if (this.ran) {
      // Too late to wait for the end: undo it now.
      void Promise.resolve()
        .then(run)
        .catch(() => {});
      return;
    }
    this.tasks.push({ name, run });
  }

  get pending(): string[] {
    return this.tasks.map((t) => t.name).reverse();
  }

  /** Runs every undo once, newest first. Never throws. */
  async runAll(): Promise<UndoResult[]> {
    if (this.ran) return [];
    this.ran = true;
    const out: UndoResult[] = [];
    for (const t of [...this.tasks].reverse()) {
      try {
        await t.run();
        out.push({ name: t.name, ok: true });
      } catch (e) {
        out.push({ name: t.name, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    this.tasks = [];
    return out;
  }
}

export interface SessionApi {
  /** Put the person's show aside and switch to the test show; resolves the test folder. */
  begin(userDrive: boolean): Promise<{ folder: string }>;
  /** Put the person's show back; false: there was nothing to put back. */
  end(): Promise<boolean>;
  /** Remove the test folder and the replays the test made. */
  cleanup(folder: string, replays: string[]): Promise<void>;
}

export interface SessionResult<T> {
  value: T | null;
  error: unknown;
  /** The person's show came back (null: the test never switched shows). */
  restored: boolean | null;
  undo: UndoResult[];
}

/**
 * Runs `body` inside a test session: the person's show is put aside first and
 * always put back after (then the test's files are removed), whatever `body` does.
 */
export async function withTestSession<T>(
  api: SessionApi,
  userDrive: boolean,
  body: (s: { folder: string; undo: Undo; replays: string[] }) => Promise<T>,
  afterRestore?: () => Promise<void>,
): Promise<SessionResult<T>> {
  const undo = new Undo();
  let begun: { folder: string };
  try {
    begun = await api.begin(userDrive);
  } catch (e) {
    return { value: null, error: e, restored: null, undo: [] };
  }
  const replays: string[] = [];
  let restored: boolean | null = false;
  // Registered first, so it runs last: after everything the test started is undone.
  undo.add('remove the test files', () => api.cleanup(begun.folder, replays));
  undo.add('put your event back', async () => {
    restored = await api.end();
    // `end` says false when the marker was already gone: nothing to restore, nothing lost.
    if (!restored) restored = true;
    await afterRestore?.();
  });
  let value: T | null = null;
  let error: unknown = null;
  try {
    value = await body({ folder: begun.folder, undo, replays });
  } catch (e) {
    error = e;
  }
  const results = await undo.runAll();
  if (results.some((r) => r.name === 'put your event back' && !r.ok)) restored = false;
  return { value, error, restored, undo: results };
}
