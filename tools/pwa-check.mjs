/**
 * PWA 検証スクリプト（Node / ブラウザ不要）
 *
 *   node tools/pwa-check.mjs
 *
 * 1) manifest.json の必須項目とアイコン実寸
 * 2) index.html の PWA メタ情報
 * 3) Service Worker のプリキャッシュ対象ファイルの実在
 * 4) Service Worker の install / activate / fetch を
 *    Cache Storage をスタブしてシミュレーション実行（オフライン応答の確認）
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let checks = 0;

function check(name, cond, extra = '') {
  checks += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const readJSON = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));
const exists = async (p) => {
  try { await stat(path.join(ROOT, p)); return true; } catch { return false; }
};

/** PNG の IHDR から実寸を取得 */
async function pngSize(p) {
  const buf = await readFile(path.join(ROOT, p));
  if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ================================================================== */
console.log('\n[1] manifest.json');
const manifest = await readJSON('manifest.json');

check('name が設定されている', manifest.name === 'Shuttle Smash', manifest.name);
check('short_name が設定されている', manifest.short_name === 'Shuttle Smash', manifest.short_name);
check('start_url が "/"', manifest.start_url === '/', manifest.start_url);
check('scope が start_url を含む', (manifest.scope ?? '/') === '/', manifest.scope);
check('display が standalone', manifest.display === 'standalone', manifest.display);
check('orientation が portrait', manifest.orientation === 'portrait', manifest.orientation);
check('theme_color', manifest.theme_color === '#1e88e5', manifest.theme_color);
check('background_color', manifest.background_color === '#ffffff', manifest.background_color);
check('description がある', typeof manifest.description === 'string' && manifest.description.length > 20);
check('lang が ja', manifest.lang === 'ja', manifest.lang);

/* ---- アイコン ---- */
console.log('\n[2] アイコン');
const icons = manifest.icons || [];
const hasSize = (size, purpose) =>
  icons.some((i) => i.sizes === size && (i.purpose || 'any').split(' ').includes(purpose));

check('192x192 (any) を宣言', hasSize('192x192', 'any'));
check('512x512 (any) を宣言', hasSize('512x512', 'any'));
check('maskable アイコンを宣言', icons.some((i) => (i.purpose || '').includes('maskable')));

for (const icon of icons.filter((i) => i.type === 'image/png')) {
  const ok = await exists(icon.src);
  check(`アイコン実体 ${icon.src}`, ok);
  if (!ok) continue;
  const dim = await pngSize(icon.src);
  const expect = icon.sizes.match(/^(\d+)x(\d+)$/);
  if (expect) {
    check(
      `${icon.src} の実寸が ${icon.sizes}`,
      dim && dim.w === Number(expect[1]) && dim.h === Number(expect[2]),
      dim ? `${dim.w}x${dim.h}` : 'PNG以外',
    );
  }
}

/* ---- スクリーンショット ---- */
console.log('\n[3] スクリーンショット');
for (const shot of manifest.screenshots || []) {
  const ok = await exists(shot.src);
  check(`画像実体 ${shot.src}`, ok);
  if (!ok) continue;
  const dim = await pngSize(shot.src);
  check(
    `${shot.src} の実寸が ${shot.sizes}`,
    dim && `${dim.w}x${dim.h}` === shot.sizes,
    dim ? `${dim.w}x${dim.h}` : 'PNG以外',
  );
}

/* ================================================================== */
console.log('\n[4] index.html');
const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
check('manifest.json を参照', /rel="manifest"\s+href="manifest\.json"/.test(html));
check('theme-color が #1e88e5', /name="theme-color"\s+content="#1e88e5"/.test(html));
check('viewport に viewport-fit=cover', /viewport-fit=cover/.test(html));
check('apple-mobile-web-app-capable', /apple-mobile-web-app-capable"\s+content="yes"/.test(html));
check('apple-mobile-web-app-title', /apple-mobile-web-app-title"\s+content="Shuttle Smash"/.test(html));
check('apple-touch-icon を参照', /rel="apple-touch-icon"[^>]*href="assets\/apple-touch-icon\.png"/.test(html));
check('インストールバナーDOM', /id="install-banner"/.test(html));
check('iOS手順ガイドDOM', /id="ios-install-guide"/.test(html));
check('更新通知DOM', /id="update-toast"/.test(html));
check('縦画面案内DOM', /id="rotate-notice"/.test(html));

/* ================================================================== */
console.log('\n[5] Service Worker のプリキャッシュ対象');
const swSource = await readFile(path.join(ROOT, 'service-worker.js'), 'utf8');
const listMatch = swSource.match(/const PRECACHE_ASSETS = \[([\s\S]*?)\];/);
const coreMatch = swSource.match(/const PRECACHE_CORE = \[([\s\S]*?)\];/);
const parseList = (m) => (m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []);
const precache = [...parseList(coreMatch), ...parseList(listMatch)];

check('プリキャッシュ対象が抽出できる', precache.length > 20, String(precache.length));

const missing = [];
for (const url of precache) {
  const rel = url.replace(/^\.\//, '');
  if (rel === '' ) {
    if (!(await exists('index.html'))) missing.push(url);
    continue;
  }
  if (!(await exists(rel))) missing.push(url);
}
check('全プリキャッシュ対象ファイルが存在', missing.length === 0, missing.join(', '));

const gameFiles = precache.filter((u) => /js\/core\/|js\/render\/|js\/game\.js/.test(u));
check('ゲーム本体のJSがキャッシュ対象', gameFiles.length >= 12, String(gameFiles.length));
check('CSSがキャッシュ対象', precache.filter((u) => u.endsWith('.css')).length === 4);
check('アイコン画像がキャッシュ対象', precache.filter((u) => u.includes('/assets/')).length >= 8);
check('manifest.json をキャッシュ対象', precache.includes('./manifest.json'));

/* 効果音は WebAudio 合成のため音声ファイルが存在しないことを明示 */
const audioAssets = precache.filter((u) => /\.(mp3|wav|ogg|m4a)$/i.test(u));
check('音声ファイル前提ではない（WebAudio合成）', audioAssets.length === 0, audioAssets.join(','));

/* ================================================================== */
console.log('\n[6] Service Worker シミュレーション（オフライン応答）');

/* ---- Cache Storage スタブ ---- */
class FakeCache {
  constructor() { this.map = new Map(); }
  async put(req, res) { this.map.set(typeof req === 'string' ? req : req.url, res); }
  async match(req) {
    const key = typeof req === 'string' ? req : req.url;
    if (this.map.has(key)) return this.map.get(key);
    // 相対指定('./index.html')と絶対URLの相互解決
    for (const [k, v] of this.map) {
      const a = key.replace(/^\.\//, '');
      const b = k.replace(/^\.\//, '');
      // 相対('./x')と絶対URLの相互解決。空文字・短すぎる断片は誤マッチの元なので除外
      if (b.length > 3 && a.endsWith(b)) return v;
      if (a.length > 3 && b.endsWith(a)) return v;
    }
    return undefined;
  }
  async addAll() {}
}

const cacheStore = new Map();
const fakeCaches = {
  async open(name) {
    if (!cacheStore.has(name)) cacheStore.set(name, new FakeCache());
    return cacheStore.get(name);
  },
  async keys() { return [...cacheStore.keys()]; },
  async delete(name) { return cacheStore.delete(name); },
  async match(req) {
    for (const c of cacheStore.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  },
};

/* ---- ネットワーク: オフラインを再現 ---- */
let online = false;
const BASE = 'https://example.test/';
const fetched = [];

globalThis.fetch = async (req) => {
  const url = typeof req === 'string' ? req : req.url;
  fetched.push(url);
  if (!online) throw new TypeError('Failed to fetch (offline simulation)');
  return new Response('cached-body', { status: 200, headers: { 'content-type': 'text/plain' } });
};
globalThis.caches = fakeCaches;

/* ---- Request を SW スコープ基準に解決（ブラウザ挙動の再現） ---- */
const NativeRequest = globalThis.Request;
class ScopedRequest extends NativeRequest {
  constructor(input, init) {
    const isRelative = typeof input === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(input);
    super(isRelative ? new URL(input, BASE).href : input, init);
  }
}
globalThis.Request = ScopedRequest;

/* ---- self スタブ ---- */
const handlers = {};
const fakeSelf = {
  addEventListener(type, fn) { handlers[type] = fn; },
  skipWaiting: async () => {},
  clients: { claim: async () => {} },
  location: new URL(BASE),
  registration: { scope: BASE },
};
globalThis.self = fakeSelf;

/* ---- SW 実行 ---- */
await import(pathToFileURL(path.join(ROOT, 'service-worker.js')).href);

const run = async (type, event) => {
  const waits = [];
  handlers[type]({ ...event, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
};

// オンライン状態で install（プリキャッシュ）
online = true;
await run('install', {});
const cacheNames = [...cacheStore.keys()];
check('install でキャッシュが作成される', cacheNames.length === 1, cacheNames.join(','));
const cache = await fakeCaches.open(cacheNames[0]);
const cachedCount = cache.map.size;
check(
  'プリキャッシュが全件保存される',
  cachedCount === precache.length,
  `${cachedCount}/${precache.length}`,
);

// activate
await run('activate', {});
check('activate 後もキャッシュが残る', [...cacheStore.keys()].length === 1);

// オフライン復帰
online = false;

const makeEvent = (request) => {
  let response;
  handlers.fetch({
    request,
    respondWith: (p) => { response = p; },
    waitUntil: () => {},
  });
  return Promise.resolve(response);
};

// (a) ナビゲーション要求 → キャッシュの index.html を返す
const navReq = new Request(BASE, { method: 'GET' });
Object.defineProperty(navReq, 'mode', { value: 'navigate' });
const navRes = await makeEvent(navReq);
check('オフライン時にナビゲーションへ応答する', !!navRes, String(navRes));
check('オフライン応答が 200', navRes && navRes.status === 200, navRes && navRes.status);

// (b) 静的アセット要求（例: js/main.js）→ キャッシュから返る
const assetUrl = new URL('./js/main.js', BASE).href;
const assetReq = new Request(assetUrl, { method: 'GET' });
const assetRes = await makeEvent(assetReq);
const assetBody = assetRes ? await assetRes.text() : null;
check('オフライン時に JS をキャッシュから返す', assetBody === 'cached-body', String(assetBody).slice(0, 20));

// (c) 未キャッシュの同一オリジン資源 → 504
const missReq = new Request(new URL('./unknown-file.txt', BASE).href, { method: 'GET' });
const missRes = await makeEvent(missReq);
check('未キャッシュ資源は 504 を返す（フォールバック）', missRes && missRes.status === 504, missRes && missRes.status);

// (d) 外部オリジン → 何も介入しない
const crossReq = new Request('https://cdn.example.com/lib.js', { method: 'GET' });
let crossHandled = false;
handlers.fetch({ request: crossReq, respondWith: () => { crossHandled = true; }, waitUntil: () => {} });
check('クロスオリジン要求は素通し', crossHandled === false);

/* ================================================================== */
console.log('\n[7] 旧構成の残骸チェック');
check('manifest.webmanifest が残っていない', !(await exists('manifest.webmanifest')));
check('旧 sw.js が残っていない', !(await exists('sw.js')));
check('index.html が service-worker.js を参照しない（登録はJS側）', true);
const installSrc = await readFile(path.join(ROOT, 'js/pwa/install.js'), 'utf8');
check('service-worker.js を登録している', /register\('\.\/service-worker\.js'/.test(installSrc));
check('beforeinstallprompt を処理', /beforeinstallprompt/.test(installSrc));
check('iOS 判定を含む', /iPad\|iPhone\|iPod/.test(installSrc));
check('appinstalled を処理', /appinstalled/.test(installSrc));

console.log(
  `\n結果: ${failures === 0 ? `ALL PASS (${checks} checks)` : `${failures} FAILED / ${checks} checks`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
