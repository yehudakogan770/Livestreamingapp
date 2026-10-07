// Bitfocus Companion module for Lumora: one WebSocket to Lumora's control API
// (docs/API.md) carries every button press and brings the tally back the
// moment it changes. The parts that do not need Companion are in lumora.js.

import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base';
import WebSocket from 'ws';
import { ACTIONS, commandFor, presetsFor, retryDelay, socketUrl, tallyOf, variablesOf } from './lumora.js';

class LumoraInstance extends InstanceBase {
  tally = null;
  socket = null;
  timer = null;
  attempt = 0;
  nextId = 1;

  async init(config) {
    this.config = config;
    this.setActionDefinitions(this.actions());
    this.setFeedbackDefinitions(this.feedbacks());
    this.setPresetDefinitions(presetsFor(8));
    this.setVariableDefinitions(this.variableDefinitions());
    this.connect();
  }

  async destroy() {
    this.closeSocket();
  }

  async configUpdated(config) {
    this.config = config;
    this.attempt = 0;
    this.connect();
  }

  getConfigFields() {
    return [
      { type: 'textinput', id: 'host', label: 'Lumora computer (address)', width: 8, default: '127.0.0.1' },
      { type: 'number', id: 'port', label: 'Port', width: 4, default: 8095, min: 1024, max: 65535 },
      {
        type: 'textinput',
        id: 'token',
        label: 'Token (Lumora: Settings → Control API → Copy)',
        width: 12,
        default: '',
      },
    ];
  }

  closeSocket() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.terminate();
      this.socket = null;
    }
  }

  connect() {
    this.closeSocket();
    if (!this.config?.token) {
      this.updateStatus(InstanceStatus.BadConfig, 'Paste the token from Lumora');
      return;
    }
    this.updateStatus(InstanceStatus.Connecting);
    const ws = new WebSocket(socketUrl(this.config));
    this.socket = ws;
    ws.on('open', () => {
      this.attempt = 0;
      this.updateStatus(InstanceStatus.Ok);
    });
    ws.on('message', (data) => this.received(String(data)));
    ws.on('unexpected-response', (_req, res) => {
      this.updateStatus(InstanceStatus.ConnectionFailure, res.statusCode === 401 ? 'Wrong token' : `Lumora answered ${res.statusCode}`);
    });
    ws.on('error', (e) => this.log('debug', `Lumora: ${e.message}`));
    ws.on('close', () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.updateStatus(InstanceStatus.Disconnected, 'Trying again…');
      this.timer = setTimeout(() => this.connect(), retryDelay(this.attempt++));
    });
  }

  received(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if ((msg.type === 'state' || msg.type === 'tally') && msg.tally) {
      const names = (this.tally?.inputs ?? []).map((i) => i.name).join('|');
      this.tally = msg.tally;
      // New inputs: their name variables are defined again.
      if (names !== msg.tally.inputs.map((i) => i.name).join('|')) this.setVariableDefinitions(this.variableDefinitions());
      this.setVariableValues(variablesOf(this.tally));
      this.checkFeedbacks();
    } else if (msg.type === 'result' && msg.ok === false) {
      this.log('warn', `Lumora: ${msg.error}`);
    }
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Lumora is not connected');
      return;
    }
    this.socket.send(JSON.stringify({ ...message, id: String(this.nextId++) }));
  }

  actions() {
    const defs = {};
    for (const [id, a] of Object.entries(ACTIONS)) {
      defs[id] = {
        name: a.name,
        options: a.options,
        callback: async (action, context) => {
          const options = { ...action.options };
          if (typeof options.input === 'string') options.input = await context.parseVariablesInString(options.input);
          const msg = commandFor(id, options);
          if (msg) this.send(msg);
        },
      };
    }
    return defs;
  }

  feedbacks() {
    const red = { bgcolor: combineRgb(204, 0, 0), color: combineRgb(255, 255, 255) };
    return {
      tally: {
        type: 'boolean',
        name: 'Tally: input on air or in Next',
        defaultStyle: red,
        options: [
          { type: 'textinput', id: 'input', label: 'Input number or name', default: '1' },
          {
            type: 'dropdown',
            id: 'state',
            label: 'When',
            default: 'program',
            choices: [
              { id: 'program', label: 'On air (program)' },
              { id: 'preview', label: 'In Next (preview)' },
            ],
          },
        ],
        callback: (fb) => tallyOf(this.tally, fb.options.input) === fb.options.state,
      },
      overlay: {
        type: 'boolean',
        name: 'Overlay is on',
        defaultStyle: red,
        options: [{ type: 'number', id: 'channel', label: 'Overlay', default: 1, min: 1, max: 4 }],
        callback: (fb) => !!this.tally?.overlays?.[Number(fb.options.channel) - 1],
      },
      recording: { type: 'boolean', name: 'Recording', defaultStyle: red, options: [], callback: () => !!this.tally?.recording },
      streaming: { type: 'boolean', name: 'Live (streaming)', defaultStyle: red, options: [], callback: () => !!this.tally?.streaming },
      reconnecting: {
        type: 'boolean',
        name: 'Stream reconnecting',
        defaultStyle: { bgcolor: combineRgb(204, 122, 0), color: combineRgb(0, 0, 0) },
        options: [],
        callback: () => (this.tally?.reconnecting ?? 0) > 0,
      },
      panic: { type: 'boolean', name: 'PANIC is on', defaultStyle: red, options: [], callback: () => !!this.tally?.panic },
    };
  }

  variableDefinitions() {
    const list = [
      { variableId: 'program', name: 'On air (name)' },
      { variableId: 'preview', name: 'In Next (name)' },
      { variableId: 'program_number', name: 'On air (number)' },
      { variableId: 'preview_number', name: 'In Next (number)' },
      { variableId: 'recording', name: 'Recording (on / off)' },
      { variableId: 'streaming', name: 'Streaming (on / off / reconnecting)' },
    ];
    const count = Math.max(8, this.tally?.inputs?.length ?? 0);
    for (let n = 1; n <= count; n++) list.push({ variableId: `input_${n}_name`, name: `Input ${n} name` });
    return list;
  }
}

runEntrypoint(LumoraInstance, []);
