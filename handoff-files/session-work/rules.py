p='/home/user/Livestreamingapp/.claude/worktrees/agent-aa01ea85ebaf42c39/app/src/syscheck/rules.ts'
s=open(p).read()
def rep(a,b):
    global s
    assert a in s, a
    s=s.replace(a,b,1)
rep("""  /** Cameras recorded on their own (when iso). */
  cameras: number;
}""","""  /** Cameras recorded on their own (when iso). */
  cameras: number;
  /** Bitrate of each camera's own file (missing: the same as the recording). */
  isoKbps?: number;
}""")
rep("""  /** The best settings this computer can run, first match wins. */
  settings: { need: Need; text: string }[];
}""","""  /** The best settings this computer can run, first match wins (`hw`: only with a graphics-card encoder that works). */
  settings: { need: Need; text: string; hw?: boolean }[];
}""")
rep("""    settings: [
      { need: [3, 2, 16], text: 'Stream and record at 1080p30 (1080p60 is fine too)' },""","""    settings: [
      { need: [3, 3, 16], hw: true, text: 'Record in 4K and stream at 1080p60 at the same time (the graphics card does the encoding)' },
      { need: [3, 2, 16], text: 'Stream and record at 1080p30 (1080p60 is fine too)' },""")
rep("""/** What can be used at an event (or an edit) on this computer: [safe from, risky from]. */
export const FEATURES: Record<AppId, { name: string; safe: Need; risky: Need; notes: Record<Safety, string> }[]> = {
  lumora: [""","""/**
 * What can be used at an event (or an edit) on this computer: [safe from, risky from].
 * `hw`: a graphics-card encoder is needed (none: avoid) or helps (none: risky at best).
 */
export const FEATURES: Record<AppId, { name: string; safe: Need; risky: Need; hw?: 'needed' | 'helps'; notes: Record<Safety, string> }[]> = {
  lumora: [
    {
      name: '1080p60 streaming',
      safe: [3, 2, 16],
      risky: [2, 2, 8],
      hw: 'helps',
      notes: {
        safe: 'Fine.',
        risky: 'Try it in a Rehearsal and watch the frame rate; drop to 1080p30 if frames are missed.',
        avoid: 'Stay at 1080p30 or 720p.',
      },
    },
    {
      name: '4K recording with a 1080p stream',
      safe: [3, 3, 16],
      risky: [3, 2, 16],
      hw: 'needed',
      notes: {
        safe: 'Fine: the picture is drawn once in 4K and the graphics card makes the 1080p stream.',
        risky: 'Try it in a Rehearsal first; keep effects and web page inputs few.',
        avoid: 'Record at 1080p (4K needs a strong graphics card with a working encoder).',
      },
    },
    {
      name: '4K60 recording',
      safe: [3, 3, 32],
      risky: [3, 3, 16],
      hw: 'needed',
      notes: {
        safe: 'Fine on this computer; run a Rehearsal with the full show first.',
        risky: 'Only with a simple show; 4K30 is safer.',
        avoid: 'Use 4K30 or 1080p60.',
      },
    },""")
rep("""/** Hours of recording that fit in `freeMb` (main recording plus each camera on its own). */
export function recordingHours(freeMb: number, plan: RecordingPlan): number {
  const files = 1 + (plan.iso ? Math.max(0, plan.cameras) : 0);
  const mbPerHour = ((plan.videoKbps + plan.audioKbps) * 3600 * files) / 8 / 1000;""","""/** Hours of recording that fit in `freeMb` (main recording plus each camera on its own). */
export function recordingHours(freeMb: number, plan: RecordingPlan): number {
  const main = plan.videoKbps + plan.audioKbps;
  const camera = plan.isoKbps ?? main;
  const kbps = main + (plan.iso ? Math.max(0, plan.cameras) * camera : 0);
  const mbPerHour = (kbps * 3600) / 8 / 1000;""")
