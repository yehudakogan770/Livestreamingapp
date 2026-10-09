// Lumora Titler's service worker. The build (titler/vite.config.ts) writes it
// to sw.js with the list of files below filled in; its scope is the folder it
// is served from. It keeps the app itself on the device so it opens at once and
// with no internet (every part of the app, including the parts loaded only when
// first used, like rendering). Anything from elsewhere (a data source's
// address) goes straight to the network, as if there were no service worker.

const VERSION = '75eb11334db6';
const FILES = ["./assets/bebas-neue-latin-400-normal-9mHNbWWO.woff2","./assets/bebas-neue-latin-400-normal-Bi-ndsyu.woff","./assets/bebas-neue-latin-ext-400-normal-DWiEslNC.woff2","./assets/bebas-neue-latin-ext-400-normal-HFKRJXnW.woff","./assets/chakra-petch-latin-400-normal-D7EtbySE.woff","./assets/chakra-petch-latin-400-normal-SafcrIr2.woff2","./assets/chakra-petch-latin-700-normal-CnDBPjkL.woff2","./assets/chakra-petch-latin-700-normal-D1s_c2du.woff","./assets/chakra-petch-latin-ext-400-normal-C8u6EFkq.woff2","./assets/chakra-petch-latin-ext-400-normal-MNNNbyh_.woff","./assets/chakra-petch-latin-ext-700-normal-BeviJPUl.woff","./assets/chakra-petch-latin-ext-700-normal-DAkvJhej.woff2","./assets/chakra-petch-thai-400-normal-Bw1Q-fVY.woff2","./assets/chakra-petch-thai-400-normal-KdzBjiWs.woff","./assets/chakra-petch-thai-700-normal-B7WL5pBr.woff2","./assets/chakra-petch-thai-700-normal-vZLZ_5L8.woff","./assets/chakra-petch-vietnamese-400-normal-Cn7ya5On.woff","./assets/chakra-petch-vietnamese-700-normal-gQuUA8Wu.woff","./assets/david-libre-hebrew-400-normal-C2QS4rpg.woff","./assets/david-libre-hebrew-400-normal-DDWXL-fn.woff2","./assets/david-libre-latin-400-normal-DcWD3fZT.woff2","./assets/david-libre-latin-400-normal-DShCqtCb.woff","./assets/david-libre-latin-ext-400-normal-BNg6MgAy.woff2","./assets/david-libre-latin-ext-400-normal-o3Mc0VIe.woff","./assets/david-libre-math-400-normal-DPp5jDkP.woff2","./assets/david-libre-math-400-normal-YY1hhbKE.woff","./assets/david-libre-symbols-400-normal-DNMfNozl.woff2","./assets/david-libre-symbols-400-normal-OJkF7oKc.woff","./assets/david-libre-vietnamese-400-normal-BSWKyfq5.woff2","./assets/david-libre-vietnamese-400-normal-DkInsfE8.woff","./assets/frank-ruhl-libre-hebrew-400-normal-BXUQzM2e.woff","./assets/frank-ruhl-libre-hebrew-400-normal-D1SqjNdY.woff2","./assets/frank-ruhl-libre-hebrew-700-normal-B5o0XYJ1.woff","./assets/frank-ruhl-libre-hebrew-700-normal-ZxcPrX5v.woff2","./assets/frank-ruhl-libre-latin-400-normal-CF3uE58i.woff","./assets/frank-ruhl-libre-latin-400-normal-hBB2j9Kl.woff2","./assets/frank-ruhl-libre-latin-700-normal-BtbVhCvj.woff2","./assets/frank-ruhl-libre-latin-700-normal-Mv4_ahRh.woff","./assets/frank-ruhl-libre-latin-ext-400-normal-B_dXehWi.woff2","./assets/frank-ruhl-libre-latin-ext-400-normal-BZfVaX-v.woff","./assets/frank-ruhl-libre-latin-ext-700-normal-C48ktjdO.woff","./assets/frank-ruhl-libre-latin-ext-700-normal-VfVLWWBc.woff2","./assets/great-vibes-cyrillic-400-normal-C-wcqNJs.woff2","./assets/great-vibes-cyrillic-400-normal-DtFXCWjq.woff","./assets/great-vibes-cyrillic-ext-400-normal-CKQhgFwn.woff2","./assets/great-vibes-latin-400-normal-BAZ173uY.woff","./assets/great-vibes-latin-400-normal-q5-78SH_.woff2","./assets/great-vibes-latin-ext-400-normal-CsjMq8GN.woff2","./assets/great-vibes-latin-ext-400-normal-wh4xxCIu.woff","./assets/great-vibes-vietnamese-400-normal-a2O3jU53.woff2","./assets/great-vibes-vietnamese-400-normal-Cxbm9Uac.woff","./assets/heebo-hebrew-400-normal-CVTJgQVK.woff2","./assets/heebo-hebrew-400-normal-DoqplqF9.woff","./assets/heebo-hebrew-700-normal-BmueYKsA.woff2","./assets/heebo-hebrew-700-normal-C-m02vPD.woff","./assets/heebo-latin-400-normal-BGyEuwIV.woff2","./assets/heebo-latin-400-normal-BVgBBEsj.woff","./assets/heebo-latin-700-normal-DxB9_ClD.woff","./assets/heebo-latin-700-normal-PoyjiH5f.woff2","./assets/heebo-latin-ext-400-normal-DRmJUxQB.woff2","./assets/heebo-latin-ext-400-normal-DXPdCX6a.woff","./assets/heebo-latin-ext-700-normal-qhovM35d.woff2","./assets/heebo-latin-ext-700-normal-uPTFHbI6.woff","./assets/heebo-math-400-normal-B7IFZoQI.woff2","./assets/heebo-math-400-normal-BZIH-XlF.woff","./assets/heebo-math-700-normal-CPsTiLVd.woff2","./assets/heebo-math-700-normal-DYoC40KU.woff","./assets/heebo-symbols-400-normal-5E_VKyNT.woff","./assets/heebo-symbols-400-normal-DYSXrd5A.woff2","./assets/heebo-symbols-700-normal-Bez4Ifx8.woff","./assets/heebo-symbols-700-normal-DjMVWKhZ.woff2","./assets/index-BTgrPbO9.css","./assets/index-X1tJOdwG.js","./assets/inter-cyrillic-ext-wght-normal-BOeWTOD4.woff2","./assets/inter-cyrillic-wght-normal-DqGufNeO.woff2","./assets/inter-greek-ext-wght-normal-DlzME5K_.woff2","./assets/inter-greek-wght-normal-CkhJZR-_.woff2","./assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","./assets/inter-latin-wght-normal-Dx4kXJAl.woff2","./assets/inter-vietnamese-wght-normal-CBcvBZtf.woff2","./assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2","./assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2","./assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2","./assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2","./assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2","./assets/src-DRD9llzM.js","./index.html","./favicon-32.png","./icon-180.png","./icon-192.png","./icon-512.png","./icon.svg","./manifest.webmanifest"];
const SHELL = `titler-shell-${VERSION}`;
/** The fonts' other alphabets, kept once first used (their file names never change). */
const FONTS = 'titler-fonts-1';

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
  const old = (k) => (k.startsWith('titler-shell-') && k !== SHELL) || (k.startsWith('titler-fonts-') && k !== FONTS);
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

  // Anything not from the Titler's own folder (data sources): the network only.
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
