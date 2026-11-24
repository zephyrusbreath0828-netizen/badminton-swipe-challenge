/**
 * ローカル永続化（設定 / ランキング）
 */
import { CONFIG } from '../config.js';

const KEY = CONFIG.storage.key;

const DEFAULT_SETTINGS = {
  handedness: 'right',
  difficulty: 'normal',
  sound: true,
  haptics: true,
  seenTutorial: false,
};

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

export class Storage {
  constructor() {
    this.data = this._load();
  }

  _load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (e) {
      raw = null;
    }
    const parsed = safeParse(raw, {});
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      ranking: Array.isArray(parsed.ranking) ? parsed.ranking.slice(0, 20) : [],
      stats: parsed.stats || { plays: 0, bestScore: 0, bestRally: 0, smashes: 0 },
      // 育成データ（v1.2.0〜）。未保存なら null（初回に既定値で生成）
      profile: parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : null,
    };
  }

  _save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      /* ストレージ不可でもゲームは続行 */
    }
  }

  get settings() {
    return this.data.settings;
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this._save();
    return this.data.settings;
  }

  get ranking() {
    return this.data.ranking;
  }

  /**
   * @param {{score:number, rally:number, smashes:number, level:number}} result
   * @returns {number} 順位（1始まり / 圏外は -1）
   */
  addRanking(result) {
    const entry = {
      score: Math.round(result.score),
      rally: Math.round(result.rally),
      smashes: Math.round(result.smashes),
      level: Math.round(result.level),
      date: Date.now(),
    };
    const list = this.data.ranking;
    list.push(entry);
    list.sort((a, b) => b.score - a.score || b.rally - a.rally);
    this.data.ranking = list.slice(0, 10);

    const stats = this.data.stats;
    stats.plays += 1;
    stats.bestScore = Math.max(stats.bestScore, entry.score);
    stats.bestRally = Math.max(stats.bestRally, entry.rally);
    stats.smashes += entry.smashes;
    this._save();

    const idx = this.data.ranking.indexOf(entry);
    return idx >= 0 ? idx + 1 : -1;
  }

  get stats() {
    return this.data.stats;
  }

  /** 育成データの生JSON（PlayerProfile の復元用） */
  get profile() {
    return this.data.profile;
  }

  /** 育成データを保存 */
  saveProfile(json) {
    this.data.profile = json;
    this._save();
    return json;
  }

  clearRanking() {
    this.data.ranking = [];
    this._save();
  }
}
