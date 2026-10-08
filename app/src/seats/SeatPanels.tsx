// The seat window's panels: graphics, the mixer and cameras. Every control
// is shown to every seat; the ones outside its role are greyed out.

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Home,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { SeatGate, useSeat } from './seatContext';

function kindOf(s: Source): string {
  return s.kind.type;
}

function clock(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Re-render every half second (for running clocks). */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => set((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [on]);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="seat-sec" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function GraphicsPanel({ show }: { show: Show }) {
  const { act } = useSeat();
  const sources = show.sources;
  const by = (t: string) => sources.filter((s) => kindOf(s) === t);
  const name = (id: string | null) => sources.find((s) => s.id === id)?.name ?? 'empty';
  const countdowns = by('countdown');
  useTick(countdowns.some((c) => c.kind.type === 'countdown' && c.kind.timer.endsAt !== null));
  const texts = sources.filter((s) => s.kind.type === 'text');
  return (
    <div className="seat-panel" data-testid="graphics-panel">
      <Section title="Overlays">
        <SeatGate group="overlays" className="seat-grid">
          {show.overlays.map((o, ch) => (
            <div key={ch} className="seat-item">
              <span className="seat-item__name">
                {ch + 1}. {name(o.sourceId)}
              </span>
              <button
                type="button"
                className={`btn${o.on ? ' is-on' : ''}`}
                aria-pressed={o.on}
                disabled={!o.sourceId}
                onClick={() => act({ type: 'setOverlayOn', channel: ch, value: !o.on })}
              >
                {o.on ? 'Take off' : 'Put on'}
              </button>
            </div>
          ))}
          <button type="button" className="btn" disabled={!show.overlays.some((o) => o.on)} onClick={() => act({ type: 'overlaysOff' })}>
            Every overlay off
          </button>
        </SeatGate>
      </Section>
      {texts.length > 0 && (
        <Section title="Titles and lower thirds">
          <SeatGate group="titles" className="seat-list">
            {texts.map((s) => (
              <TitleEditor key={s.id} source={s} />
            ))}
          </SeatGate>
        </Section>
      )}
      {countdowns.length > 0 && (
        <Section title="Countdowns">
          <SeatGate group="countdowns" className="seat-list">
            {countdowns.map((s) => {
              if (s.kind.type !== 'countdown') return null;
              const t = s.kind.timer;
              const running = t.endsAt !== null;
              const left = running ? (t.endsAt ?? 0) - Date.now() : t.remainingMs;
              return (
                <div key={s.id} className="seat-item">
                  <span className="seat-item__name">{s.name}</span>
                  <span className="seat-item__time">{clock(left)}</span>
                  <button
                    type="button"
                    className="btn"
                    aria-label={running ? 'Pause' : 'Start'}
                    onClick={() => act({ type: running ? 'pauseCountdown' : 'startCountdown', id: s.id })}
                  >
                    {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  </button>
                  <button type="button" className="btn" aria-label="Back to the start" onClick={() => act({ type: 'resetCountdown', id: s.id })}>
                    <RotateCcw aria-hidden="true" />
                  </button>
                  <button type="button" className="btn" onClick={() => act({ type: 'addCountdownTime', id: s.id, ms: -60000 })}>
                    −1 min
                  </button>
                  <button type="button" className="btn" onClick={() => act({ type: 'addCountdownTime', id: s.id, ms: 60000 })}>
                    +1 min
                  </button>
                </div>
              );
            })}
          </SeatGate>
        </Section>
      )}
      {by('scoreboard').length > 0 && (
        <Section title="Scoreboards">
          <SeatGate group="scoreboards" className="seat-list">
            {by('scoreboard').map((s) =>
              s.kind.type !== 'scoreboard' ? null : (
                <div key={s.id} className="seat-item seat-item--score">
                  <span className="seat-item__name">{s.name}</span>
                  {(['home', 'away'] as const).map((side) => {
                    const team = s.kind.type === 'scoreboard' ? s.kind[side] : null;
                    return (
                      <span key={side} className="seat-score">
                        <span className="seat-score__team">{team?.short || team?.name || side}</span>
                        <button
                          type="button"
                          className="btn"
                          aria-label={`${team?.name ?? side} minus one`}
                          onClick={() => act({ type: 'score', id: s.id, side, delta: -1 })}
                        >
                          <Minus aria-hidden="true" />
                        </button>
                        <span className="seat-score__n">{team?.score ?? 0}</span>
                        <button
                          type="button"
                          className="btn"
                          aria-label={`${team?.name ?? side} plus one`}
                          onClick={() => act({ type: 'score', id: s.id, side, delta: 1 })}
                        >
                          <Plus aria-hidden="true" />
                        </button>
                      </span>
                    );
                  })}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => act({ type: 'scoreClock', id: s.id, run: s.kind.type === 'scoreboard' && s.kind.clock.since === null })}
                  >
                    {s.kind.clock.since === null ? 'Start clock' : 'Stop clock'}
                  </button>
                </div>
              ),
            )}
          </SeatGate>
        </Section>
      )}
      {by('lyrics').length > 0 && (
        <Section title="Song lyrics">
          <SeatGate group="lyrics" className="seat-list">
            {by('lyrics').map((s) =>
              s.kind.type !== 'lyrics' ? null : (
                <Stepper
                  key={s.id}
                  name={s.name}
                  at={`Slide ${s.kind.current + 1}`}
                  onBack={() => act({ type: 'lyricsPrevious', id: s.id })}
                  onNext={() => act({ type: 'lyricsNext', id: s.id })}
                  blank={s.kind.blank}
                  onBlank={(v) => act({ type: 'lyricsBlank', id: s.id, value: v })}
                />
              ),
            )}
          </SeatGate>
        </Section>
      )}
      {by('slideshow').length > 0 && (
        <Section title="Slideshows">
          <SeatGate group="slides" className="seat-list">
            {by('slideshow').map((s) =>
              s.kind.type !== 'slideshow' ? null : (
                <Stepper
                  key={s.id}
                  name={s.name}
                  at={`Slide ${s.kind.current + 1} of ${s.kind.slides.length}`}
                  onBack={() => act({ type: 'slidePrevious', id: s.id })}
                  onNext={() => act({ type: 'slideNext', id: s.id })}
                  blank={s.kind.black}
                  onBlank={(v) => act({ type: 'slideBlack', id: s.id, value: v })}
                />
              ),
            )}
          </SeatGate>
        </Section>
      )}
      {show.data && show.data.rows.length > 0 && (
        <Section title="Data titles">
          <SeatGate group="data" className="seat-list">
            <Stepper
              name="Row"
              at={`${show.data.row + 1} of ${show.data.rows.length}`}
              onBack={() => act({ type: 'dataStep', delta: -1 })}
              onNext={() => act({ type: 'dataStep', delta: 1 })}
            />
          </SeatGate>
        </Section>
      )}
    </div>
  );
}

function Stepper({
  name,
  at,
  onBack,
  onNext,
  blank,
  onBlank,
}: {
  name: string;
  at: string;
  onBack: () => void;
  onNext: () => void;
  blank?: boolean;
  onBlank?: (v: boolean) => void;
}) {
  return (
    <div className="seat-item">
      <span className="seat-item__name">{name}</span>
      <span className="seat-item__time">{at}</span>
      <button type="button" className="btn" aria-label={`${name}: back`} onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <button type="button" className="btn" aria-label={`${name}: next`} onClick={onNext}>
        <ChevronRight aria-hidden="true" />
      </button>
      {onBlank && (
        <button type="button" className={`btn${blank ? ' is-on' : ''}`} aria-pressed={!!blank} onClick={() => onBlank(!blank)}>
          {blank ? 'Show again' : 'Blank'}
        </button>
      )}
    </div>
  );
}

/** A title's two lines, changed in place (the look stays). */
function TitleEditor({ source }: { source: Source }) {
  const { act } = useSeat();
  const k = source.kind.type === 'text' ? source.kind : null;
  const [text, setText] = useState(k?.text ?? '');
  const [sub, setSub] = useState(k?.sub ?? '');
  // Follow changes made elsewhere while not being edited here.
  useEffect(() => setText(k?.text ?? ''), [k?.text]);
  useEffect(() => setSub(k?.sub ?? ''), [k?.sub]);
  if (!k) return null;
  const changed = text !== k.text || sub !== k.sub;
  return (
    <div className="seat-item seat-item--title">
      <span className="seat-item__name">{source.name}</span>
      <input type="text" aria-label={`${source.name}: words`} value={text} onChange={(e) => setText(e.target.value)} />
      <input type="text" aria-label={`${source.name}: second line`} value={sub} onChange={(e) => setSub(e.target.value)} />
      <button
        type="button"
        className="btn btn--primary"
        disabled={!changed}
        onClick={() => act({ type: 'updateText', id: source.id, text: { layout: k.layout, style: k.style, text, sub } })}
      >
        Change
      </button>
    </div>
  );
}

function Level({ level }: { level: number }) {
  const db = level <= 0.001 ? -60 : Math.max(-60, 20 * Math.log10(level));
  const pos = (db + 60) / 60;
  return (
    <div className="seat-meter" aria-hidden="true">
      <div className="seat-meter__bar" style={{ height: `${pos * 100}%` }} />
    </div>
  );
}

function Strip({
  name,
  volume,
  muted,
  level,
  onVolume,
  onMute,
}: {
  name: string;
  volume: number;
  muted: boolean;
  level: number;
  onVolume: (v: number) => void;
  onMute: () => void;
}) {
  return (
    <div className="seat-strip">
      <Level level={level} />
      <input
        type="range"
        className="seat-strip__fader"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        aria-label={`${name} volume`}
        onChange={(e) => onVolume(Number(e.target.value))}
      />
      <button
        type="button"
        className={`btn${muted ? ' is-on' : ''}`}
        aria-pressed={muted}
        aria-label={muted ? `Unmute ${name}` : `Mute ${name}`}
        onClick={onMute}
      >
        {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </button>
      <span className="seat-strip__name" title={name}>
        {name}
      </span>
    </div>
  );
}

const HAS_SOUND = new Set(['camera', 'video', 'microphone', 'stream', 'browser', 'guest', 'screen']);

export function AudioPanel({ show, meters }: { show: Show; meters: Record<string, number> }) {
  const { act } = useSeat();
  const strips = show.sources.filter((s) => HAS_SOUND.has(kindOf(s)));
  return (
    <div className="seat-panel" data-testid="audio-panel">
      <SeatGate group="audio" className="seat-mixer">
        {strips.map((s) => (
          <Strip
            key={s.id}
            name={s.name}
            volume={s.volume}
            muted={s.muted}
            level={meters[s.id] ?? 0}
            onVolume={(v) => act({ type: 'updateSource', id: s.id, patch: { volume: v } })}
            onMute={() => act({ type: 'updateSource', id: s.id, patch: { muted: !s.muted } })}
          />
        ))}
        <Strip
          name="Master"
          volume={show.masterVolume}
          muted={show.audio.masterMuted}
          level={meters['mix:master'] ?? 0}
          onVolume={(v) => act({ type: 'setMasterVolume', value: v })}
          onMute={() => act({ type: 'setMasterMuted', value: !show.audio.masterMuted })}
        />
      </SeatGate>
      {strips.length === 0 && <p className="field__note">No inputs with sound in this show.</p>}
    </div>
  );
}

export function CamerasPanel({ show }: { show: Show }) {
  const { ptz } = useSeat();
  const cams = show.sources.filter((s) => s.ptz);
  if (!cams.length) return <p className="field__note">No PTZ cameras are set up in this show (on the show computer: a camera’s ⋯ menu → PTZ control).</p>;
  return (
    <div className="seat-panel" data-testid="cameras-panel">
      <SeatGate group="cameras" className="seat-list">
        {cams.map((c) => {
          const hold = (pan: number, tilt: number) => ({
            onPointerDown: () => ptz(c.id, { type: 'move', pan, tilt, speed: 0.5 }),
            onPointerUp: () => ptz(c.id, { type: 'stop' }),
            onPointerLeave: (e: React.PointerEvent) => e.buttons && ptz(c.id, { type: 'stop' }),
          });
          const zoom = (dir: -1 | 1) => ({
            onPointerDown: () => ptz(c.id, { type: 'zoom', dir, speed: 0.5 }),
            onPointerUp: () => ptz(c.id, { type: 'zoom', dir: 0, speed: 0 }),
          });
          return (
            <div key={c.id} className="seat-item seat-item--ptz">
              <span className="seat-item__name">{c.name}</span>
              <span className="seat-pad">
                <button type="button" className="btn" aria-label={`${c.name}: up`} {...hold(0, 1)}>
                  <ArrowUp aria-hidden="true" />
                </button>
                <button type="button" className="btn" aria-label={`${c.name}: left`} {...hold(-1, 0)}>
                  <ArrowLeft aria-hidden="true" />
                </button>
                <button type="button" className="btn" aria-label={`${c.name}: home`} onClick={() => ptz(c.id, { type: 'home' })}>
                  <Home aria-hidden="true" />
                </button>
                <button type="button" className="btn" aria-label={`${c.name}: right`} {...hold(1, 0)}>
                  <ArrowRight aria-hidden="true" />
                </button>
                <button type="button" className="btn" aria-label={`${c.name}: down`} {...hold(0, -1)}>
                  <ArrowDown aria-hidden="true" />
                </button>
              </span>
              <button type="button" className="btn" aria-label={`${c.name}: zoom out`} {...zoom(-1)}>
                <ZoomOut aria-hidden="true" />
              </button>
              <button type="button" className="btn" aria-label={`${c.name}: zoom in`} {...zoom(1)}>
                <ZoomIn aria-hidden="true" />
              </button>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="btn seat-preset"
                  title={`Go to preset ${n}`}
                  onClick={() => ptz(c.id, { type: 'recall', preset: n - 1 })}
                >
                  {n}
                </button>
              ))}
            </div>
          );
        })}
      </SeatGate>
    </div>
  );
}
