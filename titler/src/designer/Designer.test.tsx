import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Designer } from './Designer';
import type { Host } from './host';
import type { TitleProject } from '../core/types';
import { ControlPanel } from './ControlPanel';
import { starterTemplates } from '../core/templates';
import type { BrowserEnv } from '../core/browserEnv';

// Each test starts from the standard workspace (the layout is kept in this browser).
beforeEach(() => localStorage.clear());

function memoryHost(): Host & { saved: TitleProject[]; library: Map<string, TitleProject> } {
  const library = new Map<string, TitleProject>();
  const saved: TitleProject[] = [];
  return {
    kind: 'web',
    libraryName: 'this test',
    renderFormats: ['png-sequence'],
    saved,
    library,
    listLibrary: async () => [...library.entries()].map(([id, p]) => ({ id, name: p.name, category: p.category, modified: 0 })),
    readLibrary: async (id) => ({ project: library.get(id) ?? null, error: library.has(id) ? null : 'gone', notes: [] }),
    saveLibrary: async (p, id) => {
      const key = id ?? p.id;
      library.set(key, p);
      return key;
    },
    removeLibrary: async (id) => void library.delete(id),
    openFile: async () => null,
    saveFile: async (p) => {
      saved.push(p);
      return `${p.name}.lumtitle`;
    },
    pickFiles: async () => [],
    urlFor: (s) => s,
    autosave: () => {},
    recover: async () => null,
  };
}

const env: BrowserEnv = {
  createCanvas: () => null,
  image: () => null,
  onReady: () => () => {},
  prepare: async () => {},
};

async function openTemplate(name: string) {
  const lib = screen.getByTestId('titler-library');
  await act(async () => {
    fireEvent.click(within(lib).getByText(name));
  });
}

describe('the designer', () => {
  it('opens a template from the library with its layers and fields', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Name and role');
    expect(screen.getByLabelText('Title name')).toHaveValue('Name and role');
    const tl = screen.getByTestId('titler-timeline');
    expect(within(tl).getByText('Name')).toBeInTheDocument();
    expect(within(tl).getByText('Accent bar')).toBeInTheDocument();
    expect(within(tl).getByText('IN')).toBeInTheDocument();
    expect(within(tl).getByText('OUT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fields' }));
    const cp = screen.getByTestId('titler-control-panel');
    expect(within(cp).getByLabelText('Name')).toHaveValue('Jordan Avery');
  });

  it('edits a layer, and undo puts it back', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Name and role');
    const tl = screen.getByTestId('titler-timeline');
    fireEvent.click(within(tl).getByText('Name'));
    const inspector = screen.getByTestId('titler-inspector');
    const words = within(inspector).getByLabelText('Words');
    expect(words).toHaveValue('{{name}}');
    fireEvent.change(words, { target: { value: '{{name}} and guest' } });
    expect(within(screen.getByTestId('titler-inspector')).getByLabelText('Words')).toHaveValue('{{name}} and guest');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(screen.getByTestId('titler-inspector')).getByLabelText('Words')).toHaveValue('{{name}}');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(within(screen.getByTestId('titler-inspector')).getByLabelText('Words')).toHaveValue('{{name}} and guest');
  });

  it('keyboard: duplicate, delete, add text, tools', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Live bug');
    const tl = () => screen.getByTestId('titler-timeline');
    fireEvent.click(within(tl()).getByText('Live box'));
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    expect(within(tl()).getByText('Live box copy')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(within(tl()).queryByText('Live box copy')).toBeNull();
    fireEvent.keyDown(window, { key: 'n' });
    expect(within(screen.getByTestId('titler-inspector')).getByLabelText('Words')).toHaveValue('Text');
    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.getByRole('button', { name: 'Pen (paths)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('animates a property from the timeline (the stopwatch) and shows the keyframe', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Logo bug');
    const tl = screen.getByTestId('titler-timeline');
    fireEvent.click(within(tl).getByText('Logo'));
    const inspector = screen.getByTestId('titler-inspector');
    const rot = within(inspector).getByRole('button', { name: 'Animate Rotation' });
    expect(rot).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(rot);
    expect(within(screen.getByTestId('titler-inspector')).getByRole('button', { name: 'Animate Rotation' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves to the library and exports a .lumtitle file', async () => {
    const host = memoryHost();
    render(<Designer host={host} env={env} />);
    await openTemplate('Quote card');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    });
    expect([...host.library.values()][0]!.name).toBe('Quote card');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export \.lumtitle/ }));
    });
    expect(host.saved[0]!.compositions[0]!.layers.length).toBeGreaterThan(0);
  });

  it('"Use" hands the title back to the app that opened it', async () => {
    const onUse = vi.fn();
    render(<Designer host={memoryHost()} env={env} initial={starterTemplates()[0]!} onUse={onUse} useLabel="Add to Lumora" look="lumora" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Lumora' }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ name: 'Name and role' }));
    expect(screen.getByTestId('titler-designer')).toHaveClass('tt-look-lumora');
  });
});

describe('the operator control panel', () => {
  it('is made from the fields: steppers for numbers, read-only bound fields, choices', () => {
    const p = starterTemplates().find((t) => t.name === 'Scoreboard bug')!;
    const onChange = vi.fn();
    const withChoice = { ...p, variables: p.variables.map((v) => (v.key === 'period' ? { ...v, bind: undefined, options: ['1st', '2nd', 'OT'] } : v)) };
    render(<ControlPanel project={withChoice} values={{ score_home: '2' }} bound={{ clock: '12:00' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Home score up' }));
    expect(onChange).toHaveBeenCalledWith('score_home', '3');
    expect(screen.getByLabelText('Clock')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'OT' } });
    expect(onChange).toHaveBeenCalledWith('period', 'OT');
    expect(screen.getByText('Home')).toBeInTheDocument();
  });
});
