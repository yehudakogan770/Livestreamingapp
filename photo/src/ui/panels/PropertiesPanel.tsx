// Properties: the settings of whatever is active — an adjustment, a fill, a
// type or shape layer, a smart object, a mask — or the document itself.

import { useEffect, useState } from 'react';
import { current, useApp, openDialog, bump, app } from '../../app/state';
import * as ops from '../../app/ops/layers';
import { AdjustEditor } from '../AdjustEditor';
import { ADJUSTMENT_NAMES, defaultParams, autoLevels, type AdjustmentParams } from '../../core/adjust';
import { Slider, Select, Check, ColorWell, NumberField } from '../fields';
import { gradientCss } from '../util';
import { allPatterns } from '../../core/patterns';
import { layerBounds } from '../../core/layers';
import { compositeHistogram } from '../hist';
import { run } from '../../app/commands';
import { rerenderSync } from '../../app/layerContent';
import { setTextModel } from '../../app/tools/typeTool';
import { FONT_FAMILIES } from '../fonts';
import { STYLE_NAMES, STYLE_ORDER } from '../../core/styles';
import { FILTERS } from '../../core/filters/registry';
import { rerender } from '../../app/layerContent';
import { change } from '../../app/ops/common';
import { updateLayer } from '../../core/layers';
import type { FillContent, Layer, ShapeLayer, TextLayer, SmartLayer, Doc } from '../../core/types';
import type { Gradient } from '../../core/gradient';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="lp-section-title">{title}</div>
      {children}
    </>
  );
}

function DocProps({ doc }: { doc: Doc }) {
  return (
    <Section title="Document">
      <div className="lp-info" style={{ gridTemplateColumns: 'auto 1fr' }}>
        <span>Size</span>
        <span>
          {doc.width} × {doc.height} px
        </span>
        <span>Resolution</span>
        <span>{Math.round(doc.resolution)} ppi</span>
        <span>Mode</span>
        <span>RGB, {doc.depth} bits/channel</span>
        <span>Profile</span>
        <span>{doc.profile.name}</span>
      </div>
      <div className="lp-panel-row" style={{ marginTop: 10 }}>
        <button className="lp-btn" onClick={() => void run('image.imageSize')}>
          Image Size…
        </button>
        <button className="lp-btn" onClick={() => void run('image.canvasSize')}>
          Canvas Size…
        </button>
      </div>
    </Section>
  );
}

