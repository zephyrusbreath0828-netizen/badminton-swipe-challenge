/**
 * PWA インストール UI（DOM 配線）
 * ------------------------------------------------------------------
 * v1.2.1: 原因診断を追加。
 *  - コンソールログ（PWA Init / Manifest Loaded / SW Registered /
 *    Install Prompt Ready / Install Button Clicked / Prompt Executed）
 *  - beforeinstallprompt が無い場合はボタンを「インストール利用不可」で無効化し、
 *    要件不足の理由を画面に表示
 *  - 「PWA診断」ダイアログで Manifest / SW / Install / Display Mode を実測表示
 */
import { PwaInstaller, createStore, detectPlatform, isStandalone } from './installer.js';
import { collectDiagnostics } from './diagnostics.js';

const $ = (id) => document.getElementById(id);

/** ログ接頭辞なしの素直な console.log（仕様どおりの文字列） */
const log = (msg, ...rest) => {
  try { console.log(msg, ...rest); } catch (e) { /* noop */ }
};

export const env = {
  get standalone() { return isStandalone(window); },
  get platform() { return detectPlatform(navigator); },
  get isIOS() { return detectPlatform(navigator) === 'ios'; },
  get isAndroid() { return detectPlatform(navigator) === 'android'; },
  get isSafari() {
    const ua = window.navigator.userAgent || '';
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
  },
  get isMobile() { return this.platform !== 'desktop'; },
};

const GUIDE = {
  ios: {
    lead: 'iPhone / iPad をご利用の場合',
    title: 'ホーム画面に追加',
    steps: [
      'Safari 下部（または上部）の <b>共有ボタン</b> をタップ',
      'メニューの <b>「ホーム画面に追加」</b> を選択',
      '<b>「追加」</b> をタップしてインストール完了',
    ],
    note: 'ホーム画面のアイコンから、URLバーなしの全画面で起動できます。',
  },
  android: {
    lead: 'Android をご利用の場合',
    title: 'アプリをインストール',
    steps: [
      'Chrome 右上の <b>⋮（メニュー）</b> をタップ',
      '<b>「アプリをインストール」</b> または「ホーム画面に追加」を選択',
      '<b>「インストール」</b> をタップして完了',
    ],
    note: 'このブラウザではインストールダイアログを直接開けませんでした。',
  },
  desktop: {
    lead: 'パソコンをご利用の場合',
    title: 'アプリをインストール',
    steps: [
      'アドレスバー右側の <b>インストールアイコン</b> をクリック',
      '<b>「インストール」</b> を選択',
      'デスクトップアプリとして起動できます',
    ],
    note: 'Chrome / Edge でご利用ください。',
  },
};

