# Old effect shaders (from before this change) run one pass after another, against the one migrated node.
import json, struct, sys
import moderngl

D = sys.argv[1]
HIGHP = sys.argv[2] == 'highp' if len(sys.argv) > 2 else False
old = json.load(open(f'{D}/old_shaders.json'))
new = json.load(open(f'{D}/shaders.json'))
fx = json.load(open(f'{D}/migfix.json'))
ctx = moderngl.create_standalone_context(backend='egl')


def prog(src):
    if HIGHP:
        src = src.replace('precision highp float;', 'precision highp float;\nprecision highp sampler2D;', 1)
    return ctx.program(vertex_shader=new['vs'], fragment_shader=src)


quad = ctx.buffer(struct.pack('8f', -1, -1, 1, -1, -1, 1, 1, 1))
W, H = 32, 32
pixels = []
for i in range(W * H):
    pixels.append([((i * 37) % 97) / 96, ((i * 11) % 89) / 88, ((i * 53) % 83) / 82, 1.0 if i % 5 else 0.6])
# Premultiplied, as layers are.
data = b''.join(struct.pack('4f', p[0] * p[3], p[1] * p[3], p[2] * p[3], p[3]) for p in pixels)


def tex(d=None):
    t = ctx.texture((W, H), 4, d, dtype='f4')
    t.filter = (moderngl.NEAREST, moderngl.NEAREST)
    return t


def curve_tex(values):
    t = ctx.texture((256, 1), 4, bytes(values))
    t.filter = (moderngl.LINEAR, moderngl.LINEAR)
    return t


def run(p, inp, uniforms, extra=()):
    out = tex()
    fbo = ctx.framebuffer([out])
    fbo.use()
    inp.use(0)
    for unit, t in extra:
        t.use(unit)
    for k, v in {**uniforms, 'uTex': 0, 'uSize': [W, H]}.items():
        if k in p:
            p[k].value = tuple(v) if isinstance(v, list) else v
    ctx.vertex_array(p, [(quad, '2f', 'aPos')]).render(moderngl.TRIANGLE_STRIP)
    return out


src = tex(data)
cur = src
ct = curve_tex(fx['curve'])
for e in fx['legacy']:
    cur = run(prog(old[e['name']]), cur, {**e['u'], 'uCurve': 1}, [(1, ct)])
before = struct.unpack(f'{W*H*4}f', cur.read())

nt = curve_tex(fx['nodeCurve'])
after_t = run(prog(new['grade']), src, {**fx['node'], 'uBase': 1, 'uCurve': 2, 'uShowMatte': 0}, [(1, src), (2, nt)])
after = struct.unpack(f'{W*H*4}f', after_t.read())
worst = max(abs(a - b) for a, b in zip(before, after))
print(f'old effect passes vs migrated node ({"highp" if HIGHP else "default"} samplers): largest difference {worst:.2e} ({worst * 255:.3f} of an 8-bit step)')
sys.exit(0 if worst < 2 / 255 else 2)
