import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import type { Doc, DocState } from '../doc';
import { layout, moveTitle, placedTitles, timecode, trim, updateTitle, updateTrack, type Project, type Track } from '../model/project';
import type { Player } from '../player/player';
import type { Actions } from './Editor';
import { usePlayhead, usePlaying } from './hooks';
import { usePeaks } from './peaks';

const HEAD = 168;
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** The film from start to end: titles, the picture, and every sound. */
export function Timeline({
  doc,
  state,
  player,
  actions,
  zoom,
  setZoom,
}: {
  doc: Doc;
  state: DocState;
  player: Player;
  actions: Actions;
  zoom: number;
  setZoom: (f: (z: number) => number) => void;
}) {
  const p = state.project;
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const { starts, total } = layout(p.clips);
  const fit = Math.max(0.0001, (view.width - 24) / Math.max(1, total / 1000));
  const most = 220;
  const steps = Math.max(0, Math.ceil(Math.log(most / fit) / Math.log(1.5)));
  const z = Math.max(0, Math.min(steps, zoom));
  const pps = Math.min(most, fit * 1.5 ** z);
  const width = Math.max(view.width, (total / 1000) * pps + 40);
  const x = (ms: number) => (ms / 1000) * pps;
  const peaksOf = usePeaks(p.tracks.map((t) => t.path));

  useEffect(() => {
    if (zoom !== z) setZoom(() => z);
  }, [zoom, z, setZoom]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zooming keeps the playhead where it was on the screen.
  const lastPps = useRef(pps);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || lastPps.current === pps) return;
    const at = (player.time / 1000) * lastPps.current - el.scrollLeft;
    el.scrollLeft = Math.max(0, (player.time / 1000) * pps - at);
    lastPps.current = pps;
    setView({ left: el.scrollLeft, width: el.clientWidth });
  }, [pps, player]);

  const timeAt = (clientX: number) => {
    const el = scroller.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(total, ((clientX - r.left + el.scrollLeft) / pps) * 1000));
  };

  const scrub = (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    player.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => player.seek(timeAt(ev.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  /** Drag something; `f` gets how far it moved (ms) and whether Alt is held. */
  const drag = (e: RPointerEvent<HTMLElement>, f: (ms: number, alt: boolean) => void) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => f(((ev.clientX - x0) / pps) * 1000, ev.altKey);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const sel = state.selection;
  const selectedClips = sel?.kind === 'clip' ? sel.ids : [];
  const step = STEPS.find((s) => s * pps >= 90) ?? 3600;
  const first = Math.floor(view.left / pps / step) * step;
  const ticks: number[] = [];
  for (let s = first; s * pps < view.left + view.width + 100 && s * 1000 <= total + step * 1000; s += step) ticks.push(s);

  return (
    <section className="tl" aria-label="Timeline">
      <div className="tl__tools">
        <button type="button" className="btn btn--sm" onClick={actions.split} title="Cut the clip at the playhead in two (S)">
          Split
        </button>
        <button type="button" className="btn btn--sm" onClick={actions.remove} disabled={!sel} title="Take the selected part out (Delete)">
          Remove
        </button>
        <button type="button" className="btn btn--sm" onClick={actions.addTitle} title="Put words on the picture at the playhead (T)">
          Add title
        </button>
        <span className="tl__tip">Drag a clip's edge to move the cut · Alt+drag to shorten · Click a camera to switch</span>
        <span className="grow" />
        {p.range && (
          <span className="tl__marks">
            Marked {timecode(p.range.from)} – {timecode(p.range.to)}
          </span>
        )}
        <button type="button" className="btn btn--sm" onClick={() => setZoom(() => 0)} title="See the whole film">
          Whole film
        </button>
        <button type="button" className="tbtn" onClick={() => setZoom((v) => Math.max(0, v - 1))} aria-label="Zoom out" title="Zoom out (−)">
          −
        </button>
        <input className="tl__zoom" type="range" min={0} max={steps} value={z} onChange={(e) => setZoom(() => Number(e.target.value))} aria-label="Zoom" />
        <button type="button" className="tbtn" onClick={() => setZoom((v) => v + 1)} aria-label="Zoom in" title="Zoom in (+)">
          +
        </button>
      </div>
      <div className="tl__body">
        <div className="tl__heads" style={{ width: HEAD }}>
          <div className="tl__head tl__head--ruler" />
          <div className="tl__head tl__head--titles">Titles</div>
          <div className="tl__head tl__head--video">Picture</div>
          {p.tracks.map((t) => (
            <TrackHead key={t.id} track={t} onChange={(c, key) => doc.edit((q) => updateTrack(q, t.id, c), key)} />
          ))}
        </div>
        <div
          className="tl__scroll"
          ref={scroller}
          onScroll={(e) => setView({ left: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })}
          onWheel={(e) => {
            const el = scroller.current;
            if (!el) return;
            if (e.ctrlKey) {
              setZoom((v) => Math.max(0, v + (e.deltaY < 0 ? 1 : -1)));
              return;
            }
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
          }}
        >
          <div className="tl__content" style={{ width }}>
            <div className="tl__ruler" onPointerDown={scrub}>
              {p.range && <div className="tl__range" style={{ left: x(p.range.from), width: Math.max(2, x(p.range.to - p.range.from)) }} />}
              {ticks.map((s) => (
                <span key={s} className="tl__tick" style={{ left: s * pps }}>
                  {timecode(s * 1000)}
                </span>
              ))}
            </div>
            <div className="tl__row tl__row--titles" onPointerDown={scrub}>
              {placedTitles(p).map(({ title, start }) => {
                const base = p;
                return (
                  <div
                    key={title.id}
                    className={`tl__title${sel?.kind === 'title' && sel.id === title.id ? ' is-sel' : ''}`}
                    style={{ left: x(start), width: Math.max(8, x(title.length)) }}
                    title={title.text}
                    onPointerDown={(e) => {
                      doc.select({ kind: 'title', id: title.id });
                      drag(e, (ms) => doc.edit(() => moveTitle(base, title.id, start + ms), `move-${title.id}`));
                    }}
                  >
                    <span>{title.text || 'Title'}</span>
                    <i
                      className="tl__edge tl__edge--end"
                      onPointerDown={(e) => drag(e, (ms) => doc.edit(() => updateTitle(base, title.id, { length: title.length + ms }), `len-${title.id}`))}
                    />
                  </div>
                );
              })}
            </div>
            <div className="tl__row tl__row--video" onPointerDown={scrub}>
              {p.clips.map((c, i) => {
                const left = x(starts[i] ?? 0);
                const w = x(c.out - c.in);
                if (left + w < view.left - 50 || left > view.left + view.width + 50) return null;
                const a = p.angles.find((g) => g.id === c.angle);
                const base = p;
                return (
                  <div
                    key={c.id}
                    className={`tl__clip${selectedClips.includes(c.id) ? ' is-sel' : ''}`}
                    style={{ left, width: Math.max(2, w), background: a?.color ?? '#444' }}
                    title={`${a?.name ?? ''} · ${timecode(c.out - c.in)}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.shiftKey && sel?.kind === 'clip')
                        doc.select({ kind: 'clip', ids: sel.ids.includes(c.id) ? sel.ids.filter((id) => id !== c.id) : [...sel.ids, c.id] });
                      else doc.select({ kind: 'clip', ids: [c.id] });
                    }}
                    onDoubleClick={() => player.seek(starts[i] ?? 0)}
                  >
                    {c.fade > 0 && i > 0 && <span className="tl__fade" style={{ width: Math.max(4, x(c.fade / 2)) }} />}
                    {w > 46 && <span className="tl__clipname">{a?.name}</span>}
                    {w > 12 && (
                      <>
                        <i
                          className="tl__edge tl__edge--start"
                          onPointerDown={(e) => drag(e, (ms, alt) => doc.edit(() => trim(base, c.id, 'start', ms, alt), `trim-${c.id}`))}
                        />
                        <i
                          className="tl__edge tl__edge--end"
                          onPointerDown={(e) => drag(e, (ms, alt) => doc.edit(() => trim(base, c.id, 'end', ms, alt), `trim-${c.id}`))}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {p.tracks.map((t) => (
              <div key={t.id} className={`tl__row tl__row--sound${t.muted && !t.solo ? ' is-muted' : ''}`} onPointerDown={scrub}>
                <Wave project={p} track={t} peaks={peaksOf(t.path)} pps={pps} left={view.left} width={view.width} />
              </div>
            ))}
            {p.range && <div className="tl__rangebody" style={{ left: x(p.range.from), width: Math.max(2, x(p.range.to - p.range.from)) }} />}
            <Playhead player={player} pps={pps} scroller={scroller} />
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackHead({ track, onChange }: { track: Track; onChange: (c: Partial<Track>, key?: string) => void }) {
  return (
    <div className={`tl__head tl__head--sound${track.muted ? ' is-muted' : ''}`}>
      <span className="tl__trackname" title={track.name}>
        {track.name}
      </span>
      <span className="tl__trackctl">
        <button
          type="button"
          className={`tl__ms${track.muted ? ' is-on' : ''}`}
          onClick={() => onChange({ muted: !track.muted })}
          title="Mute: leave this sound out"
          aria-pressed={track.muted}
        >
          M
        </button>
        <button
          type="button"
          className={`tl__ms tl__ms--solo${track.solo ? ' is-on' : ''}`}
          onClick={() => onChange({ solo: !track.solo })}
          title="Solo: hear only this"
          aria-pressed={track.solo}
        >
          S
        </button>
        <input
          type="range"
          min={-24}
          max={12}
          step={0.5}
          value={track.gainDb}
          onChange={(e) => onChange({ gainDb: Number(e.target.value) }, `gain-${track.id}`)}
          onDoubleClick={() => onChange({ gainDb: 0 })}
          aria-label={`${track.name} volume`}
          title="Volume (double-click: back to normal)"
        />
        <output>{track.gainDb > 0 ? `+${track.gainDb}` : track.gainDb}</output>
      </span>
    </div>
  );
}

/** A sound's waveform under the clips it plays in (only the part on screen is drawn). */
function Wave({
  project,
  track,
  peaks,
  pps,
  left,
  width,
}: {
  project: Project;
  track: Track;
  peaks: Uint8Array | null;
  pps: number;
  left: number;
  width: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const h = c.clientHeight || 40;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.ceil(width * dpr);
    c.height = Math.ceil(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);
    const { starts } = layout(project.clips);
    ctx.fillStyle = track.live ? '#4fb3bf' : '#7f9bb5';
    project.clips.forEach((clip, i) => {
      const x0 = ((starts[i] ?? 0) / 1000) * pps - left;
      const x1 = x0 + ((clip.out - clip.in) / 1000) * pps;
      if (x1 < 0 || x0 > width) return;
      for (let px = Math.max(0, Math.floor(x0)); px < Math.min(width, x1); px++) {
        const e0 = clip.in + ((px - x0) / pps) * 1000;
        const e1 = e0 + 1000 / pps;
        const f0 = Math.floor((e0 - track.startMs - track.offsetMs) / 10);
        const f1 = Math.max(f0 + 1, Math.floor((e1 - track.startMs - track.offsetMs) / 10));
        let v = 0;
        if (peaks) for (let k = Math.max(0, f0); k < Math.min(peaks.length, f1); k++) v = Math.max(v, peaks[k] ?? 0);
        const bar = (v / 255) * (h - 4);
        if (bar > 0.5) ctx.fillRect(px, (h - bar) / 2, 1, bar);
      }
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(Math.floor(x0), 0, 1, h);
      ctx.restore();
    });
  }, [project, track, peaks, pps, left, width]);
  return <canvas ref={ref} className="tl__wave" style={{ left, width }} />;
}

function Playhead({ player, pps, scroller }: { player: Player; pps: number; scroller: RefObject<HTMLDivElement | null> }) {
  const t = usePlayhead(player);
  const playing = usePlaying(player);
  const left = (t / 1000) * pps;
  // While playing, the timeline follows along.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    if (left > el.scrollLeft + el.clientWidth - 30 || left < el.scrollLeft) el.scrollLeft = Math.max(0, left - 60);
  }, [left, playing, scroller]);
  return <div className="tl__playhead" style={{ transform: `translateX(${left}px)` }} />;
}
