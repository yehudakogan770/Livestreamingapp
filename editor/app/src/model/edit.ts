// The edits: each takes the project and gives back a changed copy (undo keeps the old one).
import { changeSpeed, current, cutClip, editSeq, end, handles, onTrack, rate, seqLength, trackOf, trimLeft, trimRight } from './seq';
import { carryFollows, retimeTracks } from '../track/paths';
import { uid, newClip, newTrack, type Clip, type Effect, type Marker, type Project, type Sequence, type Track, type TrackKind, type Transition } from './types';

const unlocked = (s: Sequence, track: string): boolean => !trackOf(s, track)?.locked;

/** The clips plus everything linked to them (picture and its sound). */
export function withLinked(s: Sequence, ids: string[]): string[] {
  const links = new Set(s.clips.filter((c) => ids.includes(c.id) && c.link).map((c) => c.link));
  return s.clips.filter((c) => ids.includes(c.id) || (c.link && links.has(c.link))).map((c) => c.id);
}

/** Make room on a track between two frames (what was there is cut back or taken out). */
export function clearRange(clips: Clip[], track: string, from: number, to: number, fps: number, keep: Set<string> = new Set()): Clip[] {
  if (to <= from) return clips;
  const out: Clip[] = [];
  for (const c of clips) {
    if (c.track !== track || keep.has(c.id) || end(c) <= from || c.start >= to) {
      out.push(c);
      continue;
    }
    if (c.start < from && end(c) > to) {
      const [left, rest] = cutClip(c, from, fps, uid());
      const [, right] = cutClip(rest, to, fps, uid());
      out.push(left, right);
    } else if (c.start < from) out.push(trimRight(c, end(c) - from, fps));
    else if (end(c) > to) out.push(trimLeft(c, to - c.start, fps));
  }
  return out;
}

/** Cut clips in two at a frame (on the given tracks, or every unlocked one). */
export function razor(p: Project, frame: number, tracks: string[] | null = null, only: string[] | null = null): Project {
  return editSeq(p, (s) => {
    const fps = rate(s);
    let changed = false;
    const links = new Map<string, string>();
    const clips = s.clips.flatMap((c) => {
      const inScope = only ? only.includes(c.id) : tracks ? tracks.includes(c.track) : true;
      if (!inScope || !unlocked(s, c.track) || frame <= c.start || frame >= end(c)) return [c];
      changed = true;
      const [a, b] = cutClip(c, frame, fps, uid());
      // The new halves stay linked to each other's new halves.
      if (c.link) {
        const l = links.get(c.link) ?? uid('l');
        links.set(c.link, l);
        b.link = l;
      }
      return [a, b];
    });
    return changed ? { ...s, clips } : s;
  });
}

/** Cut the clip under a frame, and everything linked to it. */
export function razorClip(p: Project, id: string, frame: number): Project {
  return razor(p, frame, null, withLinked(current(p), [id]));
}

/**
 * Move everything at or after `at` on some tracks. Moving earlier stops where
 * it would run into what is before it.
 */
export function shiftAfter(s: Sequence, at: number, by: number, tracks: string[]): Sequence {
  if (by === 0 || tracks.length === 0) return s;
  let delta = by;
  if (delta < 0) {
    for (const t of tracks) {
      const before = s.clips.filter((c) => c.track === t && c.start < at);
      const after = s.clips.filter((c) => c.track === t && c.start >= at);
      if (after.length === 0) continue;
      const first = Math.min(...after.map((c) => c.start));
      const last = Math.max(0, ...before.map(end));
      delta = Math.max(delta, last - first);
    }
  }
  if (delta === 0) return s;
  const markers = s.markers.map((m) => (m.at >= at ? { ...m, at: Math.max(0, m.at + delta) } : m));
  return { ...s, markers, clips: s.clips.map((c) => (tracks.includes(c.track) && c.start >= at ? { ...c, start: c.start + delta } : c)) };
}

const free = (s: Sequence, track: string, from: number, to: number): boolean => !s.clips.some((c) => c.track === track && c.start < to && end(c) > from);

/** Tracks that close up when [from, to) is taken out: the given ones, and every other unlocked track with nothing there. */
function closingTracks(s: Sequence, from: number, to: number, must: string[]): string[] {
  return s.tracks.filter((t) => !t.locked && (must.includes(t.id) || free(s, t.id, from, to))).map((t) => t.id);
}

