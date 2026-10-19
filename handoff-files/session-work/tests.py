p='app/src/auth/access.test.ts'
s=open(p).read()
s=s.replace("import { accessFrom, cachedAccess, OFFLINE_DAYS } from './access';","import { accessFrom, cachedAccess, mayUse, OFFLINE_DAYS } from './access';")
s=s.rstrip()[:-3]+"""
  it('accounts from before apps could be chosen may use both', () => {
    const a = accessFrom({ ...p, approved: true });
    expect(a).toMatchObject({ lumora: true, studio: true });
    expect(mayUse(a, 'lumora') && mayUse(a, 'studio')).toBe(true);
  });

  it('an account is set up for one app, both, or (before approval) neither', () => {
    const studioOnly = accessFrom({ ...p, approved: true, lumora: false, studio: true });
    expect(mayUse(studioOnly, 'studio')).toBe(true);
    expect(mayUse(studioOnly, 'lumora')).toBe(false);
    const lumoraOnly = accessFrom({ ...p, approved: true, lumora: true, studio: false });
    expect(mayUse(lumoraOnly, 'lumora')).toBe(true);
    expect(mayUse(lumoraOnly, 'studio')).toBe(false);
    // Not approved (or blocked): neither app, whatever is ticked.
    const waiting = accessFrom({ ...p, lumora: true, studio: true });
    expect(mayUse(waiting, 'lumora') || mayUse(waiting, 'studio')).toBe(false);
    const blocked = accessFrom({ ...p, approved: true, blocked: true, lumora: true, studio: true });
    expect(mayUse(blocked, 'lumora') || mayUse(blocked, 'studio')).toBe(false);
  });

  it('the Lumora team always has both apps', () => {
    const a = accessFrom({ ...p, approved: true, is_admin: true, lumora: false, studio: false });
    expect(mayUse(a, 'lumora') && mayUse(a, 'studio')).toBe(true);
  });

  it('offline, the remembered apps still count (and older saves mean both)', () => {
    const saved = { ...accessFrom({ ...p, approved: true, lumora: true, studio: false }), at: 1_000 };
    const known = cachedAccess(saved, 'u1', 2_000)!;
    expect(mayUse(known, 'lumora')).toBe(true);
    expect(mayUse(known, 'studio')).toBe(false);
    const { lumora: _l, studio: _s, ...old } = saved;
    expect(cachedAccess(old as typeof saved, 'u1', 2_000)).toMatchObject({ lumora: true, studio: true });
    const waiting = { ...accessFrom({ ...p, lumora: true, studio: true }), at: 1_000 };
    expect(mayUse(cachedAccess(waiting, 'u1', 2_000)!, 'lumora')).toBe(false);
  });
});
"""
open(p,'w').write(s)

p='app/src/auth/Gate.test.tsx'
s=open(p).read()
s=s.replace("const approved: Access = { userId: 'u1', email: 'a@b.c', name: 'A', state: 'approved', admin: false };","const approved: Access = { userId: 'u1', email: 'a@b.c', name: 'A', state: 'approved', admin: false, lumora: true, studio: true };")
s=s.replace("""test('a sign-in that lapses during the event never closes Lumora', async () => {
  render(
    <Gate>""","""test('a sign-in that lapses during the event never closes Lumora', async () => {
  answer = () => Promise.resolve(approved);
  render(
    <Gate product="lumora">""")
s=s.replace("import { act, render, screen } from '@testing-library/react';","import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';")
s=s.replace("import { expect, test, vi } from 'vitest';","import { afterEach, expect, test, vi } from 'vitest';")
s=s.replace("const { Gate } = await import('./Gate');","const { Gate } = await import('./Gate');\n\nafterEach(cleanup);")
s=s.rstrip()+"""

test('an approved account without Lumora Studio sees why, and can check again', async () => {
  answer = () => Promise.resolve({ ...approved, studio: false });
  render(
    <Gate product="studio">
      <p>The editor</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByText('The editor')).toBeNull();
  expect(screen.getByRole('heading')).toHaveTextContent("Your account isn't set up for Lumora Studio.");
  expect(screen.getByText('Contact the Lumora team for help.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  // The team turns Studio on.
  answer = () => Promise.resolve(approved);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check again' })));
  expect(screen.getByText('The editor')).toBeInTheDocument();
});

test('the same account can be turned off for Lumora but on for Studio', async () => {
  answer = () => Promise.resolve({ ...approved, lumora: false });
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByText('The show')).toBeNull();
  expect(screen.getByRole('heading')).toHaveTextContent("Your account isn't set up for Lumora.");
  cleanup();
  render(
    <Gate product="studio">
      <p>The editor</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByText('The editor')).toBeInTheDocument();
});

test('an account waiting for approval can use neither app', async () => {
  answer = () => Promise.resolve({ ...approved, state: 'pending' });
  for (const product of ['lumora', 'studio'] as const) {
    render(
      <Gate product={product}>
        <p>Inside</p>
      </Gate>,
    );
    await act(async () => {});
    expect(screen.queryByText('Inside')).toBeNull();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    cleanup();
  }
});

test('the Lumora team always gets in', async () => {
  answer = () => Promise.resolve({ ...approved, admin: true, lumora: false, studio: false });
  render(
    <Gate product="studio">
      <p>The editor</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByText('The editor')).toBeInTheDocument();
});
"""
open(p,'w').write(s)
