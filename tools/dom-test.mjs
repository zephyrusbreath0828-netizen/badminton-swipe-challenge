/**
 * DOM / 育成ロジックの検証（jsdom）
 *
 *   node tools/dom-test.mjs
 *
 * 1) 設定画面の「インストール」ボタンが beforeinstallprompt を正しく扱うか
 *    - 早期捕捉（window.__installPrompt）→ ボタン押下で prompt() が呼ばれる
 *    - userChoice: accepted → ボタンが「アプリインストール済み」になり隠れる
 *    - userChoice: dismissed → 手順ダイアログが出る
 * 2) iPhone UA では手順ダイアログ（共有→ホーム画面に追加→追加）
 * 3) 育成ロジック（報酬・レベルアップ・上限・保存）
 * 4) 育成倍率が仕様値（スピード1.5倍 / 誤差50%減 / 球速30%増）になること
 */
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = await readFile(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
let checks = 0;
function check(name, cond, extra = '') {
  checks += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

/* ------------------------------------------------------------------ */
/* jsdom 環境を作り、install.js を読み込む                              */
/* ------------------------------------------------------------------ */
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
};

async function makeEnv(ua, { standalone = false } = {}) {
  const dom = new JSDOM(HTML, {
    url: 'https://example.test/',
    userAgent: ua,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;
  // jsdom の userAgent オプションに依存せず明示的に上書きする
  Object.defineProperty(win.navigator, 'userAgent', { value: ua, configurable: true });
  win.matchMedia = (q) => ({
    matches: standalone && /standalone|fullscreen/.test(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  // Node の globals を jsdom に差し替え
  const define = (key, value) => {
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    } catch (e) {
      globalThis[key] = value;
    }
  };
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('localStorage', win.localStorage);
  define('CustomEvent', win.CustomEvent);
  define('Event', win.Event);
  define('HTMLElement', win.HTMLElement);
  define('MouseEvent', win.MouseEvent);
  define('MutationObserver', win.MutationObserver);
  define('HTMLCanvasElement', win.HTMLCanvasElement);

  // モジュールキャッシュを避けるためクエリを付けて読み込む
  const mod = await import(`${path.join(ROOT, 'js/pwa/install.js')}?t=${Date.now()}-${Math.random()}`);
  return { win, dom, mod };
}

function fakePromptEvent(outcome) {
  const calls = { prompt: 0 };
  const ev = {
    preventDefault() {},
    prompt() { calls.prompt += 1; },
    get userChoice() { return Promise.resolve({ outcome }); },
  };
  return { ev, calls };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

/* ================================================================== */
console.log('\n[1] Android Chrome: beforeinstallprompt → ネイティブダイアログ');
{
  const { win, mod } = await makeEnv(UA.android);
  const { ev, calls } = fakePromptEvent('accepted');

  // index.html の早期ハンドラを再現（モジュール読込前のイベント）
  win.__installPrompt = ev;
  const api = mod.initPWA();

  const btn = win.document.getElementById('btn-install-app');
  const label = win.document.getElementById('btn-install-app-label');
  check('設定にインストールボタンが存在する', !!btn);
  check('初期状態のラベル', label.textContent.includes('インストール'), label.textContent);

  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await settle();

  check('ボタン押下で prompt() が呼ばれる', calls.prompt === 1, String(calls.prompt));
  check('インストール後は「アプリインストール済み」表示', label.textContent === 'アプリインストール済み', label.textContent);
  check('インストール後はボタンが無効化（実質非表示相当）', btn.getAttribute('aria-disabled') === 'true');
  check('インストール済み注記が表示される', win.document.getElementById('install-installed-note').hidden === false);
  check('installer が installed 状態', api.installer.installed === true);

  // 再起動相当（同じ localStorage で新しい installer）
  const mod2 = await import(`${path.join(ROOT, 'js/pwa/install.js')}?t=reboot-${Math.random()}`);
  const api2 = mod2.initPWA();
  const label2 = win.document.getElementById('btn-install-app-label');
  check('再起動後もインストール済み状態が維持される', label2.textContent === 'アプリインストール済み', label2.textContent);
  check('再起動後も導線が有効（二重 prompt しない）', api2.installer.canPrompt === false);
}

/* ================================================================== */
console.log('\n[2] Android Chrome: プロンプトを閉じた場合（dismissed）');
{
  const { win, mod } = await makeEnv(UA.android);
  const { ev, calls } = fakePromptEvent('dismissed');
  win.__installPrompt = ev;
  mod.initPWA();

  win.document.getElementById('btn-install-app')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await settle();

  const dialog = win.document.getElementById('install-dialog');
  check('prompt() は呼ばれている', calls.prompt === 1, String(calls.prompt));
  check('閉じられたら手順ダイアログを表示', dialog.classList.contains('is-on'));
  check('Android向けの手順になっている',
    win.document.getElementById('install-dialog-lead').textContent.includes('Android'),
    win.document.getElementById('install-dialog-lead').textContent);
  check('インストール済みにはしない',
    win.document.getElementById('btn-install-app-label').textContent !== 'アプリインストール済み');

  const row = win.document.getElementById('btn-install-app');
  const err = win.document.getElementById('install-error');
  check('プロンプト消費後は「インストール利用不可」', win.document.getElementById('btn-install-app-label').textContent === 'インストール利用不可',
    win.document.getElementById('btn-install-app-label').textContent);
  check('利用不可時はボタンが無効', row.disabled === true);
  check('要件不足の説明が表示される', err.hidden === false);
}

/* ================================================================== */
console.log('\n[3] iPhone Safari: 手順ダイアログ');
{
  const { win, mod } = await makeEnv(UA.ios);
  mod.initPWA();

  const btn = win.document.getElementById('btn-install-app');
  check('iOS では「ホーム画面に追加」と表示', win.document.getElementById('btn-install-app-label').textContent.includes('ホーム画面'), win.document.getElementById('btn-install-app-label').textContent);
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await settle();

  const dialog = win.document.getElementById('install-dialog');
  const steps = win.document.getElementById('install-dialog-steps');
  const texts = [...steps.querySelectorAll('.install-dialog__text')].map((n) => n.textContent);
  check('手順ダイアログが開く', dialog.classList.contains('is-on'));
  check('「iPhone」向けの案内である', win.document.getElementById('install-dialog-lead').textContent.includes('iPhone'));
  check('3ステップが表示される', texts.length === 3, String(texts.length));
  check('1: 共有ボタン', /共有/.test(texts[0] || ''), texts[0]);
  check('2: ホーム画面に追加', /ホーム画面に追加/.test(texts[1] || ''), texts[1]);
  check('3: 追加', /追加/.test(texts[2] || ''), texts[2]);
}

/* ================================================================== */
console.log('\n[4] スタンドアロン起動時');
{
  const { win, mod } = await makeEnv(UA.android, { standalone: true });
  mod.initPWA();
  check('standalone ではインストール済み扱い',
    win.document.getElementById('btn-install-app-label').textContent === 'アプリインストール済み',
    win.document.getElementById('btn-install-app-label').textContent);
  win.document.getElementById('btn-install-app')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await settle();
  check('スタンドアロン時はダイアログを出さない',
    !win.document.getElementById('install-dialog').classList.contains('is-on'));
}

/* ================================================================== */
console.log('\n[5] 育成ロジック');
{
  const { PlayerProfile, PROFILE_CONFIG, expForLevel } = await import(`${path.join(ROOT, 'js/core/profile.js')}`);
  const { deriveAbilities, fatigueFactor } = await import(`${path.join(ROOT, 'js/core/training.js')}`);

  const p = new PlayerProfile(null);
  check('初期レベルは1', p.level === 1);
  check('初期ポイントは0', p.points === 0);
  check('初期能力はすべて50', ['speed', 'stamina', 'accuracy', 'smash'].every((k) => p.stats[k] === 50));

  // 報酬: 参加10 + ラリー15 + スマッシュ4*2 + 勝利20 = 53
  const r = p.applyMatchResult({ maxRally: 15, smashes: 4, win: true });
  check('報酬計算（10 + 15 + 8 + 20 = 53）', r.points === 53, String(r.points));
  check('内訳が返る', r.breakdown.attend === 10 && r.breakdown.rally === 15 && r.breakdown.smash === 8 && r.breakdown.win === 20,
    JSON.stringify(r.breakdown));
  check('スタミナ50ではEXPボーナス0%', Math.abs(r.staminaBonus) < 1e-9, String(r.staminaBonus));
  check('EXP = ポイント（ボーナスなし時）', r.exp === 53, String(r.exp));
  // 53pt 獲得 + レベルアップ報酬 5pt = 58pt
  check('ポイントが加算される（53 + レベルアップ5）', p.points === 58, String(p.points));

  // レベルアップ（Lv1->2 は 40exp）
  check('Lv1→2 必要EXPは40', expForLevel(1) === 40, String(expForLevel(1)));
  check('レベルアップしている', p.level === 2, String(p.level));
  check('レベルアップ分のポイント +5', p.points === 53 + 5, String(p.points));
  check('端数EXPが繰り越される', p.exp === 53 - 40, String(p.exp));

  // 強化
  const before = p.points;
  const up = p.upgrade('speed');
  check('強化で能力+1', p.stats.speed === 51 && up.ok);
  check('強化でポイント-1', p.points === before - 1);

  // 上限
  p.stats.accuracy = 100;
  const maxRes = p.upgrade('accuracy');
  check('最大値では強化できない', maxRes.ok === false && maxRes.reason === 'max');
  p.points = 0;
  check('ポイント0では強化できない', p.upgrade('smash').ok === false);

  // レベル上限
  const p2 = new PlayerProfile({ level: 50, exp: 0, points: 0 });
  const r2 = p2.applyMatchResult({ maxRally: 30, smashes: 10, win: true });
  check('レベル上限50を超えない', p2.level === 50, String(p2.level));
  check('上限でもポイントは得られる', p2.points === r2.points, `${p2.points}/${r2.points}`);

  // スタミナのEXPボーナス
  const p3 = new PlayerProfile({ stats: { speed: 50, stamina: 100, accuracy: 50, smash: 50 } });
  const r3 = p3.applyMatchResult({ maxRally: 10, smashes: 0, win: false });
  check('スタミナ100でEXP +25%', r3.exp === Math.round(20 * 1.25), `${r3.exp}`);

  // 仕様値の検証
  const ab = deriveAbilities({ speed: 100, stamina: 100, accuracy: 100, smash: 100 });
  check('スピード100 → 移動1.5倍', Math.abs(ab.speedMul - 1.5) < 1e-9, String(ab.speedMul));
  check('精度100 → 誤差50%減', Math.abs(ab.accuracyMul - 0.5) < 1e-9, String(ab.accuracyMul));
  check('スマッシュ100 → 球速1.3倍', Math.abs(1 / ab.smashFlightMul - 1.3) < 1e-9, String(1 / ab.smashFlightMul));
  check('スタミナ100 → 疲労ほぼなし', ab.fatigueMul <= 0.11, String(ab.fatigueMul));
  const base = deriveAbilities({ speed: 50, stamina: 50, accuracy: 50, smash: 50 });
  check('初期値50はすべて等倍', base.speedMul === 1 && base.accuracyMul === 1
    && Math.abs(base.smashFlightMul - 1) < 1e-9 && base.fatigueMul === 1);
  check('疲労はラリー5まで0', fatigueFactor(3, base) === 0 && fatigueFactor(20, base) > 0.9);
  check('高スタミナなら長ラリーでも疲労小', fatigueFactor(20, ab) < 0.12, String(fatigueFactor(20, ab)));
}

/* ================================================================== */
console.log('\n[6] セーブ（localStorage）');
{
  const { win } = await makeEnv(UA.desktop);
  const { PlayerProfile } = await import(`${path.join(ROOT, 'js/core/profile.js')}`);
  const { Storage } = await import(`${path.join(ROOT, 'js/core/storage.js')}`);

  const st = new Storage();
  const p = new PlayerProfile(st.profile);
  p.applyMatchResult({ maxRally: 20, smashes: 5, win: true });
  p.upgrade('speed');
  st.saveProfile(p.toJSON());

  // 再起動相当
  const st2 = new Storage();
  const restored = new PlayerProfile(st2.profile);
  check('レベルが復元される', restored.level === p.level, `${restored.level}/${p.level}`);
  check('経験値が復元される', restored.exp === p.exp, `${restored.exp}/${p.exp}`);
  check('ポイントが復元される', restored.points === p.points, `${restored.points}/${p.points}`);
  check('能力値が復元される', restored.stats.speed === p.stats.speed, `${restored.stats.speed}/${p.stats.speed}`);
  check('設定・ランキングと共存する', typeof st2.settings.handedness === 'string');
}

/* ================================================================== */
console.log('\n[7] PWA 診断（collectDiagnostics）');
{
  const { win } = await makeEnv(UA.android);
  const diag = await import(`${path.join(ROOT, 'js/pwa/diagnostics.js')}?d=${Math.random()}`);

  // manifest / SW をスタブ
  const manifestJson = {
    name: 'Shuttle Smash', short_name: 'Shuttle Smash', start_url: '/', display: 'standalone',
    icons: [{ sizes: '192x192' }, { sizes: '512x512' }],
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => manifestJson });
  Object.defineProperty(win.navigator, 'serviceWorker', {
    value: {
      getRegistration: async () => ({ scope: 'https://example.test/', active: { state: 'activated' } }),
      controller: {},
      addEventListener() {},
    },
    configurable: true,
  });

  const d = await diag.collectDiagnostics({ promptAvailable: false, installed: false });
  check('Installed ラベル', d.labels.installed === 'Not Installed', d.labels.installed);
  check('beforeinstallprompt ラベル', d.labels.prompt === 'Not Available', d.labels.prompt);
  check('Service Worker ラベル', d.labels.sw === 'Registered', d.labels.sw);
  check('Manifest ラベル', d.labels.manifest === 'Loaded', d.labels.manifest);
  check('Display Mode ラベル', ['Browser', 'Standalone'].includes(d.labels.display), d.labels.display);
  check('Manifest の中身を読めている', d.manifest.icons === 2 && d.manifest.name === 'Shuttle Smash',
    JSON.stringify(d.manifest));
  check('原因リストに beforeinstallprompt 未発火が含まれる',
    d.reasons.some((r) => r.includes('beforeinstallprompt')), d.reasons.join(' / '));

  // standalone 判定
  const { win: w2 } = await makeEnv(UA.android, { standalone: true });
  const d2 = await diag.collectDiagnostics({ promptAvailable: false, installed: false });
  check('standalone 時は Installed', d2.labels.installed === 'Installed', d2.labels.installed);
  check('standalone 時は Display Mode = Standalone', d2.labels.display === 'Standalone', d2.labels.display);

  // UI 側: 診断行のラベルが消えないこと
  const { win: w3, mod: mod3 } = await makeEnv(UA.desktop);
  const api3 = mod3.initPWA();
  await api3.runDiagnostics({ show: true });
  const rows = [...w3.document.querySelectorAll('.diag-row')];
  check('診断行が5件ある', rows.length === 5, String(rows.length));
  const labelsKept = rows.every((r) => {
    const l = r.querySelector('.diag-row__label');
    const v = r.querySelector('.diag-row__value');
    return l && l.textContent.trim().length > 0 && v && v.textContent !== '-';
  });
  check('項目名と値の両方が表示される', labelsKept,
    rows.map((r) => r.textContent.trim()).join(' | '));
  check('診断パネルが開く', w3.document.getElementById('screen-diagnostics').classList.contains('is-on'));
}

console.log(`\n結果: ${failures === 0 ? `ALL PASS (${checks} checks)` : `${failures} FAILED / ${checks} checks`}\n`);
process.exit(failures === 0 ? 0 : 1);
