// Lumora Photo as an app of its own: the web version (docs/photo, works
// offline once opened) and the desktop app (photo/src-tauri) share this.

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
// The fonts the Type tool offers (the same ones Lumora, Studio and the Titler have).
import '@fontsource/heebo/400.css';
import '@fontsource/heebo/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/frank-ruhl-libre/400.css';
import '@fontsource/frank-ruhl-libre/700.css';
import '@fontsource/david-libre/400.css';
import '@fontsource/great-vibes/400.css';
import { App } from '../src/ui/App';
import { setHost } from '../src/app/host';
import { openPicked } from '../src/app/files';

const desktop = import.meta.env.VITE_PHOTO_DESKTOP === '1';

function Root() {
  const [ready, setReady] = useState(!desktop);
  useEffect(() => {
    if (!desktop) return;
    // The desktop app's files and dialogs (loaded only there), and the file it was opened with.
    void import('../src/desktop/tauriHost').then(async (m) => {
      const h = await m.tauriHost();
      setHost(h);
      setReady(true);
      const f = await h.initialFile?.();
      if (f) await openPicked([f]);
    });
  }, []);
  if (!ready) return null;
  return <App />;
}

/** The service worker keeps the app on the device (web version, production builds). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          // A new version waits until the next time Photo is opened (never in the middle of an edit).
          if (next.state === 'installed' && navigator.serviceWorker.controller) document.documentElement.dataset.update = '1';
        });
      });
    });
  });
}

if (import.meta.env.PROD && !desktop) registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
