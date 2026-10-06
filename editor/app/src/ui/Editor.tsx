import {
  AudioLines,
  Check,
  ChevronDown,
  CircleAlert,
  Cloud,
  FileText,
  FileVideo,
  Film,
  MessageSquare,
  Palette,
  Redo2,
  Save,
  SlidersHorizontal,
  SquarePlay,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useAccess } from '../../../../app/src/auth/Gate';
import { AccountDialog } from '../../../../app/src/auth/AccountDialog';
import { Doc, useDoc } from '../doc';
import { addCaptionTrack, captionTracks, mergeCaptions, splitCaption } from '../model/captions';
import { current, end } from '../model/seq';
import type { Project } from '../model/types';
import { Engine } from '../player/engine';
import { fileName, folderOf, inApp, native } from '../native';
import { makeActions, type Actions } from './actions';
import { ColorPanel, Scopes } from './ColorPage';
import { PopMenu, type MenuEntry } from './controls';
import { HelpDialog, SequenceDialog, SpeedDialog } from './Dialogs';
import { DeliverDialog, QueueChip } from './Deliver';
import { ManagePanels } from './Manage';
import { panels } from './panels';
import { keys, shortcutFor } from './shortcuts';
import { applyWorkspace, BUILT_IN_WORKSPACES, savedWorkspaces } from './workspaces';
import { Autosaver } from '../manage/recovery';
import { typing } from './hooks';
import { chooseAndImport, importFiles, makeProxies, MEDIA_EXTENSIONS, proxyOptions, setProxyFocus } from './importer';
import { renderCache } from '../cache/manager';
import { CacheDialog, cacheMenu } from '../cache/CacheDialog';
import { Inspector } from './Inspector';
import { makeCaptions, saveCaptionFile, TranscribeDialog, TranscriptPanel } from './Speech';
import { SmartDialogs, smartMenu } from '../smart/SmartTools';
import { ExtrasDialogs, extrasMenu } from '../extras/ExtrasTools';
import { Mixer } from './Mixer';
import { ProgramMonitor, SourceMonitor } from './Monitors';
import { ProjectPanel } from './ProjectPanel';
import { Ui, useUi } from './state';
import { Timeline } from './Timeline';
import { authOn } from '../../../../app/src/auth/config';
import type { SharedOpen } from '../App';
import { Collab, useCollab } from '../collab/session';
import { canEdit } from '../collab/lock';
import { CommentsPanel, ConflictDialog, HereChips, LockBanner } from '../collab/CollabUi';
import { HistoryDialog, ShareDialog } from '../collab/CollabDialogs';
import { nativePlayback } from '../render/native/client';
import { openProblemReport, useErrorReports } from '../../../../app/src/reports/ReportUI';
import { openSystemCheck } from '../../../../app/src/syscheck/SystemCheck';

/** The project file's text: without this computer's missing marks, with the playhead where it is. */
function projectText(p: Project, playhead: number): string {
  return JSON.stringify({
    ...p,
    media: p.media.map(({ missing: _m, ...m }) => m),
    sequences: p.sequences.map((s) => (s.id === p.open ? { ...s, playhead } : s)),
  });
}

