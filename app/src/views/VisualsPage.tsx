import { Hand, Metronome, Minus, Plus, Spotlight, Star, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Visuals } from '../engine/types/Visuals';
import type { VisualsFx } from '../engine/types/VisualsFx';
import type { VisualsPatch } from '../engine/types/VisualsPatch';
import type { VisualsSettings } from '../engine/types/VisualsSettings';
import type { VisualsText } from '../engine/types/VisualsText';
import type { VisualsLogo } from '../engine/types/VisualsLogo';
import type { SceneRef } from '../engine/types/SceneRef';
import { VisualsView } from '../components/VisualsView';
import { BANKS, PALETTES, sceneColours, sceneRow } from '../visuals/data';
import { beatAt, defaultFx, resetFx } from '../visuals/player';
import { useSceneStill } from '../visuals/stills';
import type { Act } from './act';
import { useNow } from '../engine/useNow';
import './VisualsPage.css';

type Tab = 'look' | 'effects' | 'layers' | 'logo';

const PADS = [
  { id: 'strobe', name: 'Strobe', key: 'Z hold', tip: 'Fast white flashes while held' },
  { id: 'flash', name: 'Flash', key: 'X', tip: 'One white flash' },
  { id: 'black', name: 'Blackout', key: 'B', tip: 'Fade to black' },
  { id: 'freeze', name: 'Freeze', key: 'Q', tip: 'Stop all movement' },
  { id: 'invert', name: 'Invert', key: 'I', tip: 'Swap the colors' },
  { id: 'text', name: 'Text', key: 'L', tip: 'Show your words on the visuals' },
  { id: 'random', name: 'Random', key: 'R', tip: 'A random scene and effects' },
  { id: 'reset', name: 'Reset effects', key: 'E', tip: 'Back to the scene as designed' },
  { id: 'colours', name: 'Colors', key: 'C', tip: 'Next color set' },
  { id: 'next', name: 'Next scene', key: 'Space', tip: 'The next scene in this music type' },
] as const;
type PadId = (typeof PADS)[number]['id'];

const same = (a: SceneRef, b: SceneRef) => a.bank === b.bank && a.scene === b.scene;
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

/** Radial gradient of a color set, for the scene pads. */
/** The scene's three colors as flat bands (shown until its still is made). */
function swatch(c: [string, string, string]) {
  return `linear-gradient(90deg, ${c[0]} 0 33.34%, ${c[1]} 0 66.67%, ${c[2]} 0)`;
}

/**
 * Stage visuals: choose the music type and scene, keep the beat, and play
 * the effects live. Everything here changes the show, so every screen with a
 * Stage visuals input (and the recording) follows at once.
 */
