import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const out = process.argv[3];
const require = createRequire(join(root, '..', 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('rolldown')).href);
await build({ input: join(root, 'src', 'assets.ts'), platform: 'node', logLevel: 'warn', output: { file: out, format: 'esm' } });
const { assetFiles } = await import(pathToFileURL(out).href);
for (const [p, t] of Object.entries(assetFiles())) {
  const f = join(root, 'com.lumora.streamdeck.sdPlugin', p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, t);
}
console.log('ok');
