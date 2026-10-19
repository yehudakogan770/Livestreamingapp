// The settings panel for every Lumora key (the Stream Deck app shows it when
// a key is selected). Where Lumora is and its PIN are shared by all keys
// (global settings); the rest belongs to this key. The pickers are filled
// from Lumora's show, which the plugin sends here.
'use strict';

const PLUGIN = 'com.lumora.streamdeck';

let socket = null;
let context = '';
let kind = '';
let settings = {};
let global = {};
let lists = { connection: 'off', inputs: [], presets: [], overlays: [], countdowns: [] };

const $ = (id) => document.getElementById(id);

const SCREEN = {
  name: 'Screen',
  key: 'screen',
  options: [
    ['', 'Follow the Screen key'],
    ['live', 'Live'],
    ['back', 'Back'],
  ],
};

/** Each key kind's own settings. Options may be a function of the lists from Lumora. */
const FIELDS = {
  take: [
    SCREEN,
    {
      name: 'Transition',
      key: 'transition',
      options: [
        ['', 'Lumora’s choice'],
        ['cut', 'Cut'],
        ['fade', 'Fade'],
        ['merge', 'Merge'],
        ['dip', 'Dip to black'],
        ['wipe', 'Wipe'],
        ['slide', 'Slide'],
        ['iris', 'Iris'],
        ['zoom', 'Zoom'],
        ['stinger1', 'Stinger 1'],
        ['stinger2', 'Stinger 2'],
      ],
    },
  ],
  cut: [SCREEN],
  blank: [
    {
      name: 'Does',
      key: 'mode',
      options: [
        ['', 'Blank now (press again to bring back)'],
        ['ftb', 'Fade to black (and back)'],
      ],
    },
    SCREEN,
  ],
  input: [
    { name: 'Input', key: 'input', remember: 'inputName', options: () => pick(lists.inputs, (i) => `${i.number}. ${i.name}`, 'Choose an input') },
    {
      name: 'Press',
      key: 'press',
      options: [
        ['', 'Put in Next (press twice: cut to air)'],
        ['air', 'Cut straight to air'],
      ],
    },
    SCREEN,
  ],
  overlay: [
    {
      name: 'Channel',
      key: 'channel',
      options: () =>
        [1, 2, 3, 4].map((ch) => {
          const o = lists.overlays.find((x) => x.channel === ch);
          return [String(ch), o && o.name ? `${ch}. ${o.name}` : `Overlay ${ch}`];
        }),
    },
  ],
  preset: [
    {
      name: 'Preset',
      key: 'preset',
      remember: 'presetName',
      options: () => [...pick(lists.presets, (p) => `${p.number}. ${p.name}`, 'Choose a preset'), ['next', 'Next preset'], ['previous', 'Previous preset']],
    },
  ],
  replay: [
    {
      name: 'Replay the last',
      key: 'seconds',
      options: [
        ['5', '5 seconds'],
        ['', '10 seconds'],
        ['20', '20 seconds'],
        ['30', '30 seconds'],
      ],
    },
    { name: 'Slow motion', key: 'slow', check: 'Half speed' },
  ],
  record: [{ name: 'Stopping', key: 'holdToStop', check: 'Hold the key to stop', defaultOn: true }],
  countdown: [
    { name: 'Countdown', key: 'countdown', remember: 'countdownName', options: () => pick(lists.countdowns, (c) => c.name, 'The first one in the show') },
    {
      name: 'Press',
      key: 'mode',
      options: [
        ['', 'Start / pause'],
        ['start', 'Start'],
        ['pause', 'Pause'],
        ['reset', 'Reset'],
      ],
    },
  ],
};

const HINTS = {
  take: 'Sends what is in Next to air.',
  cut: 'Sends what is in Next to air with a cut.',
  blank: 'Turns amber while the screen is black.',
  panic: 'Hold the key for one second to switch PANIC on (and again to switch it off). Everything goes black except the stage monitor.',
  input: 'Red: on air. Green: in Next.',
  overlay: 'Press to put the overlay on air or take it off. Red: on air.',
  preset: 'Lit while the preset is the one picked.',
  replay: 'The first press switches instant replay on (it keeps the last minute). After that, each press puts a replay in Next.',
  record: 'Press to record the Live Screen. Red while recording.',
  golive: 'Hold the key for one second to go live, and again to end the stream. Uses the destinations set in Lumora.',
  countdown: 'Shows the time left.',
  nextcue: 'Runs the next cue of the run of show; the key shows its name.',
  screen: 'Switches which screen the other keys work on: Live or Back.',
  rehearsal: 'Choose rehearsal before going live: everything runs as if live, with nothing sent anywhere.',
};

