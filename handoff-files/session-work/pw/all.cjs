// Runs the browser scripts one after another and prints only problems.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
for (const s of ['s2', 's4', 's5', 's7', 's10', 's11', 's12', 's14', 's16']) {
  let out = '';
  try {
    out = execFileSync('node', [`${__dirname}/${s}.cjs`], { encoding: 'utf8', timeout: 200000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' } });
  } catch (e) {
    out = `FAILED: ${String(e.stdout || '')}\n${String(e.stderr || '').slice(0, 800)}`;
  }
  const bad = out.split('\n').filter((l) => /pageerror|^error:|HTTP [45]|FAILED|Error/i.test(l));
  console.log(`== ${s}: ${bad.length ? bad.slice(0, 6).join('\n') : 'clean'}`);
}
for (const f of fs.readdirSync(__dirname)) if (f.endsWith('.png')) fs.unlinkSync(`${__dirname}/${f}`);
