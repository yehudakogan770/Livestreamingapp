import { AudioLines, Headphones, Plus, Sigma, Trash2, Volume2, VolumeX, Waypoints } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { updateTrack } from '../model/edit';
import {
  addBus,
  compressorGainReduction,
  eqResponse,
  fxNumber,
  MASTER,
  mixOf,
  removeBus,
  routeTrack,
  setFxParam,
  setMixVolume,
  stripFx,
  toggleFx,
  updateBus,
  type StripFxType,
} from '../model/mix';
import { current } from '../model/seq';
import type { Effect, Sequence, TrackRole } from '../model/types';
import { useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { Scrub, Section } from './controls';
import { METER_ZONES } from './Timeline';

const dbText = (v: number): string => (v > -60 ? `${v > 0 ? '+' : ''}${v.toFixed(1)} dB` : '−∞');

/**
 * The Audio page's mixer: a strip for each sound track and bus, and one for
 * the whole mix. A strip's EQ, Dynamics and Limiter buttons show what it
 * processes; choose a strip's name to set them in the panel beside.
 */
export function Mixer({ doc, engine }: { doc: Doc; engine: Engine }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const tracks = s.tracks.filter((t) => t.kind === 'audio');
  const mix = mixOf(s);
  const [master, setMaster] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const strip = chosen === MASTER || mix.buses.some((b) => b.id === chosen) || tracks.some((t) => t.id === chosen) ? chosen : null;

  const fxButtons = (id: string) => {
    const fx = stripFx(s, id);
    const on = (t: StripFxType) => fx.some((e) => e.type === t && e.on);
    return (
      <div className="estrip__fx" role="group" aria-label="Processing">
        {(
          [
            ['eq', 'EQ', 'Equalizer'],
            ['compressor', 'Dyn', 'Dynamics (compressor)'],
            ['limiter', 'Lim', 'Limiter'],
          ] as [StripFxType, string, string][]
        ).map(([t, short, long]) => (
          <button
            key={t}
            type="button"
            className={`estrip__fxbtn${on(t) ? ' is-on' : ''}`}
            aria-pressed={on(t)}
            title={`${long}: ${on(t) ? 'on' : 'off'} (choose the strip's name to set it)`}
            onClick={() => doc.edit((p) => toggleFx(p, id, t, !on(t)), on(t) ? `${long} off` : `${long} on`)}
          >
            {short}
          </button>
        ))}
      </div>
    );
  };

  const nameButton = (id: string, name: string, icon: React.ReactNode) => (
    <button
      type="button"
      className={`estrip__name${strip === id ? ' is-chosen' : ''}`}
      title={`${name}: processing and output`}
      aria-pressed={strip === id}
      onClick={() => setChosen(strip === id ? null : id)}
    >
      {icon}
      {name}
    </button>
  );

  return (
    <div className="emix">
      {tracks.map((t) => (
        <div key={t.id} className={`estrip${t.off ? ' is-muted' : ''}${t.solo ? ' is-solo' : ''}`}>
          {nameButton(t.id, t.name, <AudioLines />)}
          <select
            className="estrip__role"
            value={t.role ?? ''}
            aria-label={`${t.name}: what it carries`}
            title="Speech tracks make Music tracks turn down while someone talks"
            onChange={(e) => doc.edit((p) => updateTrack(p, t.id, { role: (e.target.value || undefined) as TrackRole | undefined }), 'Track role')}
          >
            <option value="">—</option>
            <option value="dialogue">Speech</option>
            <option value="music">Music</option>
          </select>
          {fxButtons(t.id)}
          <div className="estrip__pan">
            <span>Pan</span>
            <Scrub
              value={Math.round(t.pan * 100)}
              min={-100}
              max={100}
              step={1}
              label={`${t.name} pan`}
              onChange={(v, final) => doc.edit((p) => updateTrack(p, t.id, { pan: v / 100 }), 'Pan', final ? undefined : `pan-${t.id}`)}
            />
          </div>
          <div className="estrip__body">
            <Meter engine={engine} id={t.id} />
            <input
              className="estrip__fader"
              type="range"
              min={-60}
              max={12}
              step={0.5}
              value={t.volume}
              aria-label={`${t.name} volume`}
              onChange={(e) => doc.edit((p) => updateTrack(p, t.id, { volume: Number(e.target.value) }), 'Track volume', `vol-${t.id}`)}
              onDoubleClick={() => doc.edit((p) => updateTrack(p, t.id, { volume: 0 }), 'Track volume')}
            />
          </div>
          <span className="estrip__db">{dbText(t.volume)}</span>
          <select
            className="estrip__role"
            value={t.bus && mix.buses.some((b) => b.id === t.bus) ? t.bus : ''}
            aria-label={`${t.name}: plays through`}
            title="Where this track goes: straight into the mix, or through a bus"
            onChange={(e) => doc.edit((p) => routeTrack(p, t.id, e.target.value || null), 'Track output')}
          >
            <option value="">To the mix</option>
            {mix.buses.map((b) => (
              <option key={b.id} value={b.id}>
                To {b.name}
              </option>
            ))}
          </select>
          <div className="estrip__btns">
            <button
              type="button"
              className={`th__btn th__btn--m${t.off ? ' is-on' : ''}`}
              aria-pressed={t.off}
              title="Mute"
              aria-label="Mute"
              onClick={() => doc.edit((p) => updateTrack(p, t.id, { off: !t.off }), 'Mute')}
            >
              {t.off ? <VolumeX /> : <Volume2 />}
            </button>
            <button
              type="button"
              className={`th__btn th__btn--s${t.solo ? ' is-on' : ''}`}
              aria-pressed={t.solo}
              title="Solo"
              aria-label="Solo"
              onClick={() => doc.edit((p) => updateTrack(p, t.id, { solo: !t.solo }), 'Solo')}
            >
              <Headphones />
            </button>
          </div>
        </div>
      ))}
      {mix.buses.map((b) => (
        <div key={b.id} className={`estrip estrip--bus${b.off ? ' is-muted' : ''}`}>
          {nameButton(b.id, b.name, <Waypoints />)}
          <span className="estrip__kind">Bus · {tracks.filter((t) => t.bus === b.id).length} tracks</span>
          {fxButtons(b.id)}
          <div className="estrip__pan">
            <span>Pan</span>
            <Scrub
              value={Math.round(b.pan * 100)}
              min={-100}
              max={100}
              step={1}
              label={`${b.name} pan`}
              onChange={(v, final) => doc.edit((p) => updateBus(p, b.id, { pan: v / 100 }), 'Pan', final ? undefined : `pan-${b.id}`)}
            />
          </div>
          <div className="estrip__body">
            <Meter engine={engine} id={b.id} />
            <input
              className="estrip__fader"
              type="range"
              min={-60}
              max={12}
              step={0.5}
              value={b.volume}
              aria-label={`${b.name} volume`}
              onChange={(e) => doc.edit((p) => updateBus(p, b.id, { volume: Number(e.target.value) }), 'Bus volume', `vol-${b.id}`)}
              onDoubleClick={() => doc.edit((p) => updateBus(p, b.id, { volume: 0 }), 'Bus volume')}
            />
          </div>
          <span className="estrip__db">{dbText(b.volume)}</span>
          <div className="estrip__btns">
            <button
              type="button"
              className={`th__btn th__btn--m${b.off ? ' is-on' : ''}`}
              aria-pressed={b.off}
              title="Mute"
              aria-label="Mute"
              onClick={() => doc.edit((p) => updateBus(p, b.id, { off: !b.off }), 'Mute')}
            >
              {b.off ? <VolumeX /> : <Volume2 />}
            </button>
          </div>
        </div>
      ))}
      <div className="estrip estrip--add">
        <button
          type="button"
          className="btn btn--sm"
          title="A bus mixes the tracks sent to it, so they can be processed and leveled together"
          onClick={() => {
            let id = '';
            doc.edit((p) => {
              const out = addBus(p);
              id = out.id;
              return out.project;
            }, 'Add bus');
            setChosen(id);
          }}
        >
          <Plus />
          Bus
        </button>
      </div>
      <div className="estrip estrip--master">
        {nameButton(MASTER, 'Everything', <Sigma />)}
        <span className="estrip__kind" title="The whole mix's level in the film">
          Mix {dbText(mix.volume)}
        </span>
        {fxButtons(MASTER)}
        <div className="estrip__body">
          <Meter engine={engine} id="master" stereo />
          <input
            className="estrip__fader"
            type="range"
            min={-60}
            max={12}
            step={0.5}
            value={master}
            aria-label="Overall volume (while editing)"
            title="How loud it plays while editing (the film is not changed)"
            onChange={(e) => {
              const v = Number(e.target.value);
              setMaster(v);
              engine.setMaster(v);
            }}
          />
        </div>
        <span className="estrip__db">{master.toFixed(1)} dB</span>
        <span className="estrip__hint">Listening only</span>
      </div>
      {strip && <StripPanel doc={doc} s={s} id={strip} onClose={() => setChosen(null)} />}
    </div>
  );
}

/** The chosen strip's processing: EQ with its curve, dynamics with its curve, limiter; a bus's name; the mix's level. */
function StripPanel({ doc, s, id, onClose }: { doc: Doc; s: Sequence; id: string; onClose: () => void }) {
  const mix = mixOf(s);
  const bus = mix.buses.find((b) => b.id === id);
  const track = s.tracks.find((t) => t.id === id);
  const name = id === MASTER ? 'Everything' : (bus?.name ?? track?.name ?? '');
  const fx = stripFx(s, id);
  const get = (t: StripFxType) => fx.find((e) => e.type === t);
  const on = (t: StripFxType) => !!get(t)?.on;
  const set = (t: StripFxType, key: string) => (v: number, final: boolean) =>
    doc.edit((p) => setFxParam(p, id, t, key, v), 'Mix setting', final ? undefined : `fx-${id}-${t}-${key}`);
  const toggle = (t: StripFxType, label: string) => (
    <label className="check">
      <input
        type="checkbox"
        checked={on(t)}
        onChange={(e) => doc.edit((p) => toggleFx(p, id, t, e.target.checked), `${label} ${e.target.checked ? 'on' : 'off'}`)}
      />{' '}
      On
    </label>
  );
  const eq = get('eq');
  const comp = get('compressor');
  const lim = get('limiter');
  const row = (label: string, value: number, change: (v: number, final: boolean) => void, min: number, max: number, step: number, unit: string) => (
    <div className="insp__row">
      <span className="field__label">{label}</span>
      <Scrub value={value} min={min} max={max} step={step} unit={unit} label={`${name} ${label}`} onChange={change} />
    </div>
  );
  return (
    <aside className="emix__panel" aria-label={`${name}: processing`}>
      <header className="emix__head">
        <h3>{name}</h3>
        <button type="button" className="linkbtn" onClick={onClose}>
          Close
        </button>
      </header>
      {bus && (
        <div className="insp__row">
          <span className="field__label">Name</span>
          <input
            className="text text--sm"
            value={bus.name}
            aria-label="Bus name"
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => doc.edit((p) => updateBus(p, bus.id, { name: e.target.value }), 'Bus name', `busname-${bus.id}`)}
          />
          <button
            type="button"
            className="btn btn--sm"
            title="Take this bus away (its tracks go straight into the mix)"
            onClick={() => {
              doc.edit((p) => removeBus(p, bus.id), 'Remove bus');
              onClose();
            }}
          >
            <Trash2 />
            Remove
          </button>
        </div>
      )}
      {id === MASTER &&
        row('Mix level', mix.volume, (v, final) => doc.edit((p) => setMixVolume(p, v), 'Mix level', final ? undefined : 'mixvol'), -24, 12, 0.5, 'dB')}
      <Section title="EQ" actions={toggle('eq', 'EQ')}>
        <EqCurve e={eq?.on ? eq : undefined} />
        {row('Low (100 Hz)', fxNumber(eq, 'low', 0), set('eq', 'low'), -18, 18, 0.5, 'dB')}
        {row('Low-mid (400 Hz)', fxNumber(eq, 'lowMid', 0), set('eq', 'lowMid'), -18, 18, 0.5, 'dB')}
        {row('High-mid (2.5 kHz)', fxNumber(eq, 'highMid', 0), set('eq', 'highMid'), -18, 18, 0.5, 'dB')}
        {row('High (8 kHz)', fxNumber(eq, 'high', 0), set('eq', 'high'), -18, 18, 0.5, 'dB')}
        {row('Low cut', fxNumber(eq, 'lowCut', 0), set('eq', 'lowCut'), 0, 300, 5, 'Hz')}
      </Section>
      <Section title="Dynamics" actions={toggle('compressor', 'Dynamics')}>
        <CompCurve e={comp?.on ? comp : undefined} />
        {row('Threshold', fxNumber(comp, 'threshold', -20), set('compressor', 'threshold'), -60, 0, 0.5, 'dB')}
        {row('Ratio', fxNumber(comp, 'ratio', 4), set('compressor', 'ratio'), 1, 20, 0.1, ':1')}
        {row('Attack', fxNumber(comp, 'attack', 10), set('compressor', 'attack'), 1, 200, 1, 'ms')}
        {row('Release', fxNumber(comp, 'release', 150), set('compressor', 'release'), 10, 1000, 5, 'ms')}
        {row('Make-up', fxNumber(comp, 'makeup', 3), set('compressor', 'makeup'), 0, 24, 0.5, 'dB')}
      </Section>
      <Section title="Limiter" actions={toggle('limiter', 'Limiter')}>
        {row('Ceiling', fxNumber(lim, 'ceiling', -1), set('limiter', 'ceiling'), -12, 0, 0.1, 'dB')}
        <p className="insp__note">Nothing gets louder than the ceiling. On the whole mix, −1 dB keeps the film from distorting once it is compressed.</p>
      </Section>
    </aside>
  );
}

