import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
const base = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/studio';
const dir = `${base}/a:b c'd,e[f]`;
mkdirSync(dir, { recursive: true });
copyFileSync(`${base}/sh.rnnn`, `${dir}/sh.rnnn`);
const path = `${dir}/sh.rnnn`;
// Option level: \ ' : escaped with a backslash; graph level: the whole value in quotes, ' closed and escaped.
const opt = (v) => v.replace(/[\\':]/g, (c) => `\\${c}`);
const graph = (v) => `'${v.replace(/'/g, "'\\''")}'`;
const variants = {
  quotedOnly: `arnndn=m='${path}'`,
  both: `arnndn=m=${graph(opt(path))}:mix=0.7`,
  escTwice: `arnndn=m=${opt(opt(path))}`,
};
for (const [k, v] of Object.entries(variants)) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=1', '-af', v, '-f', 'null', '-'], { encoding: 'utf8' });
  console.log(k, r.status, r.stderr.trim().split('\n').pop());
}
