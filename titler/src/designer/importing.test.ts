// Import tells a Lottie file, a template pack and a .lumtitle file apart.

import { describe, expect, it } from 'vitest';
import { readImport } from './importing';
import { toLottie } from '../core/lottieExport';
import { writePack } from '../core/titlePack';
import { starterTemplates } from '../core/templates';

const enc = (s: string) => new TextEncoder().encode(s);

describe('import', () => {
  it('opens a Lottie animation as a title, with notes', async () => {
    const t = starterTemplates()[0]!;
    const got = await readImport('lower.json', enc(JSON.stringify(toLottie(t).json)));
    expect(got.kind).toBe('project');
    if (got.kind === 'project') {
      expect(got.project.compositions[0]!.layers.length).toBeGreaterThan(0);
      expect(got.project.name).toBe(t.name);
    }
  });

  it('reads a template pack', async () => {
    const bytes = await writePack({ name: 'Look' }, starterTemplates().slice(0, 2));
    const got = await readImport('look.lumpack', bytes);
    expect(got.kind).toBe('pack');
    if (got.kind === 'pack') expect(got.pack.titles.length).toBe(2);
  });

  it('opens a .lumtitle file', async () => {
    const t = starterTemplates()[2]!;
    const got = await readImport('x.lumtitle', enc(JSON.stringify(t)));
    expect(got.kind === 'project' && got.project.name).toBe(t.name);
  });

  it('says plainly when a file is none of these', async () => {
    await expect(readImport('x.json', enc('not json'))).rejects.toThrow(/not a Lottie animation/);
    await expect(readImport('x.json', enc('{"a":1}'))).rejects.toThrow();
  });
});
