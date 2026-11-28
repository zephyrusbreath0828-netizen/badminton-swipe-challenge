/**
 * アバター描画（v1.3.0）
 * ------------------------------------------------------------------
 * アニメ風・軽量な擬似3D。Canvas 2D のみ。
 *   - yaw（左右回転）で 360° 回せる
 *   - pose: idle / walk / forehand / backhand / smash
 *   - 顔タイプ・髪型・髪色・体格・身長を反映
 * ゲーム内の選手（js/render/character.js）とは別系統で、
 * アバター編集画面のプレビューと将来の差し替えに使う。
 */
import { clamp, TAU } from '../core/math.js';
import { normalizeAvatar, HAIR_COLOR_HEX, bodyWidthScale, bodyHeightScale } from '../core/avatar.js';

const SKIN = '#ffdcc0';
const SKIN_DARK = '#f0b894';
const OUTLINE = 'rgba(18,34,50,0.5)';

const SHIRT = {
  Slim: { base: '#4fc3f7', dark: '#2a9dd6', light: '#a8e6ff' },
  Normal: { base: '#ff7a45', dark: '#e85a2a', light: '#ffb08a' },
  Power: { base: '#7c5cff', dark: '#5b3fd6', light: '#b6a4ff' },
};

const EYE_STYLE = {
  Face01: { w: 0.026, h: 0.030, tilt: 0, brow: 0.008, mouth: 'smile', blush: 0.18 },
  Face02: { w: 0.030, h: 0.024, tilt: 0.12, brow: 0.010, mouth: 'flat', blush: 0.1 },
  Face03: { w: 0.022, h: 0.032, tilt: -0.06, brow: 0.012, mouth: 'smile', blush: 0.24 },
  Face04: { w: 0.028, h: 0.028, tilt: 0.04, brow: 0.006, mouth: 'open', blush: 0.12 },
  Face05: { w: 0.025, h: 0.026, tilt: 0, brow: 0.014, mouth: 'flat', blush: 0.3 },
};

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function limb(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** pose ごとの手足の位相 */
function posePhase(pose, t) {
  const p = {
    idle: { armSwing: Math.sin(t * 1.6) * 0.10, legSwing: 0, bob: Math.sin(t * 1.6) * 0.008, racket: -0.45 },
    walk: { armSwing: Math.sin(t * 5.2) * 0.52, legSwing: Math.sin(t * 5.2), bob: Math.abs(Math.sin(t * 5.2)) * 0.022, racket: -0.3 },
    forehand: { armSwing: Math.sin(t * 2.4) * 1.25 + 0.25, legSwing: 0.18, bob: 0, racket: 0.9 },
    backhand: { armSwing: -Math.sin(t * 2.4) * 1.15 - 0.1, legSwing: -0.16, bob: 0, racket: -1.1 },
    smash: { armSwing: 1.75 + Math.sin(t * 3.0) * 1.15, legSwing: 0.1, bob: Math.sin(t * 3) * 0.012, racket: 0.2 },
  };
  return p[pose] || p.idle;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,size:number,yaw?:number,t?:number,pose?:string,avatar?:object,showRacket?:boolean}} o
 */
