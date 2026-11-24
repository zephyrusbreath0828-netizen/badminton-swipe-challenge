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
  // jsdom は isSecureContext を算出しないため、https URL 相当として明示する
  Object.defineProperty(win, 'isSecureContext', { value: true, configurable: true });
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

const settle = () => new Promise((r) => setTimeout(r, 80));

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
  check('prompt() 後に deferredPrompt が解放される', win.deferredPrompt === null, String(win.deferredPrompt));
  check('インストール後は「アプリインストール済み」表示', label.textContent === 'アプリインストール済み', label.textContent);
  check('インストール後は data-state=installed', btn.dataset.state === 'installed', btn.dataset.state);
  check('ボタンは disabled にしない（押下ログが消えるため）', btn.disabled === false);
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
  check('プロンプト消費後は data-state=unavailable', row.dataset.state === 'unavailable', row.dataset.state);
  check('利用不可でもボタンは押せる（click を殺さない）', row.disabled === false);
  check('利用不可は aria-disabled で示す', row.getAttribute('aria-disabled') === 'true');
  check('押すまでは要件不足の説明を出さない', err.hidden === true);
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
console.log('\n[6b] deferredPrompt（v1.2.3）');
{
  const { win, mod } = await makeEnv(UA.android);
  const { ev, calls } = fakePromptEvent('accepted');

  // head の早期ハンドラを再現せず、イベントだけ飛ばす（install.js 側で保持できるか）
  const api = mod.initPWA();
  check('起動直後の deferredPrompt は null', win.deferredPrompt === null, String(win.deferredPrompt));

  const evt = new win.Event('beforeinstallprompt', { cancelable: true });
  evt.prompt = ev.prompt;
  Object.defineProperty(evt, 'userChoice', { value: Promise.resolve({ outcome: 'accepted' }), configurable: true });
  win.dispatchEvent(evt);

  check('beforeinstallprompt で window.deferredPrompt に保持される', win.deferredPrompt === evt,
    typeof win.deferredPrompt);
  check('イベントの preventDefault が呼ばれる', evt.defaultPrevented === true);
  check('受信回数が記録される', (win.__promptState || {}).received === 1, JSON.stringify(win.__promptState));
  check('保持後はボタンが有効', win.document.getElementById('btn-install-app').disabled === false);

  // --- 診断が実態を反映するか ---
  const d = await api.runDiagnostics({ show: true });
  check('診断: deferredPrompt 保持中は Prompt Available', d.labels.prompt === 'Prompt Available', d.labels.prompt);
  check('診断: Raw の deferredPrompt が true', d.raw.deferredPrompt === true, JSON.stringify(d.raw.deferredPrompt));
  check('診断: 行に Available (held) が出る',
    win.document.querySelector('#diag-deferredprompt .diag-row__value').textContent === 'Available (held)',
    win.document.querySelector('#diag-deferredprompt .diag-row__value').textContent);

  // --- ボタン押下 → prompt() → userChoice ---
  win.document.getElementById('btn-install-app')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await settle();
  check('保持したイベントで prompt() が呼ばれる', calls.prompt === 1, String(calls.prompt));
  check('userChoice 後に deferredPrompt を手放す', win.deferredPrompt === null, String(win.deferredPrompt));
  check('accepted ならインストール済みになる',
    api.installer.installed === true && win.document.getElementById('btn-install-app-label').textContent === 'アプリインストール済み');

  // 使用後の診断
  const d2 = await api.runDiagnostics({ show: true });
  check('診断: 使用後は Prompt Missing', d2.labels.prompt === 'Prompt Missing', d2.labels.prompt);
  check('診断: 使用後も受信履歴は残る', d2.raw.promptReceived === 1, String(d2.raw.promptReceived));
  check('診断: 使用後は Used (consumed)',
    win.document.querySelector('#diag-deferredprompt .diag-row__value').textContent === 'Used (consumed)',
    win.document.querySelector('#diag-deferredprompt .diag-row__value').textContent);
}

console.log('\n[6c] deferredPrompt が無い状態でボタンを押す');
{
  const { win, mod } = await makeEnv(UA.android);
  let alerted = null;
  win.alert = (m) => { alerted = m; };
  mod.initPWA();

  win.document.getElementById('btn-install-app')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await settle();
  check('deferredPrompt が無ければ alert を出す', alerted === 'インストール準備ができていません', String(alerted));
  check('要件不足の説明も表示される', win.document.getElementById('install-error').hidden === false);
  check('未保持でもボタンは disabled にならない',
    win.document.getElementById('btn-install-app').disabled === false);
}

