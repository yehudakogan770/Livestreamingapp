// The system check's judgment: what this computer has (from crates/syscheck
// and the web view) → one verdict (YES / RISKY / NO), a short list of checks
// (Good / OK / Low, each with one line of advice), what is safe to use at an
// event on this computer, and concrete do and don't lines.
//
// Every threshold is in PROFILES and FEATURES below, so the numbers live in
// one place (and rules.test.ts walks typical computers through them).

export type AppId = 'lumora' | 'studio';

// ---- What the Rust side found (lumora_syscheck::Facts) ----

export interface Gpu {
  name: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'microsoft' | 'other' | string;
  vramMb: number | null;
  driverVersion: string;
  driverDate: string | null;
  software: boolean;
}
export interface Disk {
  purpose: string;
  drive: string;
  freeMb: number;
  totalMb: number;
  kind: 'ssd' | 'hdd' | 'unknown' | string;
}
export interface Facts {
  os: { name: string; build: number; displayVersion: string; is64bit: boolean };
  cpu: { name: string; cores: number; threads: number };
  memory: { totalMb: number; availableMb: number };
  gpus: Gpu[];
  disks: Disk[];
  webview2: string | null;
  ffmpeg: { found: boolean; runs: boolean; version: string };
  hwEncoders: string[];
  hwDecode: string | null;
  power: { battery: boolean; onBattery: boolean; plan: string; mode: string };
  displays: { width: number; height: number; scale: number; primary: boolean }[];
  native: { adapters: { name: string; kind: string; backend: string }[]; supported: boolean } | null;
  missing: string[];
}

/** What only the page can see. */
export interface BrowserFacts {
  /** WebGL 2 works at all. */
  webgl2: boolean;
  /** The WebGL renderer ("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 …)"). */
  renderer: string;
  /** Cameras and microphones (null: couldn't ask). */
  cameras: number | null;
  mics: number | null;
  /** The device list came with names (permission given), so the counts are exact; without, browsers may list just one of each. */
  exact?: boolean;
  /** WebView2's major version, from the page's own user agent. */
  edge: number | null;
  /** Today, "YYYY-MM-DD" (for the graphics driver's age). */
  today: string;
}

/** Lumora's recording settings (for hours of recording left). */
export interface RecordingPlan {
  videoKbps: number;
  audioKbps: number;
  /** Each camera also to its own file. */
  iso: boolean;
  /** Cameras recorded on their own (when iso). */
  cameras: number;
}

// ---- The result ----

export type Grade = 'good' | 'ok' | 'low' | 'info';
export type Verdict = 'yes' | 'risky' | 'no';
export type Safety = 'safe' | 'risky' | 'avoid';

export interface Check {
  id: string;
  label: string;
  /** What was measured, short ("16 GB", "Windows 11 Pro 23H2"). */
  value: string;
  grade: Grade;
  /** One plain line (empty when there is nothing to say). */
  advice: string;
  /** Low here means NO: the app can't run reliably. */
  critical: boolean;
}
export interface Feature {
  name: string;
  safety: Safety;
  note: string;
}
export interface Tip {
  kind: 'do' | 'dont';
  text: string;
  /** Higher comes first. */
  weight: number;
}
export interface Report {
  app: AppId;
  verdict: Verdict;
  headline: string;
  sentence: string;
  checks: Check[];
  features: Feature[];
  tips: Tip[];
}

// ---- The thresholds ----

/** 0 = not enough, 1 = entry, 2 = mainstream, 3 = strong. */
export type Tier = 0 | 1 | 2 | 3;
type Need = [cpu: Tier, gpu: Tier, ramGb: number];

