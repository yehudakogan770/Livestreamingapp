// Stand-ins for the show-day stores in component tests (no server).

import { vi } from 'vitest';
import type { LiveStore } from './useLive';
import type { ItemStore } from './useItems';
import type { FileStore } from './Files';

export const liveStore: LiveStore = {
  live: null,
  log: [],
  offset: 0,
  error: '',
  busy: false,
  ready: true,
  act: vi.fn(async () => {}),
  clearRun: vi.fn(async () => {}),
};

export const itemStore: ItemStore = {
  items: [],
  loaded: true,
  error: '',
  ready: true,
  add: vi.fn(() => 'item'),
  addMany: vi.fn(),
  edit: vi.fn(),
  tick: vi.fn(),
  remove: vi.fn(),
};

export const fileStore: FileStore = {
  files: [],
  loaded: true,
  ready: true,
  error: '',
  uploading: [],
  upload: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  open: vi.fn(async () => {}),
  move: vi.fn(async () => {}),
};
