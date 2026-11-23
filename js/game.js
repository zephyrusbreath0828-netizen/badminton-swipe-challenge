/**
 * ゲーム本体（状態機械 / ラリー進行 / スコア）
 * DOMに依存しない。UIへはイベントで通知する。
 */
import { CONFIG } from './config.js';
import { Camera } from './core/camera.js';
import { Shuttle } from './core/shuttle.js';
import { Player } from './core/player.js';
import { AI } from './core/ai.js';
import { Effects } from './core/effects.js';
import { resolveServe, resolvePlayerShot } from './core/shot.js';
import { clamp, rand, chance } from './core/math.js';

const COURT = CONFIG.court;

export class Game {
  constructor({ settings, audio, storage } = {}) {
    this.camera = new Camera();
    this.shuttle = new Shuttle();
    this.player = new Player(settings?.handedness || 'right');
    this.ai = new AI(settings?.difficulty || 'normal');
    this.effects = new Effects();
    this.audio = audio || null;
    this.storage = storage || null;

    this.phase = 'home';       // home | serve | rally | freeze | result
    this.paused = false;
    this.demo = true;
    this.phaseTimer = 0;
    this.pending = null;       // result | serve
    this.time = 0;
    this.hitCooldown = 0;
    this.canHit = false;
    this.result = null;
    this.lastShot = null;
    this.lastShotAt = 0;
    this.swipeTrail = [];      // 描画用（スクリーン座標）
    this.shake = { x: 0, y: 0 };

    this.listeners = {};
    this.resetRun();
  }

