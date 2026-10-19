// The dialog that is open (one at a time), by kind, and the small ones.

import { useState } from 'react';
import { app, closeDialog, current, useApp, bump } from '../../app/state';
import { Dialog, OkCancel, NumberField, Select, Check } from '../fields';
import { NewDocDialog, ImageSizeDialog, CanvasSizeDialog } from './DocDialogs';
import { FillDialog, StrokeDialog, ContentAwareScaleDialog, ColorRangeDialog } from './EditDialogs';
import { FilterDialog, AdjustPixelsDialog } from './FilterDialog';
import { LayerStyleDialog } from './LayerStyleDialog';
import { ExportDialog } from './ExportDialog';
import { ColorPickerDialog, GradientEditorDialog } from './ColorDialogs';
import { ShortcutsDialog, PrefsDialog, PrintDialog, BatchDialog, AboutDialog } from './AppDialogs';
import { BrushSettings } from '../panels/BrushesPanel';
import * as sel from '../../app/ops/select';
import * as image from '../../app/ops/image';
import { PROFILES, profileById } from '../../core/color';
import { uid } from '../../core/layers';

type P = Record<string, unknown>;

export function Dialogs() {
  const d = useApp((s) => s.dialog);
  if (!d) return null;
  const p = (d.props ?? {}) as P;
  const close = () => closeDialog();
  switch (d.kind) {
    case 'confirm':
      return <ConfirmDialog p={p} />;
    case 'prompt':
      return <PromptDialog p={p} />;
    case 'newDoc':
      return <NewDocDialog onClose={close} fromClip={!!p.fromClip} />;
    case 'imageSize':
      return <ImageSizeDialog onClose={close} />;
    case 'canvasSize':
      return <CanvasSizeDialog onClose={close} />;
    case 'fill':
      return <FillDialog onClose={close} />;
    case 'stroke':
      return <StrokeDialog onClose={close} />;
    case 'contentAwareScale':
      return <ContentAwareScaleDialog onClose={close} />;
    case 'colorRange':
      return <ColorRangeDialog onClose={close} />;
    case 'filter':
      return <FilterDialog key={String(p.id)} id={String(p.id)} onClose={close} />;
    case 'adjustPixels':
      return <AdjustPixelsDialog type={p.type as never} onClose={close} />;
    case 'layerStyle':
      return <LayerStyleDialog onClose={close} tab={p.tab as string | undefined} />;
    case 'export':
      return <ExportDialog onClose={close} parts={p.parts as 'artboards' | 'slices' | undefined} />;
    case 'colorPicker':
      return <ColorPickerDialog p={p} onClose={close} />;
    case 'gradientEditor':
      return <GradientEditorDialog p={p} onClose={close} />;
    case 'shortcuts':
      return <ShortcutsDialog onClose={close} />;
    case 'prefs':
      return <PrefsDialog onClose={close} />;
    case 'print':
      return <PrintDialog onClose={close} />;
    case 'batch':
      return <BatchDialog onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'brushSettings':
      return (
        <Dialog title="Brush Settings" onClose={close} width={340} modal={false}>
          <BrushSettings />
        </Dialog>
      );
    case 'modifySelection':
      return <ModifyDialog kind={p.kind as 'border' | 'smooth' | 'expand' | 'contract' | 'feather'} onClose={close} />;
    case 'loadSelection':
      return <LoadSelectionDialog onClose={close} />;
    case 'newGuide':
      return <NewGuideDialog onClose={close} />;
    case 'trim':
      return <TrimDialog onClose={close} />;
    case 'profile':
      return <ProfileDialog mode={p.mode as 'assign' | 'convert'} onClose={close} />;
    case 'fileInfo':
      return <FileInfoDialog onClose={close} />;
    default:
      return null;
  }
}

