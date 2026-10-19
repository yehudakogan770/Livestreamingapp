import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a8bbcedf6528e53f8/editor/app/src')

s = ''


def rep(a, b):
    global s
    assert a in s, a[:100]
    s = s.replace(a, b, 1)


p = 'ui/Editor.tsx'
s = open(p).read()
rep("""import { Timeline } from './Timeline';
""", """import { Timeline } from './Timeline';
import { authOn } from '../../../../app/src/auth/config';
import type { SharedOpen } from '../App';
import { Collab, useCollab } from '../collab/session';
import { canEdit } from '../collab/lock';
import { CommentsPanel, ConflictDialog, HereChips, LockBanner } from '../collab/CollabUi';
import { HistoryDialog, ShareDialog } from '../collab/CollabDialogs';
""")
rep("""  savePath,
  onClose,
  onOpen,
  onNew,
}: {
  project: Project;
  savePath: string;
  onClose: () => void;""", """  savePath,
  shared,
  onOpenShared,
  onClose,
  onOpen,
  onNew,
}: {
  project: Project;
  savePath: string;
  /** Opened from online (a team project); null for a file on this computer. */
  shared: SharedOpen | null;
  onOpenShared: (id: string) => void;
  onClose: () => void;""")
rep("""  const { access, signOut } = useAccess();
""", """  const { access, signOut } = useAccess();
  const userId = access?.userId ?? '';
  const userName = access ? access.name || access.email : '';

  // A shared project: locks, saving online, others' saves and comments.
  const collab = useMemo(
    () => (shared && userId ? new Collab(shared.id, shared.role, { version: shared.version, base: shared.base }, { id: userId, name: userName }, doc) : null),
    [shared, userId, userName, doc],
  );
  const cs = useCollab(collab);
  useEffect(() => {
    if (!collab) return;
    collab.onNote = (t) => ui.note(t);
    doc.blocked = (why) => ui.note(why);
    collab.start();
    return () => void collab.stop();
  }, [collab, doc, ui]);
  // Edit the sequence on the timeline (if nobody else is).
  useEffect(() => collab?.watch(state.project.open), [collab, state.project.open]);
""")
rep("""  // Look for files that have moved since the project was saved.
  useEffect(() => {
    if (!inApp()) return;
    void (async () => {
      const gone: string[] = [];
      for (const m of doc.project.media) if (!(await native.fileExists(m.path)) && !(m.proxy && (await native.fileExists(m.proxy)))) gone.push(m.id);
      if (gone.length) {
        doc.quiet((p) => ({ ...p, media: p.media.map((m) => (gone.includes(m.id) ? { ...m, missing: true } : m)) }));
        setMissing(gone);
      }
    })();
  }, [doc]);""", """  // Look for files that have moved since the project was saved (or, in a
  // shared project, that someone else added and this computer doesn't have).
  const mediaCount = state.project.media.length;
  useEffect(() => {
    if (!inApp()) return;
    let stale = false;
    void (async () => {
      const gone: string[] = [];
      for (const m of doc.project.media) if (!(await native.fileExists(m.path)) && !(m.proxy && (await native.fileExists(m.proxy)))) gone.push(m.id);
      if (stale) return;
      if (gone.length) doc.quiet((p) => ({ ...p, media: p.media.map((m) => (gone.includes(m.id) ? { ...m, missing: true } : m)) }));
      setMissing(gone);
    })();
    return () => {
      stale = true;
    };
  }, [doc, mediaCount]);""")
rep("""  // Saved as you go.
  const saving = useRef(0);
  useEffect(() => {
    if (!state.dirty || !path || !inApp()) return;""", """  // Saved as you go (online for a shared project, a little less often).
  const saving = useRef(0);
  const tick = cs?.tick ?? 0;
  const mayEdit = !cs || canEdit(cs.role);
  const conflict = !!cs?.conflict;
  useEffect(() => {
    if (!collab || !state.dirty || !mayEdit || conflict) return;
    clearTimeout(saving.current);
    saving.current = window.setTimeout(() => void collab.save(), 2500);
    return () => clearTimeout(saving.current);
  }, [collab, state.dirty, state.project, mayEdit, conflict, tick]);
  useEffect(() => {
    if (collab || !state.dirty || !path || !inApp()) return;""")
