import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LoudnessMeter } from '../audio/loudness';
import { LoudnessReadout } from './LoudnessMeter';

/** A meter that has heard `seconds` of steady sound at `level` LUFS. */
function heard(level: number, seconds: number): LoudnessMeter {
  const m = new LoudnessMeter();
  const power = 10 ** ((level + 0.691) / 10);
  for (let i = 0; i < seconds * 10; i++) m.add(power);
  return m;
}

describe('Loudness readout', () => {
  it('shows the last 3 seconds and how far from the target', () => {
    render(<LoudnessReadout meter={heard(-20, 5)} />);
    expect(screen.getByTestId('lufs-short')).toHaveTextContent('−20.0');
    fireEvent.click(screen.getByRole('button', { name: /LUFS/ }));
    expect(screen.getByRole('status')).toHaveTextContent('6 dB too quiet');
    fireEvent.change(screen.getByRole('combobox', { name: 'Loudness target' }), { target: { value: '-23' } });
    expect(screen.getByRole('status')).toHaveTextContent('3 dB too loud');
    fireEvent.change(screen.getByRole('combobox', { name: 'Loudness target' }), { target: { value: '-16' } });
    expect(screen.getByRole('status')).toHaveTextContent('4 dB too quiet');
  });

  it('starts the whole-event reading again', () => {
    render(<LoudnessReadout meter={heard(-16, 5)} />);
    fireEvent.click(screen.getByRole('button', { name: /LUFS/ }));
    expect(screen.getByTestId('lufs-integrated')).toHaveTextContent('−16.0');
    fireEvent.click(screen.getByRole('button', { name: /Start the whole-event reading again/ }));
    expect(screen.getByTestId('lufs-integrated')).toHaveTextContent('−∞');
  });
});
