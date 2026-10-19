import { writeFileSync } from 'node:fs';
import { keyModel, renderSvg } from '../../../../../../home/user/Livestreamingapp/.claude/worktrees/agent-a59f74bd706067e34/streamdeck/src/keys';
import { deckState, NO_APP } from '../../../../../../home/user/Livestreamingapp/.claude/worktrees/agent-a59f74bd706067e34/streamdeck/src/show';
import { sampleShow } from '../../../../../../home/user/Livestreamingapp/.claude/worktrees/agent-a59f74bd706067e34/streamdeck/src/testing';
import { KINDS } from '../../../../../../home/user/Livestreamingapp/.claude/worktrees/agent-a59f74bd706067e34/streamdeck/src/actions';

const st = (app = {}) => deckState(sampleShow(), { ...NO_APP, ...app });
const ctx = (app = {}) => ({ state: st(app), connection: 'online' as const, deck: 'live' as const, now: 0 });
const keys: string[] = [];
for (const k of KINDS) keys.push(renderSvg(keyModel(k, k === 'input' ? { input: 'cam1' } : k === 'preset' ? { preset: 'p2' } : {}, ctx())));
keys.push(renderSvg(keyModel('input', { input: 'cam2' }, ctx())));
keys.push(renderSvg(keyModel('input', { input: 'slides' }, ctx())));
keys.push(renderSvg(keyModel('record', {}, ctx({ recording: true }))));
keys.push(renderSvg(keyModel('golive', {}, ctx({ streaming: true }))));
keys.push(renderSvg(keyModel('overlay', { channel: '1' }, ctx())));
keys.push(renderSvg(keyModel('rehearsal', {}, ctx({ rehearsal: true }))));
keys.push(renderSvg(keyModel('panic', {}, { ...ctx(), hold: 0.6 })));
keys.push(renderSvg(keyModel('input', { input: 'cam1' }, { ...ctx(), connection: 'offline' })));
keys.push(renderSvg(keyModel('input', { label: 'Wide shot from the balcony' }, ctx())));
const html = `<html><body style="margin:0;background:#000;display:flex;flex-wrap:wrap;gap:12px;padding:12px;width:820px">${keys
  .map((s) => `<div style="width:144px;height:144px;border-radius:18px;overflow:hidden">${s}</div>`)
  .join('')}</body></html>`;
writeFileSync(process.argv[2]!, html);
