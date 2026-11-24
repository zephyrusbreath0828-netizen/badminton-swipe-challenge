/**
 * スワイプ解析（DOM非依存）
 * 入力サンプル列から、開始位置・終了位置・方向・長さ・速度を算出する。
 */
import { clamp } from './math.js';

/**
 * @typedef {{x:number,y:number,t:number}} SwipeSample
 */

/**
 * @param {SwipeSample[]} samples
 * @returns {{
 *   start:{x:number,y:number}, end:{x:number,y:number},
 *   dx:number, dy:number, len:number, pathLen:number,
 *   duration:number, speed:number,
 *   up:number, side:number, straightness:number, valid:boolean
 * }}
 */
export function analyzeSwipe(samples) {
  const empty = {
    start: { x: 0, y: 0 }, end: { x: 0, y: 0 },
    dx: 0, dy: 0, len: 0, pathLen: 0,
    duration: 0, speed: 0, up: 0, side: 0, straightness: 1, valid: false,
  };
  if (!samples || samples.length < 2) return empty;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.hypot(dx, dy);

  let pathLen = 0;
  for (let i = 1; i < samples.length; i += 1) {
    pathLen += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  }

  const duration = Math.max(last.t - first.t, 16); // ms
  // 速度は「直線距離/時間」と「軌跡距離/時間」の平均で、瞬間的な速さを拾う
  const speed = (len / duration) * 0.65 + (pathLen / duration) * 0.35;

  return {
    start: { x: first.x, y: first.y },
    end: { x: last.x, y: last.y },
    dx,
    dy,
    len,
    pathLen,
    duration,
    speed,
    up: len > 0 ? -dy / len : 0,     // +1 = 真上
    side: len > 0 ? dx / len : 0,    // +1 = 真右
    straightness: pathLen > 0 ? clamp(len / pathLen, 0, 1) : 1,
    valid: len >= 12,
  };
}

/**
 * 入力点数を間引いて軽量化（描画用の軌跡保持にも使う）
 */
export function simplifySamples(samples, maxPoints = 28) {
  if (samples.length <= maxPoints) return samples.slice();
  const step = samples.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(samples[Math.floor(i * step)]);
  }
  out.push(samples[samples.length - 1]);
  return out;
}
