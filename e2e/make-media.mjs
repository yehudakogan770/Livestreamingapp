// Makes the demo project's media (editor/app/src/demo.ts) for the end-to-end
// test: small, 2-minute test pictures and tones, the names the demo expects.
//   node e2e/make-media.mjs <folder>     (FFMPEG: ffmpeg.exe, default on PATH)

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const folder = resolve(process.argv[2] ?? 'demo-media');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
mkdirSync(folder, { recursive: true });

const video = (pattern) => ['-f', 'lavfi', '-i', `${pattern}=size=320x180:rate=15`];
const tone = (hz) => ['-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000`];
const vp8 = ['-pix_fmt', 'yuv420p', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '200k'];
const opus = ['-c:a', 'libopus', '-b:a', '48k'];

// [file, seconds, inputs, codecs]
const files = [
  ['live.webm', 120, [...video('testsrc2'), ...tone(440)], [...vp8, ...opus]],
  ['wide.webm', 120, video('smptebars'), vp8],
  ['close.webm', 110, video('testsrc'), vp8],
  ['side.webm', 120, video('rgbtestsrc'), vp8],
  ['podium.webm', 120, tone(330), opus],
  ['hand.webm', 119, tone(550), opus],
];

for (const [name, seconds, inputs, codecs] of files) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-t', String(seconds), ...codecs, join(folder, name)], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`FFmpeg could not make ${name}`);
  console.log(`made ${name}`);
}
