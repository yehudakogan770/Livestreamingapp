// Lumora Titler as an app of its own: the web version (docs/titler, works
// offline once opened) and the desktop app (titler/src-tauri) share this.

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { Designer } from '../src/designer/Designer';
import { webHost, type Host } from '../src/designer/host';

const desktop = import.meta.env.VITE_TITLER_DESKTOP === '1';

function App() {
  const [host, setHost] = useState<Host | null>(desktop ? null : webHost());
  useEffect(() => {
    if (!desktop) return;
    // The desktop app's files, library and FFmpeg (loaded only there).
    void import('../src/desktop/desktopHost').then((m) => m.desktopHost().then(setHost));
  }, []);
  if (!host) return null;
  return <Designer host={host} />;
}

/** The service worker keeps the app on the device (web version, production builds). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          // A new version waits until the next time the Titler is opened (never in the middle of a design).
          if (next.state === 'installed' && navigator.serviceWorker.controller) document.documentElement.dataset.update = '1';
        });
      });
    });
  });
}

if (import.meta.env.PROD && !desktop) registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
