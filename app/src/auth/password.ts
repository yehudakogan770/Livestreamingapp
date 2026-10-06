// What a new password must be (Lumora, Lumora Studio and the Planner). The
// account server should ask for the same: see docs/security-checklist.md.

/** The shortest password accepted. */
export const MIN_PASSWORD = 10;

/** Why a new password is not good enough (null: it is). */
export function weakPassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `The password needs at least ${MIN_PASSWORD} characters.`;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'The password needs both letters and numbers.';
  return null;
}
