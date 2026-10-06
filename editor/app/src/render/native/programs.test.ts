// The native engine's tests translate the app's real shaders; they read them
// from a copy kept beside the engine. This checks the copy is current
// (UPDATE_SHADERS=1 npx vitest run programs writes it again).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativePrograms } from './programs';

const FIXTURE = resolve(__dirname, '../../../../../crates/studio-engine/tests/programs.json');

describe('native programs', () => {
  it('names each program once', () => {
    const names = nativePrograms().map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ['layer', 'copy', 'final', 'composite', 'transition', 'grade', 'gradeadd', 'blur', 'lut', 'chromakey', 'cutout', 'limit'])
      expect(names).toContain(n);
  });

  it("matches the engine's copy of the shaders", () => {
    const now = `${JSON.stringify(nativePrograms(), null, 1)}\n`;
    if (process.env.UPDATE_SHADERS) writeFileSync(FIXTURE, now);
    expect(readFileSync(FIXTURE, 'utf8'), 'shaders changed: run UPDATE_SHADERS=1 npx vitest run programs').toBe(now);
  });
});