export function Editor({
  project,
  savePath,
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
  onClose: () => void;
  onOpen: () => void;
  onNew: () => void;
}) {
  const doc = useMemo(() => new Doc(project), [project]);
  const ui = useMemo(() => new Ui(), []);
  const engine = useMemo(() => {
    const e = new Engine();
    e.setProject(project);
    if (inApp()) e.readText = native.readText;
    e.native = nativePlayback;
    return e;
  }, [project]);
  const actions = useMemo(() => makeActions(doc, engine, ui), [doc, engine, ui]);
  const state = useDoc(doc);
  const u = useUi(ui);
  const [path, setPath] = useState(savePath);
  const [saveProblem, setSaveProblem] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const { access, signOut } = useAccess();
  const [accountOpen, setAccountOpen] = useState(false);
  const [reportsOn, toggleReports] = useErrorReports();
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

  useEffect(() => {
    engine.start();
    nativePlayback.onNote = (t) => ui.note(t);
    return () => {
      engine.release();
      void nativePlayback.stop();
    };
  }, [engine, ui]);
  useEffect(() => engine.setProject(state.project), [engine, state.project]);
  useEffect(() => {
    engine.quality = u.quality;
    engine.redraw();
  }, [engine, u.quality]);
  useEffect(() => {
    engine.useProxies = u.proxies;
  }, [engine, u.proxies]);
  // The render cache plays heavy stretches from cached files and makes them while playback is stopped;
  // proxies are made nearest the playhead first.
  useEffect(() => {
    engine.cached = renderCache.opsAt;
    proxyOptions.hardware = renderCache.settings.hwEncode;
    const focus = () => ({ project: engine.project, playing: engine.isPlaying, playhead: Math.floor(engine.time), proxies: engine.useProxies });
    void renderCache.start(focus);
    setProxyFocus(() => ({ p: engine.project, playhead: Math.floor(engine.time) }));
    const redraw = renderCache.subscribe(() => engine.redraw());
    return () => {
      redraw();
      renderCache.stop();
      engine.cached = null;
    };
  }, [engine]);

  // Look for files that have moved since the project was saved (or, in a
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
      // Playback proxies that are gone (a cleared cache) are made again, and heavy files without one get one.
      const lost: string[] = [];
      for (const m of doc.project.media) if (m.playbackProxy && !(await native.fileExists(m.playbackProxy))) lost.push(m.id);
      if (stale) return;
      if (lost.length) doc.quiet((p) => ({ ...p, media: p.media.map((m) => (lost.includes(m.id) ? { ...m, playbackProxy: null } : m)) }));
      makeProxies(doc, doc.project.media);
    })();
    return () => {
      stale = true;
    };
  }, [doc, mediaCount]);

  // Saved as you go (online for a shared project, a little less often).
  const saving = useRef(0);
  // Writes to the project file go one after another (an older one never lands after a newer one).
  const writes = useRef<Promise<void>>(Promise.resolve());
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
    if (collab || !state.dirty || !path || !inApp()) return;
    clearTimeout(saving.current);
    saving.current = window.setTimeout(() => {
      const sent = doc.project;
      const text = projectText(sent, Math.floor(engine.time));
      writes.current = writes.current
        .then(() => native.writeText(path, text))
        .then(() => {
          // Changes made while it was being written stay unsaved (and are saved next).
          doc.saved(sent);
          setSaveProblem('');
        })
        .catch((e: unknown) => setSaveProblem(e instanceof Error ? e.message : String(e)));
    }, 1200);
    return () => clearTimeout(saving.current);
  }, [collab, state.dirty, state.project, path, doc, engine]);

  // Autosaved every minute into the recovery folder (versioned backups, and crash recovery).
  const pathNow = useRef(path);
  pathNow.current = path;
  const autosaver = useMemo(() => (shared ? null : new Autosaver(doc, () => pathNow.current)), [doc, shared]);
  useEffect(() => {
    if (!autosaver) return;
    autosaver.start();
    const bye = () => void autosaver.stop();
    window.addEventListener('beforeunload', bye);
    return () => {
      window.removeEventListener('beforeunload', bye);
      void autosaver.stop();
    };
  }, [autosaver]);
  useEffect(() => autosaver?.moved(), [autosaver, path]);

  const saveAs = async () => {
    if (!inApp()) return;
    const picked = await save({
      title: 'Save the project',
      defaultPath: path || `${doc.project.name}.lumoraedit`,
      filters: [{ name: 'Lumora Studio project', extensions: ['lumoraedit'] }],
    });
    if (!picked) return;
    const sent = doc.project;
    await native.writeText(picked, projectText(sent, Math.floor(engine.time)));
    setPath(picked);
    doc.saved(sent);
    ui.note(`Saved as ${fileName(picked)}`);
  };

  const relink = async () => {
    const folder = await open({ title: 'Where are the missing files?', directory: true });
    if (typeof folder !== 'string') return;
    let found = 0;
    const changes = new Map<string, string>();
    for (const id of missing) {
      const m = doc.project.media.find((x) => x.id === id);
      if (!m) continue;
      const p = await native.findByName(folder, fileName(m.path));
      if (p) {
        changes.set(id, p);
        found += 1;
      }
    }
    if (found)
      doc.edit(
        (p) => ({ ...p, media: p.media.map((m) => (changes.has(m.id) ? { ...m, path: changes.get(m.id) as string, missing: false } : m)) }),
        'Find missing files',
      );
    // In a shared project, where the files are stays on this computer.
    collab?.rememberLinks();
    const still = missing.filter((id) => !changes.has(id));
    setMissing(still);
    ui.note(found ? `Found ${found} file${found === 1 ? '' : 's'}` : 'None of the missing files were in that folder');
  };

  // Files dropped on the window come in as media.
  useEffect(() => {
    if (!inApp()) return;
    let stop: (() => void) | null = null;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type !== 'drop') return;
        const paths = e.payload.paths.filter((p) => MEDIA_EXTENSIONS.includes((p.split('.').pop() ?? '').toLowerCase()));
        if (paths.length) void importFiles(doc, paths, null);
      })
      .then((u2) => (stop = u2));
    return () => stop?.();
  }, [doc]);

  // The keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || ui.state.dialog || panels.open) return;
      if ((e.target as HTMLElement | null)?.closest?.('.vmon--source')) return;
      // The shortcut editor's keys first; older key handling only for keys it doesn't know.
      const sc = shortcutFor(e, actions, ui);
      const run = sc === 'claimed' ? null : (sc ?? keymap(e, actions, ui));
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, ui]);

  const s = current(state.project);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const menus: [string, () => MenuEntry[]][] = [
    [
      'File',
      () => [
        { label: 'New project…', run: onNew },
        { label: 'Open…', keys: 'Ctrl+O', run: onOpen },
        { label: 'Save as…', keys: 'Ctrl+Shift+S', run: () => void saveAs(), disabled: !inApp() },
        'sep',
        { label: 'Import…', keys: 'Ctrl+I', run: () => void chooseAndImport(doc, null), disabled: !inApp() },
        { label: 'Export…', keys: 'Ctrl+M', run: () => ui.set({ dialog: 'export' }) },
        { label: 'Render queue…', run: () => panels.show({ kind: 'queue' }) },
        'sep',
        { label: 'Collect files / archive…', disabled: !inApp(), run: () => panels.show({ kind: 'archive' }) },
        { label: 'Backups (autosaved versions)…', disabled: !autosaver || !inApp(), run: () => panels.show({ kind: 'backups' }) },
        'sep',
        { label: 'Find missing files…', disabled: missing.length === 0, run: () => void relink() },
        ...(authOn()
          ? [
              'sep' as const,
              { label: collab ? 'People on this project…' : 'Share project…', run: () => ui.set({ dialog: 'share' }) },
              { label: 'Version history…', disabled: !collab, run: () => ui.set({ dialog: 'history' }) },
            ]
          : []),
        { label: 'Close project', run: onClose },
        ...(access ? ['sep' as const, { label: 'My account…', run: () => setAccountOpen(true) }, { label: `Sign out (${access.email})`, run: signOut }] : []),
      ],
    ],
    [
      'Edit',
      () => [
        { label: `Undo ${doc.undoLabel}`, keys: 'Ctrl+Z', run: actions.undo, disabled: !state.canUndo },
        { label: `Redo ${doc.redoLabel}`, keys: 'Ctrl+Shift+Z', run: actions.redo, disabled: !state.canRedo },
        { label: 'Undo history…', keys: 'Ctrl+Alt+Z', run: () => panels.show({ kind: 'undo' }) },
        'sep',
        { label: 'Cut', keys: 'Ctrl+X', run: actions.cut },
        { label: 'Copy', keys: 'Ctrl+C', run: actions.copy },
        { label: 'Paste', keys: 'Ctrl+V', run: () => actions.paste() },
        { label: 'Paste insert', keys: 'Ctrl+Shift+V', run: () => actions.paste(true) },
        { label: 'Paste attributes', keys: 'Ctrl+Alt+V', run: actions.pasteAttributes },
        { label: 'Duplicate', run: actions.duplicate },
        'sep',
        { label: 'Clear', keys: 'Delete', run: actions.del },
        { label: 'Ripple delete', keys: 'Shift+Delete', run: actions.rippleDelete },
        'sep',
        { label: 'Select all', keys: 'Ctrl+A', run: actions.selectAll },
        { label: 'Select at playhead', keys: 'D', run: actions.selectAtPlayhead },
        { label: 'Select everything after the playhead', run: actions.selectForward },
        { label: 'Deselect', keys: 'Ctrl+Shift+A', run: actions.deselect },
      ],
    ],
    [
      'Clip',
      () => [
        { label: 'Speed / duration…', keys: 'Ctrl+R', run: () => ui.set({ dialog: 'speed' }) },
        { label: 'Enable / disable', keys: 'Shift+E', run: actions.toggleEnabled },
        { label: 'Link / unlink', keys: 'Ctrl+L', run: actions.link },
        { label: 'Nest', run: actions.nest },
        'sep',
        { label: 'Video transition at the playhead', keys: 'Ctrl+D', run: () => actions.transition('video') },
        { label: 'Sound crossfade at the playhead', keys: 'Ctrl+Shift+D', run: () => actions.transition('audio') },
        'sep',
        { label: 'Add text', keys: 'Ctrl+T', run: () => actions.addText(0) },
        { label: 'Add adjustment layer', run: () => actions.addGenerated('adjustment') },
        { label: 'Add color', run: () => actions.addGenerated('color') },
      ],
    ],
    [
      'Sequence',
      () => [
        { label: 'Sequence settings…', run: () => ui.set({ dialog: 'sequence' }) },
        { label: 'New sequence…', run: () => ui.set({ dialog: 'newSequence' }) },
        'sep',
        { label: 'Cut at the playhead', keys: 'Ctrl+K', run: () => actions.addEdit() },
        { label: 'Cut every track at the playhead', keys: 'Ctrl+Shift+K', run: () => actions.addEdit(true) },
        { label: 'Trim start to playhead', keys: 'Q', run: () => actions.rippleTrim('start') },
        { label: 'Trim end to playhead', keys: 'W', run: () => actions.rippleTrim('end') },
        'sep',
        { label: 'Lift', keys: ';', run: actions.liftMarked },
        { label: 'Extract', keys: "'", run: actions.extractMarked },
        'sep',
        { label: 'Add video track', run: () => actions.addTrack('video') },
        { label: 'Add sound track', run: () => actions.addTrack('audio') },
        'sep',
        { label: 'Snapping', keys: 'S', checked: u.snapping, run: actions.snapping },
        { label: 'Linked selection', checked: u.linked, run: actions.linkedSelection },
      ],
    ],
    [
      'Markers',
      () => [
        { label: 'Mark in', keys: 'I', run: actions.markIn },
        { label: 'Mark out', keys: 'O', run: actions.markOut },
        { label: 'Mark the clip', keys: 'X', run: actions.markClip },
        { label: 'Clear in and out', keys: 'Ctrl+Shift+X', run: actions.clearMarks },
        'sep',
        { label: 'Add marker', keys: 'M', run: actions.marker },
        { label: 'Next marker', keys: 'Shift+M', run: () => actions.toMarker(1) },
        { label: 'Previous marker', keys: 'Ctrl+Shift+M', run: () => actions.toMarker(-1) },
        'sep',
        { label: 'Play in to out', keys: 'Ctrl+Shift+Space', run: actions.playInToOut },
        { label: 'Loop', checked: engine.loop, run: actions.toggleLoop },
      ],
    ],
    [
      'View',
      () => [
        { label: 'Edit page', keys: 'Shift+1', checked: u.page === 'edit', run: () => ui.set({ page: 'edit' }) },
        { label: 'Color page', keys: 'Shift+2', checked: u.page === 'color', run: () => ui.set({ page: 'color' }) },
        { label: 'Audio page', keys: 'Shift+3', checked: u.page === 'audio', run: () => ui.set({ page: 'audio' }) },
        'sep',
        { label: 'Playback: full', checked: u.quality === 1, run: () => ui.set({ quality: 1 }) },
        { label: 'Playback: half', checked: u.quality === 0.5, run: () => ui.set({ quality: 0.5 }) },
        { label: 'Playback: quarter', checked: u.quality === 0.25, run: () => ui.set({ quality: 0.25 }) },
        { label: 'Use proxies for playback', checked: u.proxies, run: () => ui.set({ proxies: !u.proxies }) },
        { label: 'Native playback (beta)', checked: nativePlayback.enabled, run: () => nativePlayback.setEnabled(!nativePlayback.enabled) },
        ...cacheMenu(doc, doc.state.selection?.kind === 'clips' ? doc.state.selection.ids : []),
        { label: 'Safe margins', checked: u.safeMargins, run: () => ui.set({ safeMargins: !u.safeMargins }) },
        'sep',
        { label: 'Zoom in', keys: '=', run: () => actions.zoom(1.5) },
        { label: 'Zoom out', keys: '-', run: () => actions.zoom(1 / 1.5) },
        { label: 'Reset panel sizes', run: () => ui.set({ left: 330, right: 330, bottom: 330 }) },
        'sep',
        {
          label: 'Workspaces',
          items: [
            ...[...BUILT_IN_WORKSPACES, ...savedWorkspaces()].map((w) => ({ label: w.name, run: () => applyWorkspace(ui, w) })),
            { label: 'Save or remove workspaces…', run: () => panels.show({ kind: 'workspaces' }) },
          ],
        },
        { label: 'Keyboard shortcuts…', keys: 'Ctrl+Alt+K', run: () => panels.show({ kind: 'shortcuts' }) },
      ],
    ],
    [
      'Captions',
      () => {
        const sel = doc.state.selection?.kind === 'clips' ? doc.state.selection.ids : [];
        const caps = s.clips.filter((c) => sel.includes(c.id) && c.source.kind === 'caption');
        const here = Math.floor(engine.time);
        const atHead = caps.find((c) => here > c.start && here < end(c));
        const transcribed = state.project.media.some((m) => m.transcript?.words.length);
        return [
          { label: 'Transcribe…', run: () => ui.set({ dialog: 'transcribe' }) },
          { label: 'Make captions from the transcript', disabled: !transcribed, run: () => doc.edit((p) => makeCaptions(p, null), 'Make captions') },
          { label: 'Add a captions track', run: () => doc.edit((p) => addCaptionTrack(p).project, 'Add captions track') },
          'sep',
          {
            label: 'Split the caption at the playhead',
            disabled: !atHead,
            run: () => atHead && doc.edit((p) => splitCaption(p, atHead.id, here), 'Split caption'),
          },
          {
            label: 'Join the selected captions',
            disabled: caps.length < 2,
            run: () =>
              doc.edit(
                (p) =>
                  mergeCaptions(
                    p,
                    caps.map((c) => c.id),
                  ),
                'Join captions',
              ),
          },
          'sep',
          {
            label: 'Save captions as .srt…',
            disabled: !captionTracks(s).length,
            run: () => void saveCaptionFile(doc, 'srt').then((m) => m && ui.note(m)),
          },
          {
            label: 'Save captions as .vtt…',
            disabled: !captionTracks(s).length,
            run: () => void saveCaptionFile(doc, 'vtt').then((m) => m && ui.note(m)),
          },
        ];
      },
    ],
    ['Smart', () => smartMenu(state.project)],
    ['AI', () => extrasMenu(state.project, doc, ui)],
    [
      'Help',
      () => [
        { label: 'Keyboard shortcuts', keys: 'F1', run: () => ui.set({ dialog: 'help' }) },
        { label: 'Check this computer…', run: openSystemCheck },
        'sep',
        { label: 'Report a problem…', run: openProblemReport },
        { label: 'Send anonymous error reports', checked: reportsOn, run: toggleReports },
      ],
    ],
  ];

  const savedText = cs
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
  const problemShown = cs ? !!(cs.problem || cs.conflict) : !!saveProblem;

  return (
    <div
      className={`ed ed--${u.page}`}
      style={{ ['--left' as string]: `${u.left}px`, ['--right' as string]: `${u.right}px`, ['--bottom' as string]: `${u.bottom}px` }}
    >
      <header className="ed__top">
        <img className="ed__logo" src="./brand/studio-logo.svg" alt="Lumora Studio" />
        <nav className="ed__menus" aria-label="Menus">
          {menus.map(([name, items]) => (
            <button
              key={name}
              type="button"
              className="ed__menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ x: r.left, y: r.bottom + 2, items: items() });
              }}
            >
              {name}
              <ChevronDown className="ed__caret" />
            </button>
          ))}
        </nav>
        <span className="ed__name" title={collab ? 'Shared project (online)' : path || 'Not saved yet'}>
          {collab ? <Cloud /> : <FileVideo />}
          <span>{state.project.name}</span>
        </span>
        {collab && <HereChips collab={collab} doc={doc} />}
        <span className="ed__fill" />
        <button
          type="button"
          className="tbtn tbtn--icon"
          disabled={!state.canUndo}
          title={`Undo ${doc.undoLabel} (Ctrl+Z)`}
          aria-label="Undo"
          onClick={actions.undo}
        >
          <Undo2 />
        </button>
        <button
          type="button"
          className="tbtn tbtn--icon"
          disabled={!state.canRedo}
          title={`Redo ${doc.redoLabel} (Ctrl+Shift+Z)`}
          aria-label="Redo"
          onClick={actions.redo}
        >
          <Redo2 />
        </button>
        <span className={`ed__saved${problemShown ? ' is-problem' : ''}`} title={savedText}>
          {problemShown ? <CircleAlert /> : savedText === 'Saved' ? <Check /> : <Save />}
          {savedText}
        </span>
        <QueueChip ui={ui} />
        <button type="button" className="btn btn--primary ed__export" onClick={() => ui.set({ dialog: 'export' })} title="Make the finished film (Ctrl+M)">
          <Upload />
          Export
        </button>
      </header>

      {missing.length > 0 && (
        <div className="ed__warn" role="alert">
          {missing.length} file{missing.length === 1 ? ' is' : 's are'} missing (moved or renamed).{' '}
          <button type="button" className="linkbtn" onClick={() => void relink()}>
            Find them…
          </button>
          <button type="button" className="ed__warnx" aria-label="Hide" onClick={() => setMissing([])}>
            <X />
          </button>
        </div>
      )}

      {collab && <LockBanner collab={collab} doc={doc} />}

      {u.page === 'edit' && <EditPage doc={doc} engine={engine} ui={ui} actions={actions} collab={collab} />}
      {u.page === 'color' && (
        <div className="page page--color">
          <div className="page__top">
            <ProgramMonitor doc={doc} engine={engine} ui={ui} actions={actions} />
            <Scopes engine={engine} ui={ui} />
          </div>
          <Splitter ui={ui} which="bottom" />
          <div className="page__bottom">
            <ColorPanel doc={doc} engine={engine} actions={actions} ui={ui} />
          </div>
        </div>
      )}
      {u.page === 'audio' && (
        <div className="page page--audio">
          <div className="page__top">
            <ProgramMonitor doc={doc} engine={engine} ui={ui} actions={actions} />
            <Mixer doc={doc} engine={engine} />
          </div>
          <Splitter ui={ui} which="bottom" />
          <div className="page__bottom">
            <Timeline doc={doc} engine={engine} ui={ui} actions={actions} collab={collab} />
          </div>
        </div>
      )}

      <footer className="ed__status">
        <span className="ed__note">{u.note || (doc.undoLabel ? `Last: ${doc.undoLabel}` : 'Ready')}</span>
        <div className="ed__pages" role="tablist" aria-label="Pages">
          {(
            [
              ['edit', 'Edit', Film, 'Cut and arrange', 'pageEdit'],
              ['color', 'Color', Palette, 'Grade the picture: wheels, curves, nodes and scopes', 'pageColor'],
              ['audio', 'Audio', AudioLines, 'Mix the sound: faders, meters and tracks', 'pageAudio'],
            ] as const
          ).map(([p, n, Icon, tip, cmd]) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={u.page === p}
              className={u.page === p ? 'is-on' : ''}
              title={`${tip}${keys.keysFor(cmd) ? ` (${keys.keysFor(cmd)})` : ''}`}
              onClick={() => ui.set({ page: p })}
            >
              <Icon />
              {n}
            </button>
          ))}
        </div>
        <span className="ed__seqinfo" title={path ? folderOf(path) : 'Not saved yet'}>
          {s.name} · {s.width}×{s.height} · {s.fps} fps
        </span>
      </footer>

      {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {u.dialog === 'export' && <DeliverDialog doc={doc} ui={ui} />}
      {u.dialog === 'sequence' && <SequenceDialog doc={doc} ui={ui} fresh={false} />}
      {u.dialog === 'newSequence' && <SequenceDialog doc={doc} ui={ui} fresh />}
      {u.dialog === 'speed' && <SpeedDialog doc={doc} ui={ui} actions={actions} />}
      {u.dialog === 'help' && <HelpDialog ui={ui} />}
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
      {accountOpen && access && <AccountDialog access={access} onClose={() => setAccountOpen(false)} />}
      {collab && <ConflictDialog collab={collab} onOpenShared={onOpenShared} />}
      {u.dialog === 'transcribe' && <TranscribeDialog doc={doc} ui={ui} />}
      <SmartDialogs doc={doc} engine={engine} ui={ui} />
      <ManagePanels doc={doc} ui={ui} engine={engine} autosaver={autosaver} />
      <ExtrasDialogs doc={doc} engine={engine} ui={ui} />
      <CacheDialog />
    </div>
  );
}

