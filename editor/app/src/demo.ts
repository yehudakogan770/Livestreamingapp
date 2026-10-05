import type { EventFile } from './model/event';
import { buildProject, type Prepared, type Project } from './model/project';

/**
 * A made-up event for trying the screens in a plain browser (`?demo`), with
 * sample videos in editor/app/public/demo (not part of the program).
 */
export async function demoProject(): Promise<Project> {
  const event: EventFile = {
    app: 'Lumora',
    version: 1,
    name: 'Spring Gala',
    startedAt: new Date(2026, 4, 3, 19, 0, 0).getTime(),
    durationMs: 120_000,
    program: { path: null, mp4: '/demo/live.webm' },
    files: [
      { kind: 'camera', sourceId: 'wide', name: 'Wide', path: '/demo/wide.webm', startMs: 0 },
      { kind: 'camera', sourceId: 'close', name: 'Close-up', path: '/demo/close.webm', startMs: 2000 },
      { kind: 'camera', sourceId: 'side', name: 'Side', path: '/demo/side.webm', startMs: 0 },
      { kind: 'microphone', sourceId: 'm1', name: 'Podium (sound)', path: '/demo/podium.webm', startMs: 0 },
      { kind: 'microphone', sourceId: 'm2', name: 'Handheld (sound)', path: '/demo/hand.webm', startMs: 500 },
    ],
    cuts: [
      { at: 0, id: 'wide', name: 'Wide' },
      { at: 8000, id: 'close', name: 'Close-up' },
      { at: 21_000, id: 'slides', name: 'Slides' },
      { at: 30_000, id: 'side', name: 'Side' },
      { at: 41_000, id: 'close', name: 'Close-up' },
      { at: 60_000, id: 'wide', name: 'Wide' },
      { at: 75_000, id: 'side', name: 'Side' },
      { at: 92_000, id: 'close', name: 'Close-up' },
    ],
  };
  const m = (path: string, durationMs: number, video: boolean, audio: boolean): [string, Prepared] => [
    path,
    { path, durationMs, hasVideo: video, hasAudio: audio, width: 1280, height: 720 },
  ];
  const media = new Map<string, Prepared>([
    m('/demo/live.webm', 120_000, true, true),
    m('/demo/wide.webm', 120_000, true, false),
    m('/demo/close.webm', 110_000, true, false),
    m('/demo/side.webm', 120_000, true, false),
    m('/demo/podium.webm', 120_000, false, true),
    m('/demo/hand.webm', 119_000, false, true),
  ]);
  return buildProject(event, 'C:/Users/You/Videos/Lumora/Spring Gala.lumora', media);
}
