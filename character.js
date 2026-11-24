/**
 * キャラクター描画（アニメ調の疑似3Dキャラクター）
 * スクリーン座標 + px/メートル スケール を受け取り、Canvas 2D で描く。
 */
import { clamp, lerp, easeOutCubic, TAU } from '../core/math.js';

export const PALETTES = {
  player: {
    skin: '#ffd9bd',
    skinDark: '#f0b491',
    hair: '#2b2b3a',
    hairHi: '#4a4a63',
    shirt: '#ff7a45',
    shirtDark: '#e85a2a',
    shirtLight: '#ffb08a',
    shorts: '#22304a',
    shoe: '#f7f9fc',
    racket: '#e9f2ff',
    racketAccent: '#ff5c8a',
    outline: 'rgba(16,32,48,0.55)',
    number: '#ffffff',
  },
  ai: {
    skin: '#ffe0c8',
    skinDark: '#eeb896',
    hair: '#3a2a55',
    hairHi: '#5b4380',
    shirt: '#4d7cf3',
    shirtDark: '#3157c9',
    shirtLight: '#8fb0ff',
    shorts: '#1b2440',
    shoe: '#e9f2ff',
    racket: '#e9f2ff',
    racketAccent: '#63e6ff',
    outline: 'rgba(16,32,48,0.55)',
    number: '#ffffff',
  },
};

const ARM = {
  // 角度は「真上 = -90°」基準ではなく、x軸基準のラジアン（y上向き）
  idle: { upper: -0.55, fore: -0.15 },
  up: { upper: -2.15, fore: -1.35 },
  down: { upper: -2.45, fore: -2.05 },
  side: { upper: 0.2, fore: 0.9 },
};

function limb(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *  sx:number, sy:number, scale:number, palette:object,
 *  runPhase:number, moving:boolean, swingT:number, swingKind:string,
 *  swingActive:boolean, facing:number, isAI:boolean, handSign:number,
 *  reachGlow:number, contactY:number
 * }} o
 */
