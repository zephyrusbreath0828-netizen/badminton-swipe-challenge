/**
 * AIプレイヤー
 * 難易度（初級/中級/上級）× レベルで、反応速度・移動速度・配球・ミス率が変化する。
 */
import { CONFIG } from '../config.js';
import { clamp, chance, dist, lerp, rand, easeOutCubic } from './math.js';
import { buildAIShot } from './shot.js';

const A = CONFIG.ai;

export class AI {
  constructor(difficulty = 'normal', handedness = 'right') {
    this.difficulty = difficulty;
    this.cfg = CONFIG.difficulty[difficulty] || CONFIG.difficulty.normal;
    this.handedness = handedness === 'right' ? 'left' : 'right'; // 相手は逆利き（見た目用）
    this.reset(1);
  }

  setDifficulty(key) {
    this.difficulty = key;
    this.cfg = CONFIG.difficulty[key] || CONFIG.difficulty.normal;
  }

  reset(level = 1) {
    this.level = level;
    this.x = 0;
    this.z = A.homeZ;
    this.vx = 0;
    this.vz = 0;
    this.targetX = 0;
    this.targetZ = A.homeZ;
    this.timer = 0;
    this.decided = false;
    this.swingT = 1;
    this.swingActive = false;
    this.swingKind = 'up';
    this.runPhase = 0;
    this.idleT = 0;
  }

  /* ---- レベル補正 ---- */
  get speed() {
    const s = CONFIG.levelScaling;
    return this.cfg.speed * Math.min(1 + (this.level - 1) * s.aiSpeed, 1.5);
  }

  get errorRate() {
    const s = CONFIG.levelScaling;
    return clamp(this.cfg.errorRate * (1 + (this.level - 1) * s.aiError), 0.045, 0.4);
  }

  get placement() {
    const s = CONFIG.levelScaling;
    return clamp(this.cfg.placement + (this.level - 1) * s.aiPlacement, 0.2, 1);
  }

  get reaction() {
    return Math.max(0.1, this.cfg.reaction - (this.level - 1) * 0.012);
  }

  swing(kind) {
    this.swingT = 0;
    this.swingKind = kind;
    this.swingActive = true;
  }

  /**
   * @param {number} dt
   * @param {import('./shuttle.js').Shuttle} shuttle
   * @param {import('./player.js').Player} player
   * @param {number} speedScale
   * @returns {object|null} ショット指示（null なら何もしない）
   */
  update(dt, shuttle, player, speedScale = 1) {
    this.idleT += dt;

    if (this.swingActive) {
      this.swingT += dt / 0.26;
      if (this.swingT >= 1) {
        this.swingT = 1;
        this.swingActive = false;
      }
    }

    const netZ = CONFIG.court.netZ;
    const incoming = shuttle.inFlight && shuttle.lastHitter === 'player' && shuttle.pos.z > netZ - 0.1;

    if (!incoming) {
      // ホームポジションへ戻る
      this.targetX = 0;
      this.targetZ = A.homeZ;
      this.timer = 0;
      this.decided = false;
      this._move(dt);
      return null;
    }

    this.timer += dt;

    // 落下予測地点へ移動（打ちやすい高さで迎える）
    const pred = shuttle.predictAtHeight(2.15, 5);
    const gx = pred.found ? pred.x : shuttle.pos.x;
    const gz = pred.found ? pred.z : shuttle.pos.z;
    this.targetX = clamp(gx, -A.reachX, A.reachX);
    this.targetZ = clamp(gz + 0.25, A.minZ, A.maxZ);
    this._move(dt);

    if (!this.decided && this.timer >= this.reaction) {
      this.decided = true;
    }

    const inReach =
      shuttle.pos.z > netZ + 0.35 &&
      Math.abs(shuttle.pos.z - this.z) <= A.reachZ &&
      Math.abs(shuttle.pos.x - this.x) <= A.reachX + 0.35 &&
      shuttle.pos.y <= 3.4 &&
      shuttle.pos.y >= 0.35 &&
      shuttle.vel.z > -0.5;

    if (this.decided && inReach && !this.swingActive) {
      return this._makeShot(shuttle, player, speedScale);
    }
    return null;
  }

  _move(dt) {
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const d = Math.hypot(dx, dz);
    const maxSpeed = this.speed;
    if (d > 0.02) {
      const desired = Math.min(maxSpeed, d * 8);
      this.vx = lerp(this.vx, (dx / d) * desired, clamp(dt * 10, 0, 1));
      this.vz = lerp(this.vz, (dz / d) * desired, clamp(dt * 10, 0, 1));
    } else {
      this.vx = lerp(this.vx, 0, clamp(dt * 12, 0, 1));
      this.vz = lerp(this.vz, 0, clamp(dt * 12, 0, 1));
    }
    this.x = clamp(this.x + this.vx * dt, -A.reachX - 0.6, A.reachX + 0.6);
    this.z = clamp(this.z + this.vz * dt, A.minZ, A.maxZ);
    this.runPhase += dt * (2 + Math.hypot(this.vx, this.vz) * 1.1);
  }

  _makeShot(shuttle, player, speedScale) {
    const contactY = shuttle.pos.y;
    const def = CONFIG.shots;
    const overHead = contactY > 1.9;

    // 状況に応じたショット選択
    let type = 'clear';
    const r = Math.random();
    if (overHead) {
      if (r < this.cfg.smashRate) type = 'smash';
      else if (r < this.cfg.smashRate + 0.34) type = 'drop';
      else if (r < this.cfg.smashRate + 0.66) type = 'drive';
      else type = 'clear';
    } else if (contactY > 1.0) {
      if (r < 0.4) type = 'drive';
      else if (r < 0.55) type = 'drop';
      else type = 'clear';
    } else {
      type = r < 0.75 ? 'clear' : 'drive';
    }

    // 配球: プレイヤーの逆側を狙う
    const away = player.x > 0 ? -1 : 1;
    const placement = this.placement;
    const baseX = away * (1.0 + placement * 1.45);
    const tx = clamp(
      baseX + rand(-1, 1) * (1.6 - placement * 0.9),
      -CONFIG.court.playHalfWidth, CONFIG.court.playHalfWidth,
    );

    // 深さ（相手コート = 手前側なので z を反転して狙う）
    const shotDef = def[type];
    let far = lerp(shotDef.depth[0], shotDef.depth[1], rand(0.35, 1));
    if (type === 'clear') far = lerp(11.6, 12.9, placement * 0.75 + rand(0, 0.3));
    if (type === 'drop') far = lerp(7.4, 8.9, rand(0, 1));
    if (type === 'smash') far = lerp(8.2, 10.4, rand(0, 1));
    let tz = CONFIG.court.length - far;

    // ミス（ネット / アウト）
    const error = chance(this.errorRate) && this.level > 1 ? true : chance(this.errorRate * 0.55);
    let netFault = false;
    let out = false;
    if (error) {
      if (chance(this.cfg.netTolerance)) {
        netFault = true;
      } else {
        out = true;
        tz = -rand(0.25, 1.1);
      }
    }

    const shot = buildAIShot({
      type,
      from: shuttle.pos,
      target: { x: tx, z: tz },
      speedScale,
      power: clamp(0.85 + (this.level - 1) * 0.02, 0.8, 1.2),
    });
    shot.owner = 'ai';
    shot.netFault = netFault;
    shot.out = shot.out || out;
    shot.from = { ...shuttle.pos };

    this.swing(type === 'smash' ? 'down' : type === 'drive' ? 'side' : 'up');
    return shot;
  }

  get swingEase() {
    return easeOutCubic(this.swingT);
  }
}
