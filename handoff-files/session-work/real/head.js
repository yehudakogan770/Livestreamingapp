// The Lumora website: a small working switcher, the three screens that follow
// it, the run of show, and the PANIC button. The inputs are real footage of
// one event (media/, see img/CREDITS.md), looped like a camera feed.
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

  /** A camera: a short clip that loops, its first frame until it plays. */
  function camera(name, file) {
    const poster = new Image();
    poster.src = `media/${file}.jpg`;
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'none';
    v.setAttribute('aria-hidden', 'true');
    let started = false;
    return {
      name,
      poster,
      play() {
        if (still) return;
        if (!started) {
          started = true;
          v.src = `media/${file}.mp4`;
        }
        if (v.paused) v.play().catch(() => {});
      },
      pause() {
        if (started && !v.paused) v.pause();
      },
      draw(c) {
        if (v.readyState >= 2 && cover(c, v, v.videoWidth, v.videoHeight)) return;
        if (!cover(c, poster, poster.naturalWidth, poster.naturalHeight)) {
          c.fillStyle = '#16181d';
          c.fillRect(0, 0, W, H);
        }
      },
    };
  }

  /** A picture: the speaker's slides. */
  function picture(name, file) {
    const img = new Image();
    img.src = `media/${file}`;
    return {
      name,
      poster: img,
      play() {},
      pause() {},
      draw(c) {
        if (!cover(c, img, img.naturalWidth, img.naturalHeight)) {
          c.fillStyle = '#f6f4f0';
          c.fillRect(0, 0, W, H);
        }
      },
    };
  }

  const SOURCES = [camera('Podium', 'podium'), camera('Wide', 'wide'), camera('Audience', 'audience'), picture('Slides', 'slides.jpg')];
