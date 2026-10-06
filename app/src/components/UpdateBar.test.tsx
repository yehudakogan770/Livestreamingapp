import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const install = vi.fn(() => Promise.resolve());
let sending = { recording: null as unknown, streaming: null as unknown };
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => Promise.resolve({ version: '9.9.9', downloadAndInstall: install }) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => Promise.resolve() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('1.0.0') }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string) => (cmd === 'capture_status' ? Promise.resolve(sending) : Promise.reject(new Error(cmd))) }));

const { UpdateBar, checkForUpdates } = await import('./UpdateBar');

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  install.mockClear();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

async function offered() {
  render(<UpdateBar />);
  await act(async () => checkForUpdates());
  return screen.findByRole('button', { name: 'Update now' });
}

test('an update never starts while the stream runs (it would close Lumora on air)', async () => {
  sending = { recording: null, streaming: { session: 1 } };
  fireEvent.click(await offered());
  expect(await screen.findByText(/Stop the stream and the recording first/)).toBeInTheDocument();
  expect(install).not.toHaveBeenCalled();
});

test('with nothing going out, Update now installs', async () => {
  sending = { recording: null, streaming: null };
  fireEvent.click(await offered());
  await vi.waitFor(() => expect(install).toHaveBeenCalled());
});
