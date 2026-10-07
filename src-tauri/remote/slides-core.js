// @ts-check
// The speaker's slides page: the parts that are not drawing (keys, swipes,
// times, which slideshow), kept apart so they can be tested
// (slides-core.test.ts). Served by src-tauri/src/remote.rs, no build step.

/**
 * One slide as the speaker's page gets it (no file paths).
 * @typedef {{ type: 'image', v: string, notes?: string } | { type: 'input', name: string, notes?: string }} ViewSlide
 */
/**
 * @typedef {{
 *   id: string, name: string, onAir: 'live' | 'back' | null, inNext: boolean,
 *   current: number, black: boolean, looping: boolean, slides: ViewSlide[]
 * }} ViewSlideshow
 */
/**
 * What the computer sends (speaker.rs, `slides_view`).
 * @typedef {{
 *   event: string, locked: boolean, allowBlack: boolean,
 *   slideshows: ViewSlideshow[],
 *   countdown: { name: string, endsAt: number | null, remainingMs: number } | null
 * }} SlidesView
 */
/** @typedef {'next' | 'previous' | 'black'} Move */

/**
 * What a key does. Presentation clickers send Page Down / Page Up (some send
 * the arrow keys) and "b" or "." to black the screen.
 * @param {string} key KeyboardEvent.key
 * @returns {Move | null}
 */
export function clickerKey(key) {
  switch (key) {
    case 'PageDown':
    case 'ArrowRight':
    case 'ArrowDown':
    case ' ':
    case 'Enter':
      return 'next';
    case 'PageUp':
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'Backspace':
      return 'previous';
    case 'b':
    case 'B':
    case '.':
      return 'black';
    default:
      return null;
  }
}

/**
 * A swipe: left for the next slide, right for the one before. Short or
 * mostly-up-and-down moves are not swipes (scrolling the notes).
 * @param {number} dx @param {number} dy @param {number} ms
 * @returns {'next' | 'previous' | null}
 */
export function swipe(dx, dy, ms) {
  if (ms > 800 || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'previous';
}

/**
 * The slideshow the page works on: the one chosen on this device if it is
 * still there, else the one on air (the computer sends it first).
 * @param {SlidesView | null} view @param {string | null} chosen
 * @returns {ViewSlideshow | null}
 */
export function pickSlideshow(view, chosen) {
  if (!view) return null;
  return view.slideshows.find((s) => s.id === chosen) ?? view.slideshows[0] ?? null;
}

/**
 * The slide after this one (round to the first when it loops). Null at the end.
 * @param {ViewSlideshow} sh
 */
export function nextIndex(sh) {
  if (sh.current + 1 < sh.slides.length) return sh.current + 1;
  return sh.looping && sh.slides.length > 1 ? 0 : null;
}

/**
 * The action a move sends to the computer (the same as the control window's).
 * @param {Move} move @param {ViewSlideshow} sh
 */
export function actionFor(move, sh) {
  if (move === 'next') return { type: 'slideNext', id: sh.id };
  if (move === 'previous') return { type: 'slidePrevious', id: sh.id };
  return { type: 'slideBlack', id: sh.id, value: !sh.black };
}

/**
 * Where the page shows it is, a moment before the computer says so (so a
 * tap feels instant). Black: next and back first bring the slides back.
 * @param {ViewSlideshow} sh @param {Move} move
 * @returns {ViewSlideshow}
 */
export function predict(sh, move) {
  if (move === 'black') return { ...sh, black: !sh.black };
  if (sh.black) return { ...sh, black: false };
  if (move === 'next') return { ...sh, current: nextIndex(sh) ?? sh.current };
  return { ...sh, current: Math.max(0, sh.current - 1) };
}

/** "Slide 3 of 12". @param {ViewSlideshow} sh */
export function slideLabel(sh) {
  if (!sh.slides.length) return 'No slides yet';
  return `Slide ${Math.min(sh.current + 1, sh.slides.length)} of ${sh.slides.length}`;
}

/**
 * A countdown's time left (ms), by the computer's clock.
 * @param {{ endsAt: number | null, remainingMs: number }} c @param {number} now
 */
export function remaining(c, now) {
  return c.endsAt !== null ? Math.max(0, c.endsAt - now) : c.remainingMs;
}

/** 1:05, 12:00, 1:02:03. @param {number} ms */
export function clockText(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Time since (rounded down, unlike a countdown). @param {number} ms */
export function elapsedText(ms) {
  return clockText(Math.floor(Math.max(0, ms) / 1000) * 1000);
}

/** The time of day, like 7:45 PM. @param {number} ms */
export function timeOfDay(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The PIN in the address after "#" (from the QR code), if any.
 * @param {string} hash location.hash
 */
export function pinFromHash(hash) {
  const m = /(?:^#|&)pin=(\d{4,6})(?:&|$)/.exec(hash);
  return m ? (m[1] ?? null) : null;
}

/**
 * What to tell the speaker when the computer says no.
 * @param {string | undefined} code
 */
export function describe(code) {
  switch (code) {
    case 'speakerLocked':
      return 'The operator has paused slide control for now.';
    case 'onlySlides':
      return 'This PIN can only change the slides.';
    case 'blackNotAllowed':
      return 'The operator has not allowed blacking out the slides.';
    case 'slowDown':
      return 'Slow down a little: too many clicks at once.';
    case 'disconnected':
      return 'The operator disconnected this device.';
    case 'wrongPin':
      return 'That PIN is not right. Look at the computer: Slideshow → Let the speaker change slides.';
    case 'tooManyTries':
      return 'Too many wrong PINs from this device. Wait a few minutes, then try again.';
    case 'unknownSource':
      return 'That slideshow was just removed on the computer.';
    default:
      return 'The computer did not accept that.';
  }
}