export function VisualsPage({ show, act, client, onClose }: { show: Show; act: Act; client: EngineClient; onClose: () => void }) {
  const v = show.visuals;
  // Re-draws the page a few times a second, so "NEXT" turns into "LIVE" on the beat.
  const now = useNow(false, 200);
  const [bank, setBank] = useState(v.scene.bank);
  const [tab, setTab] = useState<Tab>('look');
  const [saving, setSaving] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const taps = useRef<number[]>([]);
  const latest = useRef(v);
  latest.current = v;

  const patch = (p: VisualsPatch) => act({ type: 'updateVisuals', patch: p });
  const setSettings = (p: Partial<VisualsSettings>) => patch({ settings: { ...latest.current.settings, ...p } });
  const setFx = (p: Partial<VisualsFx>) => patch({ fx: { ...latest.current.fx, ...p } });
  const setText = (p: Partial<VisualsText>) => patch({ text: { ...latest.current.text, ...p } });
  const setLogo = (p: Partial<VisualsLogo>) => patch({ logo: { ...latest.current.logo, ...p } });
  const launch = (scene: SceneRef) => act({ type: 'visualsScene', scene });

  const tap = () => {
    const t = performance.now();
    let list = taps.current;
    if (list.length && t - list[list.length - 1]! > 2000) list = [];
    list = [...list, t].slice(-8);
    taps.current = list;
    if (list.length >= 3) act({ type: 'visualsTempo', bpm: 60000 / ((list[list.length - 1]! - list[0]!) / (list.length - 1)) });
  };
  const randomize = () => {
    const cur = latest.current;
    const n = BANKS[bank]!.scenes.length;
    let i = Math.floor(Math.random() * n);
    if (bank === cur.scene.bank && i === cur.scene.scene) i = (i + 1) % n;
    launch({ bank, scene: i });
    setFx({
      zoom: pick([1, 1, 1.2, 1.5, 0.8]),
      spin: pick([0, 0, 0.3, -0.3, 0.6]),
      panX: 0,
      panY: 0,
      pump: pick([0, 0.3, 0.6]),
      kal: pick([0, 0, 0, 4, 6, 8]),
      mirror: pick([0, 0, 0, 1, 3]),
      hue: pick([0, 0, Math.random() * 6.28]),
      hueCycle: pick([0, 0, 0.2]),
      sat: 1,
      con: 1,
      glow: pick([0, 0.3, 0.6]),
      trail: pick([0, 0, 0.7, 0.85]),
      echo: pick([0, 0.01, -0.01]),
      echoRot: pick([0, 0, 0.01]),
      rgb: pick([0, 0, 0.4]),
      pix: 0,
      post: 0,
    });
  };
  const pad = (id: PadId, down: boolean) => {
    const cur = latest.current;
    if (id === 'strobe') {
      if (!cur.settings.safe) patch({ strobe: down });
      return;
    }
    if (!down) return;
    if (id === 'flash') act({ type: 'visualsFlash' });
    else if (id === 'black') patch({ blackout: !cur.blackout });
    else if (id === 'freeze') patch({ freeze: cur.frozen === null });
    else if (id === 'invert') patch({ invert: !cur.invert });
    else if (id === 'text') setText({ on: !cur.text.on });
    else if (id === 'random') randomize();
    else if (id === 'reset') patch({ fx: resetFx(cur.fx) });
    else if (id === 'colours') {
      const keys = ['scene', ...Object.keys(PALETTES)];
      setSettings({ palette: keys[(keys.indexOf(cur.settings.palette) + 1) % keys.length]! });
    } else if (id === 'next') act({ type: 'visualsStep', step: 1 });
  };
  const padOn = (id: PadId) =>
    id === 'strobe'
      ? v.strobe
      : id === 'black'
        ? v.blackout
        : id === 'freeze'
          ? v.frozen !== null
          : id === 'invert'
            ? v.invert
            : id === 'text'
              ? v.text.on
              : false;

  // The live keyboard, as in Stage Visuals Live.
  const keys = useRef({ pad, tap, launch, bank, setBank, onClose });
  keys.current = { pad, tap, launch, bank, setBank, onClose };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.key === 'Escape') return k.onClose();
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const map: Record<string, PadId> = { z: 'strobe', x: 'flash', b: 'black', q: 'freeze', i: 'invert', l: 'text', r: 'random', e: 'reset', c: 'colours' };
      let used = true;
      if (/^Digit[0-9]$/.test(e.code)) {
        const d = Number(e.code.slice(5));
        const n = d === 0 ? 9 : d - 1;
        if (e.shiftKey) k.setBank(Math.min(n, BANKS.length - 1));
        else if (n < BANKS[k.bank]!.scenes.length) k.launch({ bank: k.bank, scene: n });
      } else if (key === ' ' || e.key === 'ArrowRight') {
        if (!e.repeat) act({ type: 'visualsStep', step: 1 });
      } else if (e.key === 'ArrowLeft') act({ type: 'visualsStep', step: -1 });
      else if (e.key === 'ArrowUp') k.setBank((k.bank + BANKS.length - 1) % BANKS.length);
      else if (e.key === 'ArrowDown') k.setBank((k.bank + 1) % BANKS.length);
      else if (key === 't') k.tap();
      else if (key === 's') act({ type: 'visualsSync' });
      else if (key === '+' || key === '=') act({ type: 'visualsTempo', bpm: latest.current.bpm + 1 });
      else if (key === '-') act({ type: 'visualsTempo', bpm: latest.current.bpm - 1 });
      else if (map[key]) {
        if (!e.repeat) k.pad(map[key], true);
      } else used = false;
      if (used) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'z') keys.current.pad('strobe', false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [act]);

  // Where the visuals are on air.
  const visualsIds = show.sources.filter((s) => s.kind.type === 'visuals').map((s) => s.id);
  const onScreen = (sc: ScreenId) => visualsIds.includes(show.screens[sc].program ?? '');
  const showOn = async (screens: ScreenId[]) => {
    let id = visualsIds[0];
    if (!id) {
      id = 'stage-visuals';
      // Added first (and waited for), so the cut finds it.
      await client.dispatch({ type: 'addSource', source: { id, name: 'Stage visuals', kind: { type: 'visuals' } } }).catch(() => undefined);
    }
    for (const screen of screens) act({ type: 'cutTo', screen, sourceId: id });
  };
  const outName = onScreen('back') && onScreen('live') ? 'BACK + LIVE' : onScreen('back') ? 'BACK SCREEN' : onScreen('live') ? 'LIVE SCREEN' : null;

  const row = sceneRow(v.scene.bank, v.scene.scene);
  const favs = new Set(v.favourites.map((f) => `${f.bank}:${f.scene}`));
  const toggleFav = (r: SceneRef) => patch({ favourites: favs.has(`${r.bank}:${r.scene}`) ? v.favourites.filter((f) => !same(f, r)) : [...v.favourites, r] });
  const energy = Math.round(((v.settings.speed - 0.5) / 1) * 100);
  const setEnergy = (e: number) => setSettings({ speed: 0.5 + e / 100, flash: Math.min(1, 0.25 + (e / 100) * 0.75) });

  return (
    <div className="modal vis-modal" role="dialog" aria-modal="true" aria-label="Stage visuals">
      <div className="modal__box vis">
        <header className="vis__head">
          <Spotlight className="vis__icon" aria-hidden="true" />
          <h2>Stage visuals</h2>
          <div className="segs" role="group" aria-label="Show on">
            {(
              [
                ['back', 'Back Screen'],
                ['live', 'Live Screen'],
                ['both', 'Both'],
              ] as const
            ).map(([id, name]) => {
              const on = id === 'both' ? onScreen('back') && onScreen('live') : onScreen(id) && !(onScreen('back') && onScreen('live'));
              return (
                <button
                  key={id}
                  type="button"
                  className="seg"
                  aria-pressed={on}
                  title={`Put the visuals on air on the ${name === 'Both' ? 'Back and Live Screens' : name}`}
                  onClick={() => void showOn(id === 'both' ? ['back', 'live'] : [id])}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <span className="vis__spacer" />
          <div className="vis__tempo">
            <button type="button" className="btn" aria-label="Slower" onClick={() => act({ type: 'visualsTempo', bpm: v.bpm - 1 })}>
              <Minus aria-hidden="true" />
            </button>
            <span className="vis__bpm">
              <b aria-label="Tempo">{Number(v.bpm.toFixed(1))}</b> BPM
            </span>
            <button type="button" className="btn" aria-label="Faster" onClick={() => act({ type: 'visualsTempo', bpm: v.bpm + 1 })}>
              <Plus aria-hidden="true" />
            </button>
            <button type="button" className="btn" onClick={tap} title="Tap along with the music (T)">
              <Hand aria-hidden="true" />
              Tap
            </button>
            <button type="button" className="btn" onClick={() => act({ type: 'visualsSync' })} title="Press on beat 1 of a bar (S)">
              <Metronome aria-hidden="true" />
              Sync to 1
            </button>
            <BeatDots v={v} />
          </div>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="vis__body">
          {/* Left: what is showing, pads, looks */}
          <section className="vis__left">
            <div className="vis__live">
              <VisualsView v={v} logoUrl={show.event.logo ? client.mediaUrl(show.event.logo) : null} />
              <span className={`vis__air${outName ? ' is-on' : ''}`}>{outName ? `ON AIR · ${outName}` : 'Not on a screen yet'}</span>
              <span className="vis__now">
                {BANKS[v.scene.bank]?.name} · {row[0]}
              </span>
              <span className="vis__mode">{v.settings.autoBars ? `Autopilot · every ${v.settings.autoBars} bars` : 'Manual'}</span>
            </div>
            <div className="vis__pads">
              {PADS.map((p) => {
                const blocked = p.id === 'strobe' && v.settings.safe;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`vis__pad${padOn(p.id) ? ' is-on' : ''}`}
                    disabled={blocked}
                    title={blocked ? 'Turned off by Safe mode' : p.tip}
                    onPointerDown={() => pad(p.id, true)}
                    onPointerUp={() => p.id === 'strobe' && pad('strobe', false)}
                    onPointerLeave={() => p.id === 'strobe' && v.strobe && pad('strobe', false)}
                  >
                    {p.name}
                    <small>{p.key}</small>
                  </button>
                );
              })}
            </div>
            <div className="vis__row">
              <div className="vis__energy">
                <span>Energy</span>
                <input type="range" min={0} max={100} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} aria-label="Energy" />
                <NumberBox label="Energy" value={energy} min={0} max={100} step={1} onChange={setEnergy} />
                <em>{energy < 30 ? 'Calm' : energy < 70 ? 'Lively' : 'Full power'}</em>
              </div>
            </div>
            <div className="vis__row">
              <button
                type="button"
                className={`btn${v.settings.autoBars ? ' is-on' : ''}`}
                onClick={() => setSettings({ autoBars: v.settings.autoBars ? 0 : 16 })}
                title="Change scene by itself"
              >
                Autopilot
              </button>
              <span className="vis__dim">every</span>
              <div className="segs">
                {[8, 16, 32, 64].map((n) => (
                  <button key={n} type="button" className="seg" aria-pressed={v.settings.autoBars === n} onClick={() => setSettings({ autoBars: n })}>
                    {n}
                  </button>
                ))}
              </div>
              <span className="vis__dim">bars</span>
              <span className="vis__spacer" />
              <label className="check" title="No strobe and gentler flashes: flashing light can affect people with epilepsy">
                <input type="checkbox" checked={v.settings.safe} onChange={(e) => setSettings({ safe: e.target.checked })} /> Safe mode
              </label>
            </div>
            <div className="vis__looks">
              <div className="vis__row">
                <span className="vis__label">Saved looks</span>
                <span className="vis__spacer" />
                <button type="button" className={`btn${saving ? ' is-on' : ''}`} onClick={() => setSaving(!saving)}>
                  {saving ? 'Choose a slot…' : 'Save look'}
                </button>
              </div>
              <div className="vis__slots">
                {v.looks.map((l, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`vis__slot${l ? ' is-full' : ''}${saving ? ' is-saving' : ''}`}
                    disabled={!l && !saving}
                    onClick={() => {
                      act({ type: 'visualsLook', slot: i, store: saving });
                      setSaving(false);
                    }}
                  >
                    <b>Look {i + 1}</b>
                    <em>{l ? `${BANKS[l.scene.bank]?.name} · ${sceneRow(l.scene.bank, l.scene.scene)[0]}` : 'Empty'}</em>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Middle: music types and scenes */}
          <section className="vis__mid">
            <div className="vis__banks" role="tablist" aria-label="Music type">
              {BANKS.map((b, i) => (
                <button
                  key={b.name}
                  type="button"
                  role="tab"
                  aria-selected={bank === i}
                  className={`vis__bank${bank === i ? ' is-on' : ''}`}
                  onClick={() => setBank(i)}
                >
                  <b>{b.name}</b>
                  <em>~{b.bpm} BPM</em>
                </button>
              ))}
            </div>
            <div className="vis__row">
              <span className="vis__desc">{BANKS[bank]?.desc}</span>
              <span className="vis__spacer" />
              <button type="button" className={`btn vis__favbtn${favOnly ? ' is-on' : ''}`} onClick={() => setFavOnly(!favOnly)}>
                <Star aria-hidden="true" />
                Favorites
              </button>
            </div>
            <div className="vis__scenes">
              {BANKS[bank]!.scenes.map((s, i) => ({ s, i }))
                .filter(({ i }) => !favOnly || favs.has(`${bank}:${i}`))
                .map(({ s, i }) => {
                  const ref = { bank, scene: i };
                  const live = same(v.scene, ref);
                  const coming = live && v.fadeStart > beatAt(v, now);
                  return (
                    <SceneTile key={i} bank={bank} scene={i} palette={v.settings.palette} live={live}>
                      <button type="button" className="vis__pick" aria-label={s[0]} onClick={() => launch(ref)} />
                      {live && <span className="vis__badge">{coming ? 'NEXT' : 'LIVE'}</span>}
                      <button
                        type="button"
                        className={`vis__star${favs.has(`${bank}:${i}`) ? ' is-on' : ''}`}
                        aria-label={`Favorite ${s[0]}`}
                        aria-pressed={favs.has(`${bank}:${i}`)}
                        onClick={() => toggleFav(ref)}
                      >
                        ★
                      </button>
                      <span className="vis__name">
                        {s[0]}
                        <em>{i + 1}</em>
                      </span>
                    </SceneTile>
                  );
                })}
            </div>
            <div className="vis__row">
              <span className="vis__label">Change scene</span>
              <div className="segs">
                {(
                  [
                    ['now', 'Now'],
                    ['beat', 'Next beat'],
                    ['bar', 'Next bar'],
                  ] as const
                ).map(([q, name]) => (
                  <button key={q} type="button" className="seg" aria-pressed={v.settings.quantize === q} onClick={() => setSettings({ quantize: q })}>
                    {name}
                  </button>
                ))}
              </div>
              <span className="vis__label">Fade</span>
              <div className="segs">
                {(
                  [
                    [-1, 'Auto'],
                    [0, 'Cut'],
                    [1, '1 beat'],
                    [4, '4 beats'],
                  ] as const
                ).map(([f, name]) => (
                  <button key={f} type="button" className="seg" aria-pressed={v.settings.fade === f} onClick={() => setSettings({ fade: f })}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Right: look and effects */}
          <section className="vis__right">
            <div className="segs vis__tabs" role="tablist">
              {(
                [
                  ['look', 'Look'],
                  ['effects', 'Effects'],
                  ['layers', 'Layers'],
                  ['logo', 'Logo'],
                ] as const
              ).map(([id, name]) => (
                <button key={id} type="button" role="tab" className="seg" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                  {name}
                </button>
              ))}
            </div>
            <div className="vis__groups">
              {tab === 'look' && <LookTab v={v} setFx={setFx} setSettings={setSettings} />}
              {tab === 'effects' && <EffectsTab v={v} setFx={setFx} setSettings={setSettings} />}
              {tab === 'layers' && <LayersTab v={v} setFx={setFx} setText={setText} />}
              {tab === 'logo' && <LogoTab v={v} hasLogo={!!show.event.logo} setLogo={setLogo} />}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** A scene button: a still of the scene itself (its colors until the still is made). */
function SceneTile({ bank, scene, palette, live, children }: { bank: number; scene: number; palette: string; live: boolean; children: React.ReactNode }) {
  const still = useSceneStill(bank, scene, palette);
  const colors = swatch(sceneColours(sceneRow(bank, scene), palette));
  return (
    <div className={`vis__scene${live ? ' is-live' : ''}`} style={{ background: still ? `center / cover no-repeat url(${still}), ${colors}` : colors }}>
      {children}
    </div>
  );
}

/** The four beats of the bar, lit on the beat. */
function BeatDots({ v }: { v: Visuals }) {
  const ref = useRef<HTMLSpanElement>(null);
  const latest = useRef(v);
  latest.current = v;
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const loop = () => {
      const cur = latest.current;
      const b = cur.frozen ?? beatAt(cur, Date.now());
      const d = ((Math.floor(b) % 4) + 4) % 4;
      if (d !== last && ref.current) {
        last = d;
        ref.current.querySelectorAll('i').forEach((el, i) => el.classList.toggle('is-lit', i === d));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span ref={ref} className="vis__dots" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  def,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  def?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="vis__slider" title={def !== undefined ? 'Double-click to reset' : undefined}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => def !== undefined && onChange(def)}
      />
      <NumberBox label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}

/**
 * The value of a slider, to type in: Enter or leaving the box sets it (kept
 * within the slider's range), Escape puts it back, the arrow keys step it
 * (Shift: ten steps).
 */
function NumberBox({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const places = Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));
  const shown = Number(value.toFixed(places)).toString();
  const [draft, setDraft] = useState<string | null>(null);
  const fit = (x: number) => Number(Math.min(max, Math.max(min, Math.round(x / step) * step)).toFixed(places));
  const apply = () => {
    if (draft === null) return;
    const x = Number(draft.replace(',', '.'));
    if (draft.trim() !== '' && Number.isFinite(x)) onChange(fit(x));
    setDraft(null);
  };
  return (
    <input
      className="vis__num"
      type="text"
      inputMode="decimal"
      aria-label={`${label} (type a value)`}
      value={draft ?? shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          apply();
          e.currentTarget.select();
        } else if (e.key === 'Escape') {
          // Put it back (and keep the visuals page open).
          e.stopPropagation();
          setDraft(null);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const from = draft !== null && Number.isFinite(Number(draft)) ? Number(draft) : value;
          onChange(fit(from + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
          setDraft(null);
        }
      }}
    />
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="vis__group">
      <span className="vis__label">{title}</span>
      {children}
    </div>
  );
}

type FxProps = { v: Visuals; setFx: (p: Partial<VisualsFx>) => void; setSettings: (p: Partial<VisualsSettings>) => void };
const D = defaultFx();

function LookTab({ v, setFx, setSettings }: FxProps) {
  const f = v.fx;
  const mirror = f.kal ? 'kal' : String(f.mirror);
  return (
    <>
      <Group title="Colors">
        <select value={v.settings.palette} onChange={(e) => setSettings({ palette: e.target.value })} aria-label="Colors">
          <option value="scene">Scene’s own colors</option>
          {Object.entries(PALETTES).map(([k, p]) => (
            <option key={k} value={k}>
              {p.name}
            </option>
          ))}
        </select>
        <Slider label="Shift colors" value={f.hue} min={0} max={6.28} def={0} onChange={(x) => setFx({ hue: x })} />
        <Slider label="Cycle colors with the beat" value={f.hueCycle} min={0} max={1} def={0} onChange={(x) => setFx({ hueCycle: x })} />
        <Slider label="Color strength" value={f.sat} min={0} max={2} def={1} onChange={(x) => setFx({ sat: x })} />
        <Slider label="Contrast" value={f.con} min={0.5} max={2} def={1} onChange={(x) => setFx({ con: x })} />
        <Slider label="Glow" value={f.glow} min={0} max={1.5} def={0} onChange={(x) => setFx({ glow: x })} />
      </Group>
      <Group title="Camera">
        <Slider label="Zoom" value={f.zoom} min={0.5} max={3} def={1} onChange={(x) => setFx({ zoom: x })} />
        <Slider label="Spin (with the beat)" value={f.spin} min={-2} max={2} def={0} onChange={(x) => setFx({ spin: x })} />
        <Slider label="Move left / right" value={f.panX} min={-0.6} max={0.6} def={0} onChange={(x) => setFx({ panX: x })} />
        <Slider label="Move up / down" value={f.panY} min={-0.4} max={0.4} def={0} onChange={(x) => setFx({ panY: x })} />
        <Slider label="Zoom kick on the beat" value={f.pump} min={0} max={1} def={0} onChange={(x) => setFx({ pump: x })} />
      </Group>
      <Group title="Mirror">
        <div className="segs">
          {(
            [
              ['0', 'Off'],
              ['1', 'Left / right'],
              ['2', 'Top / bottom'],
              ['3', 'Four-way'],
              ['kal', 'Kaleido'],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              type="button"
              className="seg"
              aria-pressed={mirror === id}
              onClick={() => setFx(id === 'kal' ? { kal: f.kal || 6, mirror: 0 } : { kal: 0, mirror: Number(id) })}
            >
              {name}
            </button>
          ))}
        </div>
        {f.kal > 0 && (
          <div className="segs">
            {[3, 4, 6, 8, 12].map((n) => (
              <button key={n} type="button" className="seg" aria-pressed={f.kal === n} onClick={() => setFx({ kal: n })}>
                {n} sides
              </button>
            ))}
          </div>
        )}
      </Group>
      <Group title="Motion and output">
        <Slider label="Speed" value={v.settings.speed} min={0.25} max={2} def={1} onChange={(x) => setSettings({ speed: x })} />
        <Slider label="Beat flash" value={v.settings.flash} min={0} max={1} def={1} onChange={(x) => setSettings({ flash: x })} />
        <Slider label="Brightness" value={v.settings.bright} min={0} max={1.5} def={1} onChange={(x) => setSettings({ bright: x })} />
      </Group>
    </>
  );
}

function EffectsTab({ v, setFx, setSettings }: FxProps) {
  const f = v.fx;
  const st = v.settings;
  return (
    <>
      <Group title="Trails">
        <Slider label="Trails" value={f.trail} min={0} max={0.97} def={D.trail} onChange={(x) => setFx({ trail: x })} />
        <Slider label="Trail zoom" value={f.echo} min={-0.05} max={0.05} step={0.001} def={0} onChange={(x) => setFx({ echo: x })} />
        <Slider label="Trail spin" value={f.echoRot} min={-0.05} max={0.05} step={0.001} def={0} onChange={(x) => setFx({ echoRot: x })} />
        <Slider label="RGB split" value={f.rgb} min={0} max={1} def={0} onChange={(x) => setFx({ rgb: x })} />
      </Group>
      <Group title="Retro">
        <Slider label="Pixelate" value={f.pix} min={0} max={24} step={1} def={0} onChange={(x) => setFx({ pix: x })} />
        <Slider label="TV lines" value={f.scan} min={0} max={1} def={0} onChange={(x) => setFx({ scan: x })} />
        <Slider label="Dark edges" value={f.vig} min={0} max={1} def={0} onChange={(x) => setFx({ vig: x })} />
        <label className="vis__select">
          <span>Posterize</span>
          <select value={f.post} onChange={(e) => setFx({ post: Number(e.target.value) })}>
            {[0, 2, 3, 4, 6].map((n) => (
              <option key={n} value={n}>
                {n ? `${n} levels` : 'Off'}
              </option>
            ))}
          </select>
        </label>
      </Group>
      <Group title="Timing and quality">
        <label className="vis__select">
          <span>Beat flash happens</span>
          <select value={st.flashEvery} onChange={(e) => setSettings({ flashEvery: Number(e.target.value) })}>
            <option value={1}>Every beat</option>
            <option value={2}>Every 2 beats</option>
            <option value={4}>Every bar</option>
            <option value={0}>Never</option>
          </select>
        </label>
        <label className="vis__select">
          <span>Strobe speed</span>
          <select value={st.strobeDiv} onChange={(e) => setSettings({ strobeDiv: Number(e.target.value) })}>
            <option value={1}>Slow (every beat)</option>
            <option value={2}>Medium (8th notes)</option>
            <option value={4}>Fast (16th notes)</option>
          </select>
        </label>
        <label className="vis__select">
          <span>Blackout fade</span>
          <select value={st.slowBlackout ? 'slow' : 'quick'} onChange={(e) => setSettings({ slowBlackout: e.target.value === 'slow' })}>
            <option value="quick">Quick</option>
            <option value="slow">Slow</option>
          </select>
        </label>
        <label className="vis__select">
          <span>Picture quality</span>
          <select value={st.quality} onChange={(e) => setSettings({ quality: Number(e.target.value) })}>
            <option value={1}>High</option>
            <option value={0.75}>Medium</option>
            <option value={0.5}>Low (for older computers)</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={st.bankTempo} onChange={(e) => setSettings({ bankTempo: e.target.checked })} /> A new music type sets its own tempo
        </label>
        <label className="check">
          <input type="checkbox" checked={st.autoRandom} onChange={(e) => setSettings({ autoRandom: e.target.checked })} /> Autopilot picks scenes at random
        </label>
      </Group>
    </>
  );
}

function LayersTab({ v, setFx, setText }: { v: Visuals; setFx: (p: Partial<VisualsFx>) => void; setText: (p: Partial<VisualsText>) => void }) {
  const f = v.fx;
  const t = v.text;
  return (
    <>
      <Group title="Overlay scene">
        <label className="vis__select">
          <span>Music type</span>
          <select value={f.ovScene.bank} onChange={(e) => setFx({ ovScene: { bank: Number(e.target.value), scene: 0 } })} aria-label="Overlay music type">
            {BANKS.map((b, i) => (
              <option key={b.name} value={i}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="vis__select">
          <span>Scene</span>
          <select value={f.ovScene.scene} onChange={(e) => setFx({ ovScene: { ...f.ovScene, scene: Number(e.target.value) } })} aria-label="Overlay scene">
            {BANKS[f.ovScene.bank]?.scenes.map((s, i) => (
              <option key={i} value={i}>
                {s[0]}
              </option>
            ))}
          </select>
        </label>
        <Slider label="Overlay amount" value={f.ov} min={0} max={1} def={0} onChange={(x) => setFx({ ov: x })} />
        <div className="segs">
          {['Add', 'Screen', 'Lighten', 'Mask'].map((name, i) => (
            <button key={name} type="button" className="seg" aria-pressed={f.ovMode === i} onClick={() => setFx({ ovMode: i })}>
              {name}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Text on screen">
        <input
          className="text"
          value={t.words}
          maxLength={60}
          placeholder="Band name, song, “Happy birthday Maria”"
          onChange={(e) => setText({ words: e.target.value })}
          aria-label="Words on the visuals"
        />
        <label className="check">
          <input type="checkbox" checked={t.on} onChange={(e) => setText({ on: e.target.checked })} /> Show the text
        </label>
        <label className="vis__select">
          <span>Font</span>
          <select value={t.font} onChange={(e) => setText({ font: e.target.value })}>
            <option value="clean">Clean</option>
            <option value="bold">Tall and bold</option>
            <option value="elegant">Elegant script</option>
            <option value="classic">Classic serif</option>
          </select>
        </label>
        <label className="vis__select">
          <span>Color</span>
          <input type="color" value={t.color} onChange={(e) => setText({ color: e.target.value })} />
        </label>
        <Slider label="Size" value={t.size} min={0.2} max={1.2} def={0.6} onChange={(x) => setText({ size: x })} />
        <Slider label="Height on screen" value={t.y} min={-0.4} max={0.4} def={0} onChange={(x) => setText({ y: x })} />
        <Slider label="Pulse on the beat" value={t.pulse} min={0} max={1} def={0.3} onChange={(x) => setText({ pulse: x })} />
      </Group>
    </>
  );
}

function LogoTab({ v, hasLogo, setLogo }: { v: Visuals; hasLogo: boolean; setLogo: (p: Partial<VisualsLogo>) => void }) {
  const l = v.logo;
  return (
    <>
      <Group title="Event logo">
        {!hasLogo && <p className="field__note">Add the event logo first (Event menu → Event setup…).</p>}
        <label className="check">
          <input type="checkbox" checked={l.on} disabled={!hasLogo} onChange={(e) => setLogo({ on: e.target.checked })} /> Show the logo on the visuals
        </label>
      </Group>
      <Group title="Position">
        <div className="segs">
          {(
            [
              ['corner', 'Corner'],
              ['centre', 'Center'],
              ['bottom', 'Bottom'],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" className="seg" aria-pressed={l.place === id} onClick={() => setLogo({ place: id })}>
              {name}
            </button>
          ))}
        </div>
        <Slider label="Size" value={l.size} min={0.05} max={0.6} def={0.18} onChange={(x) => setLogo({ size: x })} />
        <Slider label="Pulse on the beat" value={l.pulse} min={0} max={1} def={0.3} onChange={(x) => setLogo({ pulse: x })} />
      </Group>
    </>
  );
}
