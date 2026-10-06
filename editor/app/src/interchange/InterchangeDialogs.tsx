// Moving a timeline to and from other editors: export the open sequence as
// FCPXML, Premiere XML, EDL or OpenTimelineIO, and import one of those as a
// new sequence, its files linked by name.
import { FileDown, FileUp, FolderSearch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useDoc, type Doc } from '../doc';
import { FRAME_RATES } from '../model/types';
import { fileName, folderOf, inApp, joinPath, native } from '../native';
import { importFiles } from '../ui/importer';
import { Choice, Modal } from '../ui/controls';
import type { Ui } from '../ui/state';
import { detectFormat, formatInfo, FORMATS, readTimeline, TIMELINE_EXTENSIONS, type InterchangeFormat } from './formats';
import { filesOf, fromSequence, relink, timelineLength, toSequence, type XTimeline } from './timeline';
import './interchange.css';

/** What the dialogs ask of the computer (swapped out in tests). */
export interface TimelineIO {
  saveAs: (defaultName: string, extension: string, label: string) => Promise<string | null>;
  pick: () => Promise<{ path: string; text: string } | null>;
  write: (path: string, text: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  folder: () => Promise<string | null>;
  findByName: (folder: string, name: string) => Promise<string | null>;
  importFiles: (doc: Doc, paths: string[]) => Promise<void>;
}

/** In a browser (the demo) a file is downloaded and picked with the browser's own chooser. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function browserPick(): Promise<{ path: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = TIMELINE_EXTENSIONS.map((e) => `.${e}`).join(',');
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      void f.text().then((text) => resolve({ path: f.name, text }));
    };
    input.click();
  });
}

export const nativeIO: TimelineIO = {
  saveAs: async (name, extension, label) => {
    if (!inApp()) return name;
    const picked = await save({ title: 'Export timeline', defaultPath: name, filters: [{ name: label, extensions: [extension] }] });
    return picked ?? null;
  },
  pick: async () => {
    if (!inApp()) return browserPick();
    const picked = await open({
      title: 'Import a timeline',
      multiple: false,
      filters: [
        { name: 'Timelines (FCPXML, XML, EDL, OTIO)', extensions: TIMELINE_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (typeof picked !== 'string') return null;
    return { path: picked, text: await native.readText(picked) };
  },
  write: async (path, text) => {
    if (!inApp()) return download(fileName(path), text);
    await native.writeText(path, text);
  },
  exists: (path) => (inApp() ? native.fileExists(path).catch(() => false) : Promise.resolve(false)),
  folder: async () => {
    if (!inApp()) return null;
    const f = await open({ title: 'Where are the files?', directory: true });
    return typeof f === 'string' ? f : null;
  },
  findByName: (folder, name) => native.findByName(folder, name).catch(() => null),
  importFiles: async (doc, paths) => {
    if (inApp() && paths.length) await importFiles(doc, paths, null);
  },
};

/** Export the open (or a chosen) sequence for another editor. */
export function ExportTimelineDialog({ doc, ui, onClose, io = nativeIO }: { doc: Doc; ui: Ui; onClose: () => void; io?: TimelineIO }) {
  const { project } = useDoc(doc);
  const [seqId, setSeqId] = useState(project.open);
  const [format, setFormat] = useState<InterchangeFormat>('fcpxml');
  const [problem, setProblem] = useState('');
  const s = project.sequences.find((x) => x.id === seqId) ?? project.sequences[0];
  const t = useMemo(() => (s ? fromSequence(project, s) : null), [project, s]);
  if (!s || !t) return null;
  const info = formatInfo(format);
  const clips = t.tracks.reduce((n, tr) => n + tr.clips.length, 0);
  const files = filesOf(t).length;

  const run = async () => {
    setProblem('');
    const base = `${s.name || 'Timeline'}.${info.extension}`;
    const suggested = project.eventPath ? joinPath(folderOf(project.eventPath), base) : base;
    try {
      const path = await io.saveAs(suggested, info.extension, info.name);
      if (!path) return;
      await io.write(path, info.write(t));
      ui.note(`Saved ${fileName(path)} for ${info.for.split(',')[0]}`);
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title="Export timeline for other editors" onClose={onClose}>
      <div className="form xch">
        {project.sequences.length > 1 && (
          <label className="form__row">
            <span>Sequence</span>
            <select className="text" value={s.id} onChange={(e) => setSeqId(e.target.value)}>
              {project.sequences.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form__row">
          <span>Format</span>
          <Choice value={format} options={FORMATS.map((f) => [f.id, f.name, `${f.name}: ${f.for}`])} onChange={setFormat} label="Format" />
        </div>
        <p className="xch__for">For {info.for}.</p>
        <p className="xch__note">{info.limits}</p>
        <p className="xch__note">
          {clips} clip{clips === 1 ? '' : 's'} from {files} file{files === 1 ? '' : 's'}, {t.tracks.length} track{t.tracks.length === 1 ? '' : 's'},{' '}
          {t.markers.length} marker{t.markers.length === 1 ? '' : 's'}. The other editor finds the files by name.
        </p>
        {t.notes.length > 0 && (
          <div className="xch__left">
            <span>Stays in Lumora Studio:</span>
            <ul>
              {t.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {problem && <p className="form__problem">{problem}</p>}
        <div className="form__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={clips === 0} onClick={() => void run()}>
            <FileDown />
            Export {info.name.split(' ')[0]}…
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface Found {
  /** File names (lowercase) → where they are on this computer, for files not yet in the project. */
  onDisk: Map<string, string>;
  inProject: number;
  missing: string[];
}

/** Import a timeline from another editor as a new sequence. */
export function ImportTimelineDialog({ doc, ui, onClose, io = nativeIO }: { doc: Doc; ui: Ui; onClose: () => void; io?: TimelineIO }) {
  const { project } = useDoc(doc);
  const [file, setFile] = useState<{ path: string; text: string } | null>(null);
  const [edlFps, setEdlFps] = useState<number>(() => project.sequences.find((x) => x.id === project.open)?.fps ?? 30);
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const parsed = useMemo((): XTimeline | string | null => {
    if (!file) return null;
    try {
      return readTimeline(file.text, file.path, edlFps);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [file, edlFps]);
  const t = typeof parsed === 'object' ? parsed : null;
  const isEdl = !!file && detectFormat(file.text, file.path) === 'edl';

  // Which files are already here, which are where the other editor had them, and which are missing.
  useEffect(() => {
    if (!t) return setFound(null);
    let live = true;
    void (async () => {
      const onDisk = new Map<string, string>();
      const missing: string[] = [];
      let inProject = 0;
      for (const f of filesOf(t)) {
        if (relink(doc.project.media, f)) inProject += 1;
        else if (f.path && (await io.exists(f.path))) onDisk.set(f.name.toLowerCase(), f.path);
        else missing.push(f.name);
      }
      if (live) setFound({ onDisk, inProject, missing });
    })();
    return () => {
      live = false;
    };
  }, [t, doc, io]);

  const choose = async () => {
    setProblem('');
    try {
      const f = await io.pick();
      if (f) setFile(f);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const search = async () => {
    if (!found) return;
    const folder = await io.folder();
    if (!folder) return;
    setBusy(true);
    const onDisk = new Map(found.onDisk);
    const missing: string[] = [];
    for (const name of found.missing) {
      const p = await io.findByName(folder, name);
      if (p) onDisk.set(name.toLowerCase(), p);
      else missing.push(name);
    }
    setFound({ ...found, onDisk, missing });
    setBusy(false);
  };

  const make = async () => {
    if (!t || !found) return;
    setBusy(true);
    setProblem('');
    try {
      // The files found on this computer come in as media first (looked at by FFmpeg), then the sequence links to them.
      await io.importFiles(doc, [...found.onDisk.values()]);
      let made: ReturnType<typeof toSequence>['report'] | null = null;
      doc.edit((p) => {
        const r = toSequence(p, t, found.onDisk);
        made = r.report;
        return r.project;
      }, 'Import timeline');
      const r = made as ReturnType<typeof toSequence>['report'] | null;
      ui.note(
        r
          ? `${t.name}: ${r.clips} clip${r.clips === 1 ? '' : 's'}${r.missing.length ? `, ${r.missing.length} file${r.missing.length === 1 ? '' : 's'} missing (File > Find missing files)` : ''}`
          : `${t.name} imported`,
      );
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const clips = t ? t.tracks.reduce((n, tr) => n + tr.clips.length, 0) : 0;
  const seconds = t ? timelineLength(t) / (t.fps || 30) : 0;
  return (
    <Modal title="Import a timeline" onClose={onClose}>
      <div className="form xch">
        <p className="xch__note">From Final Cut Pro or DaVinci Resolve (FCPXML), Premiere Pro or Resolve (XML), any editor (EDL), or OpenTimelineIO (.otio).</p>
        <div className="form__row">
          <span>File</span>
          <span className="xch__file">{file ? fileName(file.path) : 'None chosen'}</span>
          <button type="button" className="btn" onClick={() => void choose()}>
            <FileUp />
            Choose…
          </button>
        </div>
        {isEdl && (
          <div className="form__row">
            <span>Frame rate</span>
            <Choice value={edlFps} options={FRAME_RATES.map((r) => [r, String(r)] as [number, string])} onChange={setEdlFps} label="The EDL's frame rate" />
          </div>
        )}
        {isEdl && <p className="xch__note">An EDL doesn't say its frame rate: choose the one it was made at.</p>}
        {typeof parsed === 'string' && <p className="form__problem">{parsed}</p>}
        {t && (
          <dl className="xch__sum" aria-label="What is in it">
            <div>
              <dt>Timeline</dt>
              <dd>
                {t.name} · {t.width}×{t.height} · {t.fps} fps · {Math.floor(seconds / 60)}:{String(Math.round(seconds % 60)).padStart(2, '0')}
              </dd>
            </div>
            <div>
              <dt>Clips</dt>
              <dd>
                {clips} on {t.tracks.filter((x) => x.kind === 'video').length} picture and {t.tracks.filter((x) => x.kind === 'audio').length} sound track
                {t.tracks.length === 1 ? '' : 's'}, {t.markers.length} marker{t.markers.length === 1 ? '' : 's'}
              </dd>
            </div>
            <div>
              <dt>Files</dt>
              <dd>
                {found
                  ? `${found.inProject} already in the project · ${found.onDisk.size} found · ${found.missing.length} not found`
                  : 'Looking for the files…'}
              </dd>
            </div>
          </dl>
        )}
        {found && found.missing.length > 0 && (
          <div className="xch__left">
            <span>Not found (they come in as missing; link them later with File &gt; Find missing files):</span>
            <ul>
              {found.missing.slice(0, 8).map((n) => (
                <li key={n}>{n}</li>
              ))}
              {found.missing.length > 8 && <li>and {found.missing.length - 8} more</li>}
            </ul>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void search()}>
              <FolderSearch />
              Look in a folder…
            </button>
          </div>
        )}
        {t && t.notes.length > 0 && (
          <div className="xch__left">
            <span>Not brought in:</span>
            <ul>
              {t.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {problem && <p className="form__problem">{problem}</p>}
        <div className="form__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!t || !found || busy || clips === 0} onClick={() => void make()}>
            Make the sequence
          </button>
        </div>
      </div>
    </Modal>
  );
}
