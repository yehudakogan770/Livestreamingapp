import { useState } from 'react';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { AudioFilters } from '../engine/types/AudioFilters';
import type { SourceAudioPatch } from '../engine/types/SourceAudioPatch';
import { defaultFilters, soundSources } from '../engine/audio';
import { Meter, useSound } from '../audio/SoundContext';
import { Fader } from '../components/Fader';
import { SoundOutputsDialog } from './SoundOutputsDialog';
import type { Act } from './act';

/** Fader value (0–1) as dB on the fader's curve. */
function faderDb(v: number): string {
  if (v <= 0.001) return '−∞';
  const db = 40 * Math.log10(v);
  return db > -0.05 ? '0' : db.toFixed(1).replace('-', '−');
}

/** The audio mixer: a strip per input with sound, then the Stream, Hall and Recording mixes. */
export function Mixer({ show, act }: { show: Show; act: Act }) {
  const [outputs, setOutputs] = useState(false);
  const sound = useSound();
  const sources = soundSources(show);
  return (
    <div className="mixer" aria-label="Audio mixer">
      <div className="mixer__head">
        <span className="mixer__title">Audio mixer</span>
        {!sound && <span className="mixer__note">sound starts inside Lumora</span>}
        <span className="grow" />
        <button type="button" className="chip" onClick={() => setOutputs(true)}>
          Speakers…
        </button>
      </div>
      <div className="mixer__strips">
        {sources.length === 0 && <div className="mixer__empty">No channels yet — videos and microphones appear here.</div>}
        {sources.map((src) => (
          <Strip key={src.id} src={src} show={show} act={act} problem={!!sound?.problems.has(src.id)} />
        ))}
        <div className="mixer__gap" />
        <MixStrip
          id="master"
          name="Stream"
          volume={show.masterVolume}
          muted={show.audio.masterMuted}
          onVolume={(v) => act({ type: 'setMasterVolume', value: v })}
          onMute={() => act({ type: 'setMasterMuted', value: !show.audio.masterMuted })}
        />
        <MixStrip
          id="a"
          name={show.audio.a.name || 'Mix A'}
          volume={show.audio.a.volume}
          muted={show.audio.a.muted}
          off={show.settings.audioOutputs.a === null}
          onVolume={(v) => act({ type: 'updateBus', bus: 'a', patch: { volume: v } })}
          onMute={() => act({ type: 'updateBus', bus: 'a', patch: { muted: !show.audio.a.muted } })}
        />
        <MixStrip
          id="b"
          name={show.audio.b.name || 'Mix B'}
          volume={show.audio.b.volume}
          muted={show.audio.b.muted}
          off={show.settings.audioOutputs.b === null}
          onVolume={(v) => act({ type: 'updateBus', bus: 'b', patch: { volume: v } })}
          onMute={() => act({ type: 'updateBus', bus: 'b', patch: { muted: !show.audio.b.muted } })}
        />
      </div>
      {outputs && <SoundOutputsDialog show={show} act={act} onClose={() => setOutputs(false)} />}
    </div>
  );
}

function Strip({ src, show, act, problem }: { src: Source; show: Show; act: Act; problem: boolean }) {
  const [menu, setMenu] = useState(false);
  const a = src.audio;
  const setAudio = (p: SourceAudioPatch) => act({ type: 'updateSource', id: src.id, patch: { audio: p } });
  const onAir = show.screens.live.program === src.id;
  const soloed = show.audio.solo === src.id;
  return (
    <div className={`strip${onAir && a.follow ? ' strip--air' : ''}${problem ? ' strip--problem' : ''}`}>
      <button type="button" className="strip__name" title={`${src.name} · settings`} onClick={() => setMenu(!menu)}>
        {src.name}
      </button>
      <div className="strip__body">
        <Meter id={src.id} />
        <Fader value={src.volume} label={`${src.name} level`} onChange={(v) => act({ type: 'updateSource', id: src.id, patch: { volume: v } })} />
      </div>
      <span className="strip__db">{problem ? 'no signal' : faderDb(src.volume)}</span>
      <div className="strip__btns">
        <button
          type="button"
          className={`sbtn sbtn--mute${src.muted ? ' is-on' : ''}`}
          aria-pressed={src.muted}
          title="Mute"
          onClick={() => act({ type: 'updateSource', id: src.id, patch: { muted: !src.muted } })}
        >
          M
        </button>
        <button
          type="button"
          className={`sbtn sbtn--solo${soloed ? ' is-on' : ''}`}
          aria-pressed={soloed}
          title="Solo: hear it alone in the headphones"
          onClick={() => act({ type: 'setSolo', sourceId: soloed ? null : src.id })}
        >
          S
        </button>
        <button
          type="button"
          className={`sbtn${a.follow ? ' is-on' : ''}`}
          aria-pressed={a.follow}
          title="Auto: sound follows the picture (on air only)"
          onClick={() => setAudio({ follow: !a.follow })}
        >
          A
        </button>
      </div>
      <div className="strip__sends" aria-label="Goes to">
        <button
          type="button"
          className={`send${a.toMaster ? ' is-on' : ''}`}
          aria-pressed={a.toMaster}
          title="Goes to the Stream mix"
          onClick={() => setAudio({ toMaster: !a.toMaster })}
        >
          St
        </button>
        <button
          type="button"
          className={`send${a.toA ? ' is-on' : ''}`}
          aria-pressed={a.toA}
          title={`Goes to ${show.audio.a.name}`}
          onClick={() => setAudio({ toA: !a.toA })}
        >
          {show.audio.a.name.slice(0, 2) || 'A'}
        </button>
        <button
          type="button"
          className={`send${a.toB ? ' is-on' : ''}`}
          aria-pressed={a.toB}
          title={`Goes to ${show.audio.b.name}`}
          onClick={() => setAudio({ toB: !a.toB })}
        >
          {show.audio.b.name.slice(0, 2) || 'B'}
        </button>
      </div>
      {menu && <StripMenu src={src} onDone={(p) => (Object.keys(p).length && setAudio(p), setMenu(false))} onCancel={() => setMenu(false)} />}
    </div>
  );
}

