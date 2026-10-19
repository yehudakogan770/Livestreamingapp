import sys
p=sys.argv[1]
s=open(p).read()
def rep(a,b):
    global s
    assert a in s, a
    s=s.replace(a,b,1)
rep("import { MIN_PASSWORD, weakPassword } from '../../app/src/auth/password';","import { MIN_PASSWORD, weakPassword } from '../../app/src/auth/password';\nimport { clearCache } from './offlineCache';")
rep("""  if (!session) return { s: 'out' };""","""  if (!session) {
    clearCache();
    return { s: 'out' };
  }""")
rep("""      .catch(() => {});
    return { s: 'out' };""","""      .catch(() => {});
    clearCache();
    return { s: 'out' };""")
rep("""export async function signOut(): Promise<void> {
  await db().auth.signOut({ scope: 'local' });""","""export async function signOut(): Promise<void> {
  // The copy of the plans kept on this device goes with the sign-in.
  clearCache();
  await db().auth.signOut({ scope: 'local' });""")
rep("""    // Outside the callback""","""    if (event === 'SIGNED_OUT') clearCache();
    // Outside the callback""")
open(p,'w').write(s)
