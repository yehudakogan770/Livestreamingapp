import { defaultFilters } from '../engine/audio';
import { useEffect, useRef, useState } from 'react';
import type { EngineClient, VideoFormat } from '../engine/client';
import type { Logo3d } from '../engine/types/Logo3d';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { Logo3dView } from '../components/Logo3dView';
import { defaultLogo3d } from '../engine/logo3d';
import { defaultAdjust, defaultKey } from '../engine/chroma';
import { inputItem } from '../engine/library';
import { LOOPS } from '../logo3d/background';
import { exportLogoVideo, keepsTransparency } from '../logo3d/export';
import { SaveToLibrary } from './LibraryDialog';
import type { Act } from './act';
import './LogoMaker.css';

const MATERIALS: { id: Logo3d['material']; name: string }[] = [
  { id: 'metal', name: 'Metal' },
  { id: 'glass', name: 'Glass' },
  { id: 'gloss', name: 'Gloss' },
  { id: 'matte', name: 'Matte' },
];
const COLOURS: [string, string][] = [
  ['#b8c0c8', 'Silver'],
  ['#d4a017', 'Gold'],
  ['#e4e5e7', 'White'],
  ['#4fb3bf', 'Teal'],
  ['#4a6fd1', 'Blue'],
  ['#c7372f', 'Red'],
  ['#2f3440', 'Charcoal'],
  ['#8a5cc7', 'Purple'],
];
const BG_COLOURS: [string, string][] = [
  ['#101216', 'Black'],
  ['#1b2a4a', 'Navy'],
  ['#27403f', 'Deep teal'],
  ['#e4e5e7', 'White'],
  ['#00b140', 'Green (for keying)'],
];
const SIZES: [string, number, number][] = [
  ['1920×1080', 1920, 1080],
  ['3840×2160 (4K)', 3840, 2160],
  ['1280×720', 1280, 720],
  ['1080×1080 (square)', 1080, 1080],
  ['1080×1920 (vertical)', 1080, 1920],
];

