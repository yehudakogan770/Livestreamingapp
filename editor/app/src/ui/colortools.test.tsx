import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { newGradeEffect, newNode } from '../model/grade';
import { newClip } from '../model/types';
import { exposure, ExposureButton } from './ExposureOverlay';
import { LutExportDialog, type LutIO } from './LutExport';

describe('Export the look as a LUT', () => {
  it('saves the chosen size as a .cube file', async () => {
    const clip = {
      ...newClip('v1', 0, 50, { kind: 'media', media: 'm', in: 0 }, 'Shot 4'),
      effects: [newGradeEffect({ steps: [{ kind: 'serial', node: { ...newNode(), p: { exposure: 0.5 } } }] })],
    };
    const io: LutIO = { saveAs: vi.fn(async (n: string) => `C:/Looks/${n}`), write: vi.fn(async () => {}), readText: vi.fn(async () => '') };
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<LutExportDialog clip={clip} at={0} onClose={onClose} onSaved={onSaved} io={io} />);
    fireEvent.click(screen.getByRole('radio', { name: 'For cameras and monitors' }));
    fireEvent.click(screen.getByRole('button', { name: /Save LUT/ }));
    await waitFor(() => expect(io.write).toHaveBeenCalled());
    const [path, text] = (io.write as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(path).toBe('C:/Looks/Shot 4.cube');
    expect(text).toMatch(/LUT_3D_SIZE 17/);
    expect(
      text
        .trim()
        .split('\n')
        .filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l)),
    ).toHaveLength(17 ** 3);
    expect(onSaved).toHaveBeenCalledWith('Saved Shot 4.cube (17×17×17)');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Exposure button', () => {
  it('turns false color and zebra on and sets the zebra level', () => {
    exposure.set({ mode: 'off', level: 95 });
    render(<ExposureButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Exposure overlay' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'False color' }));
    expect(exposure.state.mode).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Exposure overlay' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Zebra stripes' }));
    expect(exposure.state.mode).toBe('zebra');
    fireEvent.change(screen.getByRole('combobox', { name: 'Zebra level' }), { target: { value: '70' } });
    expect(exposure.state.level).toBe(70);
    exposure.set({ mode: 'off' });
  });
});
