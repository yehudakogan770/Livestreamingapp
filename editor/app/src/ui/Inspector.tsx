import { useState, useSyncExternalStore } from 'react';
import type { Doc, DocState } from '../doc';
import {
  NEUTRAL,
  clipLength,
  clockTime,
  locate,
  maxFade,
  remove,
  setAngle,
  setFade,
  timecode,
  updateAngle,
  updateTitle,
  FRAME,
  type Look,
  type Title,
  type TitleStyle,
} from '../model/project';
import type { Player } from '../player/player';
import type { Actions } from './Editor';

/** The clip at the playhead (only changes when another clip comes up). */
function useClipHere(doc: Doc, player: Player): string | null {
  return useSyncExternalStore(player.subscribe.bind(player), () => locate(doc.project.clips, player.time)?.clip.id ?? null);
}

/** Settings for what is selected (or the clip at the playhead). */
export function Inspector({ doc, state, player, actions }: { doc: Doc; state: DocState; player: Player; actions: Actions }) {
  const here = useClipHere(doc, player);
  const sel = state.selection;
  if (sel?.kind === 'title') {
    const title = state.project.titles.find((t) => t.id === sel.id);
    if (title) return <TitlePanel doc={doc} title={title} actions={actions} />;
  }
  const id = sel?.kind === 'clip' ? sel.ids[0] : here;
  return <ClipPanel doc={doc} state={state} clipId={id ?? null} actions={actions} selected={sel?.kind === 'clip'} />;
}