rep("""  }, [state.dirty, state.project, path, doc, engine]);""", """  }, [collab, state.dirty, state.project, path, doc, engine]);""")
rep("""        'Find missing files',
      );""", """        'Find missing files',
      );
    // In a shared project, where the files are stays on this computer.
    collab?.rememberLinks();""")
rep("""        { label: 'Find missing files…', disabled: missing.length === 0, run: () => void relink() },""", """        { label: 'Find missing files…', disabled: missing.length === 0, run: () => void relink() },
        ...(authOn()
          ? [
              'sep' as const,
              { label: collab ? 'People on this project…' : 'Share project…', run: () => ui.set({ dialog: 'share' }) },
              { label: 'Version history…', disabled: !collab, run: () => ui.set({ dialog: 'history' }) },
            ]
          : []),""")
rep("""  const savedText = !inApp() ? 'Demo (not saved)' : saveProblem ? `Not saved: ${saveProblem}` : !path ? 'Not saved yet' : state.dirty ? 'Saving…' : 'Saved';""", """  const savedText = cs
    ? cs.conflict
      ? 'Not saved: someone else changed the same thing'
      : cs.problem
        ? `Not saved: ${cs.problem}`
        : !canEdit(cs.role)
          ? 'View only'
          : state.dirty || cs.saving
            ? 'Saving…'
            : `Saved online · v${cs.version}`
    : !inApp()
      ? 'Demo (not saved)'
      : saveProblem
        ? `Not saved: ${saveProblem}`
        : !path
          ? 'Not saved yet'
          : state.dirty
            ? 'Saving…'
            : 'Saved';
  const problemShown = cs ? !!(cs.problem || cs.conflict) : !!saveProblem;""")
rep("""        <span className="ed__name" title={path || 'Not saved yet'}>
          {state.project.name}
        </span>""", """        <span className="ed__name" title={collab ? 'Shared project (online)' : path || 'Not saved yet'}>
          {state.project.name}
        </span>
        {collab && <HereChips collab={collab} doc={doc} />}""")
rep("""<span className={`ed__saved${saveProblem ? ' is-problem' : ''}`}>{savedText}</span>""", """<span className={`ed__saved${problemShown ? ' is-problem' : ''}`} title={savedText}>
          {savedText}
        </span>""")
rep("""      {u.page === 'edit' && <EditPage doc={doc} engine={engine} ui={ui} actions={actions} />}""", """      {collab && <LockBanner collab={collab} doc={doc} />}

      {u.page === 'edit' && <EditPage doc={doc} engine={engine} ui={ui} actions={actions} collab={collab} />}""")
rep("""            <Timeline doc={doc} engine={engine} ui={ui} actions={actions} />
          </div>
        </div>
      )}

      <footer""", """            <Timeline doc={doc} engine={engine} ui={ui} actions={actions} collab={collab} />
          </div>
        </div>
      )}

      <footer""")
rep("""      {u.dialog === 'help' && <HelpDialog ui={ui} />}""", """      {u.dialog === 'help' && <HelpDialog ui={ui} />}
      {u.dialog === 'share' && (
        <ShareDialog
          doc={doc}
          collab={collab}
          signedIn={!!access}
          onClose={() => ui.set({ dialog: null })}
          onShared={(id) => {
            ui.set({ dialog: null });
            onOpenShared(id);
          }}
          onLeft={() => {
            ui.set({ dialog: null });
            onClose();
          }}
        />
      )}
      {u.dialog === 'history' && collab && <HistoryDialog collab={collab} onClose={() => ui.set({ dialog: null })} />}
      {collab && <ConflictDialog collab={collab} onOpenShared={onOpenShared} />}""")
