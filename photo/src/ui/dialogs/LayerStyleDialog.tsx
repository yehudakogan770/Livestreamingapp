// Layer Style: blending options and the ten effects, shown on the canvas as
// they change; OK records one step, Cancel puts the layer back.

import { useEffect, useRef, useState } from 'react';
import { current, requestFrame, bump } from '../../app/state';
import { Dialog, OkCancel, Slider, Select, Check, ColorWell } from '../fields';
import { ColorPickerDialog, GradientEditorDialog } from './ColorDialogs';
import { STYLE_ORDER, STYLE_NAMES, defaultStyle, type LayerStyles, type StyleKey } from '../../core/styles';
import { BLEND_GROUPS, BLEND_NAMES, type BlendMode } from '../../core/blend';
import { updateLayer } from '../../core/layers';
import { allPatterns } from '../../core/patterns';
import { gradientCss } from '../util';
import type { Layer } from '../../core/types';
import type { Gradient } from '../../core/gradient';

const BLENDS: [BlendMode, string][] = BLEND_GROUPS.flat().map((m) => [m, BLEND_NAMES[m]]);
type Any = Record<string, unknown>;

/** Which fields each effect has, in order. */
const FIELDS: Record<StyleKey, string[]> = {
  dropShadow: ['blend', 'color', 'opacity', 'angle', 'distance', 'spread', 'size', 'knockout'],
  innerShadow: ['blend', 'color', 'opacity', 'angle', 'distance', 'spread', 'size'],
  outerGlow: ['blend', 'color', 'opacity', 'spread', 'size'],
  innerGlow: ['blend', 'color', 'opacity', 'source', 'spread', 'size'],
  bevel: ['style', 'direction', 'depth', 'size', 'soften', 'angle', 'altitude', 'highlightBlend', 'highlightColor', 'highlightOpacity', 'shadowBlend', 'shadowColor', 'shadowOpacity'],
  satin: ['blend', 'color', 'opacity', 'angle', 'distance', 'size', 'invert'],
  colorOverlay: ['blend', 'color', 'opacity'],
  gradientOverlay: ['blend', 'opacity', 'gradient', 'reverse', 'style', 'angle', 'scale'],
  patternOverlay: ['blend', 'opacity', 'pattern', 'scale'],
  stroke: ['size', 'position', 'blend', 'opacity', 'color'],
};

const LABEL: Record<string, string> = {
  blend: 'Blend Mode',
  highlightBlend: 'Highlight Mode',
  shadowBlend: 'Shadow Mode',
  color: 'Color',
  highlightColor: 'Highlight Color',
  shadowColor: 'Shadow Color',
  opacity: 'Opacity',
  highlightOpacity: 'Highlight Opacity',
  shadowOpacity: 'Shadow Opacity',
  angle: 'Angle',
  distance: 'Distance',
  spread: 'Spread',
  size: 'Size',
  knockout: 'Layer Knocks Out Drop Shadow',
  source: 'Source',
  style: 'Style',
  direction: 'Direction',
  depth: 'Depth',
  soften: 'Soften',
  altitude: 'Altitude',
  invert: 'Invert',
  gradient: 'Gradient',
  reverse: 'Reverse',
  scale: 'Scale',
  pattern: 'Pattern',
  position: 'Position',
};

