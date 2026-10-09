import { X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Show } from '../engine/types/Show';
import type { Trigger } from '../engine/types/Trigger';
import type { When } from '../engine/types/When';
import type { ScreenId } from '../engine/types/ScreenId';
import { StepsEditor } from './PresetEditor';
import { soundSources } from '../engine/audio';
import type { Act } from './act';
import './TriggersDialog.css';

export const KINDS: { type: When['type']; name: string }[] = [
  { type: 'videoEnds', name: 'A video ends' },
  { type: 'videoTimeLeft', name: 'A video is about to end' },
  { type: 'onAir', name: 'An input goes on air' },
  { type: 'offAir', name: 'An input leaves the air' },
  { type: 'inputLost', name: 'An input loses its picture' },
  { type: 'inputBack', name: 'An input gets its picture back' },
  { type: 'sound', name: 'Sound gets loud or goes quiet' },
  { type: 'countdownZero', name: 'A countdown reaches zero' },
  { type: 'broadcast', name: 'Recording or the stream starts or stops' },
  { type: 'atTime', name: 'At a clock time (every day)' },
];

const PICTURE_KINDS = [
  'camera',
  'video',
  'image',
  'color',
  'pattern',
  'countdown',
  'text',
  'pesukim',
  'credits',
  'split',
  'slideshow',
  'visuals',
  'logo3d',
  'browser',
];
const LIVE_KINDS = ['camera', 'stream', 'screen', 'guest', 'browser'];

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** A plain-words line for a trigger. */
export function describeWhen(w: When, show: Show): string {
  const name = (id: string) => show.sources.find((s) => s.id === id)?.name ?? '(removed input)';
  const where = (sc: ScreenId | null) => (sc === 'live' ? ' on the Live Screen' : sc === 'back' ? ' on the Back Screen' : '');
  switch (w.type) {
    case 'videoEnds':
      return `When “${name(w.sourceId)}” ends`;
    case 'onAir':
      return `When “${name(w.sourceId)}” goes on air${where(w.screen)}`;
    case 'offAir':
      return `When “${name(w.sourceId)}” leaves the air${where(w.screen)}`;
    case 'countdownZero':
      return `When “${name(w.sourceId)}” reaches zero`;
    case 'atTime':
      return `Every day at ${hhmm(w.minute)}`;
    case 'videoTimeLeft':
      return `When “${name(w.sourceId)}” has ${w.seconds} s left`;
    case 'inputLost':
      return `When “${name(w.sourceId)}” loses its picture`;
    case 'inputBack':
      return `When “${name(w.sourceId)}” gets its picture back`;
    case 'sound':
      return `When “${name(w.sourceId)}” is ${w.above ? 'louder' : 'quieter'} than ${w.db} dB for ${(w.holdMs / 1000).toFixed(w.holdMs % 1000 ? 1 : 0)} s`;
    case 'broadcast':
      return `When ${w.what === 'record' ? 'recording' : 'the stream'} ${w.on ? 'starts' : 'stops'}`;
  }
}

/** Which inputs a kind of trigger can watch. */
function inputKinds(type: When['type']): string[] | 'sound' | null {
  switch (type) {
    case 'videoEnds':
    case 'videoTimeLeft':
      return ['video'];
    case 'countdownZero':
      return ['countdown'];
    case 'inputLost':
    case 'inputBack':
      return LIVE_KINDS;
    case 'sound':
      return 'sound';
    default:
      return null;
  }
}

export function freshWhen(type: When['type'], show: Show): When {
  const first = (kinds: string[]) => show.sources.find((s) => kinds.includes(s.kind.type))?.id ?? '';
  const offset = -new Date().getTimezoneOffset();
  switch (type) {
    case 'videoEnds':
      return { type, sourceId: first(['video']) };
    case 'onAir':
    case 'offAir':
      return { type, sourceId: first(PICTURE_KINDS), screen: null };
    case 'countdownZero':
      return { type, sourceId: first(['countdown']) };
    case 'atTime':
      return { type, minute: 19 * 60 + 30, utcOffsetMin: offset };
    case 'videoTimeLeft':
      return { type, sourceId: first(['video']), seconds: 5 };
    case 'inputLost':
    case 'inputBack':
      return { type, sourceId: first(LIVE_KINDS) };
    case 'sound':
      return {
        type,
        sourceId: soundSources(show).find((s) => s.kind.type === 'microphone')?.id ?? soundSources(show)[0]?.id ?? '',
        above: true,
        db: -30,
        holdMs: 500,
      };
    case 'broadcast':
      return { type, what: 'stream', on: true };
  }
}