/** Take clips out and close up the space (linked clips go too). */
export function rippleDelete(p: Project, ids: string[]): Project {
  return editSeq(p, (s) => {
    const gone = new Set(withLinked(s, ids).filter((id) => unlocked(s, s.clips.find((c) => c.id === id)?.track ?? '')));
    if (gone.size === 0) return s;
    const removed = s.clips.filter((c) => gone.has(c.id));
    let next: Sequence = { ...s, clips: s.clips.filter((c) => !gone.has(c.id)) };
    // Spans that were taken out, latest first.
    const spans = removed.map((c) => [c.start, end(c)] as [number, number]).sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else merged.push([...sp]);
    }
    for (const [from, to] of merged.reverse()) {
      const must = [...new Set(removed.filter((c) => c.start < to && end(c) > from).map((c) => c.track))];
      const tracks = closingTracks(next, from, to, must).filter((t) => free(next, t, from, to));
      next = shiftAfter(next, to, from - to, tracks);
    }
    return next;
  });
}

/** Take clips out and leave the space (linked clips go too). */
export function lift(p: Project, ids: string[]): Project {
  return editSeq(p, (s) => {
    const gone = new Set(withLinked(s, ids));
    const clips = s.clips.filter((c) => !gone.has(c.id) || !unlocked(s, c.track));
    return clips.length === s.clips.length ? s : { ...s, clips };
  });
}

/** Close the empty space on a track at a frame. */
export function closeGap(p: Project, track: string, frame: number): Project {
  return editSeq(p, (s) => {
    const clips = onTrack(s, track);
    const prevEnd = Math.max(0, ...clips.filter((c) => end(c) <= frame).map(end));
    const next = clips.find((c) => c.start > frame);
    if (!next || clips.some((c) => c.start <= frame && end(c) > frame)) return s;
    const tracks = closingTracks(s, prevEnd, next.start, [track]).filter((t) => free(s, t, prevEnd, next.start));
    return shiftAfter(s, next.start, prevEnd - next.start, tracks);
  });
}

/** Take out [from, to) on the given tracks, leaving the space. */
export function liftRange(p: Project, from: number, to: number, tracks: string[]): Project {
  return editSeq(p, (s) => {
    const fps = rate(s);
    let clips = s.clips;
    for (const t of tracks) if (unlocked(s, t)) clips = clearRange(clips, t, from, to, fps);
    return { ...s, clips };
  });
}

/** Take out [from, to) on every unlocked track and close up. */
export function extractRange(p: Project, from: number, to: number): Project {
  return editSeq(p, (s) => {
    const fps = rate(s);
    const tracks = s.tracks.filter((t) => !t.locked).map((t) => t.id);
    let clips = s.clips;
    for (const t of tracks) clips = clearRange(clips, t, from, to, fps);
    return shiftAfter(
      { ...s, clips },
      to,
      from - to,
      tracks.filter((t) => free({ ...s, clips }, t, from, to)),
    );
  });
}

/** Put clips into the sequence: over what is there, or pushing everything after along. */
export function placeClips(p: Project, given: Clip[], mode: 'insert' | 'overwrite'): Project {
  // Captions go only on captions tracks, and nothing else does.
  const s0 = current(p);
  const clips = given.filter((c) => (c.source.kind === 'caption') === !!trackOf(s0, c.track)?.captions);
  if (clips.length === 0) return p;
  return editSeq(p, (s) => {
    const fps = rate(s);
    const at = Math.min(...clips.map((c) => c.start));
    const length = Math.max(...clips.map(end)) - at;
    let next = s;
    if (mode === 'insert') {
      const tracks = s.tracks.filter((t) => !t.locked).map((t) => t.id);
      // Clips under the insert point are cut so their second half moves along.
      const cut = razor({ ...p, sequences: [s], open: s.id }, at, tracks);
      next = shiftAfter(current(cut), at, length, tracks);
    }
    let out = next.clips;
    for (const c of clips) out = clearRange(out, c.track, c.start, end(c), fps);
    return { ...next, clips: [...out, ...clips] };
  });
}

export interface Move {
  frames: number;
  /** Tracks up or down, for video and for sound. */
  video: number;
  audio: number;
}

