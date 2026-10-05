import { useEffect, useRef, useState } from 'react';
import { parseEvent, type EventFile } from '../model/event';
import { buildEventProject, duration, type Prepared } from '../model/build';
import type { Project } from '../model/types';
import { baseName, folderOf, joinPath, native } from '../native';

type Status = 'waiting' | 'working' | 'ready' | 'missing';

interface Item {
  label: string;
  kind: 'Live Screen' | 'Camera' | 'Microphone';
  path: string;
  status: Status;
  found?: Prepared;
  problem?: string;
}

/**
 * A recording moved with its event file (to another drive or computer) is
 * found next to the event file, or in its "event files" folder.
 */
export async function findFile(path: string, eventFolder: string): Promise<string | null> {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const parent = folderOf(path);
  const parentName = parent.slice(Math.max(parent.lastIndexOf('/'), parent.lastIndexOf('\\')) + 1);
  const tries = [path, joinPath(eventFolder, name), joinPath(joinPath(eventFolder, parentName), name)];
  // A browser recording may already have become an .mp4.
  const all = tries.flatMap((p) => (/\.mkv$/i.test(p) ? [p, p.replace(/\.mkv$/i, '.mp4')] : [p]));
  for (const p of all) if (await native.fileExists(p)) return p;
  return null;
}

/** Getting every recording ready, then laying out the event. */
export function Getting({
  eventPath,
  text,
  onDone,
  onCancel,
}: {
  eventPath: string;
  text: string;
  onDone: (p: Project) => void;
  onCancel: (problem?: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [result, setResult] = useState<{ project: Project; missing: Item[] } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let event: EventFile;
      try {
        event = parseEvent(text);
      } catch (e) {
        onCancel(e instanceof Error ? e.message : String(e));
        return;
      }
      const folder = folderOf(eventPath);
      const list: Item[] = [];
      const program = event.program.mp4 ?? event.program.path;
      if (program) list.push({ label: 'Live Screen recording', kind: 'Live Screen', path: program, status: 'waiting' });
      for (const f of event.files)
        list.push({ label: f.name.replace(/\s*\(sound\)$/, ''), kind: f.kind === 'camera' ? 'Camera' : 'Microphone', path: f.path, status: 'waiting' });
      setItems([...list]);
      const media = new Map<string, Prepared>();
      const moved = new Map<string, string>();
      for (const [i, item] of list.entries()) {
        list[i] = { ...item, status: 'working' };
        setItems([...list]);
        let path = await findFile(item.path, folder);
        if (!path && item.kind === 'Live Screen' && event.program.path) path = await findFile(event.program.path, folder);
        if (!path) {
          list[i] = { ...item, status: 'missing', problem: 'Not found' };
          setItems([...list]);
          continue;
        }
        try {
          const found = await native.prepare(path);
          media.set(item.path, found);
          if (found.path !== item.path) moved.set(item.path, found.path);
          list[i] = { ...item, status: 'ready', found };
        } catch (e) {
          list[i] = { ...item, status: 'missing', problem: e instanceof Error ? e.message : String(e) };
        }
        setItems([...list]);
      }
      // The event file learns where its recordings are now (so it opens straight away next time).
      if (moved.size > 0) {
        const fixed: EventFile = {
          ...event,
          program: {
            path: event.program.path && moved.has(event.program.path) ? (moved.get(event.program.path) ?? null) : event.program.path,
            mp4: program ? (moved.get(program) ?? event.program.mp4) : event.program.mp4,
          },
          files: event.files.map((f) => ({ ...f, path: moved.get(f.path) ?? f.path })),
        };
        await native.writeText(eventPath, JSON.stringify(fixed, null, 2)).catch(() => {});
      }
      try {
        const project = buildEventProject(event, eventPath, media);
        project.name = event.name || baseName(eventPath);
        const missing = list.filter((x) => x.status === 'missing');
        if (missing.length === 0) onDone(project);
        else setResult({ project, missing });
      } catch (e) {
        onCancel(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [eventPath, text, onDone, onCancel]);

  const done = items.filter((x) => x.status === 'ready' || x.status === 'missing').length;
  return (
    <div className="start">
      <div className="getting">
        <h1>Getting the event ready</h1>
        <p className="start__lead">Each recording is checked and made ready to play smoothly. Nothing is lost or changed in the pictures.</p>
        <div className="getting__bar">
          <i style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </div>
        <ul className="getting__list">
          {items.map((x, i) => (
            <li key={i} className={`is-${x.status}`}>
              <span className="getting__kind">{x.kind}</span>
              <span className="getting__name">{x.label}</span>
              <span className="getting__state">
                {x.status === 'waiting' && 'Waiting'}
                {x.status === 'working' && 'Getting ready…'}
                {x.status === 'ready' && `Ready · ${duration((x.found?.durationMs ?? 0) / 1000)}`}
                {x.status === 'missing' && (x.problem === 'Not found' ? 'Not found' : 'Could not be read')}
              </span>
            </li>
          ))}
        </ul>
        {result && (
          <div className="getting__missing">
            <p>
              {result.missing.length === 1 ? 'One recording was' : `${result.missing.length} recordings were`} not found:{' '}
              {result.missing.map((m) => m.label).join(', ')}. Keep the event file in the same folder as its recordings to use them. You can edit with the rest
              now.
            </p>
            <div className="getting__row">
              <button type="button" className="btn" onClick={() => onCancel()}>
                Back
              </button>
              <button type="button" className="btn btn--primary" onClick={() => onDone(result.project)}>
                Edit with what was found
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
