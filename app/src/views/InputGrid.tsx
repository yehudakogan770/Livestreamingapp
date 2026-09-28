import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { SourcePatch } from '../engine/types/SourcePatch';
import { SourceView } from '../components/SourceView';
import type { Act } from './act';

const KIND_NAME: Record<Source['kind']['type'], string> = {
  camera: 'Camera',
  video: 'Video',
  image: 'Picture',
  color: 'Colour',
  pattern: 'Test pattern',
};

/** Every input as a tile. Click lines it up next; double-click sends it straight to air. */
export function InputGrid({
  show,
  screen,
  client,
  act,
  onAdd,
}: {
  show: Show;
  screen: ScreenId;
  client: EngineClient;
  act: Act;
  onAdd: () => void;
}) {
  const sc = show.screens[screen];
  const [menu, setMenu] = useState<string | null>(null);
  const textOnly = screen === 'monitor';
  return (
    <div className="inputs" aria-label="Inputs">
      {show.sources.map((src, i) => {
        const onAir = sc.program === src.id;
        const next = sc.preview === src.id && !onAir;
        return (
          <div key={src.id} className={`tile${onAir ? ' tile--pgm' : ''}${next ? ' tile--pvw' : ''}`}>
            <button
              type="button"
              className="tile__pick"
              disabled={textOnly}
              aria-label={`${i + 1} ${src.name}`}
              title="Click: line up next · Double-click: straight to air"
              onClick={() => act({ type: 'setPreview', screen, sourceId: src.id })}
              onDoubleClick={() => act({ type: 'cutTo', screen, sourceId: src.id })}
            >
              <span className="tile__thumb">
                <SourceView source={src} client={client} thumb />
              </span>
              <span className="tile__num">{i + 1}</span>
              {onAir && <span className="tile__badge tile__badge--pgm">ON AIR</span>}
              {next && <span className="tile__badge tile__badge--pvw">NEXT</span>}
              <span className="tile__name">{src.name}</span>
              <span className="tile__kind">{KIND_NAME[src.kind.type]}{src.kind.type === 'video' && src.looping ? ' · loop' : ''}</span>
            </button>
            <button type="button" className="tile__more" aria-label={`Options for ${src.name}`} onClick={() => setMenu(menu === src.id ? null : src.id)}>
              ⋯
            </button>
            {menu === src.id && <TileMenu source={src} act={act} onClose={() => setMenu(null)} />}
          </div>
        );
      })}
      <button type="button" className="tile tile--add" onClick={onAdd}>
        <span className="tile--add__plus">+</span>
        Add input
      </button>
    </div>
  );
}

function TileMenu({ source, act, onClose }: { source: Source; act: Act; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(source.name);
  const [confirm, setConfirm] = useState(false);
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
  const patch = (p: SourcePatch) => act({ type: 'updateSource', id: source.id, patch: p });
  return (
    <div ref={ref} className="menu" role="dialog" aria-label={`Options for ${source.name}`}>
      <label className="menu__row">
        Name
        <input
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== source.name && patch({ name })}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), onClose())}
        />
      </label>
      {source.kind.type === 'color' && (
        <label className="menu__row">
          Colour
          <input type="color" value={source.kind.color} onChange={(e) => patch({ color: e.target.value })} />
        </label>
      )}
      {(source.kind.type === 'video' || source.kind.type === 'image' || source.kind.type === 'camera') && (
        <div className="menu__row">
          Picture
          <span className="segs">
            <button type="button" className="seg" aria-pressed={source.fit === 'contain'} onClick={() => patch({ fit: 'contain' })}>Whole</button>
            <button type="button" className="seg" aria-pressed={source.fit === 'cover'} onClick={() => patch({ fit: 'cover' })}>Fill</button>
          </span>
        </div>
      )}
      {source.kind.type === 'video' && (
        <>
          <label className="menu__row menu__row--check">
            <input type="checkbox" checked={source.looping} onChange={(e) => patch({ looping: e.target.checked })} /> Loop at the end
          </label>
          <label className="menu__row">
            Volume
            <input type="range" min={0} max={100} value={Math.round(source.volume * 100)} onChange={(e) => patch({ volume: Number(e.target.value) / 100 })} />
          </label>
          <label className="menu__row menu__row--check">
            <input type="checkbox" checked={source.muted} onChange={(e) => patch({ muted: e.target.checked })} /> Mute
          </label>
        </>
      )}
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