function ClipPanel({ doc, state, clipId, actions, selected }: { doc: Doc; state: DocState; clipId: string | null; actions: Actions; selected: boolean }) {
  const [tab, setTab] = useState<'clip' | 'color'>('clip');
  const p = state.project;
  const i = p.clips.findIndex((c) => c.id === clipId);
  const clip = p.clips[i];
  if (!clip) return <aside className="insp" />;
  const angle = p.angles.find((a) => a.id === clip.angle);
  const most = maxFade(p, clip.id);
  const start = clockTime(p.startedAt, clip.in, true);
  const end = clockTime(p.startedAt, clip.out, true);
  return (
    <aside className="insp" aria-label="Clip settings">
      <div className="insp__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'clip'} className={tab === 'clip' ? 'is-on' : ''} onClick={() => setTab('clip')}>
          Clip
        </button>
        <button type="button" role="tab" aria-selected={tab === 'color'} className={tab === 'color' ? 'is-on' : ''} onClick={() => setTab('color')}>
          Color
        </button>
      </div>
      {tab === 'clip' && (
        <div className="insp__body">
          <p className="insp__what">
            <b>{selected ? 'Selected clip' : 'Clip at the playhead'}</b>
            <span>
              {start && end ? `${start} – ${end} · ` : ''}
              {timecode(clipLength(clip))}
            </span>
          </p>
          <h3>Camera</h3>
          <div className="insp__cams">
            {p.angles.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`insp__cam${a.id === clip.angle ? ' is-on' : ''}`}
                onClick={() => doc.edit((q) => setAngle(q, clip.id, a.id))}
              >
                <i style={{ background: a.color }} />
                {a.name}
              </button>
            ))}
          </div>
          <h3>Into this clip</h3>
          {i === 0 ? (
            <p className="insp__note">The film starts here.</p>
          ) : (
            <>
              <div className="choice">
                <button type="button" className={clip.fade === 0 ? 'is-on' : ''} onClick={() => doc.edit((q) => setFade(q, clip.id, 0))}>
                  Cut
                </button>
                <button
                  type="button"
                  className={clip.fade > 0 ? 'is-on' : ''}
                  onClick={() => doc.edit((q) => setFade(q, clip.id, clip.fade || Math.min(1000, most)))}
                  disabled={most < FRAME * 2}
                >
                  Dissolve
                </button>
              </div>
              {clip.fade > 0 && (
                <label className="slider">
                  <span>Dissolve length</span>
                  <input
                    type="range"
                    min={200}
                    max={Math.max(200, Math.min(3000, most))}
                    step={100}
                    value={clip.fade}
                    onChange={(e) => doc.edit((q) => setFade(q, clip.id, Number(e.target.value)), `fade-${clip.id}`)}
                  />
                  <output>{(clip.fade / 1000).toFixed(1)} s</output>
                </label>
              )}
            </>
          )}
          <div className="insp__row">
            <button type="button" className="btn btn--sm" onClick={actions.split} title="Cut the clip in two at the playhead (S)">
              Split at playhead
            </button>
            <button type="button" className="btn btn--sm" onClick={() => doc.edit((q) => remove(q, [clip.id]))} title="Take this part out of the film (Delete)">
              Remove
            </button>
          </div>
          {angle && (
            <>
              <h3>{angle.name} timing</h3>
              <div className="insp__nudge">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => doc.edit((q) => updateAngle(q, angle.id, { offsetMs: angle.offsetMs - FRAME }), `nudge-${angle.id}`)}
                  title="Show this camera a frame earlier"
                >
                  − frame
                </button>
                <span>{angle.offsetMs === 0 ? 'In sync' : `${Math.round(angle.offsetMs)} ms`}</span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => doc.edit((q) => updateAngle(q, angle.id, { offsetMs: angle.offsetMs + FRAME }), `nudge-${angle.id}`)}
                  title="Show this camera a frame later"
                >
                  + frame
                </button>
              </div>
              <p className="insp__note">If lips and sound don't match on this camera, move it a frame at a time.</p>
            </>
          )}
        </div>
      )}
      {tab === 'color' && angle && (
        <div className="insp__body">
          <p className="insp__what">
            <b>{angle.name}</b>
            <span>Changes this camera everywhere in the film.</span>
          </p>
          {(
            [
              ['brightness', 'Brightness'],
              ['contrast', 'Contrast'],
              ['saturation', 'Color'],
              ['warmth', 'Warmth'],
            ] as [keyof Look, string][]
          ).map(([key, label]) => (
            <label key={key} className="slider">
              <span>{label}</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={angle.look[key]}
                onChange={(e) =>
                  doc.edit((q) => updateAngle(q, angle.id, { look: { ...angle.look, [key]: Number(e.target.value) } }), `look-${angle.id}-${key}`)
                }
                onDoubleClick={() => doc.edit((q) => updateAngle(q, angle.id, { look: { ...angle.look, [key]: 0 } }))}
              />
              <output>{angle.look[key] > 0 ? `+${angle.look[key]}` : angle.look[key]}</output>
            </label>
          ))}
          <h3>Quick looks</h3>
          <div className="insp__looks">
            {LOOKS.map(([name, look]) => (
              <button key={name} type="button" className="btn btn--sm" onClick={() => doc.edit((q) => updateAngle(q, angle.id, { look: { ...look } }))}>
                {name}
              </button>
            ))}
          </div>
          <div className="insp__row">
            <button type="button" className="btn btn--sm" onClick={() => doc.edit((q) => updateAngle(q, angle.id, { look: { ...NEUTRAL } }))}>
              As recorded
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => doc.edit((q) => ({ ...q, angles: q.angles.map((a) => (a.live ? a : { ...a, look: { ...angle.look } })) }))}
              title="Give every camera these settings (not the Live Screen)"
            >
              Same for all cameras
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/** Quick starting points for a camera's color. */
const LOOKS: [string, Look][] = [
  ['Brighter', { brightness: 15, contrast: 5, saturation: 0, warmth: 0 }],
  ['Warmer', { brightness: 0, contrast: 0, saturation: 5, warmth: 40 }],
  ['Cooler', { brightness: 0, contrast: 0, saturation: 0, warmth: -40 }],
  ['Vivid', { brightness: 0, contrast: 15, saturation: 35, warmth: 0 }],
  ['Soft', { brightness: 5, contrast: -20, saturation: -10, warmth: 10 }],
  ['Black & white', { brightness: 0, contrast: 10, saturation: -100, warmth: 0 }],
];

const STYLES: [TitleStyle, string][] = [
  ['lower', 'Name bar'],
  ['center', 'Middle'],
  ['corner', 'Corner'],
];

function TitlePanel({ doc, title, actions }: { doc: Doc; title: Title; actions: Actions }) {
  const change = (c: Partial<Omit<Title, 'id'>>, key: string) => doc.edit((q) => updateTitle(q, title.id, c), `title-${title.id}-${key}`);
  return (
    <aside className="insp" aria-label="Title settings">
      <div className="insp__tabs">
        <button type="button" className="is-on">
          Title
        </button>
      </div>
      <div className="insp__body">
        <label className="field">
          <span className="field__label">Words</span>
          <input className="text" value={title.text} onChange={(e) => change({ text: e.target.value }, 'text')} autoFocus />
        </label>
        <label className="field">
          <span className="field__label">Second line</span>
          <input className="text" value={title.sub} onChange={(e) => change({ sub: e.target.value }, 'sub')} placeholder="(none)" />
        </label>
        <h3>Look</h3>
        <div className="choice">
          {STYLES.map(([s, label]) => (
            <button key={s} type="button" className={title.style === s ? 'is-on' : ''} onClick={() => change({ style: s }, 'style')}>
              {label}
            </button>
          ))}
        </div>
        <label className="slider">
          <span>On screen for</span>
          <input type="range" min={1000} max={30000} step={500} value={title.length} onChange={(e) => change({ length: Number(e.target.value) }, 'length')} />
          <output>{(title.length / 1000).toFixed(1)} s</output>
        </label>
        <p className="insp__note">The title stays with its moment when you cut or move things around it. Drag it on the timeline to move it.</p>
        <div className="insp__row">
          <button type="button" className="btn btn--sm" onClick={() => doc.select(null)}>
            Done
          </button>
          <button type="button" className="btn btn--sm" onClick={actions.remove}>
            Remove title
          </button>
        </div>
      </div>
    </aside>
  );
}
