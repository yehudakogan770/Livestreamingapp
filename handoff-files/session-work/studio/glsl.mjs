import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('console:', m.text()));
await page.goto('http://127.0.0.1:1471/?demo');
await page.waitForTimeout(2000);
const out = await page.evaluate(async () => {
  const hdr = await import('/src/render/hdr.ts');
  const sh = await import('/src/render/shaders.ts');
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2');
  gl.getExtension('EXT_color_buffer_float');
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = (fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, sh.FULL_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    return p;
  };
  const colors = [
    [238, 240, 241, 255],
    [255, 0, 255, 255],
    [242, 242, 0, 255],
    [128, 128, 128, 255],
  ];
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(colors.flat()));
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // Pass 1: SDR -> PQ into a float target.
  const t2 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t2);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t2, 0);
  gl.viewport(0, 0, 4, 1);
  const p1 = prog(hdr.TO_SPACE_FS);
  gl.useProgram(p1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(gl.getUniformLocation(p1, 'uTex'), 0);
  gl.uniform1i(gl.getUniformLocation(p1, 'uFrom'), 0);
  gl.uniform1i(gl.getUniformLocation(p1, 'uTo'), 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const mid = new Float32Array(16);
  gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.FLOAT, mid);
  // Pass 2: screen.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const p2 = prog(hdr.SCREEN_FS);
  gl.useProgram(p2);
  gl.bindTexture(gl.TEXTURE_2D, t2);
  gl.uniform1i(gl.getUniformLocation(p2, 'uTex'), 0);
  gl.uniform1i(gl.getUniformLocation(p2, 'uTf'), 1);
  gl.uniform3f(gl.getUniformLocation(p2, 'uBack'), 0, 0, 0);
  gl.uniform1f(gl.getUniformLocation(p2, 'uFlip'), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const px = new Uint8Array(16);
  gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const cpu = colors.map((c) => hdr.sdrToSpace([c[0] / 255, c[1] / 255, c[2] / 255], 'pq'));
  const cpuBack = cpu.map((c) => hdr.spaceToSdr(c, 'pq').map((v) => Math.round(v * 255)));
  return { mid: Array.from(mid).map((v) => v.toFixed(4)), px: Array.from(px), cpu: cpu.map((c) => c.map((v) => v.toFixed(4))), cpuBack };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