export function PropertiesPanel() {
  useApp((s) => s.rev);
  const s = current();
  const [hist, setHist] = useState<Uint32Array[] | null>(null);
  const l = s?.activeLayer() ?? null;
  useEffect(() => {
    if (!s || l?.kind !== 'adjust') return;
    const t = setTimeout(() => setHist(compositeHistogram(s)), 50);
    return () => clearTimeout(t);
  }, [s, l?.id, l?.kind]);
  useEffect(() => {
    const auto = () => {
      const st = current();
      const al = st?.activeLayer();
      if (!st || al?.kind !== 'adjust' || (al.adjust !== 'levels' && al.adjust !== 'curves')) return;
      const h = compositeHistogram(st);
      if (!h) return;
      const lv = autoLevels(h, 'color');
      if (al.adjust === 'levels') ops.setLayer(al.id, { params: lv } as Partial<Layer>, 'Auto');
      else {
        const toCurve = (c: typeof lv.r): [number, number][] => [
          [c.inBlack, 0],
          [c.inWhite, 1],
        ];
        ops.setLayer(al.id, { params: { rgb: [[0, 0], [1, 1]], r: toCurve(lv.r), g: toCurve(lv.g), b: toCurve(lv.b) } } as Partial<Layer>, 'Auto');
      }
    };
    window.addEventListener('lp-auto-levels', auto);
    return () => window.removeEventListener('lp-auto-levels', auto);
  }, []);
  if (!s) return <div className="lp-empty">No document</div>;
  if (!l) return <div className="lp-panel"><DocProps doc={s.doc} /></div>;

  const maskSection = l.mask && (
    <Section title="Mask">
      <Slider label="Density" value={l.mask.density} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => ops.setLayer(l.id, { mask: { ...l.mask!, density: v } }, 'Mask Density', 'mask', true)} />
      <Slider label="Feather" value={l.mask.feather} min={0} max={250} step={0.1} digits={1} suffix="px" onChange={(v) => ops.setLayer(l.id, { mask: { ...l.mask!, feather: v } }, 'Mask Feather', 'mask', true)} />
      <div className="lp-panel-row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
        <button className="lp-btn" onClick={() => app.set({ workspace: { kind: 'selectMask', props: { mask: l.id } } })}>
          Select and Mask…
        </button>
        <button className="lp-btn" onClick={() => ops.maskToSelection(l.id)}>
          Load Selection
        </button>
        <button className="lp-btn" onClick={() => void run('layer.maskToggle')}>
          {l.mask.enabled ? 'Disable' : 'Enable'}
        </button>
        <button className="lp-btn" onClick={() => ops.deleteMask(true)}>
          Apply
        </button>
        <button className="lp-btn" onClick={() => ops.deleteMask(false)}>
          Delete
        </button>
      </div>
    </Section>
  );

  let body: React.ReactNode = null;
  switch (l.kind) {
    case 'adjust':
      body = (
        <>
          <div className="lp-panel-row" style={{ marginBottom: 10 }}>
            <strong style={{ fontWeight: 600 }}>{ADJUSTMENT_NAMES[l.adjust]}</strong>
            <span style={{ flex: 1 }} />
            <button className="lp-btn" onClick={() => ops.setLayer(l.id, { params: defaultParams(l.adjust) } as Partial<Layer>, 'Reset Adjustment')}>
              Reset
            </button>
          </div>
          <AdjustEditor
            type={l.adjust}
            params={l.params}
            hist={hist}
            onChange={(p: AdjustmentParams) => ops.setLayer(l.id, { params: p } as Partial<Layer>, ADJUSTMENT_NAMES[l.adjust], 'adjust', true)}
          />
          <div style={{ height: 8 }} />
          <Check label="Clip to the layer below" checked={l.clip} onChange={() => ops.toggleClip()} />
        </>
      );
      break;
    case 'fill':
      body = <FillProps id={l.id} content={l.content} />;
      break;
    case 'text':
      body = <TextProps l={l} />;
      break;
    case 'shape':
      body = <ShapeProps l={l} />;
      break;
    case 'smart':
      body = <SmartProps l={l} />;
      break;
    case 'pixel':
    case 'group':
      body = <LayerTransform l={l} doc={s.doc} />;
      break;
  }

  const styles = STYLE_ORDER.filter((k) => l.styles?.[k]?.on);
  return (
    <div className="lp-panel">
      {body}
      {maskSection}
      {styles.length > 0 && (
        <Section title="Effects">
          {styles.map((k) => (
            <div key={k} className="lp-row" style={{ padding: '0 2px' }} onDoubleClick={() => openDialog('layerStyle', { tab: k })}>
              <span className="lp-grow">{STYLE_NAMES[k]}</span>
            </div>
          ))}
          <button className="lp-btn" style={{ marginTop: 6 }} onClick={() => openDialog('layerStyle')}>
            Layer Style…
          </button>
        </Section>
      )}
    </div>
  );
}

function LayerTransform({ l, doc }: { l: Layer; doc: Doc }) {
  const b = layerBounds(l, doc);
  return (
    <>
      <Section title={l.kind === 'group' ? 'Group' : 'Pixel Layer'}>
        {b ? (
          <div className="lp-info">
            <span>W</span>
            <span>{b.w} px</span>
            <span>H</span>
            <span>{b.h} px</span>
            <span>X</span>
            <span>{b.x} px</span>
            <span>Y</span>
            <span>{b.y} px</span>
          </div>
        ) : (
          <div className="lp-note">This layer is empty.</div>
        )}
      </Section>
      <Section title="Quick Actions">
        <div className="lp-panel-row" style={{ flexWrap: 'wrap' }}>
          <button className="lp-btn" onClick={() => void run('select.subject')}>
            Select Subject
          </button>
          <button
            className="lp-btn"
            disabled={l.kind !== 'pixel'}
            onClick={async () => {
              await run('select.subject');
              if (current()?.doc.selection) {
                ops.addMask('selection');
                void run('select.deselect');
              }
            }}
            title="Select the subject and hide the rest with a mask"
          >
            Remove Background
          </button>
          <button className="lp-btn" onClick={() => void run('edit.freeTransform')}>
            Free Transform
          </button>
        </div>
      </Section>
    </>
  );
}

