import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { valueAt } from '../model/anim';
import { duration, parseTimecode, timecode } from '../model/build';
import {
  addSequenceClip,
  contains,
  moveClips,
  nearest,
  removeTrack,
  setAngle,
  setTransition,
  slide,
  slip,
  snapPoints,
  trim,
  updateMarker,
  updateTrack,
  withLinked,
  type TrimMode,
} from '../model/edit';
import { transitionDef } from '../model/effects';
import { current, end, mediaOf, rate, seqLength, sourceTime } from '../model/seq';
import { LABELS, type Clip, type MediaItem, type Project, type Track } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { dbToGain } from '../player/audio';
import { mediaUrl, type Strip } from '../native';
import type { Actions } from './actions';
import { PopMenu, Scrub, type MenuEntry } from './controls';
import { drag, usePlayhead, usePlaying, useSize } from './hooks';
import { usePeaks, useStrip } from './peaks';
import { useUi, type Tool, type Ui } from './state';

const RULER = 28;
const HEAD = 190;
const EDGE = 7;

type Preview = { ids: Set<string>; frames: number; dv: number; da: number; copy: boolean } | null;
type Marquee = { x0: number; y0: number; x1: number; y1: number } | null;

const TOOLS: [Tool, string, string, string][] = [
  ['select', '↖', 'Selection', 'V'],
  ['ripple', '⇤', 'Ripple edit: trims and moves what follows', 'B'],
  ['roll', '⇹', 'Rolling edit: moves a cut between two clips', 'N'],
  ['razor', '✂', 'Razor: cut a clip in two', 'C'],
  ['slip', '⇔', 'Slip: show another part of the clip, in the same place', 'Y'],
  ['slide', '⇆', 'Slide: move a clip between its neighbors', 'U'],
  ['hand', '✥', 'Hand: drag the timeline along', 'H'],
  ['text', 'T', 'Type: click on the timeline to add words', 'T'],
];

export function clipColor(p: Project, c: Clip): string {
  if (c.label) return c.label;
  const src = c.source;
  if (src.kind === 'multicam') return p.groups.find((g) => g.id === src.group)?.angles.find((a) => a.id === src.angle)?.color ?? '#3d6fa8';
  if (src.kind === 'text') return '#7a5bb0';
  if (src.kind === 'color') return '#5d636e';
  if (src.kind === 'adjustment') return '#8c6d3f';
  if (src.kind === 'sequence') return '#6b7a3a';
  if (src.kind === 'generator') return '#3a6b6b';
  return '#3d6fa8';
}