function Seg<T extends string>({ value, options, onPick, label }: { value: T; options: [T, string][]; onPick: (v: T) => void; label: string }) {
  return (
    <div className="segs lm__segs" role="group" aria-label={label}>
      {options.map(([id, name]) => (
        <button key={id} type="button" className="seg" aria-pressed={value === id} onClick={() => onPick(id)}>
          {name}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  show,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  show: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="lm__slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <em>{show}</em>
    </label>
  );
}

/**
 * The 3D logo maker: bring in a logo, give it depth, a material and light,
 * make it turn, and add it as an input or export it as a video.
 * `source`: the 3D logo input being changed (null: making a new one).
 */
export function LogoMaker({ show, client, act, source, onClose }: { show: Show; client: EngineClient; act: Act; source: Source | null; onClose: () => void }) {
  const [logo, setLogo] = useState<Logo3d>(() => (source?.kind.type === 'logo3d' ? structuredClone(source.kind) : defaultLogo3d()));
  const [name, setName] = useState(source?.name ?? '3D logo');
  const [fileName, setFileName] = useState<string | null>(() => (logo.path ? (logo.path.split(/[\\/]/).pop() ?? null) : null));
  const [seconds, setSeconds] = useState(10);
  const [size, setSize] = useState(0);
  const [fps, setFps] = useState(60);
  const [format, setFormat] = useState<VideoFormat>('mov');
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keeping, setKeeping] = useState(false);
  const stop = useRef(false);
  const set = (p: Partial<Logo3d>) => setLogo((l) => ({ ...l, ...p }));

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && progress === null && !keeping && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, progress, keeping]);

  const path = logo.path || show.event.logo || null;
  const url = path ? client.mediaUrl(path) : null;
  const browse = async () => {
    const f = await client.pickFile('image').catch((e: unknown) => {
      setNotice(e instanceof Error ? e.message : String(e));
      return null;
    });
    if (f) {
      set({ path: f.path, color: logo.color });
      setFileName(f.name);
      if (!source) setName(f.name.replace(/\.[^.]+$/, ''));
    }
  };

  const asSource = (): Source => ({
    id: source?.id ?? 'draft',
    name: name.trim() || '3D logo',
    kind: { type: 'logo3d', ...logo },
    volume: 1,
    muted: true,
    looping: false,
    fit: 'contain',
    key: defaultKey(),
    adjust: defaultAdjust(),
    audio: { follow: true, toMaster: true, toA: true, toB: true, delayMs: 0, filters: defaultFilters() },
  });
  const addOrSave = () => {
    if (source) {
      act({ type: 'updateLogo3d', id: source.id, logo });
      if (name.trim() && name !== source.name) act({ type: 'updateSource', id: source.id, patch: { name: name.trim() } });
    } else {
      act({ type: 'addSource', source: { name: name.trim() || '3D logo', kind: { type: 'logo3d', ...logo } } });
    }
    onClose();
  };

  const [, w, h] = SIZES[size]!;
  const seeThrough = logo.background === 'transparent';
  const mp4Clear = seeThrough && format === 'mp4';
  const exportVideo = async () => {
    setNotice(null);
    const where = await client.chooseVideoFile(name.trim() || '3D logo', format);
    if (!where) return;
    stop.current = false;
    setProgress(0);
    try {
      const file = await exportLogoVideo(client, logo, url, { path: where, seconds, width: w, height: h, fps, format }, setProgress, () => stop.current);
      setNotice(`Saved: ${file}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const turnLabel = logo.motion === 'swing' ? 'One swing' : logo.motion === 'float' ? 'One float' : 'One turn';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="3D logo maker">
      <div className="modal__box lm">
        <header className="modal__head">
          <h2>3D logo maker</h2>
          <input className="text lm__name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <button type="button" className="icon" aria-label="Close" onClick={onClose} disabled={progress !== null}>
            ✕
          </button>
        </header>
        <div className="lm__body">
          <section className="lm__left">
            <div className="lm__import">
              <div className="lm__file">
                <b>{fileName ? fileName.split('.').pop()?.toUpperCase() : show.event.logo ? 'LOGO' : '—'}</b>
                <span>
                  {fileName ?? (show.event.logo ? 'The event logo' : 'No logo yet')}
                  <em>Transparent PNG or SVG works best · SVG gives the sharpest edges</em>
                </span>
              </div>
              <button type="button" className="btn" onClick={() => void browse()}>
                Choose a logo…
              </button>
              {logo.path && show.event.logo && (
                <button type="button" className="btn" onClick={() => (set({ path: '' }), setFileName(null))}>
                  Use the event logo
                </button>
              )}
            </div>
            <div className="lm__stage">
              <Logo3dView logo={logo} url={url} checker onFail={setNotice} />
              {seeThrough && <span className="lm__tag">See-through background</span>}
            </div>
            <div className="lm__row">
              <button
                type="button"
                className="btn"
                aria-label={logo.playing ? 'Stop the motion' : 'Start the motion'}
                onClick={() => set({ playing: !logo.playing })}
              >
                {logo.playing ? '❚❚' : '▶'}
              </button>
              <Slider
                label={logo.playing && logo.motion === 'spin' ? 'Start angle' : logo.playing ? 'Centre angle' : 'Angle'}
                value={logo.angle}
                min={-180}
                max={180}
                show={`${Math.round(logo.angle)}°`}
                onChange={(v) => set({ angle: v })}
              />
            </div>
            <div className="lm__export">
              <span className="lm__label">EXPORT A VIDEO</span>
              <div className="lm__grid">
                <label>
                  Length (seconds)
                  <input
                    className="text"
                    type="number"
                    min={1}
                    max={600}
                    value={seconds}
                    onChange={(e) => setSeconds(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
                  />
                </label>
                <label>
                  Size
                  <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                    {SIZES.map(([n], i) => (
                      <option key={n} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Frame rate
                  <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                    {[60, 50, 30, 25, 24].map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Seg
                label="Format"
                value={format}
                options={[
                  ['mov', 'MOV (keeps transparency)'],
                  ['webm', 'WebM'],
                  ['mp4', 'MP4'],
                ]}
                onPick={setFormat}
              />
              <p className={`field__note${mp4Clear ? ' field__note--warn' : ''}`}>
                {mp4Clear
                  ? 'MP4 can’t keep a see-through background: it will be black. Choose MOV or WebM, or pick a background.'
                  : 'Any length: the motion loops for as many seconds as you type. MOV works in video editors; WebM on websites.'}
              </p>
              {progress !== null && (
                <div className="lm__progress">
                  <progress value={progress} max={1} />
                  <span>{Math.round(progress * 100)}%</span>
                  <button type="button" className="btn" onClick={() => (stop.current = true)}>
                    Stop
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="lm__right">
            <span className="lm__label">LOOK</span>
            <Slider label="Depth" value={logo.depth} min={0} max={60} show={String(Math.round(logo.depth))} onChange={(v) => set({ depth: v })} />
            <Slider label="Bevel" value={logo.bevel} min={0} max={20} show={String(Math.round(logo.bevel))} onChange={(v) => set({ bevel: v })} />
            <span className="lm__sub">Material</span>
            <div className="lm__materials">
              {MATERIALS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`lm__mat lm__mat--${m.id}${logo.material === m.id ? ' is-on' : ''}`}
                  onClick={() => set({ material: m.id })}
                >
                  <i style={{ background: logo.color ?? '#d4a017' }} />
                  {m.name}
                </button>
              ))}
            </div>
            <span className="lm__sub">Color</span>
            <div className="lm__colours">
              {COLOURS.map(([c, n]) => (
                <button
                  key={c}
                  type="button"
                  className={`lm__swatch${logo.color === c ? ' is-on' : ''}`}
                  style={{ background: c }}
                  aria-label={n}
                  title={n}
                  onClick={() => set({ color: c })}
                />
              ))}
              <input type="color" value={logo.color ?? '#ffffff'} onChange={(e) => set({ color: e.target.value })} aria-label="Any color" />
              <button type="button" className={`btn${logo.color === null ? ' is-on' : ''}`} onClick={() => set({ color: null })}>
                Logo’s own
              </button>
            </div>
            <Slider
              label="Light angle"
              value={logo.lightAngle}
              min={-180}
              max={180}
              show={`${Math.round(logo.lightAngle)}°`}
              onChange={(v) => set({ lightAngle: v })}
            />
            <Slider
              label="Light strength"
              value={logo.lightStrength}
              min={0}
              max={1}
              step={0.01}
              show={`${Math.round(logo.lightStrength * 100)}%`}
              onChange={(v) => set({ lightStrength: v })}
            />

            <span className="lm__label">MOTION & CAMERA</span>
            <Seg
              label="Rotation"
              value={logo.motion}
              options={[
                ['spin', 'Full spin'],
                ['swing', 'Back and forth'],
                ['float', 'Float'],
              ]}
              onPick={(v) => set({ motion: v })}
            />
            {logo.motion === 'swing' && (
              <>
                <Slider label="Swing width" value={logo.swing} min={10} max={90} show={`±${Math.round(logo.swing)}°`} onChange={(v) => set({ swing: v })} />
                <div className="lm__row">
                  <span className="lm__sub">At each end</span>
                  <Seg
                    label="At each end"
                    value={logo.ends}
                    options={[
                      ['ease', 'Ease'],
                      ['pause', 'Pause'],
                      ['bounce', 'Bounce'],
                    ]}
                    onPick={(v) => set({ ends: v })}
                  />
                </div>
              </>
            )}
            <Slider
              label={turnLabel}
              value={logo.seconds}
              min={1.5}
              max={30}
              step={0.5}
              show={`${logo.seconds.toFixed(1)} s`}
              onChange={(v) => set({ seconds: v })}
            />
            <Slider
              label="Camera distance"
              value={logo.camera}
              min={0}
              max={1}
              step={0.01}
              show={`${Math.round(logo.camera * 100)}%`}
              onChange={(v) => set({ camera: v })}
            />
            <span className="lm__sub">Background</span>
            <Seg
              label="Background"
              value={logo.background}
              options={[
                ['transparent', 'See-through'],
                ['colour', 'Color'],
                ['loop', 'Moving loop'],
              ]}
              onPick={(v) => set({ background: v })}
            />
            {logo.background === 'colour' && (
              <div className="lm__colours">
                {BG_COLOURS.map(([c, n]) => (
                  <button
                    key={c}
                    type="button"
                    className={`lm__swatch lm__swatch--wide${logo.bgColor === c ? ' is-on' : ''}`}
                    style={{ background: c }}
                    aria-label={n}
                    title={n}
                    onClick={() => set({ bgColor: c })}
                  />
                ))}
                <input type="color" value={logo.bgColor} onChange={(e) => set({ bgColor: e.target.value })} aria-label="Any background color" />
              </div>
            )}
            {logo.background === 'loop' && (
              <select
                value={`${logo.bgScene.bank}:${logo.bgScene.scene}`}
                onChange={(e) => {
                  const [b, s] = e.target.value.split(':').map(Number);
                  set({ bgScene: { bank: b ?? 0, scene: s ?? 0 } });
                }}
                aria-label="Background loop"
              >
                {LOOPS.map((l) => (
                  <option key={l.name} value={`${l.scene.bank}:${l.scene.scene}`}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            {seeThrough && <p className="field__note">Only the logo: on a screen, whatever is behind it shows (use it as an overlay).</p>}
          </section>
        </div>
        <footer className="modal__foot">
          <span className="lm__summary">{notice ?? `${seconds} s · ${SIZES[size]![0]} · ${fps} fps · ${format.toUpperCase()}`}</span>
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={() => setKeeping(true)} disabled={progress !== null}>
            Save to library
          </button>
          <button type="button" className="btn" onClick={() => void exportVideo()} disabled={progress !== null}>
            Export video…
          </button>
          <button type="button" className="btn btn--primary" onClick={addOrSave} disabled={progress !== null}>
            {source ? 'Save changes' : 'Add as input'}
          </button>
        </footer>
      </div>
      {keeping && <SaveToLibrary client={client} item={inputItem(asSource(), 'Logos')} onClose={() => setKeeping(false)} />}
    </div>
  );
}
