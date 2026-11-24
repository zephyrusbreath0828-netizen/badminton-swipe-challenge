/**
 * PWA インストール制御（DOM 非依存 / テスト可能）
 * ------------------------------------------------------------------
 * 標準フロー:
 *   1. beforeinstallprompt を捕捉してイベントを保持
 *   2. ボタン押下で prompt() を呼ぶ
 *   3. userChoice を待つ
 *      - accepted  -> インストール済みとしてボタンを隠す
 *      - dismissed -> プロンプトは破棄（Chrome は再発火しないため手順案内へ）
 *   4. 未対応環境（iOS Safari 等）は手順ダイアログへフォールバック
 */

export const INSTALL_STORE_KEY = 'shuttleSmash.install';

/** 'ios' | 'android' | 'desktop' */
export function detectPlatform(nav = {}) {
  const ua = nav.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
  if (iOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** スタンドアロン（ホーム画面から起動）か */
export function isStandalone(win = {}) {
  const nav = win.navigator || {};
  if (nav.standalone === true) return true;
  const mm = win.matchMedia;
  if (typeof mm !== 'function') return false;
  try {
    return mm('(display-mode: standalone)').matches || mm('(display-mode: fullscreen)').matches;
  } catch (e) {
    return false;
  }
}

/**
 * ローカル保存付きのストア（localStorage を差し替え可能）
 */
export function createStore(storage, key = INSTALL_STORE_KEY) {
  const read = () => {
    try {
      return JSON.parse((storage && storage.getItem(key)) || '{}') || {};
    } catch (e) {
      return {};
    }
  };
  return {
    key,
    get: read,
    set(patch) {
      const next = { ...read(), ...patch };
      try {
        storage.setItem(key, JSON.stringify(next));
      } catch (e) { /* 保存不可でも動作継続 */ }
      return next;
    },
  };
}

export class PwaInstaller {
  /**
   * @param {{win?:object, nav?:object, store?:object}} opts
   */
  constructor({ win = globalThis, nav = {}, store = null } = {}) {
    this.win = win;
    this.nav = nav;
    this.store = store;
    this.deferred = null;
    this._installed = !!(store && store.get().installed);
    this._listeners = [];
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((f) => f !== fn);
    };
  }

  _emit(reason) {
    for (const fn of this._listeners) {
      try { fn(this.snapshot(), reason); } catch (e) { /* UIエラーで停止しない */ }
    }
  }

  get platform() {
    return detectPlatform(this.nav);
  }

  get installed() {
    return this._installed || isStandalone(this.win);
  }

  get canPrompt() {
    return !!this.deferred && !this.installed;
  }

  /** 'installed' | 'prompt' | 'manual' */
  get mode() {
    if (this.installed) return 'installed';
    if (this.canPrompt) return 'prompt';
    return 'manual';
  }

  snapshot() {
    return {
      mode: this.mode,
      installed: this.installed,
      canPrompt: this.canPrompt,
      platform: this.platform,
    };
  }

  /** beforeinstallprompt を捕捉（必ず呼ぶ） */
  capturePrompt(event) {
    if (!event) return false;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    this.deferred = event;
    this._emit('captured');
    return true;
  }

  /**
   * インストールを実行する
   * @returns {Promise<{outcome:'accepted'|'dismissed'|'unavailable'|'installed'|'error'}>}
   */
  async prompt() {
    if (this.installed) return { outcome: 'installed' };
    if (!this.deferred) return { outcome: 'unavailable' };

    const ev = this.deferred;
    this.deferred = null; // prompt は 1 イベント 1 回だけ

    let choice = null;
    try {
      await ev.prompt();
      choice = await ev.userChoice;
    } catch (e) {
      this._emit('error');
      return { outcome: 'error' };
    }

    const outcome = (choice && choice.outcome) || 'dismissed';
    if (outcome === 'accepted') {
      this.markInstalled();
      return { outcome: 'accepted' };
    }
    this._emit('dismissed');
    return { outcome: 'dismissed' };
  }

  markInstalled() {
    this._installed = true;
    this.deferred = null;
    if (this.store) this.store.set({ installed: true, installedAt: Date.now() });
    this._emit('installed');
  }

  /** 手順ダイアログを出すべきか（iOS / プロンプト不可の Android・PC） */
  get needsGuide() {
    return !this.installed && !this.canPrompt;
  }

  /** 手順ダイアログの文言キー */
  get guideKind() {
    if (this.platform === 'ios') return 'ios';
    if (this.platform === 'android') return 'android';
    return 'desktop';
  }
}
