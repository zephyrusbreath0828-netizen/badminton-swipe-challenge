/**
 * プレイヤープロフィール（育成データ）
 * ------------------------------------------------------------------
 * DOM 非依存の純粋ロジック。localStorage への読み書きは Storage が担当する。
 *
 *   level : 1..50
 *   exp   : 現在レベル内の経験値
 *   points: 強化に使える育成ポイント
 *   stats : speed / stamina / accuracy / smash（50..100）
 */

export const STAT_KEYS = ['speed', 'stamina', 'accuracy', 'smash'];

export const STAT_META = {
  speed: { key: 'speed', label: 'スピード', en: 'SPEED', icon: '⚡', desc: '移動速度・自動追尾・打点到達率' },
  stamina: { key: 'stamina', label: 'スタミナ', en: 'STAMINA', icon: '❤', desc: '長ラリーの能力低下を軽減・獲得EXP増' },
  accuracy: { key: 'accuracy', label: 'ショット精度', en: 'ACCURACY', icon: '◎', desc: 'コース精度・ミスショット減' },
  smash: { key: 'smash', label: 'スマッシュ威力', en: 'POWER', icon: '▲', desc: '球速・決定率・スコア倍率' },
};

export const PROFILE_CONFIG = {
  maxLevel: 50,
  maxStat: 100,
  initialStat: 50,
  levelUpPoints: 5,      // レベルアップ時に得られるポイント
  expBase: 40,           // Lv1 -> Lv2 に必要な経験値
  expStep: 20,           // レベルごとの増加量
  staminaExpBonusMax: 0.25, // スタミナ100時の獲得EXPボーナス
  reward: {
    attend: 10,          // 試合参加
    perRally: 1,         // 最大ラリー × 1
    perSmash: 2,         // 成功スマッシュ × 2
    win: 20,             // 勝利
  },
};

/** 次のレベルへ必要な経験値 */
export function expForLevel(level) {
  const c = PROFILE_CONFIG;
  if (level >= c.maxLevel) return Infinity;
  return c.expBase + (Math.max(1, level) - 1) * c.expStep;
}

/** レベル50までの累計経験値（表示用） */
export function totalExpTo(level) {
  let sum = 0;
  for (let lv = 1; lv < level; lv += 1) sum += expForLevel(lv);
  return sum;
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function defaultStats() {
  return {
    speed: PROFILE_CONFIG.initialStat,
    stamina: PROFILE_CONFIG.initialStat,
    accuracy: PROFILE_CONFIG.initialStat,
    smash: PROFILE_CONFIG.initialStat,
  };
}

export class PlayerProfile {
  /**
   * @param {object|null} data localStorage から復元した生データ
   */
  constructor(data = null) {
    const c = PROFILE_CONFIG;
    const d = data && typeof data === 'object' ? data : {};
    this.level = clampInt(d.level, 1, c.maxLevel, 1);
    this.exp = clampInt(d.exp, 0, Math.max(0, expForLevel(this.level) - 1), 0);
    this.points = clampInt(d.points, 0, 999999, 0);
    this.stats = defaultStats();
    const src = d.stats && typeof d.stats === 'object' ? d.stats : {};
    for (const key of STAT_KEYS) {
      this.stats[key] = clampInt(src[key], c.initialStat, c.maxStat, c.initialStat);
    }
    this.matches = clampInt(d.matches, 0, 999999, 0);
    this.wins = clampInt(d.wins, 0, 999999, 0);
    this.spent = clampInt(d.spent, 0, 999999, 0);
  }

  /* ---------------- 参照 ---------------- */
  get maxLevel() { return PROFILE_CONFIG.maxLevel; }
  get isMaxLevel() { return this.level >= PROFILE_CONFIG.maxLevel; }
  get expNeeded() { return expForLevel(this.level); }
  get expProgress() {
    if (this.isMaxLevel) return 1;
    return Math.max(0, Math.min(1, this.exp / this.expNeeded));
  }
  get totalStats() {
    return STAT_KEYS.reduce((sum, k) => sum + this.stats[k], 0);
  }
  get maxedStat() { return STAT_KEYS.every((k) => this.stats[k] >= PROFILE_CONFIG.maxStat); }

  /* ---------------- 試合報酬 ---------------- */
  /**
   * @param {{maxRally?:number, smashes?:number, win?:boolean}} result
   * @returns {{points:number, exp:number, breakdown:object, levels:number, staminaBonus:number}}
   */
  applyMatchResult(result = {}) {
    const c = PROFILE_CONFIG;
    const rally = Math.max(0, Math.round(result.maxRally || 0));
    const smashes = Math.max(0, Math.round(result.smashes || 0));
    const win = !!result.win;

    const breakdown = {
      attend: c.reward.attend,
      rally: rally * c.reward.perRally,
      smash: smashes * c.reward.perSmash,
      win: win ? c.reward.win : 0,
    };
    const points = breakdown.attend + breakdown.rally + breakdown.smash + breakdown.win;

    // スタミナは獲得経験値にボーナス（50 -> 0%, 100 -> +25%）
    const staminaBonus =
      ((this.stats.stamina - c.initialStat) / (c.maxStat - c.initialStat)) * c.staminaExpBonusMax;
    const expGain = Math.round(points * (1 + staminaBonus));

    this.points += points;
    this.exp += expGain;
    this.matches += 1;
    if (win) this.wins += 1;

    const levels = this._drainLevels();
    return { points, exp: expGain, breakdown, levels, staminaBonus };
  }

  /** 経験値があふれている分だけレベルを上げる */
  _drainLevels() {
    const c = PROFILE_CONFIG;
    let levels = 0;
    while (!this.isMaxLevel && this.exp >= expForLevel(this.level)) {
      this.exp -= expForLevel(this.level);
      this.level += 1;
      this.points += c.levelUpPoints;
      levels += 1;
    }
    if (this.isMaxLevel) {
      this.exp = 0;
    }
    return levels;
  }

  /* ---------------- 強化 ---------------- */
  /**
   * 1ポイント消費して能力を+1
   * @returns {{ok:boolean, reason?:string, stat?:number}}
   */
  upgrade(key) {
    if (!STAT_KEYS.includes(key)) return { ok: false, reason: 'unknown' };
    if (this.points <= 0) return { ok: false, reason: 'no-points' };
    if (this.stats[key] >= PROFILE_CONFIG.maxStat) return { ok: false, reason: 'max' };
    this.stats[key] += 1;
    this.points -= 1;
    this.spent += 1;
    return { ok: true, stat: this.stats[key] };
  }

  /** まとめて強化（ポイントが許す限り） */
  upgradeMany(key, count = 1) {
    let done = 0;
    for (let i = 0; i < count; i += 1) {
      const r = this.upgrade(key);
      if (!r.ok) break;
      done += 1;
    }
    return done;
  }

  /* ---------------- 保存 ---------------- */
  toJSON() {
    return {
      level: this.level,
      exp: this.exp,
      points: this.points,
      stats: { ...this.stats },
      matches: this.matches,
      wins: this.wins,
      spent: this.spent,
    };
  }
}
