/**
 * Badminton Swipe Challenge — エントリーポイント
 * レイアウト / 入力 / ゲームループ配線。
 */
import { Game } from './game.js';
import { Renderer } from './render/renderer.js';
import { AudioManager } from './core/audio.js';
import { Storage } from './core/storage.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { analyzeSwipe, simplifySamples } from './core/swipe.js';

const app = document.getElementById('app');
const canvas = document.getElementById('stage');

const renderer = new Renderer(canvas);
const audio = new AudioManager();
const storage = new Storage();
const game = new Game({ settings: storage.settings, audio, storage });
const hud = new Hud(game, storage);
const screens = new Screens({ game, storage, audio, hud });

audio.setEnabled(storage.settings.sound);
game.setSettings(storage.settings);

/* ------------------------------------------------------------------ */
/* レイアウト                                                          */
/* ------------------------------------------------------------------ */
let rect = { left: 0, top: 0, width: 0, height: 0 };

function layout() {
  const r = app.getBoundingClientRect();
  rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.resize(r.width, r.height, dpr);
  game.camera.resize(r.width, r.height);
}

window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 120));
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', layout);
}
layout();

/* ------------------------------------------------------------------ */
/* スワイプ入力                                                        */
/* ------------------------------------------------------------------ */
let swipe = null;

function localPoint(e) {
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    t: performance.now(),
  };
}

function isInteractive(target) {
  return !!(target && target.closest && target.closest('button, a, input, .no-swipe'));
}

app.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (isInteractive(e.target)) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  swipe = { id: e.pointerId, samples: [localPoint(e)] };
  game.clearTrail();
  game.pushTrail(swipe.samples[0]);
  try { app.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
}, { passive: true });

app.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const p = localPoint(e);
  const last = swipe.samples[swipe.samples.length - 1];
  // 間引き（1px未満は無視）
  if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return;
  swipe.samples.push(p);
  if (swipe.samples.length > 60) swipe.samples.shift();
  game.pushTrail(p);
}, { passive: true });

function endSwipe(e) {
  if (!swipe || (e && e.pointerId !== swipe.id)) return;
  const samples = simplifySamples(swipe.samples, 30);
  const analysis = analyzeSwipe(samples);
  swipe = null;
  game.onSwipe(analysis);
  setTimeout(() => game.clearTrail(), 90);
}

app.addEventListener('pointerup', endSwipe, { passive: true });
app.addEventListener('pointercancel', () => { swipe = null; game.clearTrail(); }, { passive: true });
app.addEventListener('contextmenu', (e) => e.preventDefault());

/* キーボード操作（PC確認用） */
const KEY_MAP = {
  ArrowUp: { dx: 0, dy: -210 },
  ArrowDown: { dx: 0, dy: 165 },
  ArrowLeft: { dx: -185, dy: 6 },
  ArrowRight: { dx: 185, dy: 6 },
};
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (game.paused) game.resume();
    else game.pause();
    return;
  }
  const v = KEY_MAP[e.key];
  if (!v) return;
  e.preventDefault();
  audio.unlock();
  const dx = e.shiftKey ? v.dx * 0.5 : v.dx;
  const dy = e.shiftKey ? v.dy * 0.5 : v.dy;
  const len = Math.hypot(dx, dy);
  game.onSwipe({
    dx, dy, len, pathLen: len, duration: 120,
    speed: len / 120, up: -dy / len, side: dx / len,
    straightness: 1, valid: true,
  });
});

/* ------------------------------------------------------------------ */
/* ループ                                                              */
/* ------------------------------------------------------------------ */
let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  game.update(dt);
  renderer.render(game);
  hud.update(dt);

  requestAnimationFrame(frame);
}

game.startDemo();
screens.show('home');

// 動作確認用: ?autostart=1 で即プレイ / ?state=result でリザルト表示
const params = new URLSearchParams(location.search);
if (params.has('autostart')) {
  storage.setSetting('seenTutorial', true);
  screens.hideAll();
  game.startRun();
} else if (params.get('state') === 'result') {
  screens.showResult({ score: 2480, maxRally: 17, smashes: 9, level: 25, returns: 61, winners: 3 });
}

// PWA
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* オフライン非対応でも続行 */ });
  });
}

requestAnimationFrame(frame);

// デバッグ用（開発時のみ）
window.__BSC__ = { game, renderer, screens, storage, audio };
