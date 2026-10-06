import { execSync } from 'node:child_process';
import { expect, test } from 'vitest';

// Windows treats names that differ only in capitals as the same file, so the build there picks the wrong one.
test('no two files in the repository differ only in capitals', () => {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const f of files) {
    const key = f.toLowerCase().replace(/\.(tsx?|jsx?)$/, '');
    const other = seen.get(key);
    if (other && other !== f) clashes.push(`${other} / ${f}`);
    seen.set(key, f);
  }
  expect(clashes).toEqual([]);
});
