/**
 * PWA 診断（v1.2.2）
 * ------------------------------------------------------------------
 * v1.2.1 の診断は「1つの await が失敗すると 5 項目すべてが "-" のまま」
 * という構造だった。v1.2.2 では
 *   1) 各項目を独立に try/catch で評価し、他項目の失敗に巻き込まれない
 *   2) 取れた項目から順に onPartial で画面へ流す（部分表示を保証）
 *   3) 最後に Raw Data（JSON）を必ず出す
 * ことで、空欄が残る状態を構造的に排除する。
 *
 * 使用する実 API（ダミー・固定文言は一切なし）
 *   - navigator.serviceWorker.getRegistrations()
 *   - document.querySelector('link[rel="manifest"]') + fetch(href)
 *   - window.isSecureContext
 *   - window.matchMedia('(display-mode: standalone)')
 *   - beforeinstallprompt の捕捉状態（呼び出し側から受け取る）
 *   - window.matchMedia('(display-mode: standalone)').matches / navigator.standalone
 */

/** localStorage キー（installer と共通） */
const INSTALL_KEY = 'shuttleSmash.install';

const log = (...args) => {
  try { console.log(...args); } catch (e) { /* noop */ }
};

// 起動時ログ（要件: console.log('PWA Diagnostics')）
log('PWA Diagnostics');

/* ------------------------------------------------------------------ */
/* 小さなユーティリティ                                                  */
/* ------------------------------------------------------------------ */
/** 同期 API を投げても落ちないように包む */
function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

/** Promise をタイムアウト付きで待つ（未解決でも診断を止めない） */
function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(onTimeout), ms);
    Promise.resolve(promise).then(finish, (err) => finish({ __error: err }));
  });
}

function errText(e) {
  if (!e) return 'unknown error';
  if (e.__error) e = e.__error;
  if (typeof e === 'string') return e;
  return e.message || e.name || String(e);
}

function readInstallFlag() {
  return safe(() => {
    const raw = JSON.parse(window.localStorage.getItem(INSTALL_KEY) || '{}') || {};
    return raw.installed === true;
  }, false);
}

/* ------------------------------------------------------------------ */
/* 1) Display Mode / インストール状態                                    */
/* ------------------------------------------------------------------ */
/** 要件どおり matchMedia('(display-mode: standalone)') で判定 */
export function readDisplayMode() {
  const mq = (q) => safe(() => window.matchMedia(q).matches === true, false);
  if (mq('(display-mode: standalone)')) return 'standalone';
  if (mq('(display-mode: fullscreen)')) return 'fullscreen';
  if (mq('(display-mode: minimal-ui)')) return 'minimal-ui';
  if (mq('(display-mode: window-controls-overlay)')) return 'window-controls-overlay';
  return 'browser';
}

export function isIosStandalone() {
  return safe(() => window.navigator.standalone === true, false);
}

/** Installed 判定: standalone 表示 or iOS の navigator.standalone or 保存フラグ */
export function readInstalled() {
  const mode = readDisplayMode();
  const standalone = mode === 'standalone' || mode === 'fullscreen' || mode === 'minimal-ui';
  return {
    installed: standalone || isIosStandalone() || readInstallFlag(),
    by: standalone
      ? `display-mode: ${mode}`
      : isIosStandalone() ? 'navigator.standalone'
        : readInstallFlag() ? 'localStorage' : 'none',
    displayMode: mode,
  };
}

/* ------------------------------------------------------------------ */
/* 2) Secure Context                                                   */
/* ------------------------------------------------------------------ */
export function checkSecure() {
  const secure = safe(() => window.isSecureContext === true, false);
  const proto = safe(() => window.location.protocol, 'unknown');
  const host = safe(() => window.location.hostname, '');
  const localhost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return {
    secure,
    label: secure ? 'Secure' : 'Not Secure',
    protocol: proto,
    hostname: host,
    localhost,
    // isSecureContext が false でも localhost/https なら SW 自体は動く
    note: !secure && (localhost || proto === 'https:') ? 'isSecureContext=false（要確認）' : null,
  };
}