function FillProps({ id, content }: { id: string; content: FillContent }) {
  const set = (c: FillContent, merge = true) => ops.setLayer(id, { content: c } as Partial<Layer>, 'Fill Content', 'fill', merge);
  if (content.type === 'solid')
    return (
      <Section title="Color Fill">
        <div className="lp-panel-row">
          <ColorWell color={content.color} size={36} title="Fill color" onClick={() => openDialog('colorPicker', { color: content.color.slice(0, 3), onPick: (c: [number, number, number]) => set({ type: 'solid', color: [...c, 1] }, false) })} />
        </div>
      </Section>
    );
  if (content.type === 'gradient')
    return (
      <Section title="Gradient Fill">
        <div className="lp-gradient-bar" style={{ background: gradientCss(content.gradient, content.reverse), cursor: 'pointer', marginBottom: 10 }} title="Edit the gradient" onClick={() => openDialog('gradientEditor', { gradient: content.gradient, onPick: (g: Gradient) => set({ ...content, gradient: g }, false) })} />
        <div className="lp-panel-row">
          <Select
            label="Style"
            value={content.style}
            options={[
              ['linear', 'Linear'],
              ['radial', 'Radial'],
              ['angle', 'Angle'],
              ['reflected', 'Reflected'],
              ['diamond', 'Diamond'],
            ]}
            onChange={(v) => set({ ...content, style: v }, false)}
          />
        </div>
        {!content.p0 && <Slider label="Angle" value={content.angle} min={-180} max={180} suffix="°" onChange={(v) => set({ ...content, angle: v })} />}
        {!content.p0 && <Slider label="Scale" value={content.scale} min={0.1} max={10} step={0.01} scale={100} suffix="%" onChange={(v) => set({ ...content, scale: v })} />}
        <Check label="Reverse" checked={content.reverse} onChange={(v) => set({ ...content, reverse: v }, false)} />
        <Check label="Dither" checked={!!content.dither} onChange={(v) => set({ ...content, dither: v }, false)} />
        {content.p0 && <div className="lp-note">Drag with the Gradient tool to move its ends.</div>}
      </Section>
    );
  return (
    <Section title="Pattern Fill">
      <div className="lp-panel-row">
        <Select label="Pattern" value={content.pattern} options={allPatterns().map((p) => [p.id, p.name] as [string, string])} onChange={(v) => set({ ...content, pattern: v }, false)} />
      </div>
      <Slider label="Scale" value={content.scale} min={0.01} max={10} step={0.01} scale={100} suffix="%" onChange={(v) => set({ ...content, scale: v })} />
    </Section>
  );
}

function TextProps({ l }: { l: TextLayer }) {
  const b = l.text.base;
  const setBase = (patch: Partial<typeof b>) => setTextModel(l.id, { ...l.text, base: { ...b, ...patch }, runs: l.text.runs.map((r) => (r.style ? { ...r, style: { ...r.style, ...patch } } : r)) }, 'Character');
  return (
    <>
      <Section title="Type Layer">
        <div className="lp-panel-row">
          <Select value={b.family} options={FONT_FAMILIES.map((f) => [f, f] as [string, string])} onChange={(v) => setBase({ family: v })} title="Font" width={170} />
          <ColorWell color={b.color} title="Text color" onClick={() => openDialog('colorPicker', { color: b.color, onPick: (c: [number, number, number]) => setBase({ color: c }) })} />
        </div>
        <div className="lp-panel-row">
          <NumberField label="Size" value={b.size} min={1} max={5000} digits={1} suffix="px" width={56} onChange={(v) => setBase({ size: v })} />
          <NumberField label="Tracking" value={b.tracking} min={-1000} max={10000} width={50} onChange={(v) => setBase({ tracking: v })} />
        </div>
      </Section>
      <Section title="Warp">
        <div className="lp-panel-row">
          <Select
            value={l.text.warp?.style ?? 'none'}
            title="Warp style"
            options={[
              ['none', 'None'],
              ['arc', 'Arc'],
              ['arch', 'Arch'],
              ['bulge', 'Bulge'],
              ['flag', 'Flag'],
              ['wave', 'Wave'],
              ['rise', 'Rise'],
            ]}
            onChange={(v) => setTextModel(l.id, { ...l.text, warp: v === 'none' ? undefined : { style: v, bend: l.text.warp?.bend ?? 0.5 } }, 'Warp Text')}
          />
        </div>
        {l.text.warp && <Slider label="Bend" value={l.text.warp.bend} min={-1} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => setTextModel(l.id, { ...l.text, warp: { ...l.text.warp!, bend: v } }, 'Warp Text')} />}
      </Section>
      <div className="lp-panel-row" style={{ marginTop: 10 }}>
        <button className="lp-btn" onClick={() => window.dispatchEvent(new CustomEvent('lp-open-panel', { detail: 'character' }))}>
          Character…
        </button>
        <button className="lp-btn" onClick={() => ops.rasterize(l.id)}>
          Rasterize Type
        </button>
      </div>
    </>
  );
}

