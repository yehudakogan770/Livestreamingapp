const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--enable-unsafe-webgpu'] });
  const pg = await b.newPage();
  await pg.goto('http://localhost:1421/?start');
  const r = await pg.evaluate(async () => {
    const out = {};
    for (const c of ['avc1.640028','vp09.00.40.08','vp8','av01.0.08M.08']) {
      out['enc '+c] = (await VideoEncoder.isConfigSupported({codec:c,width:1920,height:1080,bitrate:8e6,framerate:30})).supported;
      out['dec '+c] = (await VideoDecoder.isConfigSupported({codec:c})).supported;
    }
    for (const c of ['mp4a.40.2','opus']) out['aenc '+c] = (await AudioEncoder.isConfigSupported({codec:c,sampleRate:48000,numberOfChannels:2,bitrate:192000})).supported;
    const gl = document.createElement('canvas').getContext('webgl2');
    out.webgl2 = !!gl; out.float = gl && !!gl.getExtension('EXT_color_buffer_float');
    return out;
  });
  console.log(r);
  await b.close();
})();
