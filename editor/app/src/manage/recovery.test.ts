// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { backupName, backupsOf, hashText, markerName, parseBackup, parseMarker, projectKey, recoverable, shouldBackup, toPrune, type Marker } from './recovery';

const DAY = 86_400_000;

describe('autosave and backups', () => {
  it('names files by project, and reads them back', () => {
    const k = projectKey('C:\\Films\\Gala.lumoraedit', 's1');
    expect(k).toMatch(/^p[a-z0-9]+$/);
    // The same file, however its letters are cased, is the same project.
    expect(projectKey('c:\\films\\gala.lumoraedit', 's2')).toBe(k);
    expect(projectKey('', 'ab-12')).toBe('uab12');
    expect(hashText('a')).not.toBe(hashText('b'));
    expect(parseBackup(backupName(k, 1700000000000))).toEqual({ name: `${k}--1700000000000.lumoraedit`, key: k, at: 1700000000000 });
    expect(parseBackup(markerName(k))).toBeNull();
    expect(parseBackup('../x--1.lumoraedit')).toBeNull();
  });

  it('autosaves when something changed and the time has come', () => {
    expect(shouldBackup(3, 2, 0, 60_000)).toBe(true);
    expect(shouldBackup(3, 3, 0, 120_000)).toBe(false);
    expect(shouldBackup(4, 3, 50_000, 60_000)).toBe(false);
  });

  it('keeps the newest backups of a project, and clears away old ones of others', () => {
    const now = 100 * DAY;
    const entries = [1, 2, 3, 4, 5].map((i) => ({ name: backupName('pa', now - i * 1000) }));
    entries.push({ name: backupName('pb', now - 40 * DAY) }, { name: backupName('pc', now - 2 * DAY) }, { name: markerName('pa') });
    expect(backupsOf(entries, 'pa').map((b) => b.at)).toEqual([1, 2, 3, 4, 5].map((i) => now - i * 1000));
    const gone = toPrune(entries, 'pa', 3, now);
    expect(gone).toEqual([backupName('pa', now - 4000), backupName('pa', now - 5000), backupName('pb', now - 40 * DAY)]);
    expect(toPrune(entries, 'pa', 10, now)).toEqual([backupName('pb', now - 40 * DAY)]);
  });
});

describe('crash recovery', () => {
  const marker = (over: Partial<Marker>): Marker => ({ key: 'pa', name: 'Gala', path: '/f/Gala.lumoraedit', session: 'old', backupAt: 0, savedAt: 0, ...over });

  it('offers autosaves newer than the last save, from runs that are gone', () => {
    const entries = [{ name: backupName('pa', 5000) }, { name: backupName('pa', 9000) }, { name: backupName('ub', 7000) }];
    const found = recoverable([marker({ savedAt: 8000 }), marker({ key: 'ub', name: 'Untitled', path: '' })], entries, 'now');
    expect(found.map((r) => [r.marker.key, r.backup.at])).toEqual([
      ['pa', 9000],
      ['ub', 7000],
    ]);
  });

  it('says nothing when the project file is as new, the run is this one, or there is no autosave', () => {
    const entries = [{ name: backupName('pa', 5000) }];
    expect(recoverable([marker({ savedAt: 5000 })], entries, 'now')).toEqual([]);
    expect(recoverable([marker({ session: 'now' })], entries, 'now')).toEqual([]);
    expect(recoverable([marker({ key: 'pz' })], entries, 'now')).toEqual([]);
  });

  it('reads markers, and refuses broken ones', () => {
    expect(parseMarker(JSON.stringify(marker({ savedAt: 3 })))?.savedAt).toBe(3);
    expect(parseMarker('{"name":"x"}')).toBeNull();
    expect(parseMarker('not json')).toBeNull();
  });
});
