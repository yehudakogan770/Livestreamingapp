import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpFromLine,
  AudioLines,
  BetweenHorizontalStart,
  Cctv,
  Contrast,
  FoldHorizontal,
  MonitorPlay,
  Pause,
  Play,
  Repeat,
  Replace,
  Scan,
  Square,
  SquarePlay,
  StepBack,
  StepForward,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { valueAt, setValue } from '../model/anim';
import { clockAt, duration, timecode } from '../model/build';
import { current, end, rate } from '../model/seq';
import type { Clip } from '../model/types';

type MotionNowKeys = 'x' | 'y' | 'scale' | 'scaleX' | 'rotation';
import { useDoc, selectedIds, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { mediaUrl } from '../native';
import type { Actions } from './actions';
import { Choice } from './controls';
import { drag, usePlayhead, usePlaying, useSize } from './hooks';
import { PlayheadTime } from './Timeline';
import { DroppedFrames, ProxyToggle } from './Playback';
import { NativeBadge } from './NativeBadge';
import { nativePlayback } from '../render/native/client';
import { useUi, type Ui } from './state';
import { TrackOverlay } from './Tracking';
import { ExposureButton, ExposureOverlay, useExposure } from './ExposureOverlay';
import { CompareOverlay, StillsButton, useCompare } from './Compare';
import { MarkIn, MarkOut } from './icons';

/** The program monitor: the sequence as it plays, drawn by the compositor. */
export function ProgramMonitor({ doc, engine, ui, actions }: { doc: Doc; engine: Engine; ui: Ui; actions: Actions }) {
  const { project, selection } = useDoc(doc);
  const u = useUi(ui);
  const expo = useExposure();
  const cmp = useCompare();
  const s = current(project);
  const fps = rate(s);
  const [boxRef, box] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = usePlayhead(engine);
  const playing = usePlaying(engine);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    try {
      engine.setCanvas(canvasRef.current);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
    return () => engine.setCanvas(null);
  }, [engine]);

  // The picture fits the box at the sequence's shape.
  const aspect = s.width / s.height;
  const fitW = Math.max(10, Math.min(box.w, box.h * aspect));
  const fitH = fitW / aspect;
  useEffect(() => engine.setShown(fitW, fitH), [engine, fitW, fitH]);

  // The clip on top at the playhead (for the clock, and for dragging it around in the picture).
  const onTop = s.tracks
    .filter((tr) => tr.kind === 'video' && !tr.off)
    .reverse()
    .map((tr) => s.clips.find((c) => c.track === tr.id && t >= c.start && t < end(c) && c.enabled))
    .find(Boolean);
  const clock = clockAt(project, onTop, t, fps);
  const sel = selectedIds(selection);
  const moving = s.clips.find((c) => sel.includes(c.id) && s.tracks.find((tr) => tr.id === c.track)?.kind === 'video' && t >= c.start && t < end(c));
  // Guides and handles over the picture show only over WebGL's (the native window would cover them).
  nativePlayback.blocked = u.safeMargins || expo.mode !== 'off' || !!cmp.showing || (!playing && !!moving) || !!problem;

  return (
    <div className="vmon vmon--program">
      <div className="vmon__head">
        <span className="vmon__title">
          <MonitorPlay />
          Program <small>{s.name}</small>
        </span>
        {clock && <span className="vmon__clock">{clock}</span>}
        <span className="vmon__fill" />
        <select
          className="vmon__q"
          aria-label="Playback quality"
          title="Playback quality: lower plays more smoothly on slower computers"
          value={u.quality}
          onChange={(e) => ui.set({ quality: Number(e.target.value) as 1 | 0.5 | 0.25 })}
        >
          <option value={1}>Full</option>
          <option value={0.5}>1/2</option>
          <option value={0.25}>1/4</option>
        </select>
        <ProxyToggle ui={ui} on={u.proxies} />
        <DroppedFrames engine={engine} />
        <NativeBadge />
        <button
          type="button"
          className={`tbtn tbtn--icon${u.safeMargins ? ' is-on' : ''}`}
          aria-label="Safe margins"
          title="Safe margins (keep words inside the inner box)"
          onClick={() => ui.set({ safeMargins: !u.safeMargins })}
        >
          <Scan />
        </button>
        <ExposureButton />
        {u.page === 'color' && <StillsButton engine={engine} seqName={s.name} frame={t} fps={fps} shape={aspect} />}
        {u.page === 'color' && (
          <button
            type="button"
            className={`tbtn${u.showMatte ? ' is-on' : ''}`}
            title="Show the chosen grade node's matte (white: where the node changes the picture)"
            onClick={() => ui.set({ showMatte: !u.showMatte })}
          >
            <Contrast />
            Matte
          </button>
        )}
      </div>
      <div className="vmon__screen" ref={boxRef}>
        <div className="vmon__frame" style={{ width: fitW, height: fitH }}>
          <canvas ref={canvasRef} className="vmon__canvas" onDoubleClick={() => engine.toggle()} />
          <ExposureOverlay engine={engine} />
          <CompareOverlay />
          {u.safeMargins && <div className="vmon__safe" />}
          {moving && !playing && <MoveHandles doc={doc} clip={moving} t={t} w={fitW} h={fitH} seqW={s.width} />}
          {!playing && <TrackOverlay doc={doc} engine={engine} clip={moving ?? null} t={t} w={fitW} h={fitH} />}
          {problem && <p className="vmon__problem">{problem}</p>}
        </div>
      </div>
      <Transport engine={engine} actions={actions} fps={fps} inPoint={s.inPoint} outPoint={s.outPoint} />
    </div>
  );
}

