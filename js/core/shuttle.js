/**
 * シャトルの物理シミュレーション
 * 3次元（x: 左右 / y: 高さ / z: 奥行き）で放物運動 + ネット衝突 + 着地判定。
 */
import { CONFIG } from '../config.js';
import { clamp } from './math.js';

const G = CONFIG.physics.gravity;
const NET_Z = CONFIG.court.netZ;
const NET_H = CONFIG.court.netHeight;
const GROUND = 0.03;

export class Shuttle {
  constructor() {
    this.pos = { x: 0, y: 1, z: 3 };
    this.prev = { x: 0, y: 1, z: 3 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.held = true;
    this.inFlight = false;
    this.landed = false;
    this.netHit = false;
    this.lastHitter = null;
    this.type = 'clear';
    this.trail = [];
    this.spin = 0;
    this.bobT = 0;
    this.hitCount = 0;
  }

  reset() {
    this.held = true;
    this.inFlight = false;
    this.landed = false;
    this.netHit = false;
    this.lastHitter = null;
    this.vel = { x: 0, y: 0, z: 0 };
    this.trail.length = 0;
    this.hitCount = 0;
  }

  /** サーブ前: 手元で保持 */
  hold(x, y, z) {
    this.reset();
    this.pos = { x, y, z };
    this.prev = { ...this.pos };
  }

  /**
   * 打ち出す
   * @param {{x:number,y:number,z:number}} from
   * @param {{x:number,z:number,y?:number}} target
   * @param {number} flight 滞空時間(秒)
   * @param {{owner?:string,type?:string,avoidNet?:boolean,netFault?:boolean}} opts
   */
  launch(from, target, flight, opts = {}) {
    const T = Math.max(0.2, flight);
    const ty = target.y ?? 0.06;
    const dx = target.x - from.x;
    const dy = ty - from.y;
    const dz = target.z - from.z;

    const vx = dx / T;
    const vz = dz / T;
    let vy = dy / T + 0.5 * G * T;

    // ネットを越える高さを保証（打ち上げ直し）
    if (opts.avoidNet !== false && Math.abs(vz) > 0.001) {
      const tNet = (NET_Z - from.z) / vz;
      if (tNet > 0 && tNet < T) {
        const yAtNet = from.y + vy * tNet - 0.5 * G * tNet * tNet;
        const need = NET_H + CONFIG.physics.netClearance;
        if (yAtNet < need) vy += (need - yAtNet) / tNet;
      }
    }

    this.pos = { x: from.x, y: from.y, z: from.z };
    this.prev = { ...this.pos };
    this.vel = { x: vx, y: vy, z: vz };
    this.held = false;
    this.inFlight = true;
    this.landed = false;
    this.netHit = false;
    this.lastHitter = opts.owner ?? null;
    this.type = opts.type ?? 'clear';
    this.trail.length = 0;
    this.spin = Math.random() * Math.PI * 2;
  }

  /** 保持中のふわふわ演出 */
  tickHold(dt) {
    this.bobT += dt;
  }

  /**
   * @param {number} dt
   * @returns {{landed:boolean, net:boolean, z?:number, x?:number, crossedNet:boolean}}
   */
  update(dt) {
    const ev = { landed: false, net: false, crossedNet: false };
    if (!this.inFlight) return ev;

    const steps = Math.max(1, Math.ceil(dt / CONFIG.physics.substep));
    const h = dt / steps;
    let prevZ = this.pos.z;

    for (let i = 0; i < steps; i += 1) {
      this.prev = { ...this.pos };
      this.vel.y -= G * h;
      this.pos.x += this.vel.x * h;
      this.pos.y += this.vel.y * h;
      this.pos.z += this.vel.z * h;

      // ネット衝突（前フレームと現在でネット面を跨いだか）
      if (!this.netHit && (prevZ - NET_Z) * (this.pos.z - NET_Z) < 0) {
        const t = (NET_Z - prevZ) / (this.pos.z - prevZ || 1e-6);
        const yAtNet = this.prev.y + (this.pos.y - this.prev.y) * t;
        const xAtNet = this.prev.x + (this.pos.x - this.prev.x) * t;
        if (yAtNet < NET_H + 0.02 && Math.abs(xAtNet) < CONFIG.court.halfWidth + 0.6) {
          this.netHit = true;
          ev.net = true;
          this.pos.y = Math.min(this.pos.y, yAtNet - 0.05);
          this.pos.z = prevZ + (this.pos.z - prevZ) * Math.max(t - 0.06, 0);
          this.vel.x *= 0.25;
          this.vel.y = -Math.abs(this.vel.y) * 0.2 - 0.4;
          this.vel.z *= -0.15;
        }
      }
      prevZ = this.pos.z;

      if (this.pos.y <= GROUND) {
        this.pos.y = GROUND;
        this.inFlight = false;
        this.landed = true;
        ev.landed = true;
        ev.z = this.pos.z;
        ev.x = this.pos.x;
        break;
      }
      // 画面外へ飛びすぎた場合の保険
      if (this.pos.z < -3 || this.pos.z > 20) {
        this.inFlight = false;
        this.landed = true;
        ev.landed = true;
        ev.z = this.pos.z;
        ev.x = this.pos.x;
        break;
      }
    }

    // 軌跡
    this.trail.push({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    if (this.trail.length > 14) this.trail.shift();
    this.spin += dt * (this.type === 'smash' ? 26 : 12);
    return ev;
  }

  /**
   * 指定高さに降下してくる地点を予測（プレイヤー/AIの自動移動用）
   * @param {number} height
   * @param {number} maxT
   * @returns {{x:number,z:number,t:number,found:boolean}}
   */
  predictAtHeight(height, maxT = 6) {
    if (!this.inFlight) return { x: this.pos.x, z: this.pos.z, t: 0, found: false };
    let { x, y, z } = this.pos;
    let vy = this.vel.y;
    const vx = this.vel.x;
    const vz = this.vel.z;
    const h = 1 / 60;
    for (let t = 0; t < maxT; t += h) {
      vy -= G * h;
      y += vy * h;
      x += vx * h;
      z += vz * h;
      if (y <= height && vy < 0) {
        return { x, z, t, found: true };
      }
      if (y <= 0) return { x, z, t, found: false };
    }
    return { x, z, t: maxT, found: false };
  }

  /** 着地点予測 */
  predictLanding(maxT = 6) {
    return this.predictAtHeight(0.05, maxT);
  }

  /** ネットを越えたか（今どのコートにいるか） */
  isOnPlayerSide() {
    return this.pos.z < NET_Z;
  }

  /** 残り落下までの概算時間 */
  timeToGround() {
    const y = Math.max(this.pos.y, 0.05);
    const v = this.vel.y;
    // y + v t - 0.5 g t^2 = 0
    const disc = v * v + 2 * G * y;
    return (v + Math.sqrt(Math.max(disc, 0))) / G;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }
}
