// Injected before the page: real footage as camera feeds, sound-like signals
// as microphones, and an evening clock (7:41 PM) for the screenshots.
(() => {
  const target = new Date();
  target.setHours(19, 41, 20, 0);
  const off = target.getTime() - Date.now();
  const RD = Date;
  class D extends RD {
    constructor(...a) {
      if (a.length === 0) super(RD.now() + off);
      else super(...a);
    }
    static now() {
      return RD.now() + off;
    }
  }
  window.Date = D;
  try {
    localStorage.setItem('lumora.textSize', 'normal');
  } catch {}

  const CAMS = [
    ['cam-wide', 'Wide', '/real/foot/webm/8716579.webm'],
    ['cam-left', 'Stage left', '/real/foot/webm/8716574.webm'],
    ['cam-close', 'Podium close-up', '/real/foot/webm/8716429.webm'],
    ['cam-aud', 'Audience', '/real/foot/webm/8716444.webm'],
  ];
  // [id, name, level (0-1), kind]
  const MICS = [
    ['mic-podium', 'Podium', 0.55, 'speech'],
    ['mic-h1', 'HH 1', 0.25, 'speech'],
    ['mic-h2', 'HH 2', 0.03, 'idle'],
    ['mic-play', 'Video', 0.0, 'idle'],
    ['mic-room', 'Room', 0.12, 'room'],
  ];
  window.__CAMS = CAMS;
  window.__MICS = MICS;
  const dev = (deviceId, kind, label) => ({ deviceId, kind, label, groupId: deviceId, toJSON() {} });
  const md = navigator.mediaDevices;
  md.enumerateDevices = async () => [
    ...CAMS.map(([id, label]) => dev(id, 'videoinput', label)),
    ...MICS.map(([id, label]) => dev(id, 'audioinput', label)),
    dev('default', 'audiooutput', 'Speakers'),
  ];
  const videos = new Map();
  function videoFor(id) {
    let v = videos.get(id);
    if (v) return v;
    const cam = CAMS.find((c) => c[0] === id) ?? CAMS[0];
    v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.src = cam[2];
    v.style.cssText = 'position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.01;pointer-events:none;z-index:-1';
    const add = () => document.body.appendChild(v);
    if (document.body) add();
    else addEventListener('DOMContentLoaded', add);
    void v.play().catch(() => {});
    videos.set(id, v);
    return v;
  }
  let ctx = null;
  const bufs = new Map();
  function micBuffer(level, kind) {
    const sr = ctx.sampleRate;
    const n = sr * 8;
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    let seed = 7 + level * 1000;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let env = 0;
    let syl = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (kind === 'speech') {
        if (i % Math.round(sr * 0.18) === 0) syl = Math.random() < 0.78 ? 0.4 + Math.random() * 0.6 : 0.05;
        const pause = Math.sin(t * 0.9) > 0.85 ? 0.1 : 1;
        env += (syl * pause - env) * 0.0015;
        lp += (rnd() - lp) * 0.25;
        d[i] = lp * env * level * 2.2 + Math.sin(2 * Math.PI * 140 * t) * env * level * 0.3;
      } else if (kind === 'room') {
        lp += (rnd() - lp) * 0.08;
        d[i] = lp * level * (0.8 + 0.2 * Math.sin(t * 1.3));
      } else d[i] = rnd() * level * 0.2;
    }
    return b;
  }
  function micStream(id) {
    ctx ??= new AudioContext();
    void ctx.resume();
    const mic = MICS.find((m) => m[0] === id) ?? MICS[0];
    if (!bufs.has(id)) bufs.set(id, micBuffer(mic[2], mic[3]));
    const src = ctx.createBufferSource();
    src.buffer = bufs.get(id);
    src.loop = true;
    const dst = ctx.createMediaStreamDestination();
    src.connect(dst);
    src.start(0, Math.random() * 6);
    return dst.stream;
  }
  const pick = (c, list) => {
    const d = c && typeof c === 'object' ? c.deviceId : null;
    const id = d && typeof d === 'object' ? (d.exact ?? d.ideal) : d;
    return id || list[0][0];
  };
  md.getUserMedia = async (c) => {
    if (c.video) {
      const v = videoFor(pick(c.video, CAMS));
      if (v.readyState < 2) await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
      void v.play().catch(() => {});
      return new MediaStream(v.captureStream().getVideoTracks());
    }
    return micStream(pick(c.audio, MICS));
  };
})();