function EditPage({ doc, engine, ui, actions, collab }: { doc: Doc; engine: Engine; ui: Ui; actions: Actions; collab: Collab | null }) {
  const u = useUi(ui);
  const cs = useCollab(collab);
  const [leftTab, setLeftTab] = useState<'controls' | 'source' | 'transcript' | 'comments'>('controls');
  // A comment picked on the timeline shows in the comments.
  const focus = cs?.focus ?? null;
  useEffect(() => {
    if (focus) setLeftTab('comments');
  }, [focus]);
  // A clip opened from the bin shows in the source monitor.
  const lastSource = useRef(u.source?.media);
  useEffect(() => {
    if (u.source?.media && u.source.media !== lastSource.current) setLeftTab('source');
    lastSource.current = u.source?.media;
  }, [u.source?.media]);
  return (
    <div className="page page--edit">
      <div className="page__top">
        <div className="panel panel--left">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'controls'}
              className={leftTab === 'controls' ? 'is-on' : ''}
              onClick={() => setLeftTab('controls')}
            >
              <SlidersHorizontal />
              Effect controls
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'source'}
              className={leftTab === 'source' ? 'is-on' : ''}
              onClick={() => setLeftTab('source')}
            >
              <SquarePlay />
              Source
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'transcript'}
              className={leftTab === 'transcript' ? 'is-on' : ''}
              onClick={() => setLeftTab('transcript')}
            >
              <FileText />
              Transcript
            </button>
            {collab && (
              <button
                type="button"
                role="tab"
                aria-selected={leftTab === 'comments'}
                className={leftTab === 'comments' ? 'is-on' : ''}
                onClick={() => setLeftTab('comments')}
              >
                <MessageSquare />
                Comments
              </button>
            )}
          </div>
          {leftTab === 'comments' && collab ? (
            <CommentsPanel collab={collab} doc={doc} engine={engine} />
          ) : leftTab === 'controls' ? (
            <Inspector doc={doc} engine={engine} ui={ui} actions={actions} />
          ) : leftTab === 'transcript' ? (
            <TranscriptPanel doc={doc} engine={engine} ui={ui} />
          ) : (
            <SourceMonitor doc={doc} ui={ui} actions={actions} engine={engine} />
          )}
        </div>
        <Splitter ui={ui} which="right" />
        <ProgramMonitor doc={doc} engine={engine} ui={ui} actions={actions} />
      </div>
      <Splitter ui={ui} which="bottom" />
      <div className="page__bottom">
        <div className="panel panel--project">
          <ProjectPanel doc={doc} ui={ui} actions={actions} />
        </div>
        <Splitter ui={ui} which="left" />
        <Timeline doc={doc} engine={engine} ui={ui} actions={actions} collab={collab} />
      </div>
    </div>
  );
}

