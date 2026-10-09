// Every command in Lumora Studio, in one place: the menus, the buttons and the
// keyboard all use these.
import { addGenerated, addGenerator, addMedia, addText, STILL_SECONDS } from '../model/build';
import {
  addMarker,
  addTrack,
  clipsAt,
  closeGap,
  copyClips,
  editPoints,
  extractRange,
  lift,
  liftRange,
  link,
  moveClips,
  nest,
  paste,
  pasteAttributes,
  razor,
  rippleDelete,
  rippleTrimTo,
  setSpeed,
  switchAngle,
  transitionAtPlayhead,
  unlink,
  updateClips,
  withLinked,
  type Clipboard,
} from '../model/edit';
import { effectDef, newEffect } from '../model/effects';
import { current, editSeq, end, rate, seqLength } from '../model/seq';
import type { Clip, Project } from '../model/types';
import type { Engine } from '../player/engine';
import { TEXT_PRESETS } from '../render/text';
import { addTemplate, templateById } from '../model/templates';
import { addShape } from '../model/shapes';
import { addTitlerClip } from '../titler/titlerClip';
import type { TitleProject } from '../../../../titler/src/core/types';
import type { ShapeData } from '../model/types';
import { selectedIds, type Doc } from '../doc';
import type { Tool, Ui } from './state';
import { chooseAndImport } from './importer';

export type Actions = ReturnType<typeof makeActions>;