rep("""function EditPage({ doc, engine, ui, actions }: { doc: Doc; engine: Engine; ui: Ui; actions: Actions }) {
  const u = useUi(ui);
  const [leftTab, setLeftTab] = useState<'controls' | 'source'>('controls');""", """function EditPage({ doc, engine, ui, actions, collab }: { doc: Doc; engine: Engine; ui: Ui; actions: Actions; collab: Collab | null }) {
  const u = useUi(ui);
  const cs = useCollab(collab);
  const [leftTab, setLeftTab] = useState<'controls' | 'source' | 'comments'>('controls');
  // A comment picked on the timeline shows in the comments.
  const focus = cs?.focus ?? null;
  useEffect(() => {
    if (focus) setLeftTab('comments');
  }, [focus]);""")
rep("""              Source
            </button>
          </div>
          {leftTab === 'controls' ? (""", """              Source
            </button>
            {collab && (
              <button
                type="button"
                role="tab"
                aria-selected={leftTab === 'comments'}
                className={leftTab === 'comments' ? 'is-on' : ''}
                onClick={() => setLeftTab('comments')}
              >
                Comments
              </button>
            )}
          </div>
          {leftTab === 'comments' && collab ? (
            <CommentsPanel collab={collab} doc={doc} engine={engine} />
          ) : leftTab === 'controls' ? (""")
rep("""        <Splitter ui={ui} which="left" />
        <Timeline doc={doc} engine={engine} ui={ui} actions={actions} />""", """        <Splitter ui={ui} which="left" />
        <Timeline doc={doc} engine={engine} ui={ui} actions={actions} collab={collab} />""")
open(p, 'w').write(s)

p = 'ui/Timeline.tsx'
s = open(p).read()
rep("""export function Timeline({ doc, engine, ui, actions }: { doc: Doc; engine: Engine; ui: Ui; actions: Actions }) {
  const { project, selection } = useDoc(doc);""", """export function Timeline({ doc, engine, ui, actions, collab = null }: { doc: Doc; engine: Engine; ui: Ui; actions: Actions; collab?: Collab | null }) {
  const { project, selection } = useDoc(doc);
  const cs = useCollab(collab);""")
rep("""<Ruler s={s} zoom={zoom} fps={fps} from={scroll.x} width={size.w} doc={doc} engine={engine} />""", """<Ruler
              s={s}
              zoom={zoom}
              fps={fps}
              from={scroll.x}
              width={size.w}
              doc={doc}
              engine={engine}
              pins={cs ? pins(cs.comments, s.id) : []}
              onPin={(p) => {
                engine.seek(p.frame);
                collab?.focus(p.ids[0] ?? null);
              }}
            />""")
rep("""  doc,
  engine,
}: {
  s: ReturnType<typeof current>;
  zoom: number;
  fps: number;
  from: number;
  width: number;
  doc: Doc;
  engine: Engine;
}) {""", """  doc,
  engine,
  pins: commentPins,
  onPin,
}: {
  s: ReturnType<typeof current>;
  zoom: number;
  fps: number;
  from: number;
  width: number;
  doc: Doc;
  engine: Engine;
  /** Review comments (shared projects). */
  pins: Pin[];
  onPin: (p: Pin) => void;
}) {""")
rep("""          {m.name && zoom * 60 > m.name.length * 6 ? <span>{m.name}</span> : null}
        </button>
      ))}""", """          {m.name && zoom * 60 > m.name.length * 6 ? <span>{m.name}</span> : null}
        </button>
      ))}
      {commentPins.map((p) => (
        <button
          key={`c${p.frame}`}
          type="button"
          className={`ruler__comment${p.resolved ? ' is-done' : ''}`}
          style={{ left: p.frame * zoom }}
          title={p.title}
          aria-label={`${p.ids.length} comment${p.ids.length === 1 ? '' : 's'}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPin(p);
          }}
        >
          {p.ids.length > 1 ? p.ids.length : ''}
        </button>
      ))}""")
open(p, 'w').write(s)
print('done')
