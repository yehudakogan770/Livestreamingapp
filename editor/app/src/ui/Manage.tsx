// Media management windows: undo history, collect files (archive), backups
// and crash recovery, clip info (stars, tags, notes), where a clip is used,
// smart bins and workspaces.
import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { duration, readProject } from '../model/build';
import { rate } from '../model/seq';
import type { Project, SmartBin, SmartRule } from '../model/types';
import { useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { archivePlan } from '../manage/archive';
import { manageNative, onCollectProgress, type CollectProgress } from '../manage/native';
import { dismissRecovery, findRecoverable, listBackups, type Autosaver, type Backup, type Recoverable } from '../manage/recovery';
import { allTags, describeRule, newSmartBin, parseTags, setMediaInfo, smartBinItems, SMART_PRESETS, usesOf } from '../manage/smartbins';
import { fileName, folderOf, inApp, native } from '../native';
import { Choice, Modal } from './controls';
import { panels, usePanel } from './panels';
import { QueuePanel } from './Deliver';
import { ShortcutEditor } from './ShortcutEditor';
import type { Ui } from './state';
import { useUi } from './state';
import { applyWorkspace, BUILT_IN_WORKSPACES, deleteWorkspace, savedWorkspaces, saveWorkspace } from './workspaces';
import './delivery.css';

const ago = (at: number): string => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** Whichever of these windows is open. */
export function ManagePanels({ doc, ui, engine, autosaver }: { doc: Doc; ui: Ui; engine: Engine; autosaver: Autosaver | null }) {
  const p = usePanel();
  if (!p) return null;
  const close = panels.close;
  switch (p.kind) {
    case 'queue':
      return <QueuePanel onClose={close} />;
    case 'shortcuts':
      return <ShortcutEditor onClose={close} />;
    case 'undo':
      return <UndoHistory doc={doc} onClose={close} />;
    case 'archive':
      return <ArchiveDialog doc={doc} ui={ui} onClose={close} />;
    case 'backups':
      return <BackupsDialog doc={doc} ui={ui} autosaver={autosaver} onClose={close} />;
    case 'workspaces':
      return <WorkspacesDialog ui={ui} onClose={close} />;
    case 'mediaInfo':
      return <MediaInfoDialog doc={doc} media={p.media} engine={engine} onClose={close} />;
    case 'uses':
      return <MediaInfoDialog doc={doc} media={p.media} engine={engine} onClose={close} usesOnly />;
    case 'smartBin':
      return <SmartBinDialog doc={doc} id={p.id} onClose={close} />;
  }
}

/** Every change, oldest first: click one to go back (or forward) to just after it. */
export function UndoHistory({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  useDoc(doc);
  const { done, undone } = doc.steps;
  const at = done.length;
  return (
    <Modal title="Undo history" onClose={onClose}>
      <ol className="uh" aria-label="Undo history">
        <li>
          <button type="button" className={at === 0 ? 'is-now' : ''} onClick={() => doc.goTo(0)}>
            (As opened)
          </button>
        </li>
        {[...done, ...undone].map((label, i) => (
          <li key={i}>
            <button
              type="button"
              className={i + 1 === at ? 'is-now' : i + 1 > at ? 'is-undone' : ''}
              onClick={() => doc.goTo(i + 1)}
              aria-current={i + 1 === at}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

/** Copy the project and its media (or only the parts used, with handles) into one folder. */
export function ArchiveDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const [folder, setFolder] = useState('');
  const [name, setName] = useState(`${project.name || 'Project'} (collected)`);
  const [trim, setTrim] = useState(false);
  const [handles, setHandles] = useState(2);
  const [unused, setUnused] = useState(false);
  const [progress, setProgress] = useState<CollectProgress | null>(null);
  const [result, setResult] = useState<{ path: string; problems: string[] } | null>(null);
  const busy = !!progress && !progress.finished;
  const plan = useMemo(
    () => (folder ? archivePlan(project, { folder, name, trim, handles, includeUnused: unused }) : null),
    [project, folder, name, trim, handles, unused],
  );
  useEffect(() => onCollectProgress(setProgress), []);
  const run = async () => {
    if (!plan) return;
    setResult(null);
    setProgress({ done: 0, of: plan.jobs.length, name: '', finished: false, problems: [] });
    try {
      const problems = await manageNative.collectFiles(plan.jobs);
      await native.writeText(plan.projectPath, JSON.stringify(plan.project));
      setResult({ path: plan.projectPath, problems: [...plan.missing.map((m) => `${m}: missing`), ...problems] });
      ui.note(`Collected into ${plan.root}`);
    } catch (e) {
      setResult({ path: '', problems: [e instanceof Error ? e.message : String(e)] });
    }
    setProgress((p) => (p ? { ...p, finished: true } : p));
  };
  return (
    <Modal title="Collect files / archive" onClose={() => !busy && onClose()} wide>
      <div className="form">
        <p className="dlv__note">
          The project and every file it uses are copied into one folder, with a project file there that uses the copies. Good for moving to another computer,
          handing over, or archiving.
        </p>
        <div className="form__row">
          <span>Into</span>
          <button
            type="button"
            className="btn"
            disabled={!inApp() || busy}
            onClick={() => void open({ title: 'Collect into which folder?', directory: true }).then((f) => typeof f === 'string' && setFolder(f))}
          >
            {folder || 'Choose a folder…'}
          </button>
        </div>
        <label className="form__row">
          <span>Name</span>
          <input className="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <div className="form__row">
          <span>Media</span>
          <Choice
            value={trim ? 'trim' : 'whole'}
            options={[
              ['whole', 'Whole files'],
              ['trim', 'Only the parts used'],
            ]}
            onChange={(v) => setTrim(v === 'trim')}
            label="Media"
          />
          {trim && (
            <span className="form__pair">
              <input
                className="text text--num"
                type="number"
                min={0}
                max={60}
                step={0.5}
                value={handles}
                aria-label="Handles (seconds)"
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => setHandles(Math.max(0, Number(e.target.value) || 0))}
              />
              s handles
            </span>
          )}
        </div>
        <label className="check form__check">
          <input type="checkbox" checked={unused} onChange={(e) => setUnused(e.target.checked)} /> Also files no sequence uses
        </label>
        {trim && <p className="dlv__note">Trimmed files are made again (frame-accurate, high quality); whole files are copied as they are.</p>}
        {plan && (
          <p className="dlv__note">
            {plan.jobs.length} file{plan.jobs.length === 1 ? '' : 's'} → {plan.root}
            {plan.items.some((x) => x.trim) ? ` · ${plan.items.filter((x) => x.trim).length} trimmed` : ''}
            {plan.missing.length ? ` · ${plan.missing.length} missing (left out)` : ''}
          </p>
        )}
        {progress && (
          <div className="expo">
            <div className="expo__bar">
              <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.of)) * 100)}%` }} />
            </div>
            <p className="expo__left">{progress.finished ? 'Done.' : `${progress.done + 1} of ${progress.of}: ${progress.name}`}</p>
          </div>
        )}
        {result?.problems.map((x) => (
          <p key={x} className="form__problem">
            {x}
          </p>
        ))}
        <div className="form__foot">
          {result?.path && (
            <button type="button" className="btn" onClick={() => void native.reveal(result.path)}>
              Open folder
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button type="button" className="btn btn--primary" disabled={!plan || busy || !inApp()} onClick={() => void run()}>
            Collect
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Versions autosaved while editing: put one back (as a step that can be undone). */
export function BackupsDialog({ doc, ui, autosaver, onClose }: { doc: Doc; ui: Ui; autosaver: Autosaver | null; onClose: () => void }) {
  const [list, setList] = useState<Backup[] | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    void (async () => {
      await autosaver?.tick(true);
      setList(await listBackups(autosaver?.projectKey ?? ''));
    })();
  }, [autosaver]);
  const restore = async (b: Backup) => {
    try {
      const p = readProject(await manageNative.recoveryRead(b.name));
      doc.edit(() => p, `Restore backup (${ago(b.at)})`);
      ui.note('Backup restored (Undo takes it back)');
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal title="Backups" onClose={onClose}>
      <div className="form">
        <p className="dlv__note">Lumora Studio autosaves every minute while you edit and keeps the last 10 versions.</p>
        {list === null && <p>Looking…</p>}
        {list?.length === 0 && <p>No backups yet.</p>}
        <ul className="uh">
          {list?.map((b) => (
            <li key={b.name}>
              <button type="button" onClick={() => void restore(b)} title="Restore this version">
                {new Date(b.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })} ·{' '}
                {ago(b.at)}
              </button>
            </li>
          ))}
        </ul>
        {problem && <p className="form__problem">{problem}</p>}
      </div>
    </Modal>
  );
}

/** Saved layouts: pick one, or keep the one showing under a name. */
export function WorkspacesDialog({ ui, onClose }: { ui: Ui; onClose: () => void }) {
  const u = useUi(ui);
  const [mine, setMine] = useState(savedWorkspaces);
  const [name, setName] = useState('');
  return (
    <Modal title="Workspaces" onClose={onClose}>
      <div className="form">
        <div className="form__chips">
          {[...BUILT_IN_WORKSPACES, ...mine].map((w, i) => (
            <button key={`${w.name}${i}`} type="button" className="fchip" onClick={() => applyWorkspace(ui, w)}>
              {w.name}
              {i >= BUILT_IN_WORKSPACES.length && (
                <span
                  className="dlv__del"
                  role="button"
                  aria-label={`Delete workspace ${w.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMine(deleteWorkspace(w.name));
                  }}
                >
                  ✕
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="form__row">
          <span>Save this layout</span>
          <input
            className="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && name.trim()) {
                setMine(saveWorkspace(name, u));
                setName('');
              }
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={!name.trim()}
            onClick={() => {
              setMine(saveWorkspace(name, u));
              setName('');
              ui.note(`Workspace saved: ${name.trim()}`);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          className={n <= value ? 'is-on' : ''}
          onClick={() => onChange(value === n ? 0 : n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

/** A clip's stars, tags and notes, what it is, and where it is used. */
export function MediaInfoDialog({
  doc,
  media,
  engine,
  onClose,
  usesOnly,
}: {
  doc: Doc;
  media: string;
  engine: Engine;
  onClose: () => void;
  usesOnly?: boolean;
}) {
  const { project } = useDoc(doc);
  const m = project.media.find((x) => x.id === media);
  const [tags, setTags] = useState((m?.tags ?? []).join(', '));
  const [notes, setNotes] = useState(m?.notes ?? '');
  const suggestions = allTags(project).filter((t) => !(m?.tags ?? []).includes(t));
  if (!m) return null;
  const uses = usesOf(project, m.id);
  const go = (seq: string, clip: string, at: number) => {
    doc.quiet((p) => ({ ...p, open: seq }));
    doc.select({ kind: 'clips', ids: [clip] });
    engine.seek(at);
    onClose();
  };
  const saveText = () => doc.edit((p) => setMediaInfo(p, m.id, { tags: parseTags(tags), notes: notes.trim() }), 'Clip info');
  return (
    <Modal title={usesOnly ? `Where “${m.name}” is used` : m.name} onClose={onClose}>
      <div className="form">
        {!usesOnly && (
          <>
            <div className="form__row">
              <span>Rating</span>
              <Stars value={m.rating ?? 0} onChange={(n) => doc.edit((p) => setMediaInfo(p, m.id, { rating: n }), 'Rate clip')} />
            </div>
            <label className="form__row">
              <span>Tags</span>
              <input
                className="text"
                value={tags}
                placeholder="interview, b-roll…"
                onChange={(e) => setTags(e.target.value)}
                onBlur={saveText}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
            {suggestions.length > 0 && (
              <div className="form__chips">
                {suggestions.slice(0, 12).map((t) => (
                  <button key={t} type="button" className="fchip" onClick={() => setTags((x) => (x.trim() ? `${x}, ${t}` : t))}>
                    #{t}
                  </button>
                ))}
              </div>
            )}
            <label className="form__row">
              <span>Notes</span>
              <textarea
                className="text"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveText}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
            <p className="dlv__note">
              {m.kind} · {m.kind !== 'audio' ? `${m.width}×${m.height} · ` : ''}
              {m.duration ? duration(m.range ? m.range[1] - m.range[0] : m.duration) : ''}
              {m.source ? ` · ${m.source.codec}${m.source.bitDepth > 8 ? ` ${m.source.bitDepth}-bit` : ''}${m.source.hdr ? ' HDR' : ''}` : ''}
              {m.range ? ` · subclip ${duration(m.range[0])}–${duration(m.range[1])}` : ''}
              <br />
              {m.path}
            </p>
          </>
        )}
        <div className="form__row">
          <span>Used</span>
          <span>{uses.length ? `${uses.length} time${uses.length === 1 ? '' : 's'}` : 'Not used in any sequence'}</span>
        </div>
        <ul className="uh">
          {uses.map((x) => {
            const s = project.sequences.find((q) => q.id === x.seq);
            return (
              <li key={`${x.seq}${x.clip}`}>
                <button type="button" onClick={() => go(x.seq, x.clip, x.start)}>
                  {x.seqName} · {duration(x.start / (s ? rate(s) : 30))}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="form__foot">
          {inApp() && (
            <button type="button" className="btn" onClick={() => void native.reveal(m.path)}>
              Show in folder
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              if (!usesOnly) saveText();
              onClose();
            }}
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

const FIELDS: [SmartRule['field'], string][] = [
  ['kind', 'Type'],
  ['rating', 'Rating'],
  ['tag', 'Tag'],
  ['resolution', 'Resolution'],
  ['added', 'Added'],
  ['transcript', 'Transcript'],
  ['used', 'Used'],
  ['text', 'Text'],
];

function defaultRule(field: SmartRule['field']): SmartRule {
  switch (field) {
    case 'kind':
      return { field, is: 'video' };
    case 'rating':
      return { field, atLeast: 3 };
    case 'tag':
      return { field, has: '' };
    case 'resolution':
      return { field, atLeast: 1080 };
    case 'added':
      return { field, withinDays: 7 };
    case 'transcript':
      return { field, has: true };
    case 'used':
      return { field, is: false };
    case 'text':
      return { field, has: '' };
  }
}

function RuleValue({ rule, onChange }: { rule: SmartRule; onChange: (r: SmartRule) => void }) {
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  switch (rule.field) {
    case 'kind':
      return (
        <select className="text" value={rule.is} onChange={(e) => onChange({ ...rule, is: e.target.value as 'video' | 'audio' | 'image' })}>
          <option value="video">Video</option>
          <option value="audio">Sound</option>
          <option value="image">Picture</option>
        </select>
      );
    case 'rating':
      return <Stars value={rule.atLeast} onChange={(n) => onChange({ ...rule, atLeast: Math.max(1, n) })} />;
    case 'tag':
    case 'text':
      return <input className="text" value={rule.has} onChange={(e) => onChange({ ...rule, has: e.target.value })} onKeyDown={stop} />;
    case 'resolution':
      return (
        <select className="text" value={rule.atLeast} onChange={(e) => onChange({ ...rule, atLeast: Number(e.target.value) })}>
          {[720, 1080, 1440, 2160].map((h) => (
            <option key={h} value={h}>
              {h}p and up
            </option>
          ))}
        </select>
      );
    case 'added':
      return (
        <select className="text" value={rule.withinDays} onChange={(e) => onChange({ ...rule, withinDays: Number(e.target.value) })}>
          {[1, 7, 30, 365].map((d) => (
            <option key={d} value={d}>
              {d === 1 ? 'today' : `last ${d} days`}
            </option>
          ))}
        </select>
      );
    case 'transcript':
      return (
        <select className="text" value={rule.has ? 'y' : 'n'} onChange={(e) => onChange({ ...rule, has: e.target.value === 'y' })}>
          <option value="y">transcribed</option>
          <option value="n">not transcribed</option>
        </select>
      );
    case 'used':
      return (
        <select className="text" value={rule.is ? 'y' : 'n'} onChange={(e) => onChange({ ...rule, is: e.target.value === 'y' })}>
          <option value="y">in a sequence</option>
          <option value="n">not used</option>
        </select>
      );
  }
}

/** Make or change a smart bin. */
export function SmartBinDialog({ doc, id, onClose }: { doc: Doc; id: string | null; onClose: () => void }) {
  const { project } = useDoc(doc);
  const had = (project.smartBins ?? []).find((b) => b.id === id);
  const [bin, setBin] = useState<SmartBin>(() => had ?? newSmartBin('Smart bin', [{ field: 'kind', is: 'video' }]));
  const count = smartBinItems(project, bin).length;
  const put = (p: Project): Project => ({ ...p, smartBins: had ? (p.smartBins ?? []).map((b) => (b.id === bin.id ? bin : b)) : [...(p.smartBins ?? []), bin] });
  return (
    <Modal title={had ? 'Smart bin' : 'New smart bin'} onClose={onClose}>
      <div className="form">
        {!had && (
          <div className="form__chips">
            {SMART_PRESETS.map((x) => (
              <button key={x.name} type="button" className="fchip" onClick={() => setBin({ ...bin, name: x.name, rules: x.rules })}>
                {x.name}
              </button>
            ))}
          </div>
        )}
        <label className="form__row">
          <span>Name</span>
          <input className="text" value={bin.name} onChange={(e) => setBin({ ...bin, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <div className="form__row">
          <span>Show media matching</span>
          <Choice
            value={bin.match}
            options={[
              ['all', 'all the rules'],
              ['any', 'any rule'],
            ]}
            onChange={(match) => setBin({ ...bin, match })}
            label="Match"
          />
        </div>
        <div className="rules">
          {bin.rules.map((r, i) => (
            <div key={i} className="rules__row">
              <select
                className="text"
                value={r.field}
                aria-label="Rule"
                onChange={(e) => setBin({ ...bin, rules: bin.rules.map((x, j) => (j === i ? defaultRule(e.target.value as SmartRule['field']) : x)) })}
              >
                {FIELDS.map(([f, n]) => (
                  <option key={f} value={f}>
                    {n}
                  </option>
                ))}
              </select>
              <RuleValue rule={r} onChange={(nr) => setBin({ ...bin, rules: bin.rules.map((x, j) => (j === i ? nr : x)) })} />
              <span className="dlv__note">{describeRule(r)}</span>
              <button type="button" className="tbtn" aria-label="Remove rule" onClick={() => setBin({ ...bin, rules: bin.rules.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="linkbtn" onClick={() => setBin({ ...bin, rules: [...bin.rules, defaultRule('rating')] })}>
            + Add a rule
          </button>
        </div>
        <div className="form__foot">
          <span className="form__est">
            {count} item{count === 1 ? '' : 's'}
          </span>
          {had && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                doc.edit((p) => ({ ...p, smartBins: (p.smartBins ?? []).filter((b) => b.id !== bin.id) }), 'Remove smart bin');
                onClose();
              }}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              doc.edit(put, had ? 'Change smart bin' : 'New smart bin');
              onClose();
            }}
          >
            {had ? 'Save' : 'Make it'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** At start, after a crash: offer the autosaved work back. */
export function RecoveryOffer({ onRestore }: { onRestore: (project: Project, path: string) => void }) {
  const [list, setList] = useState<Recoverable[]>([]);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let live = true;
    void findRecoverable().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  if (!list.length) return null;
  const restore = async (r: Recoverable) => {
    try {
      const project = readProject(await manageNative.recoveryRead(r.backup.name));
      await dismissRecovery(r);
      onRestore(project, r.marker.path);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="recover" role="alertdialog" aria-label="Restore unsaved work">
      <h3>Lumora Studio didn’t close properly</h3>
      <p>Your work was autosaved. Restore it?</p>
      {list.map((r) => (
        <div key={r.marker.key} className="recover__row">
          <b title={r.marker.path || 'Never saved'}>
            {r.marker.name}
            {r.marker.path ? ` · ${fileName(folderOf(r.marker.path))}` : ''}
          </b>
          <span className="dlv__note">{ago(r.backup.at)}</span>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => void restore(r)}>
            Restore
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              void dismissRecovery(r);
              setList(list.filter((x) => x !== r));
            }}
          >
            Discard
          </button>
        </div>
      ))}
      {problem && <p className="form__problem">{problem}</p>}
    </div>
  );
}