/** Move clips (linked ones go along); they cover what they land on. A copy leaves the originals. */
export function moveClips(p: Project, ids: string[], m: Move, copy = false): Project {
  return editSeq(p, (s) => {
    const fps = rate(s);
    const moving = s.clips.filter((c) => ids.includes(c.id) && unlocked(s, c.track));
    if (moving.length === 0) return s;
    const kinds = { video: s.tracks.filter((t) => t.kind === 'video'), audio: s.tracks.filter((t) => t.kind === 'audio') };
    const indexOf = (c: Clip) => {
      const t = trackOf(s, c.track) as Track;
      return { kind: t.kind, i: kinds[t.kind].findIndex((x) => x.id === t.id) };
    };
    // Keep every clip on a track of its kind, and at or after the start.
    let dv = m.video;
    let da = m.audio;
    for (const c of moving) {
      const { kind, i } = indexOf(c);
      const list = kinds[kind];
      if (kind === 'video') dv = Math.max(-i, Math.min(list.length - 1 - i, dv));
      else da = Math.max(-i, Math.min(list.length - 1 - i, da));
    }
    const frames = Math.max(-Math.min(...moving.map((c) => c.start)), m.frames);
    const placed = moving.map((c) => {
      const { kind, i } = indexOf(c);
      const t = kinds[kind][i + (kind === 'video' ? dv : da)] as Track;
      return { ...c, id: copy ? uid() : c.id, start: c.start + frames, track: t.id };
    });
    if (placed.some((c) => !unlocked(s, c.track))) return s;
    // Captions stay on captions tracks, and nothing else goes there.
    if (placed.some((c) => (c.source.kind === 'caption') !== !!trackOf(s, c.track)?.captions)) return s;
    if (copy) {
      // Copies keep their links among themselves.
      const links = new Map<string, string>();
      for (const c of placed) if (c.link) c.link = links.get(c.link) ?? (links.set(c.link, uid('l')), links.get(c.link) ?? null);
    }
    const movingIds = new Set(moving.map((c) => c.id));
    let out = copy ? s.clips : s.clips.filter((c) => !movingIds.has(c.id));
    for (const c of placed) out = clearRange(out, c.track, c.start, end(c), fps);
    return { ...s, clips: [...out, ...placed] };
  });
}

export type TrimMode = 'normal' | 'ripple' | 'roll';

/**
 * Move a clip's start or end. Normal: only this clip (up to its neighbors).
 * Ripple: the film after it moves along. Roll: the cut between it and the
 * clip touching it moves (nothing else moves).
 */
export function trim(p: Project, id: string, edge: 'start' | 'end', delta: number, mode: TrimMode, linked = true): Project {
  return editSeq(p, (s) => {
    const fps = rate(s);
    const self = s.clips.find((c) => c.id === id);
    if (!self || !unlocked(s, self.track) || delta === 0) return s;
    const at = edge === 'start' ? self.start : end(self);
    const group = (linked ? withLinked(s, [id]) : [id])
      .map((x) => s.clips.find((c) => c.id === x) as Clip)
      .filter((c) => unlocked(s, c.track) && (edge === 'start' ? c.start : end(c)) === at);
    // The clip that touches each one at this edge (for roll and ripple limits).
    const touching = (c: Clip) => s.clips.find((o) => o.track === c.track && o.id !== c.id && (edge === 'start' ? end(o) === c.start : o.start === end(c)));
    let d = delta;
    for (const c of group) {
      const h = handles(p, c, fps);
      const n = touching(c);
      if (edge === 'end') {
        d = Math.max(d, 1 - c.length); // at least a frame
        d = Math.min(d, h.after);
        if (mode === 'roll' && n) d = Math.min(d, n.length - 1, handles(p, n, fps).before);
        if (mode === 'normal' || (mode === 'roll' && !n)) {
          const next = onTrack(s, c.track).find((o) => o.start >= end(c) && o.id !== c.id);
          if (next) d = Math.min(d, next.start - end(c));
        }
      } else {
        d = Math.min(d, c.length - 1);
        d = Math.max(d, -h.before);
        if (mode === 'roll' && n) d = Math.max(d, 1 - n.length, -handles(p, n, fps).after);
        if (mode === 'normal' || (mode === 'roll' && !n)) {
          const prev = onTrack(s, c.track).filter((o) => end(o) <= c.start && o.id !== c.id);
          const limit = prev.length ? Math.max(...prev.map(end)) : 0;
          d = Math.max(d, limit - c.start);
        }
        if (mode === 'ripple') d = Math.max(d, -h.before);
      }
    }
    if (d === 0) return s;
    const ids = new Set(group.map((c) => c.id));
    if (mode === 'ripple') {
      // The clip keeps its place; what follows moves by how much it grew or shrank.
      const change = edge === 'end' ? d : -d;
      let clips = s.clips.map((c) => {
        if (!ids.has(c.id)) return c;
        if (edge === 'end') return trimRight(c, -d, fps);
        return { ...trimLeft(c, d, fps), start: c.start };
      });
      const point = edge === 'end' ? at : at + 1;
      const tracks = s.tracks.filter((t) => !t.locked).map((t) => t.id);
      const shifted = shiftAfter({ ...s, clips: clips.map((c) => (ids.has(c.id) ? { ...c, start: -1e9 - c.start } : c)) }, point, change, tracks);
      clips = shifted.clips.map((c) => (ids.has(c.id) ? { ...c, start: -1e9 - c.start } : c));
      return { ...shifted, clips };
    }
    const clips = s.clips.map((c) => {
      if (ids.has(c.id)) return edge === 'end' ? trimRight(c, -d, fps) : trimLeft(c, d, fps);
      if (mode === 'roll' && group.some((g) => touching(g)?.id === c.id)) return edge === 'end' ? trimLeft(c, d, fps) : trimRight(c, -d, fps);
      return c;
    });
    return { ...s, clips };
  });
}

