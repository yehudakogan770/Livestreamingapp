// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { numberedRuns, rawCameraProblem } from './camerafiles';
import { dismissProblem, importFiles, importing, MEDIA_EXTENSIONS } from './importer';
import { Doc } from '../doc';
import { emptyProject } from '../model/types';

describe('camera RAW files', () => {
  it('say which free converter to use', () => {
    expect(rawCameraProblem('D:/Card/A001_C002.braw')).toMatch(
      /^Blackmagic RAW can't be read directly\. Convert it to ProRes 422 HQ or DNxHR HQX with DaVinci Resolve/,
    );
    expect(rawCameraProblem('/Volumes/RED/A001_C001_0101AB_001.R3D')).toMatch(/REDCINE-X PRO/);
    expect(rawCameraProblem('C:/ARRI/A_0001C001.ari')).toMatch(/ARRI Reference Tool/);
    expect(rawCameraProblem('clip.crm')).toMatch(/Canon Cinema RAW Development/);
    expect(rawCameraProblem('C:/Footage/A001.mov')).toBeNull();
    expect(rawCameraProblem('C:/Footage/A001.mxf')).toBeNull();
  });

  it('stay out of the project and leave the message in the media pool', async () => {
    const doc = new Doc(emptyProject('Test'));
    expect(await importFiles(doc, ['D:/Card/A001_C002.braw', 'D:/RED/A001.R3D'], null)).toEqual([]);
    expect(doc.project.media).toHaveLength(0);
    const shown = importing.list.filter((x) => x.problem);
    expect(shown.map((x) => x.name)).toEqual(['A001_C002.braw', 'A001.R3D']);
    expect(shown[0]?.problem).toMatch(/Convert it to ProRes 422 HQ or DNxHR HQX/);
    for (const x of shown) dismissProblem(x.path);
    expect(importing.list).toHaveLength(0);
  });

  it('can be chosen and dropped (so they get the message), as can DPX and EXR frames', () => {
    for (const ext of ['braw', 'r3d', 'ari', 'dpx', 'exr', 'mxf']) expect(MEDIA_EXTENSIONS).toContain(ext);
  });
});

describe('numbered image sequences', () => {
  const frames = (folder: string, stem: string, from: number, n: number, ext = '.dpx', width = 4) =>
    Array.from({ length: n }, (_, i) => `${folder}/${stem}${String(from + i).padStart(width, '0')}${ext}`);

  it('finds runs of ten or more and leaves the rest', () => {
    const paths = [
      ...frames('/shots', 'plate_', 1001, 24),
      ...frames('/shots', 'logo', 1, 3, '.png'),
      '/shots/interview.mov',
      ...frames('/stills', 'IMG_', 1, 12, '.JPG'),
    ];
    const { sequences, rest } = numberedRuns(paths);
    expect(sequences).toEqual([
      { first: '/shots/plate_1001.dpx', count: 24 },
      { first: '/stills/IMG_0001.JPG', count: 12 },
    ]);
    expect(rest.sort()).toEqual(['/shots/interview.mov', '/shots/logo0001.png', '/shots/logo0002.png', '/shots/logo0003.png']);
  });

  it('keeps sequences in different folders, names or number widths apart', () => {
    const paths = [...frames('C:\\A', 'f', 1, 10, '.png'), ...frames('C:\\B', 'f', 1, 10, '.png'), ...frames('C:\\A', 'f', 1, 10, '.png', 6)];
    expect(numberedRuns(paths).sequences.map((s) => s.first)).toEqual(['C:\\A/f0001.png', 'C:\\B/f0001.png', 'C:\\A/f000001.png']);
  });
});
