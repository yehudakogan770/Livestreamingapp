import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DemoClient } from '../engine/client';
import { newPoll } from '../engine/poll';
import type { Source } from '../engine/types/Source';
import type { Poll } from '../engine/types/Poll';
import { PollCard } from './PollCard';
import { PollView } from '../components/PollView';

const source = (p: Poll, name = 'Feedback'): Source => ({ id: 'p1', name, kind: { type: 'poll', ...p } }) as unknown as Source;

describe('word clouds and ratings in the control window', () => {
  it('lists the words sent, and takes one out of the cloud', () => {
    const p = newPoll('words', 'One word for today?');
    p.words = [
      { text: 'calm', count: 1 },
      { text: 'Inspiring', count: 4 },
    ];
    const act = vi.fn();
    render(<PollCard source={source(p)} act={act} client={new DemoClient()} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Word cloud' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Words sent' });
    expect(list.textContent).toMatch(/^Inspiring4.*calm1/);
    fireEvent.click(screen.getByRole('button', { name: 'Take “calm” out of the cloud' }));
    expect(act).toHaveBeenCalledWith({ type: 'pollWordRemove', id: 'p1', word: 'calm' });
    expect(screen.getByText('5 words so far.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start taking words/ })).toBeInTheDocument();
  });

  it('shows a rating’s average and comments, and exports them', async () => {
    const p = newPoll('rating', 'How was the session?');
    p.votes = [0, 0, 1, 1, 2];
    p.comments = [{ stars: 5, text: 'Clear and useful', at: 1 }];
    const client = new DemoClient();
    const save = vi.spyOn(client, 'saveCsv').mockResolvedValue('C:\\Results\\Feedback.csv');
    render(<PollCard source={source(p)} act={vi.fn()} client={client} onClose={() => {}} />);
    expect(screen.getByText('4 ratings so far, averaging 4.3 stars.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Comments' }).textContent).toContain('Clear and useful');
    fireEvent.click(screen.getByRole('button', { name: /Export results/ }));
    await screen.findByText('Saved to C:\\Results\\Feedback.csv');
    const [name, text] = save.mock.calls[0]!;
    expect(name).toMatch(/^Feedback \d{4}-\d\d-\d\d\.csv$/);
    expect(text).toContain('Average,4.25');
    expect(text).toContain('Clear and useful');
  });

  it('draws a cloud and stars on screen', () => {
    const words = newPoll('words', 'One word?');
    words.words = [
      { text: 'joy', count: 3 },
      { text: 'focus', count: 1 },
    ];
    const { container, unmount } = render(<PollView p={words} />);
    expect([...container.querySelectorAll('.poll__word')].map((w) => w.textContent)).toEqual(['joy', 'focus']);
    unmount();
    const rating = newPoll('rating', 'Rate it');
    rating.votes = [0, 0, 0, 0, 2];
    const r = render(<PollView p={rating} />);
    expect(r.container.querySelector('.poll__avg')?.textContent).toBe('5.0');
    expect(r.container.querySelectorAll('.poll__dist li')).toHaveLength(5);
  });
});