/** The cut on a track nearest a frame: where it is, the clip ending there and the clip starting there (either may be missing). */
export function cutNear(s: Sequence, frame: number, track: string): { at: number; left: Clip | null; right: Clip | null } | null {
  const clips = s.clips.filter((c) => c.track === track);
  let best: number | null = null;
  for (const c of clips)
    for (const e of [c.start, end(c)])
      if (best === null || Math.abs(e - frame) < Math.abs(best - frame) || (Math.abs(e - frame) === Math.abs(best - frame) && e > best)) best = e;
  if (best === null) return null;
  const at = best;
  return { at, left: clips.find((c) => end(c) === at) ?? null, right: clips.find((c) => c.start === at) ?? null };
}

/** Move the cut nearest a frame by some frames: rolling (the clips either side change) or rippling (the film after moves). */
export function trimCut(p: Project, frame: number, track: string, delta: number, mode: 'roll' | 'ripple'): Project {
  const cut = cutNear(current(p), frame, track);
  if (!cut) return p;
  if (cut.left) return trim(p, cut.left.id, 'end', delta, mode);
  if (cut.right) return trim(p, cut.right.id, 'start', delta, mode === 'roll' ? 'normal' : mode);
  return p;
}

/** Extend edit: the cut nearest the playhead rolls to it. */
export function extendEdit(p: Project, frame: number, track: string): Project {
  const cut = cutNear(current(p), frame, track);
  if (!cut || cut.at === frame) return p;
  if (cut.left) return trim(p, cut.left.id, 'end', frame - cut.at, 'roll');
  if (cut.right) return trim(p, cut.right.id, 'start', frame - cut.at, 'normal');
  return p;
}

/** Trim the edit nearest a frame to it, closing up (Q: the start side; W: the end side). */
export function rippleTrimTo(p: Project, frame: number, side: 'start' | 'end', tracks: string[]): Project {
  const s = current(p);
  let next = p;
  const clips = s.clips.filter((c) => tracks.includes(c.track) && frame > c.start && frame < end(c));
  const first = clips[0];
  if (!first) return p;
  if (side === 'start') next = trim(next, first.id, 'start', frame - first.start, 'ripple');
  else next = trim(next, first.id, 'end', frame - end(first), 'ripple');
  return next;
}

/** Show a different part of the source without moving the clip. */
export function slip(p: Project, id: string, frames: number): Project {
  return editSeq(p, (s) => {
    const fps = rate(s);
    const group = withLinked(s, [id]).map((x) => s.clips.find((c) => c.id === x) as Clip);
    let d = frames;
    for (const c of group) {
      const h = handles(p, c, fps);
      const dir = c.reverse ? -1 : 1;
      if (dir * d > 0) d = dir * Math.min(Math.abs(d), c.reverse ? h.before : h.after);
      else d = dir * -Math.min(Math.abs(d), c.reverse ? h.after : h.before);
    }
    if (d === 0) return s;
    const ids = new Set(group.map((c) => c.id));
    const slipped = (c: Clip): Clip => {
      if (!('in' in c.source)) return c;
      const out = { ...c, source: { ...c.source, in: Math.max(0, c.source.in + (d * c.speed) / fps) } };
      // Tracks follow the picture, not the clip: what was at frame f of the clip is now d frames earlier (later when reversed).
      return c.remap ? out : retimeTracks(out, (t) => t + (c.reverse ? d : -d));
    };
    return { ...s, clips: s.clips.map((c) => (ids.has(c.id) ? slipped(c) : c)) };
  });
}

