/**
 * エフェクト（パーティクル / 衝撃波 / 発光）
 * ワールド座標で保持し、描画時にカメラで射影する。
 */
import { rand, TAU, easeOutCubic } from './math.js';

export class Effects {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.flashes = [];
    this.shake = 0;
    this.shakeT = 0;
  }

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
    this.shake = 0;
  }

  addShake(power = 1) {
    this.shake = Math.max(this.shake, power);
    this.shakeT = 0.35;
  }

  /** 汎用パーティクル */
  burst(pos, color, count = 12, opts = {}) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, TAU);
      const sp = rand(opts.speedMin ?? 0.6, opts.speedMax ?? 3.4);
      this.particles.push({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * sp * rand(0.4, 1),
        vy: rand(0.4, 1.6) * sp * 0.7,
        vz: Math.sin(a) * sp * 0.5,
        life: rand(opts.lifeMin ?? 0.28, opts.lifeMax ?? 0.7),
        maxLife: opts.lifeMax ?? 0.7,
        size: rand(opts.sizeMin ?? 0.02, opts.sizeMax ?? 0.07),
        color,
        gravity: opts.gravity ?? 5,
        glow: opts.glow ?? true,
      });
    }
  }

  ring(pos, color, opts = {}) {
    this.rings.push({
      x: pos.x, y: pos.y, z: pos.z,
      t: 0,
      life: opts.life ?? 0.5,
      r0: opts.r0 ?? 0.15,
      r1: opts.r1 ?? 1.6,
      color,
      width: opts.width ?? 4,
      vertical: !!opts.vertical,
    });
  }

  flash(pos, color, life = 0.22) {
    this.flashes.push({ x: pos.x, y: pos.y, z: pos.z, t: 0, life, color });
  }

  /** ショット種別ごとの演出 */
  onShot(type, pos) {
    switch (type) {
      case 'smash':
        this.burst(pos, '#ffd166', 22, { speedMax: 5.2, lifeMax: 0.8, sizeMax: 0.09 });
        this.burst(pos, '#ff7b6b', 14, { speedMax: 4.0, lifeMax: 0.6 });
        this.ring(pos, '#fff1c9', { r0: 0.12, r1: 2.4, life: 0.42, width: 6 });
        this.ring(pos, '#ff9f43', { r0: 0.1, r1: 1.7, life: 0.55, width: 3 });
        this.flash(pos, '#ffe9b0', 0.2);
        this.addShake(1);
        break;
      case 'drive':
        this.burst(pos, '#ffd166', 8, { speedMax: 2.6, lifeMax: 0.35, sizeMax: 0.05 });
        this.ring(pos, '#ffe6a0', { r0: 0.05, r1: 0.9, life: 0.26, width: 2 });
        this.addShake(0.35);
        break;
      case 'drop':
        this.burst(pos, '#a8f3ff', 8, { speedMax: 1.2, lifeMax: 0.6, sizeMax: 0.045, gravity: 1.2 });
        break;
      default:
        this.burst(pos, '#b6f36b', 10, { speedMax: 1.8, lifeMax: 0.5, sizeMax: 0.05 });
        break;
    }
  }

  onHit(pos, strong = false) {
    this.ring(pos, strong ? '#fff6d8' : '#ffffff', {
      r0: 0.06, r1: strong ? 0.85 : 0.55, life: 0.24, width: 3,
    });
  }

  onLand(pos, color = '#ffffff') {
    this.burst(pos, color, 10, { speedMax: 1.4, speedMin: 0.2, gravity: 3, lifeMax: 0.5, sizeMax: 0.05 });
    this.ring(pos, color, { r0: 0.05, r1: 0.9, life: 0.4, width: 2, vertical: false });
  }

  onServeCharge(pos) {
    this.burst(pos, '#ffffff', 5, { speedMax: 0.7, gravity: -0.6, lifeMax: 0.5, sizeMax: 0.03 });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy *= -0.28;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      this.rings[i].t += dt;
      if (this.rings[i].t >= this.rings[i].life) this.rings.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      this.flashes[i].t += dt;
      if (this.flashes[i].t >= this.flashes[i].life) this.flashes.splice(i, 1);
    }
    if (this.shake > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shake = Math.max(0, this.shake - dt * 3);
    }
  }

  get shakeOffset() {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const m = this.shake * 7;
    return { x: rand(-m, m), y: rand(-m, m) };
  }

  draw(ctx, camera) {
    // 発光フラッシュ
    for (const f of this.flashes) {
      const p = camera.project(f.x, f.y, f.z);
      const k = 1 - f.t / f.life;
      const r = p.s * 0.5 * (1 + (1 - k) * 1.4);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(r, 1));
      g.addColorStop(0, this._alpha(f.color, 0.55 * k));
      g.addColorStop(1, this._alpha(f.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(r, 1), 0, TAU);
      ctx.fill();
    }

    // 衝撃波リング
    for (const r of this.rings) {
      const p = camera.project(r.x, r.y, r.z);
      const k = easeOutCubic(r.t / r.life);
      const rad = p.s * (r.r0 + (r.r1 - r.r0) * k);
      const a = 1 - r.t / r.life;
      ctx.save();
      ctx.strokeStyle = this._alpha(r.color, a);
      ctx.lineWidth = Math.max(1, r.width * (1 - k * 0.6));
      ctx.beginPath();
      if (r.vertical) {
        ctx.ellipse(p.x, p.y, Math.max(rad, 1), Math.max(rad * 1.4, 1), 0, 0, TAU);
      } else {
        ctx.ellipse(p.x, p.y, Math.max(rad, 1), Math.max(rad * 0.38, 1), 0, 0, TAU);
      }
      ctx.stroke();
      ctx.restore();
    }

    // パーティクル
    for (const p of this.particles) {
      const sp = camera.project(p.x, p.y, p.z);
      const a = Math.max(0, p.life / p.maxLife);
      const rad = Math.max(1, p.size * sp.s);
      if (p.glow) {
        ctx.fillStyle = this._alpha(p.color, a * 0.35);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, rad * 2.1, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = this._alpha(p.color, a);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, rad, 0, TAU);
      ctx.fill();
    }
  }

  _alpha(color, a) {
    const al = Math.max(0, Math.min(1, a));
    if (color.startsWith('#')) {
      const h = color.slice(1);
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${al})`;
    }
    return color;
  }
}
