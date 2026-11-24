/* =================================================================
   Shuttle Smash — Service Worker
   -----------------------------------------------------------------
   ・アプリシェル（HTML / CSS / JS / アイコン / 画像）をプリキャッシュ
   ・ナビゲーション: ネットワーク優先 → 失敗時はキャッシュの index.html
   ・静的アセット: キャッシュ優先（Stale-While-Revalidate 的に裏で更新）
   ・同一オリジンの GET のみ対象（外部リクエストは素通し）
   ・旧バージョンのキャッシュは activate で削除
   ================================================================= */

const VERSION = '1.2.2';
const CACHE_NAME = `shuttle-smash-${VERSION}`;
const LEGACY_PREFIXES = ['bsc-', 'shuttle-smash-'];

/** オフライン起動に必要な最低限のファイル */
const PRECACHE_CORE = [
  './',
  './index.html',
  './manifest.json',
];

/** アプリ全体（CSS / JS / 画像 / アイコン） */
const PRECACHE_ASSETS = [
  './css/base.css',
  './css/screens.css',
  './css/hud.css',
  './css/pwa.css',
  './css/training.css',

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
  './js/core/profile.js',
  './js/core/training.js',
  './js/render/renderer.js',
  './js/render/character.js',
  './js/ui/hud.js',
  './js/ui/screens.js',
  './js/ui/ranking.js',
  './js/pwa/installer.js',
  './js/pwa/diagnostics.js',
  './js/pwa/install.js',

  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/icon.svg',
  './assets/apple-touch-icon.png',
  './assets/favicon.svg',
  './assets/screenshot-home.png',
  './assets/screenshot-rally.png',
];

const PRECACHE = [...PRECACHE_CORE, ...PRECACHE_ASSETS];

/* ------------------------------------------------------------------ */
/* install: プリキャッシュ                                              */
/* ------------------------------------------------------------------ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 1件失敗で全体が落ちないよう個別に追加する
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (res && (res.ok || res.type === 'opaque')) {
              await cache.put(url, res);
            }
          } catch (e) {
            /* 個別失敗は無視（次回オンライン時に再取得される） */
          }
        }),
      );
    })().then(() => self.skipWaiting()),
  );
});

/* ------------------------------------------------------------------ */
/* activate: 旧キャッシュ削除 + 即時有効化                              */
/* ------------------------------------------------------------------ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && LEGACY_PREFIXES.some((p) => key.startsWith(p)))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/* ------------------------------------------------------------------ */
/* message: 即時更新                                                        */
/* ------------------------------------------------------------------ */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ------------------------------------------------------------------ */
/* fetch                                                                    */
/* ------------------------------------------------------------------ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  // ナビゲーション（ページ遷移）: ネットワーク優先 → キャッシュ
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch (e) {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response(
              '<!doctype html><meta charset="utf-8"><title>オフライン</title><p style="font-family:system-ui;padding:2rem">オフラインです。一度オンラインで起動してから再度お試しください。</p>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 },
            )
          );
        }
      })(),
    );
    return;
  }

  // 静的アセット: キャッシュ優先 + バックグラウンド更新
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: false });

      if (cached) {
        // 裏でサイレント更新（次回起動時に最新化）
        fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
          })
          .catch(() => {});
        return cached;
      }

      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (e) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })(),
  );
});