console.log('\n[6d] 押下ログ / 委譲リスナー（v1.2.4）');
{
  const { win, mod } = await makeEnv(UA.android);
  const { ev, calls } = fakePromptEvent('accepted');
  win.deferredPrompt = ev;             // head が保持している状態を再現

  const logs = [];
  const orig = console.log;
  console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };

  const api = mod.initPWA();
  check('deferredPrompt 保持時はボタンが有効', win.document.getElementById('btn-install-app').disabled === false);

  win.document.getElementById('btn-install-app')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await settle();
  console.log = orig;

  check("'Install Button Clicked' が出力される", logs.some((l) => l.includes('Install Button Clicked')), logs.join(' | '));
  check("'Prompt Executed' が出力される", logs.some((l) => l.includes('Prompt Executed')), logs.join(' | '));
  check('userChoice の結果がログに出る', logs.some((l) => l.includes('accepted')), logs.join(' | '));
  check('実際に prompt() が呼ばれる', calls.prompt === 1, String(calls.prompt));

  // --- ノード差し替え後でも動く（委譲リスナー） ---
  const env2 = await makeEnv(UA.android);
  const f2 = fakePromptEvent('dismissed');
  env2.win.deferredPrompt = f2.ev;
  const api2 = env2.mod.initPWA();
  const oldBtn = env2.win.document.getElementById('btn-install-app');
  const clone = oldBtn.cloneNode(true);      // リスナーを持たない複製
  oldBtn.replaceWith(clone);                 // DOM 差し替え
  clone.dispatchEvent(new env2.win.MouseEvent('click', { bubbles: true }));
  await settle();
  check('DOM を差し替えてもボタンが動く', f2.calls.prompt === 1, String(f2.calls.prompt));
  check('差し替え後もインストール導線が壊れない', typeof api2.runDiagnostics === 'function');
}

