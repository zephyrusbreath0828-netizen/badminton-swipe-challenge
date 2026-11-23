/**
 * ショット判定（DOM非依存）
 * スワイプ情報 + 打点情報 + 利き手 から、ショット種別・コース・威力を決定する。
 *
 * 判定ルール（v1.0）
 *  - 上方向スワイプ（短い）      -> ドロップ
 *  - 上方向スワイプ（長い）      -> クリア
 *  - 横方向スワイプ              -> ドライブ
 *  - 下方向スワイプ + 高い打点    -> スマッシュ
 *  - 下方向スワイプ + 低い打点    -> ミスショット（ネット）
 *  - サービスは上方向スワイプの長さと速度で3種に分岐
 */
import { CONFIG } from '../config.js';
import { clamp, lerp, rand } from './math.js';

const COURT = CONFIG.court;
const INPUT = CONFIG.input;

/** スワイプの左右成分を -1..1 のコース意図へ */
function aimOf(swipe) {
  const len = Math.max(swipe.len, 1);
  return clamp((swipe.dx / len) * 1.25, -1, 1);
}

/** スワイプ速度から威力 0.55..1.35 */
function powerOf(swipe) {
  return clamp(0.55 + swipe.speed * 0.34 + swipe.len / 950, 0.55, 1.35);
}

/** 利き手によるコース反転（左利きは同じスワイプで角度が変わる） */
function applyHandedness(x, handedness) {
  return handedness === 'left' ? -x : x;
}

/** フォア / バック判定（打点が身体のどちら側か） */
function isForehand(contactX, playerX, handedness) {
  const d = contactX - playerX;
  if (Math.abs(d) < 0.12) return true;
  return (d > 0) === (handedness === 'right');
}

/** 打点品質 */
function contactQuality(type, contactY) {
  if (type === 'smash') {
    if (contactY >= 1.85 && contactY <= 3.35) return 'perfect';
    if (contactY >= INPUT.smashMinContactY) return 'good';
    return 'late';
  }
  if (contactY >= INPUT.perfectContactMin && contactY <= INPUT.perfectContactMax) return 'perfect';
  if (contactY < 0.5) return 'late';
  if (contactY > 3.6) return 'reach';
  return 'good';
}

const QUALITY_POWER = { perfect: 1.1, good: 1, reach: 0.82, late: 0.62 };
const QUALITY_ACC = { perfect: 1, good: 0.9, reach: 0.72, late: 0.55 };

/**
 * サービス判定
 * @returns {{invalid?:boolean, id:string, label:string, flight:number, target:{x:number,z:number}, power:number, aim:number, isServe:true}}
 */
export function resolveServe({ swipe, playerX, handedness, speedScale = 1, level = 1 }) {
  const up = swipe.up;
  if (up < 0.3 || swipe.len < INPUT.minLength) {
    return { invalid: true, reason: '下から上へスワイプしてサーブ' };
  }

  let key = 'long';
  if (swipe.speed > 1.45 && swipe.len > 120) key = 'flick';
  else if (swipe.len < 118) key = 'short';

  const def = CONFIG.serves[key];
  const aim = aimOf(swipe);
  const power = clamp(powerOf(swipe) * 0.9, 0.6, 1.1);

  let tx = playerX * 0.4 + applyHandedness(aim * 2.4 * def.lateral, handedness);
  tx = clamp(tx, -COURT.playHalfWidth + 0.25, COURT.playHalfWidth - 0.25);

  const tz = lerp(def.depth[0], def.depth[1], clamp((power - 0.6) / 0.5, 0, 1));

  return {
    isServe: true,
    id: def.id,
    type: 'serve',
    label: def.label,
    en: key === 'short' ? 'SHORT SERVE' : key === 'flick' ? 'FLICK SERVE' : 'LONG SERVE',
    flight: def.flight / (speedScale * (0.9 + power * 0.15)),
    target: { x: tx, z: tz },
    power,
    aim,
    quality: 'good',
    forehand: true,
  };
}

