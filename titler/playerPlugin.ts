// `import runtime from 'virtual:titler-player'`: the Titler player
// (titler/src/player/runtime.ts) built into one small script, as text, for
// the HTML / OGraf template export. Used by every build that has the
// designer in it (the Titler, Lumora, Studio) and by the tests.

import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const ID = 'virtual:titler-player';
const RESOLVED = '\0' + ID;

export async function buildPlayer(): Promise<string> {
  const { build } = await import('rolldown');
  const out = await build({
    input: fileURLToPath(new URL('./src/player/runtime.ts', import.meta.url)),
    write: false,
    platform: 'browser',
    logLevel: 'warn',
    output: { format: 'iife', name: 'LumoraTitleRuntimeModule', minify: true },
  });
  return out.output[0].code;
}

export function titlerPlayer(): Plugin {
  let code: Promise<string> | null = null;
  return {
    name: 'titler-player',
    resolveId(id) {
      return id === ID ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      code ??= buildPlayer();
      return `export default ${JSON.stringify(await code)};`;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.includes('/titler/src/')) code = null;
    },
  };
}
