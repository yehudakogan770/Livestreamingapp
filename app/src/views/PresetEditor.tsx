import { useEffect, useState } from 'react';
import { isSoundFile, type EngineClient } from '../engine/client';
import type { Preset } from '../engine/types/Preset';
import type { PresetButton } from '../engine/types/PresetButton';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { Step } from '../engine/types/Step';
import type { TransitionKind } from '../engine/types/TransitionKind';
import { SourceView } from '../components/SourceView';
import { KINDS, DURATIONS } from './SwitchPanel';
import type { Act } from './act';

/** Every kind of step, in the order the "Add step" menu shows them. */
export const STEP_KINDS: { type: Step['type']; name: string }[] = [
  { type: 'preview', name: 'Line up an input in Next' },
  { type: 'take', name: 'TAKE' },
  { type: 'cutTo', name: 'Put an input straight on air' },
  { type: 'wait', name: 'Wait' },
  { type: 'monitorMessage', name: 'Message on the stage monitor' },
  { type: 'clearMonitorMessage', name: 'Clear the monitor message' },
  { type: 'blank', name: 'Blank a screen' },
  { type: 'startCountdown', name: 'Start the countdown' },
  { type: 'pauseCountdown', name: 'Pause the countdown' },
  { type: 'resetCountdown', name: 'Reset the countdown' },
  { type: 'setCountdownLength', name: 'Set the countdown length' },
  { type: 'play', name: 'Play a video or sound' },
  { type: 'pause', name: 'Pause a video or sound' },
  { type: 'backFollowsLive', name: 'Back = Live on / off' },
  { type: 'preset', name: 'Pick another preset' },
  { type: 'overlay', name: 'Overlay on / off' },
];

const pictures = (show: Show) => show.sources.filter((s) => s.kind.type !== 'microphone' && !(s.kind.type === 'video' && isSoundFile(s.kind.path)));
const players = (show: Show) => show.sources.filter((s) => s.kind.type === 'video');

/** A new step of a kind, filled in with sensible first choices. */
export function newStep(type: Step['type'], show: Show, screen: ScreenId): Step {
  const pic = pictures(show)[0]?.id ?? '';
  const vid = players(show)[0]?.id ?? '';
  switch (type) {
    case 'preview':
      return { type, screen, sourceId: pic || null };
    case 'take':
      return { type, screen };
    case 'cutTo':
      return { type, screen, sourceId: pic };
    case 'wait':
      return { type, ms: 3000 };
    case 'monitorMessage':
      return { type, text: 'Stand by' };
    case 'blank':
      return { type, screens: [screen], value: true };
    case 'setCountdownLength':
      return { type, lengthMs: 5 * 60_000 };
    case 'play':
    case 'pause':
      return { type, sourceId: vid };
    case 'backFollowsLive':
      return { type, value: true };
    case 'preset':
      return { type, presetId: show.presets[0]?.id ?? '' };
    case 'overlay':
      return { type, channel: 0, value: true };
    case 'clearMonitorMessage':
    case 'startCountdown':
    case 'pauseCountdown':
    case 'resetCountdown':
      return { type };
  }
}

/** One line describing a step, for lists and buttons. */
export function describeStep(st: Step, show: Show): string {
  const name = (id: string | null) => show.sources.find((s) => s.id === id)?.name ?? '(removed input)';
  const scr = (s: ScreenId) => (s === 'live' ? 'Live' : s === 'back' ? 'Back' : 'Monitor');
  switch (st.type) {
    case 'preview':
      return `${scr(st.screen)}: ${name(st.sourceId)} in Next`;
    case 'take':
      return `${scr(st.screen)}: TAKE${st.transition ? ` (${st.transition})` : ''}`;
    case 'cutTo':
      return `${scr(st.screen)}: ${name(st.sourceId)} on air`;
    case 'wait':
      return `Wait ${(st.ms / 1000).toFixed(st.ms % 1000 ? 1 : 0)} s`;
    case 'monitorMessage':
      return `Monitor: “${st.text}”`;
    case 'blank':
      return `${st.value ? 'Blank' : 'Show'} ${st.screens.map(scr).join(' + ')}`;
    case 'setCountdownLength':
      return `Countdown ${Math.round(st.lengthMs / 60_000)} min`;
    case 'play':
      return `Play ${name(st.sourceId)}`;
    case 'pause':
      return `Pause ${name(st.sourceId)}`;
    case 'backFollowsLive':
      return `Back = Live ${st.value ? 'on' : 'off'}`;
    case 'preset':
      return `Preset: ${show.presets.find((p) => p.id === st.presetId)?.name ?? '(removed)'}`;
    case 'overlay':
      return `Overlay ${st.channel + 1} ${st.value ? 'on' : 'off'}`;
    default:
      return STEP_KINDS.find((k) => k.type === st.type)?.name ?? st.type;
  }
}

