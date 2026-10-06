import { afterEach, describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { emptyProject } from '../model/types';

// The recovery folder, in memory; a write can be held to finish later.
const files = new Map<string, string>();
let hold: Promise<void> | null = null;
vi.mock('../native', () => ({ inApp: () => true }));
vi.mock('./native', () => ({
  manageNative: {
    recoveryWrite: async (name: string, text: string) => {
      if (hold && name.endsWith('.lumoraedit')) await hold;
      files.set(name, text);
    },
    recoveryRemove: async (name: string) => void files.delete(name),
    recoveryList: async () => [...files.keys()].map((name) => ({ name, bytes: 0, modified: 0 })),
    recoveryRead: async (name: string) => files.get(name) ?? '',
  },
}));

const { Autosaver } = await import('./recovery');

afterEach(() => {
  files.clear();
  hold = null;
});

describe('autosaver', () => {
  it('a clean close is not undone by an autosave still being written', async () => {
    const doc = new Doc(emptyProject('Gala'));
    const a = new Autosaver(doc, () => 'C:/Films/Gala.lumoraedit');
    a.start();
    await Promise.resolve();
    doc.edit((p) => ({ ...p, name: 'Gala 2' }));
    let finish = () => {};
    hold = new Promise<void>((r) => (finish = r));
    const writing = a.tick(true);
    // Closed while the autosave is on its way to the disk.
    await a.stop();
    finish();
    await writing;
    // The marker (which says the project was left open by a crash) stays away.
    expect([...files.keys()].filter((n) => n.endsWith('.session.json'))).toEqual([]);
    expect([...files.keys()].filter((n) => n.endsWith('.lumoraedit'))).toHaveLength(1);
  });
});
