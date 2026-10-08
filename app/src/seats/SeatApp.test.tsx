import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyShow } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { LinkStatus, SeatApi, SeatDocument } from './api';
import { SeatView, watchKeys } from './SeatApp';
import { elementFor } from './SeatFeed';
import type { Role } from './roles';

function source(id: string, name: string, kind: Source['kind'], extra: Partial<Source> = {}): Source {
  return { id, name, kind, volume: 0.8, muted: false, ...extra } as Source;
}

function show(): Show {
  const s = emptyShow();
  s.sources = [
    source(
      'cam1',
      'Wide',
      { type: 'camera', deviceId: 'd1', label: 'Cam' },
      { ptz: { protocol: 'viscaIp', host: '10.0.0.9', port: 52381 } as unknown as Source['ptz'] },
    ),
    source('mic1', 'Pulpit mic', { type: 'microphone', deviceId: 'm1', label: 'Mic' }),
    source('t1', 'Speaker name', { type: 'text', text: 'Dana Levy', sub: 'Host' } as unknown as Source['kind']),
  ];
  s.screens.live = { ...s.screens.live, preview: 'cam1', program: null };
  s.overlays[0] = { ...s.overlays[0]!, sourceId: 't1', on: false };
  return s;
}

function connected(role: Role, locked = false): LinkStatus {
  return { state: 'connected', show: 'Spring Gala (FOH-PC)', seat: { id: 's', name: 'LAPTOP-7', role, locked }, rttMs: 9 };
}

function fakeApi(status: LinkStatus) {
  const doc: SeatDocument = { revision: 1, show: show(), app: { recording: false, streaming: false, replay: true } };
  let onStatus: ((s: LinkStatus) => void) | null = null;
  const api: SeatApi = {
    status: vi.fn(() => Promise.resolve(status)),
    document: vi.fn(() => Promise.resolve(doc)),
    action: vi.fn(() => Promise.resolve()),
    command: vi.fn(() => Promise.resolve()),
    ptz: vi.fn(() => Promise.resolve()),
    watchKeys: vi.fn(() => Promise.resolve()),
    picture: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
    leave: vi.fn(() => Promise.resolve()),
    onStatus: (f) => {
      onStatus = f;
      return () => (onStatus = null);
    },
    onDocument: () => () => {},
    onPicture: () => () => {},
    onMeters: () => () => {},
  };
  return { api, setStatus: (s: LinkStatus) => act(() => onStatus?.(s)) };
}

const NOT = 'Your seat can’t do this';

