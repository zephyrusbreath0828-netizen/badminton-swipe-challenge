/**
 * PWA 診断（v1.2.1）
 * ------------------------------------------------------------------
 * 「なぜインストールできないのか」を推測ではなく実測で返す。
 * 判定はすべてブラウザの実API（matchMedia / window.navigator.serviceWorker /
 * fetch(manifest) / beforeinstallprompt の捕捉状態）に基づく。
 */

/** localStorage キー（installer と共通） */
const INSTALL_KEY = 'shuttleSmash.install';

export const DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay', 'browser'];

function readInstallFlag() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(INSTALL_KEY) || '{}') || {};
    return raw.installed === true;
  } catch (e) {
    return false;
  }
}

/** 表示モードを実測 */
export function readDisplayMode() {
  if (window.navigator.standalone === true) return 'standalone';
  if (typeof window.matchMedia !== 'function') return 'browser';
  for (const mode of DISPLAY_MODES) {
    try {
      if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
    } catch (e) { /* 未対応モードは無視 */ }
  }
  return 'browser';
}

export function isIosDevice() {
  const ua = window.navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

export function isSecureContextOK() {
  if (window.isSecureContext === true) return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || window.location.protocol === 'https:';
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */
export async function checkManifest({ timeout = 3000 } = {}) {
  const out = {
    linked: false,
    loaded: false,
    ok: false,
    href: null,
    name: null,
    shortName: null,
    startUrl: null,
    display: null,
    icons: 0,
    error: null,
  };

  const link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    out.error = '<link rel="manifest"> が index.html に無い';
    return out;
  }
  out.linked = true;
  out.href = link.getAttribute('href');

  if (typeof fetch !== 'function') {
    out.error = 'fetch API が利用できない';
    return out;
  }

  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    const res = await fetch(new URL(out.href, window.location.href).href, {
      cache: 'no-cache',
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (timer) clearTimeout(timer);

    if (!res || !res.ok) {
      out.error = `HTTP ${res ? res.status : '???'}`;
      return out;
    }
    out.loaded = true;
    const json = await res.json();
    out.name = json.name || null;
    out.shortName = json.short_name || null;
    out.startUrl = json.start_url || null;
    out.display = json.display || null;
    out.icons = Array.isArray(json.icons) ? json.icons.length : 0;

    const problems = [];
    if (!json.name) problems.push('name が無い');
    if (!json.short_name) problems.push('short_name が無い');
    if (!json.start_url) problems.push('start_url が無い');
    if (!json.display) problems.push('display が無い');
    if (!Array.isArray(json.icons) || json.icons.length === 0) problems.push('icons が無い');
    else {
      const has192 = json.icons.some((i) => i.sizes === '192x192');
      const has512 = json.icons.some((i) => i.sizes === '512x512');
      if (!has192 || !has512) problems.push('192x192 / 512x512 アイコンが不足');
    }
    out.problems = problems;
    out.ok = problems.length === 0;
    if (!out.ok) out.error = problems.join(' / ');
  } catch (e) {
    out.error = e && e.name === 'AbortError' ? 'タイムアウト' : `読み込み失敗 (${e && e.message})`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Service Worker                                                      */
/* ------------------------------------------------------------------ */
export async function checkServiceWorker({ timeout = 2000 } = {}) {
  const out = {
    supported: 'serviceWorker' in navigator,
    registered: false,
    scope: null,
    state: null,
    controller: false,
    error: null,
  };
  if (!out.supported) {
    out.error = 'Service Worker 非対応ブラウザ';
    return out;
  }
  try {
    const reg = await Promise.race([
      window.navigator.serviceWorker.getRegistration(),
      new Promise((resolve) => setTimeout(() => resolve(null), timeout)),
    ]);
    if (!reg) {
      out.error = '未登録（登録失敗 or スコープ外）';
      return out;
    }
    out.registered = true;
    out.scope = reg.scope;
    const worker = reg.active || reg.installing || reg.waiting;
    out.state = worker ? worker.state : 'no-worker';
    out.controller = !!window.navigator.serviceWorker.controller;
    if (out.state !== 'activated') out.error = `state: ${out.state}`;
  } catch (e) {
    out.error = e && e.message;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 総合診断                                                             */
/* ------------------------------------------------------------------ */
/**
 * @param {{promptAvailable:boolean, promptSource?:string, installed?:boolean}} ctx
 */
export async function collectDiagnostics(ctx = {}) {
  const displayMode = readDisplayMode();
  const installed = ctx.installed === true
    || displayMode === 'standalone'
    || displayMode === 'fullscreen'
    || readInstallFlag();

  const manifest = await checkManifest();
  const sw = await checkServiceWorker();
  const secure = isSecureContextOK();
  const ios = isIosDevice();
  const promptAvailable = ctx.promptAvailable === true;

  const reasons = [];
  if (!secure) reasons.push('HTTPSではない（localhost 以外は Service Worker も動きません）');
  if (!sw.registered) reasons.push(sw.error || 'Service Worker 未登録');
  if (!manifest.ok) reasons.push(`Manifestエラー: ${manifest.error || '内容不備'}`);
  if (installed) reasons.push('既にインストール済み');
  if (!promptAvailable && !installed && !ios) {
    reasons.push('ブラウザ未対応、またはインストール条件を満たしていないため beforeinstallprompt が発火していない');
  }
  if (ios) reasons.push('iPhone/iPad は beforeinstallprompt 非対応（共有メニューから手動追加）');

  return {
    at: Date.now(),
    installed,
    promptAvailable,
    promptSource: ctx.promptSource || (promptAvailable ? 'captured' : 'none'),
    sw,
    manifest,
    secure,
    ios,
    displayMode,
    reasons,
    // 画面表示用ラベル
    labels: {
      installed: installed ? 'Installed' : 'Not Installed',
      prompt: promptAvailable ? 'Available' : 'Not Available',
      sw: sw.registered ? 'Registered' : 'Not Registered',
      manifest: manifest.loaded ? (manifest.ok ? 'Loaded' : 'Loaded (invalid)') : 'Not Loaded',
      display: displayMode === 'standalone' || displayMode === 'fullscreen' ? 'Standalone' : 'Browser',
    },
  };
}
