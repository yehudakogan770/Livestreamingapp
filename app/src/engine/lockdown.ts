// In the installed app, the inside of Lumora stays closed: no "Inspect",
// no developer tools keys, no view-source, no reload in the middle of a show.
// (The browser demo and development are left alone.)

const inApp = () => '__TAURI_INTERNALS__' in window;

/** Keys that open developer tools or source, or reload the page. */
export function blockedKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'metaKey'>): boolean {
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (k === 'f12' || k === 'f5') return true;
  if (ctrl && e.shiftKey && (k === 'i' || k === 'j' || k === 'c' || k === 'k')) return true;
  if (ctrl && (k === 'u' || k === 'r' || k === 'p' || k === 's')) return true;
  return false;
}

/** Right-click stays for typing (copy and paste) but nowhere else. */
function typingIn(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}

/** `allow`: Ctrl+ keys the program uses itself (Lumora Studio saves with Ctrl+S). */
export function lockDown(allow: string[] = []): void {
  if (!import.meta.env.PROD || !inApp()) return;
  window.addEventListener('contextmenu', (e) => !typingIn(e.target) && e.preventDefault(), { capture: true });
  window.addEventListener(
    'keydown',
    (e) => {
      if (blockedKey(e) && !((e.ctrlKey || e.metaKey) && allow.includes(e.key.toLowerCase()))) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true },
  );
}
