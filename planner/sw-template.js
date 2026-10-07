// Lumora Planner's service worker. The build (planner/vite.config.ts) writes it
// to sw.js with the list of files below filled in; its scope is the folder it
// is served from. It keeps the app itself on the device so it opens at once and
// with no internet (every part of the app, including the parts loaded only when
// a plan or the calendar opens). Account data (Supabase) is never cached here:
// those requests go straight to the network, as if there were no service worker.

const VERSION = '__VERSION__';
const FILES = __FILES__;
const SHELL = `planner-shell-${VERSION}`;
/** The fonts' other alphabets, kept once first used (their file names never change). */
const FONTS = 'planner-fonts-2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => {
        // The very first install has nothing to replace: take over now.
        if (!self.registration.active) return self.skipWaiting();
      }),
  );
});

self.addEventListener('activate', (event) => {
  const old = (k) => (k.startsWith('planner-shell-') && k !== SHELL) || (k.startsWith('planner-fonts-') && k !== FONTS);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter(old).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// A new version waits until the person chooses Reload (never in the middle of an edit).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Anything else not from the Planner's own folder (the account server above all): the network only.
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  // Opening the app: its page, from this version's files.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches
        .open(SHELL)
        .then((c) => c.match('./index.html'))
        .then((hit) => hit || fetch(req)),
    );
    return;
  }

  // The app's own files: from this version's cache, else (a font's other alphabets) the fonts
  // kept on first use, else the network.
  const font = url.pathname.startsWith(`${scope.pathname}fonts/`);
  event.respondWith(
    caches
      .open(SHELL)
      .then((c) => c.match(req, { ignoreSearch: true }))
      .then(
        (hit) =>
          hit ||
          (font
            ? caches.open(FONTS).then((c) =>
                c.match(req).then(
                  (kept) =>
                    kept ||
                    fetch(req).then((res) => {
                      if (res.ok) c.put(req, res.clone());
                      return res;
                    }),
                ),
              )
            : fetch(req)),
      ),
  );
});
