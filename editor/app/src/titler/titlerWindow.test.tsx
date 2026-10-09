// Studio's Titler in its own window: the window asks the editor for the
// clip's title, edits it, and "Use" puts the design back into that clip; a
// new title is added once, then the window keeps working on the new clip.

import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fromTemplate, starterTemplates } from '../../../../titler/src/core/templates';
import type { TitleProject } from '../../../../titler/src/core/types';
import { serveTitler, TitlerClient, type Channel, type TitlerMsg } from './titlerWindow';

/** Two windows on one bus (like Tauri events: every window hears every message). */
function bus(): () => Channel {
  const all = new Set<(m: TitlerMsg) => void>();
  return () => ({
    send: (m) => queueMicrotask(() => all.forEach((fn) => fn(structuredClone(m)))),
    listen: (fn) => (all.add(fn), () => all.delete(fn)),
  });
}

const tpl = (name: string) => fromTemplate(starterTemplates().find((t) => t.name === name)!);

function editor() {
  const clips = new Map<string, { project: TitleProject; values: Record<string, string>; name: string }>();
  clips.set('c1', { project: tpl('Name and role'), values: { name: 'Casey Brooks' }, name: 'Name and role' });
  let n = 1;
  const side = {
    clip: (id: string) => clips.get(id),
    use: vi.fn((p: TitleProject, id: string) => clips.set(id, { ...clips.get(id)!, project: p, name: p.name })),
    add: vi.fn((p: TitleProject) => {
      const id = `c${++n}`;
      clips.set(id, { project: p, values: {}, name: p.name });
      return id;
    }),
  };
  return { clips, side };
}

describe("Studio's Titler window", () => {
  it("asks for the clip's title and sends the design back into that clip", async () => {
    const make = bus();
    const { clips, side } = editor();
    serveTitler(make(), side);
    const opened: TitlerMsg[] = [];
    const client = new TitlerClient(make(), 'c1', (m) => opened.push(m));
    client.ask('c1');
    await waitFor(() => expect(opened).toHaveLength(1));
    const got = opened[0] as Extract<TitlerMsg, { kind: 'open' }>;
    expect(got.target).toBe('c1');
    expect(got.project!.name).toBe('Name and role');
    expect(got.values).toEqual({ name: 'Casey Brooks' });
    // Changed in the window, used: the clip has it (its values stay).
    const changed = { ...got.project!, name: 'Name and role (red)', tokens: { ...got.project!.tokens, accent: '#cc2222' } };
    const r = await client.use(changed);
    expect(r).toEqual({ target: 'c1', name: 'Name and role (red)' });
    expect(side.use).toHaveBeenCalledTimes(1);
    expect(clips.get('c1')!.project.tokens.accent).toBe('#cc2222');
    expect(clips.get('c1')!.values).toEqual({ name: 'Casey Brooks' });
  });

  it('a new title is added once; using it again changes the clip it became', async () => {
    const make = bus();
    const { clips, side } = editor();
    serveTitler(make(), side);
    const opened: TitlerMsg[] = [];
    const client = new TitlerClient(make(), null, (m) => opened.push(m));
    client.ask(null);
    await waitFor(() => expect(opened).toHaveLength(1));
    expect((opened[0] as Extract<TitlerMsg, { kind: 'open' }>).project).toBeNull();
    const p = tpl('Breaking banner');
    const first = await client.use(p);
    expect(first.target).toBe('c2');
    await client.use({ ...p, name: 'Breaking banner 2' });
    expect(side.add).toHaveBeenCalledTimes(1);
    expect(side.use).toHaveBeenCalledWith(expect.objectContaining({ name: 'Breaking banner 2' }), 'c2');
    expect(clips.size).toBe(2);
  });

  it('a clip that is gone opens as a new title; no answer gives a clear message', async () => {
    const make = bus();
    const { side } = editor();
    const stop = serveTitler(make(), side);
    const opened: TitlerMsg[] = [];
    const client = new TitlerClient(make(), 'missing', (m) => opened.push(m));
    client.ask('missing');
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatchObject({ target: null, project: null });
    stop();
    await expect(client.use(tpl('Name and role'), 50)).rejects.toThrow(/did not answer/);
  });

  it('the window component opens the clip in the designer and "Use in this clip" sends it back', async () => {
    const make = bus();
    const { side } = editor();
    serveTitler(make(), side);
    window.history.replaceState(null, '', '/?titler=c1');
    const { StudioTitlerWindow } = await import('./StudioTitler');
    await act(async () => {
      render(<StudioTitlerWindow channel={make()} />);
    });
    const use = await screen.findByRole('button', { name: /Use in this clip/ }, { timeout: 15_000 });
    await act(async () => use.click());
    await waitFor(() => expect(side.use).toHaveBeenCalledTimes(1));
    expect(side.use.mock.calls[0]![1]).toBe('c1');
    expect(await screen.findByText(/now uses this design/)).toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });
});