const STATUS = {
  off: 'Type the PIN',
  connecting: 'Connecting…',
  online: 'Connected',
  offline: 'Can’t reach Lumora',
  wrongPin: 'Wrong PIN',
};

function pick(items, text, none) {
  return [['', none], ...items.map((i) => [i.id, text(i)])];
}

function send(event, payload) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, context, payload }));
}

function saveSettings() {
  send('setSettings', settings);
}

function saveGlobal() {
  send('setGlobalSettings', global);
}

function toPlugin(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'sendToPlugin', action: `${PLUGIN}.${kind}`, context, payload }));
}

function renderFields() {
  const box = $('fields');
  box.textContent = '';
  for (const f of FIELDS[kind] || []) {
    const row = document.createElement('label');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.name;
    row.append(name);
    if (f.check) {
      const wrap = document.createElement('span');
      wrap.className = 'check';
      const box2 = document.createElement('input');
      box2.type = 'checkbox';
      box2.checked = settings[f.key] === undefined ? !!f.defaultOn : settings[f.key] === true;
      box2.addEventListener('change', () => {
        settings[f.key] = box2.checked;
        saveSettings();
      });
      wrap.append(box2, document.createTextNode(f.check));
      row.append(wrap);
    } else {
      const select = document.createElement('select');
      const options = typeof f.options === 'function' ? f.options() : f.options;
      const value = settings[f.key] || '';
      for (const [v, t] of options) select.append(new Option(t, v, false, v === value));
      // A key set up in another event: keep its choice showing until Lumora has it again.
      if (value && !options.some(([v]) => v === value)) {
        const remembered = (f.remember && settings[f.remember]) || 'Not in this show';
        select.append(new Option(remembered, value, true, true));
      }
      select.addEventListener('change', () => {
        settings[f.key] = select.value || undefined;
        if (f.remember) {
          const chosen = options.find(([v]) => v === select.value);
          settings[f.remember] = select.value && chosen ? chosen[1].replace(/^\d+\.\s/, '') : undefined;
        }
        saveSettings();
      });
      row.append(select);
    }
    box.append(row);
  }
  $('hint').textContent = HINTS[kind] || '';
  $('label').value = settings.label || '';
}

function renderStatus() {
  const s = $('status');
  s.dataset.state = lists.connection;
  s.textContent = STATUS[lists.connection] || lists.connection;
}

function renderGlobal() {
  $('address').value = global.address || '';
  $('pin').value = global.pin || '';
}

function receive(message) {
  const m = JSON.parse(message.data);
  if (m.event === 'didReceiveGlobalSettings') {
    global = (m.payload && m.payload.settings) || {};
    renderGlobal();
  } else if (m.event === 'didReceiveSettings') {
    settings = (m.payload && m.payload.settings) || {};
    renderFields();
  } else if (m.event === 'sendToPropertyInspector' && m.payload && m.payload.event === 'lists') {
    const focused = document.activeElement && document.activeElement.tagName === 'SELECT';
    lists = m.payload;
    renderStatus();
    // Don't rebuild a list someone is choosing from.
    if (!focused) renderFields();
  }
}

/** Called by the Stream Deck app when the panel opens. */
function connectElgatoStreamDeckSocket(port, uuid, registerEvent, info, actionInfo) {
  context = uuid;
  const action = JSON.parse(actionInfo);
  kind = String(action.action || '').replace(`${PLUGIN}.`, '');
  settings = (action.payload && action.payload.settings) || {};
  renderFields();
  renderStatus();
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ event: registerEvent, uuid }));
    socket.send(JSON.stringify({ event: 'getGlobalSettings', context }));
    toPlugin({ event: 'lists' });
  });
  socket.addEventListener('message', receive);
}
window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

$('address').addEventListener('change', () => {
  global.address = $('address').value.trim() || undefined;
  saveGlobal();
});
$('pin').addEventListener('input', () => {
  $('pin').value = $('pin').value.replace(/\D/g, '').slice(0, 4);
});
$('pin').addEventListener('change', () => {
  global.pin = $('pin').value || undefined;
  saveGlobal();
});
$('connect').addEventListener('click', () => {
  global.address = $('address').value.trim() || undefined;
  global.pin = $('pin').value || undefined;
  saveGlobal();
  toPlugin({ event: 'connect' });
});
$('label').addEventListener('change', () => {
  settings.label = $('label').value.trim() || undefined;
  saveSettings();
});
