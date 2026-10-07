// The control API's settings (mirrors src-tauri/src/api.rs): HTTP and
// WebSocket with a token, and OSC, for Bitfocus Companion, tally lights and
// show-control systems. See docs/API.md.

import { invoke } from '@tauri-apps/api/core';

export interface ApiConfig {
  enabled: boolean;
  port: number;
  token: string;
  osc: boolean;
  oscPort: number;
  oscLocalOnly: boolean;
}

export interface ApiStatus extends ApiConfig {
  running: boolean;
  oscRunning: boolean;
  /** WebSocket clients connected now. */
  clients: number;
  /** Where other computers reach it (http://192.168.1.20:8095). */
  addresses: string[];
  error: string | null;
}

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Outside the app (the browser preview and tests): kept here.
let demo: ApiStatus = {
  enabled: false,
  port: 8095,
  token: 'preview0token0not0for0real0use00',
  osc: false,
  oscPort: 8096,
  oscLocalOnly: true,
  running: false,
  oscRunning: false,
  clients: 0,
  addresses: [],
  error: null,
};

function demoSet(c: ApiConfig): ApiStatus {
  demo = {
    ...demo,
    ...c,
    token: demo.token,
    running: c.enabled,
    oscRunning: c.osc,
    addresses: c.enabled ? [`http://192.168.1.20:${c.port}`, `http://127.0.0.1:${c.port}`] : [],
  };
  return demo;
}

export function apiStatus(): Promise<ApiStatus> {
  return inApp() ? invoke<ApiStatus>('api_status') : Promise.resolve(demo);
}

export function setApi(config: ApiConfig): Promise<ApiStatus> {
  return inApp() ? invoke<ApiStatus>('set_api', { config }) : Promise.resolve(demoSet(config));
}

export function newApiToken(): Promise<ApiStatus> {
  if (inApp()) return invoke<ApiStatus>('new_api_token');
  demo = { ...demo, token: Math.random().toString(36).slice(2).padEnd(32, '0').slice(0, 32) };
  return Promise.resolve(demo);
}

/** The settings part of a status. */
export function configOf(s: ApiStatus): ApiConfig {
  return { enabled: s.enabled, port: s.port, token: s.token, osc: s.osc, oscPort: s.oscPort, oscLocalOnly: s.oscLocalOnly };
}

/** A port a person typed, or null when it can't be used. */
export function cleanPort(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : null;
}

/** Example addresses for the settings, with the token. */
export function examples(base: string, token: string): { what: string; url: string }[] {
  const at = (cmd: string) => `${base}/api/do/${cmd}${cmd.includes('?') ? '&' : '?'}token=${token}`;
  return [
    { what: 'CUT (Live Screen)', url: at('cut') },
    { what: 'TAKE with the current transition', url: at('take') },
    { what: 'Input 3 into Next', url: at('preview?input=3') },
    { what: 'Overlay 1 on / off', url: at('overlay?channel=1') },
    { what: 'Start / stop recording', url: at('record') },
    { what: 'Go live / end the stream', url: at('stream') },
    { what: 'Replay the last 8 seconds', url: at('replay?seconds=8') },
    { what: 'Run the macro “Start show”', url: at('macro?name=Start%20show') },
    { what: 'Countdown: start / pause', url: at('timer') },
    { what: 'Next slide on input 4', url: at('slide?input=4&to=next') },
    { what: 'PANIC on / off', url: at('panic') },
    { what: 'Tally for input 1 (program, preview or off)', url: `${base}/api/tally/1?token=${token}` },
  ];
}