export function drawAvatar(ctx, o) {
  const A = normalizeAvatar(o.avatar);
  const size = o.size || 200;
  const yaw = typeof o.yaw === 'number' ? o.yaw : 0;
  const t = typeof o.t === 'number' ? o.t : 0;
  const pose = o.pose || 'idle';
  const ph = posePhase(pose, t);

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const facingBack = cy < 0;
  const wScale = bodyWidthScale(A);
  const hScale = bodyHeightScale(A);
  const hair = HAIR_COLOR_HEX[A.hairColor] || HAIR_COLOR_HEX.Black;
  const shirt = SHIRT[A.bodyType] || SHIRT.Normal;
  const eye = EYE_STYLE[A.faceType] || EYE_STYLE.Face01;
  const handSign = A.handedness === 'left' ? -1 : 1;

  // ローカル座標: 足元 y=0, 頭頂 y=1（その後 size でスケール）
  const H = size * hScale;

  ctx.save();
  ctx.translate(o.x, o.y);

  /* ---- 影 ---- */
  const shadowW = size * 0.26 * wScale;
  const g0 = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowW);
  g0.addColorStop(0, 'rgba(6,26,34,0.34)');
  g0.addColorStop(1, 'rgba(6,26,34,0)');
  ctx.fillStyle = g0;
  ctx.beginPath();
  ctx.ellipse(0, 0, shadowW, shadowW * 0.32, 0, 0, TAU);
  ctx.fill();

  ctx.scale(H, -H);          // 以降は 0..1 の身長単位・y 上向き
  ctx.translate(0, ph.bob);

  const hipY = 0.50;
  const shoulderY = 0.78;
  const headR = 0.088;
  const headY = 0.885;

  /* ---- 脚（奥 → 手前） ---- */
  const legW = 0.052 * wScale;
  const legs = [
    { side: -1, phase: ph.legSwing },
    { side: 1, phase: -ph.legSwing },
  ];
  for (const leg of legs) {
    const swing = leg.phase * 0.10;
    const x = leg.side * 0.058 * wScale;
    const kx = x + swing * cy;
    limb(ctx, x, hipY, kx, 0.26, legW, SKIN_DARK);
    limb(ctx, kx, 0.26, kx + swing * 0.4 * cy, 0.03, legW * 0.8, SKIN);
    // シューズ
    ctx.fillStyle = '#f7f9fc';
    roundRect(ctx, kx - 0.028, 0.0, 0.062, 0.034, 0.014);
    ctx.fill();
    ctx.fillStyle = '#dbe6f2';
    roundRect(ctx, kx - 0.028, 0.0, 0.062, 0.012, 0.006);
    ctx.fill();
  }

  /* ---- 短パン ---- */
  ctx.fillStyle = '#22304a';
  roundRect(ctx, -0.105 * wScale, hipY - 0.04, 0.21 * wScale, 0.13, 0.05);
  ctx.fill();

  /* ---- 胴体 ---- */
  const torsoW = 0.20 * wScale * (0.72 + 0.28 * Math.abs(cy));
  const grad = ctx.createLinearGradient(0, shoulderY, 0, hipY);
  grad.addColorStop(0, shirt.light);
  grad.addColorStop(0.5, shirt.base);
  grad.addColorStop(1, shirt.dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-torsoW / 2, shoulderY);
  ctx.quadraticCurveTo(-torsoW * 0.62, 0.64, -torsoW * 0.44, hipY + 0.01);
  ctx.lineTo(torsoW * 0.44, hipY + 0.01);
  ctx.quadraticCurveTo(torsoW * 0.62, 0.64, torsoW / 2, shoulderY);
  ctx.quadraticCurveTo(0, shoulderY + 0.03, -torsoW / 2, shoulderY);
  ctx.closePath();
  ctx.fill();

  // シャツのライン
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-torsoW / 2, shoulderY);
  ctx.quadraticCurveTo(-torsoW * 0.62, 0.64, -torsoW * 0.44, hipY + 0.01);
  ctx.lineTo(torsoW * 0.44, hipY + 0.01);
  ctx.quadraticCurveTo(torsoW * 0.62, 0.64, torsoW / 2, shoulderY);
  ctx.quadraticCurveTo(0, shoulderY + 0.03, -torsoW / 2, shoulderY);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(-torsoW, 0.66);
  ctx.lineTo(torsoW, 0.62);
  ctx.lineTo(torsoW, 0.655);
  ctx.lineTo(-torsoW, 0.695);
  ctx.closePath();
  ctx.fill();
  // 背番号（後ろ姿のとき）
  if (facingBack) {
    ctx.save();
    ctx.scale(1, -1);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '700 0.1px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 0, -0.64);
    ctx.restore();
  }
  ctx.restore();

  /* ---- 腕 ---- */
  const drawArm = (side, swing, withRacket) => {
    const shX = side * (torsoW * 0.46);
    const shY = shoulderY - 0.02;
    const upLen = 0.155;
    const foreLen = 0.145;
    const base = -0.15 + swing;
    const upper = base - 0.55;
    const fore = upper + 0.55;
    const ex = shX + Math.cos(upper) * upLen * (0.55 + 0.45 * cy);
    const ey = shY + Math.sin(upper) * upLen;
    const fx = ex + Math.cos(fore) * foreLen * (0.55 + 0.45 * cy);
    const fy = ey + Math.sin(fore) * foreLen;

    // 袖
    limb(ctx, shX, shY, ex, ey, 0.052 * wScale, shirt.dark);
    // 前腕
    limb(ctx, ex, ey, fx, fy, 0.036 * wScale, SKIN);
    // 手
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(fx, fy, 0.022, 0, TAU);
    ctx.fill();

    if (withRacket) {
      const rAng = fore + ph.racket;
      const gx = fx + Math.cos(rAng) * 0.1;
      const gy = fy + Math.sin(rAng) * 0.1;
      limb(ctx, fx, fy, gx, gy, 0.014, '#2b2f3a');
      const hx = gx + Math.cos(rAng) * 0.09;
      const hy = gy + Math.sin(rAng) * 0.09;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(rAng);
      ctx.strokeStyle = '#eef6ff';
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.058, 0.072, 0, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(160,200,230,0.6)';
      ctx.lineWidth = 0.004;
      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * 0.016, -0.062);
        ctx.lineTo(i * 0.016, 0.062);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ff5c8a';
      ctx.lineWidth = 0.009;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.058, 0.072, 0, Math.PI * 1.1, Math.PI * 1.8);
      ctx.stroke();
      ctx.restore();
    }
  };

  // 奥の腕（利き手と反対）
  drawArm(-handSign, -ph.armSwing * 0.55, false);
  // 手前の腕（利き手・ラケット）
  drawArm(handSign, ph.armSwing, o.showRacket !== false);

  /* ---- 首 ---- */
  limb(ctx, 0, shoulderY - 0.01, 0, shoulderY + 0.05, 0.045, SKIN_DARK);

  /* ---- 髪（後ろ） ---- */
  const headX = sy * 0.012;
  if (A.hairStyle === 'Long' || A.hairStyle === 'Ponytail' || A.hairStyle === 'Medium') {
    ctx.fillStyle = hair.base;
    const backW = headR * (1.5 + (facingBack ? 0.35 : 0));
    const backH = A.hairStyle === 'Long' ? 0.20 : (A.hairStyle === 'Ponytail' ? 0.12 : 0.10);
    roundRect(ctx, headX - backW / 2, headY - backH, backW, backH, headR * 0.55);
    ctx.fill();
    if (A.hairStyle === 'Ponytail') {
      const sway = Math.sin(t * 2.2) * 0.012;
      ctx.beginPath();
      ctx.moveTo(headX - sy * headR * 0.8, headY + 0.03);
      ctx.quadraticCurveTo(headX - sy * headR * 1.6 + sway, headY - 0.02, headX - sy * headR * 1.2 + sway * 1.6, headY - 0.11);
      ctx.quadraticCurveTo(headX - sy * headR * 0.9, headY - 0.04, headX - sy * headR * 0.55, headY + 0.02);
      ctx.closePath();
      ctx.fillStyle = hair.base;
      ctx.fill();
    }
  }

  /* ---- 頭 ---- */
  const headGrad = ctx.createLinearGradient(-headR, headY + headR, headR, headY - headR);
  headGrad.addColorStop(0, SKIN);
  headGrad.addColorStop(1, SKIN_DARK);
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.ellipse(headX, headY, headR * (0.7 + 0.3 * Math.abs(cy)), headR * 1.03, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.004;
  ctx.stroke();

  /* ---- 顔（正面寄りのときだけ） ---- */
  if (!facingBack) {
    const fx = headX;
    const eyeGap = headR * 0.42 * (0.35 + 0.65 * Math.abs(cy));
    const eyeAlpha = clamp((Math.abs(cy) - 0.15) / 0.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = eyeAlpha;

    // 目
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = '#25313f';
      ctx.beginPath();
      ctx.ellipse(fx + sgn * eyeGap, headY - 0.004, eye.w * 1.05, eye.h * 1.05, eye.tilt * sgn, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(fx + sgn * eyeGap + 0.006, headY + 0.008, eye.w * 0.32, 0, TAU);
      ctx.fill();
      // 眉
      ctx.strokeStyle = 'rgba(60,50,45,0.75)';
      ctx.lineWidth = eye.brow;
      ctx.beginPath();
      ctx.moveTo(fx + sgn * (eyeGap - eye.w), headY + 0.028);
      ctx.lineTo(fx + sgn * (eyeGap + eye.w), headY + 0.030);
      ctx.stroke();
    }

    // 口
    ctx.strokeStyle = 'rgba(150,80,70,0.85)';
    ctx.lineWidth = 0.006;
    ctx.beginPath();
    if (eye.mouth === 'open') {
      ctx.fillStyle = 'rgba(160,70,70,0.55)';
      ctx.ellipse(fx, headY - 0.040, 0.012, 0.009, 0, 0, TAU);
      ctx.fill();
    } else if (eye.mouth === 'smile') {
      ctx.arc(fx, headY - 0.036, 0.014, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else {
      ctx.moveTo(fx - 0.012, headY - 0.038);
      ctx.lineTo(fx + 0.012, headY - 0.038);
      ctx.stroke();
    }

    // 頬
    if (eye.blush > 0) {
      ctx.fillStyle = `rgba(255,140,130,${eye.blush})`;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(fx + sgn * headR * 0.62, headY - 0.016, 0.014, 0.008, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ---- 髪（前） ---- */
  ctx.fillStyle = hair.base;
  const capW = headR * (0.74 + 0.3 * Math.abs(cy));
  ctx.beginPath();
  ctx.ellipse(headX, headY + headR * 0.30, capW * 1.06, headR * 0.86, 0, 0, TAU);
  ctx.fill();

  if (A.hairStyle === 'Short' || A.hairStyle === 'Sporty') {
    // スパイク
    for (let i = -2; i <= 2; i += 1) {
      const bx = headX + i * capW * 0.34;
      const tipX = bx + sy * headR * 0.5 + i * 0.004;
      ctx.beginPath();
      ctx.moveTo(bx - capW * 0.2, headY + headR * 0.42);
      ctx.lineTo(tipX, headY + headR * 0.95);
      ctx.lineTo(bx + capW * 0.2, headY + headR * 0.42);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (A.hairStyle === 'Sporty') {
    // ヘアバンド
    ctx.fillStyle = shirt.light;
    ctx.beginPath();
    ctx.ellipse(headX, headY + headR * 0.44, capW * 1.02, headR * 0.16, 0, 0, TAU);
    ctx.fill();
  }
  if (A.hairStyle === 'Medium' || A.hairStyle === 'Long' || A.hairStyle === 'Ponytail') {
    // サイドの毛束
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(headX + sgn * capW * 0.92, headY - headR * 0.1,
        capW * 0.24, headR * (A.hairStyle === 'Long' ? 1.15 : 0.8), 0, 0, TAU);
      ctx.fill();
    }
  }
  if (A.hairStyle === 'Ponytail' || A.hairStyle === 'Long') {
    // 前髪
    ctx.beginPath();
    ctx.moveTo(headX - capW, headY + headR * 0.34);
    ctx.quadraticCurveTo(headX, headY + headR * 1.05, headX + capW, headY + headR * 0.34);
    ctx.quadraticCurveTo(headX, headY + headR * 0.62, headX - capW, headY + headR * 0.34);
    ctx.closePath();
    ctx.fill();
  }

  // ツヤ
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = hair.hi;
  ctx.beginPath();
  ctx.ellipse(headX - capW * 0.3 + sy * 0.01, headY + headR * 0.72, capW * 0.34, headR * 0.11, -0.35, 0, TAU);
  ctx.fill();
  ctx.restore();

  // 輪郭
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.004;
  ctx.beginPath();
  ctx.ellipse(headX, headY + headR * 0.3, capW * 1.06, headR * 0.86, 0, Math.PI * 0.05, Math.PI * 0.95);
  ctx.stroke();

  ctx.restore();
}
