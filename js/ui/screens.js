/**
 * 画面（ホーム / 設定 / ランキング / リザルト / チュートリアル）の制御
 */
import { renderRanking } from './ranking.js';

export class Screens {
  constructor({ game, storage, audio, hud }) {
    this.game = game;
    this.storage = storage;
    this.audio = audio;
    this.hud = hud;
    this.current = null;

    const $ = (id) => document.getElementById(id);
    this.el = {
      home: $('screen-home'),
      settings: $('screen-settings'),
      ranking: $('screen-ranking'),
      result: $('screen-result'),
      tutorial: $('tutorial'),
      pause: $('overlay-pause'),
      screens: Array.from(document.querySelectorAll('.screen')),
    };
    this.bind();
    this.syncSettingsUI();

    game.on('state', (s) => this.onState(s));
    game.on('result', (r) => this.showResult(r));
  }

  /* ---------------- 画面切替 ---------------- */
  show(name) {
    if (name === 'home') this.game.startDemo();
    this.el.screens.forEach((s) => s.classList.toggle('is-active', s.dataset.screen === name));
    this.current = name;
    if (name !== 'result') this.el.result.classList.remove('is-active');
  }

  hideAll() {
    this.el.screens.forEach((s) => s.classList.remove('is-active'));
    this.current = null;
  }

  onState(s) {
    if (s.paused) {
      this.el.pause.classList.add('is-active');
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

    on('btn-start', 'click', tap(() => this.startGame()));
    on('btn-settings', 'click', tap(() => this.show('settings')));
    on('btn-ranking', 'click', tap(() => {
      renderRanking($('ranking-list'), this.storage.ranking);
      this.show('ranking');
    }));
    on('btn-settings-back', 'click', tap(() => this.show('home')));
    on('btn-ranking-back', 'click', tap(() => this.show('home')));

    on('btn-hand-quick', 'click', tap(() => {
      const cur = this.storage.settings.handedness;
      const next = cur === 'right' ? 'left' : 'right';
      this.storage.setSetting('handedness', next);
      this.game.setSettings(this.storage.settings);
      this.syncSettingsUI();
    }));

    // 難易度
    document.querySelectorAll('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', tap(() => {
        this.storage.setSetting('difficulty', btn.dataset.diff);
        this.game.setSettings(this.storage.settings);
        this.syncSettingsUI();
      }));
    });

    // 利き手
    document.querySelectorAll('[data-hand]').forEach((btn) => {
      btn.addEventListener('click', tap(() => {
        this.storage.setSetting('handedness', btn.dataset.hand);
        this.game.setSettings(this.storage.settings);
        this.syncSettingsUI();
      }));
    });

    // サウンド
    on('set-sound', 'click', tap(() => {
      const v = !this.storage.settings.sound;
      this.storage.setSetting('sound', v);
      this.audio.setEnabled(v);
      this.syncSettingsUI();
    }));

    // ランキング削除
    on('btn-clear-ranking', 'click', tap(() => {
      this.storage.clearRanking();
      renderRanking($('ranking-list'), this.storage.ranking);
      this.hud.pushToast('ランキングを削除しました', 'warn');
    }));

    // ポーズ
    on('btn-pause', 'click', tap(() => this.game.pause()));
    on('btn-resume', 'click', tap(() => this.game.resume()));
    on('btn-quit', 'click', tap(() => {
      this.game.resume();
      this.game.finishRun();
    }));
    on('btn-pause-sound', 'click', tap(() => {
      const v = !this.storage.settings.sound;
      this.storage.setSetting('sound', v);
      this.audio.setEnabled(v);
      this.syncSettingsUI();
    }));

    // リザルト
    on('btn-retry', 'click', tap(() => {
      this.hideAll();
      this.game.startRun();
    }));
    on('btn-home', 'click', tap(() => this.show('home')));

    // チュートリアル
    on('tut-close', 'click', tap(() => {
      this.el.tutorial.classList.remove('is-active');
      this.storage.setSetting('seenTutorial', true);
      this.startGame();
    }));
  }

  startGame() {
    if (!this.storage.settings.seenTutorial) {
      this.el.tutorial.classList.add('is-active');
      return;
    }
    this.hideAll();
    this.game.startRun();
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

    const scoreEl = $('res-score');
    const target = result.score;
    let cur = 0;
    if (scoreEl) {
      scoreEl.textContent = '0';
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / 900);
        cur = Math.round(target * (1 - Math.pow(1 - k, 3)));
        scoreEl.textContent = cur.toLocaleString('ja-JP');
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

    const comment = $('res-comment');
    if (comment) {
      comment.textContent =
        result.smashes >= 8 ? 'スマッシュ連発！ 攻めのバドミントン。'
          : result.maxRally >= 12 ? '長いラリーを制した。粘り強い！'
            : result.maxRally >= 6 ? 'いいラリーだった。次はもっと繋げよう。'
              : 'まずはラリーを続けることから。スワイプの長さを意識しよう。';
    }

    this.hud.setVisible(false);
    this.el.screens.forEach((s) => s.classList.toggle('is-active', s.dataset.screen === 'result'));
    this.current = 'result';
  }
}