/**
 * ラリー中のショット判定
 * @param {{swipe:object, contactY:number, contactX:number, playerX:number,
 *          handedness:string, speedScale:number, level:number}} p
 */
export function resolvePlayerShot({
  swipe, contactY, contactX, playerX, handedness, speedScale = 1, level = 1,
}) {
  const up = swipe.up;          // + = 上方向
  const side = Math.abs(swipe.side);
  const power0 = powerOf(swipe);

  let type = null;
  let fault = null;

  if (up < -0.45) {
    // 下方向スワイプ
    if (contactY >= INPUT.smashMinContactY) type = 'smash';
    else fault = 'lowContact';
  } else if (up > 0.5) {
    type = swipe.len < INPUT.dropMaxLength ? 'drop' : 'clear';
  } else if (side > 0.55) {
    type = 'drive';
  } else {
    type = 'drive';
  }

  if (fault) {
    return {
      fault,
      faultLabel: 'ミスショット',
      faultMessage: '打点が低すぎる…！',
      type: 'smash',
      label: 'ミスショット',
      en: 'MISS',
      power: 0,
      target: { x: playerX * 0.4, z: COURT.netZ - 0.45 },
      flight: 0.5,
      isServe: false,
      aim: 0,
      forehand: true,
      quality: 'late',
    };
  }

  const forehand = isForehand(contactX, playerX, handedness);
  const quality = contactQuality(type, contactY);
  const def = CONFIG.shots[type];

  const handPower = forehand ? 1 : 0.84;
  const handAcc = forehand ? 1 : 0.68;
  const power = clamp(power0 * QUALITY_POWER[quality] * handPower, 0.4, 1.45);

  // ---- コース ----
  const aim = aimOf(swipe);
  const lateral = def.lateral * (type === 'smash' ? 1.05 : 1);
  let tx = playerX * 0.34 + aim * 3.35 * lateral;
  tx = applyHandedness(tx, handedness);

  // バックハンド / 打点不良はばらつく
  const acc = handAcc * QUALITY_ACC[quality];
  const spread = (1 - acc) * 2.2;
  tx += rand(-1, 1) * spread * 0.55;
  tx = clamp(tx, -COURT.halfWidth + 0.1, COURT.halfWidth - 0.1);

  // ---- 深さ ----
  const depthT = clamp((power - 0.55) / 0.85, 0, 1);
  let tz = lerp(def.depth[0], def.depth[1], depthT);
  tz += rand(-1, 1) * (1 - acc) * 1.1;

  // 威力過多のバックハンドはアウトしやすい
  if (acc < 0.75 && power > 1.12) tz += rand(0.2, 0.9);

  const flight = def.flight / (speedScale * (0.78 + power * 0.3));
  const overshoot = tz > COURT.length - 0.05 || Math.abs(tx) > COURT.halfWidth + 0.02;

  return {
    isServe: false,
    type,
    id: def.id,
    label: def.label,
    en: def.en,
    color: def.color,
    effect: def.effect,
    flight,
    target: { x: tx, z: tz },
    power,
    quality,
    forehand,
    aim,
    out: overshoot,
    fault: null,
  };
}

/**
 * AI のショット生成（AIクラスから呼ばれる純関数）
 */
export function buildAIShot({
  type, from, target, speedScale = 1, power = 1,
}) {
  const def = CONFIG.shots[type] || CONFIG.shots.clear;
  const flight = def.flight / (speedScale * (0.82 + power * 0.28));
  return {
    isServe: false,
    type,
    id: def.id,
    label: def.label,
    en: def.en,
    color: def.color,
    effect: def.effect,
    flight,
    target,
    power,
    quality: 'good',
    forehand: Math.random() > 0.25,
    aim: 0,
    out: target.z > COURT.length - 0.02 || Math.abs(target.x) > COURT.halfWidth,
    fault: null,
  };
}