function ConfirmDialog({ p }: { p: P }) {
  const buttons = p.buttons as string[];
  const resolve = p.resolve as (i: number | null) => void;
  const done = (i: number | null) => {
    closeDialog();
    resolve(i);
  };
  return (
    <Dialog
      title="Lumora Photo"
      onClose={() => done(null)}
      width={420}
      foot={
        <>
          {buttons.length > 2 && (
            <button className="lp-btn" onClick={() => done(1)}>
              {buttons[1]}
            </button>
          )}
          <span className="lp-spacer" />
          <button className="lp-btn" onClick={() => done(buttons.length - 1)}>
            {buttons[buttons.length - 1]}
          </button>
          <button className="lp-btn lp-primary" onClick={() => done(0)}>
            {buttons[0]}
          </button>
        </>
      }
    >
      {String(p.text)}
    </Dialog>
  );
}

function PromptDialog({ p }: { p: P }) {
  const [v, setV] = useState(String(p.value ?? ''));
  const ok = () => {
    closeDialog();
    void (p.ok as (v: string) => unknown)(v);
  };
  return (
    <Dialog title={String(p.title)} onClose={closeDialog} width={380} foot={<OkCancel onOk={ok} onCancel={closeDialog} />}>
      <input
        className="lp-input"
        style={{ width: '100%' }}
        value={v}
        inputMode={p.number ? 'decimal' : undefined}
        aria-label={String(p.title)}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') ok();
        }}
      />
    </Dialog>
  );
}

const MODIFY: Record<string, { title: string; label: string; def: number; max: number }> = {
  border: { title: 'Border Selection', label: 'Width', def: 10, max: 200 },
  smooth: { title: 'Smooth Selection', label: 'Sample Radius', def: 4, max: 500 },
  expand: { title: 'Expand Selection', label: 'Expand By', def: 4, max: 500 },
  contract: { title: 'Contract Selection', label: 'Contract By', def: 4, max: 500 },
  feather: { title: 'Feather Selection', label: 'Feather Radius', def: 5, max: 1000 },
};

function ModifyDialog({ kind, onClose }: { kind: keyof typeof MODIFY; onClose: () => void }) {
  const m = MODIFY[kind]!;
  const [v, setV] = useState(m.def);
  const ok = () => {
    onClose();
    void import('../../app/commands').then((c) => c.run('select.modifyBy', { kind, amount: v }));
  };
  return (
    <Dialog title={m.title} onClose={onClose} width={340} foot={<OkCancel onOk={ok} onCancel={onClose} />}>
      <div className="lp-form">
        <label>{m.label}</label>
        <NumberField value={v} min={kind === 'feather' ? 0.1 : 1} max={m.max} digits={kind === 'feather' ? 1 : 0} suffix="px" onChange={setV} />
      </div>
    </Dialog>
  );
}

function LoadSelectionDialog({ onClose }: { onClose: () => void }) {
  const s = current();
  const [ch, setCh] = useState(s?.doc.channels[0]?.id ?? '');
  const [op, setOp] = useState<'replace' | 'add' | 'subtract' | 'intersect'>('replace');
  const [inv, setInv] = useState(false);
  if (!s) return null;
  return (
    <Dialog
      title="Load Selection"
      onClose={onClose}
      width={380}
      foot={
        <OkCancel
          onOk={() => {
            onClose();
            sel.loadSelection(ch, op, inv);
          }}
          onCancel={onClose}
        />
      }
    >
      <div className="lp-form">
        <label>Channel</label>
        <Select value={ch} options={s.doc.channels.map((c) => [c.id, c.name] as [string, string])} onChange={setCh} />
        <label />
        <Check label="Invert" checked={inv} onChange={setInv} />
        <label>Operation</label>
        <Select
          value={op}
          options={[
            ['replace', 'New Selection'],
            ['add', 'Add to Selection'],
            ['subtract', 'Subtract from Selection'],
            ['intersect', 'Intersect with Selection'],
          ]}
          onChange={setOp}
        />
      </div>
    </Dialog>
  );
}

