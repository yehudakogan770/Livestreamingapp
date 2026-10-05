// Cameras: one stream per device, shared by every view in this window (the
// screens and the recorder), and stopped when nothing uses it any more.

const cameras = new Map<string, { stream: Promise<MediaStream>; users: number }>();

/**
 * Cameras opened at their full resolution (up to 4K) because something
 * zooms into them (auto-framing), by who asked: device → holders.
 */
const fullRes = new Map<string, Set<string>>();
const size = (deviceId: string) =>
  fullRes.get(deviceId)?.size ? { width: { ideal: 3840 }, height: { ideal: 2160 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };

/**
 * Ask for a camera at full resolution (so a zoomed-in shot stays sharp), or
 * stop asking. `holder` says who asks; the camera stays at full resolution
 * while anyone does. Safe to call every frame.
 */
export function fullResolution(holder: string, deviceId: string, on: boolean): void {
  const set = fullRes.get(deviceId) ?? new Set<string>();
  const before = set.size > 0;
  if (on) set.add(holder);
  else set.delete(holder);
  if (set.size) fullRes.set(deviceId, set);
  else fullRes.delete(deviceId);
  if (before === set.size > 0) return;
  // Change an open camera without closing it (it keeps showing meanwhile).
  void cameras.get(deviceId)?.stream.then(
    (st) => st.getVideoTracks().forEach((t) => void t.applyConstraints({ ...t.getConstraints(), ...size(deviceId) }).catch(() => {})),
    () => {},
  );
}

/** Why each camera last failed to open, in plain words. */
const problems = new Map<string, string>();
export const cameraProblem = (deviceId: string): string | null => problems.get(deviceId) ?? null;

function explain(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return 'The camera is being used by another program (Zoom, Teams, the Camera app…). Close it; Lumora tries again by itself.';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Lumora is not allowed to use the camera. In Windows: Settings → Privacy & security → Camera, turn on camera access for desktop apps.';
  return 'Camera not found or unplugged';
}

/** Open a camera, asking for less each time it is refused (some cameras refuse big sizes or high frame rates). */
async function open(deviceId: string): Promise<MediaStream> {
  const id = deviceId ? { deviceId: { exact: deviceId } } : {};
  const full: MediaTrackConstraints = { ...id, ...size(deviceId), frameRate: { ideal: 60 } };
  const tries: MediaTrackConstraints[] = [
    // Pan, tilt and zoom too (cameras that can move); refused on most webcams.
    { ...full, pan: true, tilt: true, zoom: true } as MediaTrackConstraints,
    full,
    { ...id, width: { ideal: 1280 }, height: { ideal: 720 } },
    id,
  ];
  let last: unknown = null;
  for (const video of tries) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (e) {
      last = e;
      // Busy or not allowed: asking for less won't help.
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'NotReadableError')) break;
    }
  }
  // The camera's id can change (another USB port, a Windows update): find it by its name.
  if (deviceId) {
    const label = labels.get(deviceId);
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const same = devices.find((d) => d.kind === 'videoinput' && label && d.label === label && d.deviceId !== deviceId);
    if (same) return navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: same.deviceId } } });
  }
  throw last ?? new Error('Camera not found');
}

/** A camera's name, so it can be found again if its id changes. */
const labels = new Map<string, string>();
export function rememberCameraName(deviceId: string, label: string) {
  if (label) labels.set(deviceId, label);
}

/** A camera's stream; call releaseCamera when done with it. */
export function acquireCamera(deviceId: string): Promise<MediaStream> {
  let entry = cameras.get(deviceId);
  if (!entry) {
    const stream = open(deviceId).then((st) => {
      problems.delete(deviceId);
      // Unplugged: forget it, so the next try opens it afresh.
      for (const t of st.getVideoTracks())
        t.addEventListener('ended', () => {
          if (cameras.get(deviceId)?.stream === stream) cameras.delete(deviceId);
        });
      const want = wanted.get(deviceId);
      if (want) void applyValues(st, want);
      return st;
    });
    entry = { stream, users: 0 };
    cameras.set(deviceId, entry);
    stream.catch((e: unknown) => {
      problems.set(deviceId, explain(e));
      cameras.delete(deviceId);
    });
  }
  entry.users++;
  return entry.stream;
}

export function releaseCamera(deviceId: string) {
  const entry = cameras.get(deviceId);
  if (!entry) return;
  entry.users--;
  if (entry.users <= 0) {
    cameras.delete(deviceId);
    void entry.stream.then(
      (s) => s.getTracks().forEach((t) => t.stop()),
      () => {},
    );
  }
}

