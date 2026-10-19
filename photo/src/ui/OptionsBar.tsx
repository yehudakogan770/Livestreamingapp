// The options bar: the current tool's settings (and Free Transform's numbers
// while it runs).

import {
  Check as CheckIcon,
  X,
  SquarePlus,
  SquareMinus,
  SquareStack,
  Square as SquareIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
} from 'lucide-react';
import { app, setOpts, useApp, openDialog, bump } from '../app/state';
import { toolDef, type ToolOptions, type BrushTip } from '../app/toolDefs';
import { NumberField, Select, Check, Seg, ColorWell } from './fields';
import { ToolIcon } from './Toolbox';
import { BLEND_GROUPS, BLEND_NAMES, type BlendMode, type PaintMode } from '../core/blend';
import { isTransforming, transformNumbers, setTransformNumbers, commitTransform, cancelTransform, toggleWarp } from '../app/tools/transform';
import { cropActive, commitCrop, cancelCrop } from '../app/tools/cropTools';
import { GRADIENT_CHOICES, rulerInfo } from '../app/tools/miscTools';
import { allPatterns } from '../core/patterns';
import { CUSTOM_SHAPES } from '../core/svgPath';
import { FONT_FAMILIES } from './fonts';
import { applyCharStyle, applyParaStyle, isEditingText } from '../app/tools/typeTool';
import { run } from '../app/commands';
import { current } from '../app/state';
import type { SelectOp } from '../core/selection';
import type { ReactNode } from 'react';

const blendOptions = (extra: [PaintMode, string][] = []): [string, string][] => {
  const out: [string, string][] = [];
  for (const g of BLEND_GROUPS) for (const m of g) out.push([m, BLEND_NAMES[m]]);
  return [...out.slice(0, 2), ...extra, ...out.slice(2)];
};

function Sep() {
  return <span className="lp-vsep" />;
}

function Pct({ label, value, onChange, title }: { label: string; value: number; onChange: (v: number) => void; title?: string }) {
  return (
    <NumberField label={label} title={title} value={Math.round(value * 100)} min={0} max={100} suffix="%" width={44} onChange={(v) => onChange(v / 100)} />
  );
}

function TipFields({ tip, set }: { tip: BrushTip; set: (t: Partial<BrushTip>) => void }) {
  return (
    <>
      <NumberField label="Size" value={tip.size} min={1} max={5000} suffix="px" width={52} onChange={(v) => set({ size: v })} />
      <Pct label="Hardness" value={tip.hardness} onChange={(v) => set({ hardness: v })} />
      <button className="lp-btn" onClick={() => openDialog('brushSettings')} title="Brush Settings (F5)">
        Brush Settings
      </button>
    </>
  );
}

function SelectionOps({ op, set }: { op: SelectOp; set: (o: SelectOp) => void }) {
  return (
    <Seg
      label="Selection mode"
      value={op}
      onChange={set}
      options={[
        { v: 'replace', label: 'New selection', icon: <SquareIcon size={14} /> },
        { v: 'add', label: 'Add to selection (Shift)', icon: <SquarePlus size={14} /> },
        { v: 'subtract', label: 'Subtract from selection (Alt)', icon: <SquareMinus size={14} /> },
        { v: 'intersect', label: 'Intersect with selection', icon: <SquareStack size={14} /> },
      ]}
    />
  );
}

function SelectAndMask() {
  return (
    <button className="lp-btn" onClick={() => void run('select.mask')}>
      Select and Mask…
    </button>
  );
}

function CommitCancel({ onCommit, onCancel }: { onCommit: () => void; onCancel: () => void }) {
  return (
    <>
      <button className="lp-icon-btn" title="Cancel (Esc)" aria-label="Cancel" onClick={onCancel}>
        <X size={16} />
      </button>
      <button className="lp-icon-btn" title="Commit (Enter)" aria-label="Commit" onClick={onCommit}>
        <CheckIcon size={16} />
      </button>
    </>
  );
}

