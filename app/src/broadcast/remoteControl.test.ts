import { describe, expect, it, vi } from 'vitest';
import { defaultCaptureSettings, type CaptureStatus } from '../engine/client';
import { remoteAppState, runRemoteCommand, type RemoteOps } from './remoteControl';

function ops(over: Partial<RemoteOps> = {}, status: Partial<CaptureStatus> = {}): RemoteOps {
  return {
    status: { recording: null, streaming: null, ...status } as CaptureStatus,
    settings: { ...defaultCaptureSettings(), destinations: [{ id: 'd1', name: 'YouTube', key: 'k', enabled: true, url: 'rtmp://example/live' }] },
    busy: { record: false, stream: false },
    rehearsal: false,
    replayOn: false,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setRehearsal: vi.fn(),
    setReplay: vi.fn(),
    makeReplay: vi.fn(async () => 'replay'),
    ...over,
  };
}

const running = { session: 1 } as unknown as CaptureStatus['recording'];

describe('requests from a control surface', () => {
  it('starts and stops the recording, and does nothing when it is already so', async () => {
    const o = ops();
    await runRemoteCommand({ command: 'record', on: true }, o);
    expect(o.start).toHaveBeenCalledWith('record');
    const r = ops({}, { recording: running });
    await runRemoteCommand({ command: 'record', on: true }, r);
    expect(r.start).not.toHaveBeenCalled();
    await runRemoteCommand({ command: 'record', on: false }, r);
    expect(r.stop).toHaveBeenCalledWith('record');
  });

  it('never starts twice while starting', async () => {
    const o = ops({ busy: { record: true, stream: true } });
    await runRemoteCommand({ command: 'record', on: true }, o);
    await runRemoteCommand({ command: 'stream', on: true }, o);
    expect(o.start).not.toHaveBeenCalled();
  });

  it('goes live only with somewhere to go (a rehearsal needs nowhere)', async () => {
    const nowhere = ops({ settings: { ...defaultCaptureSettings(), destinations: [] } });
    await expect(runRemoteCommand({ command: 'stream', on: true }, nowhere)).rejects.toThrow(/where to stream/);
    expect(nowhere.start).not.toHaveBeenCalled();
    const rehearse = ops({ settings: { ...defaultCaptureSettings(), destinations: [] }, rehearsal: true });
    await runRemoteCommand({ command: 'stream', on: true }, rehearse);
    expect(rehearse.start).toHaveBeenCalledWith('stream');
    const live = ops({}, { streaming: running as unknown as CaptureStatus['streaming'] });
    await runRemoteCommand({ command: 'stream', on: false }, live);
    expect(live.stop).toHaveBeenCalledWith('stream');
  });

  it('rehearsal is chosen before going live', async () => {
    const o = ops();
    await runRemoteCommand({ command: 'rehearsal', on: true }, o);
    expect(o.setRehearsal).toHaveBeenCalledWith(true);
    const live = ops({}, { streaming: running as unknown as CaptureStatus['streaming'] });
    await expect(runRemoteCommand({ command: 'rehearsal', on: true }, live)).rejects.toThrow(/before going live/);
  });

  it('switches instant replay on, and replays in slow motion when asked', async () => {
    const o = ops();
    await runRemoteCommand({ command: 'replayBuffer', on: true }, o);
    expect(o.setReplay).toHaveBeenCalledWith(true);
    await runRemoteCommand({ command: 'replay', seconds: 10, slow: true }, o);
    expect(o.makeReplay).toHaveBeenCalledWith(10, 0.5);
    await runRemoteCommand({ command: 'replay', seconds: 5 }, o);
    expect(o.makeReplay).toHaveBeenLastCalledWith(5, 1);
  });
});

describe('what control surfaces are told', () => {
  it('says what is running', () => {
    const o = ops({ rehearsal: true, replayOn: true, busy: { record: false, stream: true } }, { recording: running });
    expect(remoteAppState(o, null)).toEqual({ recording: true, streaming: false, rehearsal: true, replay: true, busy: true, error: null });
  });
});
