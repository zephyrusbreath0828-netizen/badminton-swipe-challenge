# 🏸 Shuttle Smash

スワイプで打ち分けるスマートフォン向けバドミントンゲーム。
v1.2.0 で **キャラクター育成システム**を追加し、v1.2.1 で PWA インストール不具合の真因を修正。v1.2.2 で PWA診断が全項目「-」になる不具合を修正。v1.2.3 で `deferredPrompt` の保持を修正。v1.2.4 で **設定画面のインストールボタンが無反応になる不具合**を修正しました。

- バージョン: **v1.3.0**
- 技術: HTML / CSS / JavaScript（フレームワーク・ビルド不要）
- 対応: モバイルファースト / PWA（インストール・オフライン・スタンドアロン） / データセーブ
- 公開: GitHub Pages・Vercel にそのままデプロイ可能

---

## 目次

1. [v1.2.1 の変更点（不具合修正）](#v121-の変更点不具合修正)
2. [v1.2.0 の変更点](#v120-の変更点)
2. [PWAインストール（修正内容）](#pwaインストール修正内容)
3. [キャラクター育成](#キャラクター育成)
4. [クイックスタート](#クイックスタート)
5. [操作方法](#操作方法)
6. [ショット一覧](#ショット一覧)
7. [ゲームシステム](#ゲームシステム)
8. [ディレクトリ構成](#ディレクトリ構成)
9. [データセーブ](#データセーブ)
10. [デプロイ](#デプロイ)
11. [検証（テスト）](#検証テスト)
12. [バランス調整](#バランス調整)
13. [ロードマップ](#ロードマップ)
14. [既知の制約](#既知の制約)
15. [ライセンス](#ライセンス)

---

## v1.2.0 の変更点

### 新機能

| 種別 | ファイル | 内容 |
| --- | --- | --- |
| 追加 | `js/core/profile.js` | プレイヤーレベル / 経験値 / 育成ポイント / 4能力の純ロジック |
| 追加 | `js/core/training.js` | 育成値 → ゲーム内倍率への変換、ラリー疲労の計算 |
| 追加 | `css/training.css` | ホームメニュー・育成画面・リザルト報酬・インストールダイアログ |
| 追加 | `tools/dom-test.mjs` | jsdom によるインストール導線 / 育成ロジックの自動検証 |
| 追加 | 練習モード（Training） | スコア・報酬なしでラリーを続けられるフリープレイ |
| 追加 | リザルト報酬表示 | ポイント内訳・EXP・レベルアップ演出 |
| 変更 | `index.html` | ホーム4導線（Play / Training / Character / Settings）、育成画面、報酬UI、インストールダイアログ |
| 変更 | `js/ui/screens.js` | 画面遷移・育成画面の描画・報酬付与 |
| 変更 | `js/game.js` | 育成倍率の適用、練習モード、スマッシュのスコア倍率、勝利判定 |
| 変更 | `js/core/shot.js` / `player.js` | 精度・スピード・スマッシュ威力・疲労の補正を受け取る |
| 変更 | `js/core/storage.js` | 育成データの永続化（既存の設定・ランキングと同居） |

### 不具合修正

設定画面の「アプリをインストール」ボタンが反応しない問題を修正しました（[詳細](#pwaインストール修正内容)）。

> **ゲームのコア（ラリー進行・ショット判定・AI・スコア計算）は維持**し、
> 育成値は「倍率」として最後に掛けるだけの構造にしています（育成50 = 従来と完全に同一挙動）。

---

## PWAインストール（修正内容）

### 原因

`beforeinstallprompt` はページ読み込みのごく早い段階で発火することがあり、
モジュールスクリプト（`js/main.js`）の実行が間に合わないと**イベントを取りこぼして**
`deferredPrompt` が空のままになっていました。その状態でボタンを押しても
「プロンプトを出せない」判定になり、ユーザーには無反応に見えていました。

### 修正

1. **`index.html` の `<head>` で最速捕捉**
   インラインスクリプトで `beforeinstallprompt` を受け取り、`window.__installPrompt` に保持。
   同時に `ss:installprompt` カスタムイベントを発火します。
2. **判定ロジックを純モジュールへ分離**（`js/pwa/installer.js`）
   `capturePrompt()` / `prompt()` / `userChoice` / インストール済み判定をテスト可能な形で実装。
3. **ボタン押下時の標準フロー**

   ```js
   if (installer.canPrompt) {
     const res = await installer.prompt();      // → ev.prompt() → ev.userChoice
     if (res.outcome === 'accepted') markInstalled();   // ボタンを隠す
     if (res.outcome === 'dismissed') openGuide();      // 手順を案内
   } else {
     openGuide();                                        // iOS / プロンプト不可
   }
   ```

4. **インストール済みの表示**
   ラベルが `アプリインストール済み` になり、ボタンは無効化（実質非表示）されます。
   判定は `display-mode: standalone` / `navigator.standalone` / 保存済みフラグの3系統。
5. **iPhone 向け手順ダイアログ**

   ```
   iPhoneをご利用の場合
     1. 共有ボタンをタップ
     2. 「ホーム画面に追加」を選択
     3. 「追加」をタップしてインストール
   ```
6. **Android Chrome** では `prompt()` によるネイティブのインストールダイアログを表示。

### 動作の流れ

| 環境 | ボタン表示 | 押下時の動作 |
| --- | --- | --- |
| Android Chrome（インストール可能） | アプリをインストール | OS標準のインストールダイアログ |
| Android Chrome（プロンプト不可・閉じた後） | インストール方法を見る | 手順ダイアログ（⋮ → アプリをインストール） |
| iPhone / iPad Safari | ホーム画面に追加 | 手順ダイアログ（共有 → ホーム画面に追加 → 追加） |
| すでにインストール済み | **アプリインストール済み**（ボタン非表示） | 押しても通知のみ |


---

## v1.3.0 の変更点（アバターシステム）

Character 画面を **Avatar Editor** に進化させ、3Dアニメ風のプレイヤーアバターを導入しました。既存機能（Play / Training / Settings / PWA / 育成 / localStorage）はすべて維持しています。

### 画面構成（スマホ縦・上から順）

| セクション | 内容 |
|---|---|
| AVATAR | ヘッダー（Lv / 名前 / EXP / ポイントを重ねて表示） |
| 3Dプレビュー | Canvas 2D の擬似3D。**指ドラッグで360°回転** |
| ポーズ | Idle / Walk / Forehand / Backhand / Smash |
| プレイヤー名 | 自由入力（1〜12文字、`sanitizeName` で無害化） |
| 顔 / 髪型 / 髪色 | `◀ ▶` で循環選択 |
| 利き手 | 右 / 左（既存 `settings.handedness` と同期） |
| 身長 | スライダー 160〜200cm |
| 体格 | Slim / Normal / Power |
| 能力プレビュー | 補正込みの Speed / Stamina / Accuracy / Smash（±差分表示） |
| 能力強化 | 既存の＋ボタン（1pt 消費）を維持 |
| 保存 / 戻る | `保存` で localStorage へ、`ホームに戻る` でホームへ |

### 育成システム連携（能力補正）

| 設定 | 効果 |
|---|---|
| Slim | Speed +10 / Smash -5 |
| Normal | 補正なし |
| Power | Speed -5 / Smash +10 |
| 180cm 以上 | 打点（リーチ）+5% |
| 170cm 未満 | 移動速度（Speed）+3 |

補正は `avatarAdjustedStats()` で 0..100 にクランプしたうえで `deriveAbilities()` に渡し、**ゲーム内の移動速度・リーチ・球速・スコア倍率に反映**されます（`screens.applyAbilities()`）。

### アバターの描画

- `js/core/avatar.js` — 設定の正規化・循環選択・補正計算（DOM 非依存）
- `js/render/avatar3d.js` — アニメ風の擬似3D描画（yaw 回転・髪型5種・顔5種・髪色5種・体格・身長）
- ゲーム内の選手も `renderer.setAvatar()` で **髪色・体格・身長・利き手** を反映

### 保存データ

`localStorage` の `bsc.v1`.profile.avatar に保存：

```json
{ "playerName": "Tomotaka", "faceType": "Face03", "hairStyle": "Ponytail",
  "hairColor": "Blue", "handedness": "left", "height": 186, "bodyType": "Power" }
```

### 品質確認

- Character ボタン → Avatar Editor へ遷移（Debug パネルでも `Connected` を確認可能）
- 保存 → 再起動しても設定が復元される
- Play 開始時にアバター設定（体格・身長・利己手・髪色）が反映される
- 既存の Play / Training / 設定 / PWA診断 / 育成は無変更で動作

## v1.2.10 の変更点

### ① シャトルの姿勢（コルクが進行方向を向く）

**原因**: ローカル座標は「コルク＝原点(0,0) / フェザー＝-Y 方向」で描かれていましたが、描画時に `ang + Math.PI/2` 回転していたため、**フェザーが進行方向・コルクが後方**を向いていました（180° 逆）。

**修正**（`js/render/renderer.js`）

```js
// 3D の速度ベクトルをスクリーン座標へ投影し、進行方向の角度を求める
const a = cam.project(s.pos.x, s.pos.y, s.pos.z);
const b = cam.project(s.pos.x + v.x * 0.04, s.pos.y + v.y * 0.04, s.pos.z + v.z * 0.04);
const ang = Math.atan2(b.y - a.y, b.x - a.x);   // atan2(velocityY, velocityX)

ctx.rotate(ang - Math.PI / 2);                  // コルクを前へ / フェザーを後方へ
```

- サービス / クリア / ドロップ / ドライブ / スマッシュ / 跳ね返り後 の**全ショット共通**（描画は1か所）
- 頂点付近で速度がほぼ 0 になる瞬間は直前の角度を保持し、ちらつきを防止
- ホールド時は角度をリセット

### ② レベルアップ表示を画面上部へ

**原因**: `.level-banner` が `top: 46%` / `translate(-50%,-50%)` の**画面中央**にあり、シャトルと打点を隠していました。

**修正**（`css/hud.css` / `js/ui/hud.js`）

| 項目 | 変更後 |
|---|---|
| 位置 | `top: calc(env(safe-area-inset-top) + 62px)` の上部固定 |
| 見た目 | 半透明（`rgba(8,30,42,0.55)`）＋ `backdrop-filter: blur(9px)` のピル型 |
| 文言 | `Lv.5 にレベルアップ！` ＋ 小さく `LEVEL UP` |
| 表示時間 | 1.5 秒（`@keyframes levelBannerTop` で自動フェードアウト） |
| 操作 | `pointer-events: none`（プレイを止めない・モーダルにしない） |

中央表示・モーダル・ポーズは廃止。リザルト画面のレベルアップ演出も同じ上部バナーを 1.5 秒で使います。

## v1.2.9 実装状況レポート（Training / Character）

### 調査方法

1. `index.html` の DOM 構造・要素ID を静的確認
2. `js/ui/screens.js` の `bind()` を静的確認（リスナー登録・実行関数）
3. **配布 ZIP をそのまま実 Chromium（HTTPS 配信 / 420px）で起動**し、各ボタンを順にクリックして `screens.current` と `.is-active` を実測

### Training

| # | 調査項目 | 結果 |
|---|---|---|
| 1 | 画面が存在するか | **YES**（`#screen-training` / `.screen.screen--panel`） |
| 2 | HTML要素ID | 画面 `screen-training`、開始 `btn-training-start`、戻る `btn-training-back`、ホーム導線 `btn-training`、カウンタ `training-counter` / `training-rally-now` |
| 3 | JavaScriptファイル名 | `js/ui/screens.js`（配線・描画）、`js/game.js`（`startTraining()` / 練習中の再開処理） |
| 4 | イベントリスナー登録有無 | **あり** — `click` / `pointerup`(touch) / `touchend` の3経路 ＋ document 委譲（捕捉） |
| 5 | クリック時実行関数 | `this.show('training')` → `renderTraining()`。開始ボタンは `this.startTraining()` |
| 6 | 遷移先画面名 | `training`（`data-screen="training"`） |
| 7 | ボタン押下ログ | **あり** `console.log('Training button clicked')` |

### Character

| # | 調査項目 | 結果 |
|---|---|---|
| 1 | 画面が存在するか | **YES**（`#screen-character`） |
| 2 | HTML要素ID | 画面 `screen-character`、戻る `btn-character-back`、ホーム導線 `btn-character`、能力リスト `stat-list`、Lv `char-level`、EXP `char-exp-text`、ポイント `char-points` |
| 3 | JavaScriptファイル名 | `js/ui/screens.js`（`renderCharacter()` / `upgrade()`）、`js/core/profile.js`（`PlayerProfile` / `PROFILE_CONFIG` / `STAT_META`）、`js/core/storage.js`（`saveProfile`） |
| 4 | イベントリスナー登録有無 | **あり** — `click` / `pointerup` / `touchend` ＋ document 委譲（捕捉） |
| 5 | クリック時実行関数 | `this.show('character')` → `renderCharacter()`。＋は `this.upgrade(key)`（`profile.upgrade` → `storage.saveProfile`） |
| 6 | 遷移先画面名 | `character`（`data-screen="character"`） |
| 7 | ボタン押下ログ | **あり** `console.log('Character button clicked')` |

### 実測結果（配布 ZIP / 実 Chromium）

```
click btn-training  → current=training   active: screen-training:ON
click btn-character → current=character  active: screen-character:ON
```

**コード上の欠落は無し。** 画面・ID・リスナー・遷移・ログのすべてが実装済みで、ヘッドレス Chromium 上では両方とも遷移します。したがって実機で反応しない場合は、コードではなく次のいずれかです。

| 候補 | 見分け方 |
|---|---|
| **A. 古い Service Worker キャッシュ**（インストール済みアプリが旧 JS を実行） | 起動ログの `Build 1.2.9 / SW service-worker.js` と、ホームの `SPORTS ARCADE — v1.2.9` の一致を確認。Debug パネルの `build:` / `sw:` 行でも判別可 |
| **B. 入力経路の抑止**（`pointerdown` 後の `setPointerCapture` / スクロール判定で `click` が落ちる） | Debug パネルの `last:` 行が `none` のままなら JS にタップが届いていない。`btn-training (touchend)` 等が出れば届いている |

### 追加した計測器（v1.2.9）

- **ホーム右下「Debug」ボタン** → 4ボタンの `Connected` / `Missing`、`build`、`sw`、最後に受けた入力（`last`）を表示
- 押下ログを4ボタンすべてに追加（`Play/Training/Character/Settings button clicked`）
- `Build <version> / SW <script>` を起動時に出力
- document 捕捉フェーズへの委譲を追加（要素側のリスナーが効かない環境でも発火）
- ハンドラ内例外を `console.error('[tap] handler failed: ...')` として出力

## v1.2.8 の変更点（Training / Character が反応しない）

### 原因

ホームの4導線は `click` だけで配線されていました。実機（タッチ）では

- `pointerdown` の後に `app.setPointerCapture()` が走る
- 指がわずかに動くとスクロール判定になる

のいずれかで **`click` が発火しない**ことがあり、ハンドラに到達しませんでした。Play / Settings が動いて見えたのは、押下位置や指の動きの差でたまたま `click` が成立していたためです。

### 修正

- ホーム導線を **`click` + `pointerup`（touch）+ `touchend`** の3経路で受ける（`screens.js` の `act()`）
- 400ms のガードで二重発火を防止
- ボタンに `touch-action: manipulation`（ダブルタップズーム・スクロール判定の抑止）
- ハンドラ内の例外を `console.error` で握りつぶさず出力

### Training 画面（新規）

- **Practice Rally** モード（AIは弱いショットのみ返球／ミスしてもゲームオーバーなし）
- Best Rally / Plays を表示
- プレイ中は右上に **RALLY カウンタ**（`game.on('rally')` の実測値）
- 「ホームに戻る」でホームへ。終了は HUD の「トレーニングを終了」

### Character 画面

- Player Level / Experience / Available Points
- Speed / Stamina / Shot Accuracy / Smash Power（日本語＋英語表記）
- 各能力の「＋」で 能力+1・ポイント-1 → `localStorage`（`bsc.v1`.profile）へ即保存

### コンソール

`Training initialized` / `Character initialized`（起動時）、`Training button clicked` / `Character button clicked`（押下時）

## v1.2.7 の変更点（デバッグ機能を一般ユーザーから隠す）

PWA診断は開発者向け機能のため、設定画面から通常表示を外しました。**アプリタイトル（Shuttle Smash のロゴ）を5回連続タップ**した時だけ「開発者メニュー」が現れます。

- 通常ユーザーのホームは **Play / Character / Training / Settings** のみ
- 設定画面に PWA診断の行は出ない（開発者メニュー内に移動）
- 5回タップ（各タップ間隔 1.5 秒以内）で解放。`localStorage` の `shuttleSmash.dev` に記憶
- 開発者メニュー内の「開発者モードを無効化」でいつでも元に戻せる
- タイトルは `.no-swipe` なので、タップがスワイプ入力として扱われない

```js
// index.html（インライン / モジュール非依存）
var DEV_KEY = 'shuttleSmash.dev';
var DEV_TAP_GAP = 1500;
// タイトルを5回タップ → dev-section を表示
```

## v1.2.5 の変更点（診断が「-」のまま／インストール済み表示）

### 原因

診断の描画が `install.js`（ESモジュール）に依存していたため、**モジュールが古いキャッシュから配信される / 例外で止まる**と、HTML に書かれた初期値 `-` がそのまま残りました。スタンドアロン起動では特に、インストール時点の service worker キャッシュが効きやすい経路です。

### 修正

診断エンジンを **`index.html` 内のインラインスクリプト**へ移設しました。

- ESモジュール非依存（`import` なし・`install.js` が落ちても動く）
- **起動直後に実測値を描画**（パネルを開く前から `-` が消える）
- 同期値（Installed / Display Mode / HTTPS / beforeinstallprompt）は `await` を待たず即時反映
- Service Worker / Manifest は独立した Promise で取得（片方が失敗しても他は表示）
- パネルが開いたことを `MutationObserver` で監視し、未描画なら自動で再測定
- 初期HTMLの `-` を廃止（`…` → 起動時に実測値へ置換）

### インストール済み環境の表示

| 項目 | 表示 |
|---|---|
| インストール状態 | `Installed`（`matchMedia(display-mode: standalone)` / `navigator.standalone`） |
| Display Mode | `Standalone` |
| beforeinstallprompt | `Unavailable (Installed)`（インストール済みでは発行されないのが正常） |
| deferredPrompt | `null (installed)` |

未インストール時は従来どおり `Prompt Available` / `Prompt Missing`。`Raw Data` には `installed` / `displayMode` / `deferredPrompt` / `promptReceived` などの実測値をそのまま出力します。

## v1.2.4 の変更点（インストールボタンが無反応）

### 原因

v1.2.3 のボタンは、`beforeinstallprompt` をまだ保持できていない瞬間に **`disabled` にしていた**。disabled な `<button>` は **click イベントを発火しない**ため、押しても

- ハンドラに到達しない
- `console.log('Install Button Clicked')` も出ない
- 何も起きない

という「無反応」になる。コンソールから `window.deferredPrompt.prompt()` を直接叩くと動くのは、イベント自体は正常に保持できていた証拠。

### 修正

- **ボタンを disabled にしない**（`data-state` と `aria-disabled` で見た目だけ変える）。これで押下が必ずハンドラに届く
- ハンドラは **`document` の捕捉フェーズへ委譲**（`#btn-install-app, .install-row`）。ノード差し替え・`stopPropagation` の影響を受けない
- 押下時は `window.deferredPrompt` を直接使う（installer 側の保持状態に依存しない）

```javascript
console.log('Install Button Clicked');

if (!window.deferredPrompt) {
  alert('インストール準備ができていません');
  return;
}

console.log('Prompt Executed');
await window.deferredPrompt.prompt();
const result = await window.deferredPrompt.userChoice;
console.log(result);   // { outcome: 'accepted' | 'dismissed' }
```

`prompt()` は 1 イベント 1 回なので、`userChoice` 取得後に `window.deferredPrompt = null` へ解放します。

### 診断

| 行 | 実測値 |
|---|---|
| beforeinstallprompt | `Prompt Available` / `Prompt Missing` |
| deferredPrompt | `Available (held)` / `Used (consumed)` / `null` |
| Service Worker | `Registered` / `Not Registered`（`getRegistrations()`） |
| Manifest | `Loaded` / `Missing`（`link[rel=manifest]` の存在＋fetch） |
| HTTPS | `Secure` / `Not Secure`（`isSecureContext`） |
| Display Mode | `Standalone` / `Browser`（`matchMedia`） |

## v1.2.3 の変更点（deferredPrompt の保持）

### 原因

`beforeinstallprompt` は発火していたが、**イベントオブジェクトをアプリ全体で共有する変数に保持していなかった**ため、ボタン押下時に `prompt()` を呼べませんでした。Chrome の

```
Banner not shown: beforeinstallpromptevent.preventDefault() called.
The page must call beforeinstallpromptevent.prompt()
```

は「`preventDefault()` したのに `prompt()` が呼ばれていない」という警告で、まさにこの状態を示しています。

### 修正

`index.html` の `<head>`（モジュール実行より前）で、唯一の保持場所を用意します。

```javascript
window.deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // Chrome 既定バナーを止め、自前UIで制御する
  window.deferredPrompt = e;   // ← アプリ全体で共有（console からも確認可能）
  window.__promptState.received += 1;
  console.log('Install prompt available');
});
```

`install.js` はこの変数だけを読み書きします（二重保持しない）。

- ボタン押下時、`window.deferredPrompt` が無ければ `alert('インストール準備ができていません')` を出して終了
- あれば `await deferredPrompt.prompt()` → `await deferredPrompt.userChoice` → `console.log(result)`
- `prompt()` は **1イベントにつき1回**なので、実行後は参照を `null` に解放（`__promptState.consumed = true`）
- `accepted` ならインストール済み表示、`dismissed` なら手順ダイアログ

### 診断画面

| 行 | 内容 |
|---|---|
| beforeinstallprompt | `Prompt Available` / `Prompt Missing`（`window.deferredPrompt` の実体で判定） |
| deferredPrompt | `Available (held)` / `Used (consumed)` / `null` |
| 詳細 | `window.deferredPrompt` の状態、`prompt()` 関数の有無、受信回数 |

`Raw Data` にも `deferredPrompt` / `promptReceived` / `promptConsumed` を出力します。

> `beforeinstallprompt` が発火しても `deferredPrompt` が null のままなら、診断は `Prompt Missing` ではなく理由リストに「発火したが保持されていない」と表示します（取りこぼしの検出用）。

## v1.2.2 の変更点（診断の全面作り直し）

v1.2.1 の診断は、`await` を1本の直列処理で並べていたため、**どこか1つのブラウザAPIが失敗/未解決になると 5 項目すべてが「-」のまま**残る構造でした。v1.2.2 ではこの構造自体を廃止しています。

- 各項目を**独立に try/catch** で評価（`Promise.allSettled` 相当）。1項目の失敗が他項目を巻き込まない
- 取得できた項目から**順次描画**（`onPartial`）。全項目が出そろう前に画面が真っ白にならない
- 例外が出ても値を `Error` として表示し、**必ず `Raw Data`（JSON）を出す**ので原因が画面で分かる
- 押下直後に「-」を `Checking…` へ置換（取得中であることが見える）

### 実際に叩いているブラウザAPI

| 項目 | 取得方法 | 表示 |
|---|---|---|
| Service Worker | `navigator.serviceWorker.getRegistrations()`（旧ブラウザは `getRegistration()` にフォールバック、3秒タイムアウト） | `Registered` / `Not Registered` |
| Manifest | `document.querySelector('link[rel="manifest"]')` の存在確認 ＋ `fetch(href)` で中身を検証 | `Loaded` / `Missing` |
| HTTPS | `window.isSecureContext` | `Secure` / `Not Secure` |
| Display Mode | `window.matchMedia('(display-mode: standalone)')` | `Standalone` / `Browser` |
| beforeinstallprompt | 捕捉済みイベントの有無 | `Available` / `Not Available` |
| インストール状態 | `matchMedia('(display-mode: standalone)').matches` または `navigator.standalone` | `Installed` / `Not Installed` |

### Raw Data

診断モーダル最下部に、実測値をそのまま JSON で表示します。

```json
{
  "serviceWorker": true,
  "manifest": true,
  "secure": true,
  "installPrompt": false,
  "installed": false,
  "displayMode": "browser"
}
```

`details` には scope / SW state / manifest の start_url / icons 数 / エラー内容 / UA なども入ります。

### コンソール

- 起動時: `PWA Diagnostics`
- 診断時: `console.log(diagnostics)`（診断オブジェクト全体）＋ `PWA Diagnostics Result`（Raw Data）

> 注: `file://` で直接開いた場合や、プレビュー生成時に `<link rel="manifest">` が除去される環境では、`Manifest: Missing` / `Secure: Not Secure` / `SW: Not Registered` になります。これは**実測どおりの正しい結果**です。HTTPS 配信（Vercel / GitHub Pages）で確認してください。

## v1.2.1 の変更点（不具合修正）

### 真因

**設定画面のインストールボタンが無反応だった原因は、PWA の実装ではなく
`js/main.js` の初期化順序の欠陥**でした。

```
TypeError: Cannot read properties of undefined (reading 'level')
  at Screens.syncHomeProfile (js/ui/screens.js)
  at new Screens (js/ui/screens.js)
  at js/main.js
```

v1.2.0 で `Screens` に `profile`（育成データ）を渡す設計に変更した際、
`main.js` 側で `PlayerProfile` の生成と受け渡しが漏れていました。
その結果 `new Screens(...)` のコンストラクタで例外が発生し、
**`main.js` のモジュール実行がその場で停止**。
以降の行にある `initPWA()` / `registerServiceWorker()` / ゲームループがすべて未実行になっていました。

そのため:

- CSS の hover / active 演出は動く（CSSは独立）
- ボタンの見た目は正常
- しかし click ハンドラが一度も登録されていない（＝`initPWA()` 未実行）
- ダイアログもエラーも出ない（JSが死んでいるため）

という、報告どおりの症状になっていました。

### 修正内容

| 項目 | 内容 |
| --- | --- |
| 真因修正 | `main.js` で `PlayerProfile` を生成し `Screens` へ渡す。初期化後に `screens.applyAbilities()` を実行 |
| 再発防止 | `tools/dom-test.mjs` を拡張し、**index.html を jsdom で起動して main.js を実行**、`window.__BSC__` が生成されること（＝モジュールが最後まで走ること）を検証 |
| 診断機能 | 「PWA診断」を追加。Manifest / SW / Install / Display Mode / beforeinstallprompt を**実測値**で表示 |
| ボタン制御 | `beforeinstallprompt` 取得時のみ「アプリをインストール」。未取得時は「**インストール利用不可**」で無効化し、要件不足の理由を画面に表示 |
| ログ | `PWA Init` / `Manifest Loaded` / `SW Registered` / `Install Prompt Ready` / `Install Button Clicked` / `Prompt Executed` / `userChoice` |
| 入力競合 | バナー・パネル・ダイアログ上でスワイプ用の `setPointerCapture` が走らないよう除外を追加 |

### PWA診断で表示される項目

| 項目 | 表示 |
| --- | --- |
| インストール状態 | `Installed` / `Not Installed` |
| beforeinstallprompt | `Available` / `Not Available` |
| Service Worker | `Registered` / `Not Registered`（scope・state・制御状態も表示） |
| Manifest | `Loaded` / `Not Loaded`（name・icon数・start_url も表示） |
| Display Mode | `Browser` / `Standalone` |
| 判定 | 実際に当てはまる阻害要因を列挙 |

設定画面 →「PWA診断」、または `?diag=1` 相当として `window.__installer.runDiagnostics()` からも実行できます。

---

## PWAが利用できない原因一覧

インストールできないときは、まず**設定 → PWA診断**を開いてください。
以下は診断で `Not Available` / `Not Registered` / `Not Loaded` になった場合の主な原因です。

### 1. HTTPS で配信されていない

- Service Worker は `https://` または `localhost` でのみ動作します。
- `http://192.168.x.x:3000` のような**LAN内IPでは絶対に動きません**（診断: SW `Not Registered`）。
- Vercel / GitHub Pages / Netlify は標準で HTTPS なので問題ありません。

### 2. Service Worker が未登録・未制御

- 初回訪問直後は登録処理中で、**リロードするまで `controller` が付かない**ことがあります。
- `service-worker.js` のパス誤り、`scope` 外への配置、登録時の例外（診断にエラー文字列が出ます）。
- 開発中に SW を変更した場合、旧 SW が残って更新されないことがあります → DevTools → Application → Service Workers → **Update / Unregister**。

### 3. Manifest が読めていない・内容不備

- `manifest.json` への 404、`Content-Type` が `application/json` 以外（Vercel 用に `vercel.json` で `application/manifest+json` を設定済み）。
- `name` / `short_name` / `start_url` / `display` / **192×192 と 512×512 のアイコン**が欠けている。
- `start_url` が現在のスコープ外（例: `/repo/` 配信なのに `start_url: "/"`）。

### 4. ブラウザが未対応 / インストール条件を満たしていない

- **iPhone / iPad の Safari は `beforeinstallprompt` を実装していません**（仕様）。共有メニューから手動追加のみ。
- Firefox・iOS 上の Chrome など、Chromium 系以外はプロンプト非対応。
- 一度インストールダイアログを**閉じた（dismissed）**場合、同じページ読み込みでは再発火しません（リロードで復帰）。
- すでにインストール済み、または同一オリジンで別途インストール済み。

### 5. その他

- シークレットモード / プライベートブラウズではインストールできません。
- 企業ポリシーや管理されたブラウザでインストールが無効化されている。
- ストレージが満杯、またはサイトデータがブロックされている。

> 診断画面の「判定」欄には、上記のうち**実際に該当したものだけ**が表示されます。

---

## キャラクター育成

### 4つの能力

| 能力 | 初期 | 最大 | 効果（最大時の値） |
| --- | --- | --- | --- |
| **スピード** | 50 | 100 | 移動速度 **1.5倍**、打点リーチ +12%、自動追尾の到達率向上 |
| **スタミナ** | 50 | 100 | 長ラリー時の能力低下をほぼ無効化、獲得EXP **+25%** |
| **ショット精度** | 50 | 100 | コース誤差 **50%減**、ミスショット・アウト減少 |
| **スマッシュ威力** | 50 | 100 | 球速 **1.3倍**、スコア倍率 **1.5倍** |

育成値 50 は「等倍」です。つまり **育成を一切しなくても従来（v1.0系）と同じ挙動**になります。

### 報酬（試合終了時）

| 項目 | ポイント |
| --- | --- |
| 試合参加 | 10 |
| 最大ラリー | × 1（例: 15ラリー → 15pt） |
| 成功スマッシュ | × 2（例: 4本 → 8pt） |
| 勝利 | 20 |

**勝利条件**: 1試合でウィナー（AIが返せない球）を **3本以上** 記録すること。
（設定ファイル `CONFIG.training.winWinners` で変更可能）

### レベルと経験値

- プレイヤーレベル: **1 → 50**
- 次のレベルに必要な経験値: `40 + (現在レベル - 1) × 20`
  （Lv1→2: 40 / Lv2→3: 60 / … / Lv49→50: 1000）
- 獲得EXP = 獲得ポイント ×（1 + スタミナボーナス）
- レベルアップごとに **育成ポイント +5**、エフェクトと効果音が再生されます

### 強化方法

ホーム → **Character** → 各能力の **＋** ボタンで `1ポイント消費 / 能力 +1`。
上限（100）に達した能力は `MAX` 表示になり、ボタンが無効化されます。

---

## クイックスタート

```bash
python3 -m http.server 3000    # または npm run dev
```

`http://localhost:3000` を開きます（ES Modules / Service Worker のため `file://` 不可）。

| URL | 内容 |
| --- | --- |
| `/?autostart=1` | チュートリアルを飛ばして即プレイ（PWAショートカット） |
| `/?state=result` | リザルト画面の見た目確認（ダミーデータ） |

**キーボード操作（PC確認用）**: `↑` クリア / `Shift`+`↑` ドロップ / `→` `←` ドライブ / `↓` スマッシュ / `Esc` ポーズ

---

## 操作方法

- **移動**: 完全自動。地面の黄色いリングが落下予測地点。
- **スイング**: 画面のどこでもスワイプ。指を離した瞬間に確定。

```
  ↑ 短い → ドロップ      ↑ 長い → クリア
  ← → 横 → ドライブ       ↓ → スマッシュ（打点1.32m以上）
```

- **サービス**: 上方向スワイプ。短い=ショート / 長い=ロング / 速い=フリック。
- **打点**: リーチ範囲外は空振り（0.34秒硬直）。低い打点での下スワイプはミスショット。
- **利き手**: 右/左でフォア・バックが反転（設定画面で変更）。バックは威力84%・精度68%。

---

## ショット一覧

| ショット | 条件 | 軌道 | 得点 |
| --- | --- | --- | --- |
| ドロップ | 短い上スワイプ（132px未満） | 山なり・ネット際 | 10 |
| クリア | 長い上スワイプ（132px以上） | 高く深い | 10 |
| ドライブ | 横方向スワイプ | 低くフラット | 10 |
| スマッシュ | 下スワイプ ＋ 打点1.32m以上 | 急降下 | 30（威力育成で最大45） |

---

## ゲームシステム

### スコア

返球 10点 / スマッシュ 30点（+ボーナス）/ ウィナー 15点。**100点ごとにレベルアップ**し、
AIの速度・反応・配球とシャトル速度が段階的に上昇します。

### AI難易度

| 難易度 | 反応 | 移動速度 | ミス率 | スマッシュ頻度 |
| --- | --- | --- | --- | --- |
| 初級 | 0.42s | 5.4 m/s | 24% | 6% |
| 中級 | 0.28s | 6.7 m/s | 13% | 18% |
| 上級 | 0.18s | 8.1 m/s | 5% | 32% |

### 練習モード（Training）

スコア・報酬・リザルトなし。ミスしても即座にサーブから再開するので、
**スワイプの長さと打点の練習**に向いています。HUD に `TRAINING` バッジが表示され、
ポーズメニューの「トレーニングを終了」でホームへ戻ります。

---

## ディレクトリ構成

```
.
├── index.html                # 画面構造（ホーム/育成/設定/ランキング/リザルト/HUD）
├── manifest.json             # PWA マニフェスト
├── service-worker.js         # Service Worker（オフラインキャッシュ）
├── vercel.json               # Vercel ヘッダー設定
├── package.json
├── css/
│   ├── base.css              # 変数・リセット・共通ボタン
│   ├── screens.css           # 各画面・パネル・チュートリアル
│   ├── hud.css               # ゲーム中HUD
│   ├── pwa.css               # インストール誘導バナー・更新通知・横向き案内
│   └── training.css          # ★育成画面・ホームメニュー・報酬・手順ダイアログ
├── js/
│   ├── main.js               # エントリ（レイアウト・入力・ループ・PWA初期化）
│   ├── config.js             # ★全パラメータ集約
│   ├── game.js               # 状態機械・ラリー進行・スコア・育成倍率の適用
│   ├── core/
│   │   ├── math.js  camera.js  swipe.js  shot.js
│   │   ├── shuttle.js  player.js  ai.js  effects.js  audio.js
│   │   ├── storage.js        # 設定 / ランキング / 育成データの永続化
│   │   ├── profile.js        # ★プレイヤープロフィール（レベル・EXP・能力）
│   │   └── training.js       # ★育成値→倍率変換・疲労計算
│   ├── render/               # 疑似3D描画 / キャラクター
│   ├── ui/                   # hud.js / screens.js / ranking.js
│   └── pwa/
│       ├── installer.js      # ★インストール判定（純ロジック・テスト対象）
│       └── install.js        # ★DOM配線（ボタン・ダイアログ・SW登録）
├── assets/                   # アイコン / スクリーンショット
└── tools/
    ├── smoke-test.mjs        # ゲームロジックのヘッドレス検証
    ├── dom-test.mjs          # ★jsdom による PWA導線 / 育成ロジック検証
    └── pwa-check.mjs         # manifest / キャッシュの検証
```

---

## データセーブ

`localStorage` のキー `bsc.v1` に以下をまとめて保存します（既存データはそのまま引き継ぎ）。

```json
{
  "settings": { "handedness": "right", "difficulty": "normal", "sound": true, "seenTutorial": true },
  "ranking": [ ... ],
  "stats": { "plays": 12, "bestScore": 2480, "bestRally": 17, "smashes": 61 },
  "profile": {
    "level": 4, "exp": 35, "points": 12,
    "stats": { "speed": 56, "stamina": 50, "accuracy": 61, "smash": 54 },
    "matches": 12, "wins": 7, "spent": 21
  }
}
```

- ブラウザ再起動・タブ復帰後も維持されます
- **PWAインストール後も同じオリジンの localStorage を共有**するため、育成データは引き継がれます
- 壊れたデータは読み込み時に既定値へ丸められます（`profile` が無い場合は Lv1 / 能力50 / 0pt から開始）

---

## デプロイ

### Vercel

```bash
vercel --prod
```

プリセット **Other** / ビルドコマンド空 / 出力ディレクトリ空。`vercel.json` で
`service-worker.js` の非キャッシュと `manifest.json` の MIME を設定済み。

### GitHub Pages

`main` / `/ (root)` を公開（`.nojekyll` 同梱）。
プロジェクトページ（`/repo/` 配下）に置く場合のみ、`manifest.json` の
`start_url` / `scope` を `"/repo/"` に変更してください。

---

## 検証（テスト）

```bash
npm run verify
# = node tools/smoke-test.mjs && node tools/dom-test.mjs && node tools/pwa-check.mjs
```

| スクリプト | 検証内容 |
| --- | --- |
| `smoke-test.mjs` | スワイプ解析・4ショット判定・利き手反転・サーブ・ゲームループ・難易度 |
| `dom-test.mjs` | **index.html を実際に起動して main.js が最後まで実行されること** / インストールボタンの prompt() 呼び出し / userChoice 処理 / インストール済み表示 / 利用不可時の無効化と理由表示 / iOS手順ダイアログ / PWA診断の各ステータス / 育成の報酬計算・レベルアップ・上限・セーブ復元・倍率 |
| `pwa-check.mjs` | manifest 必須項目・アイコン実寸・プリキャッシュ全件の実在・オフライン応答 |

> ℹ️ `dom-test.mjs` の実行には `jsdom` が必要です（`npm i -D jsdom`）。開発時のみの依存で、配布物には含まれません。
> Lighthouse と実機インストールの最終確認は HTTPS 環境で行ってください。

---

## バランス調整

| 調整したい項目 | 場所 |
| --- | --- |
| 育成の効き幅（1.5倍 / 誤差50%減 / 球速1.3倍 / 疲労0.1倍） | `js/core/training.js` の `deriveAbilities()` |
| 報酬ポイント・レベルアップ必要EXP・上限レベル | `js/core/profile.js` の `PROFILE_CONFIG` |
| 勝利条件（ウィナー本数）・疲労の開始ラリー | `js/config.js` の `CONFIG.training` |
| ショット性能・AI難易度・得点 | `js/config.js` の `shots` / `difficulty` / `scoring` |

---

## ロードマップ

| バージョン | 内容 |
| --- | --- |
| v1.0.0 | シングルプレイ / スワイプ4種 / 打点・利き手 |
| v1.0.1 | PWA対応（インストール / オフライン / スタンドアロン） |
| v1.2.0 | キャラクター育成（4能力・レベル・報酬） / 練習モード |
| **v1.2.1** | **インストール不具合の真因修正（初期化順序） / PWA診断 / 要件不足の可視化** |
| **v1.3.0** | **Avatar Editor / 3Dアニメ風アバター（回転・5ポーズ）/ 体格・身長の能力補正 / localStorage保存** |
| **v1.2.10** | **シャトルのコルクを進行方向へ修正 / レベルアップ通知を画面上部へ（半透明・1.5秒）** |
| **v1.2.9** | **Training/Character 実装状況レポート / Debug ボタン（Connected判定）/ 押下ログ4種 / 委譲フォールバック** |
| **v1.2.8** | **Training/Character 無反応の修正（クリック以外の入力経路）/ Training画面 / 育成の英語表記** |
| **v1.2.7** | **開発者メニューを5連打で解禁 / 設定からPWA診断を隠す** |
| **v1.2.6** | **診断モーダルの自動表示を廃止（ホーム→Play優先）** |
| **v1.2.5** | **診断をインライン化（モジュール非依存）/ Installed・Standalone・Unavailable (Installed) 表示** |
| **v1.2.4** | **インストールボタン無反応の修正（disabled廃止＋委譲リスナー）/ 押下ログ / 診断の実測表示** |
| **v1.2.3** | **deferredPrompt をアプリ全体で保持 / prompt() 実行フロー / 診断に deferredPrompt 行を追加** |
| **v1.2.2** | **診断が全項目「-」になる不具合を修正 / 実API取得（getRegistrations・isSecureContext・matchMedia）/ Raw Data / HTTPS行追加** |
| v1.3 | トーナメントモード、ラケット収集 |
| v2.0 | ダブルス、オンライン対戦、リプレイ機能 |

---

## 既知の制約

- コートは正式寸法を簡略化した疑似3D表示です
- BGM は未実装（効果音のみ・WebAudio合成）
- ランキング・育成データは端末内 `localStorage` 保存（サーバー同期なし、端末間の引き継ぎ不可）
- iOS Safari では初回タップまで無音（WebAudio の自動再生制限）
- iOS は `beforeinstallprompt` 非対応のため手順案内のみ
- `http://<ローカルIP>` では Service Worker が動きません（localhost か HTTPS を使用）
- 育成データのリセット機能は未実装（ブラウザのサイトデータ削除で初期化）

---

## ライセンス

MIT License