/** Move a clip between its neighbors: the one before gets longer, the one after shorter (or the other way). */
export function slide(p: Project, id: string, frames: number): Project {
  return editSeq(p, (s) => {
    const fps = rate(s);
    const group = withLinked(s, [id]).map((x) => s.clips.find((c) => c.id === x) as Clip);
    let d = frames;
    for (const c of group) {
      const list = onTrack(s, c.track).filter((o) => o.id !== c.id);
      const prev = list.filter((o) => end(o) <= c.start).pop();
      const next = list.find((o) => o.start >= end(c));
      const prevTouch = prev && end(prev) === c.start;
      const nextTouch = next && next.start === end(c);
      const lo = prevTouch && prev ? -(prev.length - 1) : -(c.start - (prev ? end(prev) : 0));
      const hiPrev = prevTouch && prev ? handles(p, prev, fps).after : Infinity;
      const hi = nextTouch && next ? next.length - 1 : next ? next.start - end(c) : Infinity;
      const loNext = nextTouch && next ? -handles(p, next, fps).before : -Infinity;
      d = Math.max(d, lo, loNext);
      d = Math.min(d, hi, hiPrev);
    }
    if (d === 0) return s;
    const ids = new Set(group.map((c) => c.id));
    const changes = new Map<string, Clip>();
    for (const c of group) {
      changes.set(c.id, { ...c, start: c.start + d });
      for (const o of s.clips) {
        if (o.track !== c.track || ids.has(o.id)) continue;
        if (end(o) === c.start) changes.set(o.id, trimRight(o, -d, fps));
        if (o.start === end(c)) changes.set(o.id, trimLeft(o, d, fps));
      }
    }
    return { ...s, clips: s.clips.map((c) => changes.get(c.id) ?? c) };
  });
}

export function updateClips(p: Project, ids: string[], f: (c: Clip) => Clip): Project {
  return editSeq(p, (s) => ({ ...s, clips: s.clips.map((c) => (ids.includes(c.id) ? f(c) : c)) }));
}

/** Play faster or slower; the clip gets shorter or longer (the film after moves along when `ripple`). */
export function setSpeed(p: Project, id: string, speed: number, ripple: boolean): Project {
  return editSeq(p, (s) => {
    const c = s.clips.find((x) => x.id === id);
    if (!c || speed <= 0) return s;
    // Its sound (or picture) changes speed with it.
    const ids = new Set(
      withLinked(s, [id]).filter((x) => {
        const o = s.clips.find((y) => y.id === x);
        return o && o.start === c.start && o.length === c.length;
      }),
    );
    const changed = new Map([...ids].map((x) => [x, changeSpeed(s.clips.find((y) => y.id === x) as Clip, speed)]));
    const after = changed.get(id) as Clip;
    const grow = after.length - c.length;
    if (ripple && grow !== 0) {
      const tracks = s.tracks.filter((t) => !t.locked).map((t) => t.id);
      const parked = { ...s, clips: s.clips.map((x) => (ids.has(x.id) ? { ...x, start: -1e9 } : x)) };
      const shifted = shiftAfter(parked, end(c), grow, tracks);
      return { ...shifted, clips: shifted.clips.map((x) => changed.get(x.id) ?? x) };
    }
    let length = after.length;
    if (grow > 0) {
      for (const x of ids) {
        const o = s.clips.find((y) => y.id === x) as Clip;
        const next = onTrack(s, o.track).find((n) => n.start >= end(o) && !ids.has(n.id));
        if (next) length = Math.min(length, next.start - o.start);
      }
    }
    return {
      ...s,
      clips: s.clips.map((x) => {
        const ch = changed.get(x.id);
        return ch ? { ...ch, length } : x;
      }),
    };
  });
}

/** Switch to a camera from a frame on (the clip is cut there), like switching live. */
export function switchAngle(p: Project, frame: number, angle: string): Project {
  const s = current(p);
  const clip = s.tracks
    .filter((t) => t.kind === 'video' && !t.locked)
    .reverse()
    .map((t) => s.clips.find((c) => c.track === t.id && frame >= c.start && frame < end(c) && c.source.kind === 'multicam'))
    .find(Boolean);
  if (!clip || clip.source.kind !== 'multicam' || clip.source.angle === angle) return p;
  const set = (q: Project, id: string) => updateClips(q, [id], (c) => withAngle(q, c, angle));
  if (frame - clip.start < 2) return set(p, clip.id);
  const cut = razor(p, frame, null, [clip.id]);
  const right = current(cut).clips.find((c) => c.track === clip.track && c.start === frame);
  return right ? set(cut, right.id) : cut;
}

export function setAngle(p: Project, id: string, angle: string): Project {
  return updateClips(p, [id], (c) => withAngle(p, c, angle));
}