export function drawCharacter(ctx, o) {
  const P = o.palette;
  const s = o.scale;
  if (s <= 2) return;

  const bounce = o.moving ? Math.abs(Math.sin(o.runPhase * 2)) * 0.045 : Math.sin(o.runPhase * 1.4) * 0.012;
  const lean = o.moving ? clamp(Math.sin(o.runPhase * 2) * 0.06, -0.08, 0.08) : 0;

  ctx.save();
  ctx.translate(o.sx, o.sy);
  ctx.scale(s, -s); // 以降はメートル単位・y上向き

  // 接地位置の補正（バウンド）
  ctx.translate(0, bounce);
  ctx.rotate(lean * 0.35);

  const handSign = o.handSign ?? 1;
  const swingP = o.swingActive ? easeOutCubic(o.swingT) : 1;

  // ---- 脚 ----
  const hipY = 0.86;
  const legW = 0.135;
  let legA, legB;
  if (o.moving) {
    const t = Math.sin(o.runPhase * 2.2);
    legA = { x: 0.1 + t * 0.16, kx: 0.08 + t * 0.1, ky: 0.42 };
    legB = { x: -0.1 - t * 0.16, kx: -0.08 - t * 0.1, ky: 0.42 };
  } else {
    legA = { x: 0.11, kx: 0.11, ky: 0.42 };
    legB = { x: -0.11, kx: -0.11, ky: 0.42 };
  }

  // 奥の脚（暗め）
  drawLeg(ctx, legB, hipY, legW, P.shorts, P.skinDark, P.shoe, true);
  drawLeg(ctx, legA, hipY, legW, P.shorts, P.skin, P.shoe, false);

  // ---- 胴体 ----
  const shoulderY = 1.4;
  const grad = ctx.createLinearGradient(0, shoulderY, 0, hipY - 0.08);
  grad.addColorStop(0, P.shirtLight);
  grad.addColorStop(0.45, P.shirt);
  grad.addColorStop(1, P.shirtDark);

  ctx.beginPath();
  ctx.moveTo(-0.19, shoulderY);
  ctx.quadraticCurveTo(-0.23, 1.15, -0.17, 0.92);
  ctx.lineTo(0.17, 0.92);
  ctx.quadraticCurveTo(0.23, 1.15, 0.19, shoulderY);
  ctx.quadraticCurveTo(0, shoulderY - 0.06, -0.19, shoulderY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // シャツのアクセント
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath();
  ctx.moveTo(-0.24, 1.12);
  ctx.lineTo(0.24, 1.03);
  ctx.lineTo(0.24, 1.09);
  ctx.lineTo(-0.24, 1.18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 背番号（後ろ姿）
  if (!o.isAI) {
    ctx.save();
    ctx.scale(1, -1);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '700 0.2px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 0, -1.18);
    ctx.restore();
  }

  // 首
  limb(ctx, 0, shoulderY - 0.02, 0, shoulderY + 0.07, 0.11, P.skinDark);

  // ---- 奥の腕 ----
  drawArm(ctx, {
    shoulder: { x: -0.17 * handSign, y: shoulderY - 0.04 },
    angle: o.moving ? -0.75 + Math.sin(o.runPhase * 2.2) * 0.45 : -0.55,
    fore: -0.35,
    scale: 1,
    palette: P,
    racket: false,
    dark: true,
    mirror: handSign < 0,
  });

  // ---- 手前の腕 + ラケット ----
  const armAngles = computeArm(o, swingP, handSign);
  drawArm(ctx, {
    shoulder: { x: 0.17 * handSign, y: shoulderY - 0.04 },
    angle: armAngles.upper,
    fore: armAngles.fore,
    scale: 1,
    palette: P,
    racket: true,
    dark: false,
    handSign,
    racketTilt: armAngles.racket,
    mirror: handSign < 0,
  });

  // ---- 頭 ----
  const headY = 1.64;
  const headR = 0.135;
  ctx.beginPath();
  ctx.ellipse(0, headY, headR, headR * 1.06, 0, 0, TAU);
  const skinGrad = ctx.createLinearGradient(-headR, headY + headR, headR, headY - headR);
  skinGrad.addColorStop(0, P.skin);
  skinGrad.addColorStop(1, P.skinDark);
  ctx.fillStyle = skinGrad;
  ctx.fill();

  // 髪
  ctx.beginPath();
  ctx.arc(0, headY + 0.012, headR * 1.06, Math.PI * 0.02, Math.PI * 0.98);
  ctx.lineTo(-headR * 1.04, headY - 0.02);
  ctx.closePath();
  ctx.fillStyle = P.hair;
  ctx.fill();

  // 前髪（横から見たスパイク）
  ctx.beginPath();
  ctx.moveTo(-headR * 1.06, headY + 0.03);
  ctx.lineTo(-headR * 0.55, headY + headR * 0.95);
  ctx.lineTo(-headR * 0.28, headY + 0.05);
  ctx.lineTo(headR * 0.1, headY + headR * 1.0);
  ctx.lineTo(headR * 0.34, headY + 0.04);
  ctx.lineTo(headR * 0.72, headY + headR * 0.8);
  ctx.lineTo(headR * 1.02, headY + 0.02);
  ctx.closePath();
  ctx.fillStyle = P.hair;
  ctx.fill();

  // ツヤ
  ctx.beginPath();
  ctx.ellipse(-0.03, headY + headR * 0.55, headR * 0.42, headR * 0.14, -0.3, 0, TAU);
  ctx.fillStyle = P.hairHi;
  ctx.globalAlpha = 0.7;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();

  // ---- 打点リング（プレイヤーのみ） ----
  if (o.reachGlow > 0.01) {
    ctx.save();
    const r = s * 1.15;
    ctx.strokeStyle = `rgba(255,226,130,${0.55 * o.reachGlow})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(o.sx, o.sy, r, r * 0.34, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLeg(ctx, leg, hipY, w, shortsColor, skinColor, shoeColor, dark) {
  ctx.save();
  if (dark) ctx.globalAlpha = 0.9;
  // 太もも
  limb(ctx, leg.x * 0.55, hipY, leg.kx, leg.ky, w, skinColor);
  // すね
  limb(ctx, leg.kx, leg.ky, leg.x * 1.1, 0.075, w * 0.78, skinColor);
  // シューズ
  ctx.fillStyle = shoeColor;
  ctx.beginPath();
  ctx.ellipse(leg.x * 1.15, 0.045, 0.085, 0.045, 0, 0, TAU);
  ctx.fill();
  // 短パン
  ctx.fillStyle = shortsColor;
  ctx.beginPath();
  ctx.moveTo(leg.x * 0.55 - 0.1, hipY + 0.04);
  ctx.lineTo(leg.x * 0.55 + 0.1, hipY + 0.04);
  ctx.lineTo(leg.kx + 0.07, leg.ky + 0.24);
  ctx.lineTo(leg.kx - 0.07, leg.ky + 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function computeArm(o, swingP, handSign) {
  // 角度は x軸基準・y上向き（+PI/2 = 真上）
  if (!o.swingActive) {
    const breathe = Math.sin(o.runPhase * 1.6) * 0.05;
    return { upper: -0.45 + breathe, fore: 1.02, racket: 0.5 };
  }
  let from;
  let to;
  let racketTo;
  switch (o.swingKind) {
    case 'down': // スマッシュ: 頭上から振り下ろす
      from = { upper: 2.0, fore: 0.22 };
      to = { upper: -0.75, fore: 0.55 };
      racketTo = 0.3;
      break;
    case 'side': // ドライブ: 水平に振り抜く
      from = { upper: 1.1, fore: 0.45 };
      to = { upper: -0.2, fore: 0.65 };
      racketTo = 0.35;
      break;
    default: // クリア / ドロップ: オーバーヘッド気味に振る
      from = { upper: 1.9, fore: 0.55 };
      to = { upper: 0.2, fore: 0.85 };
      racketTo = 0.3;
      break;
  }
  const t = swingP;
  const recover = clamp((t - 0.72) / 0.28, 0, 1);
  const upper = lerp(lerp(from.upper, to.upper, t), -0.45, recover);
  const fore = lerp(lerp(from.fore, to.fore, t), 1.02, recover);
  const racket = lerp(racketTo, 0.5, recover);
  return { upper, fore, racket };
}

function drawArm(ctx, o) {
  const { shoulder, palette: P } = o;
  let angle = o.angle;
  let fore = o.fore;
  if (o.mirror) {
    angle = Math.PI - angle;
    fore = -fore;
  }
  const upperLen = 0.3;
  const foreLen = 0.28;
  const ex = shoulder.x + Math.cos(angle) * upperLen;
  const ey = shoulder.y + Math.sin(angle) * upperLen;
  const fx = ex + Math.cos(angle + fore) * foreLen;
  const fy = ey + Math.sin(angle + fore) * foreLen;

  ctx.save();
  if (o.dark) ctx.globalAlpha = 0.92;

  // 上腕（袖）
  limb(ctx, shoulder.x, shoulder.y, ex, ey, 0.115, P.shirtDark);
  // 前腕
  limb(ctx, ex, ey, fx, fy, 0.085, o.dark ? P.skinDark : P.skin);

  if (o.racket) {
    const rAngle = angle + fore + (o.racketTilt ?? 0);
    // グリップ
    const gx = fx + Math.cos(rAngle) * 0.2;
    const gy = fy + Math.sin(rAngle) * 0.2;
    limb(ctx, fx, fy, gx, gy, 0.035, '#2b2f3a');

    // フレーム
    const hx = gx + Math.cos(rAngle) * 0.19;
    const hy = gy + Math.sin(rAngle) * 0.19;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(rAngle);
    ctx.strokeStyle = P.racket;
    ctx.lineWidth = 0.028;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.145, 0.175, 0, 0, TAU);
    ctx.stroke();
    // ストリングス
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.008;
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 0.045, -0.15);
      ctx.lineTo(i * 0.045, 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.12, i * 0.055);
      ctx.lineTo(0.12, i * 0.055);
      ctx.stroke();
    }
    // フレームのアクセント
    ctx.strokeStyle = P.racketAccent;
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.145, 0.175, 0, Math.PI * 1.15, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();
  } else {
    // 手
    ctx.fillStyle = P.skin;
    ctx.beginPath();
    ctx.arc(fx, fy, 0.045, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
