// @vitest-environment node
// The installers people download must not carry the self-test: their screens
// are built without VITE_LUMORA_E2E, and the bundler drops everything behind
// `if (TEST_BUILD)`. This builds both programs' entry files the way the
// release does (only the self-test and e2e.ts are bundled; everything else is
// left out to keep it quick) and looks for the self-test in what comes out.

import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { build, type Plugin, type Rollup } from 'vite';
import { SELFTEST_MARK } from './runner';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRIES = { Lumora: `${repo}app/src/main.tsx`, 'Lumora Studio': `${repo}editor/app/src/main.tsx` };

/** Bundles only the entry, e2e.ts and the self-test; everything else stays an import. */
function onlyTheSelfTest(entry: string): Plugin {
  const keep = (id: string) => id === entry || /[\\/]e2e\.ts$|[\\/]selftest([\\/]|\.ts$)/.test(id);
  return {
    name: 'only-the-selftest',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r || r.external) return { id: source, external: true };
      return keep(r.id.split('?')[0] ?? r.id) ? r : { id: source, external: true };
    },
  };
}

async function bundle(entry: string, testBuild: boolean): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    root: repo,
    envDir: false,
    mode: 'production',
    define: testBuild ? { 'import.meta.env.VITE_LUMORA_E2E': JSON.stringify('1') } : {},
    plugins: [onlyTheSelfTest(entry)],
    build: { write: false, minify: false, target: 'es2022', rollupOptions: { input: entry } },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
  return outputs
    .flatMap((o) => o.output)
    .map((c) => (c.type === 'chunk' ? c.code : ''))
    .join('\n');
}

describe('the shipped programs have no self-test', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.VITE_LUMORA_E2E;
    delete process.env.VITE_LUMORA_E2E;
  });
  afterEach(() => {
    if (saved !== undefined) process.env.VITE_LUMORA_E2E = saved;
  });

  for (const [product, entry] of Object.entries(ENTRIES)) {
    it(`${product}: left out of the shipped screens, there in the test build`, async () => {
      const shipped = await bundle(entry, false);
      expect(shipped).not.toContain(SELFTEST_MARK);
      expect(shipped).not.toContain('selftest_finish');
      expect(shipped).not.toMatch(/selftest/i);
      const test = await bundle(entry, true);
      expect(test).toContain(SELFTEST_MARK);
      expect(test).toContain('selftest_finish');
    }, 60_000);
  }
});
