// The side panels: the composition's settings, the template's fields and
// the operator panel, the event look, data sources, the project's
// compositions and files, and the library of templates and saved titles.

import { useEffect, useRef, useState } from 'react';
import { Copy, Film, Image as ImageIcon, Layers as LayersIcon, Music, Plus, Star, Trash2, Upload, Package } from 'lucide-react';
import { DEFAULT_TOKENS, TOKEN_KEYS, TOKEN_LABELS, keyFrom, tokensFor, usedVariables, valuesFor } from '../core/binding';
import { newComposition, newImage, newVideo, uid } from '../core/build';
import type { BrowserEnv } from '../core/browserEnv';
import { readSource, valuesFromRow, type Table } from '../core/data';
import { renderFrame, type Ctx } from '../core/render';
import { CATEGORIES, fromTemplate, starterTemplates } from '../core/templates';
import { cleanMarkers } from '../core/timeline';
import { FORMAT_PRESETS, formatsOf, makeFormat } from '../core/formats';
import type { Asset, BrandTokens, DataSource, TitleProject, Variable, VariableType } from '../core/types';
import { ControlPanel } from './ControlPanel';
import { ColorField, NumberField, Row, Section, Select, Toggle } from './fields';
import { CUE_MIXES, CUE_MIX_NAMES, cueMixes } from '../core/cues';
import type { Host, LibraryEntry } from './host';
import { addLayers, compOf, updateComp } from './ops';
import { PackDialog } from './PackDialog';
import { parseClock } from '../core/timer';
import type { Store } from './store';
import { useStore } from './store';

const SIZES: [string, number, number][] = [
  ['HD 1920 × 1080', 1920, 1080],
  ['HD 1280 × 720', 1280, 720],
  ['4K 3840 × 2160', 3840, 2160],
  ['Vertical 1080 × 1920', 1080, 1920],
  ['Square 1080 × 1080', 1080, 1080],
];