function NewGuideDialog({ onClose }: { onClose: () => void }) {
  const [axis, setAxis] = useState<'x' | 'y'>('y');
  const [at, setAt] = useState(0);
  return (
    <Dialog
      title="New Guide"
      onClose={onClose}
      width={320}
      foot={
        <OkCancel
          onOk={() => {
            const s = current();
            onClose();
            if (!s) return;
            s.commit('New Guide', 'guide', { ...s.doc, guides: [...s.doc.guides, { id: uid('g'), axis, at }] });
            bump();
          }}
          onCancel={onClose}
        />
      }
    >
      <div className="lp-form">
        <label>Orientation</label>
        <Select
          value={axis}
          options={[
            ['y', 'Horizontal'],
            ['x', 'Vertical'],
          ]}
          onChange={setAxis}
        />
        <label>Position</label>
        <NumberField value={at} min={-30000} max={30000} suffix="px" onChange={setAt} />
      </div>
    </Dialog>
  );
}

function TrimDialog({ onClose }: { onClose: () => void }) {
  const [based, setBased] = useState<'transparent' | 'topLeft' | 'bottomRight'>('transparent');
  return (
    <Dialog
      title="Trim"
      onClose={onClose}
      width={340}
      foot={
        <OkCancel
          onOk={() => {
            onClose();
            image.trim(based);
          }}
          onCancel={onClose}
        />
      }
    >
      <div className="lp-form">
        <label>Based On</label>
        <Select
          value={based}
          options={[
            ['transparent', 'Transparent Pixels'],
            ['topLeft', 'Top Left Pixel Color'],
            ['bottomRight', 'Bottom Right Pixel Color'],
          ]}
          onChange={setBased}
        />
      </div>
    </Dialog>
  );
}

function ProfileDialog({ mode, onClose }: { mode: 'assign' | 'convert'; onClose: () => void }) {
  const s = current();
  const [id, setId] = useState(s?.doc.profile.id ?? 'srgb');
  if (!s) return null;
  return (
    <Dialog
      title={mode === 'assign' ? 'Assign Profile' : 'Convert to Profile'}
      onClose={onClose}
      width={420}
      foot={
        <OkCancel
          onOk={() => {
            onClose();
            if (mode === 'assign') image.assignProfile(profileById(id));
            else image.convertProfile(profileById(id));
          }}
          onCancel={onClose}
        />
      }
    >
      <div className="lp-form">
        <label>Current</label>
        <span>{s.doc.profile.name}</span>
        <label>{mode === 'assign' ? 'Profile' : 'Destination'}</label>
        <Select value={id} options={PROFILES.map((p) => [p.id, p.name] as [string, string])} onChange={setId} />
      </div>
      <p className="lp-note" style={{ marginBottom: 0 }}>
        {mode === 'assign' ? 'Assigning keeps the numbers and changes how they look.' : 'Converting keeps the look and changes the numbers (relative colorimetric).'}
      </p>
    </Dialog>
  );
}

function FileInfoDialog({ onClose }: { onClose: () => void }) {
  const s = current();
  const [meta, setMeta] = useState<Record<string, string>>({ title: '', author: '', copyright: '', description: '', ...(s?.doc.meta ?? {}) });
  if (!s) return null;
  const field = (k: string, label: string, area = false) => (
    <>
      <label>{label}</label>
      {area ? (
        <textarea className="lp-input" style={{ height: 70, padding: 6 }} value={meta[k] ?? ''} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      ) : (
        <input className="lp-input" value={meta[k] ?? ''} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      )}
    </>
  );
  return (
    <Dialog
      title={`File Info: ${s.doc.name}`}
      onClose={onClose}
      width={480}
      foot={
        <OkCancel
          onOk={() => {
            onClose();
            s.commit('File Info', 'info', { ...s.doc, meta });
            bump();
          }}
          onCancel={onClose}
        />
      }
    >
      <div className="lp-form" style={{ gridTemplateColumns: '90px 1fr' }}>
        {field('title', 'Title')}
        {field('author', 'Author')}
        {field('copyright', 'Copyright')}
        {field('description', 'Description', true)}
      </div>
    </Dialog>
  );
}

export { app };
