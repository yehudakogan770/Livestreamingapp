import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccess } from '../../../../app/src/auth/Gate';
import { Doc, useDoc } from '../doc';
import { addTitle, layout, locate, remove, removeTitle, snap, split, switchFrom, type Project } from '../model/project';
import { native } from '../native';
import { Player } from '../player/player';
import { CameraWall } from './CameraWall';
import { ExportDialog } from './ExportDialog';
import { Help } from './Help';
import { typing } from './hooks';
import { Inspector } from './Inspector';
import { LookFilters } from './LookFilters';
import { Timeline } from './Timeline';
import { Viewer } from './Viewer';

export type Actions = ReturnType<typeof makeActions>;

function makeActions(doc: Doc, player: Player) {
  const cuts = () => layout(doc.project.clips).starts;
  return {
    split: () => doc.edit((q) => split(q, player.time)),
    remove: () => {
      const s = doc.state.selection;
      if (s?.kind === 'clip') doc.edit((q) => remove(q, s.ids));
      else if (s?.kind === 'title') doc.edit((q) => removeTitle(q, s.id));
    },
    /** Switch to a camera from the playhead on. */
    switchTo: (angle: string) => doc.edit((q) => switchFrom(q, player.time, angle)),
    addTitle: () => {
      let id = '';
      doc.edit((q) => {
        const r = addTitle(q, player.time);
        id = r.id;
        return r.project;
      });
      if (id) doc.select({ kind: 'title', id });
    },
    markIn: () =>
      doc.edit((q) => {
        const t = snap(player.time);
        const to = q.range && q.range.to > t ? q.range.to : layout(q.clips).total;
        return { ...q, range: { from: t, to } };
      }),
    markOut: () =>
      doc.edit((q) => {
        const t = snap(player.time);
        const from = q.range && q.range.from < t ? q.range.from : 0;
        return { ...q, range: { from, to: t } };
      }),
    clearMarks: () => doc.edit((q) => (q.range ? { ...q, range: null } : q)),
    prevCut: () => {
      const t = player.time - 10;
      const before = cuts().filter((s) => s < t);
      player.seek(before[before.length - 1] ?? 0);
    },
    nextCut: () => {
      const next = cuts().find((s) => s > player.time + 10);
      player.seek(next ?? player.length);
    },
    selectHere: () => {
      const s = locate(doc.project.clips, player.time);
      if (s) doc.select({ kind: 'clip', ids: [s.clip.id] });
    },
  };
}

