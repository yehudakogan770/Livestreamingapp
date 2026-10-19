// Character and Paragraph: type settings for the selected characters while
// typing, or for the whole active type layer.

import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react';
import { current, useApp, setOpts, openDialog } from '../../app/state';
import { applyCharStyle, applyParaStyle, setTextModel } from '../../app/tools/typeTool';
import { defaultChar, defaultPara, type CharStyle, type ParaStyle } from '../../core/text';
import { NumberField, Select, Check, Seg, ColorWell } from '../fields';
import { FONT_FAMILIES } from '../fonts';

function useStyle(): { c: CharStyle; p: ParaStyle; layer: boolean } {
  useApp((s) => s.rev);
  const o = useApp((s) => s.opts.type);
  const l = current()?.activeLayer();
  if (l?.kind === 'text') return { c: { ...l.text.base, ...(l.text.runs[0]?.style ?? {}) }, p: l.text.para, layer: true };
  return { c: { ...defaultChar(), family: o.family, weight: o.weight, italic: o.italic, size: o.size }, p: { ...defaultPara(), align: o.align }, layer: false };
}

export function CharacterPanel() {
  const { c, layer } = useStyle();
  const set = (patch: Partial<CharStyle>) => {
    if (layer) applyCharStyle(patch);
    const t: Record<string, unknown> = {};
    if (patch.family !== undefined) t.family = patch.family;
    if (patch.weight !== undefined) t.weight = patch.weight;
    if (patch.italic !== undefined) t.italic = patch.italic;
    if (patch.size !== undefined) t.size = patch.size;
    if (Object.keys(t).length) setOpts('type', t);
  };
  return (
    <div className="lp-panel">
      <div className="lp-panel-row">
        <Select value={c.family} options={FONT_FAMILIES.map((f) => [f, f] as [string, string])} onChange={(v) => set({ family: v })} title="Font" width={180} />
      </div>
      <div className="lp-panel-row">
        <Select
          title="Weight"
          value={c.weight}
          options={[
            [100, 'Thin'],
            [300, 'Light'],
            [400, 'Regular'],
            [500, 'Medium'],
            [600, 'Semibold'],
            [700, 'Bold'],
            [800, 'Extra Bold'],
            [900, 'Black'],
          ]}
          onChange={(v) => set({ weight: v })}
        />
        <Check label="Italic" checked={c.italic} onChange={(v) => set({ italic: v })} />
      </div>
      <div className="lp-panel-row">
        <NumberField label="Size" value={c.size} min={1} max={5000} digits={1} suffix="px" width={52} onChange={(v) => set({ size: v })} />
        <NumberField
          label="Leading"
          value={c.leading}
          min={0}
          max={5000}
          digits={1}
          width={48}
          onChange={(v) => set({ leading: v })}
          title="Line height (0: auto)"
        />
      </div>
      <div className="lp-panel-row">
        <NumberField label="Tracking" value={c.tracking} min={-1000} max={10000} width={48} onChange={(v) => set({ tracking: v })} />
        <NumberField
          label="Baseline"
          value={c.baselineShift}
          min={-1000}
          max={1000}
          digits={1}
          suffix="px"
          width={44}
          onChange={(v) => set({ baselineShift: v })}
        />
      </div>
      <div className="lp-panel-row">
        <NumberField label="Horizontal" value={c.hScale} min={1} max={1000} suffix="%" width={44} onChange={(v) => set({ hScale: v })} />
        <NumberField label="Vertical" value={c.vScale} min={1} max={1000} suffix="%" width={44} onChange={(v) => set({ vScale: v })} />
      </div>
      <div className="lp-panel-row">
        <span className="lp-label">Color</span>
        <ColorWell
          color={c.color}
          title="Text color"
          onClick={() => openDialog('colorPicker', { color: c.color, onPick: (col: [number, number, number]) => set({ color: col }) })}
        />
      </div>
      <div className="lp-panel-row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Check label="Faux Bold" checked={c.fauxBold} onChange={(v) => set({ fauxBold: v })} />
        <Check label="Faux Italic" checked={c.fauxItalic} onChange={(v) => set({ fauxItalic: v })} />
        <Check label="Underline" checked={c.underline} onChange={(v) => set({ underline: v })} />
        <Check label="Strikethrough" checked={c.strike} onChange={(v) => set({ strike: v })} />
      </div>
      <div className="lp-panel-row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Select
          title="Capitals"
          value={c.caps}
          options={[
            ['normal', 'Normal case'],
            ['all', 'All Caps'],
            ['small', 'Small Caps'],
          ]}
          onChange={(v) => set({ caps: v })}
        />
        <Check label="Ligatures" checked={c.ligatures} onChange={(v) => set({ ligatures: v })} />
        <Check label="Kerning" checked={c.kerning} onChange={(v) => set({ kerning: v })} />
      </div>
      <div className="lp-panel-row">
        <Select
          label="Figures"
          value={c.features}
          options={[
            ['', 'Default'],
            ['"onum"', 'Old-style'],
            ['"tnum"', 'Tabular'],
            ['"lnum"', 'Lining'],
            ['"frac"', 'Fractions'],
          ]}
          onChange={(v) => set({ features: v })}
        />
      </div>
      {layer && <AntiAlias />}
    </div>
  );
}

