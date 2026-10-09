// The color picker: HSB ⇄ RGB ⇄ HEX exactly, numbers typed, the event
// look's colors (as links to the look) and the title's swatches.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker, hexToHsv, hsvToHex, hsvToRgb, SwatchContext, type Swatches } from './ColorPicker';
import { ColorField } from './fields';
import { DEFAULT_TOKENS } from '../core/binding';

describe('color picker', () => {
  it('converts both ways without drifting', () => {
    for (const hex of ['#000000', '#ffffff', '#d23c3c', '#3fa34d', '#6f5fd0', '#123456', '#fedcba80']) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(hexToHsv('#ff0000')).toMatchObject({ h: 0, s: 100, v: 100, a: 1 });
    expect(hsvToRgb({ h: 120, s: 100, v: 50 })).toEqual([0, 128, 0]);
    expect(hexToHsv('#f00')).toMatchObject({ h: 0, s: 100, v: 100 });
  });

  it('typed numbers change the color: HSB, RGB and opacity', () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#ff0000" onChange={onChange} label="Fill" />);
    fireEvent.change(screen.getByLabelText('Fill H'), { target: { value: '240' } });
    expect(onChange).toHaveBeenLastCalledWith('#0000ff');
    fireEvent.change(screen.getByLabelText('Fill G'), { target: { value: '255' } });
    expect(onChange).toHaveBeenLastCalledWith('#00ffff');
    fireEvent.change(screen.getByLabelText('Fill A'), { target: { value: '50' } });
    expect(onChange).toHaveBeenLastCalledWith('#00ffff80');
  });

  it('the event look’s colors link to the look; swatches are added and used', () => {
    const list: string[] = ['#112233'];
    const sw: Swatches = { list, add: vi.fn((c) => list.push(c)), remove: vi.fn(), brand: [['accent', DEFAULT_TOKENS.accent]] };
    const onChange = vi.fn();
    render(
      <SwatchContext.Provider value={sw}>
        <ColorField value="#ff0000" onChange={onChange} tokens={DEFAULT_TOKENS} values={{}} label="Box" />
      </SwatchContext.Provider>,
    );
    fireEvent.click(screen.getByLabelText('Box color'));
    fireEvent.click(screen.getByLabelText('Event look accent'));
    expect(onChange).toHaveBeenLastCalledWith('$accent');
    fireEvent.click(screen.getByLabelText('Swatch #112233'));
    expect(onChange).toHaveBeenLastCalledWith('#112233');
    fireEvent.click(screen.getByLabelText('Add this color to the swatches'));
    expect(sw.add).toHaveBeenCalled();
    // Escape closes it.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
