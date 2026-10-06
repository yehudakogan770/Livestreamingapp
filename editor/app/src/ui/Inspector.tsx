import { AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronUp, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { GENERATORS, timecode } from '../model/build';
import { valueAt } from '../model/anim';
import { setAngle, setTransition, updateMarker, removeMarker, withLinked } from '../model/edit';
import { effectDef, TRANSITIONS, type ParamDef } from '../model/effects';
import { allNodes, gradeOf } from '../model/grade';
import { current, end, mediaOf, rate } from '../model/seq';
import { NO_MOTION, type BlendMode, type Clip, type Effect, type Motion, type Param, type TextAnim, type TextData } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { fileName, inApp } from '../native';
import { TEXT_PRESETS } from '../render/text';
import { BUILTIN_LUTS } from '../render/luts';
import { TitleExtras } from './Templates';
import { BLEND_LIST } from '../model/blend';
import { ProMotionSections } from './ProMotion';
import type { Actions } from './actions';
import { Choice, ColorField, ParamRow, Scrub, Section } from './controls';
import { usePlayhead } from './hooks';
import type { Ui } from './state';
import { CaptionSection } from './Speech';
import { EffectExtras, TrackingSection } from './Tracking';

export const FONTS = [
  'Segoe UI',
  'Arial',
  'Arial Black',
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Franklin Gothic Medium',
  'Gabriola',
  'Georgia',
  'Impact',
  'Ink Free',
  'Lucida Console',
  'Palatino Linotype',
  'Segoe Print',
  'Segoe Script',
  'Sitka Text',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Bebas Neue',
  'Heebo',
  'Frank Ruhl Libre',
  'David Libre',
  'Great Vibes',
  'Chakra Petch',
];

const BLENDS = BLEND_LIST;

const ANIMS: [TextAnim, string][] = [
  ['none', 'None'],
  ['fade', 'Fade'],
  ['up', 'Rise'],
  ['down', 'Drop'],
  ['left', 'From the right'],
  ['right', 'From the left'],
  ['pop', 'Pop'],
  ['type', 'Typewriter'],
  ['blur', 'Blur'],
  ['wipe', 'Wipe'],
];

export function Inspector({ doc, engine, ui, actions }: { doc: Doc; engine: Engine; ui: Ui; actions: Actions }) {
  const { project, selection } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const t = usePlayhead(engine);
  const ids = selectedIds(selection);

  if (selection?.kind === 'marker') {
    const m = s.markers.find((x) => x.id === selection.id);
    if (!m) return null;
    return (
      <div className="insp">
        <h2 className="insp__title">Marker at {timecode(m.at, fps)}</h2>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="text"
            value={m.name}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => doc.edit((p) => updateMarker(p, m.id, { name: e.target.value }), 'Marker name', `mk-${m.id}`)}
          />
        </label>
        <div className="insp__row">
          <span className="field__label">Color</span>
          {['#5a8fd0', '#e0473b', '#d6a73a', '#3f8f5a', '#7a5bb0', '#d6d8dc'].map((c) => (
            <button
              key={c}
              type="button"
              className={`mswatch${m.color === c ? ' is-on' : ''}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => doc.edit((p) => updateMarker(p, m.id, { color: c }), 'Marker color')}
            />
          ))}
        </div>
        <button type="button" className="btn btn--sm" onClick={() => doc.edit((p) => removeMarker(p, m.id), 'Delete marker')}>
          Delete marker
        </button>
      </div>
    );
  }

  if (selection?.kind === 'transition') {
    const c = s.clips.find((x) => x.id === selection.clip);
    const tr = c ? (selection.side === 'in' ? c.tIn : c.tOut) : null;
    if (!c || !tr) return null;
    const isAudio = s.tracks.find((x) => x.id === c.track)?.kind === 'audio';
    const set = (change: Partial<typeof tr>, key?: string) => doc.edit((p) => setTransition(p, c.id, selection.side, { ...tr, ...change }), 'Transition', key);
    return (
      <div className="insp">
        <h2 className="insp__title">
          Transition {selection.side === 'in' ? 'into' : 'out of'} “{c.name}”
        </h2>
        <label className="field">
          <span className="field__label">Kind</span>
          <select className="text" value={tr.type} onChange={(e) => set({ type: e.target.value })}>
            {TRANSITIONS.filter((x) => x.kind === (isAudio ? 'audio' : 'video')).map((x) => (
              <option key={x.type} value={x.type}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <div className="insp__row">
          <span className="field__label">Length</span>
          <Scrub
            value={tr.length / fps}
            min={2 / fps}
            max={20}
            step={1 / fps}
            decimals={2}
            unit="s"
            label="Length"
            onChange={(v, final) => set({ length: Math.max(2, Math.round(v * fps)) }, final ? undefined : 'trlen')}
          />
        </div>
        <button type="button" className="btn btn--sm" onClick={() => doc.edit((p) => setTransition(p, c.id, selection.side, null), 'Delete transition')}>
          Delete transition
        </button>
      </div>
    );
  }

  const clips = s.clips.filter((c) => ids.includes(c.id));
  // The clip to show: a picture one first (its sound is shown under it).
  const isVideoClip = (c: Clip) => s.tracks.find((x) => x.id === c.track)?.kind === 'video';
  const main = clips.find(isVideoClip) ?? clips[0];
  if (!main)
    return (
      <div className="insp insp--empty">
        <h2 className="insp__title">Effect controls</h2>
        <p className="insp__note">Select a clip on the timeline to change it: where it sits in the picture, its size, color, effects, sound and speed.</p>
        <p className="insp__note">
          Sequence “{s.name}”: {s.width}×{s.height}, {s.fps} frames a second.{' '}
          <button type="button" className="linkbtn" onClick={() => ui.set({ dialog: 'sequence' })}>
            Change…
          </button>
        </p>
      </div>
    );
  const sound = isVideoClip(main) ? clips.find((c) => !isVideoClip(c) && c.link && c.link === main.link) : !isVideoClip(main) ? main : undefined;
  const local = Math.max(0, Math.min(main.length - 1, t - main.start));
  const seek = (f: number) => {
    engine.pause();
    engine.seek(f);
  };
  const upd = (c: Clip, label: string, f: (c: Clip) => Clip, final = true, key?: string) =>
    actions.update([c.id], label, f, final ? undefined : (key ?? label));
  const mediaName = mediaOf(project, main)?.name;

  return (
    <div className="insp">
      <div className="insp__head">
        <input
          className="insp__name"
          value={main.name}
          aria-label="Clip name"
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => actions.update([main.id], 'Rename clip', (c) => ({ ...c, name: e.target.value }), `name-${main.id}`)}
        />
        <span className="insp__meta">
          {timecode(main.start, fps)} – {timecode(end(main), fps)} · {(main.length / fps).toFixed(2)} s
          {mediaName && mediaName !== main.name ? ` · ${mediaName}` : ''}
          {clips.length > 1 ? ` · ${clips.length} clips selected` : ''}
        </span>
      </div>

      {main.source.kind === 'multicam' && <CameraPick doc={doc} clip={main} />}
      {main.source.kind === 'caption' && <CaptionSection doc={doc} engine={engine} ui={ui} clip={main} selected={clips} />}
      {main.source.kind === 'text' && (
        <TextEditor
          data={main.source.text}
          onChange={(text, final) =>
            upd(
              main,
              'Text',
              (c) => (c.source.kind === 'text' ? { ...c, name: text.text.split('\n')[0]?.trim() || 'Text', source: { ...c.source, text } } : c),
              final,
              `text-${main.id}`,
            )
          }
        />
      )}
      {main.source.kind === 'text' && (
        <Section title="Title design">
          <TitleExtras
            clip={main}
            fps={fps}
            onChange={(text, final) =>
              upd(main, 'Text', (c) => (c.source.kind === 'text' ? { ...c, source: { ...c.source, text } } : c), final, `text-${main.id}`)
            }
          />
        </Section>
      )}
      {main.source.kind === 'sequence' && (
        <Section title="Nested sequence">
          <p className="insp__note">This clip shows another sequence. Change what is inside by opening it.</p>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              const src = main.source;
              if (src.kind === 'sequence') doc.quiet((p) => ({ ...p, open: src.seq }));
            }}
          >
            Open the nested sequence
          </button>
        </Section>
      )}
      {main.source.kind === 'generator' && <GeneratorEditor clip={main} upd={upd} />}
      {main.source.kind === 'color' && (
        <Section title="Color">
          <ColorField
            value={main.source.color}
            label="Color"
            onChange={(color) =>
              upd(main, 'Color', (c) => (c.source.kind === 'color' ? { ...c, source: { kind: 'color', color } } : c), false, `color-${main.id}`)
            }
          />
        </Section>
      )}

      {isVideoClip(main) && main.source.kind !== 'adjustment' && main.source.kind !== 'caption' && (
        <MotionSection
          clip={main}
          local={local}
          onSeek={seek}
          onChange={(motion, final) => upd(main, 'Motion', (c) => ({ ...c, motion }), final, `motion-${main.id}`)}
        />
      )}
      {isVideoClip(main) && main.source.kind !== 'adjustment' && <TrackingSection doc={doc} engine={engine} clip={main} local={local} t={t} />}
      {isVideoClip(main) && main.source.kind === 'adjustment' && (
        <Section title="Adjustment layer">
          <p className="insp__note">Its effects change every track under it. Add effects from the Effects tab.</p>
          <ParamRow
            label="Opacity"
            param={main.motion.opacity}
            local={local}
            def={100}
            min={0}
            max={100}
            step={1}
            unit="%"
            clipStart={main.start}
            onSeek={seek}
            onChange={(p, final) => upd(main, 'Opacity', (c) => ({ ...c, motion: { ...c.motion, opacity: p } }), final, `op-${main.id}`)}
          />
        </Section>
      )}

      <ProMotionSections doc={doc} actions={actions} clip={main} local={local} isVideo={isVideoClip(main)} onSeek={seek} upd={upd} />

      {main.effects
        .filter((e) => effectDef(e.type)?.kind === 'video')
        .map((e) => (
          <EffectSection
            key={e.id}
            clip={main}
            effect={e}
            local={local}
            onSeek={seek}
            upd={upd}
            ui={ui}
            extra={<EffectExtras doc={doc} engine={engine} clip={main} effect={e} local={local} />}
          />
        ))}

      {(main.source.kind === 'media' || main.source.kind === 'multicam') && <SpeedSection clip={main} actions={actions} doc={doc} />}

      {sound && (
        <Section title={`Sound${sound !== main ? ` · ${s.tracks.find((x) => x.id === sound.track)?.name ?? ''}` : ''}`}>
          <ParamRow
            label="Volume"
            param={sound.gain}
            local={Math.max(0, Math.min(sound.length - 1, t - sound.start))}
            def={0}
            min={-60}
            max={12}
            step={0.5}
            unit="dB"
            clipStart={sound.start}
            onSeek={seek}
            onChange={(p, final) => upd(sound, 'Volume', (c) => ({ ...c, gain: p }), final, `gain-${sound.id}`)}
          />
          <ParamRow
            label="Pan"
            param={sound.pan}
            local={Math.max(0, Math.min(sound.length - 1, t - sound.start))}
            def={0}
            min={-100}
            max={100}
            step={1}
            clipStart={sound.start}
            onSeek={seek}
            onChange={(p, final) => upd(sound, 'Pan', (c) => ({ ...c, pan: p }), final, `pan-${sound.id}`)}
          />
          <div className="insp__row">
            {['eq', 'voice', 'compressor', 'denoise', 'voiceiso', 'dehum', 'loudnorm'].map((type) => (
              <button key={type} type="button" className="btn btn--sm" onClick={() => actions.addEffect([sound.id], type)}>
                + {effectDef(type)?.name}
              </button>
            ))}
          </div>
        </Section>
      )}
      {sound &&
        sound.effects
          .filter((e) => effectDef(e.type)?.kind === 'audio')
          .map((e) => (
            <EffectSection
              key={e.id}
              clip={sound}
              effect={e}
              local={Math.max(0, Math.min(sound.length - 1, t - sound.start))}
              onSeek={seek}
              upd={upd}
              ui={ui}
            />
          ))}
      <div className="insp__foot">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() =>
            actions.addEffect(
              clips.filter(isVideoClip).map((c) => c.id),
              'basic',
            )
          }
        >
          <Plus />
          Color correction
        </button>
        <button type="button" className="btn btn--sm" onClick={() => ui.set({ page: 'color' })}>
          Open the Color page
        </button>
      </div>
    </div>
  );
}

function CameraPick({ doc, clip }: { doc: Doc; clip: Clip }) {
  const { project } = useDoc(doc);
  const src = clip.source;
  if (src.kind !== 'multicam') return null;
  const g = project.groups.find((x) => x.id === src.group);
  return (
    <Section title="Camera">
      <div className="insp__cams">
        {g?.angles.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className={`insp__cam${src.angle === a.id ? ' is-on' : ''}`}
            onClick={() => doc.edit((p) => setAngle(p, clip.id, a.id), 'Change camera')}
          >
            <i style={{ background: a.color }} />
            {i + 1}. {a.name}
          </button>
        ))}
      </div>
      {g && (
        <div className="insp__row">
          <span className="field__label">Sync</span>
          {g.angles
            .filter((a) => a.id === src.angle)
            .map((a) => (
              <span key={a.id} className="insp__sync">
                <button type="button" className="btn btn--sm" title="This camera is a frame early" onClick={() => nudgeAngle(doc, g.id, a.id, -1 / 30)}>
                  <Minus />
                  Frame
                </button>
                <button type="button" className="btn btn--sm" title="This camera is a frame late" onClick={() => nudgeAngle(doc, g.id, a.id, 1 / 30)}>
                  <Plus />
                  Frame
                </button>
              </span>
            ))}
        </div>
      )}
      <p className="insp__note">If lips and sound don't match on this camera, move it a frame at a time.</p>
    </Section>
  );
}

function nudgeAngle(doc: Doc, group: string, angle: string, by: number) {
  doc.edit(
    (p) => ({
      ...p,
      groups: p.groups.map((g) => (g.id !== group ? g : { ...g, angles: g.angles.map((a) => (a.id === angle ? { ...a, offset: a.offset + by } : a)) })),
    }),
    'Camera sync',
  );
}

function MotionSection({
  clip,
  local,
  onSeek,
  onChange,
}: {
  clip: Clip;
  local: number;
  onSeek: (f: number) => void;
  onChange: (m: Motion, final: boolean) => void;
}) {
  const m = clip.motion;
  const row = (key: keyof Motion, label: string, def: number, min: number, max: number, step: number, unit?: string) => (
    <ParamRow
      key={key}
      label={label}
      param={m[key] as Param}
      local={local}
      def={def}
      min={min}
      max={max}
      step={step}
      unit={unit}
      clipStart={clip.start}
      onSeek={onSeek}
      onChange={(p, final) => onChange({ ...m, [key]: p }, final)}
    />
  );
  return (
    <Section
      title="Motion"
      actions={
        <button type="button" className="sect__btn" title="Back to how it was" onClick={() => onChange({ ...NO_MOTION }, true)}>
          <RotateCcw />
        </button>
      }
    >
      {row('x', 'Position ↔', 0, -4000, 4000, 1, 'px')}
      {row('y', 'Position ↕', 0, -4000, 4000, 1, 'px')}
      {row('scale', 'Scale', 100, 0, 1000, 0.5, '%')}
      {row('scaleX', 'Width', 100, 0, 1000, 0.5, '%')}
      {row('rotation', 'Rotation', 0, -720, 720, 0.5, '°')}
      {row('opacity', 'Opacity', 100, 0, 100, 1, '%')}
      <div className="insp__row">
        <span className="field__label">Blend</span>
        <select
          className="text text--sm"
          value={m.blend}
          aria-label="Blend mode"
          onChange={(e) => onChange({ ...m, blend: e.target.value as BlendMode }, true)}
        >
          {BLENDS.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <Choice
          value={m.fill ? 'fill' : 'fit'}
          options={[
            ['fit', 'Fit'],
            ['fill', 'Fill'],
          ]}
          onChange={(v) => onChange({ ...m, fill: v === 'fill' }, true)}
          label="Size to the frame"
        />
      </div>
      <Section title="3D" open={valueAt(m.rotX, 0) !== 0 || valueAt(m.rotY, 0) !== 0 || valueAt(m.z, 0) !== 0}>
        {row('rotX', 'Tilt ↕', 0, -180, 180, 0.5, '°')}
        {row('rotY', 'Turn ↔', 0, -180, 180, 0.5, '°')}
        {row('z', 'Depth', 0, -2000, 8000, 1, 'px')}
        <p className="insp__note">Tilt and turn the picture in space; Depth moves it nearer or farther.</p>
      </Section>
      <Section title="Crop" open={false}>
        {row('cropL', 'Left', 0, 0, 100, 0.5, '%')}
        {row('cropR', 'Right', 0, 0, 100, 0.5, '%')}
        {row('cropT', 'Top', 0, 0, 100, 0.5, '%')}
        {row('cropB', 'Bottom', 0, 0, 100, 0.5, '%')}
      </Section>
    </Section>
  );
}

function EffectSection({
  clip,
  effect,
  local,
  onSeek,
  upd,
  ui,
  extra,
}: {
  clip: Clip;
  effect: Effect;
  local: number;
  onSeek: (f: number) => void;
  upd: (c: Clip, label: string, f: (c: Clip) => Clip, final?: boolean, key?: string) => void;
  ui: Ui;
  /** More rows (tracking, AI masks, "Limit to"). */
  extra?: React.ReactNode;
}) {
  const def = effectDef(effect.type);
  if (!def) return null;
  const set = (change: Partial<Effect>, final = true) =>
    upd(clip, def.name, (c) => ({ ...c, effects: c.effects.map((e) => (e.id === effect.id ? { ...e, ...change } : e)) }), final, `fx-${effect.id}`);
  const move = (dir: -1 | 1) =>
    upd(clip, 'Effect order', (c) => {
      const list = [...c.effects];
      const i = list.findIndex((e) => e.id === effect.id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return c;
      [list[i], list[j]] = [list[j] as Effect, list[i] as Effect];
      return { ...c, effects: list };
    });
  const paramRow = (pd: ParamDef) => {
    if (pd.toggle || pd.options) {
      const v = typeof effect.p[pd.key] === 'number' ? (effect.p[pd.key] as number) : pd.def;
      return (
        <div key={pd.key} className="insp__row">
          <span className="field__label">{pd.label}</span>
          {pd.options ? (
            <Choice
              value={v}
              options={pd.options.map((o, i) => [i, o] as [number, string])}
              onChange={(x) => set({ p: { ...effect.p, [pd.key]: x } })}
              label={pd.label}
            />
          ) : (
            <input type="checkbox" checked={v > 0.5} aria-label={pd.label} onChange={(e) => set({ p: { ...effect.p, [pd.key]: e.target.checked ? 1 : 0 } })} />
          )}
        </div>
      );
    }
    return (
      <ParamRow
        key={pd.key}
        label={pd.label}
        param={effect.p[pd.key]}
        local={local}
        def={pd.def}
        min={pd.min}
        max={pd.max}
        step={pd.step}
        unit={pd.unit}
        clipStart={clip.start}
        onSeek={onSeek}
        keys={!pd.still}
        onChange={(p, final) => set({ p: { ...effect.p, [pd.key]: p } }, final)}
      />
    );
  };
  return (
    <Section
      title={
        <span className={effect.on ? '' : 'is-off'}>
          <input
            type="checkbox"
            checked={effect.on}
            aria-label={`${def.name} on`}
            title="On / off"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => set({ on: e.target.checked })}
          />{' '}
          {def.name}
        </span>
      }
      actions={
        <>
          <button type="button" className="sect__btn" title="Earlier" aria-label="Move up" onClick={() => move(-1)}>
            <ChevronUp />
          </button>
          <button type="button" className="sect__btn" title="Later" aria-label="Move down" onClick={() => move(1)}>
            <ChevronDown />
          </button>
          <button
            type="button"
            className="sect__btn"
            title="Remove this effect"
            aria-label={`Remove ${def.name}`}
            onClick={() => upd(clip, 'Remove effect', (c) => ({ ...c, effects: c.effects.filter((e) => e.id !== effect.id) }))}
          >
            <X />
          </button>
        </>
      }
    >
      {def.previewNote && <p className="insp__note">{def.previewNote}</p>}
      {effect.type === 'chromakey' && (
        <div className="insp__row">
          <span className="field__label">Key color</span>
          <ColorField
            value={typeof effect.d?.color === 'string' ? effect.d.color : '#00b140'}
            label="Key color"
            onChange={(color) => set({ d: { ...effect.d, color } }, false)}
          />
        </div>
      )}
      {effect.type === 'lut' && (
        <div className="insp__row">
          <button
            type="button"
            className="btn btn--sm"
            disabled={!inApp()}
            onClick={() =>
              void open({ title: 'Choose a LUT', filters: [{ name: 'LUT', extensions: ['cube'] }] }).then((path) => {
                if (typeof path === 'string') set({ d: { ...effect.d, path, name: fileName(path) } });
              })
            }
          >
            Choose .cube file…
          </button>
          <span className="insp__note">{typeof effect.d?.name === 'string' && effect.d.name ? effect.d.name : 'None yet'}</span>
        </div>
      )}
      {effect.type === 'lut' && (
        <label className="insp__row">
          <span className="insp__note">Camera log</span>
          <select
            className="text"
            aria-label="Built-in camera LUT"
            value={typeof effect.d?.path === 'string' && effect.d.path.startsWith('builtin:') ? effect.d.path : ''}
            onChange={(e) => {
              const lut = BUILTIN_LUTS.find((x) => x.path === e.target.value);
              if (lut) set({ d: { ...effect.d, path: lut.path, name: lut.name } });
            }}
          >
            <option value="">Built-in: choose a camera…</option>
            {BUILTIN_LUTS.map((x) => (
              <option key={x.id} value={x.path}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {effect.type === 'grade' && (
        <div className="insp__row">
          <span className="insp__note">{allNodes(gradeOf(effect)).length} node(s)</span>
          <button type="button" className="btn btn--sm" onClick={() => ui.set({ page: 'color' })}>
            Edit the nodes on the Color page
          </button>
        </div>
      )}
      {effect.type === 'curves' && (
        <button type="button" className="btn btn--sm" onClick={() => ui.set({ page: 'color' })}>
          Edit the curves on the Color page
        </button>
      )}
      {def.params.map(paramRow)}
      {extra}
    </Section>
  );
}

function SpeedSection({ clip, actions, doc }: { clip: Clip; actions: Actions; doc: Doc }) {
  const [ripple, setRipple] = useState(true);
  const s = current(doc.project);
  const fps = rate(s);
  return (
    <Section title="Speed" open={clip.speed !== 1 || clip.reverse}>
      <div className="insp__row">
        <span className="field__label">Speed</span>
        <Scrub
          value={clip.speed * 100}
          min={5}
          max={2000}
          step={1}
          unit="%"
          label="Speed"
          onChange={(v, final) => final && actions.speed(clip.id, v / 100, ripple)}
        />
        {[50, 100, 200].map((x) => (
          <button key={x} type="button" className="btn btn--sm" onClick={() => actions.speed(clip.id, x / 100, ripple)}>
            {x}%
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={clip.reverse} onChange={(e) => actions.speed(clip.id, clip.speed, ripple, e.target.checked)} /> Play backwards
      </label>
      <label className="check">
        <input type="checkbox" checked={ripple} onChange={(e) => setRipple(e.target.checked)} /> Move what follows (ripple)
      </label>
      <p className="insp__note">
        Length {(clip.length / fps).toFixed(2)} s. {withLinked(s, [clip.id]).length > 1 ? 'Its sound changes speed with it.' : ''}
      </p>
    </Section>
  );
}

function TextEditor({ data, onChange }: { data: TextData; onChange: (t: TextData, final: boolean) => void }) {
  const set = (change: Partial<TextData>, final = true) => onChange({ ...data, ...change }, final);
  return (
    <Section title="Text">
      <textarea
        className="text insp__words"
        rows={3}
        value={data.text}
        aria-label="Words"
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => set({ text: e.target.value }, false)}
      />
      <div className="insp__row">
        <select className="text text--sm" value={data.font} aria-label="Font" style={{ fontFamily: data.font }} onChange={(e) => set({ font: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
        <Scrub value={data.size} min={8} max={600} step={1} unit="px" label="Size" onChange={(v, final) => set({ size: v }, final)} />
      </div>
      <div className="insp__row">
        <Choice
          value={data.weight >= 700 ? 700 : data.weight >= 500 ? 500 : 400}
          options={[
            [400, 'Regular'],
            [500, 'Medium'],
            [700, 'Bold'],
          ]}
          onChange={(v) => set({ weight: v })}
          label="Weight"
        />
        <button
          type="button"
          className={`tbtn${data.italic ? ' is-on' : ''}`}
          aria-pressed={data.italic}
          title="Italic"
          onClick={() => set({ italic: !data.italic })}
        >
          <i>I</i>
        </button>
        <Choice
          value={data.align}
          options={[
            ['left', <AlignLeft key="l" />, 'Left'],
            ['center', <AlignCenter key="c" />, 'Center'],
            ['right', <AlignRight key="r" />, 'Right'],
          ]}
          onChange={(v) => set({ align: v })}
          label="Line up"
        />
      </div>
      <div className="insp__row">
        <span className="field__label">Color</span>
        <ColorField value={data.color} label="Text color" onChange={(color) => set({ color }, false)} />
      </div>
      <div className="insp__row">
        <span className="field__label">Place ↔</span>
        <Scrub value={data.px * 100} min={0} max={100} step={0.5} unit="%" label="Across" onChange={(v, final) => set({ px: v / 100 }, final)} />
        <span className="field__label">↕</span>
        <Scrub value={data.py * 100} min={0} max={100} step={0.5} unit="%" label="Down" onChange={(v, final) => set({ py: v / 100 }, final)} />
      </div>
      <div className="insp__row">
        <span className="field__label">Spacing</span>
        <Scrub value={data.tracking} min={-20} max={100} step={0.5} label="Letter spacing" onChange={(v, final) => set({ tracking: v }, final)} />
        <span className="field__label">Lines</span>
        <Scrub value={data.lineHeight} min={0.7} max={3} step={0.05} label="Line height" onChange={(v, final) => set({ lineHeight: v }, final)} />
      </div>
      <div className="insp__row">
        <span className="field__label">Outline</span>
        <Scrub value={data.stroke} min={0} max={30} step={0.5} unit="px" label="Outline" onChange={(v, final) => set({ stroke: v }, final)} />
        <ColorField value={data.strokeColor} label="Outline color" onChange={(strokeColor) => set({ strokeColor }, false)} />
      </div>
      <div className="insp__row">
        <span className="field__label">Shadow</span>
        <Scrub value={data.shadow} min={0} max={40} step={0.5} label="Shadow" onChange={(v, final) => set({ shadow: v }, final)} />
        <ColorField value={data.shadowColor} label="Shadow color" onChange={(shadowColor) => set({ shadowColor }, false)} />
      </div>
      <div className="insp__row">
        <label className="check">
          <input type="checkbox" checked={data.box} onChange={(e) => set({ box: e.target.checked })} /> Box behind
        </label>
        {data.box && (
          <>
            <ColorField value={data.boxColor} label="Box color" onChange={(boxColor) => set({ boxColor }, false)} />
            <Scrub value={data.boxOpacity} min={0} max={100} step={1} unit="%" label="Box opacity" onChange={(v, final) => set({ boxOpacity: v }, final)} />
          </>
        )}
      </div>
      <div className="insp__row">
        <span className="field__label">Comes on</span>
        <select className="text text--sm" value={data.animIn} aria-label="Comes on" onChange={(e) => set({ animIn: e.target.value as TextAnim })}>
          {ANIMS.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <span className="field__label">Goes off</span>
        <select className="text text--sm" value={data.animOut} aria-label="Goes off" onChange={(e) => set({ animOut: e.target.value as TextAnim })}>
          {ANIMS.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="insp__row">
        <span className="field__label">Style</span>
        {TEXT_PRESETS.map((p) => (
          <button key={p.name} type="button" className="btn btn--sm" onClick={() => set({ ...p.data, text: data.text })}>
            {p.name}
          </button>
        ))}
      </div>
    </Section>
  );
}

function GeneratorEditor({ clip, upd }: { clip: Clip; upd: (c: Clip, label: string, f: (c: Clip) => Clip, final?: boolean, key?: string) => void }) {
  const src = clip.source;
  if (src.kind !== 'generator') return null;
  const def = GENERATORS.find((g) => g.gen === src.gen);
  const st = src.settings;
  const set = (k: string, v: number | string, final = true) =>
    upd(
      clip,
      def?.name ?? 'Generator',
      (c) => (c.source.kind === 'generator' ? { ...c, source: { ...c.source, settings: { ...c.source.settings, [k]: v } } } : c),
      final,
      `gen-${clip.id}`,
    );
  const num = (k: string, d = 50) => (typeof st[k] === 'number' ? (st[k] as number) : d);
  const labels: Record<string, [string, string, string]> = {
    gradient: ['Direction', 'Middle', 'Softness'],
    noise: ['Size', 'Speed', 'Contrast'],
    particles: ['How many', 'Size', 'Speed'],
    lightleak: ['Strength', 'Size', 'Speed'],
  };
  const names = labels[src.gen];
  return (
    <Section title={def?.name ?? 'Generator'}>
      {def?.options && (
        <div className="insp__row">
          <Choice value={num('kind', 0)} options={def.options.map((o, i) => [i, o] as [number, string])} onChange={(v) => set('kind', v)} label="Kind" />
        </div>
      )}
      {src.gen !== 'bars' && (
        <div className="insp__row">
          <span className="field__label">Colors</span>
          <ColorField value={typeof st.color1 === 'string' ? st.color1 : '#000000'} label="First color" onChange={(v) => set('color1', v, false)} />
          <ColorField value={typeof st.color2 === 'string' ? st.color2 : '#ffffff'} label="Second color" onChange={(v) => set('color2', v, false)} />
        </div>
      )}
      {names &&
        (['a', 'b', 'c'] as const).map((k, i) => (
          <div key={k} className="insp__row">
            <span className="field__label" style={{ minWidth: 90 }}>
              {names[i]}
            </span>
            <input type="range" min={0} max={100} value={num(k)} aria-label={names[i]} onChange={(e) => set(k, Number(e.target.value), false)} />
            <Scrub value={num(k)} min={0} max={100} step={1} label={names[i]} onChange={(v, final) => set(k, v, final)} />
          </div>
        ))}
    </Section>
  );
}
