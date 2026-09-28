import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DemoClient, type RemoteStatus } from '../engine/client';
import { RemoteDialog } from './RemoteDialog';

const on: RemoteStatus = {
  enabled: true,
  running: true,
  pin: '4821',
  port: 8765,
  addresses: [
    { url: 'http://192.168.1.20:8765', qr: '<svg/>' },
    { url: 'http://10.0.0.5:8765', qr: '<svg/>' },
  ],
  phones: 2,
  error: null,
};

describe('Phone remote dialog', () => {
  it('shows the address, QR code, PIN and connected phones', () => {
    render(<RemoteDialog client={new DemoClient()} status={on} onClose={() => {}} />);
    expect(screen.getByTestId('remote-url')).toHaveTextContent('http://192.168.1.20:8765');
    expect(screen.getByTestId('remote-pin')).toHaveTextContent('4821');
    expect(screen.getByAltText(/QR code/)).toBeInTheDocument();
    expect(screen.getByText('2 phones connected')).toBeInTheDocument();
    // Another network's address can be shown instead.
    fireEvent.click(screen.getByRole('button', { name: '10.0.0.5:8765' }));
    expect(screen.getByTestId('remote-url')).toHaveTextContent('http://10.0.0.5:8765');
  });

  it('turns on from the dialog, and explains when it could not start', () => {
    const client = new DemoClient();
    Object.defineProperty(client, 'live', { value: true });
    const setRemote = vi.spyOn(client, 'setRemote').mockResolvedValue(on);
    const off: RemoteStatus = {
      ...on,
      enabled: false,
      running: false,
      port: null,
      addresses: [],
      phones: 0,
    };
    const { rerender } = render(<RemoteDialog client={client} status={off} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on the phone remote' }));
    expect(setRemote).toHaveBeenCalledWith(true);
    rerender(<RemoteDialog client={client} status={{ ...off, enabled: true, error: 'no free network port' }} onClose={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('no free network port');
  });
});
