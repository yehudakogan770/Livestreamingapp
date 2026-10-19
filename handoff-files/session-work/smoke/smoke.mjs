import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const W = process.argv[2];
const require = createRequire(W + '/streamdeck/package.json');
const { WebSocketServer } = require('ws');
const actions = [];
const show = {
  sources: [
    { id: 'a', name: 'Camera 1', kind: { type: 'camera' } },
    { id: 'b', name: 'Slides', kind: { type: 'slideshow' } },
  ],
  screens: { live: { program: 'a', preview: 'b', blank: false }, back: { program: null, preview: null, blank: false } },
  overlays: [{ sourceId: 'b', on: true, inNext: false }],
  presets: [],
  panic: false,
  run: { cues: [] },
};
const lumora = http
  .createServer((req, res) => {
    if (req.headers['x-lumora-pin'] !== '1234') {
      res.writeHead(401);
      return res.end('{"code":"wrongPin"}');
    }
    if (req.url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: show\ndata: ${JSON.stringify({ now: Date.now(), snapshot: { revision: 1, show } })}\n\n`);
      res.write(`event: app\ndata: {"recording":true}\n\n`);
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      actions.push([req.url, body]);
      res.writeHead(200);
      res.end('{}');
    });
  })
  .listen(0);
await new Promise((r) => lumora.on('listening', r));
const wss = new WebSocketServer({ port: 0 });
await new Promise((r) => wss.on('listening', r));
const images = [];
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.event === 'getGlobalSettings')
      ws.send(JSON.stringify({ event: 'didReceiveGlobalSettings', payload: { settings: { address: `127.0.0.1:${lumora.address().port}`, pin: '1234' } } }));
    else if (m.event === 'setImage') images.push(m);
    else if (m.event !== 'registerPlugin') console.log('->', m.event, JSON.stringify(m.payload ?? '').slice(0, 80));
  });
  const ap = (event, action) =>
    ws.send(
      JSON.stringify({
        event,
        action,
        context: 'ctx-' + action.split('.').pop(),
        device: 'dev1',
        payload: { settings: { input: 'b' }, coordinates: { column: 0, row: 0 }, controller: 'Keypad', isInMultiAction: false },
      }),
    );
  setTimeout(() => {
    ap('willAppear', 'com.lumora.streamdeck.input');
    ap('willAppear', 'com.lumora.streamdeck.record');
  }, 300);
  setTimeout(() => {
    ap('keyDown', 'com.lumora.streamdeck.input');
    ap('keyDown', 'com.lumora.streamdeck.input');
    ap('keyUp', 'com.lumora.streamdeck.input');
  }, 1500);
  setTimeout(() => {
    ap('keyDown', 'com.lumora.streamdeck.input');
    ap('keyUp', 'com.lumora.streamdeck.input');
  }, 1700);
});
const info = {
  application: { font: '', language: 'en', platform: 'windows', platformVersion: '10', version: '6.5.0.0' },
  plugin: { uuid: 'com.lumora.streamdeck', version: '1.0.0.0' },
  devicePixelRatio: 2,
  colors: {},
  devices: [{ id: 'dev1', name: 'SD', size: { columns: 5, rows: 3 }, type: 0 }],
};
const dir = W + '/streamdeck/com.lumora.streamdeck.sdPlugin';
const p = spawn(
  process.execPath,
  ['bin/plugin.js', '-port', String(wss.address().port), '-pluginUUID', 'abc', '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)],
  { cwd: dir, stdio: 'inherit' },
);
setTimeout(() => {
  console.log('actions:', JSON.stringify(actions));
  console.log(
    'images:',
    images.length,
    images.map((i) => i.context + ':' + decodeURIComponent(i.payload.image).match(/fill="(#[0-9A-F]+)"/)[1]).join(' '),
  );
  p.kill();
  process.exit(0);
}, 3000);
