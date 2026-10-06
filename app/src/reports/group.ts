// The Lumora team's view of reports: the same problem from many computers
// becomes one line, with how often, which versions, and when last.

import type { AppName, ReportKind } from './queue';

/** A report as the team reads it back (the picture is fetched only when opened). */
export interface StoredReport {
  id: string;
  created_at: string;
  kind: ReportKind;
  app: AppName;
  version: string;
  os: string;
  message: string;
  stack: string;
  logs: string;
  description: string | null;
  fingerprint: string;
  has_screenshot: boolean;
  resolved: boolean;
}

export interface ReportGroup {
  key: string;
  app: AppName;
  kind: ReportKind;
  message: string;
  count: number;
  versions: string[];
  first: string;
  last: string;
  /** Every report in it is marked resolved. */
  resolved: boolean;
  /** Newest first. */
  items: StoredReport[];
}

/** Compares version numbers like 0.1.120 and 0.1.99 as numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (d) return d;
  }
  return 0;
}

/**
 * Reports grouped by problem, the most recent problem first. With
 * `showResolved` false, resolved reports are left out (and so are groups with
 * nothing else in them).
 */
export function groupReports(reports: StoredReport[], showResolved: boolean): ReportGroup[] {
  const groups = new Map<string, ReportGroup>();
  const sorted = [...reports].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const r of sorted) {
    if (!showResolved && r.resolved) continue;
    const key = r.fingerprint || `${r.app}:${r.message}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, app: r.app, kind: r.kind, message: r.message, count: 0, versions: [], first: r.created_at, last: r.created_at, resolved: true, items: [] };
      groups.set(key, g);
    }
    g.count++;
    g.items.push(r);
    g.first = r.created_at;
    if (!g.versions.includes(r.version)) g.versions.push(r.version);
    if (!r.resolved) g.resolved = false;
  }
  for (const g of groups.values()) g.versions.sort(compareVersions);
  return [...groups.values()].sort((a, b) => b.last.localeCompare(a.last));
}

/** "0.1.80 – 0.1.95 (4 versions)", or the one version. */
export function versionsText(v: string[]): string {
  if (v.length <= 1) return v[0] ?? '';
  return v.length <= 3 ? v.join(', ') : `${v[0]} – ${v[v.length - 1]} (${v.length} versions)`;
}
