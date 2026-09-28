// @ts-check
// Lumora Remote: the phone and tablet page. Served by the app itself
// (src-tauri/src/remote.rs), with no build step, so it is plain JavaScript;
// the types come from the engine's generated TypeScript and are checked by
// `npm run typecheck`.

/** @typedef {import('../../app/src/engine/types/Show').Show} Show */
/** @typedef {import('../../app/src/engine/types/Source').Source} Source */
/** @typedef {import('../../app/src/engine/types/Action').Action} Action */
/** @typedef {import('../../app/src/engine/types/Countdown').Countdown} Countdown */
/** @typedef {'live' | 'back'} SwitchScreen */

(() => {
  const PIN_KEY = 'lumora.remote.pin';
  const SOUND_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'opus'];

  /** @type {string} */
  let pin = read(PIN_KEY) ?? '';
  /** @type {Show | null} */
  let show = null;
  /** The computer's clock minus ours, so countdowns match the screens. */
  let offset = 0;
  /** @type {SwitchScreen} */
  let screen = 'live';
  let showAll = false;
  /** @type {EventSource | null} */
  let events = null;

  const now = () => Date.now() + offset;

  /** @param {string} id */
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing #${id}`);
    return el;
  }

  /** @param {string} key */
  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /** @param {string} key @param {string} value */
  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private browsing: the PIN is asked again next time */
    }
  }

  /** @param {string} text */
  function esc(text) {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  // ---------------------------------------------------------------- talking to the computer

  /** @param {string} path @param {RequestInit} [init] */
  function call(path, init = {}) {
    return fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Lumora-Pin': pin,
        ...init.headers,
      },
    });
  }

  /** @param {Record<string, unknown>} err */
  function describe(err) {
    switch (err.code) {
      case 'nothingInPreview':
        return 'Nothing is in Next yet. Tap an input first.';
      case 'soundOnly':
        return 'That input is sound only, so it can’t go on a screen.';
      case 'unknownSource':
        return 'That input was just removed on the computer.';
      case 'monitorIsTextOnly':
        return 'The Monitor shows text only.';
      case 'notFromRemote':
        return 'That can only be done on the computer.';
      case 'wrongPin':
        return 'The PIN was changed on the computer.';
      case 'invalidValue':
        return `${err.field}: ${err.reason}`;
      default:
        return 'The computer did not accept that.';
    }
  }

  /** Ask the engine to do something. @param {Action} action */
  async function send(action) {
    try {
      const res = await call('/api/action', {
        method: 'POST',
        body: JSON.stringify(action),
      });
      if (res.ok) return;
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) return needPin(describe(err));
      toast(describe(err));
    } catch {
      toast('Could not reach the computer. Check the Wi-Fi.');
    }
  }

  /** @param {string} [message] */
  function needPin(message = '') {
    events?.close();
    events = null;
    $('app').hidden = true;
    $('login').hidden = false;
    $('login-error').textContent = message;
    /** @type {HTMLInputElement} */ ($('pin')).value = '';
  }

  async function login() {
    try {
      const res = await call('/api/check', { method: 'POST' });
      if (res.status === 401) return needPin(pin ? 'That PIN is not right. Look at the computer: Settings → Phone remote.' : '');
      if (!res.ok) return needPin('The computer did not answer. Try again.');
    } catch {
      return needPin('Could not reach the computer. Is the phone on the same Wi-Fi?');
    }
    write(PIN_KEY, pin);
    $('login').hidden = true;
    $('app').hidden = false;
    connect();
  }

  function connect() {
    events?.close();
    const es = new EventSource(`/api/events?pin=${encodeURIComponent(pin)}`);
    events = es;
    es.addEventListener('show', (e) => {
      const data = JSON.parse(/** @type {MessageEvent} */ (e).data);
      offset = data.now - Date.now();
      show = data.snapshot.show;
      online(true);
      render();
    });
    es.addEventListener('ping', (e) => {
      offset = JSON.parse(/** @type {MessageEvent} */ (e).data).now - Date.now();
      online(true);
    });
    es.onerror = () => {
      online(false);
      // The browser tries again by itself; find out if the PIN changed meanwhile.
      void call('/api/check', { method: 'POST' })
        .then((res) => res.status === 401 && needPin('The PIN was changed on the computer. Type the new one.'))
        .catch(() => {});
    };
  }

  /** @param {boolean} ok */
  function online(ok) {
    $('conn').classList.toggle('conn--ok', ok);
    $('offline').hidden = ok;
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let toastTimer;
  /** @param {string} text */
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  // ---------------------------------------------------------------- reading the show

  /** @param {string | null} id */
  function source(id) {
    return show?.sources.find((s) => s.id === id) ?? null;
  }

  /** Heard, never shown (microphones, music files). @param {Source} s */
  function soundOnly(s) {
    if (s.kind.type === 'microphone') return true;
    if (s.kind.type !== 'video') return false;
    const path = s.kind.path.split('#').pop() ?? '';
    return SOUND_EXT.includes(path.split('.').pop()?.toLowerCase() ?? '');
  }

  /** @param {string | null} id */
  function kindOf(id) {
    return source(id)?.kind.type ?? null;
  }

  /** A 12 Pesukim input's data. @param {string | null} id */
  function pesukimOf(id) {
    const k = source(id)?.kind;
    return k?.type === 'pesukim' ? k : null;
  }

  /** The words shown one at a time (a hyphen joins two). @param {string} text */
  function wordsOf(text) {
    return text
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/-/g, ' '));
  }

  /** @param {string | null} id */
  function timerOf(id) {
    const k = source(id)?.kind;
    return k?.type === 'countdown' ? k.timer : null;
  }

  /** The countdown that matters most (mirrors Show::main_countdown). */
  function mainCountdown() {
    if (!show) return null;
    for (const sc of /** @type {const} */ (['live', 'back'])) if (timerOf(show.screens[sc].program)) return show.screens[sc].program;
    const cds = show.sources.filter((s) => s.kind.type === 'countdown');
    const running = cds.find((s) => s.kind.type === 'countdown' && s.kind.timer.endsAt !== null);
    return (running ?? cds[0])?.id ?? null;
  }

  /** The countdown the buttons work on: in Next, else on air, else the main one (like the computer). */
  function countdownTarget() {
    if (!show) return null;
    const sc = show.screens[screen];
    if (sc.preview !== sc.program && timerOf(sc.preview)) return { id: /** @type {string} */ (sc.preview), where: 'NEXT' };
    if (timerOf(sc.program)) return { id: /** @type {string} */ (sc.program), where: 'ON AIR' };
    const id = mainCountdown();
    return id ? { id, where: '' } : null;
  }

  /** @param {Countdown} c */
  function remaining(c) {
    return c.endsAt !== null ? Math.max(0, c.endsAt - now()) : c.remainingMs;
  }

  /** @param {number} ms */
  function clockText(ms) {
    const total = Math.ceil(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  // ---------------------------------------------------------------- drawing

  function render() {
    if (!show) return;
    $('event').textContent = show.event.name || 'Lumora';
    $('panic').hidden = show.panic;
    $('panic-banner').hidden = !show.panic;
    renderScreens(show);
    renderTimer();
    renderStage(show);
  }

  /** @param {Show} show */
  function renderScreens(show) {
    for (const b of document.querySelectorAll('[data-screen]')) b.classList.toggle('seg__btn--on', /** @type {HTMLElement} */ (b).dataset.screen === screen);
    const sc = show.screens[screen];
    const follows = screen === 'back' && show.backFollowsLive;
    $('follows').hidden = !follows;
    $('follows').innerHTML = follows ? 'The Back Screen is following the Live Screen. Taking something here stops that.' : '';
    $('next-name').textContent = source(sc.preview)?.name ?? '—';
    $('air-name').textContent = (source(sc.program)?.name ?? '—') + (sc.blank ? ' (blank)' : '');
    $('blank').classList.toggle('btn--on', sc.blank);
    $('blank').textContent = sc.blank ? 'UNBLANK' : 'BLANK';
    /** @type {HTMLButtonElement} */ ($('take')).disabled = !sc.preview || sc.preview === sc.program;
    /** @type {HTMLButtonElement} */ ($('cut')).disabled = !sc.preview || sc.preview === sc.program;

    // The video on air can be played and paused from here.
    const air = source(sc.program);
    $('media').hidden = air?.kind.type !== 'video';
    if (air?.kind.type === 'video') {
      $('media-name').textContent = air.name;
      const playing = air.kind.playback.playing;
      $('media-play').hidden = playing;
      $('media-pause').hidden = !playing;
    }

    // Run of show: what is running, and NEXT CUE.
    const run = show.run;
    $('cues').hidden = run.cues.length === 0;
    if (run.cues.length) {
      const cur = run.current !== null ? run.cues[run.current] : null;
      const next = run.cues[run.current === null ? 0 : run.current + 1];
      $('cues-text').textContent =
        `${cur ? `Now: ${cur.name}` : run.running ? 'Show started' : 'Run of show'}${next ? ` · next: ${next.name}` : ' · last cue'}`;
      /** @type {HTMLButtonElement} */ ($('cues-next')).disabled = !next;
    }

    // Overlay buttons 1 – 4 (only channels with something in them).
    $('ovs').innerHTML = show.overlays
      .map((o, ch) => {
        const name = source(o.sourceId)?.name;
        if (!name) return '';
        return `<button type="button" class="btn${o.on ? ' is-on' : ''}" data-overlay="${ch}"><b>${ch + 1}</b>${esc(name)}</button>`;
      })
      .join('');

    // A slideshow on air (or in Next) here: next / back.
    const sliId = kindOf(sc.program) === 'slideshow' ? sc.program : kindOf(sc.preview) === 'slideshow' ? sc.preview : null;
    const sli = source(sliId)?.kind;
    $('sli').hidden = sli?.type !== 'slideshow';
    if (sli?.type === 'slideshow') {
      $('sli-tag').textContent = sliId === sc.program ? 'ON AIR' : 'NEXT';
      $('sli-tag').className = sliId === sc.program ? 'tag tag--air' : 'tag tag--next';
      $('sli-where').textContent = `Slide ${Math.min(sli.current + 1, sli.slides.length)} of ${sli.slides.length}`;
    }

    // The 12 Pesukim, when on air (or in Next) here: one big button for the next word.
    const pesId = pesukimOf(sc.program) ? sc.program : pesukimOf(sc.preview) ? sc.preview : null;
    const pes = pesukimOf(pesId);
    $('pes').hidden = !pes;
    if (pes) {
      const pl = pes.place;
      const words = wordsOf(pes.pesukim[pl.pasuk]?.text ?? '');
      const atEnd = pl.word >= words.length - 1;
      $('pes-tag').textContent = pesId === sc.program ? 'ON AIR' : 'NEXT';
      $('pes-tag').className = pesId === sc.program ? 'tag tag--air' : 'tag tag--next';
      const child = pes.pesukim[pl.pasuk]?.child;
      $('pes-where').textContent = `Pasuk ${pl.pasuk + 1} of 12${child ? ` · ${child}` : ''}`;
      $('pes-now').textContent = pl.blank ? '(words hidden)' : pl.whole ? words.join(' ') : (words[pl.word] ?? '—');
      $('pes-next').textContent = `Next: ${atEnd ? (pl.pasuk < 11 ? `(pasuk ${pl.pasuk + 2})` : '(the end)') : words[pl.word + 1]}`;
      $('pes-go').textContent = atEnd && pl.pasuk < 11 ? 'Next pasuk ›' : 'Next word ›';
      $('pes-whole').classList.toggle('btn--on', pl.whole);
      $('pes-blank').classList.toggle('btn--on', pl.blank);
    }

    // Presets and their buttons.
    $('presets').hidden = show.presets.length === 0;
    const pick = /** @type {HTMLSelectElement} */ ($('preset-pick'));
    pick.innerHTML =
      '<option value="">— No preset —</option>' +
      show.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.category ? `${p.category}: ${p.name}` : p.name)}</option>`).join('');
    pick.value = show.activePreset ?? '';
    const active = show.presets.find((p) => p.id === show.activePreset) ?? null;
    $('preset-buttons').innerHTML = (active?.buttons ?? [])
      .map((b, i) => `<button type="button" class="btn btn--preset" data-button="${i}">${esc(b.name)}</button>`)
      .join('');
    const running = show.running[0];
    $('running').hidden = !running;
    $('running-name').textContent = running ? `Running “${running.name}”…` : '';

    // Inputs (only the preset's while one is picked, like on the computer).
    const only = !showAll && active && active.sources.length > 0 && active.screen === screen ? active.sources : null;
    $('show-all-wrap').hidden = !(active && active.sources.length > 0 && active.screen === screen);
    const list = show.sources.filter((s) => !soundOnly(s) && (!only || only.includes(s.id)));
    $('inputs').innerHTML =
      list
        .map((s) => {
          const cls = s.id === sc.program ? 'tile tile--air' : s.id === sc.preview ? 'tile tile--next' : 'tile';
          const sw = s.kind.type === 'color' ? ` style="--swatch:${esc(s.kind.color)}"` : '';
          return `<button type="button" class="${cls}" data-source="${esc(s.id)}"${sw}><span class="tile__kind">${kindLabel(s)}</span>${esc(s.name)}</button>`;
        })
        .join('') || '<div class="note">No inputs yet. Add them on the computer.</div>';
  }

  /** @param {Source} s */
  function kindLabel(s) {
    switch (s.kind.type) {
      case 'camera':
        return 'Camera';
      case 'video':
        return 'Video';
      case 'image':
        return 'Picture';
      case 'color':
        return 'Colour';
      case 'pattern':
        return 'Test';
      case 'countdown':
        return 'Countdown';
      default:
        return '';
    }
  }

  function renderTimer() {
    const target = countdownTarget();
    $('cd-none').hidden = !!target;
    $('cd').hidden = !target;
    if (!target) return;
    const c = /** @type {Countdown} */ (timerOf(target.id));
    $('cd-where').textContent = target.where;
    $('cd-where').className = target.where === 'NEXT' ? 'tag tag--next' : target.where ? 'tag tag--air' : 'tag';
    $('cd-name').textContent = source(target.id)?.name ?? '';
    const running = c.endsAt !== null;
    const left = remaining(c);
    $('cd-time').textContent = clockText(left);
    $('cd-time').classList.toggle('cd__time--low', running && left <= 10_000);
    $('cd-state').textContent = running
      ? left === 0
        ? 'Finished'
        : 'Counting down'
      : target.where === 'NEXT'
        ? 'Starts when it is taken live'
        : c.remainingMs === c.lengthMs
          ? 'Ready'
          : 'Paused';
    $('cd-start').hidden = running;
    $('cd-pause').hidden = !running;
  }

  /** @param {Show} show */
  function renderStage(show) {
    const m = show.monitor;
    $('stage-now').textContent = m.messageOn && m.message ? m.message : 'No message';
    $('stage-now').classList.toggle('stage-now--on', m.messageOn && !!m.message);
    $('quick').innerHTML = m.quick
      .filter((q) => q.trim())
      .map((q) => `<button type="button" class="btn btn--quick" data-quick="${esc(q)}">${esc(q)}</button>`)
      .join('');
  }

  // ---------------------------------------------------------------- buttons

  /** @param {string} id @param {() => void} fn */
  function on(id, fn) {
    $(id).addEventListener('click', fn);
  }

  /**
   * Press and hold (for PANIC): nothing happens on a short tap in a pocket.
   * @param {string} id @param {() => void} fn
   */
  function hold(id, fn) {
    const el = $(id);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let t;
    const start = (/** @type {Event} */ e) => {
      e.preventDefault();
      el.classList.add('holding');
      t = setTimeout(() => {
        el.classList.remove('holding');
        navigator.vibrate?.(80);
        fn();
      }, 800);
    };
    const cancel = () => {
      clearTimeout(t);
      el.classList.remove('holding');
    };
    el.addEventListener('pointerdown', start);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, cancel);
    el.addEventListener('click', () => toast('Press and hold'));
  }

  function wire() {
    $('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      pin = /** @type {HTMLInputElement} */ ($('pin')).value.trim();
      void login();
    });

    for (const b of document.querySelectorAll('[data-tab]')) {
      b.addEventListener('click', () => {
        const tab = /** @type {HTMLElement} */ (b).dataset.tab;
        for (const t of document.querySelectorAll('.tab')) /** @type {HTMLElement} */ (t).hidden = t.id !== `tab-${tab}`;
        for (const x of document.querySelectorAll('[data-tab]')) x.classList.toggle('tabs__btn--on', x === b);
        write('lumora.remote.tab', tab ?? 'screens');
      });
    }
    const tab = read('lumora.remote.tab') ?? 'screens';
    /** @type {HTMLElement | null} */ (document.querySelector(`[data-tab="${tab}"]`) ?? document.querySelector('[data-tab]'))?.click();

    for (const b of document.querySelectorAll('[data-screen]')) {
      b.addEventListener('click', () => {
        screen = /** @type {SwitchScreen} */ (/** @type {HTMLElement} */ (b).dataset.screen);
        render();
      });
    }

    const pesId = () => {
      const sc = show?.screens[screen];
      if (!sc) return null;
      return pesukimOf(sc.program) ? sc.program : pesukimOf(sc.preview) ? sc.preview : null;
    };
    on('pes-go', () => {
      const id = pesId();
      if (id) void send({ type: 'pesukimNext', id });
    });
    on('pes-back', () => {
      const id = pesId();
      if (id) void send({ type: 'pesukimBack', id });
    });
    on('pes-whole', () => {
      const id = pesId();
      const p = pesukimOf(id);
      if (id && p) void send({ type: 'pesukimWhole', id, value: !p.place.whole });
    });
    on('pes-blank', () => {
      const id = pesId();
      const p = pesukimOf(id);
      if (id && p) void send({ type: 'pesukimBlank', id, value: !p.place.blank });
    });
    $('ovs').addEventListener('click', (e) => {
      const el = /** @type {HTMLElement} */ (e.target).closest('[data-overlay]');
      const ch = Number(/** @type {HTMLElement | null} */ (el)?.dataset.overlay);
      const o = show?.overlays[ch];
      if (o) void send({ type: 'setOverlayOn', channel: ch, value: !o.on });
    });
    const sliId = () => {
      const sc = show?.screens[screen];
      if (!sc) return null;
      return kindOf(sc.program) === 'slideshow' ? sc.program : kindOf(sc.preview) === 'slideshow' ? sc.preview : null;
    };
    on('sli-go', () => {
      const id = sliId();
      if (id) void send({ type: 'slideNext', id });
    });
    on('sli-back', () => {
      const id = sliId();
      if (id) void send({ type: 'slidePrevious', id });
    });
    on('sli-first', () => {
      const id = sliId();
      if (id) void send({ type: 'slideGo', id, index: 0 });
    });
    on('cues-next', () => void send({ type: 'nextCue' }));
    on('take', () => void send({ type: 'take', screen }));
    on('cut', () => void send({ type: 'take', screen, transition: 'cut' }));
    on(
      'blank',
      () =>
        show &&
        void send({
          type: 'setBlank',
          screens: [screen],
          value: !show.screens[screen].blank,
        }),
    );
    const onAir = () => show?.screens[screen].program ?? null;
    on('media-play', () => {
      const id = onAir();
      if (id) void send({ type: 'play', id });
    });
    on('media-pause', () => {
      const id = onAir();
      if (id) void send({ type: 'pause', id });
    });
    hold('panic', () => void send({ type: 'panic', value: true }));
    hold('panic-off', () => void send({ type: 'panic', value: false }));

    $('inputs').addEventListener('click', (e) => {
      const tile = /** @type {HTMLElement} */ (e.target).closest('[data-source]');
      if (tile)
        void send({
          type: 'setPreview',
          screen,
          sourceId: /** @type {HTMLElement} */ (tile).dataset.source ?? null,
        });
    });
    $('show-all').addEventListener('change', (e) => {
      showAll = /** @type {HTMLInputElement} */ (e.target).checked;
      render();
    });

    $('preset-pick').addEventListener('change', (e) => {
      const id = /** @type {HTMLSelectElement} */ (e.target).value;
      void send({ type: 'pickPreset', id: id || undefined });
    });
    on('preset-prev', () => void send({ type: 'previousPreset' }));
    on('preset-next', () => void send({ type: 'nextPreset' }));
    $('preset-buttons').addEventListener('click', (e) => {
      const el = /** @type {HTMLElement} */ (e.target).closest('[data-button]');
      const preset = show?.presets.find((p) => p.id === show?.activePreset);
      const button = preset?.buttons[Number(/** @type {HTMLElement | null} */ (el)?.dataset.button)];
      if (button) void send({ type: 'runSteps', name: button.name, steps: button.steps });
    });
    on('running-stop', () => void send({ type: 'stopSteps' }));

    // Countdown.
    const cd = () => countdownTarget()?.id ?? null;
    on('cd-start', () => {
      const id = cd();
      if (id) void send({ type: 'startCountdown', id });
    });
    on('cd-pause', () => {
      const id = cd();
      if (id) void send({ type: 'pauseCountdown', id });
    });
    on('cd-reset', () => {
      const id = cd();
      if (id) void send({ type: 'resetCountdown', id });
    });
    $('tab-timer').addEventListener('click', (e) => {
      const el = /** @type {HTMLElement} */ (e.target).closest('button');
      const id = cd();
      if (!el || !id) return;
      const { add, left, len } = el.dataset;
      if (add) void send({ type: 'addCountdownTime', id, ms: Number(add) });
      if (left) void send({ type: 'setCountdownRemaining', id, ms: Number(left) });
      if (len) void send({ type: 'setCountdownLength', id, lengthMs: Number(len) });
    });

    // Stage monitor.
    const msg = /** @type {HTMLTextAreaElement} */ ($('msg'));
    on('msg-send', () => {
      const text = msg.value.trim();
      if (!text) return toast('Type a message first.');
      void send({
        type: 'updateMonitor',
        patch: { message: text, messageOn: true },
      });
    });
    on('msg-clear', () => void send({ type: 'updateMonitor', patch: { messageOn: false } }));
    $('quick').addEventListener('click', (e) => {
      const el = /** @type {HTMLElement} */ (e.target).closest('[data-quick]');
      const text = /** @type {HTMLElement | null} */ (el)?.dataset.quick;
      if (!text) return;
      msg.value = text;
      void send({
        type: 'updateMonitor',
        patch: { message: text, messageOn: true },
      });
    });
    on('flash', () => void send({ type: 'monitorFlash' }));
  }

  // The clocks move on their own between updates.
  setInterval(() => {
    const d = new Date(now());
    $('clock').textContent = d.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    if (show) renderTimer();
  }, 200);

  wire();
  if (pin) void login();
  else needPin();
})();
