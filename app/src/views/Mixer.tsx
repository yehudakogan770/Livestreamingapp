import { useEffect, useRef, useState } from 'react';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { SourceAudioPatch } from '../engine/types/SourceAudioPatch';
import { soundSources } from '../engine/audio';
import { Meter, useSound } from '../audio/SoundContext';
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
        <button type="button" className="chip" onClick={() => setOutputs(true)}>Speakers…</button>
      </div>
      <div className="mixer__strips">
        {sources.length === 0 && (
          <div className="mixer__empty">
            Videos and microphones get a channel here. Add a microphone with <strong>+ Add input</strong>.
          </div>
        )}
        {sources.map((src) => (
          <Strip key={src.id} src={src} show={show} act={act} problem={!!sound?.problems.has(src.id)} />
        ))}
        <div className="mixer__gap" />
        <MixStrip id="master" name="Stream" volume={show.masterVolume} muted={show.audio.masterMuted}
          onVolume={(v) => act({ type: 'setMasterVolume', value: v })} onMute={() => act({ type: 'setMasterMuted', value: !show.audio.masterMuted })} />
        <MixStrip id="a" name={show.audio.a.name || 'Mix A'} volume={show.audio.a.volume} muted={show.audio.a.muted} off={show.settings.audioOutputs.a === null}
          onVolume={(v) => act({ type: 'updateBus', bus: 'a', patch: { volume: v } })} onMute={() => act({ type: 'updateBus', bus: 'a', patch: { muted: !show.audio.a.muted } })} />
        <MixStrip id="b" name={show.audio.b.name || 'Mix B'} volume={show.audio.b.volume} muted={show.audio.b.muted} off={show.settings.audioOutputs.b === null}
          onVolume={(v) => act({ type: 'updateBus', bus: 'b', patch: { volume: v } })} onMute={() => act({ type: 'updateBus', bus: 'b', patch: { muted: !show.audio.b.muted } })} />
      </div>
      {outputs && <SoundOutputsDialog show={show} act={act} onClose={() => setOutputs(false)} />}
    </div>
  );
}

function Fader({ value, label, onChange }: { value: number; label: string; onChange: (v: number) => void }) {
  // Sends at most one change per frame while dragging.
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  const [local, setLocal] = useState<number | null>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <input
      className="fader"
      type="range"
      min={0}
      max={1000}
      value={Math.round((local ?? value) * 1000)}
      aria-label={label}
      title="Double-click: back to 0 dB"
      onChange={(e) => {
        const v = Number(e.target.value) / 1000;
        setLocal(v);
        pending.current = v;
        if (!frame.current)
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            if (pending.current !== null) onChange(pending.current);
          });
      }}
      onPointerUp={() => setLocal(null)}
      onBlur={() => setLocal(null)}
      onDoubleClick={() => onChange(1)}
    />
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
        {src.kind.type === 'microphone' ? '🎤 ' : ''}
        {src.name}
      </button>
      <div className="strip__body">
        <Meter id={src.id} />
        <Fader value={src.volume} label={`${src.name} level`} onChange={(v) => act({ type: 'updateSource', id: src.id, patch: { volume: v } })} />
      </div>
      <span className="strip__db">{problem ? 'no signal' : faderDb(src.volume)}</span>
      <div className="strip__btns">
        <button type="button" className={`sbtn sbtn--mute${src.muted ? ' is-on' : ''}`} aria-pressed={src.muted} title="Mute" onClick={() => act({ type: 'updateSource', id: src.id, patch: { muted: !src.muted } })}>M</button>
        <button type="button" className={`sbtn sbtn--solo${soloed ? ' is-on' : ''}`} aria-pressed={soloed} title="Solo: hear it alone in the headphones" onClick={() => act({ type: 'setSolo', sourceId: soloed ? null : src.id })}>S</button>
        <button type="button" className={`sbtn${a.follow ? ' is-on' : ''}`} aria-pressed={a.follow} title="Auto: sound follows the picture (on air only)" onClick={() => setAudio({ follow: !a.follow })}>A</button>
      </div>
      <div className="strip__sends" aria-label="Goes to">
        <button type="button" className={`send${a.toMaster ? ' is-on' : ''}`} aria-pressed={a.toMaster} title="Goes to the Stream mix" onClick={() => setAudio({ toMaster: !a.toMaster })}>St</button>
        <button type="button" className={`send${a.toA ? ' is-on' : ''}`} aria-pressed={a.toA} title={`Goes to ${show.audio.a.name}`} onClick={() => setAudio({ toA: !a.toA })}>{show.audio.a.name.slice(0, 2) || 'A'}</button>
        <button type="button" className={`send${a.toB ? ' is-on' : ''}`} aria-pressed={a.toB} title={`Goes to ${show.audio.b.name}`} onClick={() => setAudio({ toB: !a.toB })}>{show.audio.b.name.slice(0, 2) || 'B'}</button>
      </div>
      {menu && (
        <div className="menu strip__menu" role="dialog" aria-label={`${src.name} sound`}>
          <label className="menu__row">
            Sound delay
            <input type="range" min={0} max={1000} step={10} value={a.delayMs} onChange={(e) => setAudio({ delayMs: Number(e.target.value) })} />
          </label>
          <span className="menu__hint">{a.delayMs} ms — lines the sound up with a camera that is late.</span>
          <label className="menu__row menu__row--check">
            <input type="checkbox" checked={a.follow} onChange={(e) => setAudio({ follow: e.target.checked })} /> Only heard when on air (audio follows video)
          </label>
          <button type="button" className="btn" onClick={() => setMenu(false)}>Done</button>
        </div>
      )}
    </div>
  );
}

function MixStrip({ id, name, volume, muted, off = false, onVolume, onMute }: {
  id: 'master' | 'a' | 'b'; name: string; volume: number; muted: boolean; off?: boolean; onVolume: (v: number) => void; onMute: () => void;
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
        <button type="button" className={`sbtn sbtn--mute${muted ? ' is-on' : ''}`} aria-pressed={muted} title="Mute this mix" onClick={onMute}>M</button>
      </div>
    </div>
  );
}
