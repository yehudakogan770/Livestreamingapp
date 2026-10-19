// The magnetic timeline: V1 is the main story and never has gaps. Taking a
// clip out of it closes up, dragging a clip along it reorders (the others
// make room), trims ripple, and everything on the other tracks that sits on a
// V1 clip (its sound, titles and cutaways over it) moves with that clip.
import { end, trackOf } from './seq';
import { newTrack, uid, type Clip, type Project, type Sequence, type Track } from './types';
import type { Move } from './edit';

/** The main story's track (V1). */
export const primaryTrack = (s: Sequence): Track | undefined => s.tracks.find((t) => t.kind === 'video');

/** Is this sequence magnetic and its main story track free to move? */
export const isMagnetic = (s: Sequence): boolean => !!s.magnetic && !primaryTrack(s)?.locked;

const byStart = (a: Clip, b: Clip): number => a.start - b.start || (a.id < b.id ? -1 : 1);

/**
 * The V1 clip each other clip belongs to: the one it is linked to (its own
 * sound), otherwise the one under its start (or the last one before it).
 * Clips before the first V1 clip belong to none.
 */
export function owners(s: Sequence, primary: string): Map<string, string> {
  const v1 = s.clips.filter((c) => c.track === primary).sort(byStart);
  const byLink = new Map<string, string>();
  for (const c of v1) if (c.link && !byLink.has(c.link)) byLink.set(c.link, c.id);
  const out = new Map<string, string>();
  for (const c of s.clips) {
    if (c.track === primary) continue;
    const linked = c.link ? byLink.get(c.link) : undefined;
    if (linked) {
      out.set(c.id, linked);
      continue;
    }
    let owner: Clip | undefined;
    for (const v of v1) {
      if (v.start <= c.start) owner = v;
      else break;
    }
    if (owner) out.set(c.id, owner.id);
  }
  return out;
}

/**
 * Put clips that now overlap on a track onto the next free track of the same
 * kind above it (a new one if needed), as Final Cut stacks connected clips:
 * nothing is cut or covered by the main story moving.
 */
function unstack(s: Sequence, moved: Set<string>, primary: string): Sequence {
  let tracks = s.tracks;
  const clips = s.clips.map((c) => ({ ...c }));
  const clash = (c: Clip, track: string) => clips.some((o) => o !== c && o.track === track && o.start < end(c) && end(o) > c.start);
  // Moved clips give way to those that stayed; among moved ones, the earlier keeps its place.
  const order = clips.filter((c) => moved.has(c.id) && c.track !== primary).sort(byStart);
  for (const c of order) {
    if (!clash(c, c.track)) continue;
    const t = trackOf({ ...s, tracks }, c.track);
    if (!t) continue;
    const same = tracks.filter((x) => x.kind === t.kind);
    const from = same.indexOf(t);
    const free = same.slice(from + 1).find((x) => !x.locked && !x.captions && x.id !== primary && !clash(c, x.id));
    if (free) {
      c.track = free.id;
      continue;
    }
    const made = newTrack(t.kind, same.length + 1);
    // Video tracks are listed first: a new one goes after the last video track.
    const at = t.kind === 'video' ? tracks.findIndex((x) => x.kind === 'audio') : tracks.length;
    tracks = at < 0 ? [...tracks, made] : [...tracks.slice(0, at), made, ...tracks.slice(at)];
    c.track = made.id;
  }
  return { ...s, tracks, clips };
}

/** Close every gap on V1 (from the start of the sequence); clips on it carry what belongs to them. */
export function packPrimary(s: Sequence, owned?: Map<string, string>): Sequence {
  const prim = primaryTrack(s);
  if (!prim || prim.locked) return s;
  const v1 = s.clips.filter((c) => c.track === prim.id).sort(byStart);
  const delta = new Map<string, number>();
  let cursor = 0;
  for (const c of v1) {
    delta.set(c.id, cursor - c.start);
    cursor += c.length;
  }
  if ([...delta.values()].every((d) => d === 0)) return s;
  const own = owned ?? owners(s, prim.id);
  const moved = new Set<string>();
  const clips = s.clips.map((c) => {
    if (trackOf(s, c.track)?.locked) return c;
    const d = c.track === prim.id ? (delta.get(c.id) ?? 0) : (delta.get(own.get(c.id) ?? '') ?? 0);
    if (d === 0) return c;
    moved.add(c.id);
    return { ...c, start: Math.max(0, c.start + d) };
  });
  // Markers move with the V1 clip they are on (as clips over it do).
  const markers = s.markers.map((m) => {
    let owner: Clip | undefined;
    for (const v of v1) {
      if (v.start <= m.at) owner = v;
      else break;
    }
    const d = owner ? (delta.get(owner.id) ?? 0) : 0;
    return d ? { ...m, at: Math.max(0, m.at + d) } : m;
  });
  return unstack({ ...s, clips, markers }, moved, prim.id);
}

