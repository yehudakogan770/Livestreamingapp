// A filter's dialog, built from its settings, with the result previewed on
// the canvas; and Image ▸ Adjustments on the pixels.

import { useEffect, useRef, useState } from 'react';
import { current, useApp } from '../../app/state';
import { run } from '../../app/commands';
import { Dialog, OkCancel, Slider, Select, Check, ColorWell, NumberField } from '../fields';
import { ColorPickerDialog } from './ColorDialogs';
import { filterById } from '../../core/filters/registry';
import { defaults, type ParamDef, type Params } from '../../core/filters/types';
import { previewFilter, clearPreview } from '../../app/ops/filter';
import { AdjustEditor } from '../AdjustEditor';
import { ADJUSTMENT_NAMES, defaultParams, type AdjustmentType, type AdjustmentParams } from '../../core/adjust';
import { compositeHistogram } from '../hist';

function usePreview(id: string, params: Params, on: boolean, slow: boolean) {
  const t = useRef(0);
  useEffect(() => {
    clearTimeout(t.current);
    if (!on) {
      clearPreview();
      return;
    }
    t.current = window.setTimeout(() => void previewFilter(id, params), slow ? 350 : 60);
    return () => clearTimeout(t.current);
  }, [id, params, on, slow]);
  useEffect(() => () => clearPreview(), []);
}

function Field({ d, value, set }: { d: ParamDef; value: unknown; set: (v: unknown) => void }) {
  const [picking, setPicking] = useState(false);
  switch (d.type) {
    case 'number': {
      const v = typeof value === 'number' ? value : d.def;
      if (d.log && d.min > 0) {
        // A log slider for wide ranges (radius 0.1–250 px).
        const lo = Math.log(d.min),
          hi = Math.log(d.max);
        return (
          <div className="lp-slider">
            <label>{d.label}</label>
            <NumberField value={v} min={d.min} max={d.max} step={d.step ?? 1} digits={(d.step ?? 1) < 1 ? 1 : 0} suffix={d.unit} width={52} onChange={set} />
            <input type="range" aria-label={d.label} min={lo} max={hi} step={0.001} value={Math.log(Math.max(d.min, v))} onChange={(e) => set(Math.round(Math.exp(parseFloat(e.target.value)) / (d.step ?? 1)) * (d.step ?? 1))} />
          </div>
        );
      }
      const step = d.step ?? 1;
      return <Slider label={d.label} value={v} min={d.min} max={d.max} step={step} digits={step < 1 ? (step < 0.1 ? 2 : 1) : 0} suffix={d.unit} onChange={set} />;
    }
    case 'angle':
      return <Slider label={d.label} value={typeof value === 'number' ? value : d.def} min={-180} max={180} suffix="°" onChange={set} />;
    case 'select':
      return (
        <div className="lp-panel-row">
          <Select label={d.label} value={String(value ?? d.def)} options={d.options} onChange={set} />
        </div>
      );
    case 'bool':
      return (
        <div className="lp-panel-row">
          <Check label={d.label} checked={!!(value ?? d.def)} onChange={set} />
        </div>
      );
    case 'color': {
      const c = (Array.isArray(value) ? value : d.def) as [number, number, number];
      return (
        <div className="lp-panel-row">
          <span className="lp-label">{d.label}</span>
          <ColorWell color={c} title={d.label} onClick={() => setPicking(true)} />
          {picking && <ColorPickerDialog p={{ color: c, onPick: set }} onClose={() => setPicking(false)} />}
        </div>
      );
    }
    case 'point': {
      const p = (Array.isArray(value) ? value : d.def) as [number, number];
      return (
        <>
          <Slider label={`${d.label} X`} value={p[0]} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(x) => set([x, p[1]])} />
          <Slider label={`${d.label} Y`} value={p[1]} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(y) => set([p[0], y])} />
        </>
      );
    }
    case 'seed':
      return (
        <div className="lp-panel-row">
          <span className="lp-label">{d.label}</span>
          <button className="lp-btn" onClick={() => set(Math.floor(Math.random() * 1e6))}>
            Randomize
          </button>
        </div>
      );
  }
}

export function FilterDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const def = filterById(id)!;
  const [params, setParams] = useState<Params>(() => defaults(def));
  const [preview, setPreview] = useState(true);
  const s = current();
  const big = !!s && s.doc.width * s.doc.height > 6e6;
  const slow = !Number.isFinite(def.reach(params, { width: s?.doc.width ?? 1, height: s?.doc.height ?? 1 })) || big;
  usePreview(id, params, preview, slow);
  const ok = () => {
    onClose();
    void run('filter.apply', { id, params, label: def.name });
  };
  return (
    <Dialog title={def.name} onClose={onClose} width={360} modal={false} foot={
      <>
        <Check label="Preview" checked={preview} onChange={setPreview} />
        <button className="lp-btn" onClick={() => setParams(defaults(def))}>
          Reset
        </button>
        <OkCancel onOk={ok} onCancel={onClose} />
      </>
    }>
      {def.params.length ? (
        def.params.map((d) => (
          <div key={d.key} style={{ marginBottom: 8 }}>
            <Field d={d} value={params[d.key]} set={(v) => setParams({ ...params, [d.key]: v })} />
          </div>
        ))
      ) : (
        <div className="lp-note">This filter has no settings.</div>
      )}
    </Dialog>
  );
}

export function AdjustPixelsDialog({ type, onClose }: { type: AdjustmentType; onClose: () => void }) {
  const [params, setParams] = useState<AdjustmentParams>(() => defaultParams(type));
  const [preview, setPreview] = useState(true);
  useApp((s) => s.rev);
  const [hist] = useState(() => {
    const s = current();
    return s ? compositeHistogram(s, 'layer') : null;
  });
  const id = `adj:${type}`;
  usePreview(id, params as unknown as Params, preview, false);
  const ok = () => {
    onClose();
    void run('filter.apply', { id, params, label: ADJUSTMENT_NAMES[type] });
  };
  return (
    <Dialog title={ADJUSTMENT_NAMES[type]} onClose={onClose} width={360} modal={false} foot={
      <>
        <Check label="Preview" checked={preview} onChange={setPreview} />
        <OkCancel onOk={ok} onCancel={onClose} />
      </>
    }>
      <AdjustEditor type={type} params={params} hist={hist} onChange={(p) => setParams(p)} />
    </Dialog>
  );
}
