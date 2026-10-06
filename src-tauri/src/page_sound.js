// Put into every web page window by Lumora: the page's sound goes to
// Lumora's mixer (raw 48 kHz stereo, to this computer only), and the page
// itself stays silent so nothing is heard twice.
(() => {
  if (window.top !== window || window.__lumoraSound) return;
  window.__lumoraSound = true;
  const url = 'http://127.0.0.1:__PORT__/audio-in/' + encodeURIComponent(__ID__) + '?t=' + encodeURIComponent(__KEY__);
  let ctx = null;
  let mix = null;
  const hooked = new WeakMap();
  let queue = [];
  let queued = 0;

  function start() {
    if (ctx) return;
    ctx = new AudioContext({ sampleRate: 48000 });
    mix = ctx.createGain();
    const sp = ctx.createScriptProcessor(2048, 2, 2);
    mix.connect(sp);
    // Output nothing: the processor's output buffer is left silent.
    sp.connect(ctx.destination);
    sp.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0);
      const r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l;
      const out = new Int16Array(l.length * 2);
      for (let i = 0; i < l.length; i++) {
        out[i * 2] = Math.max(-1, Math.min(1, l[i])) * 32767;
        out[i * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
      }
      queue.push(out);
      queued += out.byteLength;
    };
    setInterval(flush, 60);
    const wake = () => ctx.state !== 'running' && ctx.resume().catch(() => {});
    setInterval(wake, 1000);
  }

  function flush() {
    if (!queued) return;
    const body = new Uint8Array(queued);
    let at = 0;
    for (const q of queue) {
      body.set(new Uint8Array(q.buffer), at);
      at += q.byteLength;
    }
    queue = [];
    queued = 0;
    fetch(url, { method: 'POST', body, mode: 'cors', keepalive: false }).catch(() => {});
  }

  function hook(el) {
    let stream = el.srcObject instanceof MediaStream ? el.srcObject : null;
    if (!stream && (el.currentSrc || el.src)) {
      try {
        stream = el.captureStream ? el.captureStream() : null;
      } catch (e) {
        stream = null;
      }
    }
    if (!stream || hooked.get(el) === stream || !stream.getAudioTracks().length) return;
    start();
    try {
      ctx.createMediaStreamSource(stream).connect(mix);
      hooked.set(el, stream);
      el.muted = true;
    } catch (e) {
      // A page that forbids it keeps its own sound.
    }
  }

  setInterval(() => document.querySelectorAll('video, audio').forEach(hook), 1000);
})();
