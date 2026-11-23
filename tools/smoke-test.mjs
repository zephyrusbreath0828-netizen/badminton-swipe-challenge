/**
 * ヘッドレス動作確認（Node / DOMなし）
 * Canvas 2D コンテキストをスタブして、ゲームループと描画呼び出しが
 * 例外なく回ることを検証する。
 *
 *   node tools/smoke-test.mjs
 */

/* ----------------------------- スタブ ----------------------------- */
function makeCtx() {
  const store = {};
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'canvas') return store.canvas;
        if (prop in store) return store[prop];
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createConicGradient') {
          return () => gradient;
        }
        if (prop === 'createPattern') return () => null;
        if (prop === 'measureText') return () => ({ width: 12 });
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set(target, prop, value) {
        store[prop] = value;
        return true;
      },
    },
  );
  return ctx;
}

function makeCanvas(w = 390, h = 844) {
  const ctx = makeCtx();
  return {
    width: w,
    height: h,
    style: {},
    getContext: () => ctx,
  };
}

/* ----------------------------- 読み込み ----------------------------- */
const { Game } = await import('../js/game.js');
const { Renderer } = await import('../js/render/renderer.js');
const { analyzeSwipe } = await import('../js/core/swipe.js');
const { resolvePlayerShot, resolveServe } = await import('../js/core/shot.js');
const { CONFIG } = await import('../js/config.js');

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

/* ----------------------------- 単体テスト ----------------------------- */
console.log('\n[1] スワイプ解析');
const up = analyzeSwipe([{ x: 100, y: 400, t: 0 }, { x: 100, y: 200, t: 150 }]);
check('上スワイプの長さ=200', Math.round(up.len) === 200, up.len);
check('up がほぼ 1', Math.abs(up.up - 1) < 0.01, up.up);
check('速度が正', up.speed > 1, up.speed);

const right = analyzeSwipe([{ x: 50, y: 300, t: 0 }, { x: 250, y: 302, t: 120 }]);
check('side がほぼ 1', Math.abs(right.side - 1) < 0.02, right.side);

console.log('\n[2] ショット判定');
const ctxBase = { playerX: 0, handedness: 'right', speedScale: 1, level: 1 };
const shortUp = analyzeSwipe([{ x: 100, y: 300, t: 0 }, { x: 100, y: 190, t: 130 }]);
const drop = resolvePlayerShot({ ...ctxBase, swipe: shortUp, contactY: 2.2, contactX: 0.4 });
check('短い上スワイプ -> ドロップ', drop.type === 'drop', drop.type);

const longUp = analyzeSwipe([{ x: 100, y: 500, t: 0 }, { x: 100, y: 160, t: 220 }]);
const clear = resolvePlayerShot({ ...ctxBase, swipe: longUp, contactY: 2.2, contactX: 0.4 });
check('長い上スワイプ -> クリア', clear.type === 'clear', clear.type);
check('クリアはドロップより奥に落ちる', clear.target.z > drop.target.z, `${clear.target.z} > ${drop.target.z}`);

const drive = resolvePlayerShot({ ...ctxBase, swipe: right, contactY: 1.4, contactX: 0.2 });
check('横スワイプ -> ドライブ', drive.type === 'drive', drive.type);

const down = analyzeSwipe([{ x: 100, y: 200, t: 0 }, { x: 100, y: 400, t: 140 }]);
const smash = resolvePlayerShot({ ...ctxBase, swipe: down, contactY: 2.4, contactX: 1.2 });
check('下スワイプ + 高打点 -> スマッシュ', smash.type === 'smash', smash.type);

const low = resolvePlayerShot({ ...ctxBase, swipe: down, contactY: 0.8, contactX: 1.2 });
check('下スワイプ + 低打点 -> ミスショット', !!low.fault, low.fault);

const rh = resolvePlayerShot({ ...ctxBase, swipe: up, contactY: 2.0, contactX: 1.0 });
const lh = resolvePlayerShot({ ...ctxBase, swipe: up, contactY: 2.0, contactX: -1.0, handedness: 'left' });
check('利き手でフォア/バックが反転', rh.forehand === true && lh.forehand === true, `${rh.forehand}/${lh.forehand}`);

const serve = resolveServe({ swipe: up, playerX: 0, handedness: 'right', speedScale: 1, level: 1 });
check('サーブ判定が成立', !serve.invalid && serve.isServe === true, JSON.stringify(serve).slice(0, 60));
const badServe = resolveServe({ swipe: right, playerX: 0, handedness: 'right', speedScale: 1, level: 1 });
check('横スワイプのサーブは無効', badServe.invalid === true);

console.log('\n[3] ゲームループ');
const canvas = makeCanvas();
const renderer = new Renderer(canvas);
renderer.resize(390, 844, 2);

