import { sendCommand } from './commands';
import { useEffect, useRef, useState } from 'react';
import { isSoundFile, type EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { SourcePatch } from '../engine/types/SourcePatch';
import { SourceView } from '../components/SourceView';
import type { Act } from './act';
import { useProblems } from '../problems/problems';
import { TextEditor } from './TextEditor';
import { SplitEditor } from './SplitEditor';
import { SlideshowEditor } from './SlideshowEditor';
import { SaveToLibrary } from './LibraryDialog';
import { GreenScreenDialog } from './GreenScreenDialog';
import { InputSettings } from './InputSettings';
import { isAdjusted } from '../engine/chroma';
import { inputItem } from '../engine/library';

const KIND_NAME: Record<Source['kind']['type'], string> = {
  camera: 'Camera',
  video: 'Video',
  image: 'Picture',
  color: 'Colour',
  pattern: 'Test pattern',
  microphone: 'Microphone',
  countdown: 'Countdown',
  pesukim: '12 Pesukim',
  text: 'Text',
  credits: 'Credits',
  split: 'Split screen',
  slideshow: 'Slideshow',
  visuals: 'Stage visuals',
  logo3d: '3D logo',
};

/** Every input as a tile. Click lines it up next; double-click sends it straight to air. */
export function InputGrid({
  show,
  screen,
  client,
  act,
  onAdd,
  only = null,
}: {
  show: Show;
  screen: ScreenId;
  client: EngineClient;
  act: Act;
  onAdd: () => void;
  /** Show only these inputs (the picked preset's), in this order. */
  only?: string[] | null;
}) {
  const sc = show.screens[screen];
  const problemIds = new Set(useProblems().flatMap((p) => (p.sourceId ? [p.sourceId] : [])));
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editingText = show.sources.find((x) => x.id === editing && x.kind.type === 'text');
  const editingSplit = show.sources.find((x) => x.id === editing && x.kind.type === 'split');
  const editingSlides = show.sources.find((x) => x.id === editing && x.kind.type === 'slideshow');
  const [keeping, setKeeping] = useState<string | null>(null);
  const [keying, setKeying] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const adjustSource = show.sources.find((x) => x.id === adjusting);
  const keySource = show.sources.find((x) => x.id === keying);
  const keepSource = show.sources.find((x) => x.id === keeping);
  const textOnly = screen === 'monitor';
  return (
    <div className="inputs" aria-label="Inputs">
      {(only ? only.map((id) => show.sources.find((s) => s.id === id)).filter((s) => s !== undefined) : show.sources).map((src) => {
        const i = show.sources.indexOf(src);
        const onAir = sc.program === src.id;
        const next = sc.preview === src.id && !onAir;
        // Microphones and music files are heard, never shown: they live in the mixer.
        const soundFile = src.kind.type === 'video' && isSoundFile(src.kind.path);
        const soundOnly = soundFile || src.kind.type === 'microphone';
        const playing = src.kind.type === 'video' && src.kind.playback.playing;
        return (
          <div key={src.id} className={`tile${onAir ? ' tile--pgm' : ''}${next ? ' tile--pvw' : ''}`}>
            <button
              type="button"
              className="tile__pick"
              disabled={textOnly || soundOnly}
              aria-label={`${i + 1} ${src.name}`}
              title={soundOnly ? 'Sound only: use the mixer' : 'Click: line up next · Double-click: straight to air'}
              onClick={() => act({ type: 'setPreview', screen, sourceId: src.id })}
              onDoubleClick={() => act({ type: 'cutTo', screen, sourceId: src.id })}
            >
              <span className="tile__thumb">{soundFile ? <span className="tile__sound">♪</span> : <SourceView source={src} client={client} thumb />}</span>
              <span className="tile__num">{i + 1}</span>
              {problemIds.has(src.id) && (
                <span className="tile__warn" title="Something is wrong with this input: see the problem light">
                  ⚠
                </span>
              )}
              {onAir && <span className="tile__badge tile__badge--pgm">ON AIR</span>}
              {next && <span className="tile__badge tile__badge--pvw">NEXT</span>}
              <span className="tile__name">{src.name}</span>
              <span className="tile__kind">
                {soundFile ? 'Sound' : KIND_NAME[src.kind.type]}
                {src.kind.type === 'video' && src.looping ? ' · loop' : ''}
              </span>
            </button>
            {soundFile && (
              <button
                type="button"
                className={`tile__play${playing ? ' is-on' : ''}`}
                aria-label={playing ? `Pause ${src.name}` : `Play ${src.name}`}
                onClick={() => act({ type: playing ? 'pause' : 'play', id: src.id })}
              >
                {playing ? '❚❚' : '▶'}
              </button>
            )}
            <button type="button" className="tile__more" aria-label={`Options for ${src.name}`} onClick={() => setMenu(menu === src.id ? null : src.id)}>
              ⋯
            </button>
            {menu === src.id && (
              <TileMenu
                source={src}
                act={act}
                onClose={() => setMenu(null)}
                onEditText={() => setEditing(src.id)}
                onKeep={() => setKeeping(src.id)}
                onKey={() => setKeying(src.id)}
                onAdjust={() => setAdjusting(src.id)}
              />
            )}
          </div>
        );
      })}
      <button type="button" className="tile tile--add" onClick={onAdd}>
        <span className="tile--add__plus">+</span>
        Add input
      </button>
      {editingText && <TextEditor source={editingText} act={act} onClose={() => setEditing(null)} />}
      {adjustSource && <InputSettings show={show} source={adjustSource} act={act} client={client} onSwitch={setAdjusting} onClose={() => setAdjusting(null)} />}
      {keySource && <GreenScreenDialog show={show} source={keySource} act={act} client={client} onClose={() => setKeying(null)} />}
      {keepSource && <SaveToLibrary client={client} item={inputItem(keepSource, '')} onClose={() => setKeeping(null)} />}
      {editingSlides && <SlideshowEditor source={editingSlides} sources={show.sources} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingSplit && <SplitEditor source={editingSplit} sources={show.sources} act={act} client={client} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TileMenu({
  source,
  act,
  onClose,
  onEditText,
  onKeep,
  onKey,
  onAdjust,
}: {
  source: Source;
  act: Act;
  onClose: () => void;
  onEditText: () => void;
  onKeep: () => void;
  onKey: () => void;
  onAdjust: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  // Everything is changed here first and applied on Done; clicking away or Esc cancels.
  const colour = source.kind.type === 'color' ? source.kind.color : source.kind.type === 'countdown' ? source.kind.background : null;
  const [draft, setDraft] = useState({
    name: source.name,
    color: colour,
    fit: source.fit,
    looping: source.looping,
    volume: source.volume,
    muted: source.muted,
  });
  const set = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }));
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const done = () => {
    const patch: SourcePatch = {};
    if (draft.name.trim() && draft.name !== source.name) patch.name = draft.name;
    if (draft.color !== null && draft.color !== colour) patch.color = draft.color;
    if (draft.fit !== source.fit) patch.fit = draft.fit;
    if (draft.looping !== source.looping) patch.looping = draft.looping;
    if (draft.volume !== source.volume) patch.volume = draft.volume;
    if (draft.muted !== source.muted) patch.muted = draft.muted;
    if (Object.keys(patch).length) act({ type: 'updateSource', id: source.id, patch });
    onClose();
  };

  const k = source.kind.type;
  return (
    <div ref={ref} className="menu" role="dialog" aria-label={`Options for ${source.name}`}>
      <label className="menu__row">
        Name
        <input value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && done()} />
      </label>
      {draft.color !== null && (
        <label className="menu__row">
          {k === 'countdown' ? 'Background' : 'Colour'}
          <input type="color" value={draft.color} onChange={(e) => set({ color: e.target.value })} />
        </label>
      )}
      {(k === 'video' || k === 'image' || k === 'camera') && (
        <div className="menu__row">
          Picture
          <span className="segs">
            <button type="button" className="seg" aria-pressed={draft.fit === 'contain'} onClick={() => set({ fit: 'contain' })}>
              Whole
            </button>
            <button type="button" className="seg" aria-pressed={draft.fit === 'cover'} onClick={() => set({ fit: 'cover' })}>
              Fill
            </button>
          </span>
        </div>
      )}
      {k === 'video' && (
        <label className="menu__row menu__row--check">
          <input type="checkbox" checked={draft.looping} onChange={(e) => set({ looping: e.target.checked })} /> Loop at the end
        </label>
      )}
      {(k === 'video' || k === 'microphone') && (
        <>
          <label className="menu__row">
            Volume
            <input type="range" min={0} max={100} value={Math.round(draft.volume * 100)} onChange={(e) => set({ volume: Number(e.target.value) / 100 })} />
          </label>
          <label className="menu__row menu__row--check">
            <input type="checkbox" checked={draft.muted} onChange={(e) => set({ muted: e.target.checked })} /> Mute
          </label>
        </>
      )}
      {k === 'logo3d' && (
        <button
          type="button"
          className="btn menu__wide"
          onClick={() => {
            onClose();
            sendCommand({ type: 'logoMaker', id: source.id });
          }}
        >
          Edit 3D logo…
        </button>
      )}
      {(k === 'text' || k === 'split' || k === 'slideshow') && (
        <button
          type="button"
          className="btn menu__wide"
          onClick={() => {
            onClose();
            onEditText();
          }}
        >
          {k === 'text' ? 'Edit text…' : k === 'split' ? 'Edit split screen…' : 'Edit slides…'}
        </button>
      )}
      <button
        type="button"
        className="btn menu__wide"
        onClick={() => {
          onClose();
          onKeep();
        }}
      >
        Save to library…
      </button>
      {(k === 'camera' || k === 'video' || k === 'image') && (
        <button
          type="button"
          className={`btn menu__wide${source.key.enabled ? ' is-on' : ''}`}
          onClick={() => {
            onClose();
            onKey();
          }}
        >
          Green screen{source.key.enabled ? ' (on)' : ''}…
        </button>
      )}
      {(k === 'camera' || k === 'video' || k === 'image') && (
        <button
          type="button"
          className={`btn menu__wide${isAdjusted(source.adjust) ? ' is-on' : ''}`}
          onClick={() => {
            onClose();
            onAdjust();
          }}
        >
          Adjust picture{isAdjusted(source.adjust) ? ' (on)' : ''}…
        </button>
      )}
      <div className="menu__foot">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={done}>
          Done
        </button>
      </div>
      <button
        type="button"
        className={`menu__remove${confirm ? ' is-armed' : ''}`}
        onClick={() => {
          if (!confirm) setConfirm(true);
          else {
            act({ type: 'removeSource', id: source.id });
            onClose();
          }
        }}
      >
        {confirm ? 'Click again to remove' : 'Remove input'}
      </button>
    </div>
  );
}
