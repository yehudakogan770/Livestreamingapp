import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { defaultCaptureSettings, type CaptureSettings, type EngineClient } from '../engine/client';
import { addressProblem, BroadcastDialog } from './BroadcastDialog';

const saveSettings = vi.fn(async (_s: CaptureSettings) => {});
vi.mock('./BroadcastContext', () => ({
  useBroadcast: () => ({
    settings: {
      ...defaultCaptureSettings(),
      destinations: [{ id: 'yt', name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2', key: 'k', enabled: true }],
    },
    status: { ffmpeg: true, recording: null, streaming: null, hwChecked: true, hwEncoders: [] },
    saveSettings,
  }),
}));

const client = {
  captureFolder: async () => 'C:\\Videos',
  getShow: async () => ({ show: { sources: [] } }),
} as unknown as EngineClient;

describe('stream addresses', () => {
  it('takes RTMP, RTMPS and SRT, and says what is wrong otherwise', () => {
    expect(addressProblem('')).toBeNull();
    expect(addressProblem('rtmp://a.rtmp.youtube.com/live2')).toBeNull();
    expect(addressProblem('rtmps://live-api-s.facebook.com:443/rtmp')).toBeNull();
    expect(addressProblem('srt://192.168.1.50:9000?latency=200000')).toBeNull();
    expect(addressProblem('srt://192.168.1.50')).toMatch(/needs a port/);
    expect(addressProblem('a.rtmp.youtube.com/live2')).toMatch(/Start the address/);
    expect(addressProblem('https://example.com/live')).toMatch(/not https/);
  });
});

describe('Recording and streaming settings', () => {
  it('fills in YouTube’s backup server and saves it with the destination', async () => {
    render(<BroadcastDialog client={client} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use YouTube’s' }));
    expect(screen.getByRole('textbox', { name: 'Backup server for YouTube' })).toHaveValue('rtmp://b.rtmp.youtube.com/live2?backup=1');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(saveSettings).toHaveBeenCalled();
    expect(saveSettings.mock.calls[0]![0].destinations[0]!.backupUrl).toBe('rtmp://b.rtmp.youtube.com/live2?backup=1');
  });

  it('adds YouTube through a connected account beside the stream-key destination', async () => {
    saveSettings.mockClear();
    render(<BroadcastDialog client={client} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ YouTube with your account' }));
    // Outside the Windows app, connecting isn't set up: it says so, and the stream-key destination is untouched.
    expect(await screen.findByText(/isn’t set up in this copy of Lumora yet/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Server address' })).toHaveValue('rtmp://a.rtmp.youtube.com/live2');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const saved = saveSettings.mock.calls[0]![0].destinations;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ name: 'YouTube', key: 'k' });
    expect(saved[0]!.account).toBeUndefined();
    expect(saved[1]).toMatchObject({ url: '', key: '', account: { provider: 'youtube', broadcastId: '' } });
  });

  it('warns about an address Lumora cannot stream to', async () => {
    render(<BroadcastDialog client={client} onClose={() => {}} />);
    const backup = await screen.findByRole('textbox', { name: 'Backup server for YouTube' });
    fireEvent.change(backup, { target: { value: 'srt://10.0.0.9' } });
    expect(screen.getByText(/An SRT address needs a port/)).toBeInTheDocument();
  });
});
