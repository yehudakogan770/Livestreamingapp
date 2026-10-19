import struct, moderngl
ctx = moderngl.create_standalone_context(backend='egl')
vs = '''#version 300 es
in vec2 aPos; out vec2 vUv; void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0);}'''
fs = '''#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform float uE;
void main(){ float x = vUv.x; o = vec4(pow(max(x * 0.7, 0.0), 1.0 / max(uE, 0.05)), x * 0.7, pow(2.0, 0.7), 1.0); }'''
p = ctx.program(vertex_shader=vs, fragment_shader=fs)
p['uE'].value = 1.0
q = ctx.buffer(struct.pack('8f', -1, -1, 1, -1, -1, 1, 1, 1))
v = ctx.vertex_array(p, [(q, '2f', 'aPos')])
t = ctx.texture((64, 1), 4, dtype='f4')
f = ctx.framebuffer([t])
f.use()
v.render(moderngl.TRIANGLE_STRIP)
d = struct.unpack('256f', t.read())
print('pow(x,1) vs x worst', max(abs(d[i * 4] - d[i * 4 + 1]) for i in range(64)), 'pow(2,.7)', d[2], 2**0.7)
