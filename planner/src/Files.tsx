import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, File as FileIcon, FileImage, FileText, FileVideo, Music, Paperclip, Trash2, Upload } from 'lucide-react';
import * as pro from './apiPro';
import { cueLabel, sortCues, type PlanCue } from './model';
import { db } from './session';
import { newId } from './useItems';
import './lists.css';

export interface FileStore {
  files: pro.PlanFile[];
  loaded: boolean;
  ready: boolean;
  error: string;
  uploading: string[];
  upload: (list: FileList | File[], cueId: string | null) => Promise<void>;
  remove: (f: pro.PlanFile) => Promise<void>;
  open: (f: pro.PlanFile, download?: boolean) => Promise<void>;
  move: (id: string, cueId: string | null) => Promise<void>;
}

export function useFiles(planId: string, enabled = true): FileStore {
  const [files, setFiles] = useState<pro.PlanFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<string[]>([]);
  const reload = useCallback(
    () =>
      pro
        .loadFiles(db(), planId)
        .then((f) => {
          setFiles(f);
          setLoaded(true);
          setReady(true);
        })
        .catch((e: unknown) => {
          const m = e instanceof Error ? e.message : String(e);
          if (/update-10/.test(m)) setReady(false);
          else setError(m);
          setLoaded(true);
        }),
    [planId],
  );
  useEffect(() => {
    if (!enabled) return;
    void reload();
    return pro.watchFiles(db(), planId, { changed: () => void reload() });
  }, [planId, enabled, reload]);

  const upload = useCallback(
    async (list: FileList | File[], cueId: string | null) => {
      setError('');
      const all = Array.from(list);
      const used = files.reduce((a, f) => a + f.size, 0);
      const adding = all.reduce((a, f) => a + f.size, 0);
      if (used + adding > pro.MAX_PLAN_FILES) {
        setError(`That is more than this plan’s 250 MB of files. Delete some first.`);
        return;
      }
      for (const f of all) {
        if (f.size > pro.MAX_FILE) {
          setError(`“${f.name}” is larger than 25 MB. Share a link to it in the notes instead.`);
          continue;
        }
        setUploading((u) => [...u, f.name]);
        try {
          const made = await pro.uploadFile(db(), planId, f, cueId, newId());
          setFiles((fs) => (fs.some((x) => x.id === made.id) ? fs : [...fs, made]));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setUploading((u) => u.filter((n) => n !== f.name));
        }
      }
    },
    [planId, files],
  );

  const remove = useCallback(async (f: pro.PlanFile) => {
    try {
      await pro.deleteFile(db(), f);
      setFiles((fs) => fs.filter((x) => x.id !== f.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const open = useCallback(async (f: pro.PlanFile, download = false) => {
    // Opened at once (a blank tab first, so the browser does not block it), then pointed at the file.
    const w = download ? null : window.open('', '_blank');
    try {
      const url = await pro.fileLink(db(), f, download);
      if (w) w.location.href = url;
      else location.assign(url);
    } catch (e) {
      w?.close();
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const move = useCallback(async (id: string, cueId: string | null) => {
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, cueId } : f)));
    try {
      await pro.moveFile(db(), id, cueId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { files, loaded, ready, error, uploading, upload, remove, open, move };
}

const iconFor = (mime: string, name: string) => {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return Music;
  if (mime === 'application/pdf' || /\.(pdf|docx?|txt|rtf|pages|md)$/i.test(name)) return FileText;
  return FileIcon;
};

/**
 * Files on the plan (or on one cue): drop them in or choose them; open,
 * download or delete them. Stage plots, scripts, slides, logos, videos.
 */
export function FilePanel({
  store,
  cueId,
  cues,
  canEdit,
  compact = false,
}: {
  store: FileStore;
  /** One cue's files; undefined: all of the plan's. */
  cueId?: string;
  cues: PlanCue[];
  canEdit: boolean;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const list = cueId === undefined ? store.files : store.files.filter((f) => f.cueId === cueId);
  const sorted = sortCues(cues);
  const used = store.files.reduce((a, f) => a + f.size, 0);
  if (!store.ready)
    return compact ? null : (
      <p className="muted">Files need the Planner’s show-day update on the Lumora account server (supabase/update-10-planner-pro.sql).</p>
    );
  return (
    <div className="files">
      {compact && <h3 className="files__h">Files{list.length ? ` (${list.length})` : ''}</h3>}
      {list.map((f) => {
        const Icon = iconFor(f.mime, f.name);
        const cueIdx = f.cueId ? sorted.findIndex((c) => c.id === f.cueId) : -1;
        return (
          <div key={f.id} className="files__row">
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="files__name">
              <button type="button" className="link" onClick={() => void store.open(f)} title={`Open ${f.name}`}>
                {f.name}
              </button>
              <span className="muted small">
                {pro.fileSize(f.size)}
                {f.uploadedBy && ` · ${f.uploadedBy}`}
                {cueId === undefined && cueIdx >= 0 && ` · Cue ${cueIdx + 1}: ${cueLabel(sorted[cueIdx]!)}`}
              </span>
            </span>
            {!compact && canEdit ? (
              <select className="input" value={f.cueId ?? ''} onChange={(e) => void store.move(f.id, e.target.value || null)} aria-label={`Cue for ${f.name}`}>
                <option value="">The whole plan</option>
                {sorted.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {i + 1}. {cueLabel(c)}
                  </option>
                ))}
              </select>
            ) : (
              <span />
            )}
            <span className="row">
              <button
                type="button"
                className="btn btn--quiet btn--icon"
                onClick={() => void store.open(f, true)}
                aria-label={`Download ${f.name}`}
                title="Download"
              >
                <Download size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn--quiet btn--icon"
                  onClick={() => confirm(`Delete “${f.name}” for everyone?`) && void store.remove(f)}
                  aria-label={`Delete ${f.name}`}
                  title="Delete"
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
        );
      })}
      {store.uploading.map((n) => (
        <div key={n} className="files__row muted">
          <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="files__name">{n}</span>
          <span />
          <span className="small">Uploading…</span>
        </div>
      ))}
      {canEdit && (
        <div
          className={`files__drop${over ? ' is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (e.dataTransfer.files.length) void store.upload(e.dataTransfer.files, cueId ?? null);
          }}
        >
          <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="small">
            Drop files here or{' '}
            <button type="button" className="link" onClick={() => pick.current?.click()}>
              choose files
            </button>
          </span>
          {!compact && (
            <span className="muted small">
              Up to 25 MB each; {pro.fileSize(pro.MAX_PLAN_FILES - used)} left on this plan. Only people on the plan can open them.
            </span>
          )}
          <input
            ref={pick}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void store.upload(e.target.files, cueId ?? null);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {!canEdit && list.length === 0 && !compact && <p className="muted">No files yet.</p>}
      {store.error && <p className="warn small">{store.error}</p>}
    </div>
  );
}