  /* ------------------------------------------------------------------ */
  /* イベント                                                            */
  /* ------------------------------------------------------------------ */
  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
    return this;
  }

  emit(evt, data) {
    const list = this.listeners[evt];
    if (!list) return;
    for (const fn of list) {
      try { fn(data); } catch (e) { /* UIエラーでゲームを止めない */ }
    }
  }

  setSettings(settings) {
    if (!settings) return;
    if (settings.handedness) {
      this.player.setHandedness(settings.handedness);
    }
    if (settings.difficulty) {
      this.ai.setDifficulty(settings.difficulty);
    }
    this.ai.handedness = settings.handedness === 'right' ? 'left' : 'right';
  }

  /* ------------------------------------------------------------------ */
  /* 進行                                                                */
  /* ------------------------------------------------------------------ */
  resetRun() {
    this.score = 0;
    this.level = 1;
    this.rally = 0;
    this.maxRally = 0;
    this.smashes = 0;
    this.returns = 0;
    this.winners = 0;
    this.hitCooldown = 0;
    this.effects.clear();
    this.player.reset();
    this.ai.reset(1);
    this.shuttle.reset();
    this.result = null;
    this.lastShot = null;
  }

  /** ホーム画面のアトラクト（自動ラリー） */
  startDemo() {
    this.resetRun();
    this.demo = true;
    this.paused = false;
    this.phase = 'home';
    this.phaseTimer = 0;
    this.beginServe();
  }

  /** プレイ開始 */
  startRun() {
    this.resetRun();
    this.demo = false;
    this.paused = false;
    this.result = null;
    this.phase = 'serve';
    this.phaseTimer = 0;
    this.beginServe();
    this.emit('state', { phase: this.phase, demo: false });
  }

  goHome() {
    this.startDemo();
    this.emit('state', { phase: 'home', demo: true });
  }

  pause() {
    if (this.phase === 'home' || this.phase === 'result' || this.demo) return;
    this.paused = true;
    this.emit('state', { phase: this.phase, paused: true, demo: false });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.emit('state', { phase: this.phase, paused: false, demo: false });
  }

  retry() {
    this.startRun();
  }

  get speedScale() {
    return Math.min(1 + (this.level - 1) * 0.04, 1.4);
  }

  get isPlaying() {
    return !this.demo && (this.phase === 'serve' || this.phase === 'rally' || this.phase === 'freeze');
  }

  beginServe() {
    this.phase = 'serve';
    this.phaseTimer = 0;
    this.rally = 0;
    this.shuttle.hold(this.player.x + 0.32, 1.08, this.player.z + 0.26);
    this.player.setTarget(this.player.x * 0.6, CONFIG.player.homeZ);
    this.hitCooldown = 0;
    if (!this.demo) this.emit('state', { phase: 'serve', demo: false });
    this.emit('serve', {});
  }

  /* ------------------------------------------------------------------ */
  /* スワイプ入力                                                        */
  /* ------------------------------------------------------------------ */
  pushTrail(point) {
    this.swipeTrail.push({ ...point, t: this.time });
    if (this.swipeTrail.length > 40) this.swipeTrail.shift();
  }

  clearTrail() {
    this.swipeTrail.length = 0;
  }

  onSwipe(swipe) {
    if (this.paused || !swipe || !swipe.valid) return;
    if (this.phase === 'serve') {
      this.tryServe(swipe);
      return;
    }
    if (this.phase !== 'rally') return;
    this.tryHit(swipe);
  }

  tryServe(swipe) {
    const shot = resolveServe({
      swipe,
      playerX: this.player.x,
      handedness: this.player.handedness,
      speedScale: this.speedScale,
      level: this.level,
    });
    if (shot.invalid) {
      this.emit('toast', { text: shot.reason, tone: 'warn' });
      return;
    }

    this.player.swing('up');
    this.player.onHit();
    const from = { x: this.shuttle.pos.x, y: Math.max(this.shuttle.pos.y, 0.75), z: this.shuttle.pos.z };
    this.launchShot(shot, from, 'player');
    this.phase = 'rally';
    this.phaseTimer = 0;
    this.rally = 0;
    if (!this.demo) this.emit('state', { phase: 'rally', demo: false });
    this.emit('shot', { ...shot, owner: 'player', isServe: true });
  }

  tryHit(swipe) {
    if (this.hitCooldown > 0) return;
    const s = this.shuttle;
    if (!s.inFlight || s.lastHitter === 'player') return;

    if (!this.player.canReach(s)) {
      // 打点外 = 空振り
      this.player.swing('up');
      this.hitCooldown = CONFIG.input.whiffCooldown;
      if (this.audio) this.audio.swing();
      this.emit('toast', { text: '空振り…', tone: 'warn' });
      return;
    }

    const shot = resolvePlayerShot({
      swipe,
      contactY: s.pos.y,
      contactX: s.pos.x,
      playerX: this.player.x,
      handedness: this.player.handedness,
      speedScale: this.speedScale,
      level: this.level,
    });

    const kind = shot.type === 'smash' ? 'down' : shot.type === 'drive' ? 'side' : 'up';
    this.player.swing(kind);
    this.player.onHit();
    this.hitCooldown = CONFIG.input.cooldown;

    const from = { x: s.pos.x, y: Math.max(s.pos.y, 0.55), z: s.pos.z };

    if (shot.fault) {
      // 打点ミス -> ネットへ
      this.launchShot(
        { ...shot, target: { x: s.pos.x * 0.4, z: COURT.netZ - 0.5 }, flight: 0.5 },
        from,
        'player',
        { avoidNet: false },
      );
      if (this.audio) this.audio.miss();
      this.emit('toast', { text: shot.faultMessage, tone: 'bad' });
      return;
    }

    this.launchShot(shot, from, 'player');

    // 得点
    this.rally += 1;
    this.maxRally = Math.max(this.maxRally, this.rally);
    this.returns += 1;

    if (shot.type === 'smash') {
      this.smashes += 1;
      this.addScore(CONFIG.scoring.returnPoints + CONFIG.scoring.smashBonus, {
        label: 'スマッシュ成功', sub: `+${CONFIG.scoring.returnPoints + CONFIG.scoring.smashBonus}`, tone: 'smash',
      });
      this.effects.addShake(1);
      if (this.audio) this.audio.hit('smash');
    } else {
      this.addScore(CONFIG.scoring.returnPoints, {
        label: shot.label, sub: `+${CONFIG.scoring.returnPoints}`, tone: 'normal',
      });
      if (this.audio) this.audio.hit(shot.type);
    }

    this.emit('shot', { ...shot, owner: 'player' });
    this.emit('rally', { rally: this.rally, maxRally: this.maxRally });
    if (this.audio) this.audio.point();
  }

  launchShot(shot, from, owner, opts = {}) {
    this.effects.onShot(shot.type, from);
    this.effects.onHit(from, shot.type === 'smash');
    this.shuttle.launch(
      from,
      { x: shot.target.x, z: shot.target.z, y: 0.06 },
      shot.flight,
      { owner, type: shot.type, avoidNet: opts.avoidNet !== false },
    );
    this.lastShot = shot;
    this.lastShotAt = this.time;
    this.canHit = false;
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                  */
  /* ------------------------------------------------------------------ */
  performAIShot(action) {
    const from = { x: action.from.x, y: Math.max(action.from.y, 0.6), z: action.from.z };
    if (action.netFault) {
      this.shuttle.launch(
        from,
        { x: action.target.x * 0.6, z: COURT.netZ + 0.45, y: 0.4 },
        0.55,
        { owner: 'ai', type: 'clear', avoidNet: false },
      );
    } else {
      this.shuttle.launch(
        from,
        { x: action.target.x, z: action.target.z, y: 0.06 },
        action.flight,
        { owner: 'ai', type: action.type, avoidNet: true },
      );
    }
    this.effects.onShot(action.type, from);
    this.effects.onHit(from, action.type === 'smash');
    if (this.audio) this.audio.hit(action.type);
    this.emit('aishot', {
      type: action.type, label: action.label, owner: 'ai',
    });
  }

  /* ------------------------------------------------------------------ */
  /* スコア                                                              */
  /* ------------------------------------------------------------------ */
  addScore(points, { label = '', sub = '', tone = 'normal' } = {}) {
    if (this.demo) return;
    this.score += points;
    this.emit('score', { points, total: this.score, label, sub, tone });
    const targetLevel = Math.floor(this.score / CONFIG.scoring.levelStep) + 1;
    while (this.level < targetLevel) {
      this.level += 1;
      this.ai.reset(this.level);
      this.ai.x = this.ai.x;
      if (this.audio) this.audio.levelUp();
      this.emit('levelup', { level: this.level });
    }
  }

  /* ------------------------------------------------------------------ */
  /* ラリー終了                                                          */
  /* ------------------------------------------------------------------ */
  endRally(kind, message, tone = 'normal') {
    if (this.phase === 'freeze') return;

    if (this.demo) {
      this.phase = 'freeze';
      this.phaseTimer = 0;
      this.pending = 'serve';
      this.emit('callout', { title: message || '', tone });
      return;
    }

    if (kind === 'winner') {
      this.winners += 1;
      this.addScore(CONFIG.scoring.winnerPoints, {
        label: 'ウィナー', sub: `+${CONFIG.scoring.winnerPoints}`, tone: 'good',
      });
      if (this.audio) this.audio.point();
      this.emit('callout', { title: message || 'ウィナー！', sub: `+${CONFIG.scoring.winnerPoints}`, tone: 'good' });
      this.phase = 'freeze';
      this.phaseTimer = 0;
      this.pending = 'serve';
      return;
    }

    // プレイヤーのミス / ファウル -> リザルト
    if (this.audio) this.audio.miss();
    this.emit('callout', { title: message || 'ラリー終了', tone: 'bad' });
    this.phase = 'freeze';
    this.phaseTimer = 0;
    this.pending = 'result';
    this.effects.addShake(0.7);
  }

  buildResult() {
    return {
      score: this.score,
      level: this.level,
      maxRally: this.maxRally,
      rally: this.maxRally,
      smashes: this.smashes,
      returns: this.returns,
      winners: this.winners,
      date: Date.now(),
    };
  }

  finishRun() {
    this.phase = 'result';
    this.result = this.buildResult();
    this.emit('result', this.result);
    this.emit('state', { phase: 'result', demo: false });
  }

  /* ------------------------------------------------------------------ */
  /* 更新                                                                */
  /* ------------------------------------------------------------------ */
  update(dt) {
    this.time += dt;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.phaseTimer += dt;

    if (this.paused) {
      this.effects.update(dt * 0.15);
      return;
    }

    switch (this.phase) {
      case 'home':
      case 'serve':
        this.updateServe(dt);
        break;
      case 'rally':
        this.updateRally(dt);
        break;
      case 'freeze':
        this.updateFreeze(dt);
        break;
      case 'result':
        this.updateResult(dt);
        break;
      default:
        this.updateServe(dt);
    }

    this.effects.update(dt);
    this.canHit = this.phase === 'rally' && this.player.canReach(this.shuttle);

    // スワイプ軌跡のフェード
    if (this.swipeTrail.length) {
      const limit = this.time - CONFIG.input.trailLife;
      while (this.swipeTrail.length && this.swipeTrail[0].t < limit) this.swipeTrail.shift();
    }
  }

  updateServe(dt) {
    // サーブ待ち: 手元でシャトルを保持
    const p = this.player;
    p.setTarget(p.x * 0.5, CONFIG.player.homeZ);
    p.update(dt);

    const hold = this.shuttle;
    if (hold.held) {
      const sway = Math.sin(this.time * 2.4) * 0.02;
      hold.pos.x = p.x + 0.32 + sway;
      hold.pos.y = 1.08 + Math.sin(this.time * 2.8) * 0.035;
      hold.pos.z = p.z + 0.26;
      hold.tickHold(dt);
    }

    this.ai.update(dt, hold, p, this.speedScale);

    if (this.phase === 'serve' && this.phaseTimer > 0.35 && !this.shuffleHandled) {
      this.shuffleHandled = true;
    }

    // デモ / 放置時は自動サーブ
    const autoServe = this.demo ? 1.1 : 9.0;
    if (this.phaseTimer > autoServe) {
      const fake = { len: 170, speed: 1.15, up: 1, side: 0, dx: rand(-16, 16), dy: -170, valid: true };
      this.tryServe(fake);
    }
  }

  updateRally(dt) {
    const s = this.shuttle;
    const p = this.player;

    // --- プレイヤー自動移動 ---
    if (s.inFlight && s.lastHitter === 'ai') {
      const pred = s.predictAtHeight(1.25, 5.5);
      const handSign = p.handedness === 'right' ? 1 : -1;
      if (pred.found) {
        p.setTarget(pred.x - 0.3 * handSign, clamp(pred.z - 0.15, CONFIG.player.minZ, CONFIG.player.maxZ));
      } else {
        p.setTarget(s.pos.x, clamp(s.pos.z - 0.5, CONFIG.player.minZ, CONFIG.player.maxZ));
      }
    } else {
      p.setTarget(p.x * 0.82, CONFIG.player.homeZ - 0.15);
    }
    p.update(dt);

    // --- AI ---
    const action = this.ai.update(dt, s, p, this.speedScale);
    if (action) this.performAIShot(action);

    // --- シャトル ---
    const ev = s.update(dt);
    if (ev.net) {
      if (this.audio) this.audio.net();
      this.effects.onLand({ x: s.pos.x, y: Math.max(s.pos.y, 0.2), z: s.pos.z }, '#cfe9f2');
    }
    if (ev.landed) {
      this.onLanded(ev);
      return;
    }

    // --- デモ時の自動スイング ---
    if (this.demo && this.canPlayDemoHit()) {
      const shotKind = chance(0.3) ? 'smash' : chance(0.5) ? 'clear' : 'drop';
      const fake = this.makeFakeSwipe(shotKind);
      this.tryHit(fake);
    }

    // --- コート外へ抜けた場合 ---
    if (s.pos.z < -1.2 || s.pos.z > 15 || Math.abs(s.pos.x) > 6) {
      this.onLanded({ x: s.pos.x, z: s.pos.z, landed: true, net: false });
    }
  }

  canPlayDemoHit() {
    const s = this.shuttle;
    if (!s.inFlight || s.lastHitter === 'player') return false;
    if (this.hitCooldown > 0) return false;
    if (!this.player.canReach(s)) return false;
    // 高すぎるうちは待つ（打点へ降りてきたら打つ）
    return s.pos.y < 2.5 && s.vel.y < 0.2;
  }

  makeFakeSwipe(kind) {
    if (kind === 'smash') {
      return { len: 150, speed: 1.7, up: -0.9, side: 0.2, dx: 30, dy: 140, valid: true };
    }
    if (kind === 'drive') {
      return { len: 170, speed: 1.6, up: 0.1, side: 0.95, dx: 160, dy: 20, valid: true };
    }
    if (kind === 'drop') {
      return { len: 90, speed: 0.7, up: 0.98, side: 0.1, dx: 10, dy: -85, valid: true };
    }
    return { len: 240, speed: 1.5, up: 0.97, side: 0.1, dx: 20, dy: -230, valid: true };
  }

  onLanded(ev) {
    const s = this.shuttle;
    const hitter = s.lastHitter;
    const inBounds = ev.z > 0 && ev.z < COURT.length && Math.abs(ev.x) <= COURT.halfWidth;
    const onAISide = ev.z > COURT.netZ;

    this.effects.onLand({ x: ev.x, y: 0.05, z: clamp(ev.z, 0.2, COURT.length) }, '#ffffff');
    if (this.audio && !s.netHit) this.audio.land();

    if (hitter === 'player') {
      if (onAISide && inBounds) {
        this.endRally('winner', 'ウィナー！ AIが返せない', 'good');
      } else if (!inBounds) {
        this.endRally('fault', 'アウト…', 'bad');
      } else {
        this.endRally('fault', s.netHit ? 'ネット…' : '届かなかった…', 'bad');
      }
    } else if (hitter === 'ai') {
      if (onAISide || !inBounds) {
        this.endRally('winner', 'ウィナー！ AIのミス', 'good');
      } else {
        this.endRally('miss', s.netHit ? 'ネット…' : '取れなかった…', 'bad');
      }
    } else {
      this.endRally('miss', 'ラリー終了', 'bad');
    }
  }

  updateFreeze(dt) {
    // 余韻のあと次へ
    this.shuttle.update(dt);
    this.player.update(dt);
    this.ai.update(dt, this.shuttle, this.player, this.speedScale);
    if (this.phaseTimer > (this.pending === 'result' ? 1.15 : 0.8)) {
      if (this.pending === 'result') {
        this.finishRun();
      } else {
        this.beginServe();
      }
    }
  }

  updateResult(dt) {
    this.player.update(dt);
    this.ai.update(dt, this.shuttle, this.player, this.speedScale);
  }
}
