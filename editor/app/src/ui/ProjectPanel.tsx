import { useState } from 'react';
import { duration, GENERATORS } from '../model/build';
import { EFFECTS, TRANSITIONS } from '../model/effects';
import { newSequence, type Bin, type MediaItem, type Project } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import { inApp, mediaUrl, native } from '../native';
import { TEXT_PRESETS } from '../render/text';
import type { Actions } from './actions';
import { ColorField, PopMenu, type MenuEntry } from './controls';
import { chooseAndImport, dismissProblem, newBinId, useImporting } from './importer';
import { useStrip } from './peaks';
import type { Ui } from './state';

type Tab = 'media' | 'effects' | 'text';

export function ProjectPanel({ doc, ui, actions }: { doc: Doc; ui: Ui; actions: Actions }) {
  const [tab, setTab] = useState<Tab>('media');
  return (
    <div className="pp">
      <div className="tabs" role="tablist">
        {(
          [
            ['media', 'Media'],
            ['effects', 'Effects'],
            ['text', 'Text & more'],
          ] as [Tab, string][]
        ).map(([t, name]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
            {name}
          </button>
        ))}
      </div>
      {tab === 'media' && <MediaTab doc={doc} ui={ui} actions={actions} />}
      {tab === 'effects' && <EffectsTab doc={doc} actions={actions} />}
      {tab === 'text' && <TextTab actions={actions} />}
    </div>
  );
}

