import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/core')
p='render.ts'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)

# Scene gets the camera.
rep('''  const scene: Scene = { comp, t, base, f, index, groups, mattes };
  drawList(ctx, comp.layers, 1, scene);
}

interface Scene {
  comp: Composition;
  t: number;
  base: Mat;
  f: Frame;
  index: Map<string, Layer>;
  groups: Map<string, string>;
  mattes: Set<string>;
}

function drawList(ctx: Ctx, layers: Layer[], alpha: number, s: Scene) {
  for (let n = layers.length - 1; n >= 0; n--) {
    const l = layers[n]!;
    if (!active(l, s.t) || s.mattes.has(l.id) || s.f.skip?.(l)) continue;
    drawLayer(ctx, l, alpha, s);
  }
}''','''  const cam = sceneCamera(comp, t, base, f.px);
  const scene: Scene = { comp, t, base, f, index, groups, mattes, cam };
  drawList(ctx, comp.layers, 1, scene);
}

interface Scene {
  comp: Composition;
  t: number;
  base: Mat;
  f: Frame;
  index: Map<string, Layer>;
  groups: Map<string, string>;
  mattes: Set<string>;
  /** The composition's camera (its camera layer, or the plain one looking at the middle). */
  cam: Camera;
}

function drawList(ctx: Ctx, layers: Layer[], alpha: number, s: Scene) {
  // Back to front; next to each other, 3D layers are drawn far ones first (depth sorted).
  const order: Layer[] = [];
  let run: { l: Layer; d: number }[] = [];
  const flush = () => {
    run.sort((a, b) => b.d - a.d);
    for (const r of run) order.push(r.l);
    run = [];
  };
  for (let n = layers.length - 1; n >= 0; n--) {
    const l = layers[n]!;
    if (!active(l, s.t) || s.mattes.has(l.id) || s.f.skip?.(l)) continue;
    if (inDepth(l, s.cam)) run.push({ l, d: layerDepth(l, s) });
    else {
      flush();
      order.push(l);
    }
  }
  flush();
  for (const l of order) drawLayer(ctx, l, alpha, s);
}''')

