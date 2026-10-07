import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { emptyShow, type EngineClient } from '../engine/client';
import type { Action } from '../engine/types/Action';
import { DataDialog } from './DataDialog';

function setup(path = '') {
  const dispatch = vi.fn(async (_a: Action) => ({}));
  const client = { dispatch, pickDataFile: async () => null } as unknown as EngineClient;
  const show = emptyShow();
  show.data = { ...show.data, path };
  render(<DataDialog show={show} client={client} onClose={() => {}} />);
  return dispatch;
}

describe('Data file dialog', () => {
  it('uses a Google Sheet link, read every 5 seconds at most', () => {
    const dispatch = setup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Google Sheet link' }), {
      target: { value: 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=7' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Use this link/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setDataFile',
      path: 'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=7',
      everyMs: 5000,
    });
  });

  it('says what is wrong with something that is not a link', () => {
    const dispatch = setup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Google Sheet link' }), { target: { value: 'my sheet' } });
    fireEvent.click(screen.getByRole('button', { name: /Use this link/ }));
    expect(screen.getByText('Paste a link that starts with https://')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('offers only slower reading for a web link', () => {
    setup('https://docs.google.com/spreadsheets/d/abc/export?format=csv');
    const options = [...screen.getByRole('combobox').querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['5 s', '10 s', '15 s', '30 s', '60 s']);
    expect(screen.getByText('Google Sheet or web link')).toBeInTheDocument();
  });
});
