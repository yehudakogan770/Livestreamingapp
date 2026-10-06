import { describe, expect, it } from 'vitest';
import { compareVersions, groupReports, versionsText, type StoredReport } from './group';

const r = (id: string, fingerprint: string, created_at: string, version: string, resolved = false): StoredReport => ({
  id,
  created_at,
  kind: 'error',
  app: 'lumora',
  version,
  os: 'Windows',
  message: `msg ${fingerprint}`,
  stack: '',
  logs: '',
  description: null,
  fingerprint,
  has_screenshot: false,
  resolved,
});

describe('the Lumora team’s list of problems', () => {
  const all = [
    r('1', 'a', '2026-10-01T10:00:00Z', '0.1.99'),
    r('2', 'b', '2026-10-02T10:00:00Z', '0.1.100'),
    r('3', 'a', '2026-10-03T10:00:00Z', '0.1.120'),
    r('4', 'a', '2026-10-03T11:00:00Z', '0.1.99'),
    r('5', 'c', '2026-10-04T10:00:00Z', '0.1.120', true),
  ];

  it('groups by problem, newest first, with counts and versions', () => {
    const g = groupReports(all, false);
    expect(g.map((x) => x.key)).toEqual(['a', 'b']);
    expect(g[0]).toMatchObject({ count: 3, versions: ['0.1.99', '0.1.120'], first: '2026-10-01T10:00:00Z', last: '2026-10-03T11:00:00Z', resolved: false });
    expect(g[0]!.items.map((x) => x.id)).toEqual(['4', '3', '1']);
  });

  it('hides resolved problems unless asked', () => {
    expect(groupReports(all, true).map((x) => x.key)).toEqual(['c', 'a', 'b']);
    expect(groupReports(all, true)[0]!.resolved).toBe(true);
  });

  it('orders and names versions like people read them', () => {
    expect(compareVersions('0.1.120', '0.1.99')).toBeGreaterThan(0);
    expect(['0.1.10', '0.1.9', '0.2.0'].sort(compareVersions)).toEqual(['0.1.9', '0.1.10', '0.2.0']);
    expect(versionsText(['0.1.9'])).toBe('0.1.9');
    expect(versionsText(['1', '2'])).toBe('1, 2');
    expect(versionsText(['1', '2', '3', '4'])).toBe('1 – 4 (4 versions)');
  });
});
