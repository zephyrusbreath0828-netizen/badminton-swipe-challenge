/**
 * 描画レイヤー（Canvas 2D / 疑似3D）
 * アリーナ -> コート -> 影 -> キャラクター -> ネット -> シャトル -> エフェクト の順で描画。
 */
import { CONFIG } from '../config.js';
import { clamp, makeRng, TAU, easeOutCubic } from '../core/math.js';
import { drawCharacter, PALETTES } from './character.js';

const COURT = CONFIG.court;
const NET_Z = COURT.netZ;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.crowd = null;
    this.stars = null;
  }

  resize(width, height, dpr = 1) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this._buildCrowd();
  }

  _buildCrowd() {
    const rng = makeRng(20261122);
    const rows = 7;
    const list = [];
    for (let r = 0; r < rows; r += 1) {
      const y = 0.055 * this.height + r * (this.height * 0.019);
      const count = 26 - r;
      for (let i = 0; i < count; i += 1) {
        list.push({
          x: (i + rng() * 0.6) * (this.width / count),
          y: y + rng() * 4,
          s: 1.6 + rng() * 1.9,
          hue: rng(),
          phase: rng() * TAU,
        });
      }
    }
    this.crowd = list;

    const rng2 = makeRng(77123);
    this.stars = Array.from({ length: 26 }, () => ({
      x: rng2() * this.width,
      y: rng2() * this.height * 0.3,
      r: 0.5 + rng2() * 1.4,
      a: 0.15 + rng2() * 0.4,
    }));
  }

  /* ------------------------------------------------------------------ */
  /* メイン                                                              */
  /* ------------------------------------------------------------------ */
  render(game) {
    const ctx = this.ctx;
    const cam = game.camera;
    const t = game.time;
    this.cam = cam;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const shake = game.effects.shakeOffset;
    ctx.save();
    ctx.translate(shake.x, shake.y);

    this.drawArena(ctx, t);
    this.drawCourtFloor(ctx, t);
    this.drawCourtLines(ctx);

    // 着地点マーカー
    this.drawLandingMarker(ctx, game);

    // AI（ネットの奥）
    this.drawActorShadow(ctx, cam, game.ai.x, game.ai.z, 0.42);
    drawCharacter(ctx, {
      sx: cam.project(game.ai.x, 0, game.ai.z).x,
      sy: cam.project(game.ai.x, 0, game.ai.z).y,
      scale: cam.scaleAt(game.ai.z),
      palette: PALETTES.ai,
      runPhase: game.ai.runPhase,
      moving: Math.hypot(game.ai.vx, game.ai.vz) > 0.5,
      swingT: game.ai.swingT,
      swingKind: game.ai.swingKind,
      swingActive: game.ai.swingActive,
      isAI: true,
      handSign: game.ai.handedness === 'right' ? -1 : 1,
      reachGlow: 0,
    });

    // ネット（奥が先 / 手前が後）
    const shuttleBehindNet = game.shuttle.pos.z > NET_Z;
    this.drawNet(ctx);
    if (shuttleBehindNet) this.drawShuttle(ctx, game, true);

    // プレイヤー
    this.drawActorShadow(ctx, cam, game.player.x, game.player.z, 0.42);
    const pp = cam.project(game.player.x, 0, game.player.z);
    drawCharacter(ctx, {
      sx: pp.x,
      sy: pp.y,
      scale: pp.s,
      palette: PALETTES.player,
      runPhase: game.player.runPhase,
      moving: game.player.speed > 0.5,
      swingT: game.player.swingT,
      swingKind: game.player.swingKind,
      swingActive: game.player.swingActive,
      isAI: false,
      handSign: game.player.handedness === 'right' ? 1 : -1,
      reachGlow: game.canHit ? 0.6 + Math.sin(t * 12) * 0.4 : 0,
    });

    if (!shuttleBehindNet) this.drawShuttle(ctx, game, false);

    game.effects.draw(ctx, cam);
    this.drawSwipeTrail(ctx, game);
    this.drawShuttleIndicator(ctx, game);

    ctx.restore();

    this.drawVignette(ctx);
    if (game.paused) this.drawPauseDim(ctx);
  }

  /* ------------------------------------------------------------------ */
  /* 背景                                                                */
  /* ------------------------------------------------------------------ */
  drawArena(ctx, t) {
    const w = this.width;
    const h = this.height;

    // 空 / アリーナ上部
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    g.addColorStop(0, '#0b1f33');
    g.addColorStop(0.45, '#123a54');
    g.addColorStop(1, '#1c5a6b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.62);

    // ライトの光芒
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i += 1) {
      const x = i === 0 ? w * 0.16 : w * 0.84;
      const rg = ctx.createRadialGradient(x, h * 0.02, 0, x, h * 0.02, h * 0.42);
      rg.addColorStop(0, 'rgba(180,235,255,0.35)');
      rg.addColorStop(0.4, 'rgba(120,200,255,0.10)');
      rg.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, h * 0.02, h * 0.42, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // 観客
    if (this.crowd) {
      for (const c of this.crowd) {
        const tw = 0.5 + Math.sin(t * 1.6 + c.phase) * 0.5;
        const hue = c.hue;
        const col = hue < 0.33 ? `rgba(120,190,230,${0.30 + tw * 0.15})`
          : hue < 0.66 ? `rgba(255,190,120,${0.24 + tw * 0.13})`
            : `rgba(210,230,255,${0.20 + tw * 0.12})`;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.s, 0, TAU);
        ctx.fill();
      }
    }

    // スタジアムの帯
    const bandY = h * 0.2;
    const bg = ctx.createLinearGradient(0, bandY, 0, bandY + h * 0.09);
    bg.addColorStop(0, 'rgba(8,26,42,0.85)');
    bg.addColorStop(1, 'rgba(14,42,62,0.12)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, bandY, w, h * 0.09);

    // スポンサー風のライン
    ctx.fillStyle = 'rgba(120,230,220,0.14)';
    ctx.fillRect(0, bandY + h * 0.088, w, 2);

    // 星屑
    if (this.stars) {
      for (const s of this.stars) {
        ctx.fillStyle = `rgba(255,255,255,${s.a * (0.6 + Math.sin(t * 2 + s.x) * 0.4)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }
    }
  }

  drawCourtFloor(ctx, t) {
    const cam = this.cam;
    const c = cam;
    const hw = COURT.halfWidth;

    // アリーナ床（コート外）
    const outer = [
      c.project(-11, 0, -2.2),
      c.project(11, 0, -2.2),
      c.project(11, 0, 15.8),
      c.project(-11, 0, 15.8),
    ];
    this.fillPoly(ctx, outer, '#0f2e3a');

    // コート面
    const near = c.project(0, 0, 0);
    const far = c.project(0, 0, COURT.length);
    const g = ctx.createLinearGradient(0, near.y, 0, far.y);
    g.addColorStop(0, '#1f7f74');
    g.addColorStop(0.5, '#2a9d8f');
    g.addColorStop(1, '#37b7a5');
    const quad = [
      c.project(-hw, 0, 0),
      c.project(hw, 0, 0),
      c.project(hw, 0, COURT.length),
      c.project(-hw, 0, COURT.length),
    ];
    this.fillPoly(ctx, quad, g);

    // コートの木目風グラデ（光沢）
    ctx.save();
    ctx.beginPath();
    this.pathPoly(ctx, quad);
    ctx.clip();
    const shine = ctx.createLinearGradient(c.project(-hw, 0, 0).x, 0, c.project(hw, 0, 0).x, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0.10)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    shine.addColorStop(1, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, far.y, this.width, near.y - far.y + 20);

    // 奥の反射
    ctx.globalAlpha = 0.06 + Math.sin(t * 0.7) * 0.015;
    ctx.fillStyle = '#dff9ff';
    ctx.beginPath();
    ctx.ellipse(this.width / 2, c.project(0, 0, 9.6).y, this.width * 0.26, 16, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawCourtLines(ctx) {
    const c = this.cam;
    const hw = COURT.halfWidth;
    const L = COURT.length;
    const LINES = 'rgba(255,255,255,0.9)';

    const line = (x1, z1, x2, z2, w = 2.2) => {
      const a = c.project(x1, 0.005, z1);
      const b = c.project(x2, 0.005, z2);
      ctx.strokeStyle = LINES;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };

    // 外周
    line(-hw, 0, hw, 0, 3);
    line(-hw, L, hw, L, 3);
    line(-hw, 0, -hw, L, 3);
    line(hw, 0, hw, L, 3);

    // センターライン
    line(0, 0, 0, L, 2);

    // ショートサービスライン（両側）
    const ss1 = NET_Z - COURT.shortService;
    const ss2 = NET_Z + COURT.shortService;
    line(-hw, ss1, hw, ss1, 2);
    line(-hw, ss2, hw, ss2, 2);

    // ダブルスロングサービスライン
    const ls1 = NET_Z - COURT.longService - 5.0;
    const ls2 = NET_Z + COURT.longService + 5.0;
    line(-hw, ls1, hw, ls1, 1.6);
    line(-hw, ls2, hw, ls2, 1.6);

    // 中央のサービスライン（ネット際の横線）
    ctx.globalAlpha = 0.35;
    line(-hw, NET_Z, hw, NET_Z, 1.2);
    ctx.globalAlpha = 1;
  }

  drawLandingMarker(ctx, game) {
    const s = game.shuttle;
    if (!s.inFlight || s.lastHitter !== 'ai') return;
    const pred = s.predictLanding(5);
    if (!pred.found && pred.z > 7) return;
    if (pred.z > NET_Z) return;
    const cam = this.cam;
    const p = cam.project(pred.x, 0.01, clamp(pred.z, 0.1, COURT.length));
    const pulse = 0.5 + Math.sin(game.time * 9) * 0.5;
    ctx.save();
    ctx.strokeStyle = `rgba(255,240,150,${0.25 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 22 + pulse * 6, 8 + pulse * 2, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.2 + pulse * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 9, 3.4, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawActorShadow(ctx, cam, x, z, r) {
    const p = cam.project(x, 0.01, z);
    const s = cam.scaleAt(z);
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * s);
    g.addColorStop(0, 'rgba(4,20,28,0.42)');
    g.addColorStop(1, 'rgba(4,20,28,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * s, r * s * 0.34, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* ネット                                                              */
  /* ------------------------------------------------------------------ */
  drawNet(ctx) {
    const cam = this.cam;
    const hw = COURT.halfWidth;
    const sag = (x) => COURT.netHeight - 0.1 * (1 - Math.pow(x / hw, 2));

    // ネットの布
    const top = [];
    for (let i = 0; i <= 12; i += 1) {
      const x = -hw + (2 * hw * i) / 12;
      top.push(cam.project(x, sag(x), NET_Z));
    }
    const bottom = cam.project(hw, 0.03, NET_Z);
    const bottomL = cam.project(-hw, 0.03, NET_Z);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bottomL.x, bottomL.y);
    for (const p of top) ctx.lineTo(p.x, p.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(230,245,255,0.07)';
    ctx.fill();

    // メッシュ
    ctx.strokeStyle = 'rgba(225,245,255,0.13)';
    ctx.lineWidth = 0.6;
    for (let i = 0; i <= 9; i += 1) {
      const x = -hw + (2 * hw * i) / 9;
      const a = cam.project(x, 0.03, NET_Z);
      const b = cam.project(x, sag(x), NET_Z);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let j = 1; j <= 7; j += 1) {
      const y = (sag(0) - 0.03) * (j / 8) + 0.03;
      const a = cam.project(-hw, y, NET_Z);
      const b = cam.project(hw, y, NET_Z);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 白テープ
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, cam.scaleAt(NET_Z) * 0.038);
    ctx.beginPath();
    top.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();

    // ポスト
    const postL = cam.project(-hw - 0.06, 0, NET_Z);
    const postLT = cam.project(-hw - 0.06, COURT.postHeight, NET_Z);
    const postR = cam.project(hw + 0.06, 0, NET_Z);
    const postRT = cam.project(hw + 0.06, COURT.postHeight, NET_Z);
    ctx.strokeStyle = '#dbe9f5';
    ctx.lineWidth = Math.max(3, cam.scaleAt(NET_Z) * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(postL.x, postL.y);
    ctx.lineTo(postLT.x, postLT.y);
    ctx.moveTo(postR.x, postR.y);
    ctx.lineTo(postRT.x, postRT.y);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /* ------------------------------------------------------------------ */
  /* シャトル                                                            */
  /* ------------------------------------------------------------------ */
  drawShuttle(ctx, game, behind) {
    const cam = this.cam;
    const s = game.shuttle;
    const p = cam.project(s.pos.x, s.pos.y, s.pos.z);
    const scale = clamp(p.s, 10, 400);
    const size = clamp(scale * 0.078, 4.6, 16);

    // コート上の影
    if (s.inFlight || !s.held) {
      const sp = cam.project(s.pos.x, 0.01, s.pos.z);
      const heightFactor = clamp(1 - s.pos.y / 9, 0.15, 1);
      ctx.save();
      ctx.fillStyle = `rgba(6,26,34,${0.3 * heightFactor})`;
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, size * heightFactor * 1.1, size * heightFactor * 0.4, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // 軌跡
    this.drawShuttleTrail(ctx, game);

    /* 向き（v1.2.10）
       3D の速度ベクトル (vx, vy, vz) をスクリーン座標へ投影し、
       atan2(velocityY, velocityX) で進行方向の角度を求める。
       ローカル座標は「コルク＝原点 / フェザー＝-Y 方向」なので、
       ang - 90° 回転させるとコルクが進行方向を向き、フェザーが後方へ流れる。 */
    let ang = -Math.PI / 2;
    if (s.inFlight) {
      const v = s.vel;
      const a = cam.project(s.pos.x, s.pos.y, s.pos.z);
      const b = cam.project(s.pos.x + v.x * 0.04, s.pos.y + v.y * 0.04, s.pos.z + v.z * 0.04);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // ほぼ静止（頂点付近）では直前の角度を保持してチラつきを防ぐ
      if (Math.hypot(dx, dy) > 0.5) {
        this._shuttleAng = Math.atan2(dy, dx);
      }
      if (typeof this._shuttleAng === 'number') ang = this._shuttleAng;
    } else {
      this._shuttleAng = undefined;   // ホールド時はリセット
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang - Math.PI / 2);

    // 羽（コーン）
    const g = ctx.createLinearGradient(0, -size * 1.8, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(214,232,242,0.85)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-size * 0.85, -size * 1.9);
    ctx.lineTo(size * 0.85, -size * 1.9);
    ctx.lineTo(size * 0.3, -size * 0.3);
    ctx.lineTo(-size * 0.3, -size * 0.3);
    ctx.closePath();
    ctx.fill();

    // 羽の筋
    ctx.strokeStyle = 'rgba(150,180,200,0.55)';
    ctx.lineWidth = Math.max(0.6, size * 0.07);
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * size * 0.1, -size * 0.35);
      ctx.lineTo(i * size * 0.28, -size * 1.85);
      ctx.stroke();
    }

    // コルク
    ctx.fillStyle = '#fff8ec';
    ctx.strokeStyle = 'rgba(190,160,120,0.8)';
    ctx.lineWidth = Math.max(0.6, size * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.42, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // スマッシュ時の発光
    if (s.inFlight && s.type === 'smash' && s.speed > 8) {
      ctx.globalCompositeOperation = 'lighter';
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 4);
      rg.addColorStop(0, 'rgba(255,200,120,0.5)');
      rg.addColorStop(1, 'rgba(255,140,80,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(0, 0, size * 4, 0, TAU);
      ctx.fill();
    }

    ctx.restore();

    // ネットの手前/奥の陰影
    if (behind) {
      ctx.fillStyle = 'rgba(10,30,45,0.06)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 2, 0, TAU);
      ctx.fill();
    }
  }

  drawShuttleTrail(ctx, game) {
    const cam = this.cam;
    const s = game.shuttle;
    const trail = s.trail;
    if (!s.inFlight || trail.length < 2) return;

    const color = s.type === 'smash' ? '#ffb27a'
      : s.type === 'drive' ? '#ffe28a'
        : s.type === 'drop' ? '#b9f4ff'
          : '#d8ffb0';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const pts = trail.map((p) => cam.project(p.x, p.y, p.z));
    for (let i = 1; i < pts.length; i += 1) {
      const k = i / pts.length;
      ctx.strokeStyle = this._rgba(color, k * (s.type === 'smash' ? 0.55 : 0.32));
      ctx.lineWidth = Math.max(1, k * (s.type === 'smash' ? 7 : 4));
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // ドライブ / スマッシュはスピードライン
    if ((s.type === 'drive' || s.type === 'smash') && s.speed > 6 && pts.length > 1) {
      const head = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const ang = Math.atan2(head.y - prev.y, head.x - prev.x);
      ctx.strokeStyle = this._rgba(color, 0.5);
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i += 1) {
        const off = (i - 1) * 7;
        const len = 16 + i * 8;
        ctx.beginPath();
        ctx.moveTo(head.x + Math.cos(ang + Math.PI / 2) * off, head.y + Math.sin(ang + Math.PI / 2) * off);
        ctx.lineTo(
          head.x + Math.cos(ang + Math.PI / 2) * off - Math.cos(ang) * len,
          head.y + Math.sin(ang + Math.PI / 2) * off - Math.sin(ang) * len,
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawShuttleIndicator(ctx, game) {
    const cam = this.cam;
    const s = game.shuttle;
    if (!s.inFlight) return;
    const p = cam.project(s.pos.x, s.pos.y, s.pos.z);
    if (p.y > 34) return;
    const x = clamp(p.x, 24, this.width - 24);
    const y = 44;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(x, y + 12);
    ctx.lineTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y - 2, 11, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* スワイプ軌跡                                                        */
  /* ------------------------------------------------------------------ */
  drawSwipeTrail(ctx, game) {
    const trail = game.swipeTrail;
    if (!trail || trail.length < 2) return;
    const now = game.time;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i += 1) {
      const a = trail[i - 1];
      const b = trail[i];
      const age = clamp(1 - (now - b.t) / CONFIG.input.trailLife, 0, 1);
      if (age <= 0) continue;
      const k = i / trail.length;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * age * k})`;
      ctx.lineWidth = 3 + k * 7;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // 先端の光
    const last = trail[trail.length - 1];
    const age = clamp(1 - (now - last.t) / CONFIG.input.trailLife, 0, 1);
    if (age > 0) {
      const g = ctx.createRadialGradient(last.x, last.y, 0, last.x, last.y, 26);
      g.addColorStop(0, `rgba(255,255,255,${0.5 * age})`);
      g.addColorStop(1, 'rgba(180,235,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 26, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* 仕上げ                                                              */
  /* ------------------------------------------------------------------ */
  drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.width / 2, this.height * 0.55, this.height * 0.25,
      this.width / 2, this.height * 0.55, this.height * 0.85,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(2,12,20,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawPauseDim(ctx) {
    ctx.fillStyle = 'rgba(4,18,28,0.55)';
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /* ------------------------------------------------------------------ */
  /* 図形ヘルパ                                                          */
  /* ------------------------------------------------------------------ */
  pathPoly(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }

  fillPoly(ctx, pts, fill) {
    this.pathPoly(ctx, pts);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  _rgba(hex, a) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
  }
}
