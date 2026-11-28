/**
 * 画面（ホーム / 育成 / 設定 / ランキング / リザルト / チュートリアル）
 * ------------------------------------------------------------------
 * v1.2.0: ホームを Play / Training / Character / Settings の4導線へ。
 *         試合結果からプレイヤー経験値・育成ポイントを付与する。
 */
import { renderRanking } from './ranking.js';
import { STAT_KEYS, STAT_META, PROFILE_CONFIG } from '../core/profile.js';
import { deriveAbilities, fmtMul } from '../core/training.js';

/** 能力の英語表記（要件: Speed / Stamina / Shot Accuracy / Smash Power） */
const STAT_EN = {
  speed: 'Speed',
  stamina: 'Stamina',
  accuracy: 'Shot Accuracy',
  smash: 'Smash Power',
};

export class Screens {
  constructor({ game, storage, audio, hud, profile }) {
    this.game = game;
    this.storage = storage;
    this.audio = audio;
    this.hud = hud;
    this.profile = profile;
    this.current = null;

    const $ = (id) => document.getElementById(id);
    this.el = {
      home: $('screen-home'),
      settings: $('screen-settings'),
      ranking: $('screen-ranking'),
      result: $('screen-result'),
      character: $('screen-character'),
      training: $('screen-training'),
      tutorial: $('tutorial'),
      pause: $('overlay-pause'),
      statList: $('stat-list'),
      screens: Array.from(document.querySelectorAll('.screen')),
    };
    this.bind();
    this.syncSettingsUI();
    this.syncHomeProfile();
    this.renderCharacter();

    // 起動ログ（要件）
    console.log('Training initialized');
    console.log('Character initialized');
    // 実機で「どのビルドが動いているか」を判定するための1行
    try {
      const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
      console.log('Build ' + (window.__BUILD__ || 'unknown')
        + ' / SW ' + (ctrl ? (ctrl.scriptURL || '').split('/').pop() : 'no-controller'));
    } catch (e) { /* noop */ }

    game.on('rally', (d) => {
      const el = document.getElementById('training-rally-now');
      if (el) el.textContent = String(d && typeof d.rally === 'number' ? d.rally : 0);
    });

    game.on('state', (s) => this.onState(s));
    game.on('result', (r) => this.showResult(r));
    game.on('levelup', () => { /* ゲーム内レベル（スコア）用：HUDが担当 */ });
  }


  /* ---------------- Debug パネル（v1.2.9） ---------------- */
  /** ボタンが「存在 + リスナー登録済み」なら Connected */
  debugRows() {
    const ids = [
      ['btn-start', 'Play Button'],
      ['btn-training', 'Training Button'],
      ['btn-character', 'Character Button'],
      ['btn-settings', 'Settings Button'],
    ];
    return ids.map(([id, label]) => {
      const el = document.getElementById(id);
      const wired = !!(this._acts && this._acts[id]);
      const exists = !!el;
      return {
        id,
        label,
        exists,
        wired,
        connected: exists && wired,
        state: exists && wired ? 'Connected' : 'Missing',
        tag: el ? `${el.tagName.toLowerCase()}${el.dataset.wired === '1' ? '[wired]' : ''}` : '-',
      };
    });
  }

  syncDebugPanel() {
    const list = document.getElementById('debug-list');
    if (!list) return;
    const rows = this.debugRows();
    list.innerHTML = rows.map((r) => `
      <div class="debug-row" data-ok="${r.connected ? '1' : '0'}">
        <span class="debug-row__label">${r.label}:</span>
        <span class="debug-row__value">${r.state}</span>
        <span class="debug-row__meta">${r.id} ${r.tag}</span>
      </div>`).join('');

    const info = document.getElementById('debug-info');
    if (info) {
      const ctrl = (() => {
        try { return navigator.serviceWorker && navigator.serviceWorker.controller; } catch (e) { return null; }
      })();
      info.textContent = [
        `build: ${window.__BUILD__ || 'unknown'}`,
        `sw: ${ctrl ? (ctrl.scriptURL || '').split('/').pop() : 'no-controller'}`,
        `last: ${this._lastEvent || 'none'}`,
        `screens: ${this.current || '-'}`,
      ].join('\n');
    }
  }