/** A channel's sound settings; applied on Done. */
function StripMenu({ src, onDone, onCancel }: { src: Source; onDone: (p: SourceAudioPatch) => void; onCancel: () => void }) {
  const [delay, setDelay] = useState(src.audio.delayMs);
  const [follow, setFollow] = useState(src.audio.follow);
  const start = src.audio.filters ?? defaultFilters();
  const [f, setF] = useState<AudioFilters>(start);
  const ff = (p: Partial<AudioFilters>) => setF((x) => ({ ...x, ...p }));
  const patch: SourceAudioPatch = {};
  if (delay !== src.audio.delayMs) patch.delayMs = delay;
  if (follow !== src.audio.follow) patch.follow = follow;
  if (JSON.stringify(f) !== JSON.stringify(start)) patch.filters = f;
  const eq = (label: string, key: 'bassDb' | 'midDb' | 'trebleDb') => (
    <label className="menu__row">
      {label} {f[key] > 0 ? `+${f[key]}` : f[key]} dB
      <input
        type="range"
        min={-12}
        max={12}
        step={1}
        value={f[key]}
        onChange={(e) => ff({ [key]: Number(e.target.value) })}
        onDoubleClick={() => ff({ [key]: 0 })}
      />
    </label>
  );
  return (
    <div className="menu strip__menu" role="dialog" aria-label={`${src.name} sound`}>
      <label className="menu__row">
        Sound delay
        <input type="range" min={0} max={1000} step={10} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
      </label>
      <span className="menu__hint">{delay} ms — lines the sound up with a camera that is late.</span>
      <label className="menu__row menu__row--check">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Only heard when on air (audio follows video)
      </label>
      {src.kind.type !== 'microphone' && (
        <>
          <label className="menu__row menu__row--check">
            <input type="checkbox" checked={f.duck} onChange={(e) => ff({ duck: e.target.checked })} /> Quieter while someone talks (music under speeches)
          </label>
          {f.duck && (
            <label className="menu__row">
              How much quieter
              <input type="range" min={-40} max={-3} step={1} value={f.duckDb} onChange={(e) => ff({ duckDb: Number(e.target.value) })} />
              <em>{f.duckDb} dB</em>
            </label>
          )}
        </>
      )}
      <span className="menu__hint strip__section">Filters</span>
      {src.kind.type === 'microphone' && (
        <label className="menu__row menu__row--check">
          <input type="checkbox" checked={f.noiseSuppression} onChange={(e) => ff({ noiseSuppression: e.target.checked })} /> Remove background noise (hiss,
          hum, fans)
        </label>
      )}
      <label className="menu__row menu__row--check">
        <input type="checkbox" checked={f.lowCut} onChange={(e) => ff({ lowCut: e.target.checked })} /> Low cut (rumble, stage thumps)
      </label>
      {eq('Bass', 'bassDb')}
      {eq('Middle', 'midDb')}
      {eq('Treble', 'trebleDb')}
      <label className="menu__row menu__row--check">
        <input type="checkbox" checked={f.gate} onChange={(e) => ff({ gate: e.target.checked })} /> Noise gate: silent below {f.gateDb} dB
      </label>
      {f.gate && (
        <label className="menu__row">
          Gate level
          <input type="range" min={-80} max={-10} step={1} value={f.gateDb} onChange={(e) => ff({ gateDb: Number(e.target.value) })} />
        </label>
      )}
      <label className="menu__row menu__row--check">
        <input type="checkbox" checked={f.compressor} onChange={(e) => ff({ compressor: e.target.checked })} /> Compressor (steady voice level)
      </label>
      <span className="menu__hint">Every mix also has a limiter, so the sound never distorts.</span>
      <div className="menu__foot">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={() => onDone(patch)}>
          Done
        </button>
      </div>
    </div>
  );
}

function MixStrip({
  id,
  name,
  volume,
  muted,
  off = false,
  onVolume,
  onMute,
}: {
  id: 'master' | 'a' | 'b';
  name: string;
  volume: number;
  muted: boolean;
  off?: boolean;
  onVolume: (v: number) => void;
  onMute: () => void;
}) {
  return (
    <div className={`strip strip--mix${off ? ' strip--off' : ''}`} title={off ? 'Not played anywhere yet: choose speakers for it' : undefined}>
      <span className="strip__name strip__name--mix">{name}</span>
      <div className="strip__body">
        <Meter id={`mix:${id}`} />
        <Fader value={volume} label={`${name} level`} onChange={onVolume} />
      </div>
      <span className="strip__db">{off ? 'off' : faderDb(volume)}</span>
      <div className="strip__btns">
        <button type="button" className={`sbtn sbtn--mute${muted ? ' is-on' : ''}`} aria-pressed={muted} title="Mute this mix" onClick={onMute}>
          M
        </button>
      </div>
    </div>
  );
}