rep('''function needsOwnCanvas(l: Layer): boolean {
  return !!(l.masks?.length || l.matte || effectsOn(l).length || (l.blend && l.blend !== 'normal' && l.type === 'group') || is3d(l));
}

/** Does the layer turn in 3D (X or Y rotation, or depth)? */
export function is3d(l: Layer): boolean {
  const tr = l.transform;
  const on = (p: Prop | undefined) => !!p && (isAnimated(p) || !!p.x || (p.v ?? 0) !== 0);
  return on(tr.rotationX) || on(tr.rotationY) || on(tr.z);
}

/** The 3D turn of a layer at t: a point of the picture (px) to where the camera sees it, or null behind the camera. */
export function projector(l: Layer, t: number, pivot: Vec2, distance: number, px = 1): (x: number, y: number) => Vec2 | null {
  const rx = (num(l.transform.rotationX, t, 0) * Math.PI) / 180;
  const ry = (num(l.transform.rotationY, t, 0) * Math.PI) / 180;
  const z0 = num(l.transform.z, t, 0) * px;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  return (x, y) => {
    const px = x - pivot[0];
    const py = y - pivot[1];
    // Turn about Y (across), then X (up and down).
    const x1 = px * cy;
    const z1 = -px * sy;
    const y2 = py * cx - z1 * sx;
    const z2 = py * sx + z1 * cx + z0;
    const k = distance + z2;
    if (k <= distance * 0.05) return null;
    const s = distance / k;
    return [pivot[0] + x1 * s, pivot[1] + y2 * s];
  };
}''','''function needsOwnCanvas(l: Layer, s?: Scene): boolean {
  return !!(
    l.masks?.length ||
    l.matte ||
    effectsOn(l).length ||
    (l.blend && l.blend !== 'normal' && l.type === 'group') ||
    (s ? inDepth(l, s.cam) : is3d(l) || extrusion(l) > 0)
  );
}

/** Does the layer turn in 3D (X or Y rotation, or depth, not all zero)? */
export function is3d(l: Layer): boolean {
  const tr = l.transform;
  const on = (p: Prop | undefined) => !!p && (isAnimated(p) || !!p.x || (p.v ?? 0) !== 0);
  return on(tr.rotationX) || on(tr.rotationY) || on(tr.z);
}

/** A 3D layer (its 3D switch on: X and Y rotation and depth), whatever their values. */
export const isLayer3d = (l: Layer): boolean => !!(l.transform.rotationX || l.transform.rotationY || l.transform.z) || extrusion(l) > 0;

/** How deep the layer is extruded, px (0: flat). */
export const extrusion = (l: Layer): number => (l.extrude && l.extrude.depth > 0 ? l.extrude.depth : 0);

/** Is the layer drawn in depth: turned, moved in depth, extruded, or a 3D layer seen through a camera that moves. */
function inDepth(l: Layer, cam: Camera): boolean {
  if (l.type === 'null') return false;
  return is3d(l) || extrusion(l) > 0 || (cam.moved && isLayer3d(l));
}

/**
 * The composition's camera, in the canvas's pixels: where it looks (the
 * point of interest, shown in the middle of the picture), how far it is
 * (`dist`, the composition's camera distance, and `back`, its own move away),
 * and how it is turned about that point (orbit across and up and down, and
 * roll). Without a camera layer it looks straight at the middle.
 */
export interface Camera {
  center: Vec2;
  poi: Vec2;
  rx: number;
  ry: number;
  rz: number;
  dist: number;
  back: number;
  /** The camera is moved or turned (3D layers at rest are not flat to it). */
  moved: boolean;
}

/** The camera layer of a composition at t: the first visible one on screen (a null layer marked as the camera). */
export function cameraLayer(comp: Composition, t: number): Layer | undefined {
  return comp.layers.find((l) => l.type === 'null' && l.camera && l.visible && t >= l.start && t < l.end);
}

export function sceneCamera(comp: Composition, t: number, base: Mat = IDENTITY, px = 1): Camera {
  const center: Vec2 = [base[0] * comp.width * 0.5 + base[2] * comp.height * 0.5 + base[4], base[1] * comp.width * 0.5 + base[3] * comp.height * 0.5 + base[5]];
  const dist = (comp.perspective ?? 2000) * px;
  const l = cameraLayer(comp, t);
  if (!l) return { center, poi: center, rx: 0, ry: 0, rz: 0, dist, back: 0, moved: false };
  const p = vec(l.transform.position, t, [comp.width / 2, comp.height / 2]);
  const poi: Vec2 = [base[0] * p[0] + base[2] * p[1] + base[4], base[1] * p[0] + base[3] * p[1] + base[5]];
  const rad = (v: number) => (v * Math.PI) / 180;
  const rx = rad(num(l.transform.rotationX, t, 0));
  const ry = rad(num(l.transform.rotationY, t, 0));
  const rz = rad(num(l.transform.rotation, t, 0));
  // The camera never goes past the point it looks at.
  const back = Math.max(-dist * 0.9, num(l.transform.z, t, 0) * px);
  const moved = !!(rx || ry || rz || back || Math.abs(poi[0] - center[0]) > 0.01 || Math.abs(poi[1] - center[1]) > 0.01);
  return { center, poi, rx, ry, rz, dist, back, moved };
}

/** A point in the scene (canvas px, z away from the camera) as the camera sees it: its place and how deep it is (null behind the camera). */
export function camView(cam: Camera, x: number, y: number, z: number): { p: Vec2; depth: number } | null {
  let dx = x - cam.poi[0];
  let dy = y - cam.poi[1];
  let dz = z;
  // The camera turned one way is the scene turned the other way about the point it looks at.
  if (cam.ry) {
    const c = Math.cos(-cam.ry);
    const s = Math.sin(-cam.ry);
    const nx = dx * c - dz * s;
    dz = dx * s + dz * c;
    dx = nx;
  }
  if (cam.rx) {
    const c = Math.cos(-cam.rx);
    const s = Math.sin(-cam.rx);
    const ny = dy * c - dz * s;
    dz = dy * s + dz * c;
    dy = ny;
  }
  if (cam.rz) {
    const c = Math.cos(-cam.rz);
    const s = Math.sin(-cam.rz);
    const nx = dx * c - dy * s;
    dy = dx * s + dy * c;
    dx = nx;
  }
  const k = cam.dist + cam.back + dz;
  if (k <= cam.dist * 0.05) return null;
  const f = cam.dist / k;
  return { p: [cam.center[0] + dx * f, cam.center[1] + dy * f], depth: k };
}

/**
 * The 3D turn of a layer at t: a point of its picture (px) to where the
 * camera sees it, or null behind the camera. `along` moves it back along the
 * layer's own depth (the slices of an extruded layer). Given a plain distance
 * instead of a camera, it looks straight at the pivot.
 */
export function projector(l: Layer, t: number, pivot: Vec2, camera: Camera | number, px = 1, along = 0): (x: number, y: number) => Vec2 | null {
  const cam: Camera =
    typeof camera === 'number' ? { center: pivot, poi: pivot, rx: 0, ry: 0, rz: 0, dist: camera, back: 0, moved: false } : camera;
  const turn = turner(l, t, px);
  return (x, y) => {
    const q = turn(x - pivot[0], y - pivot[1], along);
    const v = camView(cam, pivot[0] + q[0], pivot[1] + q[1], q[2]);
    return v ? v.p : null;
  };
}

/** A layer's own 3D turn and depth: a point relative to its pivot (and `along` its depth) to the scene. */
function turner(l: Layer, t: number, px: number): (x: number, y: number, along: number) => [number, number, number] {
  const rx = (num(l.transform.rotationX, t, 0) * Math.PI) / 180;
  const ry = (num(l.transform.rotationY, t, 0) * Math.PI) / 180;
  const z0 = num(l.transform.z, t, 0) * px;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  return (x, y, along) => {
    // Turn about Y (across), then X (up and down); `along` is the layer's own depth.
    const x1 = x * cy + along * sy;
    const z1 = -x * sy + along * cy;
    const y2 = y * cx - z1 * sx;
    const z2 = y * sx + z1 * cx + z0;
    return [x1, y2, z2];
  };
}

/** The pivot of a 3D layer on the canvas (its anchor point through its 2D transform). */
function pivotOf(l: Layer, world: Mat, t: number): Vec2 {
  const a = vec(l.transform.anchor, t, [0, 0]);
  return [world[0] * a[0] + world[2] * a[1] + world[4], world[1] * a[0] + world[3] * a[1] + world[5]];
}

/** How far from the camera a 3D layer's pivot is (for drawing far ones first). */
function layerDepth(l: Layer, s: Scene): number {
  const world = mul(s.base, worldMatrix(s.comp, l, s.t, s.index, s.groups));
  const pv = pivotOf(l, world, s.t);
  const q = turner(l, s.t, s.f.px)(0, 0, extrusion(l) * s.f.px * 0.5);
  return camView(s.cam, pv[0] + q[0], pv[1] + q[1], q[2])?.depth ?? -Infinity;
}

/**
 * Where a layer's points are seen in the composition (3D layers through the
 * camera; others as they are): for the designer's selection and hit tests.
 */
export function viewOfLayer(comp: Composition, l: Layer, t: number): ((p: Vec2) => Vec2) | null {
  const cam = sceneCamera(comp, t);
  if (!inDepth(l, cam)) return null;
  const world = worldMatrix(comp, l, t);
  const proj = projector(l, t, pivotOf(l, world, t), cam);
  return (p) => proj(p[0], p[1]) ?? p;
}''')