/** Create or edit a preset. Nothing changes until Done. */
export function PresetEditor({
  show,
  client,
  act,
  preset,
  onClose,
}: {
  show: Show;
  client: EngineClient;
  act: Act;
  preset: Preset | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Preset>(
    () =>
      preset ?? {
        id: '',
        name: '',
        category: '',
        screen: 'live',
        sources: [],
        transition: null,
        loadFirst: true,
        buttons: [],
      },
  );
  const set = (p: Partial<Preset>) => setDraft((d) => ({ ...d, ...p }));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const toggleSource = (id: string) => set({ sources: draft.sources.includes(id) ? draft.sources.filter((x) => x !== id) : [...draft.sources, id] });
  const setButton = (i: number, b: PresetButton) => set({ buttons: draft.buttons.map((x, j) => (j === i ? b : x)) });
  const done = () => {
    act(preset ? { type: 'updatePreset', preset: draft } : { type: 'addPreset', preset: draft });
    onClose();
  };
  const categories = [...new Set(show.presets.map((p) => p.category).filter(Boolean))];

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={preset ? 'Edit preset' : 'New preset'}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal__box pe">
        <header className="modal__head">
          <h2>{preset ? `Edit “${preset.name}”` : 'New preset'}</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="pe__body">
          <div className="pe__col">
            <div className="pe__row">
              <label className="field pe__grow">
                <span className="field__label">Name</span>
                <input
                  className="text"
                  autoFocus
                  value={draft.name}
                  maxLength={40}
                  placeholder="e.g. Speaker"
                  onChange={(e) => set({ name: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">Category</span>
                <input
                  className="text"
                  list="pe-cats"
                  value={draft.category}
                  maxLength={40}
                  placeholder="e.g. Speeches"
                  onChange={(e) => set({ category: e.target.value })}
                />
                <datalist id="pe-cats">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            </div>
            <div className="pe__row">
              <div className="field">
                <span className="field__label">Works on</span>
                <span className="segs">
                  {(['live', 'back'] as const).map((s) => (
                    <button key={s} type="button" className="seg" aria-pressed={draft.screen === s} onClick={() => set({ screen: s })}>
                      {s === 'live' ? 'Live Screen' : 'Back Screen'}
                    </button>
                  ))}
                </span>
              </div>
              <div className="field">
                <span className="field__label">Transition</span>
                <span className="pe__trans">
                  <select
                    aria-label="Transition"
                    value={draft.transition?.kind ?? ''}
                    onChange={(e) =>
                      set({ transition: e.target.value ? { kind: e.target.value as TransitionKind, durationMs: draft.transition?.durationMs ?? 800 } : null })
                    }
                  >
                    <option value="">Keep the current one</option>
                    {KINDS.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                  {draft.transition && draft.transition.kind !== 'cut' && (
                    <select
                      aria-label="Transition length"
                      value={draft.transition.durationMs}
                      onChange={(e) => set({ transition: { ...draft.transition!, durationMs: Number(e.target.value) } })}
                    >
                      {DURATIONS.map((d) => (
                        <option key={d} value={d}>
                          {d / 1000} s
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              </div>
            </div>
            <div className="field">
              <span className="field__label">Inputs in this preset · only these show on the main screen when it is picked</span>
              <div className="pe__inputs">
                {show.sources.length === 0 && <span className="field__note">Add inputs first, then pick them here.</span>}
                {show.sources.map((src) => {
                  const n = draft.sources.indexOf(src.id);
                  return (
                    <button
                      key={src.id}
                      type="button"
                      className={`pe__input${n >= 0 ? ' is-on' : ''}`}
                      aria-pressed={n >= 0}
                      onClick={() => toggleSource(src.id)}
                    >
                      <span className="pe__thumb">
                        <SourceView source={src} client={client} thumb />
                      </span>
                      <span className="pe__iname">
                        {n >= 0 && <b>{n + 1}</b>}
                        {src.name}
                      </span>
                    </button>
                  );
                })}
              </div>
              <label className="check">
                <input type="checkbox" checked={draft.loadFirst} onChange={(e) => set({ loadFirst: e.target.checked })} /> When picked, line up its first input
                in Next
              </label>
            </div>
          </div>
          <div className="pe__col">
            <div className="field">
              <span className="field__label">Preset buttons · one click runs several steps in order</span>
              {draft.buttons.map((b, i) => (
                <ButtonEditor
                  key={i}
                  show={show}
                  screen={draft.screen}
                  button={b}
                  onChange={(nb) => setButton(i, nb)}
                  onRemove={() => set({ buttons: draft.buttons.filter((_, j) => j !== i) })}
                />
              ))}
              <button
                type="button"
                className="btn"
                onClick={() => set({ buttons: [...draft.buttons, { name: `Button ${draft.buttons.length + 1}`, steps: [] }] })}
              >
                + Add button
              </button>
            </div>
          </div>
        </div>
        <footer className="modal__foot">
          {preset && (
            <button type="button" className="btn pe__delete" onClick={() => (act({ type: 'removePreset', id: preset.id }), onClose())}>
              Delete preset
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={done}>
            {preset ? 'Done' : 'Create preset'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** A list of steps: each with its choices, move up / down, remove, and add. */
export function StepsEditor({ show, screen, steps, onChange }: { show: Show; screen: ScreenId; steps: Step[]; onChange: (s: Step[]) => void }) {
  const move = (i: number, d: number) => {
    const next = [...steps];
    const [st] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, st!);
    onChange(next);
  };
  return (
    <>
      <ol className="pe__steps">
        {steps.map((st, i) => (
          <li key={i} className="pe__step">
            <StepFields show={show} step={st} onChange={(n) => onChange(steps.map((x, j) => (j === i ? n : x)))} />
            <span className="pe__stepbtns">
              <button type="button" className="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="icon" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="icon" aria-label="Remove step" onClick={() => onChange(steps.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>
      <select
        className="pe__add"
        aria-label="Add step"
        value=""
        onChange={(e) => e.target.value && onChange([...steps, newStep(e.target.value as Step['type'], show, screen)])}
      >
        <option value="">+ Add step…</option>
        {STEP_KINDS.map((k) => (
          <option key={k.type} value={k.type}>
            {k.name}
          </option>
        ))}
      </select>
    </>
  );
}

/** One button of a preset: its name and its steps. */
function ButtonEditor({
  show,
  screen,
  button,
  onChange,
  onRemove,
}: {
  show: Show;
  screen: ScreenId;
  button: PresetButton;
  onChange: (b: PresetButton) => void;
  onRemove: () => void;
}) {
  return (
    <div className="pe__button">
      <div className="pe__bhead">
        <input className="text" value={button.name} maxLength={40} aria-label="Button name" onChange={(e) => onChange({ ...button, name: e.target.value })} />
        <button type="button" className="linkbtn" onClick={onRemove}>
          Remove button
        </button>
      </div>
      <StepsEditor show={show} screen={screen} steps={button.steps} onChange={(steps) => onChange({ ...button, steps })} />
    </div>
  );
}

/** The choices a step needs, inline. */
function StepFields({ show, step, onChange }: { show: Show; step: Step; onChange: (s: Step) => void }) {
  const kindName = STEP_KINDS.find((k) => k.type === step.type)?.name ?? step.type;
  const screenSel = (value: ScreenId, set: (s: ScreenId) => void) => (
    <select aria-label="Screen" value={value} onChange={(e) => set(e.target.value as ScreenId)}>
      <option value="live">Live</option>
      <option value="back">Back</option>
    </select>
  );
  const sourceSel = (value: string | null, list: Source[], set: (id: string) => void) => (
    <select aria-label="Input" value={value ?? ''} onChange={(e) => set(e.target.value)}>
      {list.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
  let fields: React.ReactNode = null;
  switch (step.type) {
    case 'preview':
      fields = (
        <>
          {screenSel(step.screen, (screen) => onChange({ ...step, screen }))}
          {sourceSel(step.sourceId, pictures(show), (sourceId) => onChange({ ...step, sourceId }))}
        </>
      );
      break;
    case 'cutTo':
      fields = (
        <>
          {screenSel(step.screen, (screen) => onChange({ ...step, screen }))}
          {sourceSel(step.sourceId, pictures(show), (sourceId) => onChange({ ...step, sourceId }))}
        </>
      );
      break;
    case 'take':
      fields = (
        <>
          {screenSel(step.screen, (screen) => onChange({ ...step, screen }))}
          <select
            aria-label="Transition"
            value={step.transition ?? ''}
            onChange={(e) => onChange(e.target.value ? { ...step, transition: e.target.value as TransitionKind } : { type: 'take', screen: step.screen })}
          >
            <option value="">current transition</option>
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.name}
              </option>
            ))}
          </select>
        </>
      );
      break;
    case 'wait':
      fields = (
        <label className="pe__num">
          <input
            type="number"
            min={0.1}
            max={600}
            step={0.5}
            value={step.ms / 1000}
            aria-label="Seconds"
            onChange={(e) => onChange({ ...step, ms: Math.round(Math.max(0, Math.min(600, Number(e.target.value))) * 1000) })}
          />{' '}
          s
        </label>
      );
      break;
    case 'monitorMessage':
      fields = <input className="text" value={step.text} maxLength={200} aria-label="Message" onChange={(e) => onChange({ ...step, text: e.target.value })} />;
      break;
    case 'blank':
      fields = (
        <>
          {screenSel(step.screens[0] ?? 'live', (s) => onChange({ ...step, screens: [s] }))}
          <select aria-label="Blank or show" value={step.value ? 'on' : 'off'} onChange={(e) => onChange({ ...step, value: e.target.value === 'on' })}>
            <option value="on">black</option>
            <option value="off">show again</option>
          </select>
        </>
      );
      break;
    case 'setCountdownLength':
      fields = (
        <label className="pe__num">
          <input
            type="number"
            min={1}
            max={1440}
            value={Math.round(step.lengthMs / 60_000)}
            aria-label="Minutes"
            onChange={(e) => onChange({ ...step, lengthMs: Math.max(1, Math.min(1440, Number(e.target.value))) * 60_000 })}
          />{' '}
          min
        </label>
      );
      break;
    case 'play':
    case 'pause':
      fields = sourceSel(step.sourceId, players(show), (sourceId) => onChange({ ...step, sourceId }));
      break;
    case 'backFollowsLive':
      fields = (
        <select aria-label="On or off" value={step.value ? 'on' : 'off'} onChange={(e) => onChange({ ...step, value: e.target.value === 'on' })}>
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
      );
      break;
    case 'preset':
      fields = (
        <select aria-label="Preset" value={step.presetId} onChange={(e) => onChange({ ...step, presetId: e.target.value })}>
          {show.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      );
      break;
    case 'overlay':
      fields = (
        <>
          <select aria-label="Overlay" value={step.channel} onChange={(e) => onChange({ ...step, channel: Number(e.target.value) })}>
            {show.overlays.map((o, i) => (
              <option key={i} value={i}>
                {i + 1}: {show.sources.find((s) => s.id === o.sourceId)?.name ?? 'empty'}
              </option>
            ))}
          </select>
          <select aria-label="On or off" value={step.value ? 'on' : 'off'} onChange={(e) => onChange({ ...step, value: e.target.value === 'on' })}>
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </>
      );
      break;
    default:
      break;
  }
  return (
    <span className="pe__fields">
      <span className="pe__kind">{kindName}</span>
      {fields}
    </span>
  );
}
