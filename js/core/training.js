/**
 * 育成パラメータ → ゲーム内補正値への変換
 * ------------------------------------------------------------------
 * すべて「50 = 等倍」を基準にした倍率を返す。ゲーム側は倍率を掛けるだけ。
 *
 *   スピード     50 -> 1.00 / 100 -> 1.50（移動速度）
 *   ショット精度 50 -> 誤差1.00 / 100 -> 誤差0.50（50%減）
 *   スマッシュ   50 -> 1.00 / 100 -> 球速1.30倍（flight 0.70倍）
 *   スタミナ     50 -> 疲労1.00 / 100 -> 疲労0.10（ほぼ無し）
 */
import { PROFILE_CONFIG } from './profile.js';
import { clamp } from './math.js';

export const REFERENCE_STAT = PROFILE_CONFIG.initialStat; // 50
const SPAN = PROFILE_CONFIG.maxStat - PROFILE_CONFIG.initialStat; // 50

/** -1..1 の正規化（50 = 0 / 100 = 1） */
function norm(v) {
  const n = Number.isFinite(v) ? v : REFERENCE_STAT;
  return clamp((n - REFERENCE_STAT) / SPAN, -1, 1);
}

/**
 * @param {{speed:number,stamina:number,accuracy:number,smash:number}} stats
 */
export function deriveAbilities(stats = {}) {
  const sp = norm(stats.speed);
  const st = norm(stats.stamina);
  const ac = norm(stats.accuracy);
  const sm = norm(stats.smash);

  return {
    /* スピード: 移動速度 最大1.5倍 / リーチ 最大+12% */
    speedMul: 1 + sp * 0.5,
    reachMul: 1 + sp * 0.12,
    /* ショット精度: コース誤差 最大50%減 */
    accuracyMul: 1 - ac * 0.5,
    /* スマッシュ: 球速 最大30%増（滞空時間 = 1/1.3 = 0.769倍） */
    smashFlightMul: 1 / (1 + sm * 0.3),
    /* スマッシュ: スコア倍率 最大1.5倍 */
    smashScoreMul: 1 + sm * 0.5,
    /* スタミナ: 疲労係数 最大0.1倍（ほぼ能力低下なし） */
    fatigueMul: 1 - st * 0.9,
    /* 参考値（UI表示用） */
    raw: { speed: stats.speed, stamina: stats.stamina, accuracy: stats.accuracy, smash: stats.smash },
  };
}

/** 育成なしの基準値 */
export const BASE_ABILITIES = deriveAbilities({
  speed: REFERENCE_STAT, stamina: REFERENCE_STAT, accuracy: REFERENCE_STAT, smash: REFERENCE_STAT,
});

/**
 * ラリー継続による疲労度 0..1
 * 5ラリー目までは無疲労、以降 15ラリーかけて最大に達する。
 * @param {number} rally 現在のラリー数
 * @param {{fatigueMul:number}} abilities
 */
export function fatigueFactor(rally, abilities = BASE_ABILITIES) {
  const over = clamp((rally - 5) / 15, 0, 1);
  return over * (abilities.fatigueMul ?? 1);
}

/**
 * 疲労を加味した実効倍率
 * @returns {{speedMul:number, accuracyMul:number}}
 */
export function effectiveModifiers(rally, abilities = BASE_ABILITIES) {
  const f = fatigueFactor(rally, abilities);
  return {
    fatigue: f,
    speedMul: (abilities.speedMul ?? 1) * (1 - 0.18 * f),
    accuracyMul: (abilities.accuracyMul ?? 1) * (1 + 0.5 * f),
    reachMul: abilities.reachMul ?? 1,
    smashFlightMul: abilities.smashFlightMul ?? 1,
    smashScoreMul: abilities.smashScoreMul ?? 1,
  };
}

/** UI表示用の小数1桁倍率 */
export const fmtMul = (v) => `${v.toFixed(2)}x`;