/** Triggers: "when this happens, do that" — they run by themselves. */
export function TriggersDialog({ show, act, onClose }: { show: Show; act: Act; onClose: () => void }) {
  const [sel, setSel] = useState<string | null>(show.triggers[0]?.id ?? null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const list = show.triggers;
  const save = (next: Trigger[]) => act({ type: 'setTriggers', triggers: next });
  const t = list.find((x) => x.id === sel) ?? null;
  const change = (p: Partial<Trigger>) => t && save(list.map((x) => (x.id === t.id ? { ...x, ...p } : x)));
  const add = () => {
    const id = `trg-${Date.now().toString(36)}`;
    save([...list, { id, name: `Trigger ${list.length + 1}`, enabled: true, when: freshWhen('videoEnds', show), steps: [], lastFired: 0 }]);
    setSel(id);
  };
  const w = t?.when;
  const kinds = w ? inputKinds(w.type) : null;
  const choices = kinds === 'sound' ? soundSources(show) : show.sources.filter((s) => (kinds ? kinds.includes(s.kind.type) : s.kind.type !== 'microphone'));

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Triggers" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box trg">
        <header className="modal__head">
          <h2>
            <Zap className="modal__icon" aria-hidden="true" />
            Triggers
          </h2>
          <span className="field__note trg__why">When this happens, do that — by itself, while you run the show.</span>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="trg__body">
          <nav className="trg__list" aria-label="Triggers">
            {list.map((x) => (
              <div key={x.id} className={`trg__item${x.id === sel ? ' is-on' : ''}${x.enabled ? '' : ' is-off'}`}>
                <input
                  type="checkbox"
                  checked={x.enabled}
                  aria-label={`${x.name} on`}
                  onChange={(e) => save(list.map((y) => (y.id === x.id ? { ...y, enabled: e.target.checked } : y)))}
                />
                <button type="button" onClick={() => setSel(x.id)}>
                  <b>{x.name}</b>
                  <em>
                    {describeWhen(x.when, show)} → {x.steps.length} step{x.steps.length === 1 ? '' : 's'}
                  </em>
                </button>
              </div>
            ))}
            {list.length === 0 && <p className="field__note">No triggers yet. For example: when the opening video ends, cut to Camera 1.</p>}
            <button type="button" className="btn" onClick={add}>
              + Add a trigger
            </button>
          </nav>
          <section className="trg__edit">
            {t && w ? (
              <>
                <label className="field">
                  <span className="field__label">Name</span>
                  <input className="text" value={t.name} maxLength={80} onChange={(e) => change({ name: e.target.value })} aria-label="Trigger name" />
                </label>
                <label className="field">
                  <span className="field__label">When</span>
                  <select value={w.type} onChange={(e) => change({ when: freshWhen(e.target.value as When['type'], show) })} aria-label="When">
                    {KINDS.map((k) => (
                      <option key={k.type} value={k.type}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
                {'sourceId' in w && (
                  <label className="field">
                    <span className="field__label">
                      {w.type === 'videoEnds' || w.type === 'videoTimeLeft'
                        ? 'Which video'
                        : w.type === 'countdownZero'
                          ? 'Which countdown'
                          : w.type === 'sound'
                            ? 'Which sound'
                            : 'Which input'}
                    </span>
                    <select value={w.sourceId} onChange={(e) => change({ when: { ...w, sourceId: e.target.value } })} aria-label="Which input">
                      {!choices.some((s) => s.id === w.sourceId) && <option value={w.sourceId}>Choose…</option>}
                      {choices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(w.type === 'onAir' || w.type === 'offAir') && (
                  <label className="field">
                    <span className="field__label">On which screen</span>
                    <select
                      value={w.screen ?? ''}
                      onChange={(e) => change({ when: { ...w, screen: (e.target.value || null) as ScreenId | null } })}
                      aria-label="On which screen"
                    >
                      <option value="">Live or Back</option>
                      <option value="live">Live Screen</option>
                      <option value="back">Back Screen</option>
                    </select>
                  </label>
                )}
                {w.type === 'videoTimeLeft' && (
                  <label className="field">
                    <span className="field__label">Seconds before the end</span>
                    <input
                      className="text"
                      type="number"
                      min={1}
                      max={600}
                      value={w.seconds}
                      onChange={(e) => change({ when: { ...w, seconds: Math.round(Math.min(600, Math.max(1, Number(e.target.value) || 1))) } })}
                      aria-label="Seconds before the end"
                    />
                  </label>
                )}
                {w.type === 'sound' && (
                  <>
                    <label className="field">
                      <span className="field__label">When it is</span>
                      <select
                        value={w.above ? 'above' : 'below'}
                        onChange={(e) => change({ when: { ...w, above: e.target.value === 'above' } })}
                        aria-label="Louder or quieter"
                      >
                        <option value="above">louder than (someone starts talking)</option>
                        <option value="below">quieter than (it goes quiet)</option>
                      </select>
                    </label>
                    <label className="field">
                      <span className="field__label">Level: {w.db} dB</span>
                      <input
                        type="range"
                        min={-60}
                        max={0}
                        step={1}
                        value={w.db}
                        onChange={(e) => change({ when: { ...w, db: Number(e.target.value) } })}
                        aria-label="Level in dB"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">For at least (seconds)</span>
                      <input
                        className="text"
                        type="number"
                        min={0}
                        max={600}
                        step={0.5}
                        value={w.holdMs / 1000}
                        onChange={(e) => change({ when: { ...w, holdMs: Math.round(Math.min(600, Math.max(0, Number(e.target.value) || 0)) * 1000) } })}
                        aria-label="For at least, seconds"
                      />
                    </label>
                    <span className="field__note">
                      It goes off once, and again only after the sound has been the other way for 2 seconds. Speech is around −30 dB on the meters; a quiet room
                      is below −50 dB.
                    </span>
                  </>
                )}
                {w.type === 'broadcast' && (
                  <div className="field">
                    <span className="field__label">When</span>
                    <span className="trg__pair">
                      <select
                        value={w.what}
                        onChange={(e) => change({ when: { ...w, what: e.target.value === 'record' ? 'record' : 'stream' } })}
                        aria-label="Recording or stream"
                      >
                        <option value="stream">the stream</option>
                        <option value="record">recording</option>
                      </select>
                      <select
                        value={w.on ? 'on' : 'off'}
                        onChange={(e) => change({ when: { ...w, on: e.target.value === 'on' } })}
                        aria-label="Starts or stops"
                      >
                        <option value="on">starts</option>
                        <option value="off">stops</option>
                      </select>
                    </span>
                  </div>
                )}
                {(w.type === 'inputLost' || w.type === 'inputBack') && (
                  <span className="field__note">
                    Lumora already switches to the next camera in the backup lineup by itself when one on air goes out (Settings → Backup lineup…). Use this for
                    anything else: a message on the stage monitor, a different layout, a sound.
                  </span>
                )}
                {w.type === 'atTime' && (
                  <label className="field">
                    <span className="field__label">Time</span>
                    <input
                      className="text"
                      type="time"
                      value={hhmm(w.minute)}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        change({ when: { ...w, minute: (h ?? 0) * 60 + (m ?? 0), utcOffsetMin: -new Date().getTimezoneOffset() } });
                      }}
                      aria-label="Time"
                    />
                  </label>
                )}
                <span className="field__label">Then do</span>
                <StepsEditor show={show} screen="live" steps={t.steps} onChange={(steps) => change({ steps })} />
                <div className="trg__foot">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => act({ type: 'fireTrigger', id: t.id })}
                    disabled={!t.steps.length}
                    title="Run its steps now"
                  >
                    Try it now
                  </button>
                  <span className="remote__spacer" />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      save(list.filter((x) => x.id !== t.id));
                      setSel(null);
                    }}
                  >
                    Delete trigger
                  </button>
                </div>
              </>
            ) : (
              <p className="field__note">Choose a trigger, or add one.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
