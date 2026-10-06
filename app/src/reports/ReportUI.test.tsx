import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const sent: unknown[] = [];
vi.mock('./reporter', () => ({
  sendProblemReport: async (r: unknown) => void sent.push(r),
  collectCrashReports: async () => {},
}));

const { ReportDialog } = await import('./ReportUI');

describe('the Report a problem window', () => {
  it('sends what the person wrote and says so', async () => {
    const close = vi.fn();
    render(<ReportDialog product="Lumora" onClose={close} />);
    const send = screen.getByRole('button', { name: 'Send report' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The countdown froze' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('Sent');
    expect(sent).toEqual([{ description: 'The countdown froze', screenshot: null, logs: false }]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(close).toHaveBeenCalled();
  });
});