  toggleDebug(force) {
    const panel = document.getElementById('debug-panel');
    const btn = document.getElementById('btn-debug');
    if (!panel) return;
    const on = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !on;
    if (on) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    panel.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) this.syncDebugPanel();
  }

  /* ---------------- 画面切替 ---------------- */
  show(name) {
    if (name !== 'training') this.setTrainingCounter(false);
    if (name === 'home') {
      this.game.training = false;
      this.game.startDemo();
      this.syncHomeProfile();
      this.syncDebugPanel();
    }
    if (name === 'character') this.renderCharacter();
    if (name === 'training') {
      this.renderTraining();
      if (this.game && !this.game.demo) this.game.goHome();
    }
    this.el.screens.forEach((s) => s.classList.toggle('is-active', s.dataset.screen === name));
    this.current = name;
    if (name !== 'result') this.el.result.classList.remove('is-active');
    // インストール誘導バナーはホームのみ
    const banner = document.getElementById('install-banner');
    if (banner && name !== 'home') banner.classList.remove('is-on');
  }

  hideAll() {
    this.el.screens.forEach((s) => s.classList.remove('is-active'));
    this.current = null;
    this.setTrainingCounter(false);
  }

  /** 練習中のラリーカウンタ表示切替 */
  setTrainingCounter(on) {
    const el = document.getElementById('training-counter');
    if (!el) return;
    el.hidden = !on;
    el.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) {
      el.removeAttribute('hidden');
      const num = document.getElementById('training-rally-now');
      if (num) num.textContent = String((this.game && this.game.rally) || 0);
    } else {
      el.setAttribute('hidden', '');
    }
  }

  onState(s) {
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.classList.toggle('is-training', !!s.training);

    if (s.paused) {
      this.el.pause.classList.add('is-active');
      const quit = document.getElementById('btn-quit');
      if (quit) quit.textContent = s.training ? 'トレーニングを終了' : 'リタイア（結果を見る）';
      return;
    }
    this.el.pause.classList.remove('is-active');

    if (s.phase === 'home') {
      this.show('home');
      this.hud.setVisible(false);
      return;
    }
    if (s.phase === 'result') {
      this.hud.setVisible(false);
      return;
    }
    this.hideAll();
    this.hud.setVisible(!s.demo);
    if (this.hud.el.prompt) this.hud.el.prompt.classList.toggle('is-hidden', !!s.training);
  }

  /* ---------------- イベント ---------------- */
  bind() {
    const $ = (id) => document.getElementById(id);
    const on = (id, evt, fn) => {
      const el = $(id);
      if (el) el.addEventListener(evt, fn);
    };
    const tap = (fn) => (e) => {
      e.preventDefault();
      if (this.audio) this.audio.unlock();
      if (this.audio) this.audio.ui();
      fn(e);
    };

    /* --- ホーム --- */
    /* ------------------------------------------------------------------
       タップ活性化（v1.2.9）
       click が抑止される環境でも確実に発火させるため
         1) 要素へ click / pointerup / touchend を直接登録
         2) document の捕捉フェーズにも委譲（ノード差し替え・capture 対策）
       二重発火は 400ms のガードで防ぐ。配線状況は Debug パネルで確認できる。
       ------------------------------------------------------------------ */
    this._acts = this._acts || {};
    this._last = this._last || {};

    const act = (id, fn, logMsg) => {
      const el = $(id);
      const run = (e, meta) => {
        const now = Date.now();
        if (now - (this._last[id] || 0) < 400) return;
        this._last[id] = now;
        // 押下ログは最優先（例外より前）
        if (logMsg) {
          try { console.log(logMsg); } catch (err) { /* noop */ }
        }
        this._lastEvent = `${id} (${(meta && meta.type) || (e && e.type) || 'unknown'})`;
        this.syncDebugPanel();
        if (e && e.cancelable) { try { e.preventDefault(); } catch (err) { /* noop */ } }
        if (this.audio) { try { this.audio.unlock(); this.audio.ui(); } catch (err) { /* noop */ } }
        try {
          fn(e);
        } catch (err) {
          console.error('[tap] handler failed:', id, err && err.message);
          if (this.hud) this.hud.pushToast('操作に失敗しました', 'warn');
        }
      };
      this._acts[id] = run;
      if (!el) return;
      el.addEventListener('click', (e) => run(e, { type: 'click' }));
      el.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') run(e, { type: 'pointerup:' + e.pointerType }); });
      el.addEventListener('touchend', (e) => run(e, { type: 'touchend' }), { passive: false });
      el.dataset.wired = '1';
    };

    // 委譲（捕捉フェーズ）: 直接リスナーが効かない環境の保険
    if (!this._delegated) {
      this._delegated = true;
      const HANDLED = ['btn-start', 'btn-training', 'btn-character', 'btn-settings'];
      const fire = (e, type) => {
        const t = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!t || !t.id || HANDLED.indexOf(t.id) === -1) return;
        const fn = this._acts && this._acts[t.id];
        if (fn) fn(e, { type: 'delegated:' + type });
      };
      document.addEventListener('click', (e) => fire(e, 'click'), true);
      document.addEventListener('touchend', (e) => fire(e, 'touchend'), true);
    }

    act('btn-start', () => this.startGame(), 'Play button clicked');
    act('btn-training', () => this.show('training'), 'Training button clicked');
    act('btn-character', () => this.show('character'), 'Character button clicked');
    act('btn-settings', () => this.show('settings'), 'Settings button clicked');
    act('btn-ranking', () => {
      renderRanking($('ranking-list'), this.storage.ranking);
      this.show('ranking');
    });
    act('btn-training-start', () => this.startTraining());
    act('btn-training-back', () => this.show('home'));
    act('btn-debug', () => this.toggleDebug(), 'Debug button clicked');
    act('btn-debug-close', () => this.toggleDebug(false));
    act('btn-settings-back', () => this.show('home'));
    act('btn-ranking-back', () => this.show('home'));
    act('btn-character-back', () => this.show('home'));

    /* --- 育成 --- */
    if (this.el.statList) {
      this.el.statList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-upgrade]');
        if (!btn) return;
        e.preventDefault();
        if (this.audio) this.audio.unlock();
        this.upgrade(btn.dataset.upgrade);
      });
    }

    /* --- 設定 --- */
    on('btn-hand-quick', 'click', tap(() => {
      const cur = this.storage.settings.handedness;
      const next = cur === 'right' ? 'left' : 'right';
      this.storage.setSetting('handedness', next);
      this.game.setSettings(this.storage.settings);
      this.syncSettingsUI();
    }));

    document.querySelectorAll('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', tap(() => {
        this.storage.setSetting('difficulty', btn.dataset.diff);
        this.game.setSettings(this.storage.settings);
        this.syncSettingsUI();
      }));
    });

    document.querySelectorAll('[data-hand]').forEach((btn) => {
      btn.addEventListener('click', tap(() => {
        this.storage.setSetting('handedness', btn.dataset.hand);
        this.game.setSettings(this.storage.settings);
        this.syncSettingsUI();
      }));
    });

    on('set-sound', 'click', tap(() => {
      const v = !this.storage.settings.sound;
      this.storage.setSetting('sound', v);
      this.audio.setEnabled(v);
      this.syncSettingsUI();
    }));

    on('btn-clear-ranking', 'click', tap(() => {
      this.storage.clearRanking();
      renderRanking($('ranking-list'), this.storage.ranking);
      this.hud.pushToast('ランキングを削除しました', 'warn');
    }));

    /* --- ポーズ --- */
    on('btn-pause', 'click', tap(() => this.game.pause()));
    on('btn-resume', 'click', tap(() => this.game.resume()));
    on('btn-quit', 'click', tap(() => {
      this.game.resume();
      if (this.game.training) {
        this.game.goHome();
        this.show('home');
      } else {
        this.game.finishRun();
      }
    }));
    on('btn-pause-sound', 'click', tap(() => {
      const v = !this.storage.settings.sound;
      this.storage.setSetting('sound', v);
      this.audio.setEnabled(v);
      this.syncSettingsUI();
    }));

    /* --- リザルト --- */
    on('btn-retry', 'click', tap(() => {
      this.hideAll();
      this.startGame(true);
    }));
    on('btn-home', 'click', tap(() => this.show('home')));

    /* --- チュートリアル --- */
    on('tut-close', 'click', tap(() => {
      this.el.tutorial.classList.remove('is-active');
      this.storage.setSetting('seenTutorial', true);
      this.startGame(true);
    }));
  }

  /* ---------------- ゲーム開始 ---------------- */
  applyAbilities() {
    const abilities = deriveAbilities(this.profile.stats);
    this.game.setAbilities(abilities);
    return abilities;
  }

  startGame(force = false) {
    if (!force && !this.storage.settings.seenTutorial) {
      this.el.tutorial.classList.add('is-active');
      return;
    }
    this.hideAll();
    this.applyAbilities();
    this.game.startRun();
  }

  startTraining() {
    this.applyAbilities();
    this.game.startTraining();
    this.hideAll();
    this.setTrainingCounter(true);
  }

  /* ---------------- 練習画面 ---------------- */
  renderTraining() {
    const total = (this.storage.stats && this.storage.stats.bestRally) || 0;
    const el = document.getElementById('training-best-rally');
    if (el) el.textContent = String(total);
    const plays = document.getElementById('training-plays');
    if (plays) plays.textContent = String((this.storage.stats && this.storage.stats.plays) || 0);
  }

  /* ---------------- ホームのプレイヤー表示 ---------------- */
  syncHomeProfile() {
    const $ = (id) => document.getElementById(id);
    const p = this.profile;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('home-lv', `Lv.${p.level}`);
    set('home-pt', `${p.points} pt`);
    const fill = $('home-exp-fill');
    if (fill) fill.style.width = `${Math.round(p.expProgress * 100)}%`;
    const bar = $('home-exp-bar');
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(p.expProgress * 100)));

    // ポイントが余っていれば Character にバッジ
    const badge = $('character-badge');
    if (badge) badge.hidden = p.points <= 0;
  }

  /* ---------------- 育成画面 ---------------- */
  renderCharacter() {
    const p = this.profile;
    const $ = (id) => document.getElementById(id);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };

    set('char-level', String(p.level));
    set('char-points', String(p.points));
    set('char-exp-text', p.isMaxLevel
      ? 'MAX'
      : `${p.exp} / ${p.expNeeded}`);
    const fill = $('char-exp-fill');
    if (fill) fill.style.width = `${Math.round(p.expProgress * 100)}%`;
    const sum = $('char-sum');
    if (sum) sum.textContent = `${p.totalStats} / ${STAT_KEYS.length * PROFILE_CONFIG.maxStat}`;

    if (!this.el.statList) return;
    const abilities = deriveAbilities(p.stats);

    const effectText = {
      speed: `移動速度 ${fmtMul(abilities.speedMul)}・リーチ +${Math.round((abilities.reachMul - 1) * 100)}%`,
      stamina: `疲労 ${Math.round(abilities.fatigueMul * 100)}%・獲得EXP +${Math.round(((p.stats.stamina - 50) / 50) * PROFILE_CONFIG.staminaExpBonusMax * 100)}%`,
      accuracy: `コース誤差 ${Math.round(abilities.accuracyMul * 100)}%`,
      smash: `球速 ${fmtMul(1 / abilities.smashFlightMul)}・スコア ${fmtMul(abilities.smashScoreMul)}`,
    };

    this.el.statList.innerHTML = STAT_KEYS.map((key) => {
      const meta = STAT_META[key];
      const val = p.stats[key];
      const pct = ((val - PROFILE_CONFIG.initialStat) / (PROFILE_CONFIG.maxStat - PROFILE_CONFIG.initialStat)) * 100;
      const isMax = val >= PROFILE_CONFIG.maxStat;
      const canBuy = !isMax && p.points > 0;
      return `
        <div class="stat-row${isMax ? ' is-max' : ''}" data-key="${key}">
          <div class="stat-row__top">
            <span class="stat-row__icon">${meta.icon}</span>
            <span class="stat-row__name">${meta.label}<small class="stat-row__en">${STAT_EN[key] || ''}</small></span>
            <span class="stat-row__val">${val}<small>/${PROFILE_CONFIG.maxStat}</small></span>
          </div>
          <div class="stat-row__bar"><i style="width:${pct}%"></i></div>
          <div class="stat-row__desc">${meta.desc}　<span style="color:#5d7383">${effectText[key]}</span></div>
          <button class="stat-row__plus" data-upgrade="${key}" type="button"
            ${canBuy ? '' : 'disabled'} aria-label="${meta.label}を強化">
            ${isMax ? 'MAX' : '＋'}
          </button>
        </div>`;
    }).join('');

    this.syncHomeProfile();
  }

  upgrade(key) {
    const res = this.profile.upgrade(key);
    if (!res.ok) {
      if (res.reason === 'no-points') this.hud.pushToast('ポイントが足りません', 'warn');
      else if (res.reason === 'max') this.hud.pushToast('すでに最大値です', 'warn');
      return;
    }
    this.storage.saveProfile(this.profile.toJSON());
    if (this.audio) this.audio.point();
    this.applyAbilities();
    this.renderCharacter();
    const meta = STAT_META[key];
    this.hud.pushToast(`${meta.label} +1 → ${res.stat}`, 'good');
  }

  /* ---------------- 設定の反映 ---------------- */
  syncSettingsUI() {
    const s = this.storage.settings;
    document.querySelectorAll('[data-diff]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.diff === s.difficulty);
    });
    document.querySelectorAll('[data-hand]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.hand === s.handedness);
    });
    document.querySelectorAll('[data-hand-label]').forEach((b) => {
      b.textContent = s.handedness === 'right' ? '右利き' : '左利き';
      b.dataset.hand = s.handedness;
    });
    const snd = document.getElementById('set-sound');
    if (snd) {
      snd.textContent = s.sound ? 'ON' : 'OFF';
      snd.classList.toggle('is-off', !s.sound);
    }
    const ps = document.getElementById('pause-sound-label');
    if (ps) ps.textContent = s.sound ? 'サウンド ON' : 'サウンド OFF';
  }

  /* ---------------- リザルト ---------------- */
  showResult(result) {
    const $ = (id) => document.getElementById(id);
    const rank = this.storage.addRanking(result);

    /* --- 報酬（育成）--- */
    const reward = this.profile.applyMatchResult(result);
    this.storage.saveProfile(this.profile.toJSON());

    const scoreEl = $('res-score');
    const target = result.score;
    if (scoreEl) {
      scoreEl.textContent = '0';
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / 900);
        scoreEl.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString('ja-JP');
        if (k < 1) requestAnimationFrame(tick);
        else scoreEl.textContent = target.toLocaleString('ja-JP');
      };
      requestAnimationFrame(tick);
    }

    const set = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    set('res-rally', result.maxRally);
    set('res-smash', result.smashes);
    set('res-level', result.level);

    const badge = $('res-badge');
    if (badge) {
      if (rank === 1) {
        badge.textContent = 'NEW RECORD!';
        badge.dataset.tone = 'gold';
      } else if (rank > 1) {
        badge.textContent = `ランキング ${rank}位`;
        badge.dataset.tone = 'silver';
      } else {
        badge.textContent = `ベスト ${this.storage.stats.bestScore}pt`;
        badge.dataset.tone = 'plain';
      }
    }

    /* --- 報酬の描画 --- */
    set('res-points', String(reward.points));
    set('res-exp', `+${reward.exp}`);
    const staminaNote = $('res-exp-bonus');
    if (staminaNote) {
      staminaNote.textContent = reward.staminaBonus > 0.001
        ? `スタミナボーナス +${Math.round(reward.staminaBonus * 100)}%`
        : '';
    }
    const list = $('res-reward-list');
    if (list) {
      const items = [
        ['参加', reward.breakdown.attend],
        ['ラリー', reward.breakdown.rally],
        ['スマッシュ', reward.breakdown.smash],
      ];
      if (result.win) items.push(['勝利', reward.breakdown.win]);
      list.innerHTML = items
        .map(([name, v]) => `<li class="reward__item">${name}<b>+${v}</b></li>`)
        .join('');
    }
    const lu = $('res-levelup');
    if (lu) {
      if (reward.levels > 0) {
        lu.textContent = `LEVEL UP! → Lv.${this.profile.level}　+${PROFILE_CONFIG.levelUpPoints * reward.levels}pt`;
        lu.classList.add('is-on');
      } else {
        lu.classList.remove('is-on');
      }
    }
    const winTag = $('res-win');
    if (winTag) {
      winTag.hidden = !result.win;
    }

    const comment = $('res-comment');
    if (comment) {
      comment.textContent = result.smashes >= 8 ? 'スマッシュ連発！ 攻めのバドミントン。'
        : result.maxRally >= 12 ? '長いラリーを制した。粘り強い！'
          : result.maxRally >= 6 ? 'いいラリーだった。次はもっと繋げよう。'
            : 'まずはラリーを続けることから。スワイプの長さを意識しよう。';
    }

    // レベルアップ演出・効果音
    if (reward.levels > 0) {
      const banner = document.getElementById('level-banner');
      if (banner) {
        const num = banner.querySelector('.level-banner__num');
        const label = banner.querySelector('.level-banner__label');
        if (num) num.textContent = `PLAYER Lv.${this.profile.level}`;
        if (label) label.textContent = '育成ポイント獲得！';
        banner.classList.remove('is-on');
        void banner.offsetWidth;
        banner.classList.add('is-on');
        setTimeout(() => banner.classList.remove('is-on'), 2000);
      }
      if (this.audio) this.audio.levelUp();
      this.hud.pushToast(`Lv.${this.profile.level} にアップ！ +${PROFILE_CONFIG.levelUpPoints * reward.levels}pt`, 'level');
    }

    this.syncHomeProfile();
    this.hud.setVisible(false);
    this.el.screens.forEach((s) => s.classList.toggle('is-active', s.dataset.screen === 'result'));
    this.current = 'result';
  }
}
