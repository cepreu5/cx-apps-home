/* cx-apps hub — minimal service worker.
   Chrome on Android only offers the install prompt to a site that registers a
   service worker with a fetch handler, so this one passes every request
   straight to the network. No caching: the page is three small files and the
   domain must always show the current version. */

const VERSION = 'cx-apps-hub-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});
