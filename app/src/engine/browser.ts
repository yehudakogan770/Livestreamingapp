import type { BrowserInput } from './types/BrowserInput';

/** Mirrors BrowserInput::default. */
export function defaultBrowser(): BrowserInput {
  return { url: 'https://', width: 1280, height: 720, zoom: 100, transparent: false, refreshMin: 0, viewOnly: false, reload: 0 };
}

/** Mirrors browser::clean_url: `example.com` → `https://example.com`; null if not a web address. */
export function cleanUrl(url: string): string | null {
  const t = url.trim();
  if (!t || t.length > 2000 || /\s/.test(t)) return null;
  const lower = t.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('file:///')) return t.slice(t.indexOf('://') + 3) ? t : null;
  if (lower.includes('://') || lower.startsWith('javascript:') || lower.startsWith('data:')) return null;
  return `https://${t}`;
}

/** Where the app serves web pages' and stream inputs' pictures and sound (on this computer only), and the key it asks for. */
export interface BrowserInfo {
  port: number | null;
  captured: boolean;
  /** Only Lumora's own windows know it, so other programs and web pages can't watch or listen. */
  key?: string;
}

/** A picture or sound the app serves: `path` like `stream/<id>`. */
export function servedUrl(info: BrowserInfo, path: string, query = ''): string | null {
  if (!info.port) return null;
  return `http://127.0.0.1:${info.port}/${path}?k=${encodeURIComponent(info.key ?? '')}${query ? `&${query}` : ''}`;
}

let info: Promise<BrowserInfo> | null = null;
/** Where frames come from (asked once per window). */
export function browserInfo(get: () => Promise<BrowserInfo>) {
  info ??= get().catch(() => ({ port: null, captured: false }));
  return info;
}