/* ------------------------------------------------------------------ */
/* 3) Service Worker                                                   */
/* ------------------------------------------------------------------ */
export async function checkServiceWorker({ timeout = 3000 } = {}) {
  const out = {
    supported: safe(() => 'serviceWorker' in window.navigator, false),
    registered: false,
    count: 0,
    scope: null,
    state: null,
    controller: false,
    api: null,
    error: null,
  };
  if (!out.supported) {
    out.error = 'serviceWorker 非対応（HTTPSでない / ブラウザ非対応）';
    return out;
  }

  const sw = safe(() => window.navigator.serviceWorker, null);
  if (!sw) {
    out.error = 'navigator.serviceWorker にアクセスできない';
    return out;
  }

  out.controller = safe(() => !!sw.controller, false);

  try {
    // 要件: navigator.serviceWorker.getRegistrations() を使う
    let regs = null;
    if (typeof sw.getRegistrations === 'function') {
      out.api = 'getRegistrations';
      const r = await withTimeout(sw.getRegistrations(), timeout, { __timeout: true });
      if (r && r.__timeout) {
        out.error = `getRegistrations タイムアウト (${timeout}ms)`;
        return out;
      }
      if (r && r.__error) {
        out.error = `getRegistrations 失敗: ${errText(r)}`;
        return out;
      }
      regs = Array.isArray(r) ? r : [];
    } else if (typeof sw.getRegistration === 'function') {
      // 古いブラウザ向けフォールバック
      out.api = 'getRegistration';
      const r = await withTimeout(sw.getRegistration(), timeout, { __timeout: true });
      if (r && r.__timeout) {
        out.error = `getRegistration タイムアウト (${timeout}ms)`;
        return out;
      }
      if (r && r.__error) {
        out.error = `getRegistration 失敗: ${errText(r)}`;
        return out;
      }
      regs = r ? [r] : [];
    } else {
      out.error = 'getRegistrations / getRegistration が未実装';
      return out;
    }

    out.count = regs.length;
    if (out.count === 0) {
      out.error = '登録なし（register() 未実行 or 失敗）';
      return out;
    }

    const reg = regs.find((r) => r && (r.active || r.installing || r.waiting)) || regs[0];
    out.registered = true;
    out.scope = safe(() => reg.scope, null);
    const worker = reg.active || reg.installing || reg.waiting;
    out.state = worker ? safe(() => worker.state, null) : 'no-worker';
    if (out.state !== 'activated') out.error = `state: ${out.state}`;
  } catch (e) {
    out.error = errText(e);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4) Manifest                                                         */
/* ------------------------------------------------------------------ */
export function hasManifestLink() {
  return safe(() => !!document.querySelector('link[rel="manifest"]'), false);
}

export async function checkManifest({ timeout = 4000 } = {}) {
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
    problems: [],
    error: null,
  };

  // 要件: <link rel="manifest"> の存在を実際に確認
  const link = safe(() => document.querySelector('link[rel="manifest"]'), null);
  if (!link) {
    out.error = '<link rel="manifest"> が HTML に無い';
    return out;
  }
  out.linked = true;
  out.href = safe(() => link.getAttribute('href'), null);
  if (!out.href) {
    out.error = 'link[rel="manifest"] の href が空';
    return out;
  }

  if (typeof fetch !== 'function') {
    out.error = 'fetch API が無い';
    return out;
  }

  try {
    const url = safe(() => new URL(out.href, window.location.href).href, out.href);
    const opts = { cache: 'no-cache' };
    if (typeof AbortController === 'function') {
      const ctrl = new AbortController();
      opts.signal = ctrl.signal;
      setTimeout(() => { try { ctrl.abort(); } catch (e) { /* noop */ } }, timeout);
    }
    const res = await withTimeout(fetch(url, opts), timeout + 500, { __timeout: true });
    if (res && res.__timeout) {
      out.error = `取得タイムアウト (${timeout}ms)`;
      return out;
    }
    if (res && res.__error) {
      out.error = `取得失敗: ${errText(res)}`;
      return out;
    }
    if (!res || !res.ok) {
      out.error = `HTTP ${res ? res.status : '???'}`;
      return out;
    }

    const json = await withTimeout(res.json(), timeout, { __timeout: true });
    if (json && json.__timeout) { out.error = 'JSON パース タイムアウト'; return out; }
    if (json && json.__error) { out.error = `JSON パース失敗: ${errText(json)}`; return out; }
    if (!json || typeof json !== 'object') { out.error = 'JSON が不正'; return out; }

    out.loaded = true;
    out.name = json.name || null;
    out.shortName = json.short_name || null;
    out.startUrl = json.start_url || null;
    out.display = json.display || null;
    out.icons = Array.isArray(json.icons) ? json.icons.length : 0;

    const p = out.problems;
    if (!json.name) p.push('name が無い');
    if (!json.short_name) p.push('short_name が無い');
    if (!json.start_url) p.push('start_url が無い');
    if (!json.display) p.push('display が無い');
    if (!Array.isArray(json.icons) || json.icons.length === 0) p.push('icons が無い');
    else {
      const has192 = json.icons.some((i) => i && i.sizes === '192x192');
      const has512 = json.icons.some((i) => i && i.sizes === '512x512');
      if (!has192 || !has512) p.push('192x192 / 512x512 アイコンが不足');
    }
    out.ok = p.length === 0;
    if (!out.ok) out.error = p.join(' / ');
  } catch (e) {
    out.error = errText(e);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 5) beforeinstallprompt                                             */
/* ------------------------------------------------------------------ */
export function checkPrompt(ctx = {}) {
  const available = ctx.promptAvailable === true;
  return {
    available,
    source: ctx.promptSource || (available ? 'captured' : 'none'),
    label: available ? 'Available' : 'Not Available',
  };
}

/* ------------------------------------------------------------------ */
/* ラベル・Raw Data の組み立て                                          */
/* ------------------------------------------------------------------ */
function buildLabelSet(s) {
  const labels = {
    installed: s.installed.installed ? 'Installed' : 'Not Installed',
    prompt: s.prompt.available ? 'Available' : 'Not Available',
    // 要件の表示例に合わせる（未取得は "Not Registered" / "Missing"）
    sw: s.sw ? (s.sw.registered ? 'Registered' : 'Not Registered') : 'Not Registered',
    manifest: s.manifest
      ? (s.manifest.loaded ? 'Loaded' : 'Missing')
      : 'Missing',
    secure: s.secure.secure ? 'Secure' : 'Not Secure',
    display: s.installed.displayMode === 'standalone' || s.installed.displayMode === 'fullscreen'
      ? 'Standalone'
      : 'Browser',
  };
  // 取得中（undefined）の項目は "Checking" を出す（"-" にはしない）
  if (s.sw === undefined) labels.sw = 'Checking…';
  if (s.manifest === undefined) labels.manifest = 'Checking…';
  return labels;
}

function buildRaw(s) {
  return {
    serviceWorker: s.sw ? s.sw.registered === true : false,
    manifest: s.manifest ? s.manifest.loaded === true : false,
    secure: s.secure.secure === true,
    installPrompt: s.prompt.available === true,
    installed: s.installed.installed === true,
    displayMode: s.installed.displayMode,
    details: {
      swSupported: s.sw ? s.sw.supported : null,
      swCount: s.sw ? s.sw.count : null,
      swScope: s.sw ? s.sw.scope : null,
      swState: s.sw ? s.sw.state : null,
      swControlled: s.sw ? s.sw.controller : null,
      swError: s.sw ? s.sw.error : null,
      manifestLinked: s.manifest ? s.manifest.linked : null,
      manifestHref: s.manifest ? s.manifest.href : null,
      manifestStartUrl: s.manifest ? s.manifest.startUrl : null,
      manifestIcons: s.manifest ? s.manifest.icons : null,
      manifestError: s.manifest ? s.manifest.error : null,
      promptSource: s.prompt.source,
      installedBy: s.installed.by,
      protocol: s.secure.protocol,
      hostname: s.secure.hostname,
      ua: safe(() => window.navigator.userAgent, ''),
      at: new Date(s.at).toISOString(),
    },
  };
}

function buildReasons(s) {
  const reasons = [];
  if (!s.secure.secure) reasons.push('HTTPSではない（localhost 以外では Service Worker も動きません）');
  if (s.sw === undefined) reasons.push('Service Worker を確認中…');
  else if (!s.sw.registered) reasons.push(s.sw.error || 'Service Worker 未登録');
  if (s.manifest === undefined) reasons.push('Manifest を確認中…');
  else if (!s.manifest.loaded) {
    reasons.push(`Manifest: ${s.manifest.error || '読み込めない'}`);
  } else if (!s.manifest.ok) {
    reasons.push(`Manifest 内容不備: ${s.manifest.error}`);
  }
  if (s.installed.installed) reasons.push(`既にインストール済み（${s.installed.by}）`);
  else if (!s.prompt.available) {
    reasons.push('beforeinstallprompt 未発火（ブラウザ非対応、またはインストール条件を満たしていない）');
  }
  return reasons;
}

/* ------------------------------------------------------------------ */
/* 総合診断                                                             */
/* ------------------------------------------------------------------ */
/**
 * 各項目を独立に評価し、取れた順に onPartial(partial) を呼ぶ。
 * 1項目が失敗しても他項目の表示は保証される。
 *
 * @param {{promptAvailable?:boolean, promptSource?:string, installed?:boolean}} ctx
 * @param {(p:object)=>void} [onPartial]
 */
export async function collectDiagnostics(ctx = {}, onPartial) {
  const s = { at: Date.now() };

  const emit = () => {
    const partial = {
      at: s.at,
      installed: s.installed,
      secure: s.secure,
      prompt: s.prompt,
      sw: s.sw,
      manifest: s.manifest,
      labels: buildLabelSet(s),
      raw: buildRaw(s),
      reasons: buildReasons(s),
    };
    if (typeof onPartial === 'function') {
      try { onPartial(partial); } catch (e) { /* 描画側の失敗で診断を止めない */ }
    }
    return partial;
  };

  // --- 1. 同期項目（matchMedia / isSecureContext / prompt 状態）---
  s.installed = safe(() => readInstalled(), {
    installed: false, by: 'error', displayMode: 'browser',
  });
  s.secure = safe(() => checkSecure(), {
    secure: false, label: 'Not Secure', protocol: 'unknown', hostname: '', localhost: false, note: '取得失敗',
  });
  s.prompt = safe(() => checkPrompt(ctx), { available: false, source: 'none', label: 'Not Available' });

  // 呼び出し側が installed を明示していれば OR を取る
  if (ctx.installed === true && !s.installed.installed) {
    s.installed = { ...s.installed, installed: true, by: 'installer' };
  }

  emit();

  // --- 2. Service Worker（独立）---
  try {
    s.sw = await checkServiceWorker();
  } catch (e) {
    s.sw = {
      supported: false, registered: false, count: 0, scope: null, state: null,
      controller: false, api: null, error: errText(e),
    };
  }
  emit();

  // --- 3. Manifest（独立）---
  try {
    s.manifest = await checkManifest();
  } catch (e) {
    s.manifest = {
      linked: false, loaded: false, ok: false, href: null, name: null, shortName: null,
      startUrl: null, display: null, icons: 0, problems: [], error: errText(e),
    };
  }
  emit();

  return emit();
}
