// Dev-only fake sign-in for screenshots. Not shipped.
const access = { userId: 'me', email: 'dana@example.org', name: 'Dana Levi', state: 'approved' };
export const db = () => ({});
export type Who = { s: 'in'; access: typeof access };
export const verdict = () => ({ s: 'in', access });
export const whoAmI = async () => ({ s: 'in' as const, access });
export const signIn = async () => {};
export const signOut = async () => {};
export const onSignInChange = () => () => {};