/** A line between panels: drag it to make one bigger. */
function Splitter({ ui, which }: { ui: Ui; which: 'left' | 'right' | 'bottom' }) {
  return (
    <div
      className={`split split--${which}`}
      role="separator"
      aria-orientation={which === 'bottom' ? 'horizontal' : 'vertical'}
      onPointerDown={(e) => {
        const start = ui.state[which];
        const x0 = e.clientX;
        const y0 = e.clientY;
        const move = (ev: PointerEvent) => {
          if (which === 'bottom') ui.set({ bottom: Math.max(180, Math.min(window.innerHeight - 260, start - (ev.clientY - y0))) });
          else if (which === 'left') ui.set({ left: Math.max(220, Math.min(560, start + (ev.clientX - x0))) });
          else ui.set({ right: Math.max(260, Math.min(window.innerWidth - 420, start + (ev.clientX - x0))) });
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}

/** What each key does (as in the big editors). */
function keymap(e: KeyboardEvent, a: Actions, ui: Ui): (() => void) | null {
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  if (ctrl) {
    if (k === 'z' && shift) return a.redo;
    if (k === 'z') return a.undo;
    if (k === 'y') return a.redo;
    if (k === 'c') return a.copy;
    if (k === 'x' && shift) return a.clearMarks;
    if (k === 'x') return a.cut;
    if (k === 'v' && alt) return a.pasteAttributes;
    if (k === 'v') return () => a.paste(shift);
    if (k === 'a' && shift) return a.deselect;
    if (k === 'a') return a.selectAll;
    if (k === 'k') return () => a.addEdit(shift);
    if (k === 'd') return () => a.transition(shift ? 'audio' : 'video');
    if (k === 'l') return a.link;
    if (k === 'r') return () => ui.set({ dialog: 'speed' });
    if (k === 'm' && shift) return () => a.toMarker(-1);
    if (k === 'm') return () => ui.set({ dialog: 'export' });
    if (k === 't') return () => a.addText(0);
    if (k === 'i') return a.importMedia;
    if (k === ' ' && shift) return a.playInToOut;
    return null;
  }
  if (shift && e.code === 'Digit1') return () => ui.set({ page: 'edit' });
  if (shift && e.code === 'Digit2') return () => ui.set({ page: 'color' });
  if (shift && e.code === 'Digit3') return () => ui.set({ page: 'audio' });
  if (/^[1-9]$/.test(e.key) && !shift && !alt) return () => a.switchAngleNumber(Number(e.key));
  switch (k) {
    case ' ':
      return a.toggle;
    case 'j':
      return () => a.shuttle(-1);
    case 'k':
      return a.stop;
    case 'l':
      return () => a.shuttle(1);
    case 'arrowleft':
      return alt ? () => a.nudge(-1) : () => a.step(shift ? -5 : -1);
    case 'arrowright':
      return alt ? () => a.nudge(1) : () => a.step(shift ? 5 : 1);
    case 'arrowup':
      return () => a.toEdit(-1);
    case 'arrowdown':
      return () => a.toEdit(1);
    case 'home':
      return a.home;
    case 'end':
      return a.endOf;
    case 'i':
      return shift ? a.toIn : a.markIn;
    case 'o':
      return shift ? a.toOut : a.markOut;
    case 'x':
      return a.markClip;
    case 'q':
      return () => a.rippleTrim('start');
    case 'w':
      return () => a.rippleTrim('end');
    case 'delete':
    case 'backspace':
      return shift ? a.rippleDelete : a.del;
    case ';':
      return a.liftMarked;
    case "'":
      return a.extractMarked;
    case ',':
      return () => a.insertSource('insert');
    case '.':
      return () => a.insertSource('overwrite');
    case 'm':
      return shift ? () => a.toMarker(1) : a.marker;
    case 'e':
      return shift ? a.toggleEnabled : null;
    case 'd':
      return a.selectAtPlayhead;
    case 'v':
      return () => a.tool('select');
    case 'b':
      return () => a.tool('ripple');
    case 'n':
      return () => a.tool('roll');
    case 'c':
      return () => a.tool('razor');
    case 'y':
      return () => a.tool('slip');
    case 'u':
      return () => a.tool('slide');
    case 'h':
      return () => a.tool('hand');
    case 't':
      return () => a.tool('text');
    case 's':
      return a.snapping;
    case '=':
    case '+':
      return () => a.zoom(1.5);
    case '-':
      return () => a.zoom(1 / 1.5);
    case '\\':
      return () => a.zoomToFit((document.querySelector('.tl__scroll') as HTMLElement | null)?.clientWidth ?? 1000);
    case 'escape':
      return a.deselect;
    case 'f1':
      return () => ui.set({ dialog: 'help' });
    default:
      return null;
  }
}