interface Profile {
  name: string;
  /** The verdicts' words. */
  words: Record<Verdict, [headline: string, sentence: string]>;
  /** Windows builds: below `min` won't run; below `rec` is out of date. */
  build: { min: number; rec: number };
  /** Grade for each processor and graphics tier (0–3); "critical" means a NO. */
  cpu: [GradeOrCritical, GradeOrCritical, GradeOrCritical, GradeOrCritical];
  gpu: [GradeOrCritical, GradeOrCritical, GradeOrCritical, GradeOrCritical];
  /** Memory in GB: below [0] NO, below [1] low, below [2] OK. */
  memoryGb: [number, number, number];
  /** Free space in GB on each drive: below [0] low, below [1] OK. */
  freeGb: [number, number];
  /** WebView2's major version: below [0] low, below [1] OK. */
  webview: [number, number];
  /** The smallest comfortable main screen (in screen points): below [0] low, below [1] OK. */
  screen: [[number, number], [number, number]];
  /** Screens wanted (Lumora: one for the console, one for the Live Screen). */
  screens: number;
  /** Graphics drivers older than this many months get an "update" line. */
  driverMonths: number;
  /** The best settings this computer can run, first match wins. */
  settings: { need: Need; text: string }[];
}
type GradeOrCritical = Grade | 'critical';

export const PROFILES: Record<AppId, Profile> = {
  lumora: {
    name: 'Lumora',
    words: {
      yes: ['Yes — ready for live events', 'This computer is ready for Lumora.'],
      risky: ['Risky — works, but follow the advice below', 'Lumora will work, with limits.'],
      no: ['No — this computer can’t run a live event reliably', 'This computer is below what Lumora needs.'],
    },
    build: { min: 17763, rec: 19044 },
    cpu: ['critical', 'low', 'good', 'good'],
    gpu: ['critical', 'ok', 'good', 'good'],
    memoryGb: [4, 8, 16],
    freeGb: [20, 50],
    webview: [100, 120],
    screen: [
      [1280, 720],
      [1600, 900],
    ],
    screens: 2,
    driverMonths: 24,
    settings: [
      { need: [3, 2, 16], text: 'Stream and record at 1080p30 (1080p60 is fine too)' },
      { need: [2, 2, 8], text: 'Stream and record at 1080p30' },
      { need: [1, 1, 8], text: 'Keep to 720p30 for streaming and recording' },
      { need: [0, 0, 0], text: 'Stream OR record, not both — and keep to 720p30' },
    ],
  },
  studio: {
    name: 'Lumora Studio',
    words: {
      yes: ['Yes — ready for editing', 'This computer is ready for Lumora Studio.'],
      risky: ['Risky — works, but follow the advice below', 'Lumora Studio will work, with limits.'],
      no: ['No — this computer can’t edit reliably', 'This computer is below what Lumora Studio needs.'],
    },
    build: { min: 17763, rec: 19044 },
    cpu: ['critical', 'low', 'ok', 'good'],
    gpu: ['critical', 'low', 'ok', 'good'],
    memoryGb: [4, 8, 16],
    freeGb: [20, 100],
    webview: [100, 120],
    screen: [
      [1280, 720],
      [1600, 900],
    ],
    screens: 1,
    driverMonths: 24,
    settings: [
      { need: [3, 3, 16], text: 'Edit 1080p and 4K (use proxies for long 4K timelines)' },
      { need: [2, 2, 16], text: 'Edit 1080p freely; make proxies for any 4K footage' },
      { need: [2, 1, 8], text: 'Edit 1080p; make proxies for anything bigger' },
      { need: [0, 0, 0], text: 'Keep to short 1080p edits, with proxies for everything' },
    ],
  },
};

