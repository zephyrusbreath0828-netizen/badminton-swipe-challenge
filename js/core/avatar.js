/**
 * アバター設定（v1.3.0）
 * ------------------------------------------------------------------
 * DOM 非依存の純粋ロジック。localStorage へは profile と一緒に保存される。
 *
 *   playerName  1..12 文字
 *   faceType    Face01..Face05
 *   hairStyle   Short / Medium / Long / Ponytail / Sporty
 *   hairColor   Black / Brown / Blonde / Blue / Red
 *   handedness  right / left   （settings.handedness と同期）
 *   height      160..200 cm
 *   bodyType    Slim / Normal / Power
 */

export const FACE_TYPES = ['Face01', 'Face02', 'Face03', 'Face04', 'Face05'];
export const HAIR_STYLES = ['Short', 'Medium', 'Long', 'Ponytail', 'Sporty'];
export const HAIR_COLORS = ['Black', 'Brown', 'Blonde', 'Blue', 'Red'];
export const BODY_TYPES = ['Slim', 'Normal', 'Power'];

export const HAIR_COLOR_HEX = {
  Black: { base: '#2b2b3a', hi: '#4d4d68' },
  Brown: { base: '#6b4630', hi: '#95684a' },
  Blonde: { base: '#e3bd63', hi: '#f7dfa0' },
  Blue: { base: '#3f6bd8', hi: '#7ba0ff' },
  Red: { base: '#c8452f', hi: '#ebo-'.replace('ebo-', 'ef7a5f') },
};

export const AVATAR_LIMITS = {
  nameMin: 1,
  nameMax: 12,
  heightMin: 160,
  heightMax: 200,
  heightDefault: 172,
};

export const AVATAR_DEFAULTS = {
  playerName: 'Player1',
  faceType: 'Face01',
  hairStyle: 'Short',
  hairColor: 'Black',
  handedness: 'right',
  height: AVATAR_LIMITS.heightDefault,
  bodyType: 'Normal',
};

function pick(list, value, fallback) {
  return list.indexOf(value) >= 0 ? value : fallback;
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** 名前を安全な1行テキストへ */
export function sanitizeName(name) {
  const raw = typeof name === 'string' ? name : '';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, AVATAR_LIMITS.nameMax);
  return cleaned || AVATAR_DEFAULTS.playerName;
}

/** どんな入力でも有効なアバター設定に正規化する */
export function normalizeAvatar(data) {
  const d = data && typeof data === 'object' ? data : {};
  const handedness = d.handedness === 'left' ? 'left' : (d.handedness === 'right' ? 'right' : AVATAR_DEFAULTS.handedness);
  return {
    playerName: sanitizeName(d.playerName),
    faceType: pick(FACE_TYPES, d.faceType, AVATAR_DEFAULTS.faceType),
    hairStyle: pick(HAIR_STYLES, d.hairStyle, AVATAR_DEFAULTS.hairStyle),
    hairColor: pick(HAIR_COLORS, d.hairColor, AVATAR_DEFAULTS.hairColor),
    handedness,
    height: clampNum(d.height, AVATAR_LIMITS.heightMin, AVATAR_LIMITS.heightMax, AVATAR_DEFAULTS.height),
    bodyType: pick(BODY_TYPES, d.bodyType, AVATAR_DEFAULTS.bodyType),
  };
}

/** 次の値（◀ ▶ 用） */
export function cycle(list, value, step) {
  const i = Math.max(0, list.indexOf(value));
  const n = list.length;
  return list[((i + step) % n + n) % n];
}

/* ------------------------------------------------------------------ */
/* 育成システム連携（能力補正）                                          */
/* ------------------------------------------------------------------ */
export const BODY_BONUS = {
  Slim: { speed: 10, smash: -5 },
  Normal: { speed: 0, smash: 0 },
  Power: { speed: -5, smash: 10 },
};

/**
 * 体格・身長による補正を加えた「実効ステータス」を返す（0..100）
 *   Slim   : Speed +10 / Smash -5
 *   Power  : Speed -5  / Smash +10
 *   ~169cm : Speed +3（移動速度補正）
 */
export function avatarAdjustedStats(stats = {}, avatarInput = null) {
  const av = normalizeAvatar(avatarInput);
  const out = {
    speed: Number(stats.speed) || 0,
    stamina: Number(stats.stamina) || 0,
    accuracy: Number(stats.accuracy) || 0,
    smash: Number(stats.smash) || 0,
  };
  const bonus = BODY_BONUS[av.bodyType] || BODY_BONUS.Normal;
  out.speed += bonus.speed;
  out.smash += bonus.smash;
  if (av.height < 170) out.speed += 3;

  for (const k of Object.keys(out)) {
    out[k] = Math.max(0, Math.min(100, Math.round(out[k])));
  }
  return out;
}

/** 180cm 以上は打点（リーチ）+5% */
export function avatarReachBonus(avatarInput = null) {
  const av = normalizeAvatar(avatarInput);
  return av.height >= 180 ? 0.05 : 0;
}

/** UI 表示用の補正内訳 */
export function avatarBonusNotes(avatarInput = null) {
  const av = normalizeAvatar(avatarInput);
  const notes = [];
  const bonus = BODY_BONUS[av.bodyType] || BODY_BONUS.Normal;
  if (bonus.speed) notes.push(`Speed ${bonus.speed > 0 ? '+' : ''}${bonus.speed}`);
  if (bonus.smash) notes.push(`Smash ${bonus.smash > 0 ? '+' : ''}${bonus.smash}`);
  if (av.height >= 180) notes.push('打点 +5%');
  if (av.height < 170) notes.push('Speed +3');
  return notes;
}

/** 体格 → 描画スケール（横幅） */
export function bodyWidthScale(avatarInput = null) {
  const av = normalizeAvatar(avatarInput);
  if (av.bodyType === 'Slim') return 0.88;
  if (av.bodyType === 'Power') return 1.14;
  return 1;
}

/** 身長 → 描画スケール（縦） */
export function bodyHeightScale(avatarInput = null) {
  const av = normalizeAvatar(avatarInput);
  const t = (av.height - AVATAR_LIMITS.heightMin) / (AVATAR_LIMITS.heightMax - AVATAR_LIMITS.heightMin);
  return 0.94 + t * 0.12;      // 160cm -> 0.94 / 200cm -> 1.06
}