rep("""    if (app === 'lumora') {
      checks.push(
        check('video', 'Hardware video', value, 'info', enc.length ? '' : 'Lumora compresses video on the processor, so the processor matters most.'),
      );""","""    if (app === 'lumora') {
      checks.push(
        check(
          'video',
          'Hardware video',
          value,
          'info',
          enc.length
            ? `Streams and re-encoded recordings use ${encoderFamily(enc).split(', ')[0]} (Settings → Recording and streaming → Encoder: Automatic).`
            : 'No graphics-card encoder works here: the processor does the encoding, so keep to 1080p and avoid 4K.',
        ),
      );""")
rep("""  // What is safe to use here.
  const features: Feature[] = FEATURES[app].map((x) => {
    const safety: Safety = meets(x.safe, cpu, gpu, ram) ? 'safe' : meets(x.risky, cpu, gpu, ram) ? 'risky' : 'avoid';
    return { name: x.name, safety, note: x.notes[safety] };
  });""","""  // What is safe to use here.
  const hw = f.hwEncoders.length > 0;
  const features: Feature[] = FEATURES[app].map((x) => {
    let safety: Safety = meets(x.safe, cpu, gpu, ram) ? 'safe' : meets(x.risky, cpu, gpu, ram) ? 'risky' : 'avoid';
    if (!hw && x.hw === 'needed') safety = 'avoid';
    if (!hw && x.hw === 'helps' && safety === 'safe') safety = 'risky';
    return { name: x.name, safety, note: x.notes[safety] };
  });""")
rep("""  const best = p.settings.find((s) => meets(s.need, cpu, gpu, ram)) ?? p.settings[p.settings.length - 1]!;""","""  const best = p.settings.find((s) => (!s.hw || hw) && meets(s.need, cpu, gpu, ram)) ?? p.settings[p.settings.length - 1]!;""")
open(p,'w').write(s)

p='/home/user/Livestreamingapp/.claude/worktrees/agent-aa01ea85ebaf42c39/app/src/syscheck/SystemCheck.tsx'
s=open(p).read()
rep("""      const s = await invoke<{ videoKbps: number; audioKbps: number; iso: boolean }>('capture_settings');
      plan = { videoKbps: s.videoKbps, audioKbps: s.audioKbps, iso: s.iso, cameras: browser.cameras ?? 1 };""","""      const s = await invoke<{ videoKbps: number; audioKbps: number; iso: boolean; isoKbps?: number }>('capture_settings');
      plan = { videoKbps: s.videoKbps, audioKbps: s.audioKbps, iso: s.iso, cameras: browser.cameras ?? 1, isoKbps: s.isoKbps };""")
open(p,'w').write(s)

p='/home/user/Livestreamingapp/.claude/worktrees/agent-aa01ea85ebaf42c39/app/src/syscheck/rules.test.ts'
s=open(p).read()
rep("""    expect(r.tips[0]).toEqual({ kind: 'do', text: 'Stream and record at 1080p30 (1080p60 is fine too).', weight: 100 });
    expect(r.features.every((f) => f.safety === 'safe')).toBe(true);""","""    expect(r.tips[0]).toEqual({
      kind: 'do',
      text: 'Record in 4K and stream at 1080p60 at the same time (the graphics card does the encoding).',
      weight: 100,
    });
    expect(r.features.every((f) => f.safety === 'safe')).toBe(true);
    expect(byId(r.checks, 'video').advice).toMatch(/^Streams and re-encoded recordings use NVENC/);""")
rep("""    expect(hoursText(0.7)).toBe('≈ 40 min');""","""    // Camera files at their own bitrate: 6160 + 2 × 8000 kbps ≈ 10 GB an hour.
    expect(recordingHours(100 * 1024, { ...plan, isoKbps: 8000 })).toBeCloseTo(9.4, 1);
    expect(hoursText(0.7)).toBe('≈ 40 min');""")
rep("""describe('the thresholds table', () => {""","""describe('4K and 60 frames a second', () => {
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

describe('the thresholds table', () => {""")
open(p,'w').write(s)