/** What can be used at an event (or an edit) on this computer: [safe from, risky from]. */
export const FEATURES: Record<AppId, { name: string; safe: Need; risky: Need; notes: Record<Safety, string> }[]> = {
  lumora: [
    {
      name: 'Vertical 9:16 stream',
      safe: [3, 2, 16],
      risky: [2, 2, 8],
      notes: {
        safe: 'Fine alongside the main stream.',
        risky: 'Try it in a Rehearsal first; drop it if frames are missed.',
        avoid: 'A second stream is too much for this computer.',
      },
    },
    {
      name: 'NDI output',
      safe: [2, 1, 8],
      risky: [1, 1, 8],
      notes: { safe: 'Fine.', risky: 'Turn it on only if another computer needs the picture.', avoid: 'Leave it off.' },
    },
    {
      name: 'Background removal',
      safe: [2, 3, 16],
      risky: [2, 2, 8],
      notes: { safe: 'Fine on a camera or two.', risky: 'One camera at a time.', avoid: 'Too heavy for these graphics.' },
    },
    {
      name: 'Auto-framing',
      safe: [2, 2, 8],
      risky: [1, 2, 8],
      notes: { safe: 'Fine.', risky: 'One camera at a time.', avoid: 'Frame the cameras by hand.' },
    },
    {
      name: 'Live captions',
      safe: [3, 2, 16],
      risky: [2, 1, 8],
      notes: {
        safe: 'Any language, the larger Whisper model is fine.',
        risky: 'Use the quick English model or Whisper base.',
        avoid: 'Leave captions off during the event.',
      },
    },
    {
      name: 'Stage visuals',
      safe: [2, 2, 8],
      risky: [1, 1, 8],
      notes: { safe: 'Fine.', risky: 'Use the simpler scenes.', avoid: 'Use still backgrounds instead.' },
    },
    {
      name: 'Several output screens',
      safe: [2, 2, 8],
      risky: [1, 1, 8],
      notes: { safe: 'Projector, stage monitor and Live Screen together are fine.', risky: 'Two screens at most.', avoid: 'One output screen only.' },
    },
    {
      name: '4 or more cameras',
      safe: [3, 2, 16],
      risky: [2, 2, 8],
      notes: { safe: 'Fine, even with each camera recorded on its own.', risky: 'Turn off recording each camera on its own.', avoid: 'Three cameras at most.' },
    },
    {
      name: 'Instant replay',
      safe: [2, 1, 16],
      risky: [1, 1, 8],
      notes: { safe: 'Fine.', risky: 'Short replays only.', avoid: 'Leave it off.' },
    },
  ],
  studio: [
    {
      name: '4K editing',
      safe: [3, 3, 16],
      risky: [2, 2, 16],
      notes: { safe: 'Fine; proxies still help on long timelines.', risky: 'Make proxies first.', avoid: 'Edit in 1080p, or make proxies for everything.' },
    },
    {
      name: 'Multicam (4 or more angles)',
      safe: [3, 2, 16],
      risky: [2, 2, 8],
      notes: { safe: 'Fine.', risky: 'Use proxies for the angles.', avoid: 'Cut two or three angles at a time.' },
    },
    {
      name: 'Optical-flow slow motion',
      safe: [3, 3, 16],
      risky: [2, 2, 16],
      notes: { safe: 'Fine.', risky: 'Short clips only.', avoid: 'Avoid it on long clips; use plain slow motion.' },
    },
    {
      name: 'Speech to text and tracking',
      safe: [2, 2, 16],
      risky: [1, 1, 8],
      notes: { safe: 'Fine.', risky: 'Expect it to take a while.', avoid: 'Very slow here.' },
    },
  ],
};

// ---- Reading the facts ----

const LOW_POWER = /\b(celeron|pentium|atom|athlon (silver|gold)|n\d{3,4}\b|n100|n200|core\(tm\) m3|a\d-\d{4})/i;
const SOFTWARE_RENDERER = /swiftshader|basic render|basic display|llvmpipe|software|microsoft basic/i;

/** The processor's class: 0 (not enough) to 3 (strong). */
export function cpuTier(cpu: Facts['cpu']): Tier {
  const t = cpu.threads || cpu.cores;
  if (t < 4) return 0;
  if (t < 8 || LOW_POWER.test(cpu.name)) return 1;
  if (t < 12) return 2;
  return 3;
}

const isDiscrete = (g: Gpu) =>
  g.vendor === 'nvidia' ||
  (g.vendor === 'amd' && /\b(rx|pro w|firepro|vii)\b/i.test(g.name)) ||
  (g.vendor === 'intel' && /\barc\b/i.test(g.name) && !/graphics$/i.test(g.name));

