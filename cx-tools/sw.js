// Service worker: the shell is precached so every tool page opens offline, and
// anything else same-origin (the vendored pdf-lib and the HEIC wasm ~1.5 MB) is
// cached the first time it is used. Bump VERSION to invalidate the cache.

const VERSION = 'cx-tools-v6';
const CACHE = VERSION;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/shell.js',
  './assets/js/lib/util.js',
  './assets/js/lib/image.js',
  './assets/js/lib/photo.js',
  './assets/js/lib/heic.js',
  './assets/js/lib/zip-read.js',
  './assets/js/lib/zip-write.js',
  './assets/js/tools/kit.js',
  './assets/js/tools/shrink.js',
  './assets/js/tools/heic-jpg.js',
  './assets/js/tools/img-pdf.js',
  './assets/js/tools/pdf-tools.js',
  './assets/js/tools/unzip.js',
  './assets/fonts/atkinson-hyperlegible-next-latin-400-normal.woff2',
  './assets/fonts/atkinson-hyperlegible-next-latin-700-normal.woff2',
  './assets/fonts/atkinson-hyperlegible-next-latin-ext-400-normal.woff2',
  './assets/fonts/atkinson-hyperlegible-next-latin-ext-700-normal.woff2',
  './assets/img/tile-shrink.webp',
  './assets/img/tile-heic.webp',
  './assets/img/tile-pdf.webp',
  './assets/img/tile-tools.webp',
  './assets/img/tile-zip.webp',
  './icons/logo-144.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './smali-snimki/index.html',
  './heic-kam-jpg/index.html',
  './snimka-kam-pdf/index.html',
  './pdf-instrumenti/index.html',
  './zip/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Only our own files: nothing third-party is ever requested at runtime.
  if (url.origin !== self.location.origin) return;

  // Pages: try the network, then fall back to the cached page, then the shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch (_err) {
          const cached = await cache.match(request, { ignoreSearch: true });
          if (cached) return cached;
          const shell = (await cache.match('./index.html')) || (await cache.match('./'));
          if (shell) return shell;
          return new Response('Офлайн и тази страница още не е запазена.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  // Our own code and styles: network first, so a fix reaches the phone on the
  // next open, with the cached copy as the offline fallback. The vendored
  // libraries are big (pdf-lib, the HEIC wasm) and never change in place, so
  // those stay cache first.
  const fromCacheFirst = url.pathname.includes('/vendor/');
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit && fromCacheFirst) return hit;
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch (_err) {
        if (hit) return hit;
        return new Response('', { status: 504 });
      }
    })(),
  );
});
