// Stream inputs (mirrors crates/engine/src/stream.rs).

const SCHEMES = ['srt://', 'rtmp://', 'rtmps://', 'rtsp://', 'rtsps://', 'http://', 'https://', 'udp://', 'rtp://'];

/** A stream address, or null if it isn't one. */
export function cleanStreamUrl(url: string): string | null {
  const t = url.trim();
  if (!t || t.length > 2000 || /\s/.test(t)) return null;
  const s = SCHEMES.find((x) => t.toLowerCase().startsWith(x));
  return s && t.length > s.length ? t : null;
}

/** A short name for a stream: its host (without any password). */
export function streamName(url: string): string {
  const rest = url.replace(/^[a-z]+:\/\//i, '');
  const host = rest.split('/')[0]!.split('@').pop()!;
  return host || 'Stream';
}
