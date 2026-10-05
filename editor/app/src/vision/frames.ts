// Reading a clip's frames exactly (the same decoder the export uses), small,
// for tracking and AI masks.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from 'mediabunny';
import type { MediaItem } from '../model/types';
import { mediaUrl } from '../native';

/** The size to look at a picture at: its shape, `long` pixels on the long side (never bigger than it is). */
export function lookSize(w: number, h: number, long: number): [number, number] {
  if (!w || !h) return [long, Math.round((long * 9) / 16)];
  const k = Math.min(1, long / Math.max(w, h));
  return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))];
}

/** The file that is decoded (a playable copy when there is one, as the export does). */
export const decodedFile = (m: MediaItem): string => m.proxy ?? m.path;

export class FrameReader {
  private sink: Promise<VideoSampleSink | null> | null = null;
  private image: Promise<ImageBitmap | null> | null = null;

  constructor(readonly media: MediaItem) {}

  private open(): Promise<VideoSampleSink | null> {
    if (!this.sink)
      this.sink = (async () => {
        const input = new Input({ source: new UrlSource(mediaUrl(decodedFile(this.media))), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return null;
        return new VideoSampleSink(track);
      })().catch(() => null);
    return this.sink;
  }

  /**
   * The frames showing at these times (seconds into the file), one after
   * another; `use` gets each as something to draw (or null if it couldn't be
   * read). Times in order are fastest.
   */
  async each(times: number[], use: (i: number, pic: CanvasImageSource | null) => Promise<boolean | void> | boolean | void): Promise<void> {
    if (this.media.kind === 'image') {
      if (!this.image)
        this.image = fetch(mediaUrl(decodedFile(this.media)))
          .then((r) => r.blob())
          .then((b) => createImageBitmap(b))
          .catch(() => null);
      const img = await this.image;
      for (let i = 0; i < times.length; i++) if ((await use(i, img)) === false) return;
      return;
    }
    const sink = await this.open();
    if (!sink) {
      for (let i = 0; i < times.length; i++) if ((await use(i, null)) === false) return;
      return;
    }
    let i = 0;
    const it = sink.samplesAtTimestamps(times);
    try {
      for await (const s of it) {
        let go: boolean | void;
        try {
          go = await use(i, s ? (s.toCanvasImageSource() as CanvasImageSource) : null);
        } finally {
          s?.close();
        }
        i++;
        if (go === false) break;
      }
    } finally {
      await it.return(undefined).catch(() => undefined);
    }
  }
}
