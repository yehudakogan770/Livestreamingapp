import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { cleanPort, configOf, examples, apiStatus } from '../control/api';
import { ControlApiDialog } from './ControlApiDialog';

describe('control API settings', () => {
  it('accepts only usable ports', () => {
    expect(cleanPort(' 8095 ')).toBe(8095);
    expect(cleanPort('80')).toBeNull();
    expect(cleanPort('70000')).toBeNull();
    expect(cleanPort('80.5')).toBeNull();
    expect(cleanPort('')).toBeNull();
  });

  it('gives example addresses with the token', () => {
    const list = examples('http://10.0.0.5:8095', 'TOKEN');
    expect(list.find((x) => x.what.startsWith('CUT'))?.url).toBe('http://10.0.0.5:8095/api/do/cut?token=TOKEN');
    expect(list.find((x) => x.what.startsWith('Input 3'))?.url).toBe('http://10.0.0.5:8095/api/do/preview?input=3&token=TOKEN');
    expect(list.some((x) => x.url.includes('/api/tally/1'))).toBe(true);
  });

  it('keeps only the settings from a status', async () => {
    const st = await apiStatus();
    expect(Object.keys(configOf(st)).sort()).toEqual(['enabled', 'osc', 'oscLocalOnly', 'oscPort', 'port', 'token']);
  });
});

describe('Control API dialog', () => {
  it('turns the API on, hides the token until asked, and warns about OSC from the network', async () => {
    render(<ControlApiDialog onClose={() => {}} />);
    const http = await screen.findByRole('checkbox', { name: /HTTP and WebSocket/ });
    expect(screen.getByTestId('api-token').textContent).toMatch(/^•+$/);
    await act(async () => {
      fireEvent.click(http);
    });
    expect(await screen.findByText(/Listening/)).toBeInTheDocument();
    expect(screen.getByText('http://192.168.1.20:8095')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show the token' }));
    expect(screen.getByTestId('api-token').textContent).not.toMatch(/•/);

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /OSC \(UDP\)/ }));
    });
    expect(screen.queryByText(/OSC has no token/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Only from this computer/ }));
    });
    expect(screen.getByText(/OSC has no token/)).toBeInTheDocument();
  });

  it('asks before making a new token', async () => {
    render(<ControlApiDialog onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /New token/ }));
    expect(screen.getByText(/Everything using the old token stops working/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep this one' }));
    expect(screen.queryByText(/Everything using the old token stops working/)).toBeNull();
  });
});
