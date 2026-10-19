import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = process.argv[2];
const out = process.argv[3];
const require = createRequire(join(root, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('rolldown')).href);
await build({ input: join(root, 'src', 'assets.ts'), platform: 'node', logLevel: 'warn', output: { file: join(out, 'assets.mjs'), format: 'esm' } });
const { assetFiles } = await import(pathToFileURL(join(out, 'assets.mjs')).href);
for (const [path, text] of Object.entries(assetFiles())) {
  const file = join(root, 'com.lumora.streamdeck.sdPlugin', path);
  const same = existsSync(file) && readFileSync(file, 'utf8') === text;
  if (!same) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log('wrote', path);
  }
}
