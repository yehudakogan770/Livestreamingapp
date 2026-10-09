import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderQueue } from '../export/renderQueue';
import { CHAPTER_COLOR } from '../extras/chapters';
import type { Marker } from '../model/types';
import { Ui } from '../ui/state';
import { PublishDialog } from '../ui/Publish';
import { checkDetails, resetUploads, startingDescription, type VideoDetails } from './youtube';

const calls: [string, unknown][] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => {
    calls.push([cmd, args]);
    if (cmd === 'youtube_info') return Promise.resolve({ setUp: true, connected: true, channel: 'Spring Hall' });
    if (cmd === 'youtube_upload') return Promise.resolve({ id: 'abc', url: 'https://youtu.be/abc', notes: [] });
    return Promise.resolve(null);
  },
  convertFileSrc: (p: string) => p,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('../native', async (orig) => ({ ...(await orig<typeof import('../native')>()), inApp: () => true }));

const marker = (at: number, name: string, color = CHAPTER_COLOR): Marker => ({ id: name, at, length: 0, name, color });

const details: VideoDetails = { title: 'Gala', description: '', tags: [], category: '22', visibility: 'private', madeForKids: false };

describe('publishing to YouTube', () => {
  beforeEach(() => {
    calls.length = 0;
    resetUploads();
  });

  it('checks the details as YouTube does', () => {
    expect(checkDetails(details)).toBeNull();
    expect(checkDetails({ ...details, title: ' ' })).toMatch(/title/);
    expect(checkDetails({ ...details, title: 'x'.repeat(101) })).toMatch(/100/);
    expect(checkDetails({ ...details, description: 'a < b' })).toMatch(/</);
    expect(checkDetails({ ...details, tags: ['x'.repeat(501)] })).toMatch(/tags/);
  });

  it('starts the description with YouTube chapters from the chapter markers', () => {
    const fps = 30;
    const m = [marker(0, 'Chapter: Welcome'), marker(60 * fps, 'Chapter: Awards'), marker(300 * fps, 'Chapter: Thanks'), marker(10 * fps, 'Beat', '#d9a441')];
    expect(startingDescription(m, fps, { from: 0, to: 600 * fps })).toBe('Chapters\n0:00 Welcome\n1:00 Awards\n5:00 Thanks\n');
    // Fewer than three chapters: YouTube wouldn't use them.
    expect(startingDescription(m.slice(0, 2), fps, { from: 0, to: 600 * fps })).toBe('');
  });

  it('publishes a finished export with its thumbnail and captions', async () => {
    vi.spyOn(renderQueue, 'publishSource').mockReturnValue({
      path: '/films/Gala.mp4',
      title: 'Gala',
      srt: '/films/Gala.srt',
      thumbnail: '/films/Gala.jpg',
      markers: [],
      fps: 30,
      range: { from: 0, to: 300 },
    });
    render(<PublishDialog job="q1" ui={new Ui()} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Spring Hall')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /Unlisted/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Watch on YouTube' })).toBeTruthy());
    const up = calls.find(([c]) => c === 'youtube_upload')?.[1] as {
      path: string;
      details: VideoDetails;
      thumbnail: string;
      captions: { path: string; language: string };
    };
    expect(up.path).toBe('/films/Gala.mp4');
    expect(up.details).toMatchObject({ title: 'Gala', visibility: 'unlisted', madeForKids: false });
    expect(up.thumbnail).toBe('/films/Gala.jpg');
    expect(up.captions).toMatchObject({ path: '/films/Gala.srt', language: 'en' });
  });
});
