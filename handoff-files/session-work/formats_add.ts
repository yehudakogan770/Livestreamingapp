
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

type Bag = Record<string, unknown>;

/**
 * Three-way: what the format changed itself (its value differs from what the
 * main composition made of it before) stays; everything else follows the
 * main composition now.
 */
function mergeKeys(mine: Bag, was: Bag, now: Bag, skip: string[] = []): Bag {
  const out: Bag = { ...now };
  for (const k of new Set([...Object.keys(mine), ...Object.keys(was), ...Object.keys(now)])) {
    if (skip.includes(k)) continue;
    if (!same(mine[k], was[k])) {
      if (mine[k] === undefined) delete out[k];
      else out[k] = mine[k];
    }
  }
  return out;
}

function mergeLayer(mine: Layer, was: Layer, now: Layer): Layer {
  const out = mergeKeys(mine as unknown as Bag, was as unknown as Bag, now as unknown as Bag, ['transform', 'children']);
  out.transform = mergeKeys(mine.transform as unknown as Bag, was.transform as unknown as Bag, now.transform as unknown as Bag);
  if (mine.type === 'group' && was.type === 'group' && now.type === 'group') out.children = mergeLayers(mine.children, was.children, now.children);
  return out as unknown as Layer;
}

/** The format's layers after the main composition changed from `was` to `now` (as made for this format). */
function mergeLayers(mine: Layer[], was: Layer[], now: Layer[]): Layer[] {
  const mineById = new Map(mine.map((l) => [l.id, l]));
  const wasById = new Map(was.map((l) => [l.id, l]));
  const nowIds = new Set(now.map((l) => l.id));
  const out: Layer[] = [];
  for (const n of now) {
    const m = mineById.get(n.id);
    const o = wasById.get(n.id);
    if (m && o) out.push(mergeLayer(m, o, n));
    else if (m) out.push(m);
    else if (!o) out.push(n); // new in the main composition
    // else: the format deleted it, and it stays deleted
  }
  // Layers the format added itself keep their place.
  mine.forEach((m, i) => {
    if (!wasById.has(m.id) && !nowIds.has(m.id)) out.splice(Math.min(i, out.length), 0, m);
  });
  return out;
}

/**
 * Formats follow the main composition: after an edit of the main one, each
 * format that follows it (all, unless `follow` is false) gets the change,
 * re-placed by the layers' constraints, keeping what was changed in the
 * format itself.
 */
export function followMain(before: TitleProject, after: TitleProject): TitleProject {
  const m0 = before.compositions.find((c) => c.id === before.main);
  const m1 = after.compositions.find((c) => c.id === after.main);
  if (!m0 || !m1 || m0 === m1 || before.main !== after.main) return after;
  let changed = false;
  const compositions = after.compositions.map((c) => {
    if (c.variantOf !== m1.id || c.follow === false) return c;
    const was = adaptComp(m0, c.width, c.height);
    const now = adaptComp(m1, c.width, c.height);
    const merged = mergeKeys(c as unknown as Bag, was as unknown as Bag, now as unknown as Bag, ['layers', 'id', 'name', 'width', 'height', 'variantOf', 'follow', 'guides']);
    const next = { ...merged, id: c.id, name: c.name, width: c.width, height: c.height, variantOf: c.variantOf, layers: mergeLayers(c.layers, was.layers, now.layers) } as Composition;
    if (c.follow !== undefined) next.follow = c.follow;
    if (c.guides) next.guides = c.guides;
    else delete next.guides;
    changed = true;
    return next;
  });
  return changed ? { ...after, compositions } : after;
}
