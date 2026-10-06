// The end-to-end test build (CI only). `VITE_LUMORA_E2E=1` is baked in when
// that build's screens are made (the e2e job in .github/workflows/ci.yml); the installers
// people download are built without it, so nothing here exists in them: there
// is no setting, file or environment variable that turns it on afterwards.
//
// In a test build the sign-in is skipped, nothing is sent to the error server,
// and the robot gets a few hooks (window.__lumoraE2E): the errors seen so far,
// and (Lumora Studio) opening the demo project with media the test made.

export const TEST_BUILD: boolean = import.meta.env.VITE_LUMORA_E2E === '1';

export interface E2EHooks {
  /** console.error lines, uncaught errors and rejected promises. */
  errors: string[];
  /** Lumora Studio: open the demo project with its media in this folder. */
  openDemo?: (folder: string) => void;
}

declare global {
  interface Window {
    __lumoraE2E?: E2EHooks;
  }
}

/** The test hooks (only in a test build). */
export function e2e(): E2EHooks | null {
  if (!TEST_BUILD || typeof window === 'undefined') return null;
  window.__lumoraE2E ??= { errors: [] };
  return window.__lumoraE2E;
}
