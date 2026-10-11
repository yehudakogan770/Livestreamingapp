import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DemoClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { ChatPanel } from './ChatPanel';

async function showWithQuestions(): Promise<Show> {
  const show = (await new DemoClient().getShow()).show;
  show.qna = {
    open: true,
    moderate: true,
    nextId: 3,
    questions: [
      { id: 1, author: 'Ana', text: 'Will the slides be shared?', at: 1, shown: false, votes: 2, approved: true },
      { id: 2, author: '', text: 'Can we see the demo again?', at: 2, shown: false, votes: 0, approved: false },
      { id: 3, author: 'Ben', text: 'When is lunch?', at: 3, shown: false, votes: 7, approved: true },
    ],
  };
  return show;
}

describe('audience questions in the control window', () => {
  it('lists those waiting first, then by votes, and approves one', async () => {
    const act = vi.fn();
    render(<ChatPanel show={await showWithQuestions()} act={act} onAdd={() => {}} onClose={() => {}} client={new DemoClient()} />);
    fireEvent.click(screen.getByRole('tab', { name: /Questions/ }));
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => within(i).getByText(/\?$/).textContent)).toEqual(['Can we see the demo again?', 'When is lunch?', 'Will the slides be shared?']);
    expect(screen.getByText('1 waiting for approval')).toBeInTheDocument();
    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Approve' }));
    expect(act).toHaveBeenCalledWith({ type: 'qnaApprove', question: 2, value: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /Hold new questions/ }));
    expect(act).toHaveBeenCalledWith({ type: 'qnaModerate', value: false });
    fireEvent.click(screen.getByRole('radio', { name: 'Newest' }));
    expect(screen.getAllByRole('listitem').map((i) => within(i).getByText(/\?$/).textContent)).toEqual([
      'Can we see the demo again?',
      'When is lunch?',
      'Will the slides be shared?',
    ]);
  });
});