# drawLayer: own canvas decision with scene, and the 3D branch.
rep('''  if (!needsOwnCanvas(l)) {
    ctx.save();''','''  if (!needsOwnCanvas(l, s)) {
    ctx.save();''')
rep('''  if (is3d(l)) {
    // 3D: the layer's picture turned about its anchor point and seen through the camera.
    const a = vec(l.transform.anchor, t, [0, 0]);
    const pivot: Vec2 = [world[0] * a[0] + world[2] * a[1] + world[4], world[1] * a[0] + world[3] * a[1] + world[5]];
    const project = projector(l, t, pivot, (s.comp.perspective ?? 2000) * s.f.px, s.f.px);
    const bend = Math.max(
      Math.abs(Math.sin((num(l.transform.rotationX, t, 0) * Math.PI) / 180)),
      Math.abs(Math.sin((num(l.transform.rotationY, t, 0) * Math.PI) / 180)),
    );
    const area = l.type === 'group' || l.type === 'comp' ? { x: 0, y: 0, w: cw, h: ch } : canvasBox(own, l, world, s);
    drawProjected(ctx, surf as CanvasImageSource, area, project, Math.ceil(2 + bend * 14));
  } else ctx.drawImage(surf as CanvasImageSource, 0, 0);''','''  if (inDepth(l, s.cam)) {
    // 3D: the layer's picture turned about its anchor point and seen through the camera.
    const pivot = pivotOf(l, world, t);
    const project = projector(l, t, pivot, s.cam, s.f.px);
    const bend = Math.max(
      Math.abs(Math.sin((num(l.transform.rotationX, t, 0) * Math.PI) / 180)),
      Math.abs(Math.sin((num(l.transform.rotationY, t, 0) * Math.PI) / 180)),
      Math.abs(Math.sin(s.cam.rx)),
      Math.abs(Math.sin(s.cam.ry)),
    );
    const area = l.type === 'group' || l.type === 'comp' ? { x: 0, y: 0, w: cw, h: ch } : canvasBox(own, l, world, s);
    const steps = Math.ceil(2 + bend * 14);
    const depth = extrusion(l) * s.f.px;
    if (depth > 0 && area.w > 0 && area.h > 0) drawExtruded(ctx, surf, l, pivot, area, depth, steps, s);
    else drawProjected(ctx, surf as CanvasImageSource, area, project, steps);
  } else ctx.drawImage(surf as CanvasImageSource, 0, 0);''')