describe('the seat window', () => {
  it('says which show and seat, with the delay, and Leave leaves', async () => {
    const { api } = fakeApi(connected({ kind: 'graphics' }));
    const leave = vi.fn();
    render(<SeatView api={api} onLeave={leave} />);
    expect(await screen.findByTestId('seat-line')).toHaveTextContent('Connected to Spring Gala (FOH-PC) as Graphics');
    expect(screen.getByText('9 ms')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Leave/ }));
    expect(leave).toHaveBeenCalled();
  });

  it('Graphics: overlays work; cuts, going live and the mixer are greyed out with the reason', async () => {
    const { api } = fakeApi(connected({ kind: 'graphics' }));
    render(<SeatView api={api} onLeave={() => {}} />);
    const take = await screen.findByRole('button', { name: 'TAKE' });
    expect(take).toBeDisabled();
    expect(take.closest('fieldset')).toHaveAttribute('title', NOT);
    expect(screen.getByRole('button', { name: /GO LIVE/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /REC/ }).closest('fieldset')).toHaveAttribute('title', NOT);
    // Picking what's in Next is not Graphics' either (the tiles are still shown).
    expect(screen.getByRole('button', { name: /Wide/ })).toBeDisabled();
    // Channel 1 has the title; the empty channels' buttons wait for an input.
    const [putOn, empty] = screen.getAllByRole('button', { name: 'Put on' }) as [HTMLElement, HTMLElement];
    expect(empty).toBeDisabled();
    expect(putOn).toBeEnabled();
    fireEvent.click(putOn);
    expect(api.action).toHaveBeenCalledWith({ type: 'setOverlayOn', channel: 0, value: true });
    // A title's words, changed in place.
    fireEvent.change(screen.getByRole('textbox', { name: 'Speaker name: words' }), { target: { value: 'Sam Cohen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(api.action).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'updateText', id: 't1', text: expect.objectContaining({ text: 'Sam Cohen', sub: 'Host' }) }),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    expect(await screen.findByRole('slider', { name: 'Pulpit mic volume' })).toBeDisabled();
  });

  it('Audio: opens on the mixer and asks for the levels', async () => {
    const { api } = fakeApi(connected({ kind: 'audio' }));
    render(<SeatView api={api} onLeave={() => {}} />);
    const fader = await screen.findByRole('slider', { name: 'Pulpit mic volume' });
    expect(fader).toBeEnabled();
    fireEvent.change(fader, { target: { value: '0.5' } });
    expect(api.action).toHaveBeenCalledWith({ type: 'updateSource', id: 'mic1', patch: { volume: 0.5 } });
    fireEvent.click(screen.getByRole('button', { name: 'Mute Pulpit mic' }));
    expect(api.action).toHaveBeenLastCalledWith({ type: 'updateSource', id: 'mic1', patch: { muted: true } });
    await vi.waitFor(() => expect(api.watchKeys).toHaveBeenLastCalledWith(expect.arrayContaining(['meters', 'program/live', 'next/live'])));
    expect(screen.getByRole('button', { name: 'TAKE' })).toBeDisabled();
  });

  it('Director: TAKE, REC and replay go to the show computer', async () => {
    const { api } = fakeApi(connected({ kind: 'director' }));
    render(<SeatView api={api} onLeave={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'TAKE' }));
    expect(api.action).toHaveBeenCalledWith({ type: 'take', screen: 'live' });
    fireEvent.click(screen.getByRole('button', { name: /REC/ }));
    expect(api.command).toHaveBeenCalledWith({ command: 'record', on: true });
    fireEvent.click(screen.getByRole('button', { name: /^10 s$/ }));
    expect(api.command).toHaveBeenLastCalledWith({ command: 'replay', seconds: 10 });
  });

  it('Cameras: PTZ and lining up Next only', async () => {
    const { api } = fakeApi(connected({ kind: 'cameras' }));
    render(<SeatView api={api} onLeave={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Wide: home' }));
    expect(api.ptz).toHaveBeenCalledWith('cam1', { type: 'home' });
    fireEvent.click(screen.getByRole('button', { name: /Pulpit mic/ }));
    expect(api.action).toHaveBeenCalledWith({ type: 'setPreview', screen: 'live', sourceId: 'mic1' });
    expect(screen.getByRole('button', { name: 'TAKE' })).toBeDisabled();
  });

  it('a locked or reconnecting seat changes nothing, and says why', async () => {
    const { api, setStatus } = fakeApi(connected({ kind: 'director' }, true));
    render(<SeatView api={api} onLeave={() => {}} />);
    const take = await screen.findByRole('button', { name: 'TAKE' });
    expect(take).toBeDisabled();
    expect(take.closest('fieldset')).toHaveAttribute('title', 'The show operator has locked your seat for now');
    expect(screen.getByTestId('seat-line')).toHaveTextContent('locked by the show operator');
    setStatus({ state: 'reconnecting', show: 'Spring Gala (FOH-PC)', tries: 2, problem: 'The show computer isn’t answering.' });
    expect(screen.getByTestId('seat-line')).toHaveTextContent('Reconnecting to Spring Gala (FOH-PC)…');
    expect(screen.getByRole('button', { name: 'TAKE' }).closest('fieldset')).toHaveAttribute('title', 'Not connected to the show right now');
  });

  it('asks only for the pictures it shows', () => {
    const doc: SeatDocument = { revision: 1, show: show(), app: {} };
    expect(watchKeys(doc, 'back', false)).toEqual(['program/back', 'next/back', 'source/cam1']);
    expect(watchKeys(null, 'live', true)).toEqual(['program/live', 'next/live', 'meters']);
  });
});

describe('pictures for the seats (show computer, Standard engine)', () => {
  it('finds the monitors and input tiles the control window shows', () => {
    document.body.innerHTML = `
      <div class="mon mon--pvw"><div class="mon__screen"><div data-screen="live" id="pvw"></div></div></div>
      <div class="mon mon--pgm"><div class="mon__screen"><div data-screen="live" id="pgm"></div></div></div>
      <span class="tile__thumb" data-seat-source="cam1" id="tile"></span>`;
    expect(elementFor('program/live')?.id).toBe('pgm');
    expect(elementFor('next/live')?.id).toBe('pvw');
    expect(elementFor('source/cam1')?.id).toBe('tile');
    expect(elementFor('program/back')).toBeNull();
    expect(elementFor('meters')).toBeNull();
    document.body.innerHTML = '';
  });
});
