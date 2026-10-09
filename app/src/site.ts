import { invoke } from '@tauri-apps/api/core';

/**
 * The Lumora website. When the site moves to its own domain, change this one
 * line (and SITE_URL in src-tauri/src/lib.rs and editor/src-tauri/src/lib.rs,
 * which the apps use to open these pages in the browser).
 */
export const SITE_URL = 'https://lumoraproduction.com/';

/** The pages of the website the apps open. */
export type SitePage = 'planner/' | 'terms.html' | 'privacy.html';

export const PLANNER_URL = `${SITE_URL}planner/`;
export const TERMS_URL = `${SITE_URL}terms.html`;
export const PRIVACY_URL = `${SITE_URL}privacy.html`;

/** The site's address as people read it: no https://, no slash at the end. */
export const SITE_LABEL = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** Opens a page of the website in the computer's browser (a new tab outside the apps). */
export function openSitePage(page: SitePage): void {
  const url = `${SITE_URL}${page}`;
  if ('__TAURI_INTERNALS__' in window) void invoke('open_site_page', { page }).catch(() => window.open(url, '_blank', 'noopener'));
  else window.open(url, '_blank', 'noopener');
}