/** The title in other shapes (9:16 for vertical streams, 1:1, 4K): made from the main composition by the layers' constraints. */
function FormatsSection({ store }: { store: Store }) {
  const project = useStore(store, (s) => s.project);
  const compId = useStore(store, (s) => s.compId);
  const list = formatsOf(project);
  const main = list[0];
  if (!main) return null;
  const current = list.find((c) => c.id === compId);
  const has = (w: number, h: number) => list.some((c) => c.width === w && c.height === h);
  return (
    <Section title="Formats" open={list.length > 1}>
      <div className="tt-dim tt-small">
        The title in other shapes. On air, Lumora and Studio use the one closest to the picture&rsquo;s shape (a vertical stream gets the 9:16 one).
      </div>
      <ul className="tt-formats">
        {list.map((c) => (
          <li key={c.id} className={c.id === compId ? 'on' : ''}>
            <button onClick={() => store.set({ compId: c.id, selection: [] })} title="Open this format">
              {c.id === main.id ? `${c.name} (main)` : c.name}
            </button>
            <span className="tt-dim">
              {c.width} × {c.height}
            </span>
            {c.id !== main.id && (
              <>
                <label className="tt-check" title="Changes to the main composition come here too (what you change in this format stays)">
                  <input
                    type="checkbox"
                    checked={c.follow !== false}
                    aria-label={`${c.name} follows the main composition`}
                    onChange={(e) =>
                      store.edit(e.target.checked ? 'Format follows the main one' : 'Format on its own', (p) => ({
                        ...p,
                        compositions: p.compositions.map((x) => (x.id === c.id ? { ...x, follow: e.target.checked } : x)),
                      }))
                    }
                  />
                  Follows
                </label>
                <button
                  className="tt-link"
                  title="Make it again from the main composition (changes made in this format are lost)"
                  onClick={() => {
                    if (!confirm(`Make “${c.name}” again from the main composition? Changes made in it are lost.`)) return;
                    store.edit('Reset format', (p) => {
                      const r = makeFormat(p, '', c.width, c.height, c.id).project;
                      return { ...r, compositions: r.compositions.map((x) => (x.id === c.id ? { ...x, follow: c.follow } : x)) };
                    });
                  }}
                >
                  Reset
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <Row label="Add">
        <select
          className="tt-select"
          aria-label="Add a format"
          value=""
          onChange={(e) => {
            const f = FORMAT_PRESETS.find((x) => x.name === e.target.value);
            if (!f) return;
            const r = makeFormat(store.get().project, f.name, f.w, f.h);
            store.edit(`Add ${f.name} format`, () => r.project, { compId: r.id, selection: [] });
          }}
        >
          <option value="">Make a format…</option>
          {FORMAT_PRESETS.filter((f) => !has(f.w, f.h)).map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} ({f.w} × {f.h})
            </option>
          ))}
        </select>
      </Row>
      {current && current.id !== main.id && (
        <div className="tt-dim tt-small">
          {current.follow === false
            ? 'This format stands on its own: changes to the main composition do not come here.'
            : 'Changes to the main composition come here too, placed by each layer’s constraints. What you change in this format stays as you set it.'}
        </div>
      )}
    </Section>
  );
}

export function CompositionPanel({ store }: { store: Store }) {
  const project = useStore(store, (s) => s.project);
  const compId = useStore(store, (s) => s.compId);
  const c = compOf(project, compId);
  const upd = (label: string, fn: (x: typeof c) => typeof c) => store.edit(label, (p) => updateComp(p, c.id, fn));
  const sizeKey = SIZES.find(([, w, h]) => w === c.width && h === c.height)?.[0] ?? 'custom';
  return (
    <div className="tt-inspector">
      <Section title="Composition">
        <Row label="Name">
          <input
            className="tt-input"
            value={c.name}
            onChange={(e) => upd('Rename composition', (x) => ({ ...x, name: e.target.value }))}
            aria-label="Composition name"
          />
        </Row>
        <Row label="Size">
          <select
            className="tt-select"
            aria-label="Composition size"
            value={sizeKey}
            onChange={(e) => {
              const s = SIZES.find(([n]) => n === e.target.value);
              if (s) upd('Composition size', (x) => ({ ...x, width: s[1], height: s[2] }));
            }}
          >
            {SIZES.map(([n]) => (
              <option key={n}>{n}</option>
            ))}
            {sizeKey === 'custom' && <option value="custom">Custom</option>}
          </select>
        </Row>
        <Row label="">
          <NumberField
            value={c.width}
            min={16}
            max={8192}
            label="Width"
            unit="px"
            onChange={(width) => upd('Composition size', (x) => ({ ...x, width: Math.round(width) }))}
          />
          <NumberField
            value={c.height}
            min={16}
            max={8192}
            label="Height"
            unit="px"
            onChange={(height) => upd('Composition size', (x) => ({ ...x, height: Math.round(height) }))}
          />
        </Row>
        <Row label="Frame rate">
          <Select
            label="Frame rate"
            value={String(c.fps)}
            options={[
              ['24', '24'],
              ['25', '25'],
              ['29.97', '29.97'],
              ['30', '30'],
              ['50', '50'],
              ['59.94', '59.94'],
              ['60', '60'],
            ]}
            onChange={(v) => upd('Frame rate', (x) => ({ ...x, fps: Number(v) }))}
          />
        </Row>
        <Row label="Camera" hint="For 3D layers: how far the camera is from the picture (nearer: stronger perspective)">
          <NumberField
            value={c.perspective ?? 2000}
            step={50}
            min={200}
            max={20000}
            label="Camera distance"
            unit="px"
            onChange={(perspective) => upd('Camera distance', (x) => ({ ...x, perspective: Math.round(perspective) }))}
          />
        </Row>
        <Row label="Length">
          <NumberField
            value={c.duration}
            step={0.1}
            min={0.1}
            max={3600}
            label="Length"
            unit="s"
            onChange={(duration) =>
              upd('Length', (x) => ({
                ...x,
                duration,
                markers: cleanMarkers({ ...x.markers, outStart: x.markers.outStart + (duration - x.duration) }, duration),
              }))
            }
          />
        </Row>
        <Row label="Background">
          <Select
            label="Background"
            value={c.background ? 'color' : 'none'}
            options={[
              ['none', 'See-through (over pictures)'],
              ['color', 'A color'],
            ]}
            onChange={(v) => upd('Background', (x) => ({ ...x, background: v === 'none' ? null : '$box' }))}
          />
        </Row>
        {c.background && (
          <Row label="">
            <ColorField
              value={c.background}
              onChange={(background) => upd('Background', (x) => ({ ...x, background }))}
              tokens={tokensFor(project, undefined)}
              values={valuesFor(project, {})}
              label="Background"
            />
          </Row>
        )}
      </Section>
      <Section title="IN, HOLD and OUT">
        <div className="tt-dim tt-small">
          The IN plays when the graphic is taken, then it holds (repeating the loop, if any) until it is taken off and the OUT plays.
        </div>
        <Row label="IN ends">
          <NumberField
            value={c.markers.inEnd}
            step={1 / c.fps}
            min={0}
            max={c.duration}
            label="IN ends"
            unit="s"
            onChange={(inEnd) => upd('IN marker', (x) => ({ ...x, markers: cleanMarkers({ ...x.markers, inEnd }, x.duration) }))}
          />
        </Row>
        <Row label="OUT starts">
          <NumberField
            value={c.markers.outStart}
            step={1 / c.fps}
            min={0}
            max={c.duration}
            label="OUT starts"
            unit="s"
            onChange={(outStart) => upd('OUT marker', (x) => ({ ...x, markers: cleanMarkers({ ...x.markers, outStart }, x.duration) }))}
          />
        </Row>
        {c.markers.loop && (
          <Row label="Loop">
            <NumberField
              value={c.markers.loop.start}
              step={1 / c.fps}
              label="Loop start"
              unit="s"
              onChange={(start) =>
                upd('Loop', (x) => ({ ...x, markers: cleanMarkers({ ...x.markers, loop: { start, end: x.markers.loop!.end } }, x.duration) }))
              }
            />
            <NumberField
              value={c.markers.loop.end}
              step={1 / c.fps}
              label="Loop end"
              unit="s"
              onChange={(end) =>
                upd('Loop', (x) => ({ ...x, markers: cleanMarkers({ ...x.markers, loop: { start: x.markers.loop!.start, end } }, x.duration) }))
              }
            />
          </Row>
        )}
      </Section>
      <Section title="Cue markers" open={c.cues.length > 0}>
        {c.cues.map((q, i) => (
          <Row key={q.id} label={`${q.t.toFixed(2)} s`}>
            <input
              className="tt-input"
              value={q.name}
              aria-label="Cue name"
              onChange={(e) => upd('Rename cue', (x) => ({ ...x, cues: x.cues.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))}
            />
            <select
              className="tt-select"
              aria-label="Cue sound"
              value={q.sound ?? ''}
              onChange={(e) => upd('Cue sound', (x) => ({ ...x, cues: x.cues.map((y, j) => (j === i ? { ...y, sound: e.target.value || null } : y)) }))}
            >
              <option value="">No sound</option>
              {project.assets
                .filter((a) => a.kind === 'audio')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
            {q.sound && (
              <span className="tt-cue-mixes" role="group" aria-label={`${q.name}: where it is heard`}>
                {CUE_MIXES.map((m) => (
                  <Toggle
                    key={m}
                    label={CUE_MIX_NAMES[m]}
                    value={cueMixes(q).includes(m)}
                    onChange={(on) =>
                      upd('Cue mixes', (x) => ({
                        ...x,
                        cues: x.cues.map((y, j) => (j === i ? { ...y, mixes: CUE_MIXES.filter((k) => (k === m ? on : cueMixes(y).includes(k))) } : y)),
                      }))
                    }
                  />
                ))}
                <NumberField
                  value={q.gain ?? 0}
                  min={-60}
                  max={12}
                  step={1}
                  unit="dB"
                  label="Cue loudness"
                  onChange={(gain) => upd('Cue loudness', (x) => ({ ...x, cues: x.cues.map((y, j) => (j === i ? { ...y, gain } : y)) }))}
                />
              </span>
            )}
          </Row>
        ))}
        <div className="tt-dim tt-small">
          Add cues from the timeline. A cue with a sound plays it when the graphic reaches it: on air in Lumora (on the mixes ticked), in Studio exports, and in
          this preview and its films.
        </div>
      </Section>
      <FormatsSection store={store} />
    </div>
  );
}

const VAR_TYPES: [VariableType, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['color', 'Color'],
  ['image', 'Picture'],
  ['list', 'List'],
  ['timer', 'Timer (clock, countdown)'],
];

/** Where Lumora can fill a field from (Lumora sets these on air). */
export const BINDINGS: [string, string][] = [
  ['', 'Typed by the operator'],
  ['score:homeName', 'Scoreboard: home team'],
  ['score:homeShort', 'Scoreboard: home short name'],
  ['score:home', 'Scoreboard: home score'],
  ['score:homeColor', 'Scoreboard: home color'],
  ['score:awayName', 'Scoreboard: away team'],
  ['score:awayShort', 'Scoreboard: away short name'],
  ['score:away', 'Scoreboard: away score'],
  ['score:awayColor', 'Scoreboard: away color'],
  ['score:clock', 'Scoreboard: game clock'],
  ['score:period', 'Scoreboard: period'],
  ['countdown', 'Countdown: time left'],
  ['clock:time', 'Time of day'],
  ['clock:date', 'Date'],
  ['event:name', 'Event name'],
  ['data:', 'Data file column…'],
];

export function FieldsPanel({ store, host }: { store: Store; host: Host }) {
  const project = useStore(store, (s) => s.project);
  const values = useStore(store, (s) => s.values);
  const vars = project.variables;
  const used = usedVariables(project);
  const missing = used.filter((k) => !vars.some((v) => v.key === k));
  const upd = (label: string, fn: (v: Variable[]) => Variable[]) => store.edit(label, (p) => ({ ...p, variables: fn(p.variables) }));
  const set = (i: number, patch: Partial<Variable>) => upd('Change field', (vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="tt-inspector">
      <Section title="Fields">
        <div className="tt-dim tt-small">Write {'{{name}}'} in any text, color or picture to make it a field the operator fills in.</div>
        {vars.map((v, i) => (
          <div key={v.key} className="tt-subcard">
            <Row label="Label">
              <input className="tt-input" value={v.label} aria-label="Field label" onChange={(e) => set(i, { label: e.target.value })} />
              <button className="tt-ico" aria-label={`Remove field ${v.label}`} onClick={() => upd('Remove field', (vs) => vs.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </button>
            </Row>
            <Row label="Name">
              <code className="tt-code">{`{{${v.key}}}`}</code>
              <Select
                label="Field kind"
                value={v.type}
                options={VAR_TYPES}
                onChange={(type) => set(i, type === 'timer' ? { type, timer: v.timer ?? { dir: 'down', format: 'm:ss' }, value: /^[\d:.]+$/.test(v.value) ? v.value : '10:00' } : { type })}
              />
            </Row>
            <Row label="Sample">
              {v.type === 'list' ? (
                <textarea className="tt-textarea" rows={3} aria-label="Sample value" value={v.value} onChange={(e) => set(i, { value: e.target.value })} />
              ) : (
                <input
                  className="tt-input"
                  aria-label="Sample value"
                  value={v.value.startsWith('data:') ? '(picture)' : v.value}
                  onChange={(e) => set(i, { value: e.target.value })}
                  disabled={v.value.startsWith('data:')}
                />
              )}
              {v.type === 'image' && (
                <button
                  className="tt-btn"
                  onClick={async () => {
                    const [f] = await host.pickFiles('image');
                    if (f) set(i, { value: f.src });
                  }}
                >
                  Choose…
                </button>
              )}
            </Row>
            <Row label="Choices" hint="Offered to the operator (one a line); leave empty to type freely">
              <textarea
                className="tt-textarea"
                rows={2}
                aria-label="Choices"
                value={(v.options ?? []).join('\n')}
                onChange={(e) => set(i, { options: e.target.value.split('\n').filter((x) => x.trim()) })}
              />
            </Row>
            {v.type === 'number' && (
              <Row label="Format">
                <input
                  className="tt-input short"
                  aria-label="Before the number"
                  placeholder="Before"
                  value={v.prefix ?? ''}
                  onChange={(e) => set(i, { prefix: e.target.value })}
                />
                <NumberField value={v.decimals ?? 0} min={0} max={6} label="Decimals" onChange={(d) => set(i, { decimals: Math.round(d) })} />
                <input
                  className="tt-input short"
                  aria-label="After the number"
                  placeholder="After"
                  value={v.suffix ?? ''}
                  onChange={(e) => set(i, { suffix: e.target.value })}
                />
              </Row>
            )}
            {v.type === 'timer' && (
              <>
                <Row label="Runs" hint="The sample is where it starts (10:00, 45:00, 0:00)">
                  <Select
                    label="Timer direction"
                    value={v.timer?.dir ?? 'down'}
                    options={[
                      ['down', 'Down (countdown)'],
                      ['up', 'Up (stopwatch, game clock)'],
                    ]}
                    onChange={(dir) => set(i, { timer: { ...(v.timer ?? { dir }), dir } })}
                  />
                  <Select
                    label="Timer shows"
                    value={v.timer?.format ?? 'm:ss'}
                    options={[
                      ['m:ss', '9:05'],
                      ['mm:ss', '09:05'],
                      ['h:mm:ss', '1:09:05'],
                      ['ss', '545'],
                      ['m:ss.t', '9:05.3'],
                      ['ss.t', '24.3 (shot clock)'],
                    ]}
                    onChange={(format) => set(i, { timer: { ...(v.timer ?? { dir: 'down' }), format } })}
                  />
                </Row>
                <Row label="Stops at" hint="Empty: a countdown stops at 0, a clock counting up runs on">
                  <input
                    className="tt-input short"
                    aria-label="Timer stops at"
                    placeholder={v.timer?.dir === 'up' ? '(runs on)' : '0:00'}
                    defaultValue={v.timer?.stop !== undefined ? String(v.timer.stop) : ''}
                    onBlur={(e) => {
                      const n = parseClock(e.target.value);
                      set(i, { timer: { ...(v.timer ?? { dir: 'down' }), stop: Number.isFinite(n) ? n : undefined } });
                    }}
                  />
                  <Toggle value={!!v.timer?.auto} onChange={(auto) => set(i, { timer: { ...(v.timer ?? { dir: 'down' }), auto } })} label="Starts when taken" />
                </Row>
              </>
            )}
            {v.type === 'list' && (
              <Row label="On one line" hint="For a ticker: what goes between the items">
                <input
                  className="tt-input"
                  aria-label="Separator"
                  placeholder="(one item a line)"
                  value={v.separator ?? ''}
                  onChange={(e) => set(i, { separator: e.target.value || undefined })}
                />
              </Row>
            )}
            <Row label="In Lumora">
              <select
                className="tt-select"
                aria-label="Filled from"
                value={v.bind?.startsWith('data:') ? 'data:' : (v.bind ?? '')}
                onChange={(e) => set(i, { bind: e.target.value ? (e.target.value === 'data:' ? `data:${v.label}` : e.target.value) : undefined })}
              >
                {BINDINGS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              {v.bind?.startsWith('data:') && (
                <input className="tt-input" aria-label="Data column" value={v.bind.slice(5)} onChange={(e) => set(i, { bind: `data:${e.target.value}` })} />
              )}
            </Row>
            <Row label="Group">
              <input
                className="tt-input"
                aria-label="Group in the control panel"
                placeholder="(none)"
                value={v.group ?? ''}
                onChange={(e) => set(i, { group: e.target.value || undefined })}
              />
            </Row>
          </div>
        ))}
        {missing.length > 0 && (
          <button
            className="tt-btn"
            onClick={() =>
              upd('Add fields', (vs) => [
                ...vs,
                ...missing.map((k) => ({ key: k, label: k.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase()), type: 'text' as const, value: '' })),
              ])
            }
          >
            Add the fields used in the graphic: {missing.join(', ')}
          </button>
        )}
        <NewField
          onAdd={(label, type) =>
            upd('Add field', (vs) => [
              ...vs,
              { key: uniqueKey(keyFrom(label), vs), label, type, value: type === 'number' ? '0' : type === 'color' ? '#ffffff' : '' },
            ])
          }
        />
      </Section>
      <Section title="Control panel preview">
        <div className="tt-dim tt-small">What the operator sees in Lumora. Changes here only preview; the samples above are saved.</div>
        <ControlPanel project={project} values={valuesFor(project, values)} onChange={(k, v) => store.set((s) => ({ values: { ...s.values, [k]: v } }))} />
        {Object.keys(values).length > 0 && (
          <button className="tt-link" onClick={() => store.set({ values: {} })}>
            Back to the sample values
          </button>
        )}
      </Section>
    </div>
  );
}

function uniqueKey(k: string, vs: Variable[]) {
  let key = k;
  for (let n = 2; vs.some((v) => v.key === key); n++) key = `${k}_${n}`;
  return key;
}

function NewField({ onAdd }: { onAdd: (label: string, type: VariableType) => void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<VariableType>('text');
  return (
    <Row label="New field">
      <input className="tt-input" placeholder="Label, e.g. Guest name" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="New field label" />
      <Select label="New field kind" value={type} options={VAR_TYPES} onChange={setType} />
      <button
        className="tt-btn"
        disabled={!label.trim()}
        onClick={() => {
          onAdd(label.trim(), type);
          setLabel('');
        }}
      >
        Add
      </button>
    </Row>
  );
}

const LOOKS: { name: string; tokens: Partial<BrandTokens> }[] = [
  { name: 'Neutral', tokens: {} },
  { name: 'Light', tokens: { box: '#f4f4f2', boxAlt: '#dedfdc', text: '#141414', textSub: '#44474c', accent: '#c8372d', accentText: '#ffffff' } },
  { name: 'Navy', tokens: { box: '#0f1b2d', boxAlt: '#1d2c44', accent: '#e3b341', accentText: '#141414' } },
  { name: 'Forest', tokens: { box: '#13201a', boxAlt: '#21342a', accent: '#d9d9d2', accentText: '#13201a' } },
  { name: 'Graphite and amber', tokens: { box: '#1b1b1b', boxAlt: '#2b2b2b', accent: '#e39b2d', accentText: '#141414' } },
];

export function LookPanel({ store, host }: { store: Store; host: Host }) {
  const project = useStore(store, (s) => s.project);
  const brand = useStore(store, (s) => s.brand);
  const tokens = project.tokens;
  const set = (k: keyof BrandTokens, v: string) => store.edit('Change look', (p) => ({ ...p, tokens: { ...p.tokens, [k]: v } }));
  const fonts = project.assets.filter((a) => a.kind === 'font');
  return (
    <div className="tt-inspector">
      <Section title="Look">
        <div className="tt-dim tt-small">
          Graphics use these as $accent, $box… In Lumora the event&rsquo;s look takes their place, so one template fits every event.
        </div>
        <div className="tt-chips">
          {LOOKS.map((l) => (
            <button
              key={l.name}
              className="tt-chip"
              onClick={() => store.edit(`Look: ${l.name}`, (p) => ({ ...p, tokens: { ...DEFAULT_TOKENS, ...l.tokens } }))}
            >
              {l.name}
            </button>
          ))}
        </div>
        {TOKEN_KEYS.map((k) =>
          k.startsWith('font') ? (
            <Row key={k} label={TOKEN_LABELS[k]}>
              <input className="tt-input" list="tt-fonts" value={tokens[k]} onChange={(e) => set(k, e.target.value)} aria-label={TOKEN_LABELS[k]} />
            </Row>
          ) : (
            <Row key={k} label={TOKEN_LABELS[k]}>
              <span className="tt-color">
                <input type="color" aria-label={TOKEN_LABELS[k]} value={tokens[k].slice(0, 7)} onChange={(e) => set(k, e.target.value)} />
                <input className="tt-hex" aria-label={`${TOKEN_LABELS[k]} value`} value={tokens[k]} onChange={(e) => set(k, e.target.value)} />
              </span>
            </Row>
          ),
        )}
      </Section>
      {brand && (
        <Section title="Event look preview">
          <div className="tt-dim tt-small">Shown with the event&rsquo;s look from {host.kind === 'studio' ? 'Lumora Studio' : 'Lumora'}.</div>
          <button className="tt-link" onClick={() => store.set({ brand: null })}>
            Show the template&rsquo;s own look
          </button>
        </Section>
      )}
      <Section title="Fonts">
        <div className="tt-dim tt-small">Fonts added here travel inside the .lumtitle file.</div>
        {fonts.map((f) => (
          <Row key={f.id} label={f.family ?? f.name}>
            <span className="tt-dim">{f.name}</span>
            <button
              className="tt-ico"
              aria-label={`Remove font ${f.name}`}
              onClick={() => store.edit('Remove font', (p) => ({ ...p, assets: p.assets.filter((a) => a.id !== f.id) }))}
            >
              <Trash2 size={13} />
            </button>
          </Row>
        ))}
        <button
          className="tt-btn"
          onClick={async () => {
            const files = await host.pickFiles('font');
            if (!files.length) return;
            const added: Asset[] = files.map((f) => ({
              id: uid('f'),
              name: f.name,
              kind: 'font',
              src: f.src,
              family: f.name
                .replace(/\.(ttf|otf|woff2?)$/i, '')
                .replace(/[-_]+/g, ' ')
                .trim(),
            }));
            store.edit('Add font', (p) => ({ ...p, assets: [...p.assets, ...added] }));
          }}
        >
          <Upload size={13} /> Add font files…
        </button>
      </Section>
    </div>
  );
}

export function DataPanel({ store }: { store: Store }) {
  const project = useStore(store, (s) => s.project);
  const [tables, setTables] = useState<Record<string, Table | string>>({});
  const list = project.data ?? [];
  const upd = (label: string, fn: (d: DataSource[]) => DataSource[]) => store.edit(label, (p) => ({ ...p, data: fn(p.data ?? []) }));
  const keys = project.variables.map((v) => v.key);
  const read = async (src: DataSource) => {
    try {
      const t = await readSource(src);
      setTables((x) => ({ ...x, [src.id]: t }));
      store.set((s) => ({ values: { ...s.values, ...valuesFromRow(src, t, keys, store.get().project.variables) } }));
    } catch (e) {
      setTables((x) => ({ ...x, [src.id]: e instanceof Error ? e.message : 'It could not be read.' }));
    }
  };
  // Read again every few seconds while open.
  const listRef = useRef(list);
  listRef.current = list;
  useEffect(() => {
    const id = setInterval(() => {
      for (const s of listRef.current) if (s.refresh > 0 && s.url) void read(s);
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="tt-inspector">
      <Section title="Data sources">
        <div className="tt-dim tt-small">
          A CSV file, a Google Sheet (shared with anyone with the link) or a JSON address. Columns named like a field fill it.
        </div>
        {list.map((src, i) => {
          const t = tables[src.id];
          return (
            <div key={src.id} className="tt-subcard">
              <Row label="Name">
                <input
                  className="tt-input"
                  value={src.name}
                  aria-label="Source name"
                  onChange={(e) => upd('Rename source', (d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <button className="tt-ico" aria-label="Remove source" onClick={() => upd('Remove source', (d) => d.filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </button>
              </Row>
              <Row label="Kind">
                <Select
                  label="Source kind"
                  value={src.kind}
                  options={[
                    ['sheet', 'Google Sheet'],
                    ['csv', 'CSV address'],
                    ['json', 'JSON address'],
                  ]}
                  onChange={(kind) => upd('Source kind', (d) => d.map((x, j) => (j === i ? { ...x, kind } : x)))}
                />
              </Row>
              <Row label="Address">
                <input
                  className="tt-input"
                  value={src.url}
                  aria-label="Address"
                  placeholder="https://…"
                  onChange={(e) => upd('Source address', (d) => d.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                />
              </Row>
              <Row label="Row">
                <NumberField
                  value={src.row + 1}
                  min={1}
                  label="Row"
                  onChange={(r) => upd('Source row', (d) => d.map((x, j) => (j === i ? { ...x, row: Math.max(0, Math.round(r) - 1) } : x)))}
                />
                <NumberField
                  value={src.refresh}
                  min={0}
                  label="Read every (seconds, 0: once)"
                  unit="s"
                  onChange={(refresh) => upd('Source refresh', (d) => d.map((x, j) => (j === i ? { ...x, refresh } : x)))}
                />
                <button className="tt-btn" onClick={() => void read(src)} disabled={!src.url}>
                  Read now
                </button>
              </Row>
              {typeof t === 'string' && <div className="tt-error">{t}</div>}
              {t && typeof t !== 'string' && (
                <div className="tt-dim tt-small">
                  {t.rows.length} rows; columns: {t.headers.join(', ')}
                </div>
              )}
            </div>
          );
        })}
        <button
          className="tt-btn"
          onClick={() =>
            upd('Add data source', (d) => [...d, { id: uid('d'), name: `Source ${d.length + 1}`, kind: 'sheet', url: '', refresh: 10, row: 0, map: {} }])
          }
        >
          <Plus size={13} /> Add a data source
        </button>
      </Section>
    </div>
  );
}

/** A small picture of a project (its main composition at the end of IN). */
export function Thumb({ project, env, width = 192, at }: { project: TitleProject; env: BrowserEnv; width?: number; at?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const c = compOf(project, project.main);
  const height = Math.round((width * c.height) / c.width);
  useEffect(() => {
    const draw = () => {
      const cv = ref.current;
      const ctx = cv?.getContext('2d') as Ctx | null;
      if (!cv || !ctx) return;
      const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
      cv.width = width * dpr;
      cv.height = height * dpr;
      ctx.fillStyle = '#5d6168';
      ctx.fillRect(0, 0, cv.width, cv.height);
      try {
        renderFrame(ctx, project, { time: at ?? c.markers.inEnd + 0.4, clock: 3, env, width: cv.width, height: cv.height });
      } catch {
        /* nothing drawn */
      }
    };
    draw();
    return env.onReady(draw);
  }, [project, env, width, height, at, c.markers.inEnd]);
  return <canvas ref={ref} className="tt-thumb" style={{ width, height }} aria-hidden />;
}

export function ProjectPanel({ store, host }: { store: Store; host: Host }) {
  const project = useStore(store, (s) => s.project);
  const compId = useStore(store, (s) => s.compId);
  const c = compOf(project, compId);
  const addAssets = async (kind: 'image' | 'video' | 'audio' | 'sequence') => {
    const files = await host.pickFiles(kind);
    if (!files.length) return;
    if (kind === 'sequence') {
      const a: Asset = {
        id: uid('a'),
        name: `${files[0]!.name.replace(/\d+\.\w+$/, '')} sequence`,
        kind: 'sequence',
        src: files[0]!.src,
        frames: files.map((f) => f.src),
        fps: c.fps,
      };
      store.edit('Add image sequence', (p) => ({ ...p, assets: [...p.assets, a] }));
      return;
    }
    const added: Asset[] = await Promise.all(
      files.map(async (f) => {
        const isSvg = /\.svg$/i.test(f.name) || f.src.startsWith('data:image/svg');
        const size = kind === 'image' ? await imageSize(f.src, host) : null;
        return {
          id: uid('a'),
          name: f.name,
          kind: kind === 'image' ? (isSvg ? 'svg' : 'image') : kind,
          src: f.src,
          ...(size ? { width: size[0], height: size[1] } : {}),
        } as Asset;
      }),
    );
    store.edit('Add files', (p) => ({ ...p, assets: [...p.assets, ...added] }));
  };
  const place = (a: Asset) => {
    const s = store.get();
    const cc = compOf(s.project, s.compId);
    const w = Math.min(a.width ?? 400, cc.width * 0.5);
    const h = a.width && a.height ? (w * a.height) / a.width : 300;
    const l =
      a.kind === 'video' || a.kind === 'sequence'
        ? newVideo(cc, a.id, [cc.width, cc.height], a.name)
        : newImage(cc, a.id, [Math.round(w), Math.round(h)], [Math.round((cc.width - w) / 2), Math.round((cc.height - h) / 2)], a.name);
    l.end = cc.duration;
    store.edit('Place file', (p) => addLayers(p, cc.id, [l], s.selection[0] ?? null), { selection: [l.id] });
  };
  return (
    <div className="tt-side-list">
      <div className="tt-side-head">
        Compositions
        <button
          className="tt-ico"
          aria-label="New composition"
          title="New composition"
          onClick={() => {
            const n = newComposition(`Composition ${project.compositions.length + 1}`, c.width, c.height, c.fps, c.duration);
            store.edit('New composition', (p) => ({ ...p, compositions: [...p.compositions, n] }), { compId: n.id, selection: [] });
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      {project.compositions.map((x) => (
        <div key={x.id} className={`tt-side-item${x.id === compId ? ' on' : ''}`} onClick={() => store.set({ compId: x.id, selection: [], keys: [] })}>
          <Film size={13} />
          <span className="tt-grow">{x.name}</span>
          {x.id === project.main ? (
            <span className="tt-badge" title="Played on air">
              Main
            </span>
          ) : (
            <button
              className="tt-ico"
              title="Play this one on air"
              aria-label={`Make ${x.name} the main composition`}
              onClick={(e) => (e.stopPropagation(), store.edit('Main composition', (p) => ({ ...p, main: x.id })))}
            >
              <Star size={12} />
            </button>
          )}
          <button
            className="tt-ico"
            aria-label={`Duplicate ${x.name}`}
            onClick={(e) => {
              e.stopPropagation();
              const copy = { ...JSON.parse(JSON.stringify(x)), id: uid('c'), name: `${x.name} copy` } as typeof x;
              store.edit('Duplicate composition', (p) => ({ ...p, compositions: [...p.compositions, copy] }));
            }}
          >
            <Copy size={12} />
          </button>
          {project.compositions.length > 1 && x.id !== project.main && (
            <button
              className="tt-ico"
              aria-label={`Delete ${x.name}`}
              onClick={(e) => {
                e.stopPropagation();
                store.edit('Delete composition', (p) => ({ ...p, compositions: p.compositions.filter((y) => y.id !== x.id) }), {
                  compId: x.id === compId ? project.main : compId,
                });
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}
      <div className="tt-side-head">
        Files
        <span className="tt-grow" />
        <button className="tt-ico" title="Add pictures or SVG logos" aria-label="Add pictures" onClick={() => void addAssets('image')}>
          <ImageIcon size={14} />
        </button>
        <button
          className="tt-ico"
          title="Add videos (WebM with alpha, MP4, ProRes 4444 .mov in the desktop app)"
          aria-label="Add videos"
          onClick={() => void addAssets('video')}
        >
          <Film size={14} />
        </button>
        <button
          className="tt-ico"
          title="Add an image sequence (choose all its frames)"
          aria-label="Add image sequence"
          onClick={() => void addAssets('sequence')}
        >
          <LayersIcon size={14} />
        </button>
        <button className="tt-ico" title="Add sounds (for cue markers)" aria-label="Add sounds" onClick={() => void addAssets('audio')}>
          <Music size={14} />
        </button>
      </div>
      {project.assets.length === 0 && (
        <div className="tt-dim tt-small tt-pad">Pictures, SVG logos, videos, image sequences, sounds and fonts used by this title.</div>
      )}
      {project.assets.map((a) => (
        <div
          key={a.id}
          className="tt-side-item"
          onDoubleClick={() => a.kind !== 'font' && a.kind !== 'audio' && place(a)}
          title={a.kind === 'font' || a.kind === 'audio' ? a.name : 'Double-click to place it'}
        >
          <span className="tt-kind">{a.kind}</span>
          <span className="tt-grow">{a.name}</span>
          {a.kind !== 'font' && a.kind !== 'audio' && (
            <button className="tt-ico" aria-label={`Place ${a.name}`} onClick={() => place(a)}>
              <Plus size={12} />
            </button>
          )}
          <button
            className="tt-ico"
            aria-label={`Remove ${a.name}`}
            onClick={() => store.edit('Remove file', (p) => ({ ...p, assets: p.assets.filter((x) => x.id !== a.id) }))}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

async function imageSize(src: string, host: Host): Promise<[number, number] | null> {
  if (typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve([img.naturalWidth || 400, img.naturalHeight || 300]);
    img.onerror = () => resolve(null);
    img.src = src.startsWith('data:') ? src : host.urlFor(src);
  });
}

export function LibraryPanel({ store, host, env, onOpen }: { store: Store; host: Host; env: BrowserEnv; onOpen: (p: TitleProject, libId?: string) => void }) {
  const [mine, setMine] = useState<LibraryEntry[]>([]);
  const [cat, setCat] = useState<string>('All');
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const refresh = () =>
    host
      .listLibrary()
      .then(setMine)
      .catch((e) => setError(String(e)));
  const version = useStore(store, (s) => s.path);
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, version]);
  const all = starterTemplates();
  const shown = all.filter((t) => cat === 'All' || t.category === cat);
  return (
    <div className="tt-library" data-testid="titler-library">
      <div className="tt-side-head">
        Your titles ({host.libraryName})
        {mine.length > 0 && (
          <button className="tt-ico" onClick={() => setSharing(true)} title="Share titles as a template pack (one file)" aria-label="Share as a pack">
            <Package size={13} />
          </button>
        )}
      </div>
      {sharing && <PackDialog host={host} env={env} onClose={() => setSharing(false)} onDone={(status) => store.set({ status })} />}
      {error && <div className="tt-error">{error}</div>}
      {mine.length === 0 && (
        <div className="tt-dim tt-small tt-pad">
          Titles you save to the library appear here{host.kind === 'web' ? '' : ', for Lumora and Lumora Studio too'}.
        </div>
      )}
      {mine.map((m) => (
        <div key={m.id} className="tt-side-item">
          <button
            className="tt-link tt-grow"
            onClick={async () => {
              const r = await host.readLibrary(m.id);
              if (r.project) onOpen(r.project, m.id);
              else setError(r.error ?? 'It could not be opened.');
            }}
          >
            {m.name}
          </button>
          <span className="tt-dim tt-small">{m.category}</span>
          <button
            className="tt-ico"
            aria-label={`Delete ${m.name} from the library`}
            onClick={async () => {
              if (!confirm(`Delete “${m.name}” from the library?`)) return;
              await host.removeLibrary(m.id);
              void refresh();
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div className="tt-side-head">Templates</div>
      <div className="tt-cats">
        {['All', ...CATEGORIES].map((c) => (
          <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="tt-templates">
        {shown.map((t) => (
          <button key={t.id} className="tt-template" onClick={() => onOpen(fromTemplate(t))} title={t.description}>
            <Thumb project={t} env={env} width={176} />
            <span>{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
