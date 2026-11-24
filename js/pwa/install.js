/**
 * PWA インストール UI（DOM 配線のみ）
 * ------------------------------------------------------------------
 * 実際の判定・プロンプト制御は pwa/installer.js（純ロジック）が担当する。
 *
 * ・beforeinstallprompt は index.html の冒頭スクリプトが最速で捕捉し、
 *   window.__installPrompt に保持 → ここで受け取る（取りこぼし対策）
 * ・Android/Chrome: ネイティブのインストールダイアログを表示
 * ・iPhone/Safari: 「共有 → ホーム画面に追加 → 追加」の手順ダイアログ
 * ・インストール済み: ボタンを隠し「アプリインストール済み」と表示
 */
import {
  PwaInstaller,
  createStore,
  detectPlatform,
  isStandalone,
} from './installer.js';

const $ = (id) => document.getElementById(id);

export const env = {
  get standalone() { return isStandalone(window); },
  get platform() { return detectPlatform(navigator); },
  get isIOS() { return detectPlatform(navigator) === 'ios'; },
  get isAndroid() { return detectPlatform(navigator) === 'android'; },
  get isSafari() {
    const ua = navigator.userAgent || '';
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
  },
  get isMobile() { return this.platform !== 'desktop'; },
};

/* 手順ダイアログの文言 */
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
  const store = createStore(window.localStorage);
  const installer = new PwaInstaller({ win: window, nav: navigator, store });

  /* ---------- DOM ---------- */
  const banner = $('install-banner');
  const dialog = $('install-dialog');
  const rowBtn = $('btn-install-app');
  const rowLabel = $('btn-install-app-label');
  const rowHint = $('btn-install-app-hint');
  const installedNote = $('install-installed-note');
  const cta = $('btn-install');
  const later = $('btn-install-later');
  const bannerText = $('install-banner-text');

  let bannerShown = false;
  let lastLevelUpAt = 0;

  /* ---------- 早期捕捉済みイベントの取り込み ---------- */
  function adoptEarlyPrompt() {
    const early = window.__installPrompt;
    if (early && !installer.canPrompt) {
      installer.capturePrompt(early);
      window.__installPrompt = null;
    }
  }

  window.addEventListener('ss:installprompt', () => {
    adoptEarlyPrompt();
    scheduleBanner();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    // index.html の早期ハンドラが無い場合のフォールバック
    installer.capturePrompt(e);
    scheduleBanner();
  });

  window.addEventListener('appinstalled', () => {
    installer.markInstalled();
    hideBanner();
    hideDialog();
    notify('ホーム画面に追加しました');
  });

  /* ---------- 表示更新 ---------- */
  function syncUI() {
    const snap = installer.snapshot();

    // 設定画面の行
    if (rowBtn && rowLabel) {
      if (snap.installed) {
        rowLabel.textContent = 'アプリインストール済み';
        rowBtn.dataset.state = 'installed';
        rowBtn.setAttribute('aria-disabled', 'true');
        rowBtn.classList.add('is-installed');
        if (rowHint) rowHint.textContent = 'ホーム画面から全画面で起動できます';
        if (installedNote) installedNote.hidden = false;
      } else {
        rowLabel.textContent = snap.canPrompt
          ? 'アプリをインストール'
          : (snap.platform === 'ios' ? 'ホーム画面に追加' : 'インストール方法を見る');
        rowBtn.dataset.state = 'available';
        rowBtn.removeAttribute('aria-disabled');
        rowBtn.classList.remove('is-installed');
        if (rowHint) rowHint.textContent = 'ホーム画面に追加して全画面で起動';
        if (installedNote) installedNote.hidden = true;
      }
    }

    // バナー
    if (banner) {
      if (snap.installed) hideBanner();
      if (cta) {
        cta.textContent = snap.canPrompt ? 'インストール' : '追加方法';
      }
      if (bannerText) {
        bannerText.textContent = snap.platform === 'ios'
          ? '共有メニューからホーム画面に追加できます'
          : 'アプリとして全画面で起動できます';
      }
    }
  }

  /* ---------- ダイアログ ---------- */
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
    const wait = dismissedAt ? 7 * 24 * 60 * 60 * 1000 : 0;
    if (Date.now() - dismissedAt < wait) return;
    setTimeout(() => {
      const home = $('screen-home');
      if (home && home.classList.contains('is-active')) showBanner();
    }, dismissedAt ? 1500 : 1200);
  }

  /* ---------- インストール実行 ---------- */
  async function requestInstall({ fromBanner = false } = {}) {
    adoptEarlyPrompt();
    const snap = installer.snapshot();

    if (snap.installed) {
      notify('すでにホーム画面に追加されています');
      syncUI();
      return { outcome: 'installed' };
    }

    // 1) ネイティブプロンプトが使える（Android Chrome / PC Chrome）
    if (installer.canPrompt) {
      if (fromBanner) hideBanner();
      const res = await installer.prompt();
      syncUI();
      if (res.outcome === 'accepted') notify('インストールしました');
      else if (res.outcome === 'dismissed') {
        // 一度閉じると Chrome は再プロンプト不可。手順を案内する
        openDialog();
      } else if (res.outcome === 'error') {
        openDialog();
      }
      return res;
    }

    // 2) プロンプト不可（iOS Safari / インストール不成立の Chrome）
    if (fromBanner) hideBanner();
    openDialog();
    return { outcome: 'unavailable' };
  }

  /* ---------- イベント配線 ---------- */
  if (rowBtn) {
    rowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestInstall();
    });
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
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) hideDialog();
    });
    const close = $('btn-install-dialog-close');
    if (close) close.addEventListener('click', () => {
      hideDialog();
      store.set({ dismissedAt: Date.now() });
    });
  }

  /* ---------- 状態変化の購読 ---------- */
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

  /* ---------- ホーム復帰時にバナー ---------- */
  const homeEl = $('screen-home');
  if (homeEl && 'MutationObserver' in window) {
    new MutationObserver(() => {
      const active = homeEl.classList.contains('is-active');
      if (active) scheduleBanner();
      else hideBanner();
    }).observe(homeEl, { attributes: true, attributeFilter: ['class'] });
  }

  adoptEarlyPrompt();
  syncUI();
  scheduleBanner();

  // デバッグ・テスト用
  window.__installer = installer;
  return { installer, requestInstall, openDialog, syncUI };
}

/* ------------------------------------------------------------------ */
/* Service Worker 登録 + 更新通知                                       */
/* ------------------------------------------------------------------ */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (!/^https?:$/.test(location.protocol)) return null;

  const onLoad = () => {
    navigator.serviceWorker
      .register('./service-worker.js', { scope: './' })
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast(reg);
            }
          });
        });
        setInterval(() => reg.update().catch(() => {}), 6 * 60 * 60 * 1000);
      })
      .catch(() => { /* 登録失敗時もゲームは通常動作 */ });
  };

  if (document.readyState === 'complete') onLoad();
  else window.addEventListener('load', onLoad);

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    if (window.__SS_UPDATE_REQUESTED__) location.reload();
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
      else location.reload();
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
  setTimeout(() => el.remove(), 2200);
}
