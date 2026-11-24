/**
 * PWA インストール誘導 / スタンドアロン判定 / 更新通知
 * ------------------------------------------------------------------
 * ・Chrome / Edge / Android: beforeinstallprompt を捕捉して独自バナーから提示
 * ・iOS Safari: 共有シートからの「ホーム画面に追加」手順を案内
 * ・スタンドアロン起動時は一切表示しない
 * ゲームロジックには一切触れない（DOMのみ）。
 */

const STORE_KEY = 'shuttleSmash.install';
const DISMISS_DAYS = 7;

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* 環境判定                                                            */
/* ------------------------------------------------------------------ */
export const env = {
  get standalone() {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
      window.navigator.standalone === true
    );
  },
  get isIOS() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+ は Mac を名乗るためタッチ点数で判定
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  },
  get isSafari() {
    const ua = navigator.userAgent || '';
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
  },
  get isAndroid() {
    return /Android/.test(navigator.userAgent || '');
  },
  get isMobile() {
    return this.isIOS || this.isAndroid || /Mobi/.test(navigator.userAgent || '');
  },
};

/* ------------------------------------------------------------------ */
/* 保存状態                                                            */
/* ------------------------------------------------------------------ */
function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch (e) {
    /* ストレージ不可でも動作継続 */
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* 本体                                                                */
/* ------------------------------------------------------------------ */
export function initPWA() {
  const banner = $('install-banner');
  const guide = $('ios-install-guide');
  const settingsBtn = $('btn-install-app');
  const settingsLabel = $('btn-install-app-label');

  let deferredPrompt = null;
  let bannerShown = false;

  const isInstalled = () => env.standalone || readState().installed === true;

  /* ---- UI 反映 ---- */
  function syncSettingsRow() {
    if (!settingsBtn || !settingsLabel) return;
    if (isInstalled()) {
      settingsLabel.textContent = 'インストール済み';
      settingsBtn.dataset.state = 'installed';
      settingsBtn.disabled = false;
      settingsBtn.setAttribute('aria-disabled', 'true');
    } else {
      settingsLabel.textContent = env.isIOS ? 'ホーム画面に追加（手順を見る）' : 'アプリをインストール';
      settingsBtn.dataset.state = 'available';
      settingsBtn.disabled = false;
      settingsBtn.removeAttribute('aria-disabled');
    }
  }

  function showBanner() {
    if (!banner || isInstalled() || bannerShown) return;
    bannerShown = true;
    const text = $('install-banner-text');
    if (text) {
      text.textContent = env.isIOS
        ? '共有メニューから追加できます'
        : 'アプリとして全画面で起動できます';
    }
    const cta = $('btn-install');
    if (cta) {
      cta.textContent = env.isIOS ? '手順を見る' : '追加する';
    }
    banner.classList.add('is-on');
    banner.setAttribute('aria-hidden', 'false');
  }

  function hideBanner(userDismissed = false) {
    if (!banner) return;
    banner.classList.remove('is-on');
    banner.setAttribute('aria-hidden', 'true');
    if (userDismissed) writeState({ dismissedAt: Date.now() });
  }

  function showGuide() {
    if (!guide) return;
    guide.classList.add('is-on');
    guide.setAttribute('aria-hidden', 'false');
  }

  function hideGuide() {
    if (!guide) return;
    guide.classList.remove('is-on');
    guide.setAttribute('aria-hidden', 'true');
  }

  /* ---- インストール実行 ---- */
  async function triggerInstall() {
    if (isInstalled()) {
      syncSettingsRow();
      return;
    }
    if (deferredPrompt) {
      hideBanner();
      deferredPrompt.prompt();
      try {
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          writeState({ installed: true });
        }
      } catch (e) {
        /* ユーザーが閉じた場合など */
      }
      deferredPrompt = null;
      syncSettingsRow();
      return;
    }
    // プロンプトが使えない環境（iOS Safari / 既にインストール済み / 非対応ブラウザ）
    showGuide();
  }

  /* ---- イベント登録 ---- */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    scheduleBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    writeState({ installed: true });
    hideBanner();
    hideGuide();
    syncSettingsRow();
    notify('ホーム画面に追加しました');
  });

  if (banner) {
    banner.addEventListener('click', (e) => {
      if (e.target.closest('[data-install-action]')) return;
      triggerInstall();
    });
    const cta = $('btn-install');
    if (cta) cta.addEventListener('click', (e) => { e.stopPropagation(); triggerInstall(); });
    const later = $('btn-install-later');
    if (later) {
      later.addEventListener('click', (e) => {
        e.stopPropagation();
        hideBanner(true);
      });
    }
  }

  if (guide) {
    guide.addEventListener('click', (e) => {
      if (e.target === guide) hideGuide();
    });
    const close = $('btn-ios-guide-close');
    if (close) close.addEventListener('click', () => {
      hideGuide();
      writeState({ dismissedAt: Date.now() });
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      if (isInstalled()) {
        notify('すでにホーム画面に追加されています');
        return;
      }
      triggerInstall();
    });
  }

  /* ---- 初回表示のスケジュール ---- */
  function scheduleBanner() {
    if (isInstalled()) return;
    const state = readState();
    const dismissedAt = state.dismissedAt || 0;
    const wait = dismissedAt ? DISMISS_DAYS * 24 * 60 * 60 * 1000 : 0;
    if (Date.now() - dismissedAt < wait) return;

    const delay = dismissedAt ? 1500 : 1400;
    setTimeout(() => {
      // ホーム画面を表示しているときだけ出す
      const home = $('screen-home');
      if (home && home.classList.contains('is-active')) showBanner();
    }, delay);
  }

  // 起動直後にホーム以外（オートスタート等）の場合は、ホームに戻った時に出す
  let pendingBanner = !isInstalled();
  const homeEl = $('screen-home');
  if (homeEl && 'MutationObserver' in window) {
    const mo = new MutationObserver(() => {
      const active = homeEl.classList.contains('is-active');
      if (active && pendingBanner && !bannerShown) scheduleBanner();
      if (!active) hideBanner();
      pendingBanner = active;
    });
    mo.observe(homeEl, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---- インストール可否の判定（Chrome のインストール可能性） ---- */
  const standaloneQuery = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
  if (standaloneQuery && standaloneQuery.addEventListener) {
    standaloneQuery.addEventListener('change', () => {
      if (env.standalone) {
        hideBanner();
        hideGuide();
        writeState({ installed: true });
      }
      syncSettingsRow();
    });
  }

  syncSettingsRow();
  scheduleBanner();

  return { triggerInstall, showGuide, hideBanner };
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
        // 更新が見つかったら控えめに通知
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast(reg);
            }
          });
        });
        // 6時間おきに更新チェック（起動中のヘビーユーザー向け）
        setInterval(() => reg.update().catch(() => {}), 6 * 60 * 60 * 1000);
      })
      .catch(() => {
        /* 登録失敗時もゲームは通常動作 */
      });
  };

  if (document.readyState === 'complete') onLoad();
  else window.addEventListener('load', onLoad);

  // 新しい SW が制御を奪ったら一度だけリロード
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
