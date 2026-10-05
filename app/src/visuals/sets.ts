// Virtual sets: designed studio backgrounds a speaker is put into (with the
// background taken away, or a green screen). Drawn in code at full size, in
// the event's accent color, so they're sharp and add nothing to download.
// Some have a desk or podium drawn in front of the person.

export interface SetDesign {
  id: string;
  name: string;
  /** Something stands in front of the person (a desk, a podium). */
  front: boolean;
}

export const SETS: SetDesign[] = [
  { id: 'news', name: 'News desk', front: true },
  { id: 'studio', name: 'Modern studio', front: false },
  { id: 'stage', name: 'Stage', front: false },
  { id: 'podium', name: 'Conference podium', front: true },
  { id: 'city', name: 'Night city', front: false },
  { id: 'brand', name: 'Event colors', front: false },
];

const W = 1920;
const H = 1080;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '2f80ed', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** A steady "random" for the same set every time (no flicker between windows). */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')!];
}

function bokeh(g: CanvasRenderingContext2D, accent: string, count: number, seed: number, yMax = H) {
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * W;
    const y = rnd() * yMax;
    const r = 20 + rnd() * 70;
    const warm = rnd() > 0.5;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const color = warm ? rgba('#ffcf8a', 0.22 + rnd() * 0.2) : rgba(accent, 0.2 + rnd() * 0.25);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function draw(id: string, accent: string, title: string): { back: HTMLCanvasElement; front: HTMLCanvasElement | null } {
  const [back, g] = canvas();
  let front: HTMLCanvasElement | null = null;
  switch (id) {
    case 'news': {
      const wall = g.createLinearGradient(0, 0, 0, H);
      wall.addColorStop(0, '#0b1a2e');
      wall.addColorStop(1, '#050b14');
      g.fillStyle = wall;
      g.fillRect(0, 0, W, H);
      // Big screen behind, glowing in the accent color.
      const sx = W * 0.18;
      const sy = H * 0.1;
      const sw = W * 0.64;
      const sh = H * 0.5;
      const glow = g.createLinearGradient(sx, sy, sx + sw, sy + sh);
      glow.addColorStop(0, rgba(accent, 0.55));
      glow.addColorStop(1, rgba(accent, 0.12));
      g.fillStyle = glow;
      g.fillRect(sx, sy, sw, sh);
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 4;
      g.strokeRect(sx, sy, sw, sh);
      for (let i = 1; i < 12; i++) {
        g.fillStyle = `rgba(255,255,255,${0.03 + (i % 3) * 0.015})`;
        g.fillRect(sx + (sw / 12) * i, sy, 2, sh);
      }
      // Light strips on the walls.
      for (const x of [W * 0.06, W * 0.12, W * 0.88, W * 0.94]) {
        const l = g.createLinearGradient(0, 0, 0, H * 0.7);
        l.addColorStop(0, 'rgba(160,210,255,0.5)');
        l.addColorStop(1, 'rgba(160,210,255,0)');
        g.fillStyle = l;
        g.fillRect(x - 6, 0, 12, H * 0.7);
      }
      // The desk, in front.
      const [f, fg] = canvas();
      const top = H * 0.74;
      fg.beginPath();
      fg.moveTo(W * 0.08, H);
      fg.quadraticCurveTo(W * 0.1, top, W * 0.5, top);
      fg.quadraticCurveTo(W * 0.9, top, W * 0.92, H);
      fg.closePath();
      const desk = fg.createLinearGradient(0, top, 0, H);
      desk.addColorStop(0, '#1d2b3f');
      desk.addColorStop(1, '#0a121d');
      fg.fillStyle = desk;
      fg.fill();
      fg.strokeStyle = rgba(accent, 0.95);
      fg.lineWidth = 6;
      fg.beginPath();
      fg.moveTo(W * 0.1, top + 40);
      fg.quadraticCurveTo(W * 0.5, top - 4, W * 0.9, top + 40);
      fg.stroke();
      front = f;
      break;
    }
    case 'studio': {
      const wall = g.createLinearGradient(0, 0, W, H);
      wall.addColorStop(0, '#2a3036');
      wall.addColorStop(1, '#14181c');
      g.fillStyle = wall;
      g.fillRect(0, 0, W, H);
      // Wood slats on one side, shelves on the other.
      for (let i = 0; i < 18; i++) {
        g.fillStyle = i % 2 ? '#5a4330' : '#6b5038';
        g.fillRect(W * 0.62 + i * 22, 0, 16, H);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(W * 0.62, 0, W * 0.38, H);
      for (const y of [H * 0.3, H * 0.52]) {
        g.fillStyle = '#3a4048';
        g.fillRect(W * 0.04, y, W * 0.3, 10);
      }
      bokeh(g, accent, 22, 7, H * 0.7);
      const floor = g.createLinearGradient(0, H * 0.78, 0, H);
      floor.addColorStop(0, 'rgba(0,0,0,0)');
      floor.addColorStop(1, 'rgba(0,0,0,0.6)');
      g.fillStyle = floor;
      g.fillRect(0, H * 0.78, W, H * 0.22);
      break;
    }
    case 'stage': {
      g.fillStyle = '#12060a';
      g.fillRect(0, 0, W, H);
      // Curtain folds.
      for (let i = 0; i < 40; i++) {
        const x = (W / 40) * i;
        const fold = g.createLinearGradient(x, 0, x + W / 40, 0);
        fold.addColorStop(0, '#3d0a14');
        fold.addColorStop(0.5, '#7a1426');
        fold.addColorStop(1, '#3d0a14');
        g.fillStyle = fold;
        g.fillRect(x, 0, W / 40 + 1, H * 0.8);
      }
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, 0, W, H * 0.8);
      // Spotlights.
      for (const [x, a] of [
        [W * 0.5, 0.55],
        [W * 0.25, 0.28],
        [W * 0.75, 0.28],
      ] as const) {
        const s = g.createRadialGradient(x, H * 0.55, 0, x, H * 0.55, H * 0.6);
        s.addColorStop(0, `rgba(255,236,200,${a})`);
        s.addColorStop(1, 'rgba(255,236,200,0)');
        g.fillStyle = s;
        g.fillRect(0, 0, W, H);
      }
      const floor = g.createLinearGradient(0, H * 0.8, 0, H);
      floor.addColorStop(0, '#2a1a12');
      floor.addColorStop(1, '#0d0806');
      g.fillStyle = floor;
      g.fillRect(0, H * 0.8, W, H * 0.2);
      break;
    }
    case 'podium': {
      const wall = g.createLinearGradient(0, 0, 0, H);
      wall.addColorStop(0, '#e9ecef');
      wall.addColorStop(1, '#b8bfc7');
      g.fillStyle = wall;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(W * 0.05 + i * W * 0.16, H * 0.08, W * 0.13, H * 0.62);
      }
      g.fillStyle = rgba(accent, 0.9);
      g.fillRect(0, H * 0.73, W, 10);
      if (title) {
        g.font = `600 ${Math.round(H * 0.07)}px "Segoe UI", system-ui, sans-serif`;
        g.fillStyle = rgba(accent, 0.85);
        g.textAlign = 'center';
        g.fillText(title.slice(0, 40), W / 2, H * 0.2);
      }
      // The podium, in front.
      const [f, fg] = canvas();
      const pw = W * 0.26;
      const px = (W - pw) / 2;
      const top = H * 0.66;
      const pod = fg.createLinearGradient(px, 0, px + pw, 0);
      pod.addColorStop(0, '#2b2f36');
      pod.addColorStop(0.5, '#454b55');
      pod.addColorStop(1, '#2b2f36');
      fg.fillStyle = pod;
      fg.beginPath();
      fg.moveTo(px - 20, top);
      fg.lineTo(px + pw + 20, top);
      fg.lineTo(px + pw, H);
      fg.lineTo(px, H);
      fg.closePath();
      fg.fill();
      fg.fillStyle = rgba(accent, 0.95);
      fg.fillRect(px + pw * 0.3, top + H * 0.08, pw * 0.4, H * 0.06);
      front = f;
      break;
    }
    case 'city': {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#04060f');
      sky.addColorStop(1, '#151a33');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      const rnd = seeded(42);
      for (let x = 0; x < W; ) {
        const bw = 60 + rnd() * 140;
        const bh = H * (0.25 + rnd() * 0.5);
        g.fillStyle = `rgba(10,14,30,${0.7 + rnd() * 0.3})`;
        g.fillRect(x, H - bh, bw, bh);
        for (let wy = H - bh + 14; wy < H - 10; wy += 22)
          for (let wx = x + 10; wx < x + bw - 10; wx += 18)
            if (rnd() > 0.55) {
              g.fillStyle = rnd() > 0.7 ? 'rgba(255,214,140,0.7)' : 'rgba(150,190,255,0.5)';
              g.fillRect(wx, wy, 8, 10);
            }
        x += bw + 6;
      }
      g.filter = 'blur(6px)';
      g.drawImage(back, 0, 0);
      g.filter = 'none';
      bokeh(g, accent, 18, 11);
      break;
    }
    default: {
      // The event's colors.
      const [r, gg, b] = hexRgb(accent);
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, `rgb(${Math.round(r * 0.35)},${Math.round(gg * 0.35)},${Math.round(b * 0.35)})`);
      bg.addColorStop(1, '#07080b');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = rgba(accent, 0.12);
      g.lineWidth = 3;
      for (let i = -H; i < W; i += 70) {
        g.beginPath();
        g.moveTo(i, H);
        g.lineTo(i + H, 0);
        g.stroke();
      }
      if (title) {
        g.font = `800 ${Math.round(H * 0.16)}px "Segoe UI", system-ui, sans-serif`;
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.textAlign = 'center';
        g.fillText(title.slice(0, 24).toUpperCase(), W / 2, H * 0.55);
      }
    }
  }
  return { back, front };
}

const made = new Map<string, { back: HTMLCanvasElement; front: HTMLCanvasElement | null }>();

/** A set's picture (behind the person) and what stands in front, made once per look. */
export function setPictures(id: string, accent: string, title: string): { back: HTMLCanvasElement; front: HTMLCanvasElement | null } | null {
  if (typeof document === 'undefined' || !SETS.some((s) => s.id === id)) return null;
  const key = `${id}|${accent}|${title}`;
  let p = made.get(key);
  if (!p) {
    try {
      p = draw(id, accent, title);
    } catch {
      return null;
    }
    made.set(key, p);
  }
  return p;
}

/** The event's look for the sets (its accent color and name), set by each window from its show. */
let look = { accent: '#2f80ed', title: '' };
export function setSetLook(accent: string, title: string): void {
  look = { accent, title };
}

/** A set in the event's look now. */
export const currentSet = (id: string | null | undefined) => (id ? setPictures(id, look.accent, look.title) : null);