export function LayerStyleDialog({ onClose, tab }: { onClose: () => void; tab?: string }) {
  const s = current();
  const orig = useRef<Layer | null>(s?.activeLayer() ?? null);
  const [styles, setStyles] = useState<LayerStyles>(() => structuredClone(orig.current?.styles ?? {}));
  const [opacity, setOpacity] = useState(orig.current?.opacity ?? 1);
  const [fill, setFill] = useState(orig.current?.fill ?? 1);
  const [blend, setBlend] = useState<BlendMode>(orig.current?.blend ?? 'normal');
  const [sel, setSel] = useState<StyleKey | 'blending'>((tab as StyleKey) ?? 'blending');
  const [picker, setPicker] = useState<{ key: string } | null>(null);
  const [gradEdit, setGradEdit] = useState(false);

  // Live on the canvas.
  useEffect(() => {
    const st = current();
    const o = orig.current;
    if (!st || !o) return;
    st.doc = { ...st.doc, layers: updateLayer(st.doc.layers, o.id, (l) => ({ ...l, styles, opacity, fill, blend }) as Layer) };
    requestFrame();
  }, [styles, opacity, fill, blend]);

  if (!s || !orig.current) return null;
  const o = orig.current;
  const restore = () => {
    const st = current();
    if (!st) return;
    st.doc = { ...st.doc, layers: updateLayer(st.doc.layers, o.id, () => o) };
  };
  const cancel = () => {
    restore();
    onClose();
    bump();
  };
  const ok = () => {
    restore();
    const st = current()!;
    st.commit('Layer Style', 'fx', { ...st.doc, layers: updateLayer(st.doc.layers, o.id, (l) => ({ ...l, styles, opacity, fill, blend }) as Layer) });
    onClose();
    bump();
  };

  const toggle = (k: StyleKey, on: boolean) => setStyles((cur) => ({ ...cur, [k]: cur[k] ? { ...cur[k]!, on } : { ...defaultStyle(k), on } }));
  const fx = sel !== 'blending' ? ((styles[sel] as unknown as Any | undefined) ?? (defaultStyle(sel) as unknown as Any)) : null;
  const setFx = (k: string, v: unknown) => {
    if (sel === 'blending') return;
    setStyles((cur) => ({ ...cur, [sel]: { ...(cur[sel] ?? defaultStyle(sel)), on: true, [k]: v } }));
  };

  const field = (k: string) => {
    if (!fx) return null;
    const v = fx[k];
    const label = LABEL[k] ?? k;
    if (k === 'blend' || k === 'highlightBlend' || k === 'shadowBlend') return <Select key={k} label={label} value={v as BlendMode} options={BLENDS} onChange={(x) => setFx(k, x)} />;
    if (k.toLowerCase().endsWith('color'))
      return (
        <div key={k} className="lp-panel-row">
          <span className="lp-label">{label}</span>
          <ColorWell color={v as number[]} title={label} onClick={() => setPicker({ key: k })} />
        </div>
      );
    if (k.toLowerCase().endsWith('opacity')) return <Slider key={k} label={label} value={v as number} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(x) => setFx(k, x)} />;
    if (k === 'angle') return <Slider key={k} label={label} value={v as number} min={-180} max={180} suffix="°" onChange={(x) => setFx(k, x)} />;
    if (k === 'altitude') return <Slider key={k} label={label} value={v as number} min={0} max={90} suffix="°" onChange={(x) => setFx(k, x)} />;
    if (k === 'distance' || k === 'size') return <Slider key={k} label={label} value={v as number} min={0} max={250} suffix="px" onChange={(x) => setFx(k, x)} />;
    if (k === 'soften') return <Slider key={k} label={label} value={v as number} min={0} max={16} suffix="px" onChange={(x) => setFx(k, x)} />;
    if (k === 'spread') return <Slider key={k} label={sel === 'innerShadow' || sel === 'innerGlow' ? 'Choke' : label} value={v as number} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(x) => setFx(k, x)} />;
    if (k === 'depth') return <Slider key={k} label={label} value={v as number} min={0.01} max={10} step={0.01} scale={100} suffix="%" onChange={(x) => setFx(k, x)} />;
    if (k === 'scale') return <Slider key={k} label={label} value={v as number} min={0.1} max={10} step={0.01} scale={100} suffix="%" onChange={(x) => setFx(k, x)} />;
    if (k === 'knockout' || k === 'invert' || k === 'reverse')
      return (
        <div key={k} className="lp-panel-row">
          <Check label={label} checked={!!v} onChange={(x) => setFx(k, x)} />
        </div>
      );
    if (k === 'source')
      return (
        <Select
          key={k}
          label={label}
          value={(v as string) ?? 'edge'}
          options={[
            ['edge', 'Edge'],
            ['center', 'Center'],
          ]}
          onChange={(x) => setFx(k, x)}
        />
      );
    if (k === 'style' && sel === 'bevel')
      return (
        <Select
          key={k}
          label={label}
          value={v as string}
          options={[
            ['inner', 'Inner Bevel'],
            ['outer', 'Outer Bevel'],
            ['emboss', 'Emboss'],
            ['pillow', 'Pillow Emboss'],
          ]}
          onChange={(x) => setFx(k, x)}
        />
      );
    if (k === 'style')
      return (
        <Select
          key={k}
          label={label}
          value={v as string}
          options={[
            ['linear', 'Linear'],
            ['radial', 'Radial'],
            ['angle', 'Angle'],
            ['reflected', 'Reflected'],
            ['diamond', 'Diamond'],
          ]}
          onChange={(x) => setFx(k, x)}
        />
      );
    if (k === 'direction')
      return (
        <Select
          key={k}
          label={label}
          value={v as string}
          options={[
            ['up', 'Up'],
            ['down', 'Down'],
          ]}
          onChange={(x) => setFx(k, x)}
        />
      );
    if (k === 'position')
      return (
        <Select
          key={k}
          label={label}
          value={v as string}
          options={[
            ['outside', 'Outside'],
            ['inside', 'Inside'],
            ['center', 'Center'],
          ]}
          onChange={(x) => setFx(k, x)}
        />
      );
    if (k === 'pattern') return <Select key={k} label={label} value={v as string} options={allPatterns().map((p) => [p.id, p.name] as [string, string])} onChange={(x) => setFx(k, x)} />;
    if (k === 'gradient')
      return (
        <div key={k} className="lp-panel-row">
          <span className="lp-label">{label}</span>
          <button className="lp-gradient-bar" style={{ flex: 1, background: gradientCss(v as Gradient, !!fx.reverse) }} aria-label="Edit the gradient" onClick={() => setGradEdit(true)} />
        </div>
      );
    return null;
  };

  return (
    <Dialog title="Layer Style" onClose={cancel} width={680} modal={false} foot={<OkCancel onOk={ok} onCancel={cancel} />}>
      <div className="lp-cols">
        <div className="lp-list-pick" style={{ width: 200, flex: 'none' }}>
          <button aria-pressed={sel === 'blending'} onClick={() => setSel('blending')}>
            Blending Options
          </button>
          {[...STYLE_ORDER].map((k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center' }}>
              <input type="checkbox" style={{ marginLeft: 8 }} checked={!!styles[k]?.on} onChange={(e) => toggle(k, e.target.checked)} aria-label={`Use ${STYLE_NAMES[k]}`} />
              <button aria-pressed={sel === k} onClick={() => setSel(k)} style={{ flex: 1 }}>
                {STYLE_NAMES[k]}
              </button>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="lp-section-title" style={{ marginTop: 0 }}>
            {sel === 'blending' ? 'Blending Options' : STYLE_NAMES[sel]}
          </div>
          {sel === 'blending' ? (
            <>
              <Select label="Blend Mode" value={blend} options={BLENDS} onChange={setBlend} />
              <Slider label="Opacity" value={opacity} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={setOpacity} />
              <Slider label="Fill Opacity" value={fill} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={setFill} />
              <div className="lp-note">Fill Opacity fades the layer’s own pixels but not its effects.</div>
              <div className="lp-panel-row">
                <Check label="Show effects" checked={styles.visible !== false} onChange={(v) => setStyles({ ...styles, visible: v })} />
              </div>
            </>
          ) : (
            FIELDS[sel].map(field)
          )}
          {sel !== 'blending' && (
            <div className="lp-panel-row">
              <button className="lp-btn" onClick={() => setStyles({ ...styles, [sel]: { ...defaultStyle(sel), on: styles[sel]?.on ?? true } })}>
                Reset to Default
              </button>
            </div>
          )}
        </div>
      </div>
      {picker && fx && <ColorPickerDialog p={{ color: fx[picker.key] as number[], onPick: (c: [number, number, number]) => setFx(picker.key, c) }} onClose={() => setPicker(null)} />}
      {gradEdit && fx && <GradientEditorDialog p={{ gradient: fx.gradient, onPick: (g: Gradient) => setFx('gradient', g) }} onClose={() => setGradEdit(false)} />}
    </Dialog>
  );
}
