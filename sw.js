/* ================================================================
   sw.js — Service Worker (Network First + Cache Fallback)
   ================================================================ */
var CACHE_NAME = 'ms-editor-v1.1';
var APP_SHELL = [
  './',
  'index.html',
  'editor.css',
  'js/state.js',
  'js/tree.js',
  'js/editor.js',
  'js/sidebar.js',
  'js/search.js',
  'js/capture.js',
  'js/collab.js',
  'js/graph.js',
  'js/pwa.js',
  'js/app.js'
];

// Install: cache app shell
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () { self.skipWaiting(); })
  );
});

// Activate: clean old caches
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== CACHE_NAME;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { self.clients.claim(); })
  );
});

// Fetch: network first, cache fallback
self.addEventListener('fetch', function (e) {
  // Skip non-GET, SSE, and WebSocket
  if (e.request.method !== 'GET') return;
  if (e.request.headers.get('accept') === 'text/event-stream') return;

  e.respondWith(
    fetch(e.request).then(function (response) {
      // Cache successful responses for app shell and API pages
      if (response.ok) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
