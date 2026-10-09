// The Formats section: make a 9:16 format, open it, remake it.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fromTemplate, starterTemplates } from '../core/templates';
import { CompositionPanel } from './Panels';
import { Store } from './store';

describe('formats in the Composition panel', () => {
  it('makes a 9:16 format and opens it', () => {
    const s = new Store(fromTemplate(starterTemplates().find((t) => t.name === 'Breaking banner')!));
    render(<CompositionPanel store={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Formats' }));
    fireEvent.change(screen.getByLabelText('Add a format'), { target: { value: '9:16 vertical' } });
    const p = s.get().project;
    expect(p.compositions).toHaveLength(2);
    const v = p.compositions[1]!;
    expect(v).toMatchObject({ width: 1080, height: 1920, variantOf: p.main });
    expect(s.get().compId).toBe(v.id);
    expect(screen.getByText(`${p.compositions[0]!.name} (main)`)).toBeInTheDocument();
  });
});
