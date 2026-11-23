/* =================================================================
   Badminton Swipe Challenge — Service Worker
   オフライン起動用のアプリシェルキャッシュ
   ================================================================= */
const VERSION = 'v1.0.0';
const CACHE_NAME = `bsc-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/screens.css',
  './css/hud.css',
  './js/main.js',
  './js/config.js',
  './js/game.js',
  './js/core/math.js',
  './js/core/camera.js',
  './js/core/swipe.js',
  './js/core/shot.js',
  './js/core/shuttle.js',
  './js/core/player.js',
  './js/core/ai.js',
  './js/core/effects.js',
  './js/core/audio.js',
  './js/core/storage.js',
  './js/render/renderer.js',
  './js/render/character.js',
  './js/ui/hud.js',
  './js/ui/screens.js',
  './js/ui/ranking.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ナビゲーションはネットワーク優先（更新を拾う）→ オフライン時はキャッシュ
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  // 静的アセットはキャッシュ優先
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
