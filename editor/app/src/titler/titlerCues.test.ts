// A title clip's audio cues in a Lumora Studio export: each sound mixed into
// the film at its cue's frame.

import { describe, expect, it } from 'vitest';
import { fromTemplate, starterTemplates } from '../../../../titler/src/core/templates';
import { finishJobs } from '../export/audioplan';
import { current } from '../model/seq';
import { emptyProject } from '../model/types';
import { addTitlerClip, cueSoundFiles, dataUrlBytes, titlerCueParts } from './titlerClip';

describe('title clips: audio cues in exports', () => {
  it('each cue sound is mixed into the film at its frame (IN from the start, OUT ending with the clip); Hall-only cues are left out', () => {
    const t = fromTemplate(starterTemplates().find((x) => x.name === 'Name and role')!);
    const c = t.compositions.find((x) => x.id === t.main)!;
    t.assets.push({ id: 'ding', name: 'Ding', kind: 'audio', src: 'data:audio/wav;base64,UklGRg==' });
    c.cues = [
      { id: 'a', t: 0.5, name: 'In', sound: 'ding' },
      { id: 'b', t: c.markers.outStart + 0.1, name: 'Out', sound: 'ding', gain: -6 },
      { id: 'h', t: 0.7, name: 'Room', sound: 'ding', mixes: ['hall'] },
    ];
    const fps = 30;
    const at = 60;
    const { project } = addTitlerClip(emptyProject(), at, fps, t);
    const s = current(project);
    const clip = s.clips.find((x) => x.source.kind === 'titler')!;
    const parts = titlerCueParts(s, 0, 10_000, fps);
    const outFrom = at + clip.length - Math.round((c.duration - c.markers.outStart) * fps) + Math.round(0.1 * fps);
    expect(parts.map((x) => x.from)).toEqual([at + 15, outFrom]);
    expect(parts[1]!.envelope[0]![1]).toBeCloseTo(0.5, 1);
    // A range that starts inside a cue's sound starts the sound part-way.
    const late = titlerCueParts(s, at + 20, 10_000, fps);
    expect(late[0]!.srcFrom).toBeCloseTo(5 / fps, 5);
    // The exporter writes the sound into the work folder; FFmpeg reads it there, delayed to its place.
    const files = cueSoundFiles(parts);
    expect([...files.values()]).toEqual(['cue-1.wav']);
    expect([...dataUrlBytes([...files.keys()][0]!)].slice(0, 4)).toEqual([82, 73, 70, 70]);
    const jobs = finishJobs(project, s, { from: 0, to: at + clip.length }, null, 'wav', false, {
      paths: (x) => (files.has(x) ? `{tmp}/${files.get(x)}` : x),
    });
    const args = jobs[jobs.length - 1]!.args;
    expect(args.filter((a) => a === '{tmp}/cue-1.wav').length).toBe(2);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain(`adelay=${Math.round(((at + 15) / fps) * 1000)}:all=1`);
  });
});