export function initPWA() {
  log('PWA Init');

  const store = createStore(window.localStorage);
  const installer = new PwaInstaller({ win: window, nav: navigator, store });

  /* ---------- DOM ---------- */
  const banner = $('install-banner');
  const dialog = $('install-dialog');
  const diag = $('screen-diagnostics');
  const rowBtn = $('btn-install-app');
  const rowLabel = $('btn-install-app-label');
  const rowHint = $('btn-install-app-hint');
  const installedNote = $('install-installed-note');
  const errorBox = $('install-error');
  const cta = $('btn-install');
  const later = $('btn-install-later');
  const bannerText = $('install-banner-text');

  let bannerShown = false;
  let lastDiag = null;

  /* ---------- 早期捕捉されたイベントの取り込み ---------- */
  function adoptEarlyPrompt() {
    const early = window.__installPrompt;
    if (early && !installer.canPrompt) {
      installer.capturePrompt(early);
      window.__installPrompt = null;
      log('Install Prompt Ready', { source: 'early-capture' });
      return true;
    }
    return false;
  }

  // index.html の <head> が発火するカスタムイベント
  window.addEventListener('ss:installprompt', () => {
    if (adoptEarlyPrompt()) syncUI();
    scheduleBanner();
  });

  // フォールバック（早期ハンドラが無い/遅れた場合）
  window.addEventListener('beforeinstallprompt', (e) => {
    const had = installer.canPrompt;
    installer.capturePrompt(e);
    if (!had) log('Install Prompt Ready', { source: 'late-listener' });
    syncUI();
    scheduleBanner();
  });

  window.addEventListener('appinstalled', () => {
    log('App Installed');
    installer.markInstalled();
    hideBanner();
    hideDialog();
    syncUI();
    notify('ホーム画面に追加しました');
  });

  /* ---------- 状態 → UI ---------- */
  function syncUI() {
    const snap = installer.snapshot();
    const platform = snap.platform;

    if (rowBtn && rowLabel) {
      const state = !snap.installed && snap.canPrompt ? 'available'
        : snap.installed ? 'installed'
          : platform === 'ios' ? 'ios-manual'
            : 'unavailable';

      rowBtn.dataset.state = state;

      switch (state) {
        case 'installed':
          rowLabel.textContent = 'アプリインストール済み';
          rowBtn.disabled = true;
          rowBtn.setAttribute('aria-disabled', 'true');
          if (rowHint) rowHint.textContent = 'ホーム画面のアイコンから起動できます';
          break;
        case 'available':
          rowLabel.textContent = 'アプリをインストール';
          rowBtn.disabled = false;
          rowBtn.removeAttribute('aria-disabled');
          if (rowHint) rowHint.textContent = 'ホーム画面に追加して全画面で起動';
          break;
        case 'ios-manual':
          rowLabel.textContent = 'ホーム画面に追加（手順を見る）';
          rowBtn.disabled = false;
          rowBtn.removeAttribute('aria-disabled');
          if (rowHint) rowHint.textContent = 'Safari の共有メニューから追加できます';
          break;
        default:
          rowLabel.textContent = 'インストール利用不可';
          rowBtn.disabled = true;               // 仕様: クリック不可
          rowBtn.setAttribute('aria-disabled', 'true');
          if (rowHint) rowHint.textContent = '下の「PWA診断」で原因を確認できます';
      }

      if (installedNote) installedNote.hidden = state !== 'installed';

      // 要件不足の説明（プロンプト不可 かつ iOS 以外 かつ 未インストール）
      if (errorBox) {
        const show = state === 'unavailable';
        errorBox.hidden = !show;
        if (show) renderErrorBox();
      }
    }

    if (banner) {
      if (snap.installed) hideBanner();
      if (cta) cta.textContent = snap.canPrompt ? 'インストール' : (platform === 'ios' ? '手順を見る' : '詳細');
      if (bannerText) {
        bannerText.textContent = snap.canPrompt
          ? 'アプリとして全画面で起動できます'
          : (platform === 'ios' ? '共有メニューからホーム画面に追加できます' : 'インストールできない原因を確認');
      }
    }
  }

  /** 要件不足の理由を、実測値で埋めて表示 */
  function renderErrorBox() {
    if (!errorBox) return;
    const reasons = [];
    if (!(window.isSecureContext === true || window.location.protocol === 'https:'
      || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      reasons.push('HTTPSではない');
    }
    if (!('serviceWorker' in navigator) || !window.navigator.serviceWorker.controller) {
      reasons.push('Service Worker未登録（または未制御）');
    }
    if (!document.querySelector('link[rel="manifest"]')) reasons.push('Manifestが読み込まれていない');
    if (installer.installed) reasons.push('既にインストール済み');
    if (reasons.length === 0) reasons.push('ブラウザ未対応（beforeinstallprompt が発火していない）');

    const detail = errorBox.querySelector('[data-role="detail"]');
    if (detail) {
      detail.innerHTML = reasons.map((r) => `<li>${r}</li>`).join('');
    }
  }

  /* ---------- 手順ダイアログ ---------- */
  function openDialog() {
    if (!dialog) return;
    const kind = installer.guideKind;
    const conf = GUIDE[kind] || GUIDE.desktop;
    const lead = $('install-dialog-lead');
    const title = $('install-dialog-title');
    const steps = $('install-dialog-steps');
    const note = $('install-dialog-note');
    if (lead) lead.textContent = conf.lead;
    if (title) title.textContent = conf.title;
    if (steps) {
      steps.innerHTML = conf.steps
        .map((t, i) => `<li class="install-dialog__step"><span class="install-dialog__num">${i + 1}</span><span class="install-dialog__text">${t}</span></li>`)
        .join('');
    }
    if (note) note.textContent = conf.note;
    dialog.classList.add('is-on');
    dialog.setAttribute('aria-hidden', 'false');
  }

  function hideDialog() {
    if (!dialog) return;
    dialog.classList.remove('is-on');
    dialog.setAttribute('aria-hidden', 'true');
  }

  /* ---------- バナー ---------- */
  function showBanner() {
    if (!banner || bannerShown || installer.installed) return;
    bannerShown = true;
    banner.classList.add('is-on');
    banner.setAttribute('aria-hidden', 'false');
  }

  function hideBanner(userDismissed = false) {
    if (!banner) return;
    banner.classList.remove('is-on');
    banner.setAttribute('aria-hidden', 'true');
    if (userDismissed) store.set({ dismissedAt: Date.now() });
  }

  function scheduleBanner() {
    if (installer.installed) return;
    const state = store.get();
    const dismissedAt = state.dismissedAt || 0;
    if (Date.now() - dismissedAt < (dismissedAt ? 7 * 24 * 60 * 60 * 1000 : 0)) return;
    setTimeout(() => {
      const home = $('screen-home');
      if (home && home.classList.contains('is-active')) showBanner();
    }, dismissedAt ? 1500 : 1200);
  }

  /* ---------- インストール実行 ---------- */
  async function requestInstall({ fromBanner = false } = {}) {
    log('Install Button Clicked', installer.snapshot());
    adoptEarlyPrompt();

    const snap = installer.snapshot();

    if (snap.installed) {
      notify('すでにホーム画面に追加されています');
      syncUI();
      return { outcome: 'installed' };
    }

    // 1) ネイティブプロンプト（Android Chrome / PC Chrome）
    if (installer.canPrompt) {
      if (fromBanner) hideBanner();
      log('Prompt Executed');
      const res = await installer.prompt();
      syncUI();
      if (res.outcome === 'accepted') {
        log('Install Result', { outcome: 'accepted' });
        notify('インストールしました');
      } else if (res.outcome === 'dismissed') {
        log('Install Result', { outcome: 'dismissed' });
        openDialog();
      } else {
        log('Install Result', { outcome: res.outcome });
        openDialog();
      }
      return res;
    }

    // 2) プロンプト不可
    log('Install Prompt Unavailable', snap);
    if (fromBanner) hideBanner();
    if (snap.platform === 'ios') {
      openDialog();
    } else {
      // 要件不足の説明を出す（設定画面の説明ブロックを強調）
      if (errorBox) {
        errorBox.hidden = false;
        renderErrorBox();
        errorBox.classList.add('is-flash');
        setTimeout(() => errorBox.classList.remove('is-flash'), 900);
        try { errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* noop */ }
      }
      notify('インストールできません。PWA診断を確認してください');
    }
    return { outcome: 'unavailable' };
  }

  /* ---------- PWA 診断 ---------- */
  /** 診断結果（部分でも可）を DOM に反映する */
  function renderDiag(d) {
    const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const setOk = (id, ok) => { const el = $(id); if (el) el.dataset.ok = ok ? '1' : '0'; };
    // 行のラベル(<span class="diag-row__label">)を壊さず値だけ更新する
    const setRow = (id, v) => {
      const el = $(id);
      if (!el) return;
      const val = el.querySelector('.diag-row__value');
      if (val) val.textContent = v;
      else el.textContent = v;
    };
    if (!d || !d.labels) return;

    setRow('diag-installed', d.labels.installed);
    setOk('diag-installed', !!(d.installed && d.installed.installed));
    setRow('diag-prompt', d.labels.prompt);
    setOk('diag-prompt', !!(d.prompt && d.prompt.available));
    setRow('diag-sw', d.labels.sw);
    setOk('diag-sw', !!(d.sw && d.sw.registered));
    setRow('diag-manifest', d.labels.manifest);
    setOk('diag-manifest', !!(d.manifest && d.manifest.loaded));
    setRow('diag-secure', d.labels.secure);
    setOk('diag-secure', !!(d.secure && d.secure.secure));
    setRow('diag-display', d.labels.display);
    setOk('diag-display', !!(d.installed && (d.installed.displayMode === 'standalone' || d.installed.displayMode === 'fullscreen')));

    if (d.sw) {
      setText('diag-sw-detail', d.sw.registered
        ? `scope: ${d.sw.scope || '-'} / ${d.sw.state || '?'}${d.sw.controller ? ' / controlled' : ' / not controlling yet'}`
        : `${d.sw.error || '登録なし'}${d.sw.supported ? '' : '（serviceWorker 非対応）'}`);
    }
    if (d.manifest) {
      setText('diag-manifest-detail', d.manifest.loaded
        ? `${d.manifest.name || '(no name)'} / icons ${d.manifest.icons} / start_url ${d.manifest.startUrl || '-'}`
        : `${d.manifest.error || '読み込めない'}${d.manifest.linked ? '' : '（<link rel="manifest"> 無し）'}`);
    }
    if (d.prompt) {
      setText('diag-prompt-detail', d.prompt.available
        ? `source: ${d.prompt.source}`
        : (env.isIOS ? 'iOS は beforeinstallprompt 非対応（共有メニューから追加）' : 'beforeinstallprompt 未発火'));
    }
    if (d.secure) {
      setText('diag-secure-detail', `${d.secure.label} / ${d.secure.protocol}//${d.secure.hostname || '-'}${d.secure.note ? ` / ${d.secure.note}` : ''}`);
    }

    const rawEl = $('diag-raw');
    if (rawEl && d.raw) rawEl.textContent = JSON.stringify(d.raw, null, 2);

    const reasonsEl = $('diag-reasons');
    if (reasonsEl && Array.isArray(d.reasons)) {
      reasonsEl.innerHTML = d.reasons.length
        ? d.reasons.map((r) => `<li>${r}</li>`).join('')
        : '<li class="is-ok">問題は見つかりませんでした。インストールできます。</li>';
    }
    setText('diag-time', new Date(d.at).toLocaleTimeString('ja-JP'));
  }

  function openDiag() {
    if (!diag) return;
    diag.classList.add('is-on');
    diag.setAttribute('aria-hidden', 'false');
  }

  /** 全項目を実測して表示する（1項目の失敗で他の項目を落とさない） */
  async function runDiagnostics({ show = true } = {}) {
    // 押した瞬間に前回の "-" を消す（空欄のまま見せない）
    document.querySelectorAll('.diag-row__value').forEach((el) => {
      if (el.textContent === '-' || el.textContent === '') el.textContent = 'Checking…';
    });

    const ctx = {
      promptAvailable: installer.canPrompt,
      installed: installer.installed,
      promptSource: window.__installPrompt ? 'early-capture' : (installer.canPrompt ? 'captured' : 'none'),
    };

    let final = null;
    try {
      // onPartial: 取れた項目から順に描画（部分表示を保証）
      final = await collectDiagnostics(ctx, (partial) => {
        renderDiag(partial);
        if (show) openDiag();
      });
    } catch (e) {
      log('Diagnostics Failed', e && e.message);
      const msg = `診断に失敗しました: ${e && e.message ? e.message : e}`;
      document.querySelectorAll('.diag-row__value').forEach((el) => {
        if (el.textContent === '-' || el.textContent === 'Checking…') el.textContent = 'Error';
      });
      const reasonsEl = $('diag-reasons');
      if (reasonsEl) reasonsEl.innerHTML = `<li>${msg}</li>`;
      const rawEl = $('diag-raw');
      if (rawEl) rawEl.textContent = JSON.stringify({ error: String((e && e.stack) || e) }, null, 2);
      if (show) openDiag();
      return null;
    }

    lastDiag = final;
    renderDiag(final);
    if (show) openDiag();

    // 要件: 診断時に console.log(diagnostics)
    try { console.log(final); } catch (e) { /* noop */ }
    log('PWA Diagnostics Result', final.raw);
    return final;
  }

  /* ---------- イベント配線 ---------- */
  if (rowBtn) {
    rowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestInstall();
    });
  }

  const diagBtn = $('btn-pwa-diag');
  if (diagBtn) {
    diagBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runDiagnostics();
    });
  }

  if (diag) {
    diag.addEventListener('click', (e) => { if (e.target === diag) closeDiag(); });
    const close = $('btn-diag-close');
    if (close) close.addEventListener('click', () => closeDiag());
    const again = $('btn-diag-rerun');
    if (again) again.addEventListener('click', () => runDiagnostics());
  }

  function closeDiag() {
    if (!diag) return;
    diag.classList.remove('is-on');
    diag.setAttribute('aria-hidden', 'true');
  }

  if (banner) {
    banner.addEventListener('click', (e) => {
      if (e.target.closest('[data-install-action]')) return;
      requestInstall({ fromBanner: true });
    });
  }
  if (cta) {
    cta.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestInstall({ fromBanner: true });
    });
  }
  if (later) {
    later.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideBanner(true);
    });
  }

  if (dialog) {
    dialog.addEventListener('click', (e) => { if (e.target === dialog) hideDialog(); });
    const close = $('btn-install-dialog-close');
    if (close) close.addEventListener('click', () => {
      hideDialog();
      store.set({ dismissedAt: Date.now() });
    });
  }

  installer.onChange(() => syncUI());

  const mq = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', () => {
      if (isStandalone(window)) {
        installer.markInstalled();
        hideBanner();
        hideDialog();
      }
      syncUI();
    });
  }

  const homeEl = $('screen-home');
  if (homeEl && 'MutationObserver' in window) {
    new MutationObserver(() => {
      if (homeEl.classList.contains('is-active')) scheduleBanner();
      else hideBanner();
    }).observe(homeEl, { attributes: true, attributeFilter: ['class'] });
  }

  adoptEarlyPrompt();
  syncUI();
  scheduleBanner();

  // 起動時に1回だけ自動診断（ログのみ）
  setTimeout(() => {
    runDiagnostics({ show: false }).catch(() => {});
  }, 600);

  window.__installer = installer;
  return { installer, requestInstall, openDialog, runDiagnostics, syncUI, getDiagnostics: () => lastDiag };
}

