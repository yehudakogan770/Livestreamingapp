import { describe, expect, it } from 'vitest';
import { detailsText } from './details';
import {
  cpuTier,
  FEATURES,
  gpuTier,
  gpuTierOf,
  hoursText,
  judge,
  memoryGb,
  monthsBetween,
  PROFILES,
  recordingHours,
  verdictOf,
  type BrowserFacts,
  type Check,
  type Facts,
  type Gpu,
  type RecordingPlan,
} from './rules';

const RTX: Gpu = { name: 'NVIDIA GeForce RTX 3060', vendor: 'nvidia', vramMb: 12288, driverVersion: '31.0.15.5222', driverDate: '2026-03-12', software: false };
const IRIS: Gpu = {
  name: 'Intel(R) Iris(R) Xe Graphics',
  vendor: 'intel',
  vramMb: 128,
  driverVersion: '31.0.101.4502',
  driverDate: '2025-11-01',
  software: false,
};
const UHD: Gpu = {
  name: 'Intel(R) UHD Graphics 600',
  vendor: 'intel',
  vramMb: 128,
  driverVersion: '26.20.100.7262',
  driverDate: '2019-08-01',
  software: false,
};
const BASIC: Gpu = {
  name: 'Microsoft Basic Render Driver',
  vendor: 'microsoft',
  vramMb: null,
  driverVersion: '10.0.19041.1',
  driverDate: null,
  software: true,
};

/** A strong desktop: the starting point each case changes. */
function desktop(over: Partial<Facts> = {}): Facts {
  return {
    os: { name: 'Windows 11 Pro', build: 22631, displayVersion: '23H2', is64bit: true },
    cpu: { name: 'AMD Ryzen 7 5800X 8-Core Processor', cores: 8, threads: 16 },
    memory: { totalMb: 32694, availableMb: 20000 },
    gpus: [RTX],
    disks: [
      { purpose: 'recordings', drive: 'D:', freeMb: 420 * 1024, totalMb: 1000 * 1024, kind: 'ssd' },
      { purpose: 'app data', drive: 'C:', freeMb: 200 * 1024, totalMb: 500 * 1024, kind: 'ssd' },
    ],
    webview2: '131.0.2903.70',
    ffmpeg: { found: true, runs: true, version: '7.1' },
    hwEncoders: ['h264_nvenc', 'hevc_nvenc'],
    hwDecode: 'cuda',
    power: { battery: false, onBattery: false, plan: 'balanced', mode: '' },
    displays: [
      { width: 1920, height: 1080, scale: 1, primary: true },
      { width: 1920, height: 1080, scale: 1, primary: false },
    ],
    native: null,
    missing: [],
    ...over,
  };
}
const browser = (over: Partial<BrowserFacts> = {}): BrowserFacts => ({
  webgl2: true,
  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  cameras: 3,
  mics: 2,
  edge: 131,
  today: '2026-10-06',
  ...over,
});
const plan: RecordingPlan = { videoKbps: 6000, audioKbps: 160, iso: true, cameras: 2 };
const byId = (checks: Check[], id: string) => checks.find((c) => c.id === id)!;

describe('the classes', () => {
  it('rates processors', () => {
    expect(cpuTier({ name: 'Intel(R) Celeron(R) N4020', cores: 2, threads: 2 })).toBe(0);
    expect(cpuTier({ name: 'Intel(R) Core(TM) i3-10100', cores: 4, threads: 8 })).toBe(2);
    expect(cpuTier({ name: 'Intel(R) Pentium(R) Gold 8505', cores: 5, threads: 8 })).toBe(1);
    expect(cpuTier({ name: 'Intel(R) Core(TM) i5-7200U', cores: 2, threads: 4 })).toBe(1);
    expect(cpuTier({ name: 'AMD Ryzen 7 5800X', cores: 8, threads: 16 })).toBe(3);
  });
  it('rates graphics, and the page drawing in software beats everything', () => {
    expect(gpuTierOf(RTX)).toBe(3);
    expect(gpuTierOf({ ...RTX, name: 'NVIDIA GeForce GT 1030', vramMb: 2048 })).toBe(2);
    expect(gpuTierOf(IRIS)).toBe(2);
    expect(gpuTierOf(UHD)).toBe(1);
    expect(gpuTierOf(BASIC)).toBe(0);
    expect(gpuTier(desktop(), browser({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }))).toBe(0);
    expect(gpuTier(desktop(), browser({ webgl2: false }))).toBe(0);
    expect(gpuTier(desktop({ gpus: [] }), browser())).toBe(1);
  });
  it('counts memory the way it is sold', () => {
    expect(memoryGb(16077)).toBe(16);
    expect(memoryGb(7898)).toBe(8);
    expect(memoryGb(3900)).toBe(4);
  });
  it('dates and hours', () => {
    expect(monthsBetween('2021-04-20', '2026-10-06')).toBe(66);
    expect(monthsBetween('', '2026-10-06')).toBe(0);
    // 6160 kbps × 3 files ≈ 8.3 GB an hour; 5 GB is kept spare.
    expect(recordingHours(100 * 1024, plan)).toBeCloseTo(11.7, 1);
    expect(recordingHours(4 * 1024, plan)).toBe(0);
    // Camera files at their own bitrate: 6160 + 2 × 8000 kbps ≈ 10 GB an hour.
    expect(recordingHours(100 * 1024, { ...plan, isoKbps: 8000 })).toBeCloseTo(9.76, 1);
    expect(hoursText(0.7)).toBe('≈ 40 min');
    expect(hoursText(2.6)).toBe('≈ 2½ hours');
    expect(hoursText(38.2)).toBe('≈ 38 hours');
  });
});