function AntiAlias() {
  const l = current()?.activeLayer();
  if (l?.kind !== 'text') return null;
  return (
    <div className="lp-panel-row">
      <Select
        label="Anti-aliasing"
        value={l.text.antialias}
        options={[
          ['none', 'None'],
          ['sharp', 'Sharp'],
          ['smooth', 'Smooth'],
        ]}
        onChange={(v) => setTextModel(l.id, { ...l.text, antialias: v }, 'Anti-aliasing')}
      />
    </div>
  );
}

export function ParagraphPanel() {
  const { p, layer } = useStyle();
  const set = (patch: Partial<ParaStyle>) => {
    if (layer) applyParaStyle(patch);
    if (patch.align) setOpts('type', { align: patch.align });
  };
  return (
    <div className="lp-panel">
      <div className="lp-panel-row">
        <Seg
          label="Alignment"
          value={p.align}
          onChange={(v) => set({ align: v })}
          options={[
            { v: 'left', label: 'Left align', icon: <AlignLeft size={14} /> },
            { v: 'center', label: 'Center', icon: <AlignCenter size={14} /> },
            { v: 'right', label: 'Right align', icon: <AlignRight size={14} /> },
            { v: 'justify', label: 'Justify', icon: <AlignJustify size={14} /> },
          ]}
        />
      </div>
      <div className="lp-panel-row">
        <NumberField label="Indent Left" value={p.indentLeft} min={0} max={5000} suffix="px" width={44} onChange={(v) => set({ indentLeft: v })} />
        <NumberField label="Right" value={p.indentRight} min={0} max={5000} suffix="px" width={44} onChange={(v) => set({ indentRight: v })} />
      </div>
      <div className="lp-panel-row">
        <NumberField label="First Line" value={p.indentFirst} min={-5000} max={5000} suffix="px" width={44} onChange={(v) => set({ indentFirst: v })} />
      </div>
      <div className="lp-panel-row">
        <NumberField label="Space Before" value={p.spaceBefore} min={0} max={5000} suffix="px" width={44} onChange={(v) => set({ spaceBefore: v })} />
        <NumberField label="After" value={p.spaceAfter} min={0} max={5000} suffix="px" width={44} onChange={(v) => set({ spaceAfter: v })} />
      </div>
      <div className="lp-panel-row">
        <Select
          label="Direction"
          value={p.direction}
          options={[
            ['ltr', 'Left to Right'],
            ['rtl', 'Right to Left'],
          ]}
          onChange={(v) => set({ direction: v })}
        />
      </div>
      {!layer && <div className="lp-note">These settings apply to new type. Select a type layer to change it.</div>}
    </div>
  );
}