/** One card's class: 0 (software) to 3 (a real card with 4 GB or more). */
export function gpuTierOf(g: Gpu): Tier {
  if (g.software || g.vendor === 'microsoft') return 0;
  const vram = (g.vramMb ?? 0) / 1024;
  if (isDiscrete(g)) return vram > 0 && vram < 3.5 ? 2 : 3;
  // Built-in graphics: the newer kinds are good for 1080p.
  if (/iris|arc|radeon.*(680m|780m|880m|890m)|radeon\(tm\) graphics|vega/i.test(g.name)) return 2;
  return 1;
}

/** The computer's best graphics, held back if the web view itself draws in software. */
export function gpuTier(f: Facts, b: BrowserFacts): Tier {
  if (!b.webgl2 || SOFTWARE_RENDERER.test(b.renderer)) return 0;
  const best = Math.max(0, ...f.gpus.map(gpuTierOf)) as Tier;
  // Nothing known from Windows, but the page draws in hardware: assume entry level.
  return f.gpus.length === 0 ? 1 : best;
}

const gb = (mb: number) => mb / 1024;
const roundGb = (mb: number) => {
  const g = gb(mb);
  return g >= 10 ? Math.round(g) : Math.round(g * 10) / 10;
};
/** Windows reports a little less memory than is fitted: "16 GB" from 15.8. */
export const memoryGb = (mb: number) => Math.round(gb(mb) + 0.3);
const meets = (need: Need, cpu: Tier, gpu: Tier, ram: number) => cpu >= need[0] && gpu >= need[1] && ram >= need[2];

/** Months between two "YYYY-MM-DD" dates. */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  if (!y1 || !m1 || !y2 || !m2) return 0;
  return (y2 - y1) * 12 + (m2 - m1);
}

