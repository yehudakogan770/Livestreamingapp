// The Planner as an app on the phone (or computer): the service worker that
// keeps it on the device, a new version waiting to be loaded, installing it
// (Android and desktop Chrome ask through `beforeinstallprompt`; iPhone and
// iPad add it from the Share menu), and whether there is internet.

import { useEffect, useState, useSyncExternalStore } from 'react';

/** Chrome's install prompt (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  /** A new version is installed and waiting for a reload. */
  update: boolean;
  /** Chrome offered to install the app (null: not now, or already installed). */
  prompt: InstallPromptEvent | null;
  installed: boolean;
}

let state: PwaState = { update: false, prompt: null, installed: false };
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
function set(change: Partial<PwaState>) {
  state = { ...state, ...change };
  for (const f of listeners) f();
}
function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function usePwa(): PwaState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Listen for Chrome's install offer: as early as possible, before the app has rendered. */
export function listenForInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    set({ prompt: e as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => set({ prompt: null, installed: true }));
}

/** Show Chrome's install dialog. */
export async function install(): Promise<void> {
  const p = state.prompt;
  if (!p) return;
  set({ prompt: null });
  await p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome === 'accepted') set({ installed: true });
}

/**
 * The service worker (production builds only): it lives next to index.html,
 * so its scope is the Planner's own folder wherever the site serves it.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // A new version was waiting and Reload was chosen: it has taken over, so load it.
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (!waiting || reloading) return;
    reloading = true;
    location.reload();
  });
  const watch = (reg: ServiceWorkerRegistration) => {
    const ready = (w: ServiceWorker | null) => {
      // The first install is not an update: nothing to reload into.
      if (!w || !sw.controller) return;
      waiting = w;
      set({ update: true });
    };
    if (reg.waiting) ready(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => w.state === 'installed' && ready(w));
    });
    // An installed app can stay open for days: look for a new version now and then.
    const check = () => void reg.update().catch(() => {});
    setInterval(check, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  };
  const go = () =>
    sw
      .register('./sw.js', { scope: './' })
      .then(watch)
      .catch(() => {});
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

/** Load the new version (the user chose to: nothing is reloaded mid-edit on its own). */
export function applyUpdate(): void {
  if (waiting) waiting.postMessage({ type: 'skip-waiting' });
  else location.reload();
}

// ---- Installing ----

export interface InstallEnv {
  /** Already running as the installed app. */
  standalone: boolean;
  /** iPhone or iPad: installed from the Share menu (there is no prompt). */
  ios: boolean;
  /** Chrome offered to install it. */
  canPrompt: boolean;
  /** The card was closed before. */
  dismissed: boolean;
}

/** Which install card the plans page shows, if any. */
export function installCard(env: InstallEnv): 'ios' | 'prompt' | null {
  if (env.standalone || env.dismissed) return null;
  if (env.canPrompt) return 'prompt';
  if (env.ios) return 'ios';
  return null;
}

/** Whether the account menu offers to install the app. */
export function installOffer(env: Omit<InstallEnv, 'dismissed'>): 'ios' | 'prompt' | null {
  return installCard({ ...env, dismissed: false });
}

export function isStandalone(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIos(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints ?? 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
}

const CARD_KEY = 'lumora.planner.installCard';

export function cardDismissed(): boolean {
  try {
    return localStorage.getItem(CARD_KEY) === 'closed';
  } catch {
    return false;
  }
}

export function dismissCard(): void {
  try {
    localStorage.setItem(CARD_KEY, 'closed');
  } catch {
    // Shown again next time: fine.
  }
}

/** Everything the install card and menu need, kept current. */
export function useInstall(): { card: 'ios' | 'prompt' | null; offer: 'ios' | 'prompt' | null; dismiss: () => void } {
  const { prompt, installed } = usePwa();
  const [dismissed, setDismissed] = useState(cardDismissed);
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia('(display-mode: standalone)');
    const f = () => setStandalone(isStandalone());
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, []);
  const env = { standalone: standalone || installed, ios: isIos(), canPrompt: prompt !== null };
  return {
    card: installCard({ ...env, dismissed }),
    offer: installOffer(env),
    dismiss: () => {
      dismissCard();
      setDismissed(true);
    },
  };
}

// ---- Internet ----

/** Whether the browser says there is a connection now. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener('online', f);
      window.addEventListener('offline', f);
      return () => {
        window.removeEventListener('online', f);
        window.removeEventListener('offline', f);
      };
    },
    () => navigator.onLine !== false,
  );
}