/** A multicam clip showing another camera (it takes that camera's name). */
export function withAngle(p: Project, c: Clip, angle: string): Clip {
  if (c.source.kind !== 'multicam') return c;
  const src = c.source;
  const name = p.groups.find((g) => g.id === src.group)?.angles.find((a) => a.id === angle)?.name ?? c.name;
  return { ...c, name, source: { ...src, angle } };
}

export function link(p: Project, ids: string[]): Project {
  const l = uid('l');
  return updateClips(p, ids, (c) => ({ ...c, link: l }));
}
export function unlink(p: Project, ids: string[]): Project {
  return updateClips(p, ids, (c) => ({ ...c, link: null }));
}

/** The longest transition that fits on a clip's start. */
export function maxTransition(s: Sequence, c: Clip): number {
  const prev = s.clips.find((o) => o.track === c.track && end(o) === c.start);
  return Math.max(2, prev ? Math.min(c.length, prev.length) : c.length);
}

export function setTransition(p: Project, id: string, side: 'in' | 'out', t: Transition | null): Project {
  return editSeq(p, (s) => {
    const c = s.clips.find((x) => x.id === id);
    if (!c) return s;
    const fitted = t ? { ...t, length: Math.max(2, Math.min(t.length, side === 'in' ? maxTransition(s, c) : c.length)) } : null;
    return { ...s, clips: s.clips.map((x) => (x.id === id ? (side === 'in' ? { ...x, tIn: fitted } : { ...x, tOut: fitted }) : x)) };
  });
}

/** The default transition at the cut nearest the playhead, on the given tracks. */
export function transitionAtPlayhead(p: Project, frame: number, kind: TrackKind, type: string, length: number): Project {
  const s = current(p);
  const tracks = s.tracks.filter((t) => t.kind === kind && !t.locked).map((t) => t.id);
  const near = s.clips
    .filter((c) => tracks.includes(c.track))
    .map((c) => ({ c, d: Math.abs(c.start - frame), e: Math.abs(end(c) - frame) }))
    .sort((a, b) => Math.min(a.d, a.e) - Math.min(b.d, b.e));
  let next = p;
  const first = near[0];
  if (!first) return p;
  const best = Math.min(first.d, first.e);
  for (const x of near.filter((n) => Math.min(n.d, n.e) === best)) {
    if (x.d === best) next = setTransition(next, x.c.id, 'in', { type, length });
    else if (!s.clips.some((o) => o.track === x.c.track && o.start === end(x.c))) next = setTransition(next, x.c.id, 'out', { type, length });
  }
  return next;
}

export function addMarker(p: Project, at: number, name = '', color = '#5a8fd0'): { project: Project; id: string } {
  const m: Marker = { id: uid('m'), at, length: 0, name, color };
  return { project: editSeq(p, (s) => ({ ...s, markers: [...s.markers.filter((x) => x.at !== at), m].sort((a, b) => a.at - b.at) })), id: m.id };
}
export function updateMarker(p: Project, id: string, change: Partial<Omit<Marker, 'id'>>): Project {
  return editSeq(p, (s) => ({ ...s, markers: s.markers.map((m) => (m.id === id ? { ...m, ...change } : m)) }));
}
export function removeMarker(p: Project, id: string): Project {
  return editSeq(p, (s) => ({ ...s, markers: s.markers.filter((m) => m.id !== id) }));
}

export function addTrack(p: Project, kind: TrackKind): Project {
  return editSeq(p, (s) => {
    const list = s.tracks.filter((t) => t.kind === kind && !t.captions);
    const t = newTrack(kind, list.length + 1);
    // Captions tracks stay on top of the pictures.
    const captions = s.tracks.filter((x) => x.captions);
    const tracks = kind === 'video' ? [...list, t, ...captions, ...s.tracks.filter((x) => x.kind === 'audio')] : [...s.tracks, t];
    return { ...s, tracks };
  });
}

export function removeTrack(p: Project, id: string): Project {
  return editSeq(p, (s) => {
    const t = trackOf(s, id);
    if (!t || s.tracks.filter((x) => x.kind === t.kind).length <= 1) return s;
    return { ...s, tracks: s.tracks.filter((x) => x.id !== id), clips: s.clips.filter((c) => c.track !== id) };
  });
}

export function updateTrack(p: Project, id: string, change: Partial<Omit<Track, 'id' | 'kind'>>): Project {
  return editSeq(p, (s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...change } : t)) }));
}