export function OptionsBar() {
  const tool = useApp((s) => s.tool);
  const o = useApp((s) => s.opts);
  useApp((s) => s.rev);
  const def = toolDef(tool);
  let body: ReactNode = null;
  const sel = (k: keyof ToolOptions) => (patch: object) => setOpts(k, patch as never);

  if (isTransforming()) {
    const n = transformNumbers();
    body = n && (
      <>
        <NumberField label="X" value={n.x} digits={1} width={64} onChange={(v) => setTransformNumbers({ ...n, x: v })} suffix="px" />
        <NumberField label="Y" value={n.y} digits={1} width={64} onChange={(v) => setTransformNumbers({ ...n, y: v })} suffix="px" />
        <Sep />
        <NumberField label="W" value={n.w} digits={1} width={56} onChange={(v) => setTransformNumbers({ ...n, w: v })} suffix="%" />
        <NumberField label="H" value={n.h} digits={1} width={56} onChange={(v) => setTransformNumbers({ ...n, h: v })} suffix="%" />
        <NumberField label="Angle" value={n.angle} digits={1} width={56} onChange={(v) => setTransformNumbers({ ...n, angle: v })} suffix="°" />
        <Sep />
        <button className="lp-btn" onClick={() => toggleWarp()}>
          Warp
        </button>
        <span style={{ flex: 1 }} />
        <CommitCancel onCommit={() => void commitTransform()} onCancel={() => cancelTransform()} />
      </>
    );
  } else
    switch (tool) {
      case 'move':
        body = (
          <>
            <Check label="Auto-Select" checked={o.move.autoSelect} onChange={(v) => sel('move')({ autoSelect: v })} />
            <Select
              value={o.move.autoSelectGroups ? 'group' : 'layer'}
              options={
                [
                  ['layer', 'Layer'],
                  ['group', 'Group'],
                ] as const
              }
              onChange={(v) => sel('move')({ autoSelectGroups: v === 'group' })}
              title="Auto-select what"
            />
            <Check label="Show Transform Controls" checked={o.move.showTransform} onChange={(v) => sel('move')({ showTransform: v })} />
            <Sep />
            {(
              [
                ['layer.alignLeft', AlignLeft, 'Align left edges'],
                ['layer.alignHCenter', AlignCenter, 'Align horizontal centers'],
                ['layer.alignRight', AlignRight, 'Align right edges'],
              ] as const
            ).map(([id, I, t]) => (
              <button key={id} className="lp-icon-btn" title={t} aria-label={t} onClick={() => void run(id)}>
                <I size={16} />
              </button>
            ))}
            {(
              [
                ['layer.alignTop', 'Align top edges', 'M4 4h16M8 8v12M16 8v8'],
                ['layer.alignVCenter', 'Align vertical centers', 'M4 12h16M8 6v12M16 8v8'],
                ['layer.alignBottom', 'Align bottom edges', 'M4 20h16M8 4v12M16 8v8'],
              ] as const
            ).map(([id, t, d]) => (
              <button key={id} className="lp-icon-btn" title={t} aria-label={t} onClick={() => void run(id)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                  <path d={d} />
                </svg>
              </button>
            ))}
          </>
        );
        break;
      case 'marqueeRect':
      case 'marqueeEllipse':
      case 'marqueeRow':
      case 'marqueeColumn':
      case 'lasso':
      case 'polyLasso':
      case 'magneticLasso':
        body = (
          <>
            <SelectionOps op={o.selection.op} set={(op) => sel('selection')({ op })} />
            <NumberField
              label="Feather"
              value={o.selection.feather}
              min={0}
              max={1000}
              suffix="px"
              width={44}
              onChange={(v) => sel('selection')({ feather: v })}
            />
            {tool !== 'marqueeRect' && tool !== 'marqueeRow' && tool !== 'marqueeColumn' && (
              <Check label="Anti-alias" checked={o.selection.antialias} onChange={(v) => sel('selection')({ antialias: v })} />
            )}
            {(tool === 'marqueeRect' || tool === 'marqueeEllipse') && (
              <>
                <Select
                  label="Style"
                  value={o.selection.style}
                  options={[
                    ['normal', 'Normal'],
                    ['fixedRatio', 'Fixed Ratio'],
                    ['fixedSize', 'Fixed Size'],
                  ]}
                  onChange={(v) => sel('selection')({ style: v })}
                />
                {o.selection.style !== 'normal' && (
                  <>
                    <NumberField
                      label="W"
                      value={o.selection.w}
                      min={0.01}
                      max={30000}
                      digits={o.selection.style === 'fixedRatio' ? 2 : 0}
                      width={52}
                      onChange={(v) => sel('selection')({ w: v })}
                    />
                    <NumberField
                      label="H"
                      value={o.selection.h}
                      min={0.01}
                      max={30000}
                      digits={o.selection.style === 'fixedRatio' ? 2 : 0}
                      width={52}
                      onChange={(v) => sel('selection')({ h: v })}
                    />
                  </>
                )}
              </>
            )}
            {tool === 'magneticLasso' && (
              <>
                <NumberField label="Width" value={o.magnetic.width} min={1} max={256} suffix="px" width={44} onChange={(v) => sel('magnetic')({ width: v })} />
                <Pct label="Contrast" value={o.magnetic.contrast} onChange={(v) => sel('magnetic')({ contrast: v })} />
                <NumberField label="Frequency" value={o.magnetic.frequency} min={0} max={100} width={44} onChange={(v) => sel('magnetic')({ frequency: v })} />
              </>
            )}
            <Sep />
            <SelectAndMask />
          </>
        );
        break;
      case 'objectSelect':
        body = (
          <>
            <SelectionOps op={o.selection.op} set={(op) => sel('selection')({ op })} />
            <Sep />
            <button className="lp-btn" onClick={() => void run('select.subject')}>
              Select Subject
            </button>
            <SelectAndMask />
          </>
        );
        break;
      case 'quickSelect':
        body = (
          <>
            <SelectionOps op={o.selection.op === 'intersect' ? 'add' : o.selection.op} set={(op) => sel('selection')({ op })} />
            <NumberField label="Size" value={o.quick.size} min={1} max={500} suffix="px" width={44} onChange={(v) => sel('quick')({ size: v })} />
            <Check label="Sample All Layers" checked={o.quick.allLayers} onChange={(v) => sel('quick')({ allLayers: v })} />
            <Check label="Enhance Edge" checked={o.quick.enhance} onChange={(v) => sel('quick')({ enhance: v })} />
            <Sep />
            <button className="lp-btn" onClick={() => void run('select.subject')}>
              Select Subject
            </button>
            <SelectAndMask />
          </>
        );
        break;
      case 'magicWand':
        body = (
          <>
            <SelectionOps op={o.selection.op} set={(op) => sel('selection')({ op })} />
            <NumberField label="Tolerance" value={o.wand.tolerance} min={0} max={255} width={44} onChange={(v) => sel('wand')({ tolerance: v })} />
            <Check label="Anti-alias" checked={o.wand.antialias} onChange={(v) => sel('wand')({ antialias: v })} />
            <Check label="Contiguous" checked={o.wand.contiguous} onChange={(v) => sel('wand')({ contiguous: v })} />
            <Check label="Sample All Layers" checked={o.wand.allLayers} onChange={(v) => sel('wand')({ allLayers: v })} />
            <Sep />
            <button className="lp-btn" onClick={() => void run('select.subject')}>
              Select Subject
            </button>
            <SelectAndMask />
          </>
        );
        break;
      case 'crop':
        body = (
          <>
            <Select
              value={o.crop.ratio}
              title="Ratio"
              options={[
                ['free', 'Ratio'],
                ['original', 'Original Ratio'],
                ['1:1', '1 : 1 (Square)'],
                ['4:5', '4 : 5 (8 : 10)'],
                ['5:7', '5 : 7'],
                ['2:3', '2 : 3 (4 : 6)'],
                ['16:9', '16 : 9'],
                ['9:16', '9 : 16'],
                ['custom', 'W × H'],
              ]}
              onChange={(v) => sel('crop')({ ratio: v })}
            />
            {o.crop.ratio === 'custom' && (
              <>
                <NumberField label="W" value={o.crop.w} min={0} max={30000} width={52} onChange={(v) => sel('crop')({ w: v })} />
                <NumberField label="H" value={o.crop.h} min={0} max={30000} width={52} onChange={(v) => sel('crop')({ h: v })} />
              </>
            )}
            <Sep />
            <button
              className="lp-btn"
              aria-pressed={o.crop.straighten}
              onClick={() => sel('crop')({ straighten: !o.crop.straighten })}
              title="Draw a line along what should be level"
            >
              Straighten
            </button>
            <Select
              title="Overlay"
              value={o.crop.overlay}
              options={[
                ['thirds', 'Rule of Thirds'],
                ['grid', 'Grid'],
                ['golden', 'Golden Ratio'],
                ['diagonal', 'Diagonal'],
                ['none', 'No Overlay'],
              ]}
              onChange={(v) => sel('crop')({ overlay: v })}
            />
            <Check label="Delete Cropped Pixels" checked={o.crop.deleteCropped} onChange={(v) => sel('crop')({ deleteCropped: v })} />
            <Check
              label="Content-Aware"
              checked={o.crop.contentAware}
              onChange={(v) => sel('crop')({ contentAware: v })}
              title="Fill new edges (from straightening or growing the canvas) from the picture"
            />
            {cropActive() && (
              <>
                <span style={{ flex: 1 }} />
                <CommitCancel onCommit={() => void commitCrop()} onCancel={() => cancelCrop()} />
              </>
            )}
          </>
        );
        break;
      case 'eyedropper':
      case 'colorSampler':
        body = (
          <>
            <Select
              label="Sample Size"
              value={o.eyedropper.sample}
              options={[
                [1, 'Point Sample'],
                [3, '3 by 3 Average'],
                [5, '5 by 5 Average'],
                [11, '11 by 11 Average'],
                [31, '31 by 31 Average'],
              ]}
              onChange={(v) => sel('eyedropper')({ sample: v })}
            />
            {tool === 'eyedropper' && (
              <Select
                label="Sample"
                value={o.eyedropper.from}
                options={[
                  ['all', 'All Layers'],
                  ['current', 'Current Layer'],
                ]}
                onChange={(v) => sel('eyedropper')({ from: v })}
              />
            )}
          </>
        );
        break;
      case 'ruler':
        body = (
          <>
            <RulerReadout />
            <button className="lp-btn" onClick={() => void run('image.straighten')}>
              Straighten Layer
            </button>
          </>
        );
        break;
      case 'brush':
      case 'pencil':
        {
          const k = tool === 'brush' ? 'brush' : 'pencil';
          const b = o[k];
          body = (
            <>
              <TipFields tip={b.tip} set={(t) => sel(k)({ tip: { ...b.tip, ...t } })} />
              <Sep />
              <Select
                label="Mode"
                value={b.mode}
                options={blendOptions([
                  ['behind', 'Behind'],
                  ['clear', 'Clear'],
                ])}
                onChange={(v) => sel(k)({ mode: v as PaintMode })}
              />
              <Pct label="Opacity" value={b.opacity} onChange={(v) => sel(k)({ opacity: v })} />
              {k === 'brush' && <Pct label="Flow" value={o.brush.flow} onChange={(v) => sel('brush')({ flow: v })} />}
              {k === 'brush' && <Check label="Airbrush" checked={o.brush.airbrush} onChange={(v) => sel('brush')({ airbrush: v })} />}
              {k === 'pencil' && <Check label="Auto Erase" checked={o.pencil.autoErase} onChange={(v) => sel('pencil')({ autoErase: v })} />}
              <Pct label="Smoothing" value={b.tip.smoothing} onChange={(v) => sel(k)({ tip: { ...b.tip, smoothing: v } })} />
              <Check label="Pressure for Size" checked={b.tip.pressureSize} onChange={(v) => sel(k)({ tip: { ...b.tip, pressureSize: v } })} />
            </>
          );
        }
        break;
      case 'eraser':
        body = (
          <>
            <TipFields tip={o.eraser.tip} set={(t) => sel('eraser')({ tip: { ...o.eraser.tip, ...t } })} />
            <Sep />
            <Select
              label="Mode"
              value={o.eraser.mode}
              options={[
                ['brush', 'Brush'],
                ['pencil', 'Pencil'],
                ['block', 'Block'],
              ]}
              onChange={(v) => sel('eraser')({ mode: v })}
            />
            <Pct label="Opacity" value={o.eraser.opacity} onChange={(v) => sel('eraser')({ opacity: v })} />
            <Pct label="Flow" value={o.eraser.flow} onChange={(v) => sel('eraser')({ flow: v })} />
            <Check label="Erase to History" checked={o.eraser.history} onChange={(v) => sel('eraser')({ history: v })} />
          </>
        );
        break;
      case 'bgEraser':
        body = (
          <>
            <TipFields tip={o.bgEraser.tip} set={(t) => sel('bgEraser')({ tip: { ...o.bgEraser.tip, ...t } })} />
            <Sep />
            <Select
              label="Limits"
              value={o.bgEraser.limits}
              options={[
                ['contiguous', 'Contiguous'],
                ['discontiguous', 'Discontiguous'],
              ]}
              onChange={(v) => sel('bgEraser')({ limits: v })}
            />
            <NumberField
              label="Tolerance"
              value={o.bgEraser.tolerance}
              min={0}
              max={100}
              suffix="%"
              width={44}
              onChange={(v) => sel('bgEraser')({ tolerance: v })}
            />
            <Check label="Protect Foreground Color" checked={o.bgEraser.protectFg} onChange={(v) => sel('bgEraser')({ protectFg: v })} />
          </>
        );
        break;
      case 'magicEraser':
        body = (
          <>
            <NumberField
              label="Tolerance"
              value={o.magicEraser.tolerance}
              min={0}
              max={255}
              width={44}
              onChange={(v) => sel('magicEraser')({ tolerance: v })}
            />
            <Check label="Anti-alias" checked={o.magicEraser.antialias} onChange={(v) => sel('magicEraser')({ antialias: v })} />
            <Check label="Contiguous" checked={o.magicEraser.contiguous} onChange={(v) => sel('magicEraser')({ contiguous: v })} />
            <Check label="Sample All Layers" checked={o.magicEraser.allLayers} onChange={(v) => sel('magicEraser')({ allLayers: v })} />
            <Pct label="Opacity" value={o.magicEraser.opacity} onChange={(v) => sel('magicEraser')({ opacity: v })} />
          </>
        );
        break;
      case 'mixer':
        body = (
          <>
            <TipFields tip={o.mixer.tip} set={(t) => sel('mixer')({ tip: { ...o.mixer.tip, ...t } })} />
            <Sep />
            <Pct label="Wet" value={o.mixer.wet} onChange={(v) => sel('mixer')({ wet: v })} />
            <Pct label="Load" value={o.mixer.load} onChange={(v) => sel('mixer')({ load: v })} />
            <Pct label="Mix" value={o.mixer.mix} onChange={(v) => sel('mixer')({ mix: v })} />
            <Pct label="Flow" value={o.mixer.flow} onChange={(v) => sel('mixer')({ flow: v })} />
            <Check label="Clean After Each Stroke" checked={o.mixer.clean} onChange={(v) => sel('mixer')({ clean: v })} />
            <Check label="Sample All Layers" checked={o.mixer.allLayers} onChange={(v) => sel('mixer')({ allLayers: v })} />
          </>
        );
        break;
      case 'colorReplace':
        body = (
          <>
            <TipFields tip={o.colorReplace.tip} set={(t) => sel('colorReplace')({ tip: { ...o.colorReplace.tip, ...t } })} />
            <Sep />
            <Select
              label="Mode"
              value={o.colorReplace.mode}
              options={[
                ['hue', 'Hue'],
                ['saturation', 'Saturation'],
                ['color', 'Color'],
                ['luminosity', 'Luminosity'],
              ]}
              onChange={(v) => sel('colorReplace')({ mode: v })}
            />
            <NumberField
              label="Tolerance"
              value={o.colorReplace.tolerance}
              min={0}
              max={100}
              suffix="%"
              width={44}
              onChange={(v) => sel('colorReplace')({ tolerance: v })}
            />
          </>
        );
        break;
      case 'clone':
        body = (
          <>
            <TipFields tip={o.clone.tip} set={(t) => sel('clone')({ tip: { ...o.clone.tip, ...t } })} />
            <Sep />
            <Select label="Mode" value={o.clone.mode} options={blendOptions()} onChange={(v) => sel('clone')({ mode: v as BlendMode })} />
            <Pct label="Opacity" value={o.clone.opacity} onChange={(v) => sel('clone')({ opacity: v })} />
            <Pct label="Flow" value={o.clone.flow} onChange={(v) => sel('clone')({ flow: v })} />
            <Check label="Aligned" checked={o.clone.aligned} onChange={(v) => sel('clone')({ aligned: v })} />
            <Select
              label="Sample"
              value={o.clone.sample}
              options={[
                ['current', 'Current Layer'],
                ['below', 'Current & Below'],
                ['all', 'All Layers'],
              ]}
              onChange={(v) => sel('clone')({ sample: v })}
            />
            <span className="lp-faint">Alt+click to set the source</span>
          </>
        );
        break;
      case 'patternStamp':
        body = (
          <>
            <TipFields tip={o.pattern.tip} set={(t) => sel('pattern')({ tip: { ...o.pattern.tip, ...t } })} />
            <Sep />
            <Pct label="Opacity" value={o.pattern.opacity} onChange={(v) => sel('pattern')({ opacity: v })} />
            <Pct label="Flow" value={o.pattern.flow} onChange={(v) => sel('pattern')({ flow: v })} />
            <Select
              label="Pattern"
              value={o.pattern.pattern}
              options={allPatterns().map((p) => [p.id, p.name] as [string, string])}
              onChange={(v) => sel('pattern')({ pattern: v })}
            />
            <Check label="Aligned" checked={o.pattern.aligned} onChange={(v) => sel('pattern')({ aligned: v })} />
          </>
        );
        break;
      case 'historyBrush':
        body = (
          <>
            <TipFields tip={o.history.tip} set={(t) => sel('history')({ tip: { ...o.history.tip, ...t } })} />
            <Sep />
            <Select label="Mode" value={o.history.mode} options={blendOptions()} onChange={(v) => sel('history')({ mode: v as BlendMode })} />
            <Pct label="Opacity" value={o.history.opacity} onChange={(v) => sel('history')({ opacity: v })} />
            <Pct label="Flow" value={o.history.flow} onChange={(v) => sel('history')({ flow: v })} />
            <span className="lp-faint">Paints from the state marked in the History panel</span>
          </>
        );
        break;
      case 'heal':
        body = (
          <>
            <TipFields tip={o.heal.tip} set={(t) => sel('heal')({ tip: { ...o.heal.tip, ...t } })} />
            <Sep />
            <Select
              label="Mode"
              value={o.heal.mode}
              options={[
                ['normal', 'Normal'],
                ['replace', 'Replace'],
                ['multiply', 'Multiply'],
                ['screen', 'Screen'],
                ['darken', 'Darken'],
                ['lighten', 'Lighten'],
              ]}
              onChange={(v) => sel('heal')({ mode: v })}
            />
            <Check label="Aligned" checked={o.heal.aligned} onChange={(v) => sel('heal')({ aligned: v })} />
            <Select
              label="Sample"
              value={o.heal.sample}
              options={[
                ['current', 'Current Layer'],
                ['all', 'All Layers'],
              ]}
              onChange={(v) => sel('heal')({ sample: v })}
            />
            <span className="lp-faint">Alt+click to set the source</span>
          </>
        );
        break;
      case 'spotHeal':
        body = (
          <>
            <TipFields tip={o.spot.tip} set={(t) => sel('spot')({ tip: { ...o.spot.tip, ...t } })} />
            <Sep />
            <Select
              label="Type"
              value={o.spot.type}
              options={[
                ['contentAware', 'Content-Aware'],
                ['proximity', 'Proximity Match'],
                ['texture', 'Create Texture'],
              ]}
              onChange={(v) => sel('spot')({ type: v })}
            />
            <Check label="Sample All Layers" checked={o.spot.allLayers} onChange={(v) => sel('spot')({ allLayers: v })} />
          </>
        );
        break;
      case 'removeTool':
        body = (
          <>
            <TipFields tip={o.remove.tip} set={(t) => sel('remove')({ tip: { ...o.remove.tip, ...t } })} />
            <Sep />
            <Check label="Sample All Layers" checked={o.remove.allLayers} onChange={(v) => sel('remove')({ allLayers: v })} />
            <span className="lp-faint">Paint over what should go; it is filled from around it</span>
          </>
        );
        break;
      case 'patch':
        body = (
          <>
            <Select
              label="Patch"
              value={o.patch.mode}
              options={[
                ['normal', 'Normal'],
                ['contentAware', 'Content-Aware'],
              ]}
              onChange={(v) => sel('patch')({ mode: v })}
            />
            {o.patch.mode === 'normal' && (
              <Seg
                label="Patch from"
                value={o.patch.source ? 'source' : 'dest'}
                options={[
                  { v: 'source', label: 'Source' },
                  { v: 'dest', label: 'Destination' },
                ]}
                onChange={(v) => sel('patch')({ source: v === 'source' })}
              />
            )}
            {o.patch.mode === 'contentAware' && (
              <NumberField label="Structure" value={o.patch.structure} min={1} max={7} width={36} onChange={(v) => sel('patch')({ structure: v })} />
            )}
          </>
        );
        break;
      case 'redEye':
        body = (
          <>
            <Pct label="Pupil Size" value={o.redEye.pupil} onChange={(v) => sel('redEye')({ pupil: v })} />
            <Pct label="Darken Amount" value={o.redEye.darken} onChange={(v) => sel('redEye')({ darken: v })} />
          </>
        );
        break;
      case 'gradient':
        body = (
          <>
            <Select
              label="Gradient"
              value={o.gradient.preset}
              options={GRADIENT_CHOICES.map((n, i) => [i, n] as [number, string])}
              onChange={(v) => sel('gradient')({ preset: v })}
            />
            <Seg
              label="Gradient style"
              value={o.gradient.style}
              options={[
                { v: 'linear', label: 'Linear' },
                { v: 'radial', label: 'Radial' },
                { v: 'angle', label: 'Angle' },
                { v: 'reflected', label: 'Reflected' },
                { v: 'diamond', label: 'Diamond' },
              ]}
              onChange={(v) => sel('gradient')({ style: v })}
            />
            <Sep />
            <Select label="Mode" value={o.gradient.mode} options={blendOptions()} onChange={(v) => sel('gradient')({ mode: v as BlendMode })} />
            <Pct label="Opacity" value={o.gradient.opacity} onChange={(v) => sel('gradient')({ opacity: v })} />
            <Check label="Reverse" checked={o.gradient.reverse} onChange={(v) => sel('gradient')({ reverse: v })} />
            <Check label="Dither" checked={o.gradient.dither} onChange={(v) => sel('gradient')({ dither: v })} />
            <Check
              label="As Gradient Layer"
              checked={o.gradient.asLayer}
              onChange={(v) => sel('gradient')({ asLayer: v })}
              title="Make an editable gradient fill layer instead of painting pixels"
            />
          </>
        );
        break;
      case 'bucket':
        body = (
          <>
            <Select
              value={o.bucket.source}
              title="Fill with"
              options={[
                ['fg', 'Foreground'],
                ['pattern', 'Pattern'],
              ]}
              onChange={(v) => sel('bucket')({ source: v })}
            />
            {o.bucket.source === 'pattern' && (
              <Select
                value={o.bucket.pattern}
                title="Pattern"
                options={allPatterns().map((p) => [p.id, p.name] as [string, string])}
                onChange={(v) => sel('bucket')({ pattern: v })}
              />
            )}
            <Select label="Mode" value={o.bucket.mode} options={blendOptions()} onChange={(v) => sel('bucket')({ mode: v as BlendMode })} />
            <Pct label="Opacity" value={o.bucket.opacity} onChange={(v) => sel('bucket')({ opacity: v })} />
            <NumberField label="Tolerance" value={o.bucket.tolerance} min={0} max={255} width={44} onChange={(v) => sel('bucket')({ tolerance: v })} />
            <Check label="Anti-alias" checked={o.bucket.antialias} onChange={(v) => sel('bucket')({ antialias: v })} />
            <Check label="Contiguous" checked={o.bucket.contiguous} onChange={(v) => sel('bucket')({ contiguous: v })} />
            <Check label="All Layers" checked={o.bucket.allLayers} onChange={(v) => sel('bucket')({ allLayers: v })} />
          </>
        );
        break;
      case 'blur':
      case 'sharpen':
      case 'smudge':
        body = (
          <>
            <TipFields tip={o.focus.tip} set={(t) => sel('focus')({ tip: { ...o.focus.tip, ...t } })} />
            <Sep />
            <Select label="Mode" value={o.focus.mode} options={blendOptions()} onChange={(v) => sel('focus')({ mode: v as BlendMode })} />
            <Pct label="Strength" value={o.focus.strength} onChange={(v) => sel('focus')({ strength: v })} />
            <Check label="Sample All Layers" checked={o.focus.allLayers} onChange={(v) => sel('focus')({ allLayers: v })} />
            {tool === 'sharpen' && <Check label="Protect Detail" checked={o.focus.protectDetail} onChange={(v) => sel('focus')({ protectDetail: v })} />}
            {tool === 'smudge' && <Check label="Finger Painting" checked={o.focus.fingerPainting} onChange={(v) => sel('focus')({ fingerPainting: v })} />}
          </>
        );
        break;
      case 'dodge':
      case 'burn':
      case 'sponge':
        body = (
          <>
            <TipFields tip={o.tone.tip} set={(t) => sel('tone')({ tip: { ...o.tone.tip, ...t } })} />
            <Sep />
            {tool === 'sponge' ? (
              <>
                <Select
                  label="Mode"
                  value={o.tone.sponge}
                  options={[
                    ['desaturate', 'Desaturate'],
                    ['saturate', 'Saturate'],
                  ]}
                  onChange={(v) => sel('tone')({ sponge: v })}
                />
                <Pct label="Flow" value={o.tone.flow} onChange={(v) => sel('tone')({ flow: v })} />
                <Check label="Vibrance" checked={o.tone.vibrance} onChange={(v) => sel('tone')({ vibrance: v })} />
              </>
            ) : (
              <>
                <Select
                  label="Range"
                  value={o.tone.range}
                  options={[
                    ['shadows', 'Shadows'],
                    ['midtones', 'Midtones'],
                    ['highlights', 'Highlights'],
                  ]}
                  onChange={(v) => sel('tone')({ range: v })}
                />
                <Pct label="Exposure" value={o.tone.exposure} onChange={(v) => sel('tone')({ exposure: v })} />
                <Check label="Protect Tones" checked={o.tone.protectTones} onChange={(v) => sel('tone')({ protectTones: v })} />
              </>
            )}
          </>
        );
        break;
      case 'pen':
      case 'freeformPen':
      case 'curvaturePen':
        body = (
          <>
            <Select
              value={o.pen.mode}
              title="Pen mode"
              options={[
                ['path', 'Path'],
                ['shape', 'Shape'],
              ]}
              onChange={(v) => sel('pen')({ mode: v })}
            />
            <Check label="Auto Add/Delete" checked={o.pen.autoAdd} onChange={(v) => sel('pen')({ autoAdd: v })} />
            <Check label="Rubber Band" checked={o.pen.rubberBand} onChange={(v) => sel('pen')({ rubberBand: v })} />
            <Sep />
            <PathButtons />
          </>
        );
        break;
      case 'pathSelect':
      case 'directSelect':
      case 'addAnchor':
      case 'deleteAnchor':
      case 'convertPoint':
        body = <PathButtons />;
        break;
      case 'type':
      case 'typeVertical':
        body = <TypeOptions />;
        break;
      case 'rect':
      case 'ellipse':
      case 'triangle':
      case 'polygon':
      case 'line':
      case 'customShape':
        body = (
          <>
            <Select
              value={o.shape.mode}
              title="Shape mode"
              options={[
                ['shape', 'Shape'],
                ['path', 'Path'],
                ['pixels', 'Pixels'],
              ]}
              onChange={(v) => sel('shape')({ mode: v })}
            />
            {o.shape.mode === 'shape' && (
              <>
                <span className="lp-opt">
                  <span>Fill</span>
                  {o.shape.fill ? (
                    <ColorWell color={o.shape.fill} title="Fill color" onClick={() => openDialog('colorPicker', { target: 'shapeFill' })} />
                  ) : (
                    <button className="lp-btn" onClick={() => sel('shape')({ fill: app.get().fg })}>
                      None
                    </button>
                  )}
                </span>
                <span className="lp-opt">
                  <span>Stroke</span>
                  {o.shape.stroke ? (
                    <ColorWell color={o.shape.stroke} title="Stroke color" onClick={() => openDialog('colorPicker', { target: 'shapeStroke' })} />
                  ) : (
                    <button className="lp-btn" onClick={() => sel('shape')({ stroke: app.get().fg })}>
                      None
                    </button>
                  )}
                </span>
                {o.shape.stroke && (
                  <NumberField
                    value={o.shape.strokeWidth}
                    min={0}
                    max={1000}
                    suffix="px"
                    width={40}
                    title="Stroke width"
                    onChange={(v) => sel('shape')({ strokeWidth: v })}
                  />
                )}
              </>
            )}
            {tool === 'rect' && (
              <NumberField label="Radius" value={o.shape.radius} min={0} max={5000} suffix="px" width={44} onChange={(v) => sel('shape')({ radius: v })} />
            )}
            {tool === 'polygon' && (
              <>
                <NumberField label="Sides" value={o.shape.sides} min={3} max={100} width={36} onChange={(v) => sel('shape')({ sides: v })} />
                <Pct label="Star Ratio" value={1 - o.shape.star} onChange={(v) => sel('shape')({ star: 1 - v })} />
              </>
            )}
            {tool === 'line' && (
              <NumberField
                label="Weight"
                value={o.shape.lineWeight}
                min={1}
                max={1000}
                suffix="px"
                width={44}
                onChange={(v) => sel('shape')({ lineWeight: v })}
              />
            )}
            {tool === 'customShape' && (
              <Select
                label="Shape"
                value={o.shape.custom}
                options={CUSTOM_SHAPES.map((c) => [c.id, c.name] as [string, string])}
                onChange={(v) => sel('shape')({ custom: v })}
              />
            )}
          </>
        );
        break;
      case 'hand':
      case 'zoom':
      case 'rotateView':
        body = (
          <>
            {tool === 'zoom' && <Check label="Scrubby Zoom" checked={o.zoom.scrubby} onChange={(v) => sel('zoom')({ scrubby: v })} />}
            <button className="lp-btn" onClick={() => void run('view.actual')}>
              100%
            </button>
            <button className="lp-btn" onClick={() => void run('view.fit')}>
              Fit Screen
            </button>
            {tool === 'rotateView' && (
              <button className="lp-btn" onClick={() => void run('view.resetRotation')}>
                Reset View
              </button>
            )}
          </>
        );
        break;
      case 'slice':
      case 'artboard':
      case 'perspectiveCrop':
        body = (
          <span className="lp-faint">
            {tool === 'perspectiveCrop'
              ? 'Click the four corners of what should become a rectangle, then press Enter.'
              : tool === 'slice'
                ? 'Drag to make a slice. File ▸ Export ▸ Slices to Files saves each one.'
                : 'Drag to make an artboard. File ▸ Export ▸ Artboards to Files saves each one.'}
          </span>
        );
        break;
    }

  return (
    <div className="lp-options" role="toolbar" aria-label="Tool options">
      <span className="lp-tool-name">
        <ToolIcon id={tool} size={16} />
      </span>
      {body ?? <span className="lp-faint">{def.name}</span>}
    </div>
  );
}

function RulerReadout() {
  useApp((s) => s.rev);
  const r = rulerInfo();
  if (!r) return <span className="lp-faint">Drag to measure a distance or an angle</span>;
  return (
    <span className="lp-opt" style={{ fontVariantNumeric: 'tabular-nums', gap: 12 }}>
      <span>W: {r.dx.toFixed(1)}</span>
      <span>H: {r.dy.toFixed(1)}</span>
      <span>A: {r.angle.toFixed(1)}°</span>
      <span>L: {r.length.toFixed(1)} px</span>
    </span>
  );
}

function PathButtons() {
  const s = current();
  const has = !!s?.doc.paths.length;
  return (
    <>
      <button className="lp-btn" disabled={!has} onClick={() => openPathPanel()}>
        Paths Panel
      </button>
    </>
  );
}

function openPathPanel() {
  window.dispatchEvent(new CustomEvent('lp-open-panel', { detail: 'paths' }));
}

function TypeOptions() {
  const o = useApp((s) => s.opts.type);
  const editing = isEditingText();
  const set = (patch: Partial<ToolOptions['type']>) => {
    setOpts('type', patch);
    if (editing) {
      if (patch.family !== undefined) applyCharStyle({ family: patch.family });
      if (patch.weight !== undefined) applyCharStyle({ weight: patch.weight });
      if (patch.italic !== undefined) applyCharStyle({ italic: patch.italic });
      if (patch.size !== undefined) applyCharStyle({ size: patch.size });
      if (patch.align !== undefined) applyParaStyle({ align: patch.align });
    }
    bump();
  };
  return (
    <>
      <Select title="Font" value={o.family} options={FONT_FAMILIES.map((f) => [f, f] as [string, string])} onChange={(v) => set({ family: v })} width={170} />
      <Select
        title="Weight"
        value={o.weight}
        options={[
          [300, 'Light'],
          [400, 'Regular'],
          [500, 'Medium'],
          [600, 'Semibold'],
          [700, 'Bold'],
          [900, 'Black'],
        ]}
        onChange={(v) => set({ weight: v })}
      />
      <button
        className="lp-icon-btn"
        aria-pressed={o.italic}
        title="Italic"
        aria-label="Italic"
        onClick={() => set({ italic: !o.italic })}
        style={{ fontStyle: 'italic', fontWeight: 600 }}
      >
        I
      </button>
      <NumberField value={o.size} min={1} max={5000} digits={1} suffix="px" width={52} title="Font size" onChange={(v) => set({ size: v })} />
      <Sep />
      <Seg
        label="Alignment"
        value={o.align}
        onChange={(v) => set({ align: v })}
        options={[
          { v: 'left', label: 'Left align', icon: <AlignLeft size={14} /> },
          { v: 'center', label: 'Center', icon: <AlignCenter size={14} /> },
          { v: 'right', label: 'Right align', icon: <AlignRight size={14} /> },
          { v: 'justify', label: 'Justify', icon: <AlignJustify size={14} /> },
        ]}
      />
      <span className="lp-opt">
        <span>Color</span>
        <ColorWell color={app.get().fg} title="Text color" onClick={() => openDialog('colorPicker', { target: 'text' })} />
      </span>
      <Sep />
      <button className="lp-btn" onClick={() => window.dispatchEvent(new CustomEvent('lp-open-panel', { detail: 'character' }))}>
        Character
      </button>
    </>
  );
}
