import { describe, expect, it, vi } from 'vitest';
import { act as flush, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultBackup } from '../engine/backup';
import { DemoClient, emptyShow } from '../engine/client';
import { demoApply } from '../engine/demo';
import { InputHealth } from '../engine/inputHealth';
import type { Action } from '../engine/types/Action';
import type { Show } from '../engine/types/Show';
import { BackupDialog, BackupLog, BackupNotices, BackupWatcher } from './BackupLineup';

function makeShow(): Show {
  let s = emptyShow();
  for (const [id, name] of [
    ['cam1', 'Camera 1'],
    ['cam2', 'Camera 2'],
    ['wide', 'Wide shot'],
  ] as const)
    s = demoApply(s, { type: 'addSource', source: { id, name, kind: { type: 'camera', deviceId: id, label: id } } }, 0);
  s = demoApply(s, { type: 'addSource', source: { id: 'bars', name: 'Bars', kind: { type: 'pattern' } } }, 0);
  s.screens.live.program = 'cam1';
  s.event.backup = defaultBackup();
  return s;
}

describe('Backup lineup dialog', () => {
  it('shows the automatic lineup, and turns it off', () => {
    const act = vi.fn<(a: Action) => void>();
    render(<BackupDialog show={makeShow()} act={act} onClose={() => {}} />);
    const list = screen.getByRole('list', { name: 'Lineup order' });
    expect(list).toHaveTextContent(/1Camera 1On air2Camera 23Wide shot4If none has a picture: the logo/);
    fireEvent.click(screen.getByRole('checkbox', { name: /switch to the next one in the lineup by itself/ }));
    expect(act).toHaveBeenCalledWith({ type: 'setBackupOn', value: false });
  });

  it('makes the order the operator’s own, and moves an input up', () => {
    const act = vi.fn<(a: Action) => void>();
    const show = makeShow();
    const { rerender } = render(<BackupDialog show={show} act={act} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'My own order' }));
    expect(act).toHaveBeenLastCalledWith({ type: 'updateEvent', patch: { backup: { ...defaultBackup(), lineup: ['cam1', 'cam2', 'wide'] } } });
    show.event.backup = { ...defaultBackup(), lineup: ['cam1', 'cam2', 'wide'] };
    rerender(<BackupDialog show={{ ...show }} act={act} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Wide shot up' }));
    expect(act).toHaveBeenLastCalledWith({ type: 'updateEvent', patch: { backup: { ...defaultBackup(), lineup: ['cam1', 'wide', 'cam2'] } } });
    // Other inputs can be added.
    fireEvent.change(screen.getByRole('combobox', { name: 'Input to add' }), { target: { value: 'bars' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(act).toHaveBeenLastCalledWith({
      type: 'updateEvent',
      patch: { backup: { ...defaultBackup(), lineup: ['cam1', 'cam2', 'wide', 'bars'] } },
    });
  });

  it('switching back by itself is off until chosen', () => {
    const act = vi.fn<(a: Action) => void>();
    render(<BackupDialog show={makeShow()} act={act} onClose={() => {}} />);
    const back = screen.getByRole('checkbox', { name: /Switch back by itself/ });
    expect(back).not.toBeChecked();
    fireEvent.click(back);
    expect(act).toHaveBeenLastCalledWith({ type: 'updateEvent', patch: { backup: { ...defaultBackup(), switchBack: true } } });
  });

  it('“Try it” pretends the input on air lost its picture', () => {
    const health = new InputHealth(() => 0);
    render(<BackupDialog show={makeShow()} act={() => {}} onClose={() => {}} health={health} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }));
    expect(health.down('cam1', 1500)).toBe('No signal (test)');
  });
});

describe('Backup notices', () => {
  it('says what switched and when, and offers to take a camera that is back', () => {
    const log = new BackupLog();
    const act = vi.fn<(a: Action) => void>();
    const show = makeShow();
    render(<BackupNotices act={act} log={log} />);
    flush(() => {
      log.push({ kind: 'switched', screen: 'live', from: 'cam1', to: 'cam2', at: 0 }, show, new Date(2026, 9, 6, 20, 42, 10).getTime());
    });
    expect(screen.getByRole('status')).toHaveTextContent('Camera 1 lost: switched to Camera 2');
    expect(screen.getByRole('status')).toHaveTextContent(/8:42:10/);
    flush(() => {
      log.push({ kind: 'back', screen: 'live', from: 'cam1', to: 'cam2', at: 5 }, show);
    });
    // The newer word replaces the older one.
    expect(screen.queryByText(/switched to Camera 2/)).toBeNull();
    expect(screen.getByText('Camera 1 is back')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take Camera 1' }));
    expect(act).toHaveBeenCalledWith({ type: 'cutTo', screen: 'live', sourceId: 'cam1' });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Backup watcher', () => {
  it('cuts to the next camera when the one on air loses its picture, and marks it', async () => {
    const health = new InputHealth(() => 0);
    const log = new BackupLog();
    const client = new DemoClient(makeShow());
    const dispatch = vi.spyOn(client, 'dispatch').mockResolvedValue();
    vi.spyOn(client, 'streamStatus').mockResolvedValue({});
    render(<BackupWatcher show={makeShow()} client={client} health={health} log={log} intervalMs={20} />);
    flush(() => health.simulate('cam1', 60_000));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'cutTo', screen: 'live', sourceId: 'cam2' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setNoSignal', ids: ['cam1'] });
    expect(log.all().map((n) => n.kind)).toEqual(['switched']);
  });
});