console.log('\n[7] PWA 診断（実API → 画面表示）');
{
  const { win } = await makeEnv(UA.android);
  const diag = await import(`${path.join(ROOT, 'js/pwa/diagnostics.js')}?d=${Math.random()}`);

  const manifestJson = {
    name: 'Shuttle Smash', short_name: 'Shuttle Smash', start_url: '/', display: 'standalone',
    icons: [{ sizes: '192x192' }, { sizes: '512x512' }],
  };
  const fetchOk = async () => ({ ok: true, status: 200, json: async () => manifestJson });
  const fetch404 = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const fetchThrow = async () => { throw new Error('offline'); };
  globalThis.fetch = fetchOk;

  const regs = [{ scope: 'https://example.test/', active: { state: 'activated' } }];
  Object.defineProperty(win.navigator, 'serviceWorker', {
    value: { getRegistrations: async () => regs, controller: {}, addEventListener() {} },
    configurable: true,
  });

  const d = await diag.collectDiagnostics({ promptAvailable: false, installed: false });
  check('Installed ラベル', d.labels.installed === 'Not Installed', d.labels.installed);
  check('beforeinstallprompt ラベル', d.labels.prompt === 'Prompt Missing', d.labels.prompt);
  check('SW は getRegistrations() 経由で Registered',
    d.labels.sw === 'Registered' && d.sw.api === 'getRegistrations', `${d.labels.sw}/${d.sw.api}`);
  check('Manifest ラベル Loaded', d.labels.manifest === 'Loaded', d.labels.manifest);
  check('HTTPS ラベル Secure', d.labels.secure === 'Secure', d.labels.secure);
  check('Display Mode ラベル', ['Browser', 'Standalone'].includes(d.labels.display), d.labels.display);
  check('Raw Data が要件の6キーを持つ',
    ['serviceWorker', 'manifest', 'secure', 'installPrompt', 'installed', 'displayMode'].every((k) => k in d.raw),
    JSON.stringify(d.raw));
  check('Raw Data が実測値（SW/Manifest=true, prompt=false）',
    d.raw.serviceWorker === true && d.raw.manifest === true && d.raw.installPrompt === false && d.raw.installed === false,
    JSON.stringify(d.raw));

  Object.defineProperty(win, 'isSecureContext', { value: false, configurable: true });
  const dInsecure = await diag.collectDiagnostics({ promptAvailable: false });
  check('isSecureContext=false は Not Secure', dInsecure.labels.secure === 'Not Secure', dInsecure.labels.secure);
  Object.defineProperty(win, 'isSecureContext', { value: true, configurable: true });

  const d1 = await diag.collectDiagnostics({ promptAvailable: true, promptSource: 'captured' });
  check('prompt 捕捉時は Available', d1.labels.prompt === 'Prompt Available' && d1.raw.installPrompt === true, d1.labels.prompt);

  const { win: w2 } = await makeEnv(UA.android, { standalone: true });
  const d2 = await diag.collectDiagnostics({ promptAvailable: false, installed: false });
  check('standalone 時は Installed', d2.labels.installed === 'Installed', d2.labels.installed);
  check('standalone 時は Standalone 表示', d2.labels.display === 'Standalone', d2.labels.display);
  check('standalone 時は raw.installed=true', d2.raw.installed === true, String(d2.raw.installed));

  /* ---- 劣化試験: どれか1つが失敗しても "-" を残さない ---- */
  const valuesOf = (w) => [...w.document.querySelectorAll('.diag-row__value')].map((e) => e.textContent);
  const noDash = (vals) => vals.length === 7 && vals.every((v) => v && v !== '-' && v !== 'Checking…');
  const rowOf = (w, id) => w.document.querySelector(`#${id} .diag-row__value`).textContent;

  // (a) Service Worker 非対応（jsdom 既定）
  const envA = await makeEnv(UA.desktop);
  globalThis.fetch = fetchOk;
  await envA.mod.initPWA().runDiagnostics({ show: true });
  check('SW未対応でも全行に値が入る', noDash(valuesOf(envA.win)), valuesOf(envA.win).join(' | '));
  check('SW未対応は Not Registered', rowOf(envA.win, 'diag-sw') === 'Not Registered', rowOf(envA.win, 'diag-sw'));

  // (b) manifest 404
  const envB = await makeEnv(UA.desktop);
  globalThis.fetch = fetch404;
  await envB.mod.initPWA().runDiagnostics({ show: true });
  check('manifest 404 でも全行に値が入る', noDash(valuesOf(envB.win)), valuesOf(envB.win).join(' | '));
  check('manifest 404 は Missing', rowOf(envB.win, 'diag-manifest') === 'Missing', rowOf(envB.win, 'diag-manifest'));

  // (c) fetch 例外（オフライン相当）
  const envC = await makeEnv(UA.desktop);
  globalThis.fetch = fetchThrow;
  await envC.mod.initPWA().runDiagnostics({ show: true });
  check('fetch 例外でも全行に値が入る', noDash(valuesOf(envC.win)), valuesOf(envC.win).join(' | '));

  // (d) 通常時: 行数・ラベル保持・Raw Data JSON
  const { win: w3, mod: mod3 } = await makeEnv(UA.desktop);
  globalThis.fetch = fetchOk;
  const api3 = mod3.initPWA();
  const d3 = await api3.runDiagnostics({ show: true });
  const rows = [...w3.document.querySelectorAll('.diag-row')];
  check('診断行が7件ある（deferredPrompt含む）', rows.length === 7, String(rows.length));
  const labelsKept = rows.every((r) => {
    const l = r.querySelector('.diag-row__label');
    const v = r.querySelector('.diag-row__value');
    return l && l.textContent.trim().length > 0 && v && v.textContent !== '-';
  });
  check('項目名と値の両方が表示される', labelsKept, rows.map((r) => r.textContent.trim()).join(' | '));
  let parsed = null;
  try { parsed = JSON.parse(w3.document.getElementById('diag-raw').textContent); } catch (e) { /* noop */ }
  check('Raw Data が JSON として表示される', !!parsed && typeof parsed.displayMode === 'string',
    String(w3.document.getElementById('diag-raw').textContent).slice(0, 90));
  check('診断パネルが開く', w3.document.getElementById('screen-diagnostics').classList.contains('is-on'));
  check('runDiagnostics が結果を返す', !!d3 && typeof d3.labels.sw === 'string');
}

console.log(`\n結果: ${failures === 0 ? `ALL PASS (${checks} checks)` : `${failures} FAILED / ${checks} checks`}\n`);
process.exit(failures === 0 ? 0 : 1);
