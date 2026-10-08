// Stream inputs (mirrors crates/engine/src/stream.rs).

const SCHEMES = ['srt://', 'rtmp://', 'rtmps://', 'rtsp://', 'rtsps://', 'http://', 'https://', 'udp://', 'rtp://', 'ndi://', 'decklink://'];

/** A stream address, or null if it isn't one. */
export function cleanStreamUrl(url: string): string | null {
  const t = url.trim();
  // NDI and capture card names have spaces; other addresses never do.
  const named = /^(ndi|decklink):\/\//i.test(t);
  if (!t || t.length > 2000 || (!named && /\s/.test(t)) || /[\u0000-\u001f]/.test(t)) return null;
  const s = SCHEMES.find((x) => t.toLowerCase().startsWith(x));
  return s && t.length > s.length ? t : null;
}

/** A short name for a stream: its host (without any password). */
export function streamName(url: string): string {
  // An NDI source: the part in brackets ("PC (Camera 1)" → "Camera 1").
  if (/^ndi:\/\//i.test(url)) return /\(([^)]+)\)\s*$/.exec(url)?.[1] ?? url.slice(6);
  // A capture card: its name ("DeckLink Duo (1)"), and the connector when chosen.
  if (/^decklink:\/\//i.test(url)) {
    const [name, query = ''] = url.slice(11).split('?');
    const input = /(?:^|&)input=([a-z]+)/i.exec(query)?.[1];
    return input ? `${name ?? ''} ${input.toUpperCase()}` : name || 'Capture card';
  }
  const rest = url.replace(/^[a-z]+:\/\//i, '');
  const host = rest.split('/')[0]!.split('@').pop()!;
  return host || 'Stream';
}
