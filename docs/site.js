// The Lumora website: a small working switcher, the three screens that follow
// it, the run of show, and the PANIC button. Every picture is drawn here.
(() => {
  const W = 640;
  const H = 360;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MARK = [
    ['M25.65 3.06 A21 21 0 0 1 42.95 33.04 L29.01 33.23 A10.5 10.5 0 0 0 30.82 16.02 Z', '#4fb3bf'],
    ['M41.31 35.89 A21 21 0 0 1 6.69 35.89 L13.50 23.73 A10.5 10.5 0 0 0 27.50 33.90 Z', '#d6d8dc'],
    ['M5.05 33.04 A21 21 0 0 1 22.35 3.06 L29.49 15.05 A10.5 10.5 0 0 0 13.68 22.09 Z', '#8f949c'],
  ].map(([d, c]) => [new Path2D(d), c]);
  const FONT = "'Archivo', 'Segoe UI', sans-serif";

  /** The Lumora mark, `size` px wide, centred at x, y. */
  function mark(c, x, y, size, spin = 0) {
    c.save();
    c.translate(x, y);
    c.rotate(spin);
    c.scale(size / 48, size / 48);
    c.translate(-24, -24);
    for (const [p, col] of MARK) {
      c.fillStyle = col;
      c.fill(p);
    }
    c.beginPath();
    c.arc(24, 24, 5.6, 0, Math.PI * 2);
    c.fillStyle = '#e0473b';
    c.fill();
    c.restore();
  }

  function haze(c, t, tint) {
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const x = W * (0.2 + 0.3 * i) + Math.sin(t * 0.13 + i * 2) * 60;
      const y = H * 0.45 + Math.cos(t * 0.11 + i) * 30;
      const g = c.createRadialGradient(x, y, 0, x, y, 220);
      g.addColorStop(0, tint);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    c.globalCompositeOperation = 'source-over';
  }

  function vignette(c) {
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.7)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  /** Someone at a lectern under a spotlight. */
  function stage(c, t) {
    const sway = Math.sin(t * 0.5) * 4;
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#24130f');
    bg.addColorStop(1, '#0b0706');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    // Curtains.
    for (let i = 0; i < 28; i++) {
      const x = (i / 28) * W;
      const g = c.createLinearGradient(x, 0, x + W / 28, 0);
      g.addColorStop(0, 'rgba(120,28,22,0.55)');
      g.addColorStop(0.5, 'rgba(60,10,8,0.2)');
      g.addColorStop(1, 'rgba(120,28,22,0.55)');
      c.fillStyle = g;
      c.fillRect(x, 0, W / 28 + 1, H * 0.8);
    }
    // Floor.
    const fl = c.createLinearGradient(0, H * 0.78, 0, H);
    fl.addColorStop(0, '#1c1310');
    fl.addColorStop(1, '#070505');
    c.fillStyle = fl;
    c.fillRect(0, H * 0.78, W, H * 0.22);
    // Spotlight.
    const sx = W * 0.56 + sway;
    c.globalCompositeOperation = 'lighter';
    const cone = c.createLinearGradient(0, 0, 0, H * 0.85);
    cone.addColorStop(0, 'rgba(255,226,180,0.42)');
    cone.addColorStop(1, 'rgba(255,200,140,0.04)');
    c.fillStyle = cone;
    c.beginPath();
    c.moveTo(sx - 14, 0);
    c.lineTo(sx + 14, 0);
    c.lineTo(sx + 118, H * 0.86);
    c.lineTo(sx - 118, H * 0.86);
    c.fill();
    const pool = c.createRadialGradient(sx, H * 0.86, 0, sx, H * 0.86, 140);
    pool.addColorStop(0, 'rgba(255,214,160,0.5)');
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = pool;
    c.save();
    c.scale(1, 0.25);
    c.fillRect(0, (H * 0.86) / 0.25 - 160, W, 320);
    c.restore();
    c.globalCompositeOperation = 'source-over';
    haze(c, t, 'rgba(255,190,140,0.06)');
    // The speaker.
    const px = W * 0.56;
    const breathe = Math.sin(t * 1.3) * 1.2;
    c.fillStyle = '#0a0706';
    c.beginPath();
    c.arc(px, H * 0.42 + breathe, 22, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(px - 62, H * 0.66);
    c.quadraticCurveTo(px - 58, H * 0.5 + breathe, px - 20, H * 0.49 + breathe);
    c.lineTo(px + 20, H * 0.49 + breathe);
    c.quadraticCurveTo(px + 58, H * 0.5 + breathe, px + 62, H * 0.66);
    c.fill();
    // Rim light.
    c.strokeStyle = 'rgba(255,214,160,0.55)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(px, H * 0.42 + breathe, 22, Math.PI * 1.1, Math.PI * 1.9);
    c.stroke();
    // Lectern.
    const lg = c.createLinearGradient(0, H * 0.58, 0, H * 0.88);
    lg.addColorStop(0, '#3a2a22');
    lg.addColorStop(1, '#140d0a');
    c.fillStyle = lg;
    c.beginPath();
    c.moveTo(px - 60, H * 0.58);
    c.lineTo(px + 60, H * 0.58);
    c.lineTo(px + 48, H * 0.88);
    c.lineTo(px - 48, H * 0.88);
    c.fill();
    c.fillStyle = 'rgba(255,214,160,0.35)';
    c.fillRect(px - 60, H * 0.58, 120, 3);
    mark(c, px, H * 0.7, 30);
    vignette(c);
  }

  /** The hall from the back: lights sweeping, the crowd in front. */
  function wide(c, t) {
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#05060a');
    bg.addColorStop(1, '#0d0f18');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    // The big screen on stage shows the logo.
    const sg = c.createLinearGradient(0, 40, 0, 150);
    sg.addColorStop(0, '#15464c');
    sg.addColorStop(1, '#0a2226');
    c.fillStyle = sg;
    c.fillRect(W * 0.32, 40, W * 0.36, 112);
    mark(c, W / 2, 96, 54, Math.sin(t * 0.4) * 0.15);
    // Beams.
    c.globalCompositeOperation = 'lighter';
    const cols = ['255,59,47', '79,179,191', '255,230,200', '79,179,191', '255,59,47'];
    for (let i = 0; i < 5; i++) {
      const ox = W * (0.14 + i * 0.18);
      const a = Math.sin(t * 0.7 + i * 1.7) * 0.42 + (i - 2) * 0.08;
      c.save();
      c.translate(ox, 0);
      c.rotate(a);
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgba(${cols[i]},0.5)`);
      g.addColorStop(1, `rgba(${cols[i]},0)`);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-4, 0);
      c.lineTo(4, 0);
      c.lineTo(44, H * 1.05);
      c.lineTo(-44, H * 1.05);
      c.fill();
      c.restore();
    }
    haze(c, t, 'rgba(120,160,220,0.05)');
    c.globalCompositeOperation = 'source-over';
    // Stage.
    c.fillStyle = '#16171d';
    c.fillRect(0, H * 0.6, W, H * 0.06);
    c.fillStyle = 'rgba(79,179,191,0.6)';
    c.fillRect(0, H * 0.6, W, 2);
    // Performers.
    c.fillStyle = '#020203';
    for (const [x, s] of [
      [0.36, 1],
      [0.5, 1.1],
      [0.64, 0.95],
    ]) {
      const bx = W * x;
      const by = H * 0.6;
      c.beginPath();
      c.arc(bx, by - 52 * s, 8 * s, 0, Math.PI * 2);
      c.fill();
      c.fillRect(bx - 10 * s, by - 44 * s, 20 * s, 44 * s);
    }
    // Crowd.
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < 15; k++) {
        const x = (k + (row ? 0.5 : 0)) * (W / 14) - 10;
        const bob = Math.max(0, Math.sin(t * 3.2 + k * 1.3 + row)) * 6;
        const y = H * (0.86 + row * 0.08) - bob;
        c.fillStyle = row ? '#000' : '#050507';
        c.beginPath();
        c.arc(x, y - 26, 15, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.ellipse(x, y + 20, 28, 34, 0, 0, Math.PI * 2);
        c.fill();
        if ((k * 7 + row) % 5 === 0) {
          c.strokeStyle = c.fillStyle;
          c.lineWidth = 7;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(x + 14, y);
          c.lineTo(x + 26, y - 56 - bob);
          c.stroke();
        }
      }
    }
    vignette(c);
  }

  /** The show countdown, like the app's. */
  function countdown(c, t) {
    const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
    g.addColorStop(0, '#1f6f79');
    g.addColorStop(1, '#071a1d');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const left = 300 - (Math.floor(t) % 300);
    const s = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.font = `700 22px ${FONT}`;
    c.letterSpacing = '8px';
    c.fillText('STARTING SOON', W / 2 + 4, H * 0.36);
    c.letterSpacing = '0px';
    c.font = `900 128px ${FONT}`;
    c.fillText(s, W / 2, H * 0.72);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(W * 0.2, H * 0.84, W * 0.6, 4);
    c.fillStyle = '#ff3b2f';
    c.fillRect(W * 0.2, H * 0.84, W * 0.6 * (1 - left / 300), 4);
  }

  /** Music visuals for the back screen, on the beat. */
  function visuals(c, t) {
    c.fillStyle = '#040507';
    c.fillRect(0, 0, W, H);
    const beat = Math.exp(-((t * 2) % 1) * 5);
    const n = 64;
    c.save();
    c.translate(W / 2, H / 2);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 0.2;
      const len = 30 + 70 * Math.abs(Math.sin(t * 1.7 + i * 0.6)) + beat * 40;
      c.save();
      c.rotate(a);
      c.fillStyle = i % 2 ? 'rgba(79,179,191,0.85)' : 'rgba(255,59,47,0.85)';
      c.fillRect(70 + beat * 8, -3, len, 6);
      c.restore();
    }
    for (let r = 0; r < 4; r++) {
      const rad = ((t * 60 + r * 90) % 360) + 20;
      c.strokeStyle = `rgba(255,255,255,${0.25 * (1 - rad / 380)})`;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, rad, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    c.restore();
    mark(c, W / 2, H / 2, 70 + beat * 10, t * 0.3);
  }

  const SOURCES = [
    { name: 'Stage', draw: stage },
    { name: 'Wide', draw: wide },
    { name: 'Countdown', draw: countdown },
    { name: 'Visuals', draw: visuals },
  ];
  const frames = SOURCES.map(() => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    return cv;
  });

  // What is where.
  const st = { next: 1, pgm: 0, from: null, at: 0, title: false, titleAt: -9, panic: false, backLive: false };

  /** The name title (lower third), sliding in and out. */
  function lowerThird(c, now) {
    const since = (now - st.titleAt) / 450;
    const p = st.title ? Math.min(1, since) : Math.max(0, 1 - since);
    if (p <= 0) return;
    const e = 1 - (1 - p) ** 3;
    const x = 38;
    const y = H - 98;
    c.save();
    c.beginPath();
    c.rect(x, y, 330 * e, 64);
    c.clip();
    c.fillStyle = 'rgba(10,11,14,0.88)';
    c.fillRect(x, y, 330, 64);
    c.fillStyle = '#ff3b2f';
    c.fillRect(x, y, 6, 64);
    c.textAlign = 'left';
    c.fillStyle = '#fff';
    c.font = `800 25px ${FONT}`;
    c.fillText('Sarah Mitchell', x + 22, y + 32);
    c.fillStyle = '#8fd3db';
    c.font = `500 16px ${FONT}`;
    c.fillText('Keynote speaker', x + 22, y + 53);
    c.restore();
  }

  const program = document.createElement('canvas');
  program.width = W;
  program.height = H;
  function drawProgram(now) {
    const c = program.getContext('2d');
    if (st.panic) {
      c.fillStyle = '#000';
      c.fillRect(0, 0, W, H);
      return;
    }
    c.globalAlpha = 1;
    const p = st.from === null ? 1 : Math.min(1, (now - st.at) / 600);
    if (p < 1) {
      c.drawImage(frames[st.from], 0, 0);
      c.globalAlpha = p;
    } else st.from = null;
    c.drawImage(frames[st.pgm], 0, 0);
    c.globalAlpha = 1;
    lowerThird(c, now);
  }

  const views = {};
  document.querySelectorAll('canvas[data-view]').forEach((cv) => (views[cv.dataset.view] = cv));
  const show = (name, img) => {
    const cv = views[name];
    if (!cv) return;
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  };

  const $ = (s) => document.querySelector(s);
  const srcBtns = [...document.querySelectorAll('[data-src]')];
  function label() {
    $('[data-next-name]').textContent = SOURCES[st.next].name;
    $('[data-pgm-name]').textContent = st.panic ? 'PANIC: the audience sees nothing' : SOURCES[st.pgm].name;
    srcBtns.forEach((b, i) => {
      b.classList.toggle('is-next', i === st.next);
      b.classList.toggle('is-pgm', i === st.pgm);
    });
  }
  function take(cut) {
    if (st.next === st.pgm) return;
    const was = st.pgm;
    st.from = cut ? null : was;
    st.at = performance.now();
    st.pgm = st.next;
    st.next = was;
    label();
  }
  function title() {
    st.title = !st.title;
    st.titleAt = performance.now();
    $('[data-title]').setAttribute('aria-pressed', String(st.title));
  }
  function panic(on) {
    st.panic = on;
    $('[data-panic]').setAttribute('aria-pressed', String(on));
    label();
  }
  srcBtns.forEach((b, i) =>
    b.addEventListener('click', () => {
      st.next = i;
      label();
    }),
  );
  $('[data-take]').addEventListener('click', () => take(false));
  $('[data-cut]').addEventListener('click', () => take(true));
  $('[data-title]').addEventListener('click', title);
  // Like the app: PANIC needs a double-click; one click brings it back.
  const pBtn = $('[data-panic]');
  pBtn.addEventListener('dblclick', () => panic(true));
  pBtn.addEventListener('click', () => st.panic && panic(false));

  const sw = $('[data-switcher]');
  let swSeen = false;
  addEventListener('keydown', (e) => {
    if (!swSeen || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= '1' && e.key <= '4') {
      st.next = Number(e.key) - 1;
      label();
    } else if (e.key === 'Enter' && !e.target.closest('button, a')) take(e.shiftKey);
    else if (e.key === 't' || e.key === 'T') title();
    else return;
    e.preventDefault();
  });

  // The three screens.
  const backBtn = $('[data-backlive]');
  backBtn.addEventListener('click', () => {
    st.backLive = !st.backLive;
    backBtn.setAttribute('aria-pressed', String(st.backLive));
  });
  const backWide = document.createElement('canvas');
  backWide.width = 640;
  backWide.height = 270;
  function drawBack() {
    const c = backWide.getContext('2d');
    const img = st.backLive ? program : frames[3];
    c.drawImage(img, 0, (H - 270) / 2, W, 270, 0, 0, 640, 270);
  }
  const msg = $('[data-msg]');
  const mon = $('[data-monitor]');
  document.querySelectorAll('[data-say]').forEach((b) => b.addEventListener('click', () => (msg.textContent = b.dataset.say)));
  $('[data-flash]').addEventListener('click', () => {
    let n = 0;
    const id = setInterval(() => {
      mon.classList.toggle('is-flash');
      if (++n >= 6) {
        clearInterval(id);
        mon.classList.remove('is-flash');
      }
    }, 160);
  });

  // Timecode, the stage clock and the speaker's time.
  const t0 = performance.now();
  const tcs = document.querySelectorAll('[data-tc]');
  const clock = $('[data-clock]');
  const left = $('[data-left]');
  const pad = (n) => String(n).padStart(2, '0');
  function texts(now) {
    const ms = now - t0;
    const f = Math.floor((ms % 1000) / 40);
    const s = Math.floor(ms / 1000);
    const tc = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
    tcs.forEach((el) => (el.textContent = tc));
    const d = new Date();
    clock.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const r = Math.max(0, 299 - (s % 300));
    left.textContent = `${Math.floor(r / 60)}:${pad(r % 60)} left`;
  }

  // Only draw what can be seen.
  const visible = new Set();
  const io = new IntersectionObserver((es) =>
    es.forEach((e) => {
      if (e.isIntersecting) visible.add(e.target);
      else visible.delete(e.target);
      if (e.target === sw && e.isIntersecting) swSeen = true;
      if (e.target === sw && !e.isIntersecting) swSeen = false;
    }),
  );
  const screens = $('#screens');
  const hero = $('.win--hero');
  io.observe(sw);
  io.observe(screens);
  if (hero) io.observe(hero);

  // The app at the top runs by itself: a shot waits in Next, then TAKE.
  const hNext = $('[data-hero="next"]');
  const hPgm = $('[data-hero="pgm"]');
  const hTake = $('[data-hero-take]');
  const hs = { pgm: 0, next: 1, from: null, at: 0, nextTake: performance.now() + 3200 };
  const heroOrder = [0, 1, 2, 0, 3, 1];
  let heroStep = 1;
  function drawHero(now) {
    if (now > hs.nextTake) {
      hTake.classList.add('is-on');
      setTimeout(() => hTake.classList.remove('is-on'), 450);
      hs.from = hs.pgm;
      hs.at = now + 150;
      hs.pgm = hs.next;
      heroStep = (heroStep + 1) % heroOrder.length;
      hs.next = heroOrder[heroStep] === hs.pgm ? heroOrder[(heroStep + 1) % heroOrder.length] : heroOrder[heroStep];
      hs.nextTake = now + 4200;
    }
    hNext.getContext('2d').drawImage(frames[hs.next], 0, 0, hNext.width, hNext.height);
    const c = hPgm.getContext('2d');
    const p = hs.from === null ? 1 : Math.min(1, Math.max(0, (now - hs.at) / 700));
    c.globalAlpha = 1;
    if (p < 1) c.drawImage(frames[hs.from], 0, 0, hPgm.width, hPgm.height);
    c.globalAlpha = p;
    c.drawImage(frames[hs.pgm], 0, 0, hPgm.width, hPgm.height);
    c.globalAlpha = 1;
    if (p >= 1) hs.from = null;
  }

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - last < 1000 / 30) return;
    last = now;
    texts(now);
    if (!visible.size) return;
    const t = now / 1000;
    SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d'), t));
    drawProgram(now);
    if (hero && visible.has(hero)) drawHero(now);
    if (visible.has(sw)) {
      frames.forEach((f, i) => show(`src${i}`, f));
      show('next', frames[st.next]);
      show('program', program);
    }
    if (visible.has(screens)) {
      show('live', program);
      drawBack();
      show('back', backWide);
    }
  }
  label();
  if (still) {
    // One still picture of each, no movement.
    const t = 12;
    SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d'), t));
    const redraw = () => {
      drawProgram(performance.now() + 1e4);
      if (hero) drawHero(0);
      frames.forEach((f, i) => show(`src${i}`, f));
      show('next', frames[st.next]);
      show('program', program);
      show('live', program);
      drawBack();
      show('back', backWide);
      texts(performance.now());
    };
    redraw();
    document.addEventListener('click', () => setTimeout(redraw, 0));
    addEventListener('keydown', () => setTimeout(redraw, 0));
  } else requestAnimationFrame(frame);
  document.fonts?.ready.then(() => (last = 0));

  // Feedback: sent through Web3Forms, so nobody has to sign in to anything.
  // Put the access key from web3forms.com here (it only lets people send to you).
  const FEEDBACK_KEY = '62155090-df58-430c-9c77-2724a61adb72';
  const form = $('[data-feedback]');
  const status = $('[data-status]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const say = (text, cls) => {
      status.textContent = text;
      status.className = `fb__status ${cls || ''}`;
    };
    if (FEEDBACK_KEY.startsWith('PASTE')) return say('Feedback is not switched on yet. Please try again soon.', 'is-bad');
    const data = Object.fromEntries(new FormData(form));
    if (data.botcheck) return;
    btn.disabled = true;
    say('Sending…');
    try {
      const r = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: FEEDBACK_KEY,
          subject: `Lumora feedback: ${data.topic}`,
          from_name: data.name || 'Lumora website',
          name: data.name,
          email: data.email,
          topic: data.topic,
          message: data.message,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error(j.message || 'not sent');
      form.reset();
      say('Thank you! Your message was sent.', 'is-ok');
    } catch {
      say('That did not go through. Please check your internet and try again.', 'is-bad');
    } finally {
      btn.disabled = false;
    }
  });

  // Screenshots.
  const tabs = document.querySelectorAll('[data-shot]');
  const shots = document.querySelectorAll('.gallery img');
  tabs.forEach((tb) =>
    tb.addEventListener('click', () => {
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === tb)));
      shots.forEach((s, i) => s.classList.toggle('is-on', i === Number(tb.dataset.shot)));
    }),
  );
  document.getElementById('year').textContent = new Date().getFullYear();

  // The headline, word by word.
  const h1 = document.querySelector('.hero h1');
  if (h1 && !still) {
    h1.innerHTML = h1.textContent
      .trim()
      .split(/\s+/)
      .map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`)
      .join(' ');
  }

  // The app window turns to face you as you scroll.
  if (hero && !still) {
    const tilt = () => {
      const p = Math.min(1, Math.max(0, scrollY / (innerHeight * 0.55)));
      hero.style.setProperty('--tilt', `${(10 * (1 - p)).toFixed(2)}deg`);
      hero.style.setProperty('--sc', (0.95 + 0.05 * p).toFixed(3));
    };
    tilt();
    addEventListener('scroll', tilt, { passive: true });
  }

  // Sections glide in; the numbers count up.
  const count = (el) => {
    const to = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (still) return;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 1400);
      el.textContent = `${Math.round(to * (1 - (1 - p) ** 3))}${suffix}`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (!still && 'IntersectionObserver' in window) {
    const items = document.querySelectorAll(
      '.stats__item, .head, .feat__cols > div, .dev, .calm__grid > div, .split__win, .split__text, .sw, .tabs, #app .win, .fb__form, .dl__in, .dest__in',
    );
    items.forEach((el) => {
      const sibs = [...el.parentElement.children].filter((x) => x.classList.contains(el.classList[0]));
      el.style.setProperty('--d', `${Math.max(0, sibs.indexOf(el)) * 90}ms`);
      el.classList.add('reveal');
    });
    const rio = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-in');
          e.target.querySelectorAll('[data-count]').forEach(count);
          rio.unobserve(e.target);
        }),
      { rootMargin: '0px 0px -12% 0px' },
    );
    items.forEach((el) => rio.observe(el));
  }
})();