function ShapeProps({ l }: { l: ShapeLayer }) {
  const s = current()!;
  const set = (patch: Partial<ShapeLayer>, label: string, merge = true) => {
    const next = rerenderSync({ ...l, ...patch }, s.doc);
    ops.setLayer(l.id, next, label, 'shape', merge);
  };
  return (
    <Section title="Shape">
      <div className="lp-panel-row">
        <span className="lp-label" style={{ width: 50 }}>
          Fill
        </span>
        {l.fillColor ? <ColorWell color={l.fillColor} title="Fill color" onClick={() => openDialog('colorPicker', { color: l.fillColor!.slice(0, 3), onPick: (c: [number, number, number]) => set({ fillColor: [...c, 1] }, 'Shape Fill', false) })} /> : null}
        <Check label="None" checked={!l.fillColor} onChange={(v) => set({ fillColor: v ? null : [...app.get().fg, 1] }, 'Shape Fill', false)} />
      </div>
      <div className="lp-panel-row">
        <span className="lp-label" style={{ width: 50 }}>
          Stroke
        </span>
        {l.stroke ? <ColorWell color={l.stroke.color} title="Stroke color" onClick={() => openDialog('colorPicker', { color: l.stroke!.color.slice(0, 3), onPick: (c: [number, number, number]) => set({ stroke: { ...l.stroke!, color: [...c, 1] } }, 'Shape Stroke', false) })} /> : null}
        <Check
          label="None"
          checked={!l.stroke}
          onChange={(v) => set({ stroke: v ? null : { color: [...app.get().fg, 1], width: 3, align: 'center', cap: 'butt', join: 'miter', dash: [] } }, 'Shape Stroke', false)}
        />
      </div>
      {l.stroke && (
        <>
          <Slider label="Stroke Width" value={l.stroke.width} min={0} max={200} step={0.5} digits={1} suffix="px" onChange={(v) => set({ stroke: { ...l.stroke!, width: v } }, 'Shape Stroke')} />
          <div className="lp-panel-row">
            <Select
              label="Align"
              value={l.stroke.align}
              options={[
                ['inside', 'Inside'],
                ['center', 'Center'],
                ['outside', 'Outside'],
              ]}
              onChange={(v) => set({ stroke: { ...l.stroke!, align: v } }, 'Shape Stroke', false)}
            />
            <Select
              label="Dashes"
              value={l.stroke.dash.length ? 'dash' : 'solid'}
              options={[
                ['solid', 'Solid'],
                ['dash', 'Dashed'],
              ]}
              onChange={(v) => set({ stroke: { ...l.stroke!, dash: v === 'dash' ? [4, 2] : [] } }, 'Shape Stroke', false)}
            />
          </div>
        </>
      )}
    </Section>
  );
}

function SmartProps({ l }: { l: SmartLayer }) {
  const s = current()!;
  const names = new Map(FILTERS.map((f) => [f.id, f.name]));
  return (
    <>
      <Section title="Smart Object">
        <div className="lp-info" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <span>Source</span>
          <span>{l.source.name || (l.source.kind === 'svg' ? 'Vector drawing' : 'Embedded picture')}</span>
          <span>Size</span>
          <span>
            {l.source.width} × {l.source.height} px
          </span>
        </div>
        <div className="lp-panel-row" style={{ marginTop: 8 }}>
          <button className="lp-btn" onClick={() => void run('edit.freeTransform')}>
            Transform
          </button>
          <button className="lp-btn" onClick={() => ops.rasterize(l.id)}>
            Rasterize
          </button>
        </div>
      </Section>
      {l.filters.length > 0 && (
        <Section title="Smart Filters">
          {l.filters.map((f) => (
            <div key={f.id} className="lp-row" style={{ padding: '0 2px' }}>
              <span className="lp-grow">{f.filter.startsWith('adj:') ? ADJUSTMENT_NAMES[f.filter.slice(4) as keyof typeof ADJUSTMENT_NAMES] : names.get(f.filter)}</span>
              <button
                className="lp-btn"
                onClick={async () => {
                  const next = { ...l, filters: l.filters.filter((x) => x.id !== f.id) };
                  const drawn = await rerender(next, s.doc);
                  change('Delete Smart Filter', 'filter', (d) => ({ ...d, layers: updateLayer(d.layers, l.id, () => drawn) }));
                  bump();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}
