// Error reports leave the computer only after this has taken out anything
// personal: folders (a path becomes just its file name, so no user names),
// emails, stream keys, passwords, tokens and addresses. Over-cleaning is fine;
// leaking is not.

/** The longest any one piece of text in a report may be. */
export const LIMITS = { message: 1000, stack: 8000, line: 400, description: 4000 } as const;

const NAME_KEYS =
  'password|passwd|pwd|pass|passphrase|secret|token|access_token|refresh_token|id_token|api[_-]?key|apikey|auth|authorization|stream[_-]?key|streamkey|key|pin|streamid|session|cookie|signature|sig';

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // Addresses that carry a file's path inside them (asset protocol, file://).
  [/\b(?:asset:\/\/localhost|https?:\/\/asset\.localhost|file:\/\/\/?)\/?([^\s'"<>)]+)/gi, (_m, p: string) => `<file:${lastPart(safeDecode(p))}>`],
  // Streaming addresses: the server stays, the key (the rest) goes.
  [/\b((?:rtmps?|srt|rtsp|rist):\/\/[^\s/'"?]+)[^\s'"]*/gi, (_m, host: string) => `${host}/<hidden>`],
  // Sign-in headers.
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 <hidden>'],
  // key=value, "key": "value", key: value — for anything that sounds secret.
  [new RegExp(`(["']?\\b(?:${NAME_KEYS})["']?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;&}\\]]+)`, 'gi'), (_m, k: string) => `${k}<hidden>`],
  // Web tokens (JWT) and well-known key shapes.
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, '<token>'],
  [/\bsb_(?:publishable|secret)_[\w-]+/g, '<key>'],
  [/\blive_\d+_\w+/g, '<key>'],
  [/\bFB-\d+-\d+-[\w-]+/g, '<key>'],
  [/\b[a-z0-9]{4}(?:-[a-z0-9]{4}){3,4}\b/gi, '<key>'],
  // Emails.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>'],
  // Windows paths (C:\… or C:/…), and network shares (\\server\share\…).
  [/(?:\b[A-Za-z]:|\\\\[^\s\\/]+)[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*([^\\/:*?"<>|\r\n\s]*)/g, (_m, f: string) => f || '<folder>'],
  // Mac and Linux paths with two or more parts (not the end of a web address).
  [/(?<![\w:/.~-])~?(?:\/[^\s/'"<>:()]+){2,}\/?/g, (m: string) => lastPart(m) || '<folder>'],
  // Network addresses.
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>'],
  // Anything left that looks like a long random secret (32+ letters and digits, mixed).
  [/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{32,}\b/g, '<secret>'],
];

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function lastPart(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** Text with everything personal taken out, at most `max` characters. */
export function scrub(text: unknown, max: number = LIMITS.message): string {
  let s = typeof text === 'string' ? text : text instanceof Error ? `${text.name}: ${text.message}` : safeString(text);
  for (const [re, to] of RULES) s = s.replace(re, to as (substring: string, ...args: string[]) => string);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function safeString(v: unknown): string {
  if (v === undefined) return 'undefined';
  try {
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

/**
 * A short, stable name for an error, so the same problem from many people
 * groups together: numbers, quoted names and ids are taken out.
 */
export function fingerprint(app: string, message: string): string {
  const core = scrub(message, 300)
    .replace(/<[^>]+>/g, '_')
    .replace(/“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/g, '_')
    .replace(/[^\s()<>'"]+\.[a-z0-9]{2,5}\b/gi, '_')
    .replace(/\b[0-9a-f]{6,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${app}:${core.slice(0, 200)}`;
}