const CURVE_W = 260;
const CURVE_H = 90;

/** The EQ's response from 20 Hz to 20 kHz (±18 dB). */
export function eqPath(e: Effect | undefined, w = CURVE_W, h = CURVE_H): string {
  const pts: string[] = [];
  for (let i = 0; i <= 64; i++) {
    const f = 20 * 1000 ** (i / 64);
    const db = Math.max(-18, Math.min(18, eqResponse(e, f)));
    pts.push(`${((i / 64) * w).toFixed(1)},${(h / 2 - (db / 18) * (h / 2 - 4)).toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
}

function EqCurve({ e }: { e: Effect | undefined }) {
  return (
    <svg className="emix__curve" viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} role="img" aria-label="Equalizer curve">
      {[100, 1000, 10000].map((f) => {
        const x = (Math.log10(f / 20) / 3) * CURVE_W;
        return <line key={f} x1={x} x2={x} y1={0} y2={CURVE_H} className="emix__grid" />;
      })}
      <line x1={0} x2={CURVE_W} y1={CURVE_H / 2} y2={CURVE_H / 2} className="emix__grid" />
      <path d={eqPath(e)} className="emix__line" />
    </svg>
  );
}

/** Level in against level out (−60 … 0 dB). */
function CompCurve({ e }: { e: Effect | undefined }) {
  const size = CURVE_H;
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const inp = -60 + i;
    const out = inp - compressorGainReduction(e, inp);
    pts.push(`${((i / 60) * size).toFixed(1)},${(size - ((out + 60) / 60) * size).toFixed(1)}`);
  }
  return (
    <svg className="emix__curve emix__curve--sq" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Dynamics curve">
      <line x1={0} y1={size} x2={size} y2={0} className="emix__grid" />
      <path d={`M${pts.join('L')}`} className="emix__line" />
    </svg>
  );
}

function Meter({ engine, id, stereo }: { engine: Engine; id: string; stereo?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const shown = [-90, -90];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const h = cv.clientHeight;
      if (cv.height !== h) cv.height = h;
      const lv = engine.levels()[id] ?? [-90, -90];
      ctx.clearRect(0, 0, cv.width, h);
      const n = stereo ? 2 : 1;
      for (let i = 0; i < n; i++) {
        shown[i] = Math.max(lv[i] ?? -90, (shown[i] ?? -90) - 1.2);
        const top = h - (Math.max(0, (shown[i] ?? -90) + 60) / 66) * h;
        const x = i * 8;
        ctx.fillStyle = '#141414';
        ctx.fillRect(x, 0, 6, h);
        const y = (d: number) => h - (Math.max(0, d + 60) / 66) * h;
        for (const [lo, hi, col] of METER_ZONES) {
          const a = Math.max(top, y(hi));
          const b = y(lo);
          if (b > a) {
            ctx.fillStyle = col;
            ctx.fillRect(x, a, 6, b - a);
          }
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [engine, id, stereo]);
  return <canvas ref={ref} className="estrip__meter" width={stereo ? 14 : 6} />;
}
