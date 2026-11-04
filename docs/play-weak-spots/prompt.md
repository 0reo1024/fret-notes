# 実装プロンプト：演奏練習の苦手箇所ランキングと苦手集中モード

あなたは Fret Notes（Tauri 2 + TypeScript + Rust、Windows）の開発を担当します。今回は、演奏練習（単音）に次の3つを追加します。

- 苦手な「何弦の何フレット」を、**誤りの回数と平均時間を組み合わせた苦手度**で見つけ出す仕組み
- 指板の下に表示する**日ごとの苦手ランキング**（前の日も見られる）
- 右パネルの**苦手集中モードの ON／OFF**（入力設定より上）

仕様の正本は `docs/play-weak-spots/design.md` です。**最初に全体を読んでください。** このプロンプトは作業の手順と要点だけを書いています。仕様とコードが食い違う場合は、コードを確認したうえで食い違いを報告し、既存の挙動を壊さない側を選んでください。

## 最初に確認すること（既存コード）

- `src/domain/practice/performance.ts`
  - `PlayTarget`、`PlayResult {target, listeningMs, wrongAttempts, cents}`。
  - `PerformanceSession` の `consume` / `pause` / `finish` / `advance`。
  - `wrongAttempts` と `listeningMs` の数え方。一時停止では問題が続き、`advance` でリセットされる。
- `src/features/performance/view.ts` の `mountPerformance`
  - `targets()`、`configurationKey()`、`refreshConfiguration()`、`change()`、`newSession()`、`render()`、`consume()`、`setInstrument()`。
  - オクターブの保存（`training.updatePreferences('play',{octave})`）。**丸ごと置き換えている**。
- `src/app/main.ts:51` の `training.add(...)`（既存の itemId `play:楽器:MIDI`）。**変更しない。**
- `src/domain/training/records.ts`: `TrainingData`、`limits`、`emptyTrainingData`、`decodeTrainingData`、`localDate`。
- `src/platform/training-store.ts`: `TrainingRepository`（`changed()` で30秒後に自動保存）。
- `src-tauri/src/training.rs`: `FIELDS`（7項目固定）、`validate`、テスト。
- `src/domain/training/analysis.ts`: `targetsOf(...).play`（演奏の目標時間。既定 4000 ms）。
- `index.html` の `#play-display` と `aside.audio-settings`（`.play-settings` → `.play-options` の順）。
- `src/ui/style.css:304` の `body:not(.play-open) :is(.play-options, .play-settings) { display: none; }`。
- `src/features/settings/range.ts`（出題範囲の UI。苦手集中中に無効化する）。
- `tests/performance.test.ts`、`tests/training.test.ts`、`tests/analysis.test.ts`。

## 作業

### 1. 純粋なロジック：`src/domain/practice/weak-positions.ts`（新規）

DOM に依存させない。書き方は `performance.ts` に合わせる。

```ts
export interface PlayPositionDay { date: string; instrument: ProfileId; string: number; fret: number; midi: number; asked: number; answered: number; wrong: number; totalMs: number }
export const weakConstants = { priorCount: 2, priorError: .1, priorTimeShare: .6, timeCapShare: 3, weakThreshold: 70, focusMinimum: 40, focusCounts: [5, 10, 15], defaultFocusCount: 10, retentionDays: 400 };
export type PlayOutcome =
  | { kind: 'answered'; listeningMs: number; wrongAttempts: number }
  | { kind: 'abandoned'; listeningMs: number; wrongAttempts: number };
/** Adds one question to the day's entry for the asked position; returns null when an abandoned question is not worth recording. */
export function playPositionEntry(target: {string:number;fret:number;midi:number}, outcome: PlayOutcome, instrument: ProfileId, date: string, targetMs: number): PlayPositionDay | null;
export function addPlayPosition(list: PlayPositionDay[], entry: PlayPositionDay, maximum: number): PlayPositionDay[];   // 同じキーに加算。400日・上限件数で古いものから削る
export function weaknessScore(entry: Pick<PlayPositionDay,'asked'|'wrong'|'totalMs'>, targetMs: number): number;
export interface RankedPosition extends PlayPositionDay { score: number; averageMs: number; weak: boolean; tentative: boolean; previousRank: number | null }
export function rankPositions(list: PlayPositionDay[], query: { date: string; instrument: ProfileId; midiAt: (string: number, fret: number) => number | null; targetMs: number }): RankedPosition[];
export function rankingDates(list: PlayPositionDay[], query: { instrument: ProfileId; midiAt: (string: number, fret: number) => number | null }): string[];   // 新しい順
export function focusPositions(list: PlayPositionDay[], query: { today: string; instrument: ProfileId; midiAt: (string: number, fret: number) => number | null; targetMs: number; count: number; playable: (p: {string:number;fret:number;midi:number}) => boolean }): { date: string; positions: {string:number;fret:number}[] } | null;
export function validPlayPosition(value: unknown): value is PlayPositionDay;
```