// ----- a camera's own settings (zoom, focus, exposure, white balance, pan, tilt…) -----

/** The settings Lumora can change, in the order shown. Modes: 1 automatic, 0 manual. */
export const CAMERA_SETTINGS: { name: string; label: string; mode?: string; group: 'picture' | 'move' }[] = [
  { name: 'zoom', label: 'Zoom', group: 'move' },
  { name: 'pan', label: 'Pan (left / right)', group: 'move' },
  { name: 'tilt', label: 'Tilt (up / down)', group: 'move' },
  { name: 'focusMode', label: 'Focus by itself', mode: 'focusDistance', group: 'picture' },
  { name: 'focusDistance', label: 'Focus', group: 'picture' },
  { name: 'exposureMode', label: 'Light by itself', mode: 'exposureTime', group: 'picture' },
  { name: 'exposureTime', label: 'Exposure', group: 'picture' },
  { name: 'exposureCompensation', label: 'Brighter / darker', group: 'picture' },
  { name: 'whiteBalanceMode', label: 'Color by itself', mode: 'colorTemperature', group: 'picture' },
  { name: 'colorTemperature', label: 'Warm / cool', group: 'picture' },
  { name: 'brightness', label: 'Brightness', group: 'picture' },
  { name: 'contrast', label: 'Contrast', group: 'picture' },
  { name: 'saturation', label: 'Color strength', group: 'picture' },
  { name: 'sharpness', label: 'Sharpness', group: 'picture' },
];

export type CameraValues = { name: string; value: number }[];

/** What each camera should be set to, applied again whenever it opens. */
const wanted = new Map<string, CameraValues>();

type Caps = Record<string, { min?: number; max?: number; step?: number } | string[] | undefined>;

async function applyValues(stream: MediaStream, values: CameraValues): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities() as unknown as Caps;
  const set: Record<string, number | string> = {};
  for (const { name, value } of values) {
    const cap = caps[name];
    if (!cap) continue;
    if (Array.isArray(cap)) {
      // A mode: automatic ("continuous") or manual.
      const mode = value >= 1 ? 'continuous' : 'manual';
      if (cap.includes(mode)) set[name] = mode;
    } else set[name] = Math.min(cap.max ?? value, Math.max(cap.min ?? value, value));
  }
  if (Object.keys(set).length) await track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] }).catch(() => {});
}

/** Set a camera's settings (in this window); remembered for when it opens again. */
export function setCameraValues(deviceId: string, values: CameraValues): void {
  const key = JSON.stringify(values);
  if (JSON.stringify(wanted.get(deviceId) ?? []) === key) return;
  wanted.set(deviceId, values);
  const entry = cameras.get(deviceId);
  if (entry)
    void entry.stream.then(
      (st) => applyValues(st, values),
      () => {},
    );
}

/** One setting the camera offers: a range, or a choice of automatic / manual. */
export interface CameraSetting {
  name: string;
  label: string;
  group: 'picture' | 'move';
  mode?: string;
  min: number;
  max: number;
  step: number;
  /** A mode (automatic / manual). */
  toggle: boolean;
  /** What it is now. */
  now: number;
}

/** The settings this camera offers, with what they are now (none if it can't say). */
export async function cameraSettings(deviceId: string): Promise<CameraSetting[]> {
  const st = await acquireCamera(deviceId).catch(() => null);
  if (!st) return [];
  try {
    const track = st.getVideoTracks()[0];
    if (!track?.getCapabilities) return [];
    const caps = track.getCapabilities() as unknown as Caps;
    const now = (track.getSettings?.() ?? {}) as unknown as Record<string, number | string | undefined>;
    const out: CameraSetting[] = [];
    for (const s of CAMERA_SETTINGS) {
      const cap = caps[s.name];
      if (!cap) continue;
      if (Array.isArray(cap)) {
        if (cap.includes('continuous') && cap.includes('manual'))
          out.push({ ...s, min: 0, max: 1, step: 1, toggle: true, now: now[s.name] === 'manual' ? 0 : 1 });
      } else if (cap.min !== undefined && cap.max !== undefined && cap.max > cap.min) {
        const v = now[s.name];
        out.push({ ...s, min: cap.min, max: cap.max, step: cap.step || (cap.max - cap.min) / 100, toggle: false, now: typeof v === 'number' ? v : cap.min });
      }
    }
    return out;
  } finally {
    releaseCamera(deviceId);
  }
}
