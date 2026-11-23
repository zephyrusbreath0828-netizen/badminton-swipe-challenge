/**
 * HUD（ゲーム中のオーバーレイ表示）
 */
import { clamp, easeOutCubic } from '../core/math.js';

export class Hud {
  constructor(game, storage) {
    this.game = game;
    this.storage = storage;
    this.displayScore = 0;
    this.targetScore = 0;
    this.ribbonTimer = 0;
    this.calloutTimer = 0;

    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('hud'),
      score: $('hud-score'),
      rally: $('hud-rally'),
      level: $('hud-level'),
      bar: $('level-bar'),
      fill: $('level-fill'),
      prompt: $('serve-prompt'),
      ribbon: $('shot-ribbon'),
      callout: $('callout'),
      calloutTitle: $('callout-title'),
      calloutSub: $('callout-sub'),
      toasts: $('toasts'),
      banner: $('level-banner'),
    };
    this.bindGame();
  }

  bindGame() {
    const g = this.game;
    g.on('score', (d) => {
      this.targetScore = d.total;
      this.pushToast(d.sub || `+${d.points}`, d.tone);
    });
    g.on('rally', (d) => {
      if (this.el.rally) this.el.rally.textContent = String(d.rally);
    });
    g.on('shot', (shot) => {
      this.showRibbon(shot);
    });
    g.on('aishot', (d) => {
      if (!this.visible) return;
      this.showRibbon({ label: d.label, en: d.type.toUpperCase(), owner: 'ai' });
    });
    g.on('callout', (d) => this.showCallout(d));
    g.on('toast', (d) => this.pushToast(d.text, d.tone));
    g.on('levelup', (d) => this.showLevelUp(d.level));
    g.on('state', (s) => {
      if (s.phase === 'serve' || s.phase === 'rally') this.resetCounters();
    });
  }

  get visible() {
    return this.el.root.classList.contains('is-active');
  }

  setVisible(v) {
    this.el.root.classList.toggle('is-active', !!v);
  }

  resetCounters() {
    this.displayScore = this.game.score;
    this.targetScore = this.game.score;
    if (this.el.score) this.el.score.textContent = String(this.game.score);
    if (this.el.rally) this.el.rally.textContent = String(this.game.rally);
    if (this.el.level) this.el.level.textContent = String(this.game.level);
    this.updateBar();
    if (this.el.toasts) this.el.toasts.innerHTML = '';
  }

  showRibbon(shot) {
    const r = this.el.ribbon;
    if (!r) return;
    const isAI = shot.owner === 'ai';
    r.textContent = isAI ? `AI ${shot.label || ''}` : `${shot.label || ''}  ${shot.en || ''}`;
    r.dataset.owner = isAI ? 'ai' : 'player';
    r.classList.remove('is-on');
    void r.offsetWidth;
    r.classList.add('is-on');
    this.ribbonTimer = 1.1;
  }

  showCallout({ title, sub = '', tone = 'normal' }) {
    const c = this.el.callout;
    if (!c) return;
    this.el.calloutTitle.textContent = title || '';
    this.el.calloutSub.textContent = sub || '';
    c.dataset.tone = tone;
    c.classList.remove('is-on');
    void c.offsetWidth;
    c.classList.add('is-on');
    this.calloutTimer = 1.4;
  }

  showLevelUp(level) {
    const b = this.el.banner;
    if (b) {
      b.querySelector('.level-banner__num').textContent = `LEVEL ${level}`;
      b.classList.remove('is-on');
      void b.offsetWidth;
      b.classList.add('is-on');
    }
    this.pushToast(`LEVEL ${level} にアップ！`, 'level');
  }

  pushToast(text, tone = 'normal') {
    const box = this.el.toasts;
    if (!box || !text) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.tone = tone;
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 400);
    }, 780);
    while (box.children.length > 4) box.firstElementChild.remove();
  }

  updateBar() {
    const { fill, bar } = this.el;
    if (!fill || !bar) return;
    const step = 100;
    const lv = this.game.level;
    const inLevel = this.game.score - (lv - 1) * step;
    const pct = clamp(inLevel / step, 0, 1);
    fill.style.width = `${pct * 100}%`;
    if (this.el.level) this.el.level.textContent = String(lv);
  }

  update(dt) {
    // スコアのカウントアップ
    if (this.displayScore !== this.targetScore) {
      const diff = this.targetScore - this.displayScore;
      this.displayScore += Math.sign(diff) * Math.max(1, Math.abs(diff) * dt * 9);
      if (Math.abs(this.targetScore - this.displayScore) < 0.6) this.displayScore = this.targetScore;
      if (this.el.score) this.el.score.textContent = String(Math.round(this.displayScore));
    }
    this.updateBar();

    if (this.ribbonTimer > 0) {
      this.ribbonTimer -= dt;
      if (this.ribbonTimer <= 0 && this.el.ribbon) this.el.ribbon.classList.remove('is-on');
    }
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0 && this.el.callout) this.el.callout.classList.remove('is-on');
    }

    // サーブ促し
    if (this.el.prompt) {
      const show = this.game.phase === 'serve' && !this.game.demo;
      this.el.prompt.classList.toggle('is-on', show);
    }
  }
}
