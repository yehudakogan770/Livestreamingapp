# Compile every effect shader on a real GL (Mesa), and run GRADE_FS against the TypeScript reference.
import json, struct, sys
import moderngl

D = sys.argv[1]
sh = json.load(open(f'{D}/shaders.json'))
fx = json.load(open(f'{D}/fixture.json'))
ctx = moderngl.create_standalone_context(backend='egl')

progs = {}
bad = 0
for name, src in sh.items():
    if name == 'vs':
        continue
    try:
        progs[name] = ctx.program(vertex_shader=sh['vs'], fragment_shader=src.replace('precision highp float;', 'precision highp float;\nprecision highp sampler2D;', 1))
    except Exception as e:
        bad += 1
        print('COMPILE FAIL', name, str(e)[:800])
print('compiled', len(progs), 'programs,', bad, 'failed')
if 'grade' not in progs:
    sys.exit(1)

prog = progs['grade']
quad = ctx.buffer(struct.pack('8f', -1, -1, 1, -1, -1, 1, 1, 1))
vao = ctx.vertex_array(prog, [(quad, '2f', 'aPos')])
W = H = 8
px = fx['pixels']
data = b''.join(struct.pack('4f', p[0], p[1], p[2], 1.0) for p in px)
src = ctx.texture((W, H), 4, data, dtype='f4')
src.filter = (moderngl.NEAREST, moderngl.NEAREST)
curve = ctx.texture((1, 1), 4, b'\0\0\0\0')
out = ctx.texture((W, H), 4, dtype='f4')
fbo = ctx.framebuffer([out])
worst = 0.0
for k, node in enumerate(fx['nodes']):
    fbo.use()
    src.use(0)
    src.use(1)
    curve.use(2)
    for name, v in {**node['uniforms'], 'uTex': 0, 'uBase': 1, 'uCurve': 2, 'uSize': [W, H], 'uShowMatte': 0}.items():
        if name not in prog:
            continue
        prog[name].value = tuple(v) if isinstance(v, list) else v
    vao.render(moderngl.TRIANGLE_STRIP)
    got = struct.unpack(f'{W*H*4}f', out.read())
    err = 0.0
    for i, e in enumerate(node['expected']):
        for c in range(3):
            err = max(err, abs(got[i * 4 + c] - e[c]) / max(1.0, abs(e[c])))
    wi = max(range(len(node['expected'])), key=lambda i: max(abs(got[i*4+c]-node['expected'][i][c]) for c in range(3)))
    print('  worst pixel', wi, 'in', px[wi], 'gpu', [round(x,5) for x in got[wi*4:wi*4+3]], 'ts', [round(x,5) for x in node['expected'][wi]])
    print(f'node {k}: largest difference GPU vs TypeScript = {err:.2e}')
    worst = max(worst, err)
print('worst', worst)
sys.exit(0 if worst < 1e-3 and bad == 0 else 2)
