// The operator's control panel, made from a template's fields: a box for
// each text, steppers for numbers (scores), swatches for colors, choices
// where the designer listed them. Used in the designer's preview, in
// Lumora's Titler card while live, and in Studio's title clip.

import { useEffect, useState } from 'react';
import { parseClock, timerCommand, timerRunning, timerText } from '../core/timer';
import type { TitleProject, Values, Variable } from '../core/types';
import './controlPanel.css';

export interface ControlPanelProps {
  project: TitleProject;
  values: Values;
  onChange: (key: string, value: string) => void;
  /** Fields filled from elsewhere (Lumora's scoreboard, data file…): shown, not edited. */
  bound?: Record<string, string>;
  /** Fields the title's own data fills (shown with a mark; typing over one wins). */
  fromData?: Record<string, string>;
  /** Fields the operator typed over (with `fromData`: offered back to the data). */
  typed?: string[];
  /** Give a typed-over field back to the data. */
  onUseData?: (key: string) => void;
  /** Choose a picture for an image field (the host's file picker). */
  pickImage?: (key: string) => void;
  className?: string;
}

const groupsOf = (vars: Variable[]) => {
  const out = new Map<string, Variable[]>();
  for (const v of vars) {
    const g = v.group ?? '';
    out.set(g, [...(out.get(g) ?? []), v]);
  }
  return [...out.entries()];
};

export function ControlPanel({ project, values, onChange, bound = {}, fromData = {}, typed = [], onUseData, pickImage, className }: ControlPanelProps) {
  if (!project.variables.length) return <div className={`tt-cp ${className ?? ''}`}>This graphic has no fields to fill in.</div>;
  return (
    <div className={`tt-cp ${className ?? ''}`} data-testid="titler-control-panel">
      {groupsOf(project.variables).map(([g, vars]) => (
        <fieldset key={g || '-'} className="tt-cp-group">
          {g && <legend>{g}</legend>}
          {vars.map((v) => (
            <Field
              key={v.key}
              v={v}
              value={values[v.key] ?? v.value}
              onChange={(x) => onChange(v.key, x)}
              bound={bound[v.key]}
              pickImage={pickImage}
              data={fromData[v.key] === undefined ? undefined : typed.includes(v.key) ? 'typed' : 'data'}
              onUseData={onUseData ? () => onUseData(v.key) : undefined}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function Field({
  v,
  value,
  onChange,
  bound,
  pickImage,
  data,
  onUseData,
}: {
  v: Variable;
  value: string;
  onChange: (x: string) => void;
  bound?: string;
  pickImage?: (key: string) => void;
  /** Filled by the title's data ('data'), or typed over by the operator ('typed'). */
  data?: 'data' | 'typed';
  onUseData?: () => void;
}) {
  const id = `tt-cp-${v.key}`;
  if (bound !== undefined)
    return (
      <div className="tt-cp-field">
        <label htmlFor={id}>{v.label}</label>
        <input id={id} value={bound} readOnly title="Filled automatically" className="tt-cp-bound" />
      </div>
    );
  let input;
  if (v.options?.length && v.type !== 'color') {
    input = (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {!v.options.includes(value) && <option value={value}>{value || '(empty)'}</option>}
        {v.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (v.type === 'number') {
    const n = Number(value) || 0;
    input = (
      <span className="tt-cp-stepper">
        <button type="button" onClick={() => onChange(String(n - 1))} aria-label={`${v.label} down`}>
          −
        </button>
        <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => onChange(String(n + 1))} aria-label={`${v.label} up`}>
          +
        </button>
      </span>
    );
  } else if (v.type === 'color') {
    input = (
      <span className="tt-cp-colors">
        <input id={id} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
        {(v.options ?? []).map((o) => (
          <button key={o} type="button" className="tt-cp-swatch" style={{ background: o }} aria-label={o} onClick={() => onChange(o)} />
        ))}
      </span>
    );
  } else if (v.type === 'timer') {
    input = <TimerControl id={id} v={v} value={value} onChange={onChange} />;
  } else if (v.type === 'list') {
    input = <textarea id={id} rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder="One item a line" />;
  } else if (v.type === 'image') {
    input = (
      <span className="tt-cp-image">
        {value && <img src={value} alt="" />}
        {pickImage && (
          <button type="button" onClick={() => pickImage(v.key)}>
            Choose…
          </button>
        )}
      </span>
    );
  } else input = <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <div className="tt-cp-field">
      <label htmlFor={id}>
        {v.label}
        {data === 'data' && (
          <span className="tt-cp-data" title="Filled from this title's data (the row chosen). Type to put your own words in.">
            Data
          </span>
        )}
        {data === 'typed' && onUseData && (
          <button type="button" className="tt-cp-usedata" onClick={onUseData} title="Show the data's value again">
            Use data
          </button>
        )}
      </label>
      {input}
    </div>
  );
}

/** A timer's buttons: start / stop, reset, a minute (or a second) more or less, and the time typed in. */
function TimerControl({ id, v, value, onChange }: { id: string; v: Variable; value: string; onChange: (x: string) => void }) {
  const running = timerRunning(value);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [running]);
  const now = Date.now();
  const shown = timerText({ ...v, timer: v.timer ? { ...v.timer, auto: false } : v.timer }, value, now, null);
  const step = (v.timer?.format ?? '').includes('.t') || v.timer?.format === 'ss' ? 1 : 60;
  const cmd = (c: 'toggle' | 'reset' | 'add', amount = 0) => onChange(timerCommand(v, value, c, Date.now(), amount));
  return (
    <span className="tt-cp-timer">
      {running ? (
        <input id={id} className="tt-cp-timer-time" value={shown} readOnly aria-label={`${v.label} time`} />
      ) : (
        <input
          id={id}
          key={value}
          className="tt-cp-timer-time"
          defaultValue={shown}
          aria-label={`${v.label} time`}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          onBlur={(e) => {
            const n = parseClock(e.target.value);
            if (Number.isFinite(n) && e.target.value !== shown) onChange(String(n));
          }}
        />
      )}
      <button type="button" className={running ? 'on' : ''} onClick={() => cmd('toggle')} aria-label={running ? `Stop ${v.label}` : `Start ${v.label}`}>
        {running ? 'Stop' : 'Start'}
      </button>
      <button type="button" onClick={() => cmd('add', -step)} aria-label={`${v.label} ${step === 60 ? 'a minute' : 'a second'} less`}>
        −
      </button>
      <button type="button" onClick={() => cmd('add', step)} aria-label={`${v.label} ${step === 60 ? 'a minute' : 'a second'} more`}>
        +
      </button>
      <button type="button" onClick={() => cmd('reset')} aria-label={`Reset ${v.label}`}>
        Reset
      </button>
    </span>
  );
}