/* ------------------------------------------------------------------ */
/* Service Worker 登録 + 更新通知                                       */
/* ------------------------------------------------------------------ */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    log('SW Not Supported');
    return null;
  }
  if (!/^https?:$/.test(window.location.protocol)) {
    log('SW Skipped', { protocol: window.location.protocol });
    return null;
  }

  const onLoad = () => {
    window.navigator.serviceWorker
      .register('./service-worker.js', { scope: './' })
      .then((reg) => {
        log('SW Registered', { scope: reg.scope });
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && window.navigator.serviceWorker.controller) {
              showUpdateToast(reg);
            }
          });
        });
        setInterval(() => reg.update().catch(() => {}), 6 * 60 * 60 * 1000);
      })
      .catch((err) => {
        log('SW Registration Failed', err && err.message);
      });
  };

  if (document.readyState === 'complete') onLoad();
  else window.addEventListener('load', onLoad);

  let reloaded = false;
  window.navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    if (window.__SS_UPDATE_REQUESTED__) window.location.reload();
  });

  return true;
}

function showUpdateToast(reg) {
  const host = document.getElementById('update-toast');
  if (!host) return;
  host.classList.add('is-on');
  const btn = document.getElementById('btn-update-app');
  if (btn) {
    btn.onclick = () => {
      window.__SS_UPDATE_REQUESTED__ = true;
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      else window.location.reload();
    };
  }
  const close = document.getElementById('btn-update-later');
  if (close) close.onclick = () => host.classList.remove('is-on');
}

function notify(text) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
