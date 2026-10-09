import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Doc } from '../doc';
import { MASTER, mixOf, stripFx } from '../model/mix';
import { current } from '../model/seq';
import { emptyProject } from '../model/types';
import type { Engine } from '../player/engine';
import { eqPath, Mixer } from './Mixer';

const engine = { levels: () => ({}), setMaster: () => {} } as unknown as Engine;

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

  it('draws a flat line for a flat equalizer', () => {
    expect(
      eqPath(undefined, 100, 50)
        .split('L')
        .every((pt) => pt.endsWith(',25.0')),
    ).toBe(true);
  });
});