/** The bigger of two dotted versions' first numbers. */
export const majorOf = (v: string | null | undefined): number | null => {
  const n = Number.parseInt(String(v ?? '').split('.')[0] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Hours of recording that fit in `freeMb` (main recording plus each camera on its own). */
export function recordingHours(freeMb: number, plan: RecordingPlan): number {
  const files = 1 + (plan.iso ? Math.max(0, plan.cameras) : 0);
  const mbPerHour = ((plan.videoKbps + plan.audioKbps) * 3600 * files) / 8 / 1000;
  // Keep 5 GB spare: Windows needs room too.
  return Math.max(0, (freeMb - 5 * 1024) / Math.max(1, mbPerHour));
}

export function hoursText(h: number): string {
  if (h < 1) return `≈ ${Math.max(0, Math.floor((h * 60) / 5) * 5)} min`;
  if (h < 10) return `≈ ${Math.floor(h * 2) / 2} hours`.replace('.5 hours', '½ hours');
  return `≈ ${Math.floor(h)} hours`;
}

const driveName = (d: Disk) => d.drive || `the ${d.purpose} drive`;
const kindName = (k: string) => (k === 'ssd' ? 'SSD' : k === 'hdd' ? 'hard disk' : '');
const encoderFamily = (names: string[]) =>
  [
    ...new Set(
      names.map((n) =>
        n.includes('nvenc') ? 'NVENC' : n.includes('qsv') ? 'Quick Sync' : n.includes('amf') ? 'AMF' : n.includes('videotoolbox') ? 'VideoToolbox' : n,
      ),
    ),
  ].join(', ');

/** Strictest of two grades. */
function worse(a: GradeOrCritical, b: GradeOrCritical): GradeOrCritical {
  const order: GradeOrCritical[] = ['info', 'good', 'ok', 'low', 'critical'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
function check(id: string, label: string, value: string, g: GradeOrCritical, advice: string): Check {
  return { id, label, value, grade: g === 'critical' ? 'low' : g, advice, critical: g === 'critical' };
}

/** The verdict: any critical Low is NO; any other Low is RISKY; otherwise YES. */
export function verdictOf(checks: Check[]): Verdict {
  if (checks.some((c) => c.grade === 'low' && c.critical)) return 'no';
  if (checks.some((c) => c.grade === 'low')) return 'risky';
  return 'yes';
}

// ---- The judgment ----

export function judge(app: AppId, f: Facts, b: BrowserFacts, plan: RecordingPlan | null = null): Report {
  const p = PROFILES[app];
  const cpu = cpuTier(f.cpu);
  const gpu = gpuTier(f, b);
  const ram = memoryGb(f.memory.totalMb);
  const checks: Check[] = [];
  const tips: Tip[] = [];
  const tip = (kind: Tip['kind'], text: string, weight: number) => tips.push({ kind, text, weight });

  // Windows.
  {
    const name = [f.os.name, f.os.displayVersion].filter(Boolean).join(' ');
    const isWindows = f.os.build > 0;
    let g: GradeOrCritical = 'good';
    let advice = '';
    if (!f.os.is64bit) {
      g = 'critical';
      advice = `${p.name} needs 64-bit Windows.`;
    } else if (isWindows && f.os.build < p.build.min) {
      g = 'critical';
      advice = 'This Windows is too old for the parts Lumora is built on. Update to Windows 10 21H2 or Windows 11.';
    } else if (isWindows && f.os.build < p.build.rec) {
      g = 'low';
      advice = 'Update Windows (Settings → Windows Update): Windows 10 21H2 or newer is needed for a dependable show.';
    } else if (isWindows && f.os.build < 22000) {
      g = 'ok';
      advice = 'Windows 10 no longer gets security updates. Windows 11 is recommended.';
    }
    checks.push(check('os', 'Windows', name || 'Unknown', g, advice));
  }

  // Processor.
  {
    const g = p.cpu[cpu];
    const threads = f.cpu.threads || f.cpu.cores;
    const value = `${f.cpu.name || 'Unknown processor'} · ${f.cpu.cores} cores, ${threads} threads`;
    const advice =
      cpu === 0
        ? `Too few processor threads (${threads}). ${p.name} needs at least 4; 8 or more is recommended.`
        : cpu === 1
          ? app === 'lumora'
            ? 'An entry-level processor: keep to 720p and a few cameras.'
            : 'An entry-level processor: editing will be slow; use proxies.'
          : cpu === 2
            ? app === 'lumora'
              ? ''
              : 'Good for 1080p; 4K editing works best with 12 or more threads.'
            : '';
    checks.push(check('cpu', 'Processor', value, g, advice));
  }

  // Memory.
  {
    const [no, low, ok] = p.memoryGb;
    const g: GradeOrCritical = ram < no ? 'critical' : ram < low ? 'low' : ram < ok ? 'ok' : 'good';
    const advice =
      g === 'critical'
        ? `${ram} GB of memory is not enough. ${p.name} needs at least ${low} GB.`
        : g === 'low'
          ? `${ram} GB of memory: close every other program while ${p.name} runs; ${ok} GB is recommended.`
          : g === 'ok'
            ? app === 'lumora'
              ? `${ram} GB memory: fine for 1080p; 16 GB+ recommended for several cameras.`
              : `${ram} GB memory: fine for 1080p; 16 GB+ recommended for 4K editing.`
            : '';
    checks.push(check('memory', 'Memory', `${ram} GB (${roundGb(f.memory.availableMb)} GB free now)`, g, advice));
    if (ram < 16 || gb(f.memory.availableMb) < 4) tip('dont', 'Don’t keep Chrome, Teams or Zoom open during the event — memory is tight.', 60);
  }

  // Graphics (the card, its driver, and what the page draws with).
  {
    const real = f.gpus.filter((g) => !g.software);
    const best = [...real].sort((a, c) => gpuTierOf(c) - gpuTierOf(a))[0];
    const softwareOnly = gpu === 0;
    let g: GradeOrCritical = p.gpu[gpu];
    let advice = '';
    if (softwareOnly) {
      advice = !b.webgl2
        ? 'The graphics can’t draw 3D in the app — install the graphics driver from NVIDIA, AMD or Intel.'
        : 'Your graphics are software only — install the graphics driver from NVIDIA, AMD or Intel.';
      tip('do', 'Install the graphics driver from NVIDIA, AMD or Intel before anything else.', 120);
    } else if (gpu === 1) {
      advice =
        app === 'lumora'
          ? 'Built-in graphics: fine for 1080p with simple scenes; a separate graphics card helps with effects.'
          : 'Basic built-in graphics: 1080p editing will be slow; a separate graphics card helps a lot.';
    } else if (gpu === 2 && app === 'studio') {
      advice = 'Good for 1080p; a graphics card with 4 GB or more helps for 4K and effects.';
    }
    const date = best?.driverDate;
    if (!softwareOnly && date && b.today && monthsBetween(date, b.today) > p.driverMonths) {
      g = worse(g, 'ok');
      const year = date.slice(0, 4);
      advice = advice || `The graphics driver is from ${year} — update it from the maker’s website.`;
      tip('do', `Update the graphics driver (yours is from ${year}).`, 75);
    }
    const vram = best?.vramMb ? ` · ${roundGb(best.vramMb)} GB` : '';
    const value = best ? `${best.name}${vram}${best.driverVersion ? ` · driver ${best.driverVersion}` : ''}` : b.renderer || 'Unknown';
    checks.push(check('gpu', 'Graphics', value, g, advice));
    const drawsIn = b.webgl2 ? (SOFTWARE_RENDERER.test(b.renderer) ? 'software (slow)' : 'hardware') : 'not available';
    checks.push(
      check(
        'webgl',
        'Drawing in the app',
        `WebGL 2: ${drawsIn}`,
        !b.webgl2 || SOFTWARE_RENDERER.test(b.renderer) ? 'critical' : 'good',
        !b.webgl2 || SOFTWARE_RENDERER.test(b.renderer)
          ? 'The app draws without the graphics card — install the graphics driver, then restart the computer.'
          : '',
      ),
    );
  }

  // Hardware video.
  {
    const enc = f.hwEncoders;
    const value = [enc.length ? `Encode: ${encoderFamily(enc)}` : 'Encode: processor only', app === 'studio' ? `Decode: ${f.hwDecode ?? 'processor only'}` : '']
      .filter(Boolean)
      .join(' · ');
    if (app === 'lumora') {
      checks.push(
        check('video', 'Hardware video', value, 'info', enc.length ? '' : 'Lumora compresses video on the processor, so the processor matters most.'),
      );
    } else {
      const g: GradeOrCritical = enc.length && f.hwDecode ? 'good' : 'ok';
      const advice = !enc.length
        ? 'Exports use the processor only, so they take longer — a graphics card with NVENC, Quick Sync or AMF speeds them up.'
        : !f.hwDecode
          ? 'Camera files are decoded on the processor: 4K playback will be heavier — use proxies.'
          : '';
      checks.push(check('video', 'Hardware video', value, g, advice));
      if (!enc.length) tip('do', 'Export overnight or while you take a break — exports use the processor only.', 35);
    }
  }

  // Drives.
  for (const d of f.disks) {
    const freeGb = gb(d.freeMb);
    const [low, ok] = p.freeGb;
    let g: GradeOrCritical = freeGb < low ? 'low' : freeGb < ok ? 'ok' : 'good';
    const where = driveName(d);
    let advice = '';
    if (g === 'low')
      advice =
        d.purpose === 'recordings'
          ? `Less than ${low} GB free on ${where} — recordings may stop.`
          : `Less than ${low} GB free on ${where} — free up some space.`;
    else if (g === 'ok') advice = `${Math.round(freeGb)} GB free on ${where}: enough for now; ${ok} GB or more is safer.`;
    if (d.kind === 'hdd') {
      g = worse(g, 'ok');
      advice ||=
        app === 'lumora'
          ? `${where} is a spinning hard disk: fine for one recording; an SSD is safer for several cameras.`
          : `${where} is a spinning hard disk: editing from it is slower; an SSD helps.`;
    }
    const kind = kindName(d.kind);
    checks.push(
      check(
        `disk:${d.purpose}`,
        `Drive for ${d.purpose}`,
        `${where}${kind ? ` (${kind})` : ''} · ${Math.round(freeGb)} GB free of ${Math.round(gb(d.totalMb))} GB`,
        g,
        advice,
      ),
    );
  }

  // Screens.
  {
    const main = f.displays.find((d) => d.primary) ?? f.displays[0];
    if (main) {
      const w = Math.round(main.width / (main.scale || 1));
      const h = Math.round(main.height / (main.scale || 1));
      const [[lw, lh], [ow, oh]] = p.screen;
      let g: GradeOrCritical = w < lw || h < lh ? 'low' : w < ow || h < oh ? 'ok' : 'good';
      let advice = g === 'low' ? `A small main screen (${w}×${h}): ${p.name} will be cramped; 1920×1080 is recommended.` : '';
      if (f.displays.length < p.screens) {
        g = worse(g, 'ok');
        advice ||= 'One screen: plug in a projector or a second screen for the Live Screen.';
        tip('do', 'Plug in the projector or second screen before the event and check the Live Screen on it.', 50);
      }
      const list = f.displays.map((d) => `${d.width}×${d.height}`).join(', ');
      checks.push(check('screens', 'Screens', `${f.displays.length} · ${list}`, g, advice));
    }
  }

  // WebView2.
  {
    const major = majorOf(f.webview2) ?? b.edge;
    if (major !== null) {
      const [low, ok] = p.webview;
      const g: GradeOrCritical = major < low ? 'low' : major < ok ? 'ok' : 'good';
      const advice = g === 'good' ? '' : 'Microsoft Edge WebView2 is out of date — run Windows Update, or install it again from Microsoft.';
      checks.push(check('webview', 'WebView2', f.webview2 ?? String(major), g, advice));
    }
  }

  // FFmpeg.
  {
    const ok = f.ffmpeg.found && f.ffmpeg.runs;
    checks.push(
      check(
        'ffmpeg',
        'FFmpeg',
        ok ? f.ffmpeg.version || 'Works' : f.ffmpeg.found ? 'Found, but doesn’t run' : 'Not found',
        ok ? 'good' : 'critical',
        ok
          ? ''
          : `FFmpeg comes with ${p.name} and is needed for ${app === 'lumora' ? 'recording and streaming' : 'importing and exporting'}: install ${p.name} again.`,
      ),
    );
  }

  // Power.
  {
    const { battery, onBattery, plan: scheme, mode } = f.power;
    let g: GradeOrCritical = 'info';
    let advice = '';
    if (onBattery) {
      g = 'ok';
      advice = 'Running on the battery: plug in the charger — Windows slows the computer down on battery.';
    } else if (scheme === 'saver' || mode === 'efficiency') {
      g = 'ok';
      advice = 'Windows is set to save power: switch the power mode to Best performance.';
    }
    if (battery || scheme === 'saver' || mode === 'efficiency') {
      tip('do', 'Plug in the charger and set Windows power mode to Best performance (Settings → System → Power).', onBattery ? 90 : 70);
    }
    const value = [battery ? (onBattery ? 'Laptop, on battery' : 'Laptop, plugged in') : 'Plugged in', scheme && `plan: ${scheme}`, mode && `mode: ${mode}`]
      .filter(Boolean)
      .join(' · ');
    if (battery || scheme || mode) checks.push(check('power', 'Power', value, g, advice));
  }

  // Lumora: cameras and microphones; the internet is tested before going live.
  if (app === 'lumora') {
    if (b.cameras !== null || b.mics !== null) {
      const cams = b.cameras ?? 0;
      const mics = b.mics ?? 0;
      checks.push(
        check(
          'devices',
          'Cameras and microphones',
          b.exact === false
            ? `${cams ? 'At least one camera' : 'No camera'}, ${mics ? 'at least one microphone' : 'no microphone'}`
            : `${cams} camera${cams === 1 ? '' : 's'}, ${mics} microphone${mics === 1 ? '' : 's'}`,
          'info',
          cams === 0 ? 'No camera found right now — plug in cameras or capture cards before the event.' : '',
        ),
      );
    }
    checks.push(check('network', 'Internet', 'Tested before going live', 'info', 'Run a Rehearsal on the event’s own internet before going live.'));
    tip('do', 'Run a Rehearsal (next to Go live) on the event’s own internet before the event.', 40);
    tip('dont', 'Don’t let Windows Update restart the computer — pause updates on the day of the event.', 30);
  }

  // Studio: the native engine.
  if (app === 'studio' && f.native) {
    const n = f.native;
    const best = n.adapters.find((a) => a.kind === 'discrete') ?? n.adapters.find((a) => a.kind === 'integrated') ?? n.adapters[0];
    const value = best ? `${best.name} (${best.backend})` : 'No graphics card found';
    checks.push(
      check(
        'native',
        'Native playback engine',
        value,
        n.supported ? 'good' : 'low',
        n.supported ? '' : 'Native playback can’t start (no Direct3D 12 graphics card) — the viewer uses the slower WebGL preview. Update the graphics driver.',
      ),
    );
    if (n.supported && gpu >= 2) tip('do', 'Turn on Native playback (beta) in the Settings menu for smoother playback.', 55);
  }

  // Storage: how long recordings can run (Lumora), and room for the cache (Studio).
  if (app === 'lumora' && plan) {
    const rec = f.disks.find((d) => d.purpose === 'recordings');
    if (rec) {
      const hours = recordingHours(rec.freeMb, plan);
      const where = driveName(rec);
      const kind = kindName(rec.kind);
      const free = `${Math.round(gb(rec.freeMb))} GB free`;
      if (hours < 3) {
        tip('dont', `Don’t record to ${where} — only ${free} (${hoursText(hours)}). Choose another recordings folder or free up space.`, 95);
        const roomier = f.disks.find((d) => d.drive && d.drive !== rec.drive && recordingHours(d.freeMb, plan) >= 3);
        if (roomier) tip('do', `Record to ${roomier.drive} instead (${Math.round(gb(roomier.freeMb))} GB free).`, 94);
      } else {
        tip('do', `Record to ${where}${kind ? ` (${kind}, ${free})` : ` (${free})`} ${hoursText(hours)} at your recording settings.`, 45);
      }
      if (rec.kind === 'hdd' && plan.iso && plan.cameras >= 3) {
        tip('dont', `Don’t record ${plan.cameras} cameras to a spinning hard disk (${where}) — use an SSD, or turn off recording each camera on its own.`, 65);
      }
    }
  }
  if (app === 'studio') {
    const cache = f.disks.find((d) => d.purpose === 'cache');
    if (cache && gb(cache.freeMb) < p.freeGb[1])
      tip('do', `Free up space on ${driveName(cache)} — proxies and the render cache need room (${Math.round(gb(cache.freeMb))} GB free).`, 70);
    const media = f.disks.find((d) => d.purpose === 'media');
    if (media?.kind === 'hdd') tip('dont', `Don’t edit 4K camera files from ${driveName(media)} (a hard disk) — copy them to an SSD first.`, 50);
    if (cpu < 3 || gpu < 3) tip('do', 'Use proxies for 4K footage (made when you import).', 80);
  }

  // What is safe to use here.
  const features: Feature[] = FEATURES[app].map((x) => {
    const safety: Safety = meets(x.safe, cpu, gpu, ram) ? 'safe' : meets(x.risky, cpu, gpu, ram) ? 'risky' : 'avoid';
    return { name: x.name, safety, note: x.notes[safety] };
  });
  for (const x of features) {
    if (x.safety === 'avoid') tip('dont', `${x.name}: ${x.note.charAt(0).toLowerCase()}${x.note.slice(1)}`, 20);
  }

  // The best settings, first.
  const best = p.settings.find((s) => meets(s.need, cpu, gpu, ram)) ?? p.settings[p.settings.length - 1]!;
  tip('do', `${best.text}.`, 100);

  const verdict = verdictOf(checks);
  const [headline, sentence] = p.words[verdict];
  tips.sort((a, c) => c.weight - a.weight);
  return { app, verdict, headline, sentence, checks, features, tips };
}