function MediaTab({ doc, ui, actions }: { doc: Doc; ui: Ui; actions: Actions }) {
  const { project } = useDoc(doc);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set(project.bins.map((b) => b.id)));
  const [bin, setBin] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const loading = useImporting();
  const q = search.trim().toLowerCase();
  const matches = (m: MediaItem) => !q || m.name.toLowerCase().includes(q);
  const used = new Set(project.sequences.flatMap((s) => s.clips.map((c) => (c.source.kind === 'media' ? c.source.media : ''))));
  for (const g of project.groups) for (const a of g.angles) used.add(a.media);

  const rename = (id: string, name: string, isBin: boolean) =>
    doc.edit(
      (p: Project) =>
        isBin ? { ...p, bins: p.bins.map((b) => (b.id === id ? { ...b, name } : b)) } : { ...p, media: p.media.map((m) => (m.id === id ? { ...m, name } : m)) },
      'Rename',
    );

  const mediaMenu = (e: React.MouseEvent, m: MediaItem) => {
    e.preventDefault();
    setSelected(m.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Open in source monitor', run: () => ui.set({ source: { media: m.id, time: 0, in: null, out: null }, sourceTab: 'source' }) },
        { label: 'Rename', run: () => setRenaming(m.id) },
        {
          label: 'New sequence from this clip',
          disabled: m.kind === 'audio',
          run: () => {
            const s = newSequence(m.name, even(m.width) || 1920, even(m.height) || 1080, nearestRate(m.fps));
            doc.edit((p) => ({ ...p, sequences: [...p.sequences, s], open: s.id }), 'New sequence');
            actions.addMediaAt(m.id, 0);
          },
        },
        {
          label: 'Move to bin',
          items: [
            { label: '(Top)', run: () => doc.edit((p) => ({ ...p, media: p.media.map((x) => (x.id === m.id ? { ...x, bin: null } : x)) }), 'Move to bin') },
            ...project.bins.map((b) => ({
              label: b.name,
              run: () => doc.edit((p) => ({ ...p, media: p.media.map((x) => (x.id === m.id ? { ...x, bin: b.id } : x)) }), 'Move to bin'),
            })),
          ],
        },
        ...(inApp() ? [{ label: 'Show in folder', run: () => void native.reveal(m.path) }] : []),
        'sep',
        {
          label: used.has(m.id) ? 'Remove (it is used in a sequence)' : 'Remove from project',
          disabled: used.has(m.id),
          run: () => doc.edit((p) => ({ ...p, media: p.media.filter((x) => x.id !== m.id) }), 'Remove media'),
        },
      ],
    });
  };

  const addBin = () => {
    const b: Bin = { id: newBinId(), name: 'New bin', parent: null };
    doc.edit((p) => ({ ...p, bins: [...p.bins, b] }), 'New bin');
    setOpen(new Set([...open, b.id]));
    setRenaming(b.id);
  };

  const row = (m: MediaItem) => (
    <MediaRow
      key={m.id}
      m={m}
      selected={selected === m.id}
      renaming={renaming === m.id}
      onRename={(name) => {
        if (name.trim()) rename(m.id, name.trim(), false);
        setRenaming(null);
      }}
      onClick={() => setSelected(m.id)}
      onOpen={() => ui.set({ source: { media: m.id, time: 0, in: null, out: null }, sourceTab: 'source' })}
      onMenu={(e) => mediaMenu(e, m)}
    />
  );

  const top = project.media.filter((m) => !m.bin || !project.bins.some((b) => b.id === m.bin)).filter(matches);
  return (
    <div className="media">
      <div className="media__bar">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!inApp()}
          onClick={() => void chooseAndImport(doc, bin)}
          title="Add video, sound and pictures (Ctrl+I)"
        >
          Import…
        </button>
        <button type="button" className="btn btn--sm" onClick={addBin} title="A folder to keep things tidy">
          New bin
        </button>
        <button type="button" className="btn btn--sm" onClick={() => ui.set({ dialog: 'newSequence' })} title="A new timeline">
          New sequence
        </button>
        <input
          className="media__search"
          placeholder="Search"
          aria-label="Search the media"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="media__list" onClick={() => setBin(null)}>
        {loading.map((x) => (
          <div key={x.path} className={`media__loading${x.problem ? ' is-bad' : ''}`} title={x.problem ?? x.path}>
            <span>{x.name}</span>
            {x.problem ? (
              <button type="button" className="linkbtn" onClick={() => dismissProblem(x.path)}>
                Could not be read ✕
              </button>
            ) : (
              <i style={{ width: `${Math.round(x.done * 100)}%` }} />
            )}
          </div>
        ))}
        {project.sequences.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`media__seq${s.id === project.open ? ' is-open' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-lumora-seq', s.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => doc.quiet((p) => ({ ...p, open: s.id }))}
            onDoubleClick={() => ui.set({ dialog: 'sequence' })}
            title="A sequence: click to open it on the timeline, or drag it into another sequence"
          >
            <span className="media__icon">▤</span>
            <span className="media__name">{s.name}</span>
            <span className="media__meta">
              {s.width}×{s.height} · {s.fps}
            </span>
          </button>
        ))}
        {project.bins
          .filter((b) => !b.parent)
          .map((b) => {
            const items = project.media.filter((m) => m.bin === b.id && matches(m));
            const isOpen = open.has(b.id) || !!q;
            return (
              <div
                key={b.id}
                className={`media__bin${bin === b.id ? ' is-target' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setBin(b.id);
                }}
              >
                <div className="media__binhead">
                  <button
                    type="button"
                    className="media__fold"
                    aria-expanded={isOpen}
                    onClick={() => {
                      const n = new Set(open);
                      if (n.has(b.id)) n.delete(b.id);
                      else n.add(b.id);
                      setOpen(n);
                    }}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                  {renaming === b.id ? (
                    <input
                      autoFocus
                      className="media__rename"
                      defaultValue={b.name}
                      aria-label="Bin name"
                      onBlur={(e) => {
                        if (e.target.value.trim()) rename(b.id, e.target.value.trim(), true);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  ) : (
                    <span className="media__name" onDoubleClick={() => setRenaming(b.id)}>
                      {b.name}
                    </span>
                  )}
                  <span className="media__meta">{items.length}</span>
                  <button
                    type="button"
                    className="media__x"
                    title="Remove this bin (what is in it moves to the top)"
                    aria-label={`Remove bin ${b.name}`}
                    onClick={() =>
                      doc.edit(
                        (p) => ({ ...p, bins: p.bins.filter((x) => x.id !== b.id), media: p.media.map((m) => (m.bin === b.id ? { ...m, bin: null } : m)) }),
                        'Remove bin',
                      )
                    }
                  >
                    ✕
                  </button>
                </div>
                {isOpen && <div className="media__items">{items.map(row)}</div>}
              </div>
            );
          })}
        {top.map(row)}
        {project.media.length === 0 && loading.length === 0 && (
          <p className="media__empty">{inApp() ? 'Import video, sound and pictures (or drag files onto the window).' : 'Media you import shows here.'}</p>
        )}
      </div>
      {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

const even = (n: number) => Math.round(n / 2) * 2;
const nearestRate = (f: number) => [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a), 30);