rep('''/** The part of the canvas a layer covers (its box through its transform), px. */''','''/**
 * An extruded layer: its outline repeated back along its depth in the side
 * color (the layer's own colors, darker, when none is given), shaded darker
 * toward the back, then its face; the far side first, so turned around it
 * shows its back.
 */
function drawExtruded(ctx: Ctx, surf: Surface, l: Layer, pivot: Vec2, area: { x: number; y: number; w: number; h: number }, depth: number, steps: number, s: Scene) {
  const t = s.t;
  const cw = surf.width;
  const ch = surf.height;
  const sides = s.f.env.createCanvas(cw, ch);
  const sc = sides?.getContext('2d') as Ctx | null;
  const face = projector(l, t, pivot, s.cam, s.f.px, 0);
  if (!sides || !sc) {
    drawProjected(ctx, surf as CanvasImageSource, area, face, steps);
    return;
  }
  sc.drawImage(surf as CanvasImageSource, 0, 0);
  const color = l.extrude?.color ? resolveColor(l.extrude.color, s.f.tokens, s.f.values, '#000000') : null;
  if (color) tintCanvas(sc, color);
  else {
    sc.save();
    sc.globalCompositeOperation = 'source-atop';
    sc.fillStyle = 'rgba(0,0,0,0.5)';
    sc.fillRect(0, 0, cw, ch);
    sc.restore();
  }
  // How far the back is seen from the face on screen: enough slices for a solid side.
  const corners: Vec2[] = [
    [area.x, area.y],
    [area.x + area.w, area.y],
    [area.x + area.w, area.y + area.h],
    [area.x, area.y + area.h],
  ];
  const back = projector(l, t, pivot, s.cam, s.f.px, depth);
  let spread = 0;
  for (const [x, y] of corners) {
    const a = face(x, y);
    const b = back(x, y);
    if (a && b) spread = Math.max(spread, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  const n = Math.max(1, Math.min(96, Math.ceil(spread / 1.25)));
  const sliceSteps = Math.max(1, Math.ceil(steps / 3));
  // Which way is away from the camera: the face is in front when its depth is the smaller.
  const q = turner(l, t, s.f.px);
  const front = q(0, 0, 0);
  const rear = q(0, 0, depth);
  const dFront = camView(s.cam, pivot[0] + front[0], pivot[1] + front[1], front[2])?.depth ?? 0;
  const dRear = camView(s.cam, pivot[0] + rear[0], pivot[1] + rear[1], rear[2])?.depth ?? 0;
  const faceFirst = dFront > dRear;
  const slice = (i: number) => {
    const along = (depth * i) / n;
    ctx.save();
    // Darker toward the back.
    ctx.globalAlpha *= 1;
    drawProjected(ctx, sides as CanvasImageSource, area, projector(l, t, pivot, s.cam, s.f.px, along), sliceSteps);
    ctx.restore();
  };
  if (faceFirst) {
    drawProjected(ctx, surf as CanvasImageSource, area, face, steps);
    for (let i = 1; i <= n; i++) slice(i);
  } else {
    for (let i = n; i >= 1; i--) slice(i);
    drawProjected(ctx, surf as CanvasImageSource, area, face, steps);
  }
}

/** The part of the canvas a layer covers (its box through its transform), px. */''')
open(p,'w').write(s)

p='types.ts'; s=open(p).read()
rep('''  /** How it is re-placed in another format of the title (16:9 → 9:16…); nearest edge when left out. */
  constraints?: Constraints;
}''','''  /** How it is re-placed in another format of the title (16:9 → 9:16…); nearest edge when left out. */
  constraints?: Constraints;
  /** Extruded in depth (a 3D layer with sides): how deep, px, and the sides' color (the layer's own colors, darker, when left out). */
  extrude?: { depth: number; color?: ColorRef } | null;
}''')
rep('''export interface NullLayer extends LayerBase {
  type: 'null';
}''','''export interface NullLayer extends LayerBase {
  type: 'null';
  /**
   * The composition's camera (the first one on screen): it looks at its
   * position, orbits that point by its X and Y rotation, rolls by its
   * rotation and moves away by its depth (Z). 3D layers are seen through it.
   */
  camera?: boolean;
}''')
open(p,'w').write(s)