describe('the verdict', () => {
  const c = (grade: Check['grade'], critical = false): Check => ({ id: grade, label: '', value: '', grade, advice: '', critical });
  it('is NO for a needed check, RISKY for any other Low, YES otherwise', () => {
    expect(verdictOf([c('good'), c('ok'), c('info')])).toBe('yes');
    expect(verdictOf([c('good'), c('low')])).toBe('risky');
    expect(verdictOf([c('low'), c('low', true)])).toBe('no');
  });
});

describe('Lumora on typical computers', () => {
  it('a strong desktop: YES, 1080p60, everything safe', () => {
    const r = judge('lumora', desktop(), browser(), plan);
    expect(r.verdict).toBe('yes');
    expect(r.headline).toBe('Yes — ready for live events');
    expect(r.tips[0]).toEqual({
      kind: 'do',
      text: 'Record in 4K and stream at 1080p60 at the same time (the graphics card does the encoding).',
      weight: 100,
    });
    expect(r.features.every((f) => f.safety === 'safe')).toBe(true);
    expect(byId(r.checks, 'video').advice).toMatch(/^Streams and re-encoded recordings use NVENC/);
    expect(r.tips.some((t) => t.text.startsWith('Record to D: (SSD, 420 GB free) ≈'))).toBe(true);
    expect(r.tips.some((t) => t.kind === 'dont' && t.text.includes('Windows Update'))).toBe(true);
    expect(r.tips.some((t) => t.text.includes('Rehearsal'))).toBe(true);
    expect(r.checks.filter((x) => x.grade === 'low')).toEqual([]);
    expect(byId(r.checks, 'devices').value).toBe('3 cameras, 2 microphones');
    // Without permission the list may hold just one of each.
    expect(byId(judge('lumora', desktop(), browser({ exact: false, cameras: 1, mics: 0 })).checks, 'devices').value).toBe('At least one camera, no microphone');
  });

  it('a mid laptop on battery with one screen: works, with the charger and a second screen', () => {
    const r = judge(
      'lumora',
      desktop({
        cpu: { name: '11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz', cores: 4, threads: 8 },
        memory: { totalMb: 16077, availableMb: 6000 },
        gpus: [IRIS],
        power: { battery: true, onBattery: true, plan: 'balanced', mode: 'efficiency' },
        displays: [{ width: 2880, height: 1800, scale: 2, primary: true }],
      }),
      browser({ renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }),
      plan,
    );
    expect(r.verdict).toBe('yes');
    expect(r.tips[0]!.text).toBe('Stream and record at 1080p30.');
    expect(r.tips[1]!.text).toMatch(/^Plug in the charger and set Windows power mode to Best performance/);
    expect(byId(r.checks, 'power').grade).toBe('ok');
    expect(byId(r.checks, 'screens').advice).toMatch(/second screen/);
    expect(r.features.find((f) => f.name === 'Background removal')!.safety).toBe('risky');
    expect(r.features.find((f) => f.name === 'Vertical 9:16 stream')!.safety).toBe('risky');
  });

  it('an old small PC with 8 GB and an old driver: RISKY, 720p', () => {
    const r = judge(
      'lumora',
      desktop({
        os: { name: 'Windows 10 Home', build: 19045, displayVersion: '22H2', is64bit: true },
        cpu: { name: 'Intel(R) Core(TM) i5-7200U CPU @ 2.50GHz', cores: 2, threads: 4 },
        memory: { totalMb: 7898, availableMb: 3000 },
        gpus: [UHD],
      }),
      browser({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 600)' }),
      plan,
    );
    expect(r.verdict).toBe('risky');
    expect(r.headline).toBe('Risky — works, but follow the advice below');
    expect(r.tips[0]!.text).toBe('Keep to 720p30 for streaming and recording.');
    expect(byId(r.checks, 'os').grade).toBe('ok');
    expect(byId(r.checks, 'cpu').grade).toBe('low');
    expect(byId(r.checks, 'memory').advice).toBe('8 GB memory: fine for 1080p; 16 GB+ recommended for several cameras.');
    expect(r.tips.some((t) => t.text === 'Update the graphics driver (yours is from 2019).')).toBe(true);
    expect(r.tips.some((t) => t.kind === 'dont' && t.text.includes('Chrome, Teams or Zoom'))).toBe(true);
    expect(r.features.find((f) => f.name === 'Background removal')!.safety).toBe('avoid');
    expect(r.tips.some((t) => t.kind === 'dont' && t.text.startsWith('Background removal:'))).toBe(true);
  });

  it('software graphics: NO, and the driver comes first', () => {
    const r = judge('lumora', desktop({ gpus: [BASIC] }), browser({ renderer: 'Microsoft Basic Render Driver' }), plan);
    expect(r.verdict).toBe('no');
    expect(r.headline).toBe('No — this computer can’t run a live event reliably');
    expect(byId(r.checks, 'gpu').advice).toBe('Your graphics are software only — install the graphics driver from NVIDIA, AMD or Intel.');
    expect(r.tips[0]!.text).toMatch(/^Install the graphics driver/);
    expect(r.tips[1]!.text).toBe('Stream OR record, not both — and keep to 720p30.');
  });

  it('no FFmpeg, 32-bit or 2 threads: NO', () => {
    expect(judge('lumora', desktop({ ffmpeg: { found: false, runs: false, version: '' } }), browser()).verdict).toBe('no');
    expect(judge('lumora', desktop({ os: { name: 'Windows 10', build: 19045, displayVersion: '', is64bit: false } }), browser()).verdict).toBe('no');
    expect(judge('lumora', desktop({ cpu: { name: 'Intel(R) Celeron(R) N4020', cores: 2, threads: 2 } }), browser()).verdict).toBe('no');
    expect(judge('lumora', desktop({ os: { name: 'Windows 10', build: 17134, displayVersion: '', is64bit: true } }), browser()).verdict).toBe('no');
  });

  it('a full recordings drive: Low, don’t record there, record to the roomier drive', () => {
    const r = judge(
      'lumora',
      desktop({
        disks: [
          { purpose: 'recordings', drive: 'C:', freeMb: 18 * 1024, totalMb: 256 * 1024, kind: 'ssd' },
          { purpose: 'app data', drive: 'D:', freeMb: 900 * 1024, totalMb: 2000 * 1024, kind: 'hdd' },
        ],
      }),
      browser(),
      plan,
    );
    expect(r.verdict).toBe('risky');
    expect(byId(r.checks, 'disk:recordings').advice).toBe('Less than 20 GB free on C: — recordings may stop.');
    const dont = r.tips.find((t) => t.kind === 'dont' && t.text.startsWith('Don’t record to C:'))!;
    expect(dont.text).toBe('Don’t record to C: — only 18 GB free (≈ 1½ hours). Choose another recordings folder or free up space.');
    expect(r.tips.some((t) => t.text === 'Record to D: instead (900 GB free).')).toBe(true);
    expect(byId(r.checks, 'disk:app data').grade).toBe('ok');
  });

  it('several cameras to a hard disk: don’t', () => {
    const r = judge('lumora', desktop({ disks: [{ purpose: 'recordings', drive: 'D:', freeMb: 900 * 1024, totalMb: 1000 * 1024, kind: 'hdd' }] }), browser(), {
      ...plan,
      cameras: 4,
    });
    expect(r.tips.some((t) => t.kind === 'dont' && t.text.startsWith('Don’t record 4 cameras to a spinning hard disk (D:)'))).toBe(true);
  });
});

describe('Lumora Studio on typical computers', () => {
  const studio = (over: Partial<Facts> = {}) =>
    desktop({
      disks: [
        { purpose: 'media', drive: 'D:', freeMb: 800 * 1024, totalMb: 1000 * 1024, kind: 'ssd' },
        { purpose: 'cache', drive: 'C:', freeMb: 300 * 1024, totalMb: 500 * 1024, kind: 'ssd' },
      ],
      native: { adapters: [{ name: 'NVIDIA GeForce RTX 3060', kind: 'discrete', backend: 'Dx12' }], supported: true },
      ...over,
    });

  it('a strong desktop: YES for 4K, native playback suggested', () => {
    const r = judge('studio', studio(), browser());
    expect(r.verdict).toBe('yes');
    expect(r.headline).toBe('Yes — ready for editing');
    expect(r.tips[0]!.text).toBe('Edit 1080p and 4K (use proxies for long 4K timelines).');
    expect(r.tips.some((t) => t.text.startsWith('Turn on Native playback'))).toBe(true);
    expect(r.features.every((f) => f.safety === 'safe')).toBe(true);
  });

  it('8 GB, built-in graphics, no hardware encoder, no Direct3D 12: RISKY with proxies', () => {
    const r = judge(
      'studio',
      studio({
        cpu: { name: 'Intel(R) Core(TM) i5-8250U', cores: 4, threads: 8 },
        memory: { totalMb: 7898, availableMb: 3000 },
        gpus: [UHD],
        hwEncoders: [],
        hwDecode: null,
        native: { adapters: [{ name: 'Microsoft Basic Render Driver', kind: 'software', backend: 'Dx12' }], supported: false },
      }),
      browser({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 600)' }),
    );
    expect(r.verdict).toBe('risky');
    expect(byId(r.checks, 'memory').advice).toBe('8 GB memory: fine for 1080p; 16 GB+ recommended for 4K editing.');
    expect(byId(r.checks, 'gpu').grade).toBe('low');
    expect(byId(r.checks, 'native').grade).toBe('low');
    expect(byId(r.checks, 'video').grade).toBe('ok');
    expect(r.tips.some((t) => t.text === 'Use proxies for 4K footage (made when you import).')).toBe(true);
    expect(r.tips.some((t) => t.text.startsWith('Turn on Native playback'))).toBe(false);
    expect(r.features.find((f) => f.name === 'Optical-flow slow motion')!.note).toBe('Avoid it on long clips; use plain slow motion.');
  });
});

describe('4K and 60 frames a second', () => {
  const safety = (r: ReturnType<typeof judge>, name: string) => r.features.find((f) => f.name === name)!.safety;
  it('the same strong desktop without a working graphics-card encoder: no 4K, and 1080p60 only risky', () => {
    const r = judge('lumora', desktop({ hwEncoders: [] }), browser(), plan);
    expect(r.tips[0]!.text).toBe('Stream and record at 1080p30 (1080p60 is fine too).');
    expect(safety(r, '4K recording with a 1080p stream')).toBe('avoid');
    expect(safety(r, '4K60 recording')).toBe('avoid');
    expect(safety(r, '1080p60 streaming')).toBe('risky');
    expect(byId(r.checks, 'video').advice).toMatch(/keep to 1080p and avoid 4K/);
  });
  it('a mid laptop: 1080p60 risky, 4K not advised', () => {
    const r = judge(
      'lumora',
      desktop({ cpu: { name: 'Intel(R) Core(TM) i5-1135G7', cores: 4, threads: 8 }, memory: { totalMb: 16077, availableMb: 8000 }, gpus: [IRIS] }),
      browser({ renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)' }),
      plan,
    );
    expect(safety(r, '1080p60 streaming')).toBe('risky');
    expect(safety(r, '4K recording with a 1080p stream')).toBe('avoid');
  });
  it('16 GB: 4K60 is risky, 4K30 with a 1080p stream is safe', () => {
    const r = judge('lumora', desktop({ memory: { totalMb: 16077, availableMb: 9000 } }), browser(), plan);
    expect(safety(r, '4K60 recording')).toBe('risky');
    expect(safety(r, '4K recording with a 1080p stream')).toBe('safe');
  });
});

describe('the thresholds table', () => {
  it('has words for every verdict and settings that end with a catch-all', () => {
    for (const p of Object.values(PROFILES)) {
      expect(Object.keys(p.words).sort()).toEqual(['no', 'risky', 'yes']);
      expect(p.settings[p.settings.length - 1]!.need).toEqual([0, 0, 0]);
    }
    for (const list of Object.values(FEATURES)) for (const f of list) expect(f.safe.every((n, i) => n >= f.risky[i]!)).toBe(true);
  });
  it('details fit in a problem report', () => {
    const r = judge('lumora', desktop(), browser(), plan);
    const text = detailsText(r, desktop(), browser(), '1.2.3');
    expect(text.startsWith('System check: YES — Yes — ready for live events\nLumora 1.2.3')).toBe(true);
    expect(text).toContain('[Good] Graphics: NVIDIA GeForce RTX 3060');
    expect(text.length).toBeLessThanOrEqual(3800);
  });
});