- 苦手度は design.md §5.1 のとおりにする。`round(100 × (e + 0.5 × t / T))`。
  - `e = (wrong + k·e0)/(asked + k)`
  - `t = (totalMs + k·0.6T)/(asked + k)`
- 1問あたりの時間は `timeCapShare × targetMs` を上限にする。
- 未回答の問題は、`wrongAttempts >= 1` または `listeningMs >= targetMs` のときだけ記録する。その場合は `wrong + 1`、時間は上限の値にする。
- 並べ方は design.md §5.3 に従う。`tentative = asked < 3`、`weak = score >= 70`。
- `previousRank` は、一つ前の記録がある日の同じ位置の順位（なければ null）。
- `midiAt` は現在のチューニングで、その弦・フレットの MIDI を返す。`midi` が一致しない項目は除外する。
- `focusPositions` は design.md §7.1 のとおりにする。
  - 候補は、苦手度 40 以上で `playable` を満たす位置。
  - 元にする日は「今日の候補が2件以上あれば今日、なければ候補が2件以上ある最新の日」。
  - その日の候補の上位から最大 count 件を選ぶ。
  - どの日にも候補が2件以上なければ null を返す。

### 2. 判定：`PerformanceSession.pending()`（`performance.ts`）

- 未回答の問題 `{target, listeningMs, wrongAttempts}` を返す。`ready`・`accepted`・`finished` のときと、問題がないときは null。
- **判定のロジックは一切変えない。** 既存のテストは1行も変えずに成功させる。

### 3. 保存：`TrainingData.playPositions`

- `records.ts`
  - `TrainingData` に `playPositions: PlayPositionDay[]` を追加する。
  - `limits.playPositions = 20000` を加え、`emptyTrainingData()` にも `[]` を入れる。
  - `decodeTrainingData`: `playPositions` を**任意のキー**として受け付け、ない場合は `[]` を補う。各項目は `validPlayPosition` で検証する。
    - 検証の内容: キーの集合、整数、`1 <= string <= 6`、`0 <= fret <= 24`、`0 <= midi <= 127`、`answered <= asked`、`asked >= 1`、日付の形式、`profileIds` に含まれる楽器。
    - 項目数の上限も確認する。
  - `schemaVersion` は 1 のままにする。
- `training-store.ts`: `addPlayPosition(entry: PlayPositionDay)` を追加する。`addPlayPosition` で加算し、`changed()` を呼ぶ。
- `src-tauri/src/training.rs`
  - `playPositions` を任意の配列項目（上限 20000）として許す。
  - 「7項目、または `playPositions` を含む8項目」だけを受け付け、それ以外の未知のキーは今までどおり拒否する。
  - テストを追加する（7項目・8項目の両方が通る、上限を超えると拒否、配列でなければ拒否）。
- 書き出し・読み込み・消去（記録タブ）は `TrainingData` 全体を扱っているので、新しい項目も自然に含まれる。プレビューで、書き出し → 読み込みの往復を確認する。

### 4. 画面：`src/features/performance/view.ts`・`index.html`・`style.css`

**記録**

- `consume()` で正解が増えたとき、既存の `onResult` に加えて、オクターブ「指定」のときだけ `training.addPlayPosition(...)` を呼ぶ（`playPositionEntry` の結果が null でない場合）。
- 未回答の記録: セッションを捨てる直前に、`session.pending()` を `abandoned` として記録する小さな関数（例 `abandonPending()`）を呼ぶ。呼ぶ箇所は次のとおり。
  - `#play-finish`
  - `change()`
  - オクターブ・許容幅・安定時間の変更
  - `setInstrument()`
  - `refreshConfiguration()` がセッションを捨てるとき
  - 苦手集中の切り替え
- 一時停止・タブの切り替え・アプリの終了では、記録しない。
- 日付は `localDate(new Date())`。目標時間は `targetsOf(training.current.preferences).play`。
- `training` が null のとき（テストなど）は、何もしない。

**苦手集中**

- 設定は `training.preferences.play = {octave, focus, focusCount}` に保存する。**読み込んだ値に重ねて保存する**ように、既存のオクターブの保存も直す。
  - マージする関数は、テストできる形で切り出す。
  - 想定外の値は既定値（`focus:false`、`focusCount:10`）にする。
