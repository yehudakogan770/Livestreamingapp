// The Lumora website: a small working switcher, the three screens that follow
// it, the run of show, and the PANIC button. The inputs are real footage of
// big live events (media/, see img/CREDITS.md), looped like a camera feed.
(() => {
  const W = 640;
  const H = 360;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = "'Archivo', 'Segoe UI', sans-serif";

  /** Draws `img` to cover the whole frame. */
  function cover(c, img, iw, ih) {
    if (!iw || !ih) return false;
    const s = Math.max(W / iw, H / ih);
    const w = iw * s;
    const h = ih * s;
    c.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return true;
  }

  // WebM where the browser plays it, MP4 (H.264) everywhere else.
  const EXT = document.createElement('video').canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4';
  // The first frames as WebP where the browser shows it (smaller), else JPG.
  const PIC = (() => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      return c.toDataURL('image/webp').startsWith('data:image/webp') ? 'webp' : 'jpg';
    } catch {
      return 'jpg';
    }
  })();
  // The clips wait until the page itself has loaded (the first frames show until then),
  // and stay as still pictures for people who asked their browser to save data.
  const saveData = navigator.connection?.saveData === true;
  const afterLoad = (f) => {
    if (document.readyState === 'complete') setTimeout(f, 300);
    else addEventListener('load', () => setTimeout(f, 300), { once: true });
  };
  let pageLoaded = false;
  afterLoad(() => (pageLoaded = true));

  /** A still picture, decoded away from the page's main work before it is first drawn. */
  function stillPicture(file) {
    const img = new Image();
    img.src = `media/${file}.${PIC}`;
    const pic = { img, ok: false, ready: null };
    pic.ready = (img.decode ? img.decode() : new Promise((done, fail) => ((img.onload = done), (img.onerror = fail)))).then(
      () => (pic.ok = true),
      () => false,
    );
    return pic;
  }

  /** A camera: a short clip that loops, its first frame until it plays. */
  function camera(name, file) {
    const pic = stillPicture(file);
    const poster = pic.img;
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'none';
    v.setAttribute('aria-hidden', 'true');
    let started = false;
    /** The first frame is already on the canvas (it does not change: no need to draw it again). */
    let drawn = false;
    return {
      name,
      ready: pic.ready,
      play() {
        if (still || saveData || !pageLoaded) return;
        if (!started) {
          started = true;
          v.src = `media/${file}.${EXT}`;
        }
        if (v.paused) v.play().catch(() => {});
      },
      pause() {
        if (started && !v.paused) v.pause();
      },
      draw(c) {
        if (v.readyState >= 2 && cover(c, v, v.videoWidth, v.videoHeight)) {
          drawn = false;
          return;
        }
        if (drawn) return;
        if (pic.ok && cover(c, poster, poster.naturalWidth, poster.naturalHeight)) drawn = true;
        else {
          c.fillStyle = '#16181d';
          c.fillRect(0, 0, W, H);
        }
      },
    };
  }

  /** A picture: the speaker's slides. */
  function picture(name, file) {
    const pic = stillPicture(file);
    const img = pic.img;
    let drawn = false;
    return {
      name,
      ready: pic.ready,
      play() {},
      pause() {},
      draw(c) {
        if (drawn) return;
        if (pic.ok && cover(c, img, img.naturalWidth, img.naturalHeight)) drawn = true;
        else {
          c.fillStyle = '#f6f4f0';
          c.fillRect(0, 0, W, H);
        }
      },
    };
  }

  const SOURCES = [camera('Speaker', 'speaker'), camera('Wide', 'wide'), camera('Audience', 'audience'), picture('Slides', 'slides')];
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
    c.fillText('Daniel Brooks', x + 22, y + 32);
    c.fillStyle = '#8fd3db';
    c.font = `500 16px ${FONT}`;
    c.fillText('Chief Product Officer · Northwind', x + 22, y + 53);
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
    if (st.backLive) {
      c.drawImage(program, 0, (H - 270) / 2, W, 270, 0, 0, 640, 270);
      return;
    }
    // The slides, whole, in the middle of the wide projector screen.
    c.fillStyle = '#0b0c0f';
    c.fillRect(0, 0, 640, 270);
    c.drawImage(frames[3], 80, 0, 480, 270);
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
  /** Only touches the page when the words change (not 30 times a second). */
  const put = (el, text) => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  function texts(now) {
    const ms = now - t0;
    const f = Math.floor((ms % 1000) / 40);
    const s = Math.floor(ms / 1000);
    const tc = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
    tcs.forEach((el) => put(el, tc));
    const d = new Date();
    put(clock, d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    const r = Math.max(0, 299 - (s % 300));
    put(left, `${Math.floor(r / 60)}:${pad(r % 60)} left`);
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
  // The moving hall at the top rests while it is scrolled out of sight.
  const heroSection = $('.hero');
  if (heroSection) new IntersectionObserver(([e]) => heroSection.classList.toggle('is-away', !e.isIntersecting)).observe(heroSection);

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
    // The clips only play (and the clocks only tick) while some of this can be seen.
    if (!visible.size) {
      SOURCES.forEach((s) => s.pause());
      return;
    }
    texts(now);
    SOURCES.forEach((s) => s.play());
    SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d')));
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
    const redraw = () => {
      SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d')));
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
    SOURCES.forEach((s) => s.ready.then(redraw));
    document.addEventListener('click', () => setTimeout(redraw, 0));
    addEventListener('keydown', () => setTimeout(redraw, 0));
  } else {
    // While the page is still loading nothing moves yet: each first frame is drawn
    // once as it arrives, and the pictures start running once the page has loaded.
    let running = false;
    const first = () => {
      if (running) return;
      const now = performance.now();
      SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d')));
      drawProgram(now);
      if (hero) drawHero(Math.min(now, hs.nextTake - 1));
      frames.forEach((f, i) => show(`src${i}`, f));
      show('next', frames[st.next]);
      show('program', program);
      show('live', program);
      drawBack();
      show('back', backWide);
    };
    SOURCES.forEach((s) => s.ready.then(first));
    afterLoad(() => {
      running = true;
      requestAnimationFrame(frame);
    });
  }
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

  // On scroll: at most once a frame, and only writing styles (never measuring the page).
  const onScroll = [];
  let scrollQueued = false;
  addEventListener(
    'scroll',
    () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        onScroll.forEach((f) => f());
      });
    },
    { passive: true },
  );

  // The app window turns to face you as you scroll.
  if (hero && !still) {
    let shown = '';
    const tilt = () => {
      const p = Math.min(1, Math.max(0, scrollY / (innerHeight * 0.55)));
      const t = `${(12 * (1 - p)).toFixed(2)}deg`;
      // Further down it stays flat: nothing to change.
      if (t === shown) return;
      shown = t;
      hero.style.setProperty('--tilt', t);
      hero.style.setProperty('--sc', (0.94 + 0.06 * p).toFixed(3));
    };
    tilt();
    onScroll.push(tilt);
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
      '.head, .logos__row li, .card, .dev, .calm__grid > div, .split__win, .split__text, .sw, .ftabs, .fb__text, .fb__form, .dl__in, .step, .studio__win, .pages li, .sfeat',
    );
    items.forEach((el) => {
      const sibs = [...el.parentElement.children].filter((x) => x.classList.contains(el.classList[0]));
      el.style.setProperty('--d', `${Math.max(0, sibs.indexOf(el)) * 90}ms`);
      el.classList.add('reveal');
    });
    // Plays once a part is well inside the screen, scrolling down or up.
    const rio = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting || e.target.classList.contains('is-in')) return;
          e.target.classList.add('is-in');
          e.target.querySelectorAll('[data-count]').forEach(count);
        }),
      { rootMargin: '-10% 0px -10% 0px' },
    );
    // Resets only when fully off the screen (never while you can see it), and
    // remembers which side it left by, so it glides back in from that side.
    const out = new IntersectionObserver((es) =>
      es.forEach((e) => {
        if (e.isIntersecting) return;
        e.target.classList.remove('is-in');
        e.target.dataset.from = e.boundingClientRect.top < 0 ? 'above' : 'below';
      }),
    );
    items.forEach((el) => {
      rio.observe(el);
      out.observe(el);
    });
  }

  // The top bar: clear over the picture, solid once you scroll.
  const top = document.querySelector('[data-top]');
  const solid = () => top?.classList.toggle('is-solid', scrollY > 40);
  solid();
  onScroll.push(solid);

  // Packed with features: the tabs.
  const ftabs = document.querySelectorAll('[data-ftab]');
  const fpanes = document.querySelectorAll('.fpane');
  ftabs.forEach((t) =>
    t.addEventListener('click', () => {
      ftabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      fpanes.forEach((p, i) => p.classList.toggle('is-on', i === Number(t.dataset.ftab)));
    }),
  );
})();
