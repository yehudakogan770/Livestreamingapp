root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/render/maskfx.ts', [
("""/** The effect's result inside the mask""","""/** The layer kept where a mask is (or where it isn't, with \\`uInvert\\`): a Merge node's mask. */
export const MATTE_FS = `${HEAD}
uniform sampler2D uMask;
uniform float uInvert;
void main() {
  float m = texture(uMask, vUv).a;
  outColor = texture(uTex, vUv) * (uInvert > 0.5 ? 1.0 - m : m);
}`;

/** The effect's result inside the mask"""),
])

edit('editor/app/src/render/compositor.ts', [
("""import { CUTOUT_FS, LIMIT_FS } from './maskfx';""","""import { CUTOUT_FS, LIMIT_FS, MATTE_FS } from './maskfx';
import { BLENDS, evaluationOrder, graphOf, nodeNumbers, nodeParams, outputNode, type CompNode } from '../model/nodes';"""),
("""  private signal: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;""","""  private signal: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  /** What is under the layer being drawn (for a node composite's Background node). */
  private under: Target | null = null;"""),
("""      case 'grade':
        return this.grade(e, input, layer);""","""      case 'grade':
        return this.grade(e, input, layer);
      case 'nodes':
        return this.nodeComposite(e, input, pics, layer);"""),
("""    for (const op of ops) {
      if (op.kind === 'layer') {
        const t = this.renderLayer(op.layer, pics);
        if (!t) continue;""","""    for (const op of ops) {
      if (op.kind === 'layer') {
        // A node composite can use what is under it.
        const was = this.under;
        this.under = acc;
        const t = this.renderLayer(op.layer, pics);
        this.under = was;
        if (!t) continue;"""),
("""  /** One grade node drawn from `input`, mixed over `base`. */""","""  /**
   * A node composite (model/nodes.ts): each node the output needs, worked out
   * after what feeds it. Gives back the output's picture (the input is given
   * back if it was replaced).
   */
  private nodeComposite(e: EffectNow, input: Target, pics: Pictures, layer: Layer): Target {
    const g = graphOf(e);
    const out = outputNode(g);
    if (!out) return input;
    const under = this.under;
    const made = new Map<string, Target>();
    const ours = new Set<Target>();
    const k = this.h / this.seqH;
    const of = (id: string | null | undefined): Target | null => (id ? (made.get(id) ?? null) : null);
    const fresh = (): Target => {
      const t = this.take();
      ours.add(t);
      return t;
    };
    const keep = (t: Target): Target => {
      ours.add(t);
      return t;
    };
    /** A generated (SDR) picture brought into an HDR sequence's coding. */
    const inSpace = (t: Target): Target => {
      if (this.space === 'rec709') return t;
      return keep(this.pass('tospace', TO_SPACE_FS, t, { uFrom: 0, uTo: TRANSFER_CODE[transferOf(this.space)] }));
    };
    for (const n of evaluationOrder(g)) {
      const num = nodeNumbers(n, e.p);
      const a = of(n.inputs[0]);
      let r: Target | null = null;
      if (n.kind === 'in') r = input;
      else if (n.kind === 'under') r = under;
      else if (n.kind === 'out') r = a;
      else if (n.off) r = a;
      else r = this.nodeStep(n, num, a, of, fresh, keep, inSpace, pics, layer, e.id, k);
      if (r) made.set(n.id, r);
    }
    let result = made.get(out.id) ?? null;
    // The output is a picture of our own (never the caller's input or what is under the clip).
    if (result === under && result) result = this.pass('copy', COPY_FS, result, { uOpacity: 1 });
    if (!result) {
      result = this.take();
      this.clear(result);
    }
    for (const t of ours) if (t !== result) this.give(t);
    if (result !== input) this.give(input);
    return result;
  }

  /** One node of a composite (not the clip, background or output). */
  private nodeStep(
    n: CompNode,
    num: (k: string, d?: number) => number,
    a: Target | null,
    of: (id: string | null | undefined) => Target | null,
    fresh: () => Target,
    keep: (t: Target) => Target,
    inSpace: (t: Target) => Target,
    pics: Pictures,
    layer: Layer,
    effectId: string,
    k: number,
  ): Target | null {
    switch (n.kind) {
      case 'solid': {
        const t = fresh();
        const op = Math.max(0, Math.min(1, num('opacity', 100) / 100));
        const [r, g, b] = hexToRgb(n.d?.color ?? '#1e2a38');
        this.clear(t, [r * op, g * op, b * op, op]);
        return inSpace(t);
      }
      case 'gradient': {
        const t = fresh();
        this.generate(
          {
            kind: 'generator',
            gen: 'gradient',
            settings: {
              color1: n.d?.color1 ?? '#1e3a5f',
              color2: n.d?.color2 ?? '#d08a48',
              a: (num('angle', 90) / 360) * 100,
              b: num('center', 50),
              c: num('softness', 50),
              kind: num('round') >= 0.5 ? 1 : 0,
            },
            local: layer.local,
            length: layer.clip.length,
            fps: layer.fps,
          },
          t,
        );
        return inSpace(t);
      }
      case 'transform': {
        if (!a) return null;
        const t = fresh();
        this.clear(t);
        this.place(
          a.tex,
          this.w,
          this.h,
          {
            x: num('x'),
            y: num('y'),
            scale: num('scale', 100),
            scaleX: 100,
            rotation: num('rotation'),
            rotX: 0,
            rotY: 0,
            z: 0,
            cropL: num('cropL'),
            cropR: num('cropR'),
            cropT: num('cropT'),
            cropB: num('cropB'),
            opacity: 100,
            blend: 'normal',
            fill: false,
          },
          t,
        );
        return t;
      }
      case 'mask': {
        if (!a && !this.white) {
          this.white = this.makeTexture();
          this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        }
        return keep(this.pass('mask', EFFECT_FS.mask as string, a ?? (this.white as WebGLTexture), shapeMask(num)));
      }
      case 'merge': {
        const bg = a;
        const fg = of(n.inputs[1]);
        const mask = of(n.inputs[2]);
        if (!fg) return bg;
        const opacity = Math.max(0, Math.min(1, num('opacity', 100) / 100));
        const top = mask ? keep(this.pass('matte', MATTE_FS, fg, { uMask: [mask.tex, 1], uInvert: num('invert') })) : fg;
        if (!bg) return opacity >= 1 ? top : keep(this.pass('copy', COPY_FS, top, { uOpacity: opacity }));
        const mode = BLENDS[Math.round(num('blend'))] ?? 'normal';
        return keep(this.pass('composite', COMPOSITE_FS, top, { uBase: [bg.tex, 1], uOpacity: opacity, uMode: Math.max(0, BLEND_MODES.indexOf(mode)) }));
      }
      case 'fx': {
        if (!a || !n.fx) return a;
        const p: Record<string, number> = {};
        for (const pd of nodeParams(n)) p[pd.key] = num(pd.key, pd.def);
        // The effect may give its input back: it gets a copy (other nodes may read this one too).
        const copy = this.pass('copy', COPY_FS, a, { uOpacity: 1 });
        const done = this.effect({ id: `${effectId}/${n.id}`, type: n.fx, p, d: { ...(n.d ?? {}) } }, copy, pics, layer);
        void k;
        return keep(done);
      }
      default:
        return a;
    }
  }

  /** One grade node drawn from `input`, mixed over `base`. */"""),
])