/** The editing screen. */
export function Editor({ project, savePath, onClose }: { project: Project; savePath: string; onClose: () => void }) {
  const doc = useMemo(() => new Doc(project), [project]);
  const player = useMemo(() => {
    // Ready before the first drawing, so the camera wall has its videos.
    const pl = new Player();
    pl.setProject(project);
    return pl;
  }, [project]);
  const st = useDoc(doc);
  const p = st.project;
  const actions = useMemo(() => makeActions(doc, player), [doc, player]);
  const [saving, setSaving] = useState<'saved' | 'saving' | 'problem'>('saved');
  const [exporting, setExporting] = useState(false);
  const [help, setHelp] = useState(false);
  const [zoom, setZoom] = useState(0);
  const { access, signOut } = useAccess();

  useEffect(() => player.setProject(p), [player, p]);
  useEffect(() => {
    player.start();
    return () => player.stop();
  }, [player]);

  const save = useCallback(async () => {
    if (!savePath) return;
    setSaving('saving');
    try {
      await native.writeText(savePath, JSON.stringify(doc.project));
      doc.saved();
      setSaving('saved');
    } catch {
      setSaving('problem');
    }
  }, [doc, savePath]);

  // Saved by itself a moment after each change.
  useEffect(() => {
    if (!st.dirty) return;
    const t = setTimeout(() => void save(), 1200);
    return () => clearTimeout(t);
  }, [p, st.dirty, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || exporting) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      const frame = 1000 / 30;
      let used = true;
      if (ctrl && k.toLowerCase() === 'z' && !e.shiftKey) doc.undo();
      else if (ctrl && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) doc.redo();
      else if (ctrl && k.toLowerCase() === 's') void save();
      else if (ctrl && k.toLowerCase() === 'e') setExporting(true);
      else if (ctrl && k.toLowerCase() === 'k') actions.split();
      else if (ctrl) used = false;
      else if (k === ' ') player.toggle();
      else if (k === 'k' || k === 'K') player.pause();
      else if (k === 'l' || k === 'L') player.faster();
      else if (k === 'j' || k === 'J') player.seek(player.time - 5000);
      else if (k === 'ArrowLeft') player.seek(player.time - (e.shiftKey ? 1000 : frame));
      else if (k === 'ArrowRight') player.seek(player.time + (e.shiftKey ? 1000 : frame));
      else if (k === 'ArrowUp') actions.prevCut();
      else if (k === 'ArrowDown') actions.nextCut();
      else if (k === 'Home') player.seek(0);
      else if (k === 'End') player.seek(player.length);
      else if (k === 's' || k === 'S' || k === 'b' || k === 'B') actions.split();
      else if (k === 'Delete' || k === 'Backspace') actions.remove();
      else if (k === 't' || k === 'T') actions.addTitle();
      else if (k === 'i' || k === 'I') actions.markIn();
      else if (k === 'o' || k === 'O') actions.markOut();
      else if (k === 'x' || k === 'X') actions.clearMarks();
      else if (k === '=' || k === '+') setZoom((z) => z + 1);
      else if (k === '-' || k === '_') setZoom((z) => z - 1);
      else if (k === 'Escape') doc.select(null);
      else if (/^[1-9]$/.test(k)) {
        const a = doc.project.angles[Number(k) - 1];
        if (a) actions.switchTo(a.id);
      } else used = false;
      if (used) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, player, actions, save, exporting]);

  const close = async () => {
    if (st.dirty) await save();
    player.pause();
    onClose();
  };

  return (
    <div className="ed">
      <header className="ed__top">
        <img className="ed__logo" src="./brand/lumora-logo.svg" alt="Lumora Edit" />
        <span className="ed__name" title={p.eventPath}>
          {p.name}
        </span>
        <div className="ed__group">
          <button type="button" className="btn btn--sm" onClick={() => doc.undo()} disabled={!st.canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" className="btn btn--sm" onClick={() => doc.redo()} disabled={!st.canRedo} title="Redo (Ctrl+Y)">
            Redo
          </button>
        </div>
        <span className={`ed__saved is-${saving}`}>
          {!savePath
            ? 'Demo (not saved)'
            : saving === 'saving'
              ? 'Saving…'
              : saving === 'problem'
                ? 'Could not save'
                : st.dirty
                  ? 'Changed'
                  : 'All changes saved'}
        </span>
        <span className="grow" />
        <button type="button" className="btn btn--sm" onClick={() => setHelp(true)}>
          Keys
        </button>
        <button type="button" className="btn btn--sm" onClick={() => void close()} title="Back to the start screen">
          Close event
        </button>
        {access && (
          <button type="button" className="btn btn--sm" onClick={signOut} title={`Signed in as ${access.email}`}>
            Sign out
          </button>
        )}
        <button type="button" className="btn btn--primary ed__export" onClick={() => setExporting(true)}>
          Export film
        </button>
      </header>
      <CameraWall project={p} player={player} onSwitch={actions.switchTo} />
      <Viewer project={p} player={player} actions={actions} />
      <Inspector doc={doc} state={st} player={player} actions={actions} />
      <Timeline doc={doc} state={st} player={player} actions={actions} zoom={zoom} setZoom={setZoom} />
      <LookFilters angles={p.angles} />
      {exporting && <ExportDialog project={p} onClose={() => setExporting(false)} />}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}
