import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Doc } from '../doc';
import { MASTER, mixOf, stripFx } from '../model/mix';
import { current } from '../model/seq';
import { emptyProject } from '../model/types';
import type { Engine } from '../player/engine';
import { eqPath, Mixer } from './Mixer';

const engine = { levels: () => ({}), setMaster: () => {}, subscribe: () => () => {}, time: 0, isPlaying: false, touchVolume: () => {} } as unknown as Engine;

describe('the mixer', () => {
  it("switches a track's processing on from its strip, and sets it in the strip panel", () => {
    const doc = new Doc(emptyProject('t'));
    render(<Mixer doc={doc} engine={engine} />);
    const a1 = current(doc.project).tracks.find((t) => t.kind === 'audio')!;
    fireEvent.click(screen.getAllByTitle(/^Equalizer: off/)[0]!);
    expect(stripFx(current(doc.project), a1.id).map((e) => [e.type, e.on])).toEqual([['eq', true]]);
    // The strip's panel: the dynamics switched on there.
    fireEvent.click(screen.getByTitle('A1: processing and output'));
    expect(screen.getByRole('complementary', { name: 'A1: processing' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    expect(stripFx(current(doc.project), a1.id).map((e) => e.type)).toEqual(['eq', 'compressor']);
  });

  it('adds a bus, sends a track to it, and processes the whole mix', () => {
    const doc = new Doc(emptyProject('t'));
    render(<Mixer doc={doc} engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bus' }));
    const bus = mixOf(current(doc.project)).buses[0]!;
    expect(bus.name).toBe('Bus 1');
    fireEvent.change(screen.getByLabelText('A1: plays through'), { target: { value: bus.id } });
    expect(current(doc.project).tracks.find((t) => t.name === 'A1')?.bus).toBe(bus.id);
    fireEvent.click(screen.getAllByTitle(/^Limiter: off/).at(-1)!);
    expect(stripFx(current(doc.project), MASTER).map((e) => e.type)).toEqual(['limiter']);
  });

  it('records fader moves while the film plays, then follows them; moving it after moves the whole line', () => {
    const doc = new Doc(emptyProject('t'));
    const touched: (number | null)[] = [];
    const playing = { ...engine, time: 100, isPlaying: true, touchVolume: (_t: string, db: number | null) => touched.push(db) } as unknown as Engine & {
      time: number;
    };
    const { rerender } = render(<Mixer doc={doc} engine={playing} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Record fader moves' })[0]!);
    const fader = screen.getByLabelText('A1 volume');
    fireEvent.pointerDown(fader);
    fireEvent.change(fader, { target: { value: '-10' } });
    playing.time = 200;
    fireEvent.change(fader, { target: { value: '-20' } });
    fireEvent.pointerUp(fader);
    const a1 = () => current(doc.project).tracks.find((t) => t.name === 'A1')!;
    expect(a1().volumeLine).toEqual([
      [100, -10],
      [200, -20],
    ]);
    // Heard while held, then back to the line.
    expect(touched).toEqual([-10, -20, null]);
    expect(doc.undoLabel).toBe('Record fader moves');
    // Recording off: the fader moves the whole line.
    fireEvent.click(screen.getAllByRole('button', { name: 'Record fader moves' })[0]!);
    rerender(<Mixer doc={doc} engine={playing} />);
    fireEvent.change(screen.getByLabelText('A1 volume'), { target: { value: '-14' } });
    expect(a1().volumeLine).toEqual([
      [100, -4],
      [200, -14],
    ]);
  });

  it('draws a flat line for a flat equalizer', () => {
    expect(
      eqPath(undefined, 100, 50)
        .split('L')
        .every((pt) => pt.endsWith(',25.0')),
    ).toBe(true);
  });
});