function MediaRow({
  m,
  selected,
  renaming,
  onRename,
  onClick,
  onOpen,
  onMenu,
}: {
  m: MediaItem;
  selected: boolean;
  renaming: boolean;
  onRename: (name: string) => void;
  onClick: () => void;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const strip = useStrip(m.kind === 'video' ? (m.proxy ?? m.path) : null, m.duration);
  const k = 30 / 90;
  return (
    <div
      className={`media__item${selected ? ' is-sel' : ''}${m.missing ? ' is-missing' : ''}`}
      draggable
      tabIndex={0}
      title={`${m.path}${m.proxy ? '\n(plays from a ready-made copy while editing)' : ''}`}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-lumora-media', m.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      <span className={`media__thumb media__thumb--${m.kind}`}>
        {m.kind === 'image' && <img src={mediaUrl(m.proxy ?? m.path)} alt="" />}
        {m.kind === 'video' && strip && (
          <i
            style={{
              backgroundImage: `url("${mediaUrl(strip.path)}")`,
              backgroundSize: `${strip.cols * strip.w * k}px auto`,
              backgroundPosition: `${-Math.min(strip.count - 1, 1) * strip.w * k}px 0`,
            }}
          />
        )}
        {m.kind === 'audio' && '♪'}
        {m.kind === 'video' && !strip && '▶'}
      </span>
      {renaming ? (
        <input
          autoFocus
          className="media__rename"
          defaultValue={m.name}
          aria-label="Name"
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <span className="media__name">{m.name}</span>
      )}
      <span className="media__meta">{m.missing ? 'Missing' : m.kind === 'image' ? `${m.width}×${m.height}` : duration(m.duration)}</span>
    </div>
  );
}

function EffectsTab({ doc, actions }: { doc: Doc; actions: Actions }) {
  const { selection } = useDoc(doc);
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const ids = selectedIds(selection);
  const groups = [...new Set(EFFECTS.map((e) => e.group))];
  return (
    <div className="fxlist">
      <input
        className="media__search"
        placeholder="Search effects"
        aria-label="Search effects"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <p className="fxlist__hint">
        Drag onto a clip, or click to add to the selected clips. Transitions: drag onto a cut, or click for the cut at the playhead.
      </p>
      {(['video', 'audio'] as const).map((kind) => {
        const list = TRANSITIONS.filter((t) => t.kind === kind && (!q || t.name.toLowerCase().includes(q)));
        if (!list.length) return null;
        return (
          <div key={kind} className="fxlist__group">
            <h3>{kind === 'video' ? 'Video transitions' : 'Sound transitions'}</h3>
            {list.map((t) => (
              <button
                key={t.type}
                type="button"
                className="fxlist__item fxlist__item--tr"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-lumora-transition', t.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => actions.transition(kind, t.type)}
              >
                {t.name}
              </button>
            ))}
          </div>
        );
      })}
      {groups.map((g) => {
        const list = EFFECTS.filter((e) => e.group === g && (!q || e.name.toLowerCase().includes(q)));
        if (!list.length) return null;
        return (
          <div key={g} className="fxlist__group">
            <h3>{g}</h3>
            {list.map((e) => (
              <button
                key={e.type}
                type="button"
                className={`fxlist__item fxlist__item--${e.kind}`}
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData('application/x-lumora-effect', e.type);
                  ev.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => actions.addEffect(ids, e.type)}
              >
                {e.name}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TextTab({ actions }: { actions: Actions }) {
  const [color, setColor] = useState('#1e3a5f');
  return (
    <div className="fxlist">
      <p className="fxlist__hint">Added at the playhead, on the first free track above the pictures.</p>
      <div className="fxlist__group">
        <h3>Text</h3>
        <div className="tpresets">
          {TEXT_PRESETS.map((t, i) => (
            <button key={t.name} type="button" className="tpreset" onClick={() => actions.addText(i)}>
              <span
                className="tpreset__look"
                style={{ fontWeight: t.data.weight ?? 700, textAlign: t.data.align ?? 'center', WebkitTextStroke: t.data.stroke ? '1px #000' : undefined }}
              >
                {t.data.box ? <b>{(t.data.text ?? '').split('\n')[0]}</b> : (t.data.text ?? '').split('\n')[0]}
              </span>
              <span className="tpreset__name">{t.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="fxlist__group">
        <h3>Generated</h3>
        {GENERATORS.map((g) => (
          <button key={g.gen} type="button" className="fxlist__item fxlist__item--gen" onClick={() => actions.addGenerator(g.gen)}>
            {g.name}
          </button>
        ))}
      </div>
      <div className="fxlist__group">
        <h3>Made here</h3>
        <div className="fxlist__row">
          <button type="button" className="btn btn--sm" onClick={() => actions.addGenerated('color', color)}>
            Color
          </button>
          <ColorField value={color} onChange={setColor} label="Color" />
        </div>
        <button type="button" className="btn btn--sm" onClick={() => actions.addGenerated('color', '#000000')}>
          Black
        </button>
        <button type="button" className="btn btn--sm" title="Its effects change everything under it" onClick={() => actions.addGenerated('adjustment')}>
          Adjustment layer
        </button>
      </div>
    </div>
  );
}