/** After any edit: magnetic sequences whose clips changed are packed again. */
export function magnetize(before: Project, after: Project): Project {
  let changed = false;
  const sequences = after.sequences.map((s) => {
    if (!isMagnetic(s)) return s;
    const was = before.sequences.find((x) => x.id === s.id);
    if (was && was.clips === s.clips && was.magnetic) return s;
    const packed = packPrimary(s);
    if (packed !== s) changed = true;
    return packed;
  });
  return changed ? { ...after, sequences } : after;
}

/**
 * Moving clips in a magnetic sequence. Clips that end up on V1 are put in
 * the story at the cut nearest where they were dropped (the others make
 * room; nothing is covered); what belongs to every V1 clip moves with it.
 * Anything else moves as usual (over what it lands on).
 */
export function magneticMove(s: Sequence, ids: string[], m: Move, copy = false): Sequence | null {
  const prim = primaryTrack(s);
  if (!prim || prim.locked || !s.magnetic) return null;
  const videos = s.tracks.filter((t) => t.kind === 'video');
  const audios = s.tracks.filter((t) => t.kind === 'audio');
  const moving = s.clips.filter((c) => ids.includes(c.id) && !trackOf(s, c.track)?.locked);
  if (!moving.length) return null;
  const target = (c: Clip): string => {
    const t = trackOf(s, c.track) as Track;
    const list = t.kind === 'video' ? videos : audios;
    const i = list.indexOf(t) + (t.kind === 'video' ? m.video : m.audio);
    return (list[Math.max(0, Math.min(list.length - 1, i))] as Track).id;
  };
  const landing = moving.filter((c) => target(c) === prim.id && c.source.kind !== 'caption');
  // Nothing goes into the story: an ordinary move (packed afterwards).
  if (!landing.length) return null;
  const own = owners(s, prim.id);
  const landIds = new Set(landing.map((c) => c.id));
  // What belongs to a landing clip comes with it (unless it is being moved itself).
  const movingIds = new Set(moving.map((c) => c.id));
  const dropAt = Math.max(0, Math.min(...landing.map((c) => c.start)) + m.frames);
  // The story without the clips being moved (copies leave the originals in it).
  const rest = s.clips.filter((c) => c.track === prim.id && (copy || !landIds.has(c.id))).sort(byStart);
  // Before the first clip whose middle (where it is seen while dragging) is past the drop.
  let index = rest.findIndex((c) => c.start + c.length / 2 > dropAt);
  if (index < 0) index = rest.length;
  let cursor = 0;
  const links = new Map<string, string>();
  const relink = (l: string | null): string | null => {
    if (!copy || !l) return l;
    if (!links.has(l)) links.set(l, uid('l'));
    return links.get(l) ?? null;
  };
  const placed = landing.sort(byStart).map((c) => ({ ...c, id: copy ? uid() : c.id, track: prim.id, link: relink(c.link) }));
  const story = [...rest.slice(0, index), ...placed, ...rest.slice(index)];
  // New places on V1, and how far each story clip moved (by its id before the move).
  const delta = new Map<string, number>();
  const newStart = new Map<Clip, number>();
  for (const c of story) {
    newStart.set(c, cursor);
    cursor += c.length;
  }
  for (const c of rest) delta.set(c.id, (newStart.get(c) ?? c.start) - c.start);
  // A moved clip's own things go with it (a copy's originals stay with the original).
  if (!copy)
    landing.forEach((c, i) => {
      const p = placed[i] as Clip;
      delta.set(c.id, (newStart.get(p) ?? c.start) - c.start);
    });
  const shiftOf = (c: Clip): number => {
    const o = own.get(c.id);
    return o !== undefined ? (delta.get(o) ?? 0) : 0;
  };
  const moved = new Set<string>();
  const out: Clip[] = [];
  for (const c of s.clips) {
    const locked = !!trackOf(s, c.track)?.locked;
    if (c.track === prim.id) {
      if (landIds.has(c.id) && !copy) continue;
      const d = delta.get(c.id) ?? 0;
      if (d) moved.add(c.id);
      out.push(d ? { ...c, start: c.start + d } : c);
      continue;
    }
    if (landIds.has(c.id)) {
      // Brought down into the story from another track.
      if (copy) out.push(c);
      continue;
    }
    const owner = own.get(c.id);
    const goesWithLanding = owner !== undefined && landIds.has(owner);
    if (movingIds.has(c.id) || (goesWithLanding && !copy)) {
      // Moves with its V1 clip, on its own track (or the one it was dragged to).
      const d = owner !== undefined && landIds.has(owner) ? (delta.get(owner) ?? 0) : m.frames;
      const track = movingIds.has(c.id) ? target(c) : c.track;
      const next = { ...c, id: copy ? uid() : c.id, start: Math.max(0, c.start + d), track, link: relink(c.link) };
      if (copy) out.push(c);
      moved.add(next.id);
      out.push(next);
      continue;
    }
    const d = locked ? 0 : shiftOf(c);
    if (d) moved.add(c.id);
    out.push(d ? { ...c, start: Math.max(0, c.start + d) } : c);
  }
  for (const c of story) {
    if (!placed.includes(c)) continue;
    moved.add(c.id);
    out.push({ ...c, start: newStart.get(c) ?? c.start });
  }
  return unstack({ ...s, clips: out }, moved, prim.id);
}