- 選んだ一覧は、画面側の状態 `focusSelection: {date, positions} | null` に保持する。
  - **`focusPositions(...)` を呼ぶのは `newSession()` の中だけにする。**
  - `targets()`・`canStart()`・`render()`・`configurationKey()` は `focusSelection` を読むだけで、選び直さない。
  - 理由: 選び直すと、回答で集計が増えるたびに一覧（`configurationKey`）が変わる。すると `refreshConfiguration()` が練習中のセッションを捨ててしまう。たとえば朝、今日の記録が1件できた瞬間に起こる。
- ON で、オクターブ指定で、`focusSelection` が null でない場合:
  - `targets()` は、選ばれた位置だけの `PlayTarget` にする。`playTargets` の結果から、該当する弦・フレットに絞る。出題範囲の絞り込みは使わない。
- `configurationKey()` に、苦手集中の状態・件数と、保持している `focusSelection` の日付・位置のキーを含める。
- ON で `focusSelection` が null の場合は、通常の範囲で出題し、`#play-focus-note` に「苦手の記録が足りないため、通常の範囲で出題しています」と表示する。
- オクターブ自由では、スイッチと件数を `disabled` にする。注記は「オクターブ指定で使えます」。
- 苦手集中が有効な間は、出題範囲の UI（`#play-range-settings` の中）を `disabled` にする。「苦手集中中は出題範囲を使いません」と表示する。範囲の値は変更しない。
- 出題の上（`#play-progress` の下）に「苦手集中：N か所（YYYY-MM-DD の記録から）」を表示する。

**右パネルの要素（`index.html`）**

- `.play-settings` と `.play-options` の間に、次の要素を置く。

```html
<div class="play-focus"><h4>苦手集中</h4>
 <label class="open-toggle"><span>苦手を集中練習 <small>苦手な位置だけを出題</small></span><input id="play-focus" type="checkbox" role="switch"></label>
 <label>出題数<select id="play-focus-count"><option value="5">5か所</option><option value="10" selected>10か所</option><option value="15">15か所</option></select></label>
 <p id="play-focus-note" class="setting-note"></p></div>
```

- CSS: `body:not(.play-open) :is(.play-options, .play-settings, .play-focus) { display: none; }` に直す。
- 見た目は `.play-options` に合わせる（見出し・余白・下の罫線）。
- 入力の `starting`/`stopping` 中は `disabled` にする。

**ランキング（指板の下）**

- `.play-board-shell` の直後に `<section id="play-weak" class="play-weak" aria-labelledby="play-weak-title">` を置く。内容は次のとおり。
  - 見出し「苦手ランキング」
  - 日付の切り替え: `‹`（前の記録日）、`<select id="play-weak-date">`（記録がある日＋今日）、`›`、「今日」
  - 「この日の記録：N か所・M 問」
  - 注記「出題した弦・フレットで集計しています」
  - オクターブ自由のときの注記「オクターブ自由の結果は弦を指定しないため集計しません」
  - `<table>`: 順位・位置（「5弦 3F」）・音名・苦手度・誤り・平均（秒、小数1桁）・出題・前回比（前の記録日の順位との差）。`caption` と `th scope` を付ける。
  - 初めは上位10件を表示し、「すべて表示」で全件にする。
  - 苦手度が70以上の行は強調し、数値の横に「苦手」と書く（色だけに頼らない）。出題が3未満の行には「参考」と書く。
  - 記録がなければ「この日の記録はありません」と表示する。
- 音名は `create(profile).name(position, range().notation)` で表記する。
- 表示中の日付は保存しない。起動したとき・楽器を変えたときは今日にする。
- 再描画: `render()` の中で、キー（表示中の日付、楽器、チューニング、`playPositions` の長さと合計値、表記、すべて表示の状態）が変わったときだけ表を作り直す。毎フレーム DOM を作らない。
- **`#play-board` に苦手の位置を表示しない**（答えになるため）。

### 5. テスト（`tests/weak-positions.test.ts`（新規）と既存のテストへの追加）

design.md §10 の項目をすべて表を使って書く。必須のものは次のとおり。

1. 苦手度: design.md §5.2 の6例（目標 4000 ms）で 33／131／99／66／35／110。目標 3000 ms の例を1件追加する。
2. `playPositionEntry`
   - 正解の場合。
   - 未回答の場合（誤り0・短時間なら null、誤りありなら `wrong+1` で時間は上限）。
   - 時間の上限。
3. `addPlayPosition`: 同じキーへの加算、キーの各要素の違い、400日、件数の上限。
4. `rankPositions`
   - 同点のときの順序。
   - `tentative`・`weak`・`previousRank`。
   - ドロップD（6弦の開放 = D2、MIDI 38）で、標準チューニングの6弦の記録（E2、MIDI 40）が除外される。
   - 4弦ベース・5弦ベース。
