// Stream inputs (mirrors crates/engine/src/stream.rs).

const SCHEMES = ['srt://', 'rtmp://', 'rtmps://', 'rtsp://', 'rtsps://', 'http://', 'https://', 'udp://', 'rtp://', 'ndi://'];

/** A stream address, or null if it isn't one. */
export function cleanStreamUrl(url: string): string | null {
  const t = url.trim();
  // NDI names have spaces; other addresses never do.
  const ndi = t.toLowerCase().startsWith('ndi://');
  if (!t || t.length > 2000 || (!ndi && /\s/.test(t)) || /[\u0000-\u001f]/.test(t)) return null;
  const s = SCHEMES.find((x) => t.toLowerCase().startsWith(x));
  return s && t.length > s.length ? t : null;
}

/** A short name for a stream: its host (without any password). */
export function streamName(url: string): string {
  // An NDI source: the part in brackets ("PC (Camera 1)" → "Camera 1").
  if (/^ndi:\/\//i.test(url)) return /\(([^)]+)\)\s*$/.exec(url)?.[1] ?? url.slice(6);
  const rest = url.replace(/^[a-z]+:\/\//i, '');
  const host = rest.split('/')[0]!.split('@').pop()!;
  return host || 'Stream';
}
