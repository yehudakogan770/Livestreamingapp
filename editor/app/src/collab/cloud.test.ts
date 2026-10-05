import { describe, expect, it, vi } from 'vitest';
import { emptyProject } from '../model/types';
import { invite, openShared, plain, saveShared, shareProject, takeLock, type Db } from './cloud';

/** A pretend Supabase client: `rpc` answers from a table of results. */
function fakeDb(answers: Record<string, { data?: unknown; error?: { message: string } }>) {
  const rpc = vi.fn(async (name: string, _args?: unknown) => ({ data: answers[name]?.data ?? null, error: answers[name]?.error ?? null }));
  return { db: { rpc } as unknown as Db, rpc };
}

describe('team projects online', () => {
  it('saves with the version it was made from, and reports someone else saving first', async () => {
    const p = emptyProject('Film');
    const ok = fakeDb({ save_editor_project: { data: 8 } });
    expect(await saveShared('p1', 7, p, {}, ok.db)).toBe(8);
    expect(ok.rpc).toHaveBeenCalledWith('save_editor_project', { p_id: 'p1', p_base: 7, p_doc: p, p_name: 'Film', p_note: '', p_keep: false });
    const late = fakeDb({ save_editor_project: { data: null } });
    expect(await saveShared('p1', 7, p, {}, late.db)).toBeNull();
  });

  it('shares without the missing marks of this computer', async () => {
    const p = emptyProject('Film');
    const withMissing = {
      ...p,
      media: [
        {
          id: 'm1',
          name: 'a',
          path: 'a.mp4',
          proxy: null,
          kind: 'video' as const,
          duration: 1,
          width: 1,
          height: 1,
          fps: 30,
          hasVideo: true,
          hasAudio: false,
          bin: null,
          missing: true,
        },
      ],
    };
    const f = fakeDb({ share_editor_project: { data: 'new-id' } });
    expect(await shareProject(withMissing, f.db)).toBe('new-id');
    const args = f.rpc.mock.calls[0]?.[1] as { p_doc: typeof withMissing };
    expect(args.p_doc.media[0]).not.toHaveProperty('missing');
  });

  it('opens a project and checks it is a Lumora Studio project', async () => {
    const doc = emptyProject('Film');
    const f = fakeDb({ open_editor_project: { data: { id: 'p1', name: 'Film', version: 3, doc, role: 'viewer', owner: 'o' } } });
    const o = await openShared('p1', f.db);
    expect(o).toMatchObject({ version: 3, role: 'viewer' });
    expect(o.doc.sequences).toHaveLength(1);
    const bad = fakeDb({ open_editor_project: { data: { id: 'p1', name: 'x', version: 1, doc: { kind: 'other' }, role: 'owner', owner: 'o' } } });
    await expect(openShared('p1', bad.db)).rejects.toThrow(/not a Lumora Studio project/);
  });

  it("takes a lock and keeps the server's clock apart", async () => {
    const f = fakeDb({
      take_editor_lock: {
        data: {
          seq_id: 's1',
          holder: 'me',
          holder_name: 'Me',
          expires_at: 'x',
          requested_by: null,
          requested_name: '',
          server_now: '2026-10-05T12:00:00Z',
        },
      },
    });
    const r = await takeLock('p1', 's1', f.db);
    expect(r.serverNow).toBe('2026-10-05T12:00:00Z');
    expect(r.row).not.toHaveProperty('server_now');
  });

  it('only invites a real email, and passes on what the server says', async () => {
    const f = fakeDb({ invite_to_editor_project: { error: { message: 'There is no approved Lumora account with that email.' } } });
    await expect(invite('p1', 'not an email', 'editor', f.db)).rejects.toThrow(/Type the email/);
    expect(f.rpc).not.toHaveBeenCalled();
    await expect(invite('p1', ' dana@example.com ', 'viewer', f.db)).rejects.toThrow(/no approved Lumora account/);
    expect(f.rpc).toHaveBeenCalledWith('invite_to_editor_project', { p_id: 'p1', p_email: 'dana@example.com', p_role: 'viewer' });
  });

  it('says plainly when the server is not set up yet or there is no internet', () => {
    expect(plain({ message: 'Could not find the function public.my_editor_projects without parameters in the schema cache' }).message).toMatch(
      /update-2-editor-collab\.sql/,
    );
    expect(plain(new TypeError('Failed to fetch')).message).toMatch(/cannot reach the internet/);
    expect(plain(new Error('Only the owner of the project can invite people.')).message).toBe('Only the owner of the project can invite people.');
  });
});
