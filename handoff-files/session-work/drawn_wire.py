import sys
root = sys.argv[1]


def edit(path, pairs):
    p = root + '/' + path
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (path, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


edit('editor/app/src/model/effects.ts', [
    ("export const MASK_TYPES = ['mask', 'personmask', 'objectmask'];", "export const MASK_TYPES = ['mask', 'drawnmask', 'personmask', 'objectmask'];"),
    ("""  // ---- AI masks ----""", """  {
    type: 'drawnmask',
    name: 'Drawn mask',
    kind: 'video',
    group: 'Keying',
    params: [
      P('feather', 'Feather', 0, 200, 12, 1, 'px'),
      { ...P('invert', 'Invert', 0, 1, 0), toggle: true },
      { ...P('use', 'Use as', 0, 1, 0), options: USE_AS },
    ],
    data: { points: [], aspect: 16 / 9 },
  },
  // ---- AI masks ----"""),
])

edit('editor/app/src/vision/mattes.ts', [
    ("""export function matteFor(layer: Layer, e: EffectNow, missing?: () => void): { w: number; h: number; data: Uint8Array; stamp: string } | null {
  const src = layer.source;""", """export function matteFor(layer: Layer, e: EffectNow, missing?: () => void): { w: number; h: number; data: Uint8Array; stamp: string } | null {
  if (e.type === 'drawnmask') {
    // Drawn on the frame: the same for every source.
    const shape = drawnShape(e.d);
    return shape ? drawnMatte(shape, typeof e.p.feather === 'number' ? e.p.feather : 12, (e.p.invert ?? 0) >= 0.5) : null;
  }
  const src = layer.source;"""),
    ("import { canvasOf, segmentObject, segmentPerson, type ObjectMethod } from './segment';", "import { canvasOf, segmentObject, segmentPerson, type ObjectMethod } from './segment';\nimport { drawnMatte, drawnShape } from '../render/drawnmask';"),
])

edit('editor/app/src/render/compositor.ts', [
    ("""    if (e.type === 'personmask' || e.type === 'objectmask') {
      if ((e.p.use ?? 0) >= 0.5) return input;
      const m = this.maskTarget(layer, e, pics);""", """    if (e.type === 'personmask' || e.type === 'objectmask' || e.type === 'drawnmask') {
      if ((e.p.use ?? 0) >= 0.5) return input;
      const m = this.maskTarget(layer, e, pics);"""),
    ("""    // Placed exactly as the clip's picture is.
    const out = this.take();
    this.clear(out);
    this.place(t.tex, matte.w, matte.h, layer.motion, out);""", """    // Placed exactly as the clip's picture is (a drawn mask: over the whole frame, where it was drawn).
    const out = this.take();
    this.clear(out);
    this.place(t.tex, matte.w, matte.h, mask.type === 'drawnmask' ? WHOLE_FRAME : layer.motion, out);"""),
    ("import { moreEffectUniforms } from './fxlib';", "import { moreEffectUniforms } from './fxlib';\nimport { WHOLE_FRAME } from './drawnmask';"),
])

edit('editor/app/src/render/native/record.ts', [
    ("""    if (e.type === 'personmask' || e.type === 'objectmask') {
      if ((e.p.use ?? 0) >= 0.5) return input;""", """    if (e.type === 'personmask' || e.type === 'objectmask' || e.type === 'drawnmask') {
      if ((e.p.use ?? 0) >= 0.5) return input;"""),
    ("""    this.place(`r:${matte.id}`, matte.w, matte.h, layer.motion, out);""", """    this.place(`r:${matte.id}`, matte.w, matte.h, mask.type === 'drawnmask' ? WHOLE_FRAME : layer.motion, out);"""),
    ("import { moreEffectUniforms } from '../fxlib';", "import { moreEffectUniforms } from '../fxlib';\nimport { WHOLE_FRAME } from '../drawnmask';"),
])
