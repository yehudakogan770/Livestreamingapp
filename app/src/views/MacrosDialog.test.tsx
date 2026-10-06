import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { emptyShow } from '../engine/client';
import { demoApply } from '../engine/demo';
import type { Action } from '../engine/types/Action';
import type { Show } from '../engine/types/Show';
import { macroRecorder } from '../macros/macros';
import { MacrosDialog } from './MacrosDialog';
import { PresetButtons } from './PresetButtons';

function makeShow(): Show {
  let s = emptyShow();
  s = demoApply(s, { type: 'addSource', source: { id: 'cd', name: 'Countdown', kind: { type: 'pattern' } } }, 0);
  s.macros = [
    {
      id: 'm1',
      name: 'Start show',
      hotkey: 'Ctrl+1',
      steps: [
        { type: 'record', on: true },
        { type: 'wait', ms: 2000 },
        { type: 'stream', on: true },
        { type: 'cutTo', screen: 'live', sourceId: 'cd' },
      ],
    },
  ];
  return s;
}

describe('Macros dialog', () => {
  it('lists macros with their key, and runs one', () => {
    const act = vi.fn<(a: Action) => void>();
    render(<MacrosDialog show={makeShow()} act={act} onClose={() => {}} />);
    expect(screen.getByText(/4 steps · Ctrl\+1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run Start show' }));
    expect(act).toHaveBeenCalledWith({ type: 'runMacro', id: 'm1' });
    expect(screen.getByText('Start or stop recording', { selector: '.pe__kind' })).toBeInTheDocument();
  });

  it('adds a macro and renames it', () => {
    const act = vi.fn<(a: Action) => void>();
    const show = makeShow();
    const { rerender } = render(<MacrosDialog show={show} act={act} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add a macro' }));
    const set = act.mock.calls[0]![0] as Extract<Action, { type: 'setMacros' }>;
    expect(set.macros).toHaveLength(2);
    expect(set.macros[1]).toMatchObject({ name: 'Macro 2', steps: [], hotkey: '' });
    rerender(<MacrosDialog show={{ ...show, macros: set.macros }} act={act} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Macro name' }), { target: { value: 'End show' } });
    expect(act).toHaveBeenLastCalledWith({ type: 'setMacros', macros: [show.macros[0], { ...set.macros[1], name: 'End show' }] });
  });

  it('takes the next key pressed as the macro key, and warns about keys in use', () => {
    const act = vi.fn<(a: Action) => void>();
    render(<MacrosDialog show={makeShow()} act={act} onClose={() => {}} />);
    const box = screen.getByRole('button', { name: 'Macro key' });
    fireEvent.click(box);
    expect(box).toHaveTextContent('Press a key…');
    fireEvent.keyDown(box, { key: 'F9', code: 'F9' });
    expect(act).toHaveBeenLastCalledWith({ type: 'setMacros', macros: [expect.objectContaining({ hotkey: 'F9' })] });
  });

  it('sets a daily time as a trigger that runs the macro', () => {
    const act = vi.fn<(a: Action) => void>();
    render(<MacrosDialog show={makeShow()} act={act} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Run it by itself at/ }));
    expect(act).toHaveBeenLastCalledWith({
      type: 'setTriggers',
      triggers: [
        expect.objectContaining({
          id: 'macro-at-m1',
          when: expect.objectContaining({ type: 'atTime', minute: 19 * 60 + 30 }),
          steps: [{ type: 'macro', macroId: 'm1' }],
        }),
      ],
    });
  });

  it('records what the operator does into the macro', () => {
    const act = vi.fn<(a: Action) => void>();
    const show = makeShow();
    render(<MacrosDialog show={show} act={act} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Record steps/ }));
    expect(screen.getByRole('status', { name: 'Recording a macro' })).toBeInTheDocument();
    macroRecorder.capture({ type: 'setOverlayOn', channel: 0, value: true }, Date.now());
    fireEvent.click(screen.getByRole('button', { name: /Stop recording/ }));
    const set = act.mock.calls.at(-1)![0] as Extract<Action, { type: 'setMacros' }>;
    expect(set.macros[0]!.steps.at(-1)).toEqual({ type: 'overlay', channel: 0, value: true });
  });
});

describe('Macro buttons above the inputs', () => {
  it('shows each macro with steps as a button', () => {
    const act = vi.fn<(a: Action) => void>();
    const show = makeShow();
    show.macros.push({ id: 'empty', name: 'Nothing yet', hotkey: '', steps: [] });
    render(<PresetButtons show={show} act={act} showAll={false} onShowAll={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Nothing yet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start show' }));
    expect(act).toHaveBeenCalledWith({ type: 'runMacro', id: 'm1' });
  });
});
