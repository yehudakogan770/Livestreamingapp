import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { acquireCamera, releaseCamera } from './cameras';

/** A fake camera track that can be unplugged. */
class Track extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  unplug() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

function stream(track: Track): MediaStream {
  return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

let tracks: Track[];
beforeEach(() => {
  tracks = [];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => {
        const t = new Track();
        tracks.push(t);
        return Promise.resolve(stream(t));
      }),
      enumerateDevices: () => Promise.resolve([]),
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

test('letting go of an unplugged camera never closes it after it was plugged back in', async () => {
  // The Live Screen and a preview both show the camera.
  const live = acquireCamera('cam-a');
  const preview = acquireCamera('cam-a');
  await live;
  expect(tracks).toHaveLength(1);
  // Unplugged, then the Live Screen opens it again once it's back.
  tracks[0]!.unplug();
  releaseCamera('cam-a', live);
  const again = acquireCamera('cam-a');
  await again;
  expect(tracks).toHaveLength(2);
  // The preview, still holding the old one, lets go of it.
  releaseCamera('cam-a', preview);
  await new Promise((r) => setTimeout(r, 0));
  expect(tracks[1]!.stop).not.toHaveBeenCalled();
  // When the Live Screen is done, it closes.
  releaseCamera('cam-a', again);
  await Promise.resolve();
  await Promise.resolve();
  expect(tracks[1]!.stop).toHaveBeenCalled();
});

test('a camera stays open while anything still uses it', async () => {
  const a = acquireCamera('cam-b');
  const b = acquireCamera('cam-b');
  await a;
  releaseCamera('cam-b', a);
  await Promise.resolve();
  expect(tracks[0]!.stop).not.toHaveBeenCalled();
  releaseCamera('cam-b', b);
  await Promise.resolve();
  await Promise.resolve();
  expect(tracks[0]!.stop).toHaveBeenCalled();
});