/** Clips copied to the clipboard, kept relative to the first one. */
export interface Clipboard {
  clips: Clip[];
  /** Each clip's track: its kind and place among tracks of that kind. */
  places: Record<string, { kind: TrackKind; index: number }>;
}
export function copyClips(s: Sequence, ids: string[]): Clipboard {
  const list = s.clips.filter((c) => ids.includes(c.id));
  const first = Math.min(...list.map((c) => c.start));
  const places: Clipboard['places'] = {};
  for (const c of list) {
    const t = trackOf(s, c.track);
    if (t) places[c.id] = { kind: t.kind, index: s.tracks.filter((x) => x.kind === t.kind).indexOf(t) };
  }
  const copied = new Set(list.map((c) => c.id));
  return {
    clips: list.map((c) => {
      const out = { ...structuredClone(c), start: c.start - first };
      // Following a clip copied with it: the frame it was attached at goes along (relative, like the start).
      if (out.follow && copied.has(out.follow.clip)) out.follow = { ...out.follow, at: out.follow.at - first };
      return out;
    }),
    places,
  };
}

/** Paste at a frame, on the same tracks (or the matching tracks of a sequence that has fewer). */
export function paste(p: Project, board: Clipboard, at: number, mode: 'insert' | 'overwrite'): Project {
  const s = current(p);
  const links = new Map<string, string>();
  const ids = new Map(board.clips.map((c) => [c.id, uid()]));
  const clips = board.clips.flatMap((c) => {
    let track = trackOf(s, c.track);
    const place = board.places[c.id];
    if (!track && place) {
      const list = s.tracks.filter((t) => t.kind === place.kind);
      track = list[Math.min(place.index, list.length - 1)];
    }
    if (!track) return [];
    const link = c.link ? (links.get(c.link) ?? (links.set(c.link, uid('l')), links.get(c.link) ?? null)) : null;
    return [{ ...c, id: ids.get(c.id) as string, start: c.start + at, track: track.id, link }];
  });
  // A copy that follows a clip copied with it follows that clip's copy (its frame was kept relative, like the start).
  return placeClips(p, carryFollows(clips, ids, at), mode);
}

/** Copies of effects with new ids (an effect limited to a mask stays limited to that mask's copy). */
function withNewIds(effects: Effect[]): Effect[] {
  const ids = new Map(effects.map((e) => [e.id, uid('e')]));
  return effects.map((e) => {
    const copy = { ...structuredClone(e), id: ids.get(e.id) as string };
    const lim = copy.d?.limit as { mask?: string } | undefined;
    if (lim?.mask && ids.has(lim.mask)) copy.d = { ...copy.d, limit: { ...lim, mask: ids.get(lim.mask) } };
    return copy;
  });
}

/** Copy one clip's effects, motion and sound settings onto others. */
export function pasteAttributes(p: Project, from: Clip, ids: string[]): Project {
  return updateClips(p, ids, (c) => ({
    ...c,
    motion: structuredClone(from.motion),
    effects: withNewIds(from.effects),
    gain: structuredClone(from.gain),
    pan: structuredClone(from.pan),
  }));
}

/** Clips under the playhead on the given tracks (for "select at playhead"). */
export function clipsAt(s: Sequence, frame: number, tracks: string[]): Clip[] {
  return s.clips.filter((c) => tracks.includes(c.track) && frame >= c.start && frame < end(c));
}

/** Every cut on the timeline, in order (for jumping between them). */
export function editPoints(s: Sequence, tracks: string[] | null = null): number[] {
  const set = new Set<number>([0]);
  for (const c of s.clips) {
    if (tracks && !tracks.includes(c.track)) continue;
    set.add(c.start);
    set.add(end(c));
  }
  return [...set].sort((a, b) => a - b);
}

/** Where a moved edge or clip lands when it is close to something (cuts, playhead, markers, marks). */
export function snapPoints(s: Sequence, playhead: number, skip: Set<string>): number[] {
  const pts = new Set<number>([0, playhead]);
  for (const c of s.clips) {
    if (skip.has(c.id)) continue;
    pts.add(c.start);
    pts.add(end(c));
  }
  for (const m of s.markers) pts.add(m.at);
  if (s.inPoint !== null) pts.add(s.inPoint);
  if (s.outPoint !== null) pts.add(s.outPoint);
  return [...pts];
}

export function nearest(points: number[], frame: number, within: number): number | null {
  let best: number | null = null;
  for (const x of points) if (Math.abs(x - frame) <= within && (best === null || Math.abs(x - frame) < Math.abs(best - frame))) best = x;
  return best;
}