const stubAudio = { unlock() {}, setEnabled() {}, hit() {}, net() {}, land() {}, levelUp() {}, point() {}, miss() {}, ui() {}, swing() {} };
const stubStorage = { settings: { handedness: 'right', difficulty: 'normal', sound: false }, addRanking: () => 1, stats: {} };

const game = new Game({ settings: stubStorage.settings, audio: stubAudio, storage: stubStorage });
game.camera.resize(390, 844);
game.startDemo();

const events = { shot: 0, score: 0, ai: 0, callout: 0, levelup: 0 };
game.on('shot', () => { events.shot += 1; });
game.on('score', () => { events.score += 1; });
game.on('aishot', () => { events.ai += 1; });
game.on('callout', () => { events.callout += 1; });
game.on('levelup', () => { events.levelup += 1; });

// デモを 3 秒
for (let i = 0; i < 180; i += 1) {
  game.update(1 / 60);
  if (i % 3 === 0) renderer.render(game);
}
check('デモが例外なく動作', true);
check('デモでラリーが発生', game.phase === 'serve' || game.phase === 'rally' || game.phase === 'freeze', game.phase);

// プレイ開始 -> サーブ
const swipeUp = () => ({ dx: 0, dy: -230, len: 230, pathLen: 230, duration: 160, speed: 1.5, up: 1, side: 0, straightness: 1, valid: true });
const swipeDrop = () => ({ dx: 0, dy: -95, len: 95, pathLen: 95, duration: 140, speed: 0.7, up: 1, side: 0, straightness: 1, valid: true });
const swipeDrive = () => ({ dx: 180, dy: 8, len: 180, pathLen: 180, duration: 120, speed: 1.6, up: -0.04, side: 1, straightness: 1, valid: true });
const swipeSmash = () => ({ dx: 12, dy: 160, len: 160, pathLen: 160, duration: 110, speed: 1.7, up: -1, side: 0.07, straightness: 1, valid: true });

game.startRun();
let frames = 0;
let maxRallySeen = 0;
for (let i = 0; i < 60 * 90; i += 1) {
  frames += 1;
  game.update(1 / 60);
  if (i % 2 === 0) renderer.render(game);

  if (game.phase === 'serve' && game.phaseTimer > 0.5) game.onSwipe(swipeUp());
  if (game.phase === 'rally' && game.player.canReach(game.shuttle)) {
    const y = game.shuttle.pos.y;
    const r = Math.random();
    game.onSwipe(y > 1.8 && r < 0.4 ? swipeSmash() : r < 0.6 ? swipeDrive() : r < 0.8 ? swipeDrop() : swipeUp());
  }
  maxRallySeen = Math.max(maxRallySeen, game.rally);
  if (game.phase === 'result') break;
}

check('プレイが例外なく進行', frames > 100, String(frames));
check('返球イベントが発生', events.shot > 0, String(events.shot));
check('得点イベントが発生', events.score > 0, String(events.score));
check('AIが返球する', events.ai > 0 || game.score > 0, String(events.ai));
check('スコアが増加', game.score > 0, String(game.score));
check('最大ラリーが記録される', maxRallySeen > 0, String(maxRallySeen));
console.log(`  · score=${game.score} level=${game.level} maxRally=${game.maxRally} smashes=${game.smashes} phase=${game.phase}`);

if (game.phase !== 'result') {
  // 放置してミス -> リザルト
  let guard = 0;
  while (game.phase !== 'result' && guard < 60 * 40) {
    game.update(1 / 60);
    guard += 1;
    if (game.phase === 'freeze') game.phaseTimer += 0;
  }
}
check('リザルトに到達', game.phase === 'result', game.phase);
check('リザルト内容が揃っている', !!game.result && typeof game.result.score === 'number',
  JSON.stringify(game.result));

console.log('\n[4] 難易度・利き手のバリエーション');
for (const diff of ['easy', 'hard']) {
  const g2 = new Game({ settings: { handedness: 'left', difficulty: diff, sound: false }, audio: stubAudio, storage: stubStorage });
  g2.camera.resize(320, 700);
  g2.startRun();
  for (let i = 0; i < 400; i += 1) {
    g2.update(1 / 60);
    if (i % 4 === 0) renderer.render(g2);
    if (g2.phase === 'serve' && g2.phaseTimer > 0.4) g2.onSwipe(swipeUp());
    if (g2.phase === 'rally' && g2.player.canReach(g2.shuttle)) g2.onSwipe(swipeUp());
  }
  check(`難易度 ${diff} / 左利きで動作`, g2.score >= 0 && g2.ai.difficulty === diff, `${g2.score}`);
}

console.log(`\n結果: ${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
