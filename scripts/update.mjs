// Runs before `npm run dev`: brings Lumora up to date so the newest version
// always starts. With no internet (or local changes) it just starts what is
// here. Then installs anything new the update needs.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

try {
  execSync('git pull --ff-only --quiet', { stdio: 'pipe', timeout: 60_000 });
  console.log('Lumora: up to date.');
} catch {
  console.log('Lumora: could not check for updates (no internet?). Starting the version on this computer.');
}

// Anything listed but not installed yet (e.g. new fonts in an update)?
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const missing = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => !existsSync(`node_modules/${name}/package.json`));
if (missing.length) {
  console.log(`Lumora: installing what the update needs (${missing.join(', ')})…`);
  run('npm install --no-audit --no-fund');
}
