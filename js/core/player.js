/**
 * プレイヤーキャラクター
 * v1.0 は完全自動移動（シャトルの落下予測地点へ移動）。操作はスイングのみ。
 */
import { CONFIG } from '../config.js';
import { approach, clamp, easeOutCubic } from './math.js';

const P = CONFIG.player;

export class Player {
  constructor(handedness = 'right') {
    this.handedness = handedness;
    this.reset();
  }

  reset() {
    this.x = 0;
    this.z = P.homeZ;
    this.vx = 0;
    this.vz = 0;
    this.targetX = 0;
    this.targetZ = P.homeZ;
    this.swingT = 1;       // 0..1 (1 = 完了)
    this.swingKind = 'up'; // up | down | side
    this.swingActive = false;
    this.hitFlash = 0;
    this.runPhase = 0;
    this.speed = 0;
    this.recover = 0;      // スイング後の硬直
  }

  setHandedness(h) {
    this.handedness = h;
  }

  /** 自動移動の目標をセット */
  setTarget(x, z) {
    this.targetX = clamp(x, P.minX, P.maxX);
    this.targetZ = clamp(z, P.minZ, P.maxZ);
  }

  /** スイング開始 */
  swing(kind = 'up') {
    this.swingT = 0;
    this.swingKind = kind;
    this.swingActive = true;
  }

  /** ヒット成功のエフェクト */
  onHit() {
    this.hitFlash = 1;
  }

  update(dt) {
    // 移動（加速 -> 最高速）
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const d = Math.hypot(dx, dz);
    const maxSpeed = P.moveSpeed;

    if (d > 0.02) {
      const desiredSpeed = Math.min(maxSpeed, d * 9);
      const nx = dx / (d || 1);
      const nz = dz / (d || 1);
      this.vx = approach(this.vx, nx * desiredSpeed, P.accel * dt);
      this.vz = approach(this.vz, nz * desiredSpeed, P.accel * dt);
    } else {
      this.vx = approach(this.vx, 0, P.accel * 1.4 * dt);
      this.vz = approach(this.vz, 0, P.accel * 1.4 * dt);
    }

    this.x = clamp(this.x + this.vx * dt, P.minX, P.maxX);
    this.z = clamp(this.z + this.vz * dt, P.minZ, P.maxZ);
    this.speed = Math.hypot(this.vx, this.vz);
    this.runPhase += dt * (2.2 + this.speed * 1.15);

    // スイング
    if (this.swingActive) {
      this.swingT += dt / 0.26;
      if (this.swingT >= 1) {
        this.swingT = 1;
        this.swingActive = false;
      }
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3.2);
    this.recover = Math.max(0, this.recover - dt);
  }

  get swingEase() {
    return easeOutCubic(this.swingT);
  }

  /** ラケットが届く範囲にシャトルがあるか */
  canReach(shuttle) {
    if (!shuttle.inFlight) return false;
    if (shuttle.lastHitter === 'player') return false;
    const dz = Math.abs(shuttle.pos.z - this.z);
    const dx = Math.abs(shuttle.pos.x - this.x);
    return dz <= P.reachZ && dx <= P.reachX && shuttle.pos.y <= P.maxContactY && shuttle.pos.y >= 0;
  }
}
