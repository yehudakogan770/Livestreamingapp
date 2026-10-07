import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DemoClient, type RemoteStatus } from '../engine/client';
import { SpeakerDialog } from './SpeakerDialog';

const on: RemoteStatus = {
  enabled: true,
  running: true,
  pin: '4821',
  port: 8765,
  addresses: [
    {
      url: 'http://192.168.1.20:8765',
      qr: '<svg/>',
      voteUrl: 'http://192.168.1.20:8765/vote',
      voteQr: '<svg/>',
      slidesUrl: 'http://192.168.1.20:8765/slides',
      slidesQr: '<svg id="slides"/>',
    },
  ],
  phones: 2,
  error: null,
  internet: { on: false, phase: 'off', voteUrl: null, voteQr: null, error: null },
  speaker: {
    pin: '503917',
    locked: false,
    black: false,
    devices: [
      { id: 7, device: 'iPhone', speaker: true },
      { id: 8, device: 'iPad', speaker: false },
    ],
  },
};

function live() {
  const client = new DemoClient();
  Object.defineProperty(client, 'live', { value: true });
  return client;
}

describe('Let the speaker change slides', () => {
  it('shows the short link, the speaker PIN and its QR code, and who is connected', () => {
    render(<SpeakerDialog client={live()} status={on} clicker={false} onClicker={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('speaker-url')).toHaveTextContent('http://192.168.1.20:8765/slides');
    expect(screen.getByTestId('speaker-pin')).toHaveTextContent('503917');
    expect(screen.getByAltText(/QR code for http:\/\/192.168.1.20:8765\/slides/)).toHaveAttribute('src', expect.stringContaining('slides'));
    expect(screen.getByText('Speaker is controlling slides (iPhone)')).toBeInTheDocument();
    expect(screen.getByText(/Slides open with the phone remote PIN \(iPad\)/)).toBeInTheDocument();
    // The remote's own PIN is not the one shown to the speaker.
    expect(screen.queryByText('4821')).toBeNull();
  });

  it('pauses speaker control, allows black, disconnects a device and makes a new PIN', async () => {
    // Each change waits for the computer's answer before the next.
    const settle = () => act(() => Promise.resolve());
    const client = live();
    const setSpeaker = vi.spyOn(client, 'setSpeaker').mockResolvedValue(on);
    const disconnect = vi.spyOn(client, 'disconnectSpeaker').mockResolvedValue(on);
    const newPin = vi.spyOn(client, 'newSpeakerPin').mockResolvedValue(on);
    const { rerender } = render(<SpeakerDialog client={client} status={on} clicker={false} onClicker={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause speaker control' }));
    expect(setSpeaker).toHaveBeenCalledWith({ locked: true });
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: /may black out the slides/ }));
    expect(setSpeaker).toHaveBeenCalledWith({ black: true });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnect).toHaveBeenCalledWith(7);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'New speaker PIN' }));
    expect(newPin).toHaveBeenCalled();
    await settle();
    // Paused: it says so, and the button lets the speaker back.
    const paused = { ...on, speaker: { ...on.speaker!, locked: true } };
    rerender(<SpeakerDialog client={client} status={paused} clicker={false} onClicker={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Speaker is connected, control paused (iPhone)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Let the speaker change slides again' }));
    expect(setSpeaker).toHaveBeenCalledWith({ locked: false });
  });

  it('offers to turn the phone remote on, and the clicker setting', () => {
    const client = live();
    const setRemote = vi.spyOn(client, 'setRemote').mockResolvedValue(on);
    const onClicker = vi.fn();
    const off: RemoteStatus = { ...on, enabled: false, running: false, port: null, addresses: [], phones: 0 };
    render(<SpeakerDialog client={client} status={off} clicker={false} onClicker={onClicker} onClose={() => {}} />);
    expect(screen.queryByTestId('speaker-pin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on the phone remote' }));
    expect(setRemote).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Presentation clicker controls the slideshow/ }));
    expect(onClicker).toHaveBeenCalledWith(true);
  });

  it('closes with Escape', () => {
    const onClose = vi.fn();
    render(<SpeakerDialog client={live()} status={on} clicker onClicker={() => {}} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
