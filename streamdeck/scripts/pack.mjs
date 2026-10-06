// Builds the Stream Deck plugin and packs it for installing:
//
//   npm run streamdeck:pack            → streamdeck/dist/com.lumora.streamdeck.streamDeckPlugin
//   npm run streamdeck:pack -- --app src-tauri/tauri.conf.json
//                                      → the same, and Lumora's installer carries it
//
// Steps: install the plugin's packages (first time), type-check, draw the
// icons, bundle src/plugin.ts into bin/plugin.js, then ZIP the .sdPlugin
// folder (a .streamDeckPlugin file is a ZIP; double-clicking it installs it).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zip } from './zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'com.lumora.streamdeck';
const pluginDir = join(root, `${ID}.sdPlugin`);
const dist = join(root, 'dist');
const out = join(dist, `${ID}.streamDeckPlugin`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function step(text) {
  console.log(`streamdeck: ${text}`);
}

// 1. The plugin's own packages (Elgato's SDK).
if (!existsSync(join(root, 'node_modules', '@elgato', 'streamdeck'))) {
  step('installing packages');
  execFileSync(npm, ['ci', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}
// Build tools come from here, or from Lumora's own packages one folder up.
const require = createRequire(join(root, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('rolldown')).href);

// 2. Type check.
step('type check');
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });

// 3. The pictures (from src/icons.ts and src/keys.ts).
const temp = join(dist, '.build');
rmSync(temp, { recursive: true, force: true });
mkdirSync(temp, { recursive: true });
await build({ input: join(root, 'src', 'assets.ts'), platform: 'node', logLevel: 'warn', output: { file: join(temp, 'assets.mjs'), format: 'esm' } });
const { assetFiles } = await import(pathToFileURL(join(temp, 'assets.mjs')).href);
const assets = assetFiles();
for (const [path, text] of Object.entries(assets)) {
  const file = join(pluginDir, path);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
}
step(`${Object.keys(assets).length} pictures`);

// 4. The plugin itself: one file Stream Deck runs with its own Node.js.
const bin = join(pluginDir, 'bin');
rmSync(bin, { recursive: true, force: true });
await build({
  input: join(root, 'src', 'plugin.ts'),
  platform: 'node',
  logLevel: 'warn',
  // Optional speed-ups the WebSocket library tries to load; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  output: { file: join(bin, 'plugin.js'), format: 'esm', minify: true },
});
writeFileSync(join(bin, 'package.json'), '{ "type": "module" }\n');
rmSync(temp, { recursive: true, force: true });

// 5. Pack.
function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}
// Logs from trying the plugin out here are not part of it.
const files = walk(pluginDir)
  .filter((p) => !relative(pluginDir, p).startsWith('logs'))
  .map((p) => ({ name: `${ID}.sdPlugin/${relative(pluginDir, p).split(sep).join('/')}`, data: readFileSync(p) }));
mkdirSync(dist, { recursive: true });
writeFileSync(out, zip(files));
const manifest = JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf8'));
step(`packed version ${manifest.Version}: ${relative(process.cwd(), out)} (${Math.round(statSync(out).size / 1024)} KB, ${files.length} files)`);

// 6. Inside Lumora's installer (CI, before `tauri build`).
const app = process.argv.indexOf('--app');
if (app >= 0) {
  const conf = resolve(process.argv[app + 1] ?? 'src-tauri/tauri.conf.json');
  const c = JSON.parse(readFileSync(conf, 'utf8'));
  const from = (p) => relative(dirname(conf), p).split(sep).join('/');
  c.bundle.resources = {
    ...(Array.isArray(c.bundle.resources) ? Object.fromEntries(c.bundle.resources.map((r) => [r, r])) : (c.bundle.resources ?? {})),
    [from(out)]: `streamdeck/${ID}.streamDeckPlugin`,
    [from(join(pluginDir, 'manifest.json'))]: 'streamdeck/manifest.json',
  };
  writeFileSync(conf, JSON.stringify(c, null, 2));
  step(`Lumora's installer carries it (${relative(process.cwd(), conf)})`);
}