/** A sequence put into the open one as a clip (its picture and its sound, linked). */
export function addSequenceClip(p: Project, seqId: string, at: number, mode: 'insert' | 'overwrite', video?: string, audio?: string): Project {
  const s = current(p);
  const inner = p.sequences.find((x) => x.id === seqId);
  if (!inner || inner.id === s.id || contains(p, inner.id, s.id)) return p;
  const fps = rate(s);
  const length = Math.max(1, Math.round((seqLength(inner) / rate(inner)) * fps));
  const vTrack = video ?? s.tracks.find((t) => t.kind === 'video' && !t.locked)?.id;
  const aTrack = audio ?? s.tracks.find((t) => t.kind === 'audio' && !t.locked)?.id;
  const hasPicture = inner.clips.some((c) => inner.tracks.find((t) => t.id === c.track)?.kind === 'video');
  const hasSound = inner.clips.some((c) => inner.tracks.find((t) => t.id === c.track)?.kind === 'audio');
  const link = hasPicture && hasSound ? uid('l') : null;
  const clips: Clip[] = [];
  const source = { kind: 'sequence' as const, seq: inner.id, in: 0 };
  if (hasPicture && vTrack) clips.push({ ...newClip(vTrack, at, length, source, inner.name), link });
  if (hasSound && aTrack) clips.push({ ...newClip(aTrack, at, length, source, inner.name), link });
  return placeClips(p, clips, mode);
}

/** Does sequence `outer` show sequence `inner` anywhere inside it (so nesting would loop)? */
export function contains(p: Project, outer: string, inner: string, depth = 0): boolean {
  if (outer === inner) return true;
  if (depth > 8) return true;
  const s = p.sequences.find((x) => x.id === outer);
  return !!s?.clips.some((c) => c.source.kind === 'sequence' && contains(p, c.source.seq, inner, depth + 1));
}

/** Put clips into a new sequence of their own, and leave one clip (picture and sound) in their place. */
export function nest(p: Project, ids: string[]): { project: Project; seq: string } {
  const s = current(p);
  const chosen = s.clips.filter((c) => ids.includes(c.id));
  if (chosen.length === 0) return { project: p, seq: '' };
  const from = Math.min(...chosen.map((c) => c.start));
  const to = Math.max(...chosen.map(end));
  const n = p.sequences.length + 1;
  const tracks = s.tracks.map((t) => ({ ...t, id: uid(t.kind === 'video' ? 'v' : 'a'), locked: false, off: false, solo: false }));
  const trackFor = (id: string) => tracks[s.tracks.findIndex((t) => t.id === id)]?.id ?? '';
  const links = new Map<string, string>();
  const newIds = new Map(chosen.map((c) => [c.id, uid()]));
  const moved = chosen.map((c) => ({
    ...structuredClone(c),
    id: newIds.get(c.id) as string,
    start: c.start - from,
    track: trackFor(c.track),
    link: c.link ? (links.get(c.link) ?? (links.set(c.link, uid('l')), links.get(c.link) ?? null)) : null,
  }));
  const inner: Sequence = {
    ...s,
    id: uid('s'),
    name: `Nested sequence ${n}`,
    tracks,
    // A clip following one nested with it keeps following it inside.
    clips: carryFollows(moved, newIds, -from),
    markers: [],
    inPoint: null,
    outPoint: null,
    playhead: 0,
  };
  const kindOf = (c: Clip) => s.tracks.find((t) => t.id === c.track)?.kind;
  const lowestVideo = s.tracks.find((t) => t.kind === 'video' && chosen.some((c) => c.track === t.id));
  const firstAudio = s.tracks.find((t) => t.kind === 'audio' && chosen.some((c) => c.track === t.id));
  const link = lowestVideo && firstAudio ? uid('l') : null;
  const source = { kind: 'sequence' as const, seq: inner.id, in: 0 };
  const replacement: Clip[] = [];
  if (lowestVideo && chosen.some((c) => kindOf(c) === 'video')) replacement.push({ ...newClip(lowestVideo.id, from, to - from, source, inner.name), link });
  if (firstAudio && chosen.some((c) => kindOf(c) === 'audio')) replacement.push({ ...newClip(firstAudio.id, from, to - from, source, inner.name), link });
  const without: Project = {
    ...p,
    sequences: [...p.sequences.map((x) => (x.id === s.id ? { ...x, clips: x.clips.filter((c) => !ids.includes(c.id)) } : x)), inner],
  };
  return { project: placeClips(without, replacement, 'overwrite'), seq: inner.id };
}
