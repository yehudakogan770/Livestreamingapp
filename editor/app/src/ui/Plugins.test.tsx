import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { addMedia } from '../model/build';
import { newPluginEffect, pluginChain, pluginOf, pluginSpan, PREROLL } from '../model/plugins';
import { current } from '../model/seq';
import { emptyProject, newClip, type MediaItem, type Project } from '../model/types';
import { withPluginsRendered } from '../export/plugins';
import { finishJobs } from '../export/audioplan';
import { PluginControls, PluginPicker } from './Plugins';

const found = {
  path: 'C:/Program Files/Common Files/VST3/Room.vst3',
  cid: 'AB'.repeat(16),
  name: 'Room Verb',
  vendor: 'Acme Audio',
  version: '1.2',
  subCategories: 'Fx|Reverb',
};
const settings = vi.fn((_path: string, _cid: string, state: string | null, set: [number, number][] = []) =>
  Promise.resolve({
    params: [
      { id: 1, title: 'Mix', units: '%', steps: 0, default: 0.3, value: set[0]?.[1] ?? 0.3, text: `${Math.round((set[0]?.[1] ?? 0.3) * 100)}`, bypass: false },
      { id: 2, title: 'Freeze', units: '', steps: 1, default: 0, value: 0, text: 'Off', bypass: false },
    ],
    state: set.length ? `S${set[0]?.[1]}` : (state ?? 'DEFAULT'),
  }),
);
vi.mock('../native', async (orig) => {
  const real = await orig<typeof import('../native')>();
  return {
    ...real,
    inApp: () => true,
    native: {
      ...real.native,
      vstScan: () => Promise.resolve({ effects: [found], broken: [{ path: 'C:/x/Broken.vst3', problem: 'The plug-in crashed' }], folders: ['C:/VST3'] }),
      vstSettings: (...a: Parameters<typeof settings>) => settings(...a),
      vstRender: () => new Promise<string>(() => {}),
    },
  };
});

const media: MediaItem = {
  id: 'm',
  name: 'Interview',
  path: '/m/interview.wav',
  proxy: null,
  kind: 'audio',
  duration: 60,
  width: 0,
  height: 0,
  fps: 0,
  hasVideo: false,
  hasAudio: true,
  bin: null,
};
function project(): Project {
  const p = addMedia({ ...emptyProject('P'), media: [media] }, 'm', 30, 'overwrite', undefined, undefined, { in: 10, out: 20 });
  const s = current(p);
  return { ...p, sequences: [{ ...s, clips: s.clips.map((c) => ({ ...c, effects: [newPluginEffect(found, 'fx1')] })) }] };
}

describe('VST3 plug-ins', () => {
  it('a clip plays the stretch it uses, with a little before so reverbs ring in', () => {
    const p = project();
    const c = current(p).clips[0] as NonNullable<ReturnType<typeof current>['clips'][0]>;
    expect(pluginChain(c)).toEqual([{ path: found.path, cid: found.cid, state: null }]);
    expect(pluginSpan(c, media, 30)).toEqual({ from: 10 - PREROLL, seconds: 12.5 });
    expect(pluginChain({ ...c, effects: [{ ...(c.effects[0] as NonNullable<(typeof c.effects)[0]>), on: false }] })).toEqual([]);
    const notMedia = newClip('a', 0, 30, { kind: 'color', color: '#000' }, 'x');
    expect(pluginSpan(notMedia, media, 30)).toBeNull();
  });

  it('the film plays the made file in place of the clip, without the plug-in effect, at the same moment', async () => {
    const p = project();
    const render = vi.fn(() => Promise.resolve('/cache/rendered.wav'));
    const q = await withPluginsRendered(p, render);
    expect(render).toHaveBeenCalledWith(media.path, 8, 12.5, [{ path: found.path, cid: found.cid, state: null }]);
    const c = current(q).clips[0];
    expect(c?.effects.some((e) => e.type === 'vst3')).toBe(false);
    expect(c?.source).toEqual({ kind: 'media', media: `plugins:${c?.id}`, in: 2 });
    expect(q.media.find((m) => m.id === `plugins:${c?.id}`)?.path).toBe('/cache/rendered.wav');
    // FFmpeg reads the made file from 2 s in (where the clip's sound starts in it).
    const jobs = finishJobs(q, current(q), { from: 30, to: 330 }, null, 'wav', false);
    const args = jobs.flatMap((j) => j.args).join(' ');
    expect(args).toContain('/cache/rendered.wav');
    expect(args).not.toContain('/m/interview.wav');
    // Nothing to do without plug-ins.
    const plain = { ...p, sequences: p.sequences.map((s) => ({ ...s, clips: s.clips.map((x) => ({ ...x, effects: [] })) })) };
    expect(await withPluginsRendered(plain, render)).toBe(plain);
  });

  it('the picker lists the plug-ins found, and those that could not be used', async () => {
    const pick = vi.fn();
    render(<PluginPicker onPick={pick} onClose={() => {}} />);
    await screen.findByText('Room Verb');
    expect(screen.getByText('Acme Audio')).toBeTruthy();
    expect(screen.getByText('Reverb')).toBeTruthy();
    expect(screen.getByText(/1 plug-in file could not be used/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find a plug-in'), { target: { value: 'delay' } });
    expect(screen.getByText('None match.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find a plug-in'), { target: { value: 'acme' } });
    fireEvent.click(screen.getByText('Room Verb'));
    expect(pick).toHaveBeenCalledWith(found);
  });

  it('reads the parameters once, and a change keeps the plug-in’s new state', async () => {
    const p = project();
    const clip = current(p).clips[0] as NonNullable<ReturnType<typeof current>['clips'][0]>;
    const effect = clip.effects[0] as NonNullable<(typeof clip.effects)[0]>;
    const onChange = vi.fn();
    const { rerender } = render(<PluginControls project={p} clip={clip} effect={effect} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const first = onChange.mock.calls[0]?.[0];
    expect(first.state).toBe('DEFAULT');
    expect(first.params.map((x: { title: string }) => x.title)).toEqual(['Mix', 'Freeze']);
    const updated = { ...effect, d: first };
    rerender(<PluginControls project={p} clip={clip} effect={updated} onChange={onChange} />);
    expect(pluginOf(updated)?.params).toHaveLength(2);
    const slider = screen.getByLabelText('Mix');
    await act(async () => {
      fireEvent.change(slider, { target: { value: '0.75' } });
      fireEvent.pointerUp(slider, { target: { value: '0.75' } });
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(settings).toHaveBeenLastCalledWith(found.path, found.cid, 'DEFAULT', [[1, 0.75]]);
    expect(onChange.mock.calls[1]?.[0].state).toBe('S0.75');
    expect(screen.getByText(/Acme Audio · Working in the background/)).toBeTruthy();
  });
});