export function makeActions(doc: Doc, engine: Engine, ui: Ui) {
  let board: Clipboard | null = null;
  const seq = () => current(doc.project);
  const fps = () => rate(seq());
  const here = () => Math.floor(engine.time);
  const selected = () => selectedIds(doc.state.selection);
  const targets = () => {
    const s = seq();
    const v =
      ui.state.targetVideo && s.tracks.some((t) => t.id === ui.state.targetVideo)
        ? ui.state.targetVideo
        : (s.tracks.find((t) => t.kind === 'video' && !t.locked)?.id ?? null);
    const a =
      ui.state.targetAudio && s.tracks.some((t) => t.id === ui.state.targetAudio)
        ? ui.state.targetAudio
        : (s.tracks.find((t) => t.kind === 'audio' && !t.locked)?.id ?? null);
    return { v, a };
  };
  const unlockedTracks = () =>
    seq()
      .tracks.filter((t) => !t.locked)
      .map((t) => t.id);
  const edit = (label: string, f: (p: Project) => Project, key?: string) => doc.edit(f, label, key);
  const selectWithLinks = (ids: string[]) => (ui.state.linked ? withLinked(seq(), ids) : ids);

  const a = {
    // ---- playing ----
    toggle: () => engine.toggle(),
    shuttle: (dir: 1 | -1) => engine.shuttle(dir),
    stop: () => engine.pause(),
    step: (n: number) => engine.step(n),
    seek: (f: number) => {
      engine.pause();
      engine.seek(f);
    },
    home: () => a.seek(0),
    endOf: () => a.seek(seqLength(seq())),
    /** The cut before or after the playhead. */
    toEdit: (dir: 1 | -1) => {
      const pts = editPoints(seq());
      const t = here();
      const to = dir > 0 ? pts.find((x) => x > t) : [...pts].reverse().find((x) => x < t);
      if (to !== undefined) a.seek(to);
    },
    toMarker: (dir: 1 | -1) => {
      const t = here();
      const ms = seq().markers.map((m) => m.at);
      const to = dir > 0 ? ms.filter((x) => x > t).sort((x, y) => x - y)[0] : ms.filter((x) => x < t).sort((x, y) => y - x)[0];
      if (to !== undefined) a.seek(to);
    },
    toIn: () => {
      const i = seq().inPoint;
      if (i !== null) a.seek(i);
    },
    toOut: () => {
      const o = seq().outPoint;
      if (o !== null) a.seek(o);
    },
    playInToOut: () => {
      const s = seq();
      if (s.inPoint === null) return;
      engine.loop = false;
      engine.seek(s.inPoint);
      engine.play();
    },
    toggleLoop: () => {
      engine.loop = !engine.loop;
      ui.note(engine.loop ? 'Loop on: plays the marked part over and over' : 'Loop off');
    },

    // ---- marks ----
    markIn: () =>
      edit('Mark in', (p) => editSeq(p, (s) => ({ ...s, inPoint: here(), outPoint: s.outPoint !== null && s.outPoint <= here() ? null : s.outPoint }))),
    markOut: () =>
      edit('Mark out', (p) => editSeq(p, (s) => ({ ...s, outPoint: here() + 1, inPoint: s.inPoint !== null && s.inPoint > here() ? null : s.inPoint }))),
    markClip: () => {
      const s = seq();
      const c = clipsAt(
        s,
        here(),
        s.tracks.filter((t) => t.kind === 'video').map((t) => t.id),
      ).sort((x, y) => y.start - x.start)[0];
      if (c) edit('Mark clip', (p) => editSeq(p, (q) => ({ ...q, inPoint: c.start, outPoint: end(c) })));
    },
    clearMarks: () => edit('Clear in and out', (p) => editSeq(p, (s) => ({ ...s, inPoint: null, outPoint: null }))),
    marker: () => {
      let id = '';
      edit('Add marker', (p) => {
        const r = addMarker(p, here());
        id = r.id;
        return r.project;
      });
      if (id) doc.select({ kind: 'marker', id });
    },

    // ---- cutting ----
    /** Add an edit at the playhead (on targeted… here: every unlocked track with something there). */
    addEdit: (allTracks = false) => {
      const s = seq();
      const ids = selected();
      const tracks = allTracks || ids.length === 0 ? unlockedTracks() : [...new Set(s.clips.filter((c) => ids.includes(c.id)).map((c) => c.track))];
      edit('Add edit', (p) => razor(p, here(), tracks));
    },
    razorAt: (clip: string, frame: number, all: boolean) => {
      const s = seq();
      edit('Razor', (p) =>
        all
          ? razor(p, frame)
          : razor(
              p,
              frame,
              null,
              selectWithLinks([clip]).filter((id) => s.clips.some((c) => c.id === id)),
            ),
      );
    },
    rippleTrim: (side: 'start' | 'end') =>
      edit(side === 'start' ? 'Ripple trim start' : 'Ripple trim end', (p) => rippleTrimTo(p, here(), side, unlockedTracks())),
    /** Delete: take out what is selected (the gap stays). */
    del: () => {
      const s = doc.state.selection;
      if (s?.kind === 'clips') edit('Clear', (p) => lift(p, selectWithLinks(s.ids)));
      else if (s?.kind === 'marker') edit('Delete marker', (p) => editSeq(p, (q) => ({ ...q, markers: q.markers.filter((m) => m.id !== s.id) })));
      else if (s?.kind === 'transition')
        edit('Delete transition', (p) => updateClips(p, [s.clip], (c) => (s.side === 'in' ? { ...c, tIn: null } : { ...c, tOut: null })));
    },
    rippleDelete: () => {
      const ids = selected();
      if (ids.length) edit('Ripple delete', (p) => rippleDelete(p, selectWithLinks(ids)));
      else {
        const s = seq();
        const t = s.tracks.find((x) => x.id === targets().v);
        if (t) edit('Close gap', (p) => closeGap(p, t.id, here()));
      }
    },
    liftMarked: () => {
      const s = seq();
      if (s.inPoint === null || s.outPoint === null) return ui.note('Mark an in (I) and out (O) first');
      const { inPoint, outPoint } = s;
      edit('Lift', (p) => liftRange(p, inPoint, outPoint, unlockedTracks()));
    },
    extractMarked: () => {
      const s = seq();
      if (s.inPoint === null || s.outPoint === null) return ui.note('Mark an in (I) and out (O) first');
      const { inPoint, outPoint } = s;
      edit('Extract', (p) => editSeq(extractRange(p, inPoint, outPoint), (q) => ({ ...q, outPoint: null })));
      engine.seek(inPoint);
    },
    nudge: (frames: number) => {
      const ids = selected();
      if (ids.length) edit('Nudge', (p) => moveClips(p, selectWithLinks(ids), { frames, video: 0, audio: 0 }), 'nudge');
    },

    // ---- clipboard ----
    copy: () => {
      const ids = selected();
      if (ids.length) {
        board = copyClips(seq(), selectWithLinks(ids));
        ui.note(`Copied ${board.clips.length} clip${board.clips.length === 1 ? '' : 's'}`);
      }
    },
    cut: () => {
      a.copy();
      a.rippleDelete();
    },
    paste: (insert = false) => {
      if (!board) return;
      const b = board;
      const len = Math.max(...b.clips.map((c) => c.start + c.length));
      edit(insert ? 'Paste insert' : 'Paste', (p) => paste(p, b, here(), insert ? 'insert' : 'overwrite'));
      engine.seek(here() + len);
    },
    pasteAttributes: () => {
      const from = board?.clips[0];
      const ids = selected();
      if (from && ids.length) edit('Paste attributes', (p) => pasteAttributes(p, from, ids));
    },
    duplicate: () => {
      const ids = selected();
      if (!ids.length) return;
      const s = seq();
      const all = selectWithLinks(ids);
      const last = Math.max(...s.clips.filter((c) => all.includes(c.id)).map(end));
      const first = Math.min(...s.clips.filter((c) => all.includes(c.id)).map((c) => c.start));
      edit('Duplicate', (p) => moveClips(p, all, { frames: last - first, video: 0, audio: 0 }, true));
    },

    // ---- selection ----
    selectAll: () => doc.select({ kind: 'clips', ids: seq().clips.map((c) => c.id) }),
    deselect: () => doc.select(null),
    selectAtPlayhead: () => {
      const s = seq();
      doc.select({
        kind: 'clips',
        ids: clipsAt(
          s,
          here(),
          s.tracks.map((t) => t.id),
        ).map((c) => c.id),
      });
    },
    selectForward: () =>
      doc.select({
        kind: 'clips',
        ids: seq()
          .clips.filter((c) => c.start >= here())
          .map((c) => c.id),
      }),
    select: (ids: string[], add = false) => {
      const withLinks = selectWithLinks(ids);
      const now = add ? [...new Set([...selected(), ...withLinks])] : withLinks;
      doc.select(now.length ? { kind: 'clips', ids: now } : null);
    },

    // ---- clips ----
    toggleEnabled: () => {
      const ids = selected();
      if (ids.length) edit('Enable', (p) => updateClips(p, selectWithLinks(ids), (c) => ({ ...c, enabled: !c.enabled })));
    },
    link: () => {
      const ids = selected();
      if (ids.length < 2) return;
      const s = seq();
      const linked = s.clips.filter((c) => ids.includes(c.id)).every((c) => c.link && c.link === s.clips.find((x) => x.id === ids[0])?.link);
      edit(linked ? 'Unlink' : 'Link', (p) => (linked ? unlink(p, ids) : link(p, ids)));
    },
    unlink: () => {
      const ids = selected();
      if (ids.length) edit('Unlink', (p) => unlink(p, withLinked(seq(), ids)));
    },
    speed: (id: string, speed: number, ripple: boolean, reverse?: boolean) => {
      edit('Speed', (p) => {
        const q = setSpeed(p, id, speed, ripple);
        return reverse === undefined ? q : updateClips(q, withLinked(current(q), [id]), (c) => ({ ...c, reverse }));
      });
    },
    label: (color: string | null) => {
      const ids = selected();
      if (ids.length) edit('Label', (p) => updateClips(p, ids, (c) => ({ ...c, label: color })));
    },
    rename: (id: string, name: string) => edit('Rename clip', (p) => updateClips(p, [id], (c) => ({ ...c, name }))),
    update: (ids: string[], label: string, f: (c: Clip) => Clip, key?: string) => edit(label, (p) => updateClips(p, ids, f), key),
    addEffect: (ids: string[], type: string) => {
      if (!ids.length) return ui.note('Select a clip first');
      // Picture effects go on picture clips, sound effects on sound clips.
      const kind = effectDef(type)?.kind ?? 'video';
      const s = seq();
      const fit = ids.filter((id) => {
        const c = s.clips.find((x) => x.id === id);
        const t = c && s.tracks.find((x) => x.id === c.track);
        return t?.kind === kind;
      });
      // A picture clip selected for a sound effect: its linked sound gets it.
      const targets = fit.length
        ? fit
        : withLinked(s, ids).filter((id) => s.tracks.find((t) => t.id === s.clips.find((c) => c.id === id)?.track)?.kind === kind);
      if (!targets.length) return ui.note(kind === 'audio' ? 'Select a clip with sound first' : 'Select a picture clip first');
      edit('Add effect', (p) => updateClips(p, targets, (c) => ({ ...c, effects: [...c.effects, newEffect(type)] })));
    },
    transition: (kind: 'video' | 'audio', type?: string) => {
      const t = type ?? (kind === 'video' ? 'dissolve' : 'crossfade');
      const len = Math.round(fps());
      edit('Add transition', (p) => transitionAtPlayhead(p, here(), kind, t, len));
    },
    switchAngle: (angle: string) => edit('Switch camera', (p) => switchAngle(p, here(), angle)),
    /** 1–9: the camera of that number in the multicam clip at the playhead. */
    switchAngleNumber: (n: number) => {
      const s = seq();
      const c = s.clips.find((x) => x.source.kind === 'multicam' && here() >= x.start && here() < end(x));
      const g = doc.project.groups.find((x) => c?.source.kind === 'multicam' && x.id === c.source.group) ?? doc.project.groups[0];
      const angle = g?.angles[n - 1];
      if (angle) a.switchAngle(angle.id);
    },
    importMedia: () => void chooseAndImport(doc, null),

    // ---- adding ----
    insertSource: (mode: 'insert' | 'overwrite') => {
      const src = ui.state.source;
      if (!src) return ui.note('Open a clip in the source monitor first (double-click it in the bin)');
      const m = doc.project.media.find((x) => x.id === src.media);
      if (!m) return;
      const { v, a: au } = targets();
      const range = m.kind === 'image' ? { in: 0, out: STILL_SECONDS } : { in: src.in ?? 0, out: src.out ?? m.duration };
      const at = seq().inPoint ?? here();
      edit(mode === 'insert' ? 'Insert' : 'Overwrite', (p) => addMedia(p, m.id, at, mode, v ?? undefined, au ?? undefined, range));
      engine.seek(at + Math.round((range.out - range.in) * fps()));
    },
    addMediaAt: (media: string, frame: number, video?: string, audio?: string, mode: 'insert' | 'overwrite' = 'overwrite') =>
      edit('Add to timeline', (p) => addMedia(p, media, frame, mode, video, audio)),
    addText: (preset = 0) => {
      let id = '';
      edit('Add text', (p) => {
        const r = addText(p, here(), Math.round(fps() * 5), TEXT_PRESETS[preset]?.data ?? {});
        id = r.id;
        return r.project;
      });
      if (id) doc.select({ kind: 'clips', ids: [id] });
    },
    /** A title template at a frame (the playhead), on a track (or the first free one above the pictures). */
    addTemplate: (id: string, at?: number, track?: string) => {
      const t = templateById(id);
      if (!t) return;
      let made = '';
      edit(`Add ${t.name}`, (p) => {
        const r = addTemplate(p, t, at ?? here(), fps(), track);
        made = r.id;
        return r.project;
      });
      if (made) doc.select({ kind: 'clips', ids: [made] });
    },
    addGenerated: (kind: 'color' | 'adjustment', color?: string) => {
      let id = '';
      edit(kind === 'color' ? 'Add color' : 'Add adjustment layer', (p) => {
        const r = addGenerated(p, here(), Math.round(fps() * 5), kind, color);
        id = r.id;
        return r.project;
      });
      if (id) doc.select({ kind: 'clips', ids: [id] });
    },
    addTrack: (kind: 'video' | 'audio') => edit('Add track', (p) => addTrack(p, kind)),
    /** Put the selected clips in a sequence of their own. */
    nest: () => {
      const ids = selected();
      if (!ids.length) return ui.note('Select the clips to nest first');
      let made = '';
      edit('Nest', (p) => {
        const r = nest(p, selectWithLinks(ids));
        made = r.seq;
        return r.project;
      });
      if (made) ui.note('Nested. Double-click the new clip to open what is inside');
    },
    addGenerator: (gen: string, settings: Record<string, number | string> = {}) => {
      let id = '';
      edit('Add generator', (p) => {
        const r = addGenerator(p, here(), Math.round(fps() * 5), gen, settings);
        id = r.id;
        return r.project;
      });
      if (id) doc.select({ kind: 'clips', ids: [id] });
    },
    /** A Lumora Titler graphic at the playhead (as long as the title). */
    addTitler: (title: TitleProject): string => {
      let id = '';
      edit(`Add ${title.name}`, (p) => {
        const r = addTitlerClip(p, here(), fps(), title);
        id = r.id;
        return r.project;
      });
      if (id) doc.select({ kind: 'clips', ids: [id] });
      return id;
    },
    /** A title clip takes a new design from the Titler (its fields' values stay). */
    useTitler: (title: TitleProject, clipId: string) =>
      edit('Change title design', (p) => ({
        ...p,
        sequences: p.sequences.map((s) => ({
          ...s,
          clips: s.clips.map((c) => (c.id === clipId && c.source.kind === 'titler' ? { ...c, name: title.name, source: { ...c.source, project: title } } : c)),
        })),
      })),
    /** A clip by id in the open sequence. */
    clipById: (id: string) => seq().clips.find((c) => c.id === id),
    addShape: (kind: ShapeData['kind']) => {
      let id = '';
      edit('Add shape', (p) => {
        const r = addShape(p, here(), Math.round(fps() * 5), kind);
        id = r.id;
        return r.project;
      });
      if (id) doc.select({ kind: 'clips', ids: [id] });
    },

    // ---- tools and view ----
    tool: (t: Tool) => ui.set({ tool: t }),
    snapping: () => {
      ui.set({ snapping: !ui.state.snapping });
      ui.note(ui.state.snapping ? 'Snapping on' : 'Snapping off');
    },
    linkedSelection: () => {
      ui.set({ linked: !ui.state.linked });
      ui.note(ui.state.linked ? 'Linked selection on' : 'Linked selection off');
    },
    zoom: (factor: number) => ui.set({ zoom: Math.max(0.005, Math.min(40, ui.state.zoom * factor)) }),
    zoomToFit: (width: number) => {
      const len = Math.max(fps() * 10, seqLength(seq()));
      ui.set({ zoom: Math.max(0.005, (width - 40) / len) });
    },
    undo: () => doc.undo(),
    redo: () => doc.redo(),
  };
  return a;
}
