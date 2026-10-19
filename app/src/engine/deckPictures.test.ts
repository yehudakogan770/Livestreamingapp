import { describe, expect, it, vi } from 'vitest';
import { DemoClient } from './client';
import { drawWanted, type PictureDrawer } from './deckPictures';
import type { Show } from './types/Show';

function fakeDrawer() {
  const canvas = {
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })),
  } as unknown as HTMLCanvasElement;
  const drawn: string[][] = [];
  const d: PictureDrawer = {
    canvas,
    setShow: vi.fn(),
    drawInputs: (ids, _now, took) => {
      drawn.push(ids);
      ids.forEach(took);
    },
    dispose: vi.fn(),
  };
  return { d, drawn };
}

async function show(): Promise<Show> {
  const s = (await new DemoClient().getShow()).show;
  s.sources = [
    { ...s.sources[0]!, id: 'cam', name: 'Camera', kind: { type: 'camera', deviceId: 'x' } },
    { ...s.sources[0]!, id: 'clip', name: 'Clip', kind: { type: 'color', color: '#123456' } },
  ] as Show['sources'];
  return s;
}

describe('pictures for the Stream Deck', () => {
  it('draws only what was asked for, and nothing when nothing was', async () => {
    const client = new DemoClient();
    const put = vi.spyOn(client, 'putPicture');
    const wanted = vi.spyOn(client, 'picturesWanted').mockResolvedValue([]);
    const { d, drawn } = fakeDrawer();
    expect(await drawWanted(client, await show(), () => d, { skipCameras: false })).toBe(false);
    expect(drawn).toEqual([]);
    wanted.mockResolvedValue(['cam', 'clip', 'gone']);
    expect(await drawWanted(client, await show(), () => d, { skipCameras: false })).toBe(true);
    expect(drawn).toEqual([['cam', 'clip']]);
    expect(put.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['cam', 'clip']);
  });

  it('leaves cameras to the unified engine', async () => {
    const client = new DemoClient();
    vi.spyOn(client, 'picturesWanted').mockResolvedValue(['cam', 'clip']);
    const { d, drawn } = fakeDrawer();
    await drawWanted(client, await show(), () => d, { skipCameras: true });
    expect(drawn).toEqual([['clip']]);
  });
});
