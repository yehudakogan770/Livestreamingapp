// Lumora's sign-in: only people the Lumora team has approved can use the app.
// It runs on Supabase. While these are empty the lock is off and Lumora opens
// for everyone. (The key is the "publishable" one: it is meant to be in the
// app. What each person may see or change is set in supabase/setup.sql.)

/** The Supabase project's address, e.g. https://abcd1234.supabase.co */
export const AUTH_URL = '';
/** The project's publishable (anon) key. */
export const AUTH_KEY = '';

export const authOn = (): boolean => AUTH_URL !== '' && AUTH_KEY !== '';