export function Timeline({ doc, engine, ui, actions }: { doc: Doc; engine: Engine; ui: Ui; actions: Actions }) {
  const { project, selection } = useDoc(doc);
  const u = useUi(ui);
  const s = current(project);
  const fps = rate(s);
  const zoom = u.zoom;
  const [scrollRef, size] = useSize<HTMLDivElement>();
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [preview, setPreview] = useState<Preview>(null);
  const [marquee, setMarquee] = useState<Marquee>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [dropAt, setDropAt] = useState<{ frame: number; track: string } | null>(null);
  const sel = new Set(selectedIds(selection));

  const video = s.tracks.filter((t) => t.kind === 'video');
  const audio = s.tracks.filter((t) => t.kind === 'audio');
  const rows = useMemo(() => {
    const list = [...[...video].reverse(), ...audio];
    let y = RULER;
    return list.map((t) => {
      const r = { track: t, y, h: t.height };
      y += t.height + (t === video[0] ? 6 : 0);
      return r;
    });
  }, [video, audio]);
  const rowsH = (rows[rows.length - 1]?.y ?? RULER) + (rows[rows.length - 1]?.h ?? 0) + 40;
  const len = seqLength(s);
  const contentW = Math.max((len + fps * 30) * zoom, size.w + 10);
  const toFrame = (x: number) => Math.max(0, Math.round(x / zoom));
  const rowAt = (y: number) => rows.find((r) => y >= r.y && y < r.y + r.h + (r.track === video[0] ? 6 : 0));
  const snapWithin = 8 / zoom;
  const peaksOf = usePeaks([
    ...new Set(
      s.clips
        .filter((c) => audio.some((t) => t.id === c.track))
        .map((c) => mediaOf(project, c))
        .filter((m): m is MediaItem => !!m)
        .map((m) => m.proxy ?? m.path),
    ),
  ]);

  // Keep the start of the view when the zoom changes around the playhead.
  const lastZoom = useRef(zoom);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || lastZoom.current === zoom) return;
    const ph = engine.time;
    const viewX = ph * lastZoom.current - el.scrollLeft;
    el.scrollLeft = Math.max(0, ph * zoom - viewX);
    lastZoom.current = zoom;
  }, [zoom, engine, scrollRef]);

  const contentXY = (e: { clientX: number; clientY: number }) => {
    const el = scrollRef.current as HTMLDivElement;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
  };

  const pointsFor = (skip: Set<string>) => snapPoints(s, Math.floor(engine.time), skip);

  // ---- clips: select, move, trim, slip, slide, cut ----
  const onClipDown = (e: React.PointerEvent, c: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const track = s.tracks.find((t) => t.id === c.track);
    if (track?.locked) return;
    const { x } = contentXY(e);
    const local = x - c.start * zoom;
    const w = c.length * zoom;
    const edge: 'start' | 'end' | null = w > 18 && local < EDGE ? 'start' : w > 18 && local > w - EDGE ? 'end' : null;
    const tool = u.tool;
    if (tool === 'razor') {
      let f = toFrame(x);
      if (u.snapping) f = nearest([Math.floor(engine.time)], f, snapWithin) ?? f;
      actions.razorAt(c.id, f, e.shiftKey);
      return;
    }
    if (tool === 'hand') return startHand(e);
    if (tool === 'text') {
      engine.seek(toFrame(x));
      actions.addText(0);
      return;
    }
    const linkedOn = u.linked !== e.altKey;
    const already = sel.has(c.id);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const ids = linkedOn ? withLinked(s, [c.id]) : [c.id];
      const now = already ? [...sel].filter((id) => !ids.includes(id)) : [...sel, ...ids];
      doc.select(now.length ? { kind: 'clips', ids: now } : null);
      return;
    }
    if (!already) doc.select({ kind: 'clips', ids: linkedOn ? withLinked(s, [c.id]) : [c.id] });
    const base = doc.project;
    const key = `drag-${Date.now()}`;
    if (edge && (tool === 'select' || tool === 'ripple' || tool === 'roll')) {
      const mode: TrimMode = tool === 'ripple' ? 'ripple' : tool === 'roll' || (e.ctrlKey && tool === 'select') ? 'roll' : 'normal';
      const at = edge === 'start' ? c.start : end(c);
      const skip = new Set(withLinked(s, [c.id]));
      drag(e, (dx) => {
        let d = Math.round(dx / zoom);
        if (u.snapping) {
          const snapped = nearest(pointsFor(skip), at + d, snapWithin);
          if (snapped !== null) d = snapped - at;
        }
        doc.edit(() => trim(base, c.id, edge, d, mode, linkedOn), mode === 'ripple' ? 'Ripple trim' : mode === 'roll' ? 'Roll edit' : 'Trim', key);
        engine.seek(at + d);
      });
      return;
    }
    if (tool === 'slip') {
      drag(e, (dx) => doc.edit(() => slip(base, c.id, -Math.round(dx / zoom)), 'Slip', key));
      return;
    }
    if (tool === 'slide') {
      drag(e, (dx) => doc.edit(() => slide(base, c.id, Math.round(dx / zoom)), 'Slide', key));
      return;
    }
    // Move (Alt: a copy).
    const ids = new Set(already ? [...sel] : linkedOn ? withLinked(s, [c.id]) : [c.id]);
    const moving = s.clips.filter((x) => ids.has(x.id));
    const startRow = rowAt(contentXY(e).y);
    const vIndex = (t: Track | undefined) => (t ? video.indexOf(t) : -1);
    const aIndex = (t: Track | undefined) => (t ? audio.indexOf(t) : -1);
    let moved = false;
    let last: Preview = null;
    drag(
      e,
      (dx, _dy, ev) => {
        if (!moved && Math.abs(dx) < 3 && Math.abs(_dy) < 3) return;
        moved = true;
        let frames = Math.round(dx / zoom);
        if (u.snapping) {
          const pts = pointsFor(ids);
          let best: number | null = null;
          for (const m of moving) {
            for (const edgeAt of [m.start, end(m)]) {
              const sn = nearest(pts, edgeAt + frames, snapWithin);
              if (sn !== null && (best === null || Math.abs(sn - edgeAt - frames) < Math.abs(best - frames))) best = sn - edgeAt;
            }
          }
          if (best !== null) frames = best;
        }
        const row = rowAt(contentXY(ev).y);
        let dv = 0;
        let da = 0;
        if (row && startRow && row.track.kind === startRow.track.kind) {
          if (row.track.kind === 'video') dv = vIndex(row.track) - vIndex(startRow.track);
          else da = aIndex(row.track) - aIndex(startRow.track);
        }
        last = { ids, frames, dv, da, copy: ev.altKey };
        setPreview(last);
      },
      () => {
        setPreview(null);
        const l = last as Preview;
        if (moved && l && (l.frames !== 0 || l.dv !== 0 || l.da !== 0 || l.copy)) {
          doc.edit((p) => moveClips(p, [...l.ids], { frames: l.frames, video: l.dv, audio: l.da }, l.copy), l.copy ? 'Copy clips' : 'Move clips');
        }
      },
    );
  };

  const startHand = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const x0 = el.scrollLeft;
    const y0 = el.scrollTop;
    drag(e, (dx, dy) => {
      el.scrollLeft = x0 - dx;
      el.scrollTop = y0 - dy;
    });
  };

  // ---- empty space: marquee, ruler scrub ----
  const onBackDown = (e: React.PointerEvent) => {
    if (e.button === 1) return startHand(e);
    if (e.button !== 0) return;
    const p0 = contentXY(e);
    if (u.tool === 'hand') return startHand(e);
    if (p0.y < RULER) return scrub(e);
    if (u.tool === 'text') {
      engine.seek(toFrame(p0.x));
      actions.addText(0);
      return;
    }
    if (!e.shiftKey) doc.select(null);
    drag(
      e,
      (_dx, _dy, ev) => {
        const p1 = contentXY(ev);
        setMarquee({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y });
      },
      (ev) => {
        const p1 = contentXY(ev);
        setMarquee(null);
        const [x0, x1] = [Math.min(p0.x, p1.x), Math.max(p0.x, p1.x)];
        const [y0, y1] = [Math.min(p0.y, p1.y), Math.max(p0.y, p1.y)];
        if (x1 - x0 < 3 && y1 - y0 < 3) {
          engine.pause();
          engine.seek(toFrame(p0.x));
          return;
        }
        const ids = s.clips
          .filter((c) => {
            const r = rows.find((x) => x.track.id === c.track);
            return r && c.start * zoom < x1 && end(c) * zoom > x0 && r.y < y1 && r.y + r.h > y0;
          })
          .map((c) => c.id);
        const all = e.shiftKey ? [...new Set([...sel, ...ids])] : ids;
        doc.select(all.length ? { kind: 'clips', ids: all } : null);
      },
    );
  };

  const scrub = (e: React.PointerEvent) => {
    engine.pause();
    const go = (ev: { clientX: number; clientY: number; shiftKey: boolean }) => {
      let f = toFrame(contentXY(ev).x);
      if (u.snapping !== ev.shiftKey) f = nearest(snapPoints(s, -1, new Set()), f, snapWithin) ?? f;
      engine.seek(f);
    };
    go(e);
    drag(e, (_dx, _dy, ev) => go(ev));
  };

  // ---- dropping media, effects and transitions ----
  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (
      !types.includes('application/x-lumora-media') &&
      !types.includes('application/x-lumora-seq') &&
      !types.includes('application/x-lumora-effect') &&
      !types.includes('application/x-lumora-transition')
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (types.includes('application/x-lumora-media') || types.includes('application/x-lumora-seq')) {
      const p = contentXY(e);
      let f = toFrame(p.x);
      if (u.snapping) f = nearest(pointsFor(new Set()), f, snapWithin) ?? f;
      const row = rowAt(p.y);
      if (row) setDropAt({ frame: f, track: row.track.id });
    }
  };
  const onDrop = (e: React.DragEvent) => {
    setDropAt(null);
    const p = contentXY(e);
    const row = rowAt(p.y);
    const mediaId = e.dataTransfer.getData('application/x-lumora-media');
    const seqId = e.dataTransfer.getData('application/x-lumora-seq');
    if (seqId) {
      e.preventDefault();
      let f = toFrame(p.x);
      if (u.snapping) f = nearest(pointsFor(new Set()), f, snapWithin) ?? f;
      const t = row?.track;
      const vTrack = t?.kind === 'video' ? t : (video.find((x) => !x.locked) ?? video[0]);
      const aTrack = t?.kind === 'audio' ? t : audio[0];
      if (seqId === s.id || contains(project, seqId, s.id)) {
        ui.note('A sequence can’t go inside itself');
        return;
      }
      doc.edit((q) => addSequenceClip(q, seqId, f, e.ctrlKey ? 'insert' : 'overwrite', vTrack?.id, aTrack?.id), 'Add sequence');
      return;
    }
    if (mediaId) {
      e.preventDefault();
      let f = toFrame(p.x);
      if (u.snapping) f = nearest(pointsFor(new Set()), f, snapWithin) ?? f;
      const t = row?.track;
      const vTrack = t?.kind === 'video' ? t : (video.find((x) => !x.locked) ?? video[0]);
      const vi = vTrack ? video.indexOf(vTrack) : 0;
      const aTrack = t?.kind === 'audio' ? t : (audio[Math.min(vi, audio.length - 1)] ?? audio[0]);
      actions.addMediaAt(mediaId, f, vTrack?.id, aTrack?.id, e.ctrlKey ? 'insert' : 'overwrite');
      return;
    }
    const clip = row ? s.clips.find((c) => c.track === row.track.id && toFrame(p.x) >= c.start && toFrame(p.x) < end(c)) : undefined;
    const effect = e.dataTransfer.getData('application/x-lumora-effect');
    if (effect && clip) {
      e.preventDefault();
      actions.addEffect(sel.has(clip.id) ? [...sel] : [clip.id], effect);
      return;
    }
    const transition = e.dataTransfer.getData('application/x-lumora-transition');
    if (transition && clip) {
      e.preventDefault();
      const f = toFrame(p.x);
      const nearStart = f - clip.start < end(clip) - f;
      const next = s.clips.find((o) => o.track === clip.track && o.start === end(clip));
      const length = Math.round(fps);
      if (nearStart) doc.edit((q) => setTransition(q, clip.id, 'in', { type: transition, length }), 'Add transition');
      else if (next) doc.edit((q) => setTransition(q, next.id, 'in', { type: transition, length }), 'Add transition');
      else doc.edit((q) => setTransition(q, clip.id, 'out', { type: transition, length }), 'Add transition');
    }
  };

  // ---- right-click ----
  const clipMenu = (e: React.MouseEvent, c: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sel.has(c.id)) doc.select({ kind: 'clips', ids: u.linked ? withLinked(s, [c.id]) : [c.id] });
    const src = c.source;
    const group = src.kind === 'multicam' ? project.groups.find((g) => g.id === src.group) : undefined;
    const isVideo = video.some((t) => t.id === c.track);
    const items: MenuEntry[] = [
      { label: 'Cut', keys: 'Ctrl+X', run: actions.cut },
      { label: 'Copy', keys: 'Ctrl+C', run: actions.copy },
      { label: 'Paste attributes', keys: 'Ctrl+Alt+V', run: actions.pasteAttributes },
      { label: 'Duplicate', keys: 'Ctrl+Shift+/', run: actions.duplicate },
      'sep',
      { label: 'Clear', keys: 'Delete', run: actions.del },
      { label: 'Ripple delete', keys: 'Shift+Delete', run: actions.rippleDelete },
      'sep',
      { label: c.enabled ? 'Disable' : 'Enable', keys: 'Shift+E', run: actions.toggleEnabled },
      c.link ? { label: 'Unlink', run: actions.unlink } : { label: 'Link', keys: 'Ctrl+L', run: actions.link, disabled: sel.size < 2 },
      { label: 'Speed / duration…', keys: 'Ctrl+R', run: () => ui.set({ dialog: 'speed' }) },
      {
        label: 'Transition',
        items: [
          {
            label: isVideo ? 'Cross dissolve in' : 'Crossfade in',
            run: () => doc.edit((q) => setTransition(q, c.id, 'in', { type: isVideo ? 'dissolve' : 'crossfade', length: Math.round(fps) }), 'Add transition'),
          },
          {
            label: isVideo ? 'Fade out at the end' : 'Fade out at the end',
            run: () => doc.edit((q) => setTransition(q, c.id, 'out', { type: isVideo ? 'dipblack' : 'crossfade', length: Math.round(fps) }), 'Add transition'),
          },
          {
            label: 'Remove transitions',
            disabled: !c.tIn && !c.tOut,
            run: () => actions.update([c.id], 'Remove transitions', (x) => ({ ...x, tIn: null, tOut: null })),
          },
        ],
      },
      ...(group
        ? [
            {
              label: 'Camera',
              items: group.angles.map((a, i) => ({
                label: `${i + 1}  ${a.name}`,
                checked: src.kind === 'multicam' && src.angle === a.id,
                run: () => doc.edit((q) => setAngle(q, c.id, a.id), 'Change camera'),
              })),
            },
          ]
        : []),
      {
        label: 'Label',
        items: [
          { label: 'As it was', run: () => actions.label(null) },
          ...LABELS.map((l, i) => ({
            label: ['Teal', 'Blue', 'Violet', 'Rust', 'Green', 'Rose', 'Slate', 'Brown', 'Red', 'Olive'][i] ?? l,
            run: () => actions.label(l),
          })),
        ],
      },
      { label: 'Remove effects', disabled: c.effects.length === 0, run: () => actions.update([...sel], 'Remove effects', (x) => ({ ...x, effects: [] })) },
      'sep',
      { label: 'Nest (put in a sequence of its own)', run: actions.nest },
      ...(c.source.kind === 'sequence' ? [{ label: 'Open the nested sequence', run: () => openNest(c) }] : []),
      ...(c.source.kind === 'media'
        ? [
            'sep' as const,
            {
              label: 'Open in source monitor',
              run: () => {
                const m = mediaOf(project, c);
                if (m)
                  ui.set({
                    source: { media: m.id, time: sourceTime(c, 0, fps), in: sourceTime(c, 0, fps), out: sourceTime(c, c.length, fps) },
                    sourceTab: 'source',
                  });
              },
            },
          ]
        : []),
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const openNest = (c: Clip) => {
    if (c.source.kind !== 'sequence') return;
    const id = c.source.seq;
    engine.pause();
    doc.quiet((q) => ({ ...q, open: id }));
    doc.select(null);
  };

  const backMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = contentXY(e);
    const row = rowAt(p.y);
    const f = toFrame(p.x);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Paste here', keys: 'Ctrl+V', run: () => (engine.seek(f), actions.paste()) },
        { label: 'Close gap', disabled: !row, run: () => (engine.seek(f), actions.rippleDelete()) },
        'sep',
        { label: 'Add text here', run: () => (engine.seek(f), actions.addText(0)) },
        { label: 'Add color here', run: () => (engine.seek(f), actions.addGenerated('color')) },
        { label: 'Add adjustment layer here', run: () => (engine.seek(f), actions.addGenerated('adjustment')) },
        { label: 'Add marker here', run: () => (engine.seek(f), actions.marker()) },
      ],
    });
  };

  const headerMenu = (e: React.MouseEvent, t: Track) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: `Add ${t.kind} track`, run: () => actions.addTrack(t.kind) },
        {
          label: 'Delete this track',
          disabled: (t.kind === 'video' ? video : audio).length <= 1,
          run: () => doc.edit((q) => removeTrack(q, t.id), 'Delete track'),
        },
        'sep',
        { label: t.locked ? 'Unlock' : 'Lock', run: () => doc.edit((q) => updateTrack(q, t.id, { locked: !t.locked }), 'Lock track') },
        { label: 'Taller', run: () => doc.edit((q) => updateTrack(q, t.id, { height: Math.min(160, t.height + 16) }), 'Track height') },
        { label: 'Shorter', run: () => doc.edit((q) => updateTrack(q, t.id, { height: Math.max(28, t.height - 16) }), 'Track height') },
      ],
    });
  };

  // ---- the view ----
  const visible = (c: Clip) => end(c) * zoom >= scroll.x - 50 && c.start * zoom <= scroll.x + size.w + 50;
  const offset = (c: Clip): { dx: number; track: string } => {
    if (!preview || !preview.ids.has(c.id) || preview.copy) return { dx: 0, track: c.track };
    const t = s.tracks.find((x) => x.id === c.track);
    let track = c.track;
    if (t?.kind === 'video' && preview.dv) track = video[Math.max(0, Math.min(video.length - 1, video.indexOf(t) + preview.dv))]?.id ?? c.track;
    if (t?.kind === 'audio' && preview.da) track = audio[Math.max(0, Math.min(audio.length - 1, audio.indexOf(t) + preview.da))]?.id ?? c.track;
    return { dx: preview.frames * zoom, track };
  };

  return (
    <div className="tl" data-tool={u.tool}>
      <div className="tl__tools">
        <SequenceTabs doc={doc} ui={ui} />
        <PlayheadTime engine={engine} fps={fps} />
        <div className="tl__toolset" role="toolbar" aria-label="Tools">
          {TOOLS.map(([t, icon, name, key]) => (
            <button
              key={t}
              type="button"
              className={`tl__tool${u.tool === t ? ' is-on' : ''}`}
              title={`${name} (${key})`}
              aria-label={name}
              aria-pressed={u.tool === t}
              onClick={() => actions.tool(t)}
            >
              {icon}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`tl__toggle${u.snapping ? ' is-on' : ''}`}
          title="Snapping (S): edges jump to cuts, the playhead and markers"
          aria-pressed={u.snapping}
          onClick={actions.snapping}
        >
          ⊓ Snap
        </button>
        <button
          type="button"
          className={`tl__toggle${u.linked ? ' is-on' : ''}`}
          title="Linked selection: picture and its sound are picked together"
          aria-pressed={u.linked}
          onClick={actions.linkedSelection}
        >
          Linked
        </button>
        <button type="button" className="tl__toggle" title="Add a marker (M)" onClick={actions.marker}>
          ▾ Marker
        </button>
        <span className="tl__fill" />
        <span className="tl__len">{duration(len / fps)}</span>
        <button type="button" className="tbtn" aria-label="Zoom out" title="Zoom out (-)" onClick={() => actions.zoom(1 / 1.5)}>
          −
        </button>
        <input
          className="tl__zoom"
          type="range"
          min={-5.3}
          max={3.7}
          step={0.01}
          value={Math.log(zoom)}
          aria-label="Zoom"
          onChange={(e) => ui.set({ zoom: Math.exp(Number(e.target.value)) })}
        />
        <button type="button" className="tbtn" aria-label="Zoom in" title="Zoom in (=)" onClick={() => actions.zoom(1.5)}>
          +
        </button>
        <button type="button" className="btn btn--sm" title="See the whole sequence (\)" onClick={() => actions.zoomToFit(size.w)}>
          Fit
        </button>
      </div>
      <div className="tl__body">
        <div className="tl__heads" style={{ width: HEAD, transform: `translateY(${-scroll.y}px)` }}>
          <div className="tl__corner" style={{ height: RULER }} />
          {rows.map((r) => (
            <TrackHead key={r.track.id} track={r.track} h={r.h} gapAfter={r.track === video[0]} doc={doc} ui={ui} onMenu={(e) => headerMenu(e, r.track)} />
          ))}
        </div>
        <div
          className="tl__scroll"
          ref={scrollRef}
          onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
          onWheel={(e) => {
            const el = scrollRef.current;
            if (!el) return;
            if (e.ctrlKey || e.altKey) {
              e.preventDefault();
              const at = contentXY(e).x / zoom;
              const before = at * zoom - el.scrollLeft;
              const nz = Math.max(0.005, Math.min(40, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
              ui.set({ zoom: nz });
              lastZoom.current = nz;
              requestAnimationFrame(() => (el.scrollLeft = Math.max(0, at * nz - before)));
            } else if (e.shiftKey || rowsH <= el.clientHeight) {
              el.scrollLeft += e.deltaY + e.deltaX;
            }
          }}
          onPointerDown={onBackDown}
          onContextMenu={backMenu}
          onDragOver={onDragOver}
          onDragLeave={() => setDropAt(null)}
          onDrop={onDrop}
        >
          <div className="tl__content" style={{ width: contentW, height: rowsH }}>
            <Ruler s={s} zoom={zoom} fps={fps} from={scroll.x} width={size.w} doc={doc} engine={engine} />
            {rows.map((r) => (
              <div
                key={r.track.id}
                className={`tl__row tl__row--${r.track.kind}${r.track.locked ? ' is-locked' : ''}${r.track.off ? ' is-off' : ''}`}
                style={{ top: r.y, height: r.h }}
              />
            ))}
            {s.inPoint !== null || s.outPoint !== null ? (
              <div
                className="tl__range"
                style={{ left: (s.inPoint ?? 0) * zoom, width: Math.max(1, ((s.outPoint ?? len) - (s.inPoint ?? 0)) * zoom), height: rowsH }}
              />
            ) : null}
            {s.clips.filter(visible).map((c) => {
              const o = offset(c);
              const r = rows.find((x) => x.track.id === o.track);
              if (!r) return null;
              return (
                <ClipBox
                  key={c.id}
                  p={project}
                  c={c}
                  x={c.start * zoom + o.dx}
                  y={r.y}
                  h={r.h}
                  zoom={zoom}
                  fps={fps}
                  kind={r.track.kind}
                  selected={sel.has(c.id)}
                  view={[scroll.x, scroll.x + size.w]}
                  peaks={r.track.kind === 'audio' ? peaksOf((mediaOf(project, c)?.proxy ?? mediaOf(project, c)?.path) || '') : null}
                  onDown={onClipDown}
                  onMenu={clipMenu}
                  onOpen={openNest}
                  onGain={(db, final) => actions.update([c.id], 'Clip volume', (x) => ({ ...x, gain: db }), final ? undefined : `gain-${c.id}`)}
                  onTransition={(side) => doc.select({ kind: 'transition', clip: c.id, side })}
                  transitionSelected={selection?.kind === 'transition' && selection.clip === c.id ? selection.side : null}
                  tool={u.tool}
                />
              );
            })}
            {preview?.copy &&
              s.clips
                .filter((c) => preview.ids.has(c.id))
                .map((c) => {
                  const t = s.tracks.find((x) => x.id === c.track);
                  const list = t?.kind === 'video' ? video : audio;
                  const d = t?.kind === 'video' ? preview.dv : preview.da;
                  const tt = t ? list[Math.max(0, Math.min(list.length - 1, list.indexOf(t) + d))] : undefined;
                  const r = rows.find((x) => x.track.id === tt?.id);
                  return r ? (
                    <div
                      key={`ghost-${c.id}`}
                      className="tl__ghost"
                      style={{ left: (c.start + preview.frames) * zoom, top: r.y + 2, width: c.length * zoom, height: r.h - 4 }}
                    />
                  ) : null;
                })}
            {dropAt &&
              (() => {
                const r = rows.find((x) => x.track.id === dropAt.track);
                return r ? <div className="tl__drop" style={{ left: dropAt.frame * zoom, top: r.y, height: r.h }} /> : null;
              })()}
            {marquee && (
              <div
                className="tl__marquee"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}
            <Playhead engine={engine} zoom={zoom} height={rowsH} scrollRef={scrollRef} />
          </div>
        </div>
        <Meters engine={engine} />
      </div>
      {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function SequenceTabs({ doc, ui }: { doc: Doc; ui: Ui }) {
  const { project } = useDoc(doc);
  if (project.sequences.length < 2)
    return (
      <button type="button" className="tl__seq" title="Sequence settings" onClick={() => ui.set({ dialog: 'sequence' })}>
        {current(project).name}
      </button>
    );
  return (
    <select
      className="tl__seqs"
      aria-label="Sequence"
      value={project.open}
      onChange={(e) => {
        const id = e.target.value;
        doc.quiet((p) => ({ ...p, open: id }));
      }}
    >
      {project.sequences.map((sq) => (
        <option key={sq.id} value={sq.id}>
          {sq.name}
        </option>
      ))}
    </select>
  );
}

export function PlayheadTime({ engine, fps, big }: { engine: Engine; fps: number; big?: boolean }) {
  const t = usePlayhead(engine);
  const [text, setText] = useState<string | null>(null);
  if (text !== null)
    return (
      <input
        className={`tc tc--edit${big ? ' tc--big' : ''}`}
        autoFocus
        aria-label="Go to time"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setText(null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') setText(null);
          if (e.key === 'Enter') {
            const f = parseTimecode(text, fps, t);
            if (f !== null) {
              engine.pause();
              engine.seek(f);
            }
            setText(null);
          }
        }}
      />
    );
  return (
    <button
      type="button"
      className={`tc${big ? ' tc--big' : ''}`}
      title="Click to type a time (e.g. 1:30, or +10 for ten frames on)"
      onClick={() => setText(timecode(t, fps))}
    >
      {timecode(t, fps)}
    </button>
  );
}

function TrackHead({
  track: t,
  h,
  gapAfter,
  doc,
  ui,
  onMenu,
}: {
  track: Track;
  h: number;
  gapAfter: boolean;
  doc: Doc;
  ui: Ui;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const u = useUi(ui);
  const [name, setName] = useState<string | null>(null);
  const set = (change: Partial<Track>, label: string) => doc.edit((p) => updateTrack(p, t.id, change), label);
  const targeted = t.kind === 'video' ? u.targetVideo === t.id : u.targetAudio === t.id;
  return (
    <div className={`th th--${t.kind}${t.locked ? ' is-locked' : ''}`} style={{ height: h, marginBottom: gapAfter ? 6 : 0 }} onContextMenu={onMenu}>
      <button
        type="button"
        className={`th__target${targeted ? ' is-on' : ''}`}
        title="Target: Insert and Overwrite put clips on this track"
        aria-pressed={targeted}
        onClick={() => ui.set(t.kind === 'video' ? { targetVideo: targeted ? null : t.id } : { targetAudio: targeted ? null : t.id })}
      >
        {t.kind === 'video' ? 'V' : 'A'}
      </button>
      {name !== null ? (
        <input
          className="th__name th__name--edit"
          autoFocus
          value={name}
          aria-label="Track name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim()) set({ name: name.trim() }, 'Rename track');
            setName(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <span className="th__name" title={`${t.name} (double-click to rename)`} onDoubleClick={() => setName(t.name)}>
          {t.name}
        </span>
      )}
      <span className="th__btns">
        <button
          type="button"
          className={`th__btn${t.locked ? ' is-on' : ''}`}
          title={t.locked ? 'Unlock' : 'Lock (nothing on it changes)'}
          aria-pressed={t.locked}
          onClick={() => set({ locked: !t.locked }, 'Lock track')}
        >
          {t.locked ? 'Locked' : 'Lock'}
        </button>
        {t.kind === 'video' ? (
          <button
            type="button"
            className={`th__btn${t.off ? ' is-on' : ''}`}
            title={t.off ? 'Show this track' : 'Hide this track'}
            aria-pressed={t.off}
            onClick={() => set({ off: !t.off }, 'Hide track')}
          >
            {t.off ? '◌' : '◉'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`th__btn th__btn--m${t.off ? ' is-on' : ''}`}
              title="Mute"
              aria-pressed={t.off}
              onClick={() => set({ off: !t.off }, 'Mute track')}
            >
              M
            </button>
            <button
              type="button"
              className={`th__btn th__btn--s${t.solo ? ' is-on' : ''}`}
              title="Solo (hear only this)"
              aria-pressed={t.solo}
              onClick={() => set({ solo: !t.solo }, 'Solo track')}
            >
              S
            </button>
          </>
        )}
      </span>
      {t.kind === 'audio' && h >= 40 && (
        <span className="th__vol">
          <Scrub
            value={t.volume}
            min={-60}
            max={12}
            step={0.5}
            unit="dB"
            label={`${t.name} volume`}
            onChange={(v, final) => doc.edit((p) => updateTrack(p, t.id, { volume: v }), 'Track volume', final ? undefined : `vol-${t.id}`)}
          />
        </span>
      )}
    </div>
  );
}

const ClipBox = memo(function ClipBox({
  p,
  c,
  x,
  y,
  h,
  zoom,
  fps,
  kind,
  selected,
  view,
  peaks,
  onDown,
  onMenu,
  onOpen,
  onGain,
  onTransition,
  transitionSelected,
  tool,
}: {
  p: Project;
  c: Clip;
  x: number;
  y: number;
  h: number;
  zoom: number;
  fps: number;
  kind: 'video' | 'audio';
  selected: boolean;
  view: [number, number];
  peaks: Uint8Array | null;
  onDown: (e: React.PointerEvent, c: Clip) => void;
  onMenu: (e: React.MouseEvent, c: Clip) => void;
  onOpen: (c: Clip) => void;
  onGain: (db: number, final: boolean) => void;
  onTransition: (side: 'in' | 'out') => void;
  transitionSelected: 'in' | 'out' | null;
  tool: Tool;
}) {
  const w = Math.max(2, c.length * zoom);
  const color = kind === 'audio' && !c.label ? '#3f8f5a' : clipColor(p, c);
  const m = mediaOf(p, c);
  // Only the part on screen is drawn in detail.
  const visFrom = Math.max(0, view[0] - x - 40);
  const visTo = Math.min(w, view[1] - x + 40);
  const fx = c.effects.length > 0;
  const gain = valueAt(c.gain, 0);
  const gainY = (db: number) => {
    const g = Math.min(1, Math.sqrt(dbToGain(db) / dbToGain(12)));
    return h - 4 - g * (h - 10);
  };
  const half = c.tIn ? Math.floor(c.tIn.length / 2) : 0;
  const src = c.source;
  const angleOffset = src.kind === 'multicam' ? (p.groups.find((g) => g.id === src.group)?.angles.find((a) => a.id === src.angle)?.offset ?? 0) : 0;
  return (
    <div
      className={`clip clip--${kind}${selected ? ' is-sel' : ''}${c.enabled ? '' : ' is-off'}`}
      data-clip={c.id}
      style={{ left: x, top: y + 2, width: w, height: h - 4, ['--clip' as string]: color }}
      onPointerDown={(e) => onDown(e, c)}
      onContextMenu={(e) => onMenu(e, c)}
      onDoubleClick={() => onOpen(c)}
      onPointerMove={(e) => {
        if (tool !== 'select' && tool !== 'ripple' && tool !== 'roll') return;
        const local = e.nativeEvent.offsetX;
        const el = e.currentTarget;
        const edge = w > 18 && (local < EDGE || local > w - EDGE);
        el.style.cursor = edge ? (tool === 'ripple' ? 'w-resize' : tool === 'roll' ? 'col-resize' : 'ew-resize') : '';
      }}
    >
      {kind === 'video' && m && m.kind !== 'audio' && h >= 34 && w > 40 && (
        <Thumbs c={c} m={m} fps={fps} zoom={zoom} h={h - 4} from={visFrom} to={visTo} offset={angleOffset} />
      )}
      {kind === 'audio' && peaks && <Wave c={c} m={m} peaks={peaks} fps={fps} zoom={zoom} h={h - 4} from={visFrom} to={visTo} />}
      <span className="clip__name" style={{ left: Math.max(4, visFrom - 36) }}>
        {fx && (
          <b className="clip__fx" title="Has effects">
            fx
          </b>
        )}
        {c.speed !== 1 || c.reverse ? (
          <b className="clip__fx">
            {c.reverse ? '◂ ' : ''}
            {Math.round(c.speed * 100)}%
          </b>
        ) : null}
        {c.name}
      </span>
      {kind === 'audio' && h >= 30 && typeof c.gain === 'number' && (
        <div
          className="clip__gain"
          style={{ top: gainY(gain) }}
          title={`Volume ${gain.toFixed(1)} dB (drag up or down)`}
          onPointerDown={(e) => {
            if (e.button !== 0 || tool !== 'select') return;
            e.stopPropagation();
            const y0 = e.clientY;
            const start = gain;
            const move = (ev: PointerEvent) => onGain(Math.max(-60, Math.min(12, Math.round((start - (ev.clientY - y0) * 0.4) * 2) / 2)), false);
            const up = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              onGain(Math.max(-60, Math.min(12, Math.round((start - (ev.clientY - y0) * 0.4) * 2) / 2)), true);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        />
      )}
      {c.tIn && (
        <button
          type="button"
          className={`clip__tr${transitionSelected === 'in' ? ' is-sel' : ''}`}
          style={{ left: -half * zoom, width: Math.max(8, c.tIn.length * zoom) }}
          title={`${transitionDef(c.tIn.type)?.name ?? 'Transition'} · ${(c.tIn.length / fps).toFixed(2)} s`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onTransition('in');
          }}
        >
          {transitionDef(c.tIn.type)?.name ?? ''}
        </button>
      )}
      {c.tOut && (
        <button
          type="button"
          className={`clip__tr${transitionSelected === 'out' ? ' is-sel' : ''}`}
          style={{ right: 0, width: Math.max(8, c.tOut.length * zoom) }}
          title={`${transitionDef(c.tOut.type)?.name ?? 'Transition'} · ${(c.tOut.length / fps).toFixed(2)} s`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onTransition('out');
          }}
        >
          {transitionDef(c.tOut.type)?.name ?? ''}
        </button>
      )}
    </div>
  );
});

function Thumbs({
  c,
  m,
  fps,
  zoom,
  h,
  from,
  to,
  offset,
}: {
  c: Clip;
  m: MediaItem;
  fps: number;
  zoom: number;
  h: number;
  from: number;
  to: number;
  offset: number;
}) {
  const strip = useStrip(m.kind === 'video' ? (m.proxy ?? m.path) : null, m.duration);
  if (m.kind === 'image')
    return (
      <div className="clip__thumbs">
        <img className="clip__still" src={mediaUrl(m.proxy ?? m.path)} alt="" style={{ height: h }} />
      </div>
    );
  if (!strip) return null;
  const tw = (h * 16) / 9;
  const slots: number[] = [];
  for (let px = Math.floor(from / tw) * tw; px < to; px += tw) slots.push(px);
  return (
    <div className="clip__thumbs">
      {slots.map((px) => {
        const t = sourceTime(c, Math.floor(px / zoom), fps) - offset;
        if (t < 0 || t > m.duration) return null;
        const i = Math.min(strip.count - 1, Math.floor(t / strip.every));
        return <i key={px} style={thumbStyle(strip, i, px, tw, h)} />;
      })}
    </div>
  );
}

function thumbStyle(s: Strip, i: number, left: number, w: number, h: number): React.CSSProperties {
  const k = h / s.h;
  return {
    left,
    width: w,
    height: h,
    backgroundImage: `url("${mediaUrl(s.path)}")`,
    backgroundSize: `${s.cols * s.w * k}px auto`,
    backgroundPosition: `${-(i % s.cols) * s.w * k - (s.w * k - w) / 2}px ${-Math.floor(i / s.cols) * s.h * k}px`,
  };
}

function Wave({
  c,
  m,
  peaks,
  fps,
  zoom,
  h,
  from,
  to,
}: {
  c: Clip;
  m: MediaItem | undefined;
  peaks: Uint8Array;
  fps: number;
  zoom: number;
  h: number;
  from: number;
  to: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.round(to - from));
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !m) return;
    cv.width = width;
    cv.height = h;
    ctx.clearRect(0, 0, width, h);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const mid = h / 2;
    for (let px = 0; px < width; px++) {
      const f0 = (from + px) / zoom;
      const f1 = (from + px + 1) / zoom;
      const t0 = sourceTime(c, Math.floor(f0), fps);
      const t1 = sourceTime(c, Math.ceil(f1), fps);
      let a = Math.floor(Math.min(t0, t1) * 100);
      const b = Math.max(a + 1, Math.ceil(Math.max(t0, t1) * 100));
      let peak = 0;
      for (; a < b; a++) peak = Math.max(peak, peaks[a] ?? 0);
      const v = (peak / 255) * (h / 2 - 2);
      ctx.fillRect(px, mid - v, 1, v * 2);
    }
  }, [c, m, peaks, fps, zoom, h, from, width]);
  return <canvas ref={ref} className="clip__wave" style={{ left: from, width, height: h }} />;
}

function Ruler({
  s,
  zoom,
  fps,
  from,
  width,
  doc,
  engine,
}: {
  s: ReturnType<typeof current>;
  zoom: number;
  fps: number;
  from: number;
  width: number;
  doc: Doc;
  engine: Engine;
}) {
  // A tick every so many frames, so labels never crowd.
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000, 108000];
  const minPx = 90;
  const stepF = (steps.find((st) => st * zoom >= minPx) ?? 108000) * (fps >= 50 ? 2 : 1);
  const first = Math.floor(from / zoom / stepF) * stepF;
  const ticks: number[] = [];
  for (let f = first; f * zoom < from + width + stepF * zoom; f += stepF) ticks.push(f);
  const small = stepF / 5;
  return (
    <div className="ruler" style={{ height: RULER }}>
      {ticks.map((f) => (
        <span key={f} className="ruler__tick" style={{ left: f * zoom }}>
          {rulerLabel(f, fps, stepF)}
        </span>
      ))}
      {small * zoom >= 8 &&
        ticks.flatMap((f) => [1, 2, 3, 4].map((i) => <i key={`${f}-${i}`} className="ruler__minor" style={{ left: (f + small * i) * zoom }} />))}
      {s.markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className="ruler__marker"
          style={{ left: m.at * zoom, ['--mk' as string]: m.color }}
          title={m.name || 'Marker'}
          onPointerDown={(e) => {
            e.stopPropagation();
            doc.select({ kind: 'marker', id: m.id });
            engine.seek(m.at);
            const key = `marker-${m.id}-${Date.now()}`;
            drag(e, (dx) => {
              const at = Math.max(0, m.at + Math.round(dx / zoom));
              doc.edit((p) => updateMarker(p, m.id, { at }), 'Move marker', key);
              engine.seek(at);
            });
          }}
        >
          {m.name && zoom * 60 > m.name.length * 6 ? <span>{m.name}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** "1:05" when the ticks are seconds apart, "1:05:12" (with the frame) when closer. */
function rulerLabel(f: number, fps: number, step: number): string {
  const base = Math.round(fps);
  const secs = Math.floor(f / base);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const ss = String(secs % 60).padStart(2, '0');
  const time = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return step < base ? `${time}:${String(f % base).padStart(2, '0')}` : time;
}

function Playhead({ engine, zoom, height, scrollRef }: { engine: Engine; zoom: number; height: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const t = usePlayhead(engine);
  const playing = usePlaying(engine);
  const x = t * zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    // Page along with the playhead while playing.
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 60;
    else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 60);
  }, [x, playing, scrollRef]);
  return <div className="tl__playhead" style={{ transform: `translateX(${x}px)`, height }} />;
}

/** The overall sound level, left and right. */
function Meters({ engine }: { engine: Engine }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const peaks = [-90, -90];
    const holds = [-90, -90];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const h = cv.clientHeight;
      if (cv.height !== h) cv.height = h;
      const lv = engine.levels().master ?? [-90, -90];
      ctx.clearRect(0, 0, cv.width, h);
      lv.forEach((db, i) => {
        peaks[i] = Math.max(db, (peaks[i] ?? -90) - 1.2);
        holds[i] = Math.max(db, (holds[i] ?? -90) - 0.25);
        const y = (d: number) => h - (Math.max(0, d + 60) / 66) * h;
        const x = 3 + i * 9;
        ctx.fillStyle = '#20242a';
        ctx.fillRect(x, 0, 7, h);
        const top = y(peaks[i] ?? -90);
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, '#2f8f4e');
        grad.addColorStop(0.75, '#c9b23a');
        grad.addColorStop(0.92, '#d2453a');
        ctx.fillStyle = grad;
        ctx.fillRect(x, top, 7, h - top);
        ctx.fillStyle = (holds[i] ?? -90) > -1 ? '#ff4b3e' : '#e8e8e8';
        ctx.fillRect(x, y(holds[i] ?? -90), 7, 1.5);
      });
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [engine]);
  return (
    <div className="meters" title="Sound level (left, right)">
      <canvas ref={ref} width={22} />
      <div className="meters__scale">
        {[0, -6, -12, -24, -36, -48].map((d) => (
          <span key={d} style={{ bottom: `${((d + 60) / 66) * 100}%` }}>
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}