5. `rankingDates` と、`localDate` の日付の境界（23:59 と翌日 0:01）。
6. `focusPositions`
   - 今日 → 最新の日へのフォールバック。
   - **今日の候補が1件・昨日の候補が8件なら、昨日を使う。**
   - 40未満の除外、最大件数、どの日も2件未満なら null、音域外の除外。
   - 画面側: セッションの途中で `addPlayPosition` しても、`configurationKey()` が変わらず、セッションが続く（`focusSelection` を切り出した関数か、`mountPerformance` の小さなテストで確認する）。
7. `PerformanceSession.pending()` の各段階。
8. `decodeTrainingData`
   - `playPositions` がない古いデータを読める。
   - 不正な項目を拒否する。
   - `emptyTrainingData()` が往復する。
9. preferences のマージ: オクターブの変更で `focus` が残る。
10. Rust: `cargo test` に、`validate` の7項目／8項目／上限を超えた場合のテストを加える。

## UI・UX の要件

- 苦手集中が OFF でオクターブ自由のときは、出題・判定・記録（`training.add`）が**今とまったく同じ**であること。
- 文言は既存に合わせ、短い日本語にする。数値は「9.0秒」「131」のように表記する。
- 狭い幅（右パネルが折りたたまれる幅）でも、ランキングの表が横にはみ出さないこと。必要なら、平均と前回比の列を小さい幅では隠す。
- キーボードだけで、日付の切り替えとスイッチを操作できること。

## 注意点

- 既存の itemId（`play:` / `play-any:`）・Leitner の stats・`daily`・`attempts` の記録内容は変えない。
- settings.json（Rust で v3 スキーマとして検証されている）には何も追加しない。
- 音声データは保存しない。保存するのは、位置ごとの回数と時間の合計だけ。
- ランキングと苦手集中は、ギター・4弦／5弦ベース・任意のチューニングで動くこと。
- 弦の判定はできない前提を守る。画面にもそのことを書く。

## 確認（プレビュー）

`.claude/launch.json` の web でプレビューを開き、マイクの入力がない環境では、次のことを確認する。

1. 初期状態でランキングに「この日の記録はありません」と表示される。右パネルに「苦手集中」が「入力設定」の上にあり、チューナー・ハーモニーなど他の画面には表示されない。
2. 開発者ツールで `playPositions` にサンプル（今日・昨日の複数の位置）を入れて再読み込みする。
   - 今日の順位が表示される。
   - `‹` で昨日に移れる。
   - 前回比と「参考」「苦手」が表示される。
3. 苦手集中を ON にする。
   - 出題が苦手な位置だけになる。
   - 出題範囲が `disabled` になる。
   - 「苦手集中：N か所」が表示される。
4. オクターブを自由にする。
   - スイッチが `disabled` になる。
   - 指定に戻すと ON が残っている（マージの確認）。
5. 記録の書き出し → 読み込みで `playPositions` が保たれる。
6. 実機（楽器と入力機器）が使える場合は、数問を演奏する。正解と誤りがその日のランキングに加算され、「練習を終了」で未回答の問題が規則どおりに記録されることを確認する。使えない場合は「未検証」と報告する。

## 完成条件

- `npm.cmd test`、`npm.cmd run typecheck`、`cargo test --manifest-path src-tauri/Cargo.toml --lib` がすべて成功する。
- 上の確認の1〜5を済ませ、6は実施したか、未検証かを報告する。
- `docs/migration-progress.md` と `README.md` に、次の内容を追記する。実装したこと・検証したこと・未検証のことは分けて書く。
  - 苦手度の式
  - 日ごとのランキング
  - 苦手集中
  - 新しい学習記録の項目と互換性（古い版のアプリでは新しい記録ファイルを読めないこと）
  - 目標時間を変えると、過去の苦手度も計算し直されること
- 版を 1.1.0 に上げる。`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` を揃える（必要なら `Cargo.lock` も）。`installer/fret-notes.iss` の AppId は変更しない。
- 最後に `npm.cmd run desktop:install` を実行し、インストール済みのアプリを置き換える。

## 共通ルール（必ず守ること）

- 作業前に `CLAUDE.md`、`docs/play-weak-spots/design.md`、`docs/migration-progress.md` を読む。
- 既存の機能を削除・変更しない（このプロンプトで明示した変更を除く）。既存のテストを削除しない。
- 新しいライブラリ・外部 API・クラウドサービスを追加しない。`src-tauri/tauri.conf.json` の CSP を広げない。
- 判定と集計のロジックは、DOM に依存しない `src/domain/` に置き、`tests/*.test.ts`（node --test、tsx）で表を使ったテストを書く。
- 既存ファイルを整形し直さない。不必要な大規模リファクタリングをしない。
- git のコミット・プッシュは、利用者の指示があるまで行わない。