/** Drag the selected clip around the picture (and its corner to size it). */
function MoveHandles({ doc, clip, t, w, h, seqW }: { doc: Doc; clip: Clip; t: number; w: number; h: number; seqW: number }) {
  const local = t - clip.start;
  const m = clip.motion;
  const k = w / seqW;
  const x = valueAt(m.x, local);
  const y = valueAt(m.y, local);
  const scale = valueAt(m.scale, local, 100);
  // The outline is the frame at this size and place (a good guide for any picture).
  const bw = w * (scale / 100) * (valueAt(m.scaleX, local, 100) / 100);
  const bh = h * (scale / 100);
  const left = w / 2 + x * k - bw / 2;
  const top = h / 2 + y * k - bh / 2;
  const key = `move-${clip.id}-${t}`;
  const set = (change: Partial<Record<MotionNowKeys, number>>) =>
    doc.edit(
      (p) => ({
        ...p,
        sequences: p.sequences.map((sq) =>
          sq.id !== p.open
            ? sq
            : {
                ...sq,
                clips: sq.clips.map((c) =>
                  c.id !== clip.id
                    ? c
                    : {
                        ...c,
                        motion: {
                          ...c.motion,
                          ...Object.fromEntries(Object.entries(change).map(([kk, v]) => [kk, setValue(c.motion[kk as MotionNowKeys], local, v as number)])),
                        },
                      },
                ),
              },
        ),
      }),
      'Move in picture',
      key,
    );
  return (
    <div
      className="handles"
      style={{ left, top, width: bw, height: bh, transform: `rotate(${valueAt(m.rotation, local)}deg)` }}
      title="Drag to move; drag a corner to size"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        drag(e, (dx, dy) => set({ x: Math.round(x + dx / k), y: Math.round(y + dy / k) }));
      }}
    >
      {['nw', 'ne', 'sw', 'se'].map((c) => (
        <i
          key={c}
          className={`handles__c handles__c--${c}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            const cx = left + bw / 2;
            const cy = top + bh / 2;
            const r0 = Math.hypot(bw / 2, bh / 2);
            const rect = (e.currentTarget.parentElement?.parentElement as HTMLElement).getBoundingClientRect();
            drag(e, (_dx, _dy, ev) => {
              const r = Math.hypot(ev.clientX - rect.left - cx, ev.clientY - rect.top - cy);
              set({ scale: Math.max(1, Math.round(((scale * r) / r0) * 10) / 10) });
            });
          }}
        />
      ))}
    </div>
  );
}

function Transport({
  engine,
  actions,
  fps,
  inPoint,
  outPoint,
}: {
  engine: Engine;
  actions: Actions;
  fps: number;
  inPoint: number | null;
  outPoint: number | null;
}) {
  const playing = usePlaying(engine);
  const [loop, setLoop] = useState(engine.loop);
  return (
    <div className="vtransport">
      <PlayheadTime engine={engine} fps={fps} big />
      <span className="vtransport__fill" />
      <span className="vtransport__group">
        <button type="button" className="tbtn tbtn--icon" title="Mark in (I)" aria-label="Mark in" onClick={actions.markIn}>
          <MarkIn />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Mark out (O)" aria-label="Mark out" onClick={actions.markOut}>
          <MarkOut />
        </button>
      </span>
      <span className="vtransport__group">
        <button type="button" className="tbtn tbtn--icon" title="Go to in (Shift+I)" aria-label="Go to in" onClick={actions.toIn}>
          <ArrowLeftToLine />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Step back one frame (←)" aria-label="Step back" onClick={() => actions.step(-1)}>
          <StepBack />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Stop" aria-label="Stop" onClick={actions.stop}>
          <Square />
        </button>
        <button
          type="button"
          className={`tbtn tbtn--play${playing ? ' is-on' : ''}`}
          aria-label={playing ? 'Pause' : 'Play'}
          title="Play / pause (Space)"
          onClick={actions.toggle}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Step forward one frame (→)" aria-label="Step forward" onClick={() => actions.step(1)}>
          <StepForward />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Go to out (Shift+O)" aria-label="Go to out" onClick={actions.toOut}>
          <ArrowRightToLine />
        </button>
        <button
          type="button"
          className={`tbtn tbtn--icon${loop ? ' is-on' : ''}`}
          title="Loop: play the marked part over and over"
          aria-label="Loop"
          aria-pressed={loop}
          onClick={() => {
            actions.toggleLoop();
            setLoop(engine.loop);
          }}
        >
          <Repeat />
        </button>
      </span>
      <span className="vtransport__group">
        <button type="button" className="tbtn tbtn--icon" title="Lift the marked part (;)" aria-label="Lift" onClick={actions.liftMarked}>
          <ArrowUpFromLine />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Extract the marked part and close up (')" aria-label="Extract" onClick={actions.extractMarked}>
          <FoldHorizontal />
        </button>
      </span>
      <span className="vtransport__fill" />
      <span className="vtransport__len" title="Marked length">
        {inPoint !== null || outPoint !== null ? `${duration(((outPoint ?? inPoint ?? 0) - (inPoint ?? 0)) / fps)} marked` : ''}
      </span>
    </div>
  );
}

/** The source monitor: one clip from the bin, to mark the part you want and put it in. */
export function SourceMonitor({ doc, ui, actions, engine }: { doc: Doc; ui: Ui; actions: Actions; engine: Engine }) {
  const { project } = useDoc(doc);
  const u = useUi(ui);
  const src = u.source;
  const m = src ? project.media.find((x) => x.id === src.media) : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fps = m?.fps ?? 30;
  const group = project.groups[0];
  const s = current(project);
  const hasMulticam = s.clips.some((c) => c.source.kind === 'multicam');

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.currentTime = src.time;
    setTime(src.time);
  }, [src?.media]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      setTime(v.currentTime);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [m?.id]);

  const set = (change: Partial<NonNullable<typeof src>>) => src && ui.set({ source: { ...src, ...change } });
  const mark = (which: 'in' | 'out') => set({ [which]: time, time });
  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(m?.duration ?? 0, t));
  };

  // Keys for the source monitor while the mouse is over it.
  const onKey = (e: React.KeyboardEvent) => {
    const v = videoRef.current;
    if (!v) return;
    const k = e.key.toLowerCase();
    if (k === ' ') v.paused ? void v.play() : v.pause();
    else if (k === 'i') mark('in');
    else if (k === 'o') mark('out');
    else if (k === 'arrowleft') seek(v.currentTime - 1 / fps);
    else if (k === 'arrowright') seek(v.currentTime + 1 / fps);
    else if (k === ',') actions.insertSource('insert');
    else if (k === '.') actions.insertSource('overwrite');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="vmon vmon--source" tabIndex={0} onKeyDown={onKey}>
      <div className="vmon__head">
        {hasMulticam && (
          <Choice
            value={u.sourceTab}
            options={[
              ['source', 'Source'],
              ['cameras', 'Cameras'],
            ]}
            onChange={(v) => ui.set({ sourceTab: v })}
            label="Show"
          />
        )}
        <span className="vmon__title">
          {u.sourceTab === 'source' ? <SquarePlay /> : <Cctv />}
          {u.sourceTab === 'source' ? (m ? m.name : 'Source (double-click a clip in the bin)') : 'Cameras: click or press 1–9 to cut'}
        </span>
      </div>
      {u.sourceTab === 'cameras' && hasMulticam && group ? (
        <CameraWall doc={doc} engine={engine} actions={actions} />
      ) : (
        <>
          <div
            className="vmon__screen"
            draggable={!!m}
            onDragStart={(e) => {
              if (!m) return;
              e.dataTransfer.setData('application/x-lumora-media', m.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            {m && m.kind === 'image' && <img className="vmon__img" src={mediaUrl(m.proxy ?? m.path)} alt={m.name} />}
            {m && m.kind !== 'image' && (
              <video
                ref={videoRef}
                className={`vmon__video${m.kind === 'audio' ? ' is-audio' : ''}`}
                src={mediaUrl(m.proxy ?? m.path)}
                preload="auto"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause())}
              />
            )}
            {m?.kind === 'audio' && (
              <span className="vmon__audioonly">
                <AudioLines />
                {m.name}
              </span>
            )}
            {!m && (
              <p className="vmon__empty">Double-click a clip in the bin to see it here. Mark the part you want (I and O), then Insert (,) or Overwrite (.).</p>
            )}
          </div>
          {m && m.kind !== 'image' && (
            <div className="srcbar">
              <div
                className="srcbar__track"
                onPointerDown={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const go = (x: number) => seek(((x - r.left) / r.width) * m.duration);
                  go(e.clientX);
                  drag(e, (_dx, _dy, ev) => go(ev.clientX));
                }}
              >
                {(src?.in !== null || src?.out !== null) && (
                  <i
                    className="srcbar__range"
                    style={{ left: `${((src?.in ?? 0) / m.duration) * 100}%`, width: `${(((src?.out ?? m.duration) - (src?.in ?? 0)) / m.duration) * 100}%` }}
                  />
                )}
                <b className="srcbar__head" style={{ left: `${(time / Math.max(0.001, m.duration)) * 100}%` }} />
              </div>
            </div>
          )}
          <div className="vtransport">
            <span className="tc tc--big">{timecode(Math.round(time * fps), fps)}</span>
            <span className="vtransport__fill" />
            <button type="button" className="tbtn tbtn--icon" title="Mark in (I)" aria-label="Mark in" disabled={!m} onClick={() => mark('in')}>
              <MarkIn />
            </button>
            <button type="button" className="tbtn tbtn--icon" title="Mark out (O)" aria-label="Mark out" disabled={!m} onClick={() => mark('out')}>
              <MarkOut />
            </button>
            <button
              type="button"
              className="tbtn tbtn--play"
              aria-label={playing ? 'Pause' : 'Play'}
              disabled={!m || m.kind === 'image'}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.paused ? void v.play() : v.pause();
              }}
            >
              {playing ? <Pause /> : <Play />}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              title="Insert at the playhead, pushing the rest along (,)"
              disabled={!m}
              onClick={() => actions.insertSource('insert')}
            >
              <BetweenHorizontalStart />
              Insert
            </button>
            <button type="button" className="btn btn--sm" title="Overwrite at the playhead (.)" disabled={!m} onClick={() => actions.insertSource('overwrite')}>
              <Replace />
              Overwrite
            </button>
            <span className="vtransport__fill" />
            <span className="vtransport__len">{m && m.kind !== 'image' ? `${duration((src?.out ?? m.duration) - (src?.in ?? 0))} marked` : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Every camera of the event, playing together: click one (or press its number) to cut to it. */
function CameraWall({ doc, engine, actions }: { doc: Doc; engine: Engine; actions: Actions }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const t = usePlayhead(engine);
  const playing = usePlaying(engine);
  const clip = s.clips.find((c) => c.source.kind === 'multicam' && t >= c.start && t < end(c));
  const src = clip?.source.kind === 'multicam' ? clip.source : null;
  const group = project.groups.find((g) => g.id === src?.group) ?? project.groups[0];
  const groupTime = clip && src ? src.in + ((t - clip.start) * clip.speed) / fps : t / fps;
  const n = group?.angles.length ?? 0;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  return (
    <div className="wall" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {group?.angles.map((a, i) => {
        const m = project.media.find((x) => x.id === a.media);
        return (
          <button
            key={a.id}
            type="button"
            className={`wall__tile${src?.angle === a.id ? ' is-on' : ''}`}
            onClick={() => actions.switchAngle(a.id)}
            title={`Cut to ${a.name} (${i + 1})`}
          >
            {m && <AngleVideo path={m.proxy ?? m.path} time={groupTime - a.offset} playing={playing} />}
            <span className="wall__label">
              <b style={{ background: a.color }}>{i + 1}</b>
              {a.name}
            </span>
            {src?.angle === a.id && <span className="wall__on">ON</span>}
          </button>
        );
      })}
    </div>
  );
}

function AngleVideo({ path, time, playing }: { path: string; time: number; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (time < 0 || (v.duration && time > v.duration)) {
      v.pause();
      return;
    }
    const drift = v.currentTime - time;
    if (!playing) {
      if (!v.paused) v.pause();
      if (Math.abs(drift) > 0.05) v.currentTime = time;
    } else {
      if (v.paused) {
        v.currentTime = time;
        void v.play().catch(() => {});
      } else if (Math.abs(drift) > 0.3) v.currentTime = time;
    }
  }, [time, playing]);
  return <video ref={ref} className="wall__video" src={mediaUrl(path)} muted preload="auto" playsInline />;
}
