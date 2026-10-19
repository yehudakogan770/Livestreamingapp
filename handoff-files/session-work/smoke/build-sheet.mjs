import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire('/home/user/Livestreamingapp/package.json');
const { build } = await import(pathToFileURL(require.resolve('rolldown')).href);
const dir = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/smoke';
await build({ input: `${dir}/sheet.ts`, platform: 'node', logLevel: 'warn', output: { file: `${dir}/sheet.mjs`, format: 'esm' } });
await import(`${dir}/sheet.mjs`);
