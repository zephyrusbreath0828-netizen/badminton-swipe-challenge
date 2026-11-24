/**
 * Badminton Swipe Challenge — ゲーム定数
 * ------------------------------------------------------------------
 * ゲームバランス・コート寸法・ショット性能をすべてここに集約する。
 * v1.1 以降の調整は原則このファイルだけで完結する。
 */

export const CONFIG = {
  version: '1.2.8',

  storage: {
    key: 'bsc.v1',
  },

  /* コート（単位: m / 1m = 100cm の実寸ベースを簡略化） */
  court: {
    length: 13.4,        // ベースライン間
    halfWidth: 3.05,     // ダブルスサイドライン
    playHalfWidth: 2.9,  // 実プレー判定幅
    netZ: 6.7,           // ネット位置
    netHeight: 1.52,     // ネット上端（センター付近の高さ）
    postHeight: 1.58,
    shortService: 1.98,  // ネットからショートサービスラインまで
    longService: 0.76,   // ネットからダブルスロングサービスラインまで
  },

  /* 疑似3Dカメラ（プレイヤー背後からの見下ろし） */
  camera: {
    y: 5.5,
    z: -5.73,
    horizonRatio: 0.2,
    focalRatio: 0.9,
    widthScale: 0.72,
  },

  physics: {
    gravity: 9.8,
    groundY: 0,
    netClearance: 0.16,
    substep: 1 / 180,
  },

  /* プレイヤー（v1.0 は完全自動移動） */
  player: {
    minX: -3.4,
    maxX: 3.4,
    minZ: 0.7,
    maxZ: 5.8,
    homeZ: 3.3,
    moveSpeed: 7.6,
    accel: 34,
    reachX: 2.55,
    reachZ: 2.65,
    maxContactY: 3.95,
    shoulderY: 1.5,
    bodyHeight: 1.82,
  },

  ai: {
    minZ: 7.2,
    maxZ: 12.9,
    homeZ: 10.3,
    reachX: 2.9,
    reachZ: 3.0,
    accel: 30,
  },

  /* ショット定義: flight = 滞空時間(秒) / depth = 落下地点Z範囲 */
  shots: {
    drop: {
      id: 'drop', label: 'ドロップ', en: 'DROP',
      flight: 1.5, depth: [7.35, 9.3], lateral: 0.85,
      color: '#7ee8fa', effect: 'soft',
    },
    clear: {
      id: 'clear', label: 'クリア', en: 'CLEAR',
      flight: 2.05, depth: [11.2, 13.0], lateral: 1.0,
      color: '#b6f36b', effect: 'arc',
    },
    drive: {
      id: 'drive', label: 'ドライブ', en: 'DRIVE',
      flight: 0.84, depth: [9.2, 12.5], lateral: 1.0,
      color: '#ffd166', effect: 'line',
    },
    smash: {
      id: 'smash', label: 'スマッシュ', en: 'SMASH',
      flight: 0.62, depth: [7.6, 10.7], lateral: 0.95,
      color: '#ff7b6b', effect: 'burst',
    },
  },

  serves: {
    short: { id: 'shortServe', label: 'ショートサービス', flight: 1.4, depth: [7.4, 8.7], lateral: 0.6 },
    long: { id: 'longServe', label: 'ロングサービス', flight: 2.0, depth: [11.3, 12.9], lateral: 0.85 },
    flick: { id: 'flickServe', label: 'フリックサービス', flight: 1.16, depth: [10.6, 12.8], lateral: 0.85 },
  },

  /* 育成（v1.2.0） */
  training: {
    winWinners: 3,      // ウィナー3本以上で「勝利」（勝利報酬の対象）
    fatigueStart: 5,    // 疲労が始まるラリー数
    fatigueSpan: 15,    // 疲労が最大になるまでのラリー数
    maxLevel: 50,
  },

  /* 得点 */
  scoring: {
    returnPoints: 10,   // 返球成功
    smashBonus: 20,     // スマッシュ成功時の追加（合計30点）
    winnerPoints: 15,   // AIが返せなかった時
    levelStep: 100,     // 100点ごとにレベルアップ
  },

  /* AI難易度 */
  difficulty: {
    easy: {
      key: 'easy', label: '初級',
      reaction: 0.42, speed: 5.4, errorRate: 0.24,
      smashRate: 0.06, placement: 0.3, netTolerance: 0.55,
    },
    normal: {
      key: 'normal', label: '中級',
      reaction: 0.28, speed: 6.7, errorRate: 0.13,
      smashRate: 0.18, placement: 0.6, netTolerance: 0.35,
    },
    hard: {
      key: 'hard', label: '上級',
      reaction: 0.18, speed: 8.1, errorRate: 0.05,
      smashRate: 0.32, placement: 0.88, netTolerance: 0.2,
    },
  },

  /* レベルアップ時の伸び幅 */
  levelScaling: {
    aiSpeed: 0.05,
    aiError: -0.035,
    aiPlacement: 0.05,
    flight: -0.035,
    minFlightScale: 0.72,
  },

  /* スワイプ判定 */
  input: {
    minLength: 26,
    dropMaxLength: 132,
    smashMinContactY: 1.32,
    perfectContactMin: 1.15,
    perfectContactMax: 3.15,
    cooldown: 0.14,
    whiffCooldown: 0.34,
    trailLife: 0.24,
  },
};

export const DIFFICULTY_KEYS = ['easy', 'normal', 'hard'];
export const SHOT_KEYS = ['drop', 'clear', 'drive', 'smash'];
