# Part 4：アプリ全体の設計

## 4.1 画面構成と情報設計

### 4.1.1 左の機能タブ（推奨する最終形）

現在の左側の機能タブ（`index.html` の `.feature-tabs`）を拡張する。ホーム画面にすべての練習を並べる方式は採らない。

| タブ | 中身 | 追加する時期 |
| --- | --- | --- |
| **指板学習**（既存） | 位置→音名、音名→位置、全位置探索、全音名表示（コード・スケール表示） | 既存（P4で拡張） |
| **演奏練習**（既存） | 単音の演奏。オクターブ指定／自由 | 既存（P4で拡張）。*将来、指板学習の「演奏で回答」へ統合するかは、利用者の判断とする* |
| **ハーモニー**（新規） | 出題の種類: コードトーン ／ インターバル ／ アルペジオ ／ 調と機能（知識） | P5 |
| **進行**（新規） | 段階: ルート…自由 ／ ライン（ボイスリーディング） ／ フレーズ（モチーフ） ／ 進行の編集 | P7 |
| **耳・リズム**（新規） | 聴音 ／ リズム | P10 |
| **記録**（新規） | 概要、習得度、弱点、今日の練習 | P3（最小）→ P15 |
| **チューナー**（既存） | 変更しない | — |

- 練習のタブは7つになるが、左の縦並びのアイコンで収まる。最小幅（700 px）では、既存の CSS の切り替えに合わせてアイコンだけを表示する。
- カテゴリー（音名・指板／コード・ハーモニー／聴音／リズム／アドリブ実践）は、依頼の分類をそのまま採用した。ただし「聴音」と「リズム」は単独では出題の種類が少ないため、1つのタブにまとめた。
- 学習者が迷わないように、**記録タブの「今日の練習」から各タブへ移れる**ようにする。上から順に練習していけば、段階的な学習になる。

### 4.1.2 トレーナー画面の共通の骨格

```text
┌ 出題の種類（サブタブ: コードトーン｜インターバル｜アルペジオ｜知識） ─────┐
│ 進み具合  7 / 20 ・ 正解 6 ・ 平均 1.8 s                         [音声: ●入力中] │
│                                                                              │
│                 G7                       ← 出題カード（最大の文字）          │
│                 3rd ?                                                        │
│                                                                              │
│  [ 回答エリア: 選択肢 / 音名入力 / 「弾いてください」と検出音・安定バー ]     │
│  [ 結果: 正解 B（G7 の 3rd）  ／  誤答の分類 ]                                │
│                                                                              │
│  [ 指板（回答後に該当する全位置を度数で表示 / クリックで回答） ]              │
└──────────────────────────────────────────────────────────────────────────────┘
右パネル（既存と同じ開閉式）: 出題の設定 ／ 回答方法 ／ 判定の設定 ／ 音声入力
```

**ギターを持ちながら使えるようにするための規則**
- 正解したら自動で次へ進む。既定は600 ms で、既存の演奏練習と同じ。
- 主な操作をすべてキーボードで行える。
  - Space: 開始／次へ
  - 1〜4: 選択肢
  - A〜G と ↑↓: 音名の入力
  - R: もう一度聴く
  - S: スキップ
  - Enter: 確定
- キーボードとして認識される USB フットスイッチは、そのまま使える。
- 練習中は設定パネルを閉じたままにできる。出題の条件は出題カードの下に1行で要約する（既存の `#scope-summary` と同じ考え方）。
- 出題と判定の文字は大きくする。正誤は色と文字（「正解」「B が正解」）の両方で示し、色だけに頼らない（既存の aria の方針を引き継ぐ）。

### 4.1.3 レスポンシブ

- 既存のブレークポイント（1500 / 1100 / 960 / 700 px）に従う。
- 700 px 未満は、現在のウィンドウ設定では発生しない。ただし将来タッチ端末へ移す可能性があるため、タップ領域は 44 px 以上とし、指板は横スクロールにする（既存の `.board-shell`）。

## 4.2 音声入力の共有（音声ハブ）

**現状**: `mountTuner` が `AudioController` を生成し、`'tuner'|'play'` に通知を振り分けている。

**変更（最小限）**

1. `AudioController` の生成を `main.ts` へ移し、`mountTuner(repository, controller)` のように引数で渡す。
2. 入力デバイスの設定UI（`#audio-device` などの `aside.audio-settings`）を共通の部品（新規・提案名 `src/features/audio/settings.ts`）に切り出す。チューナーと新しいトレーナーの両方に置けるようにする。
   - 既存の要素ID・挙動・保存先（`repository.current.audio`）は変えない。
   - 複数の画面に同じ部品を置く場合は、表示中の1か所だけを有効にする。
3. 通知の受け手を「現在表示している機能」1つに限定する。

   ```ts
   interface AudioConsumer { consume(o: AudioObservation): void; sync(): void; pause(): void }
   let active: AudioConsumer | null;
   controller.onObservation = o => active?.consume(o);
   ```

4. タブの切り替え、最小化（`visibilitychange`）、終了時の停止は、既存の経路をそのまま使う。

入力を二重に開かない、古いセッションの通知を捨てる、といった既存の保証は `AudioController` が持っているため、変更しない。

## 4.3 判定エンジン（matcher）

### 4.3.1 単音の matcher

```ts
type PitchMatcher =
  | { kind: 'midi'; midi: number }                                        // 既存の演奏練習と同じ
  | { kind: 'pitch-class'; pitchClasses: number[]; register: [number, number] };   // 集合のどれか（音域の窓の中）
```

- `PerformanceSession` の `PlayTarget` に、任意の `accept?: PitchMatcher` を追加する。**指定がないときは今と同じく `midi` で判定する**ので、既存のテストはそのまま通る。
- セント差: 観測した周波数を、matcher が許す音高のうち最も近いものと比べる。
- 音高クラスの判定は、音域の窓の中にあれば正解とする。これによって、YIN のオクターブ誤り（倍音を拾うなど）にも強くなる。

### 4.3.2 複数音の matcher（順番あり／なし）

```ts
type SequenceSpec =
  | { kind: 'ordered'; steps: PitchMatcher[] }       // アルペジオ、メロディ、アプローチ
  | { kind: 'unordered'; steps: PitchMatcher[] };    // 「3rdと7th（順番は自由）」
```

- 純粋なクラス（新規・提案名 `src/domain/practice/sequence.ts`）が、音のイベントを1つずつ受け取って、進み具合・誤り・完了を返す。
- 1つ前の音に依存する条件（ボイスリーディングの移動の上限）は、各段階の matcher を前の音から動的に作る関数で表す。

### 4.3.3 観測から音のイベントへの分割

```text
stable の観測が続く
  → 最も近い MIDI が同じ音を一続きの候補にまとめる
  → 候補が minHoldMs（既定 200 ms。メロディ・アルペジオは 120〜200 ms を選べる）続いたら、音のイベントとして確定
  → 次の区切りでイベントを終える:
     ・別の MIDI の候補が確定したとき（レガート）
     ・silence / unstable / clipping が 120 ms 以上続いたとき
     ・観測の間隔が 250 ms を超えたとき（既存と同じ）
```

- **同じ音高の再アタックは、間に無音・不安定な区間が 120 ms 以上ある場合だけ区別できる。** オンセットの検出（§4.5）を入れた後は、オンセットでも区切る。
- `NoteSegmenter` は、確定したイベントの列に加えて、**現在鳴っているイベント**（確定済みで、まだ終わっていないもの）を公開する。

#### 共通音の保持の規則（全トレーナーで共通）

進行の判定でコードや問題が切り替わったとき、次のように扱う。

- 切り替わった時刻を T とする。現在鳴っているイベントが T + `minHoldMs` の時点でもまだ続いていれば、新しいコード（問題）の証拠として扱う。正解の音ならそのまま正解になる。
  - 例: Dm7 の F を伸ばしたまま G7 に入る。
- T より前に終わったイベントは、新しいコードの証拠にしない。
- ステップ式の問題の切り替えは、既存の `PerformanceSession.advance()` と同じ方式にする。証拠をいったん破棄し、伸ばしている音から改めて集める。そのため、伸ばした音は `holdMs` の後に再び判定される。
- 同じ答えの音高クラスが続く問題は、意図した場合（ボイスリーディングの共通音）を除いて連続させない。

この規則は P2（分割器）、P5（コードトーン）、P7・P8（進行）、P9（ライン）で共通に使う。
- 時刻には `audioTimeMs`（入力の時計）を使う。テストで再現できるように、受信時刻ではなく入力の時計を基準にする。進行・リズムとの対応だけは、別の時計の対応関数を通す。

### 4.3.4 判定の結果の分類（共通）

`correct` ／ `wrong` ／ `spelling`（綴りだけ違う） ／ `timeout` ／ `skipped` ／ `self-marked`（自己判定） ／ `detection-issue`（入力過大・入力なし・入力の中断）

- 弱点分析と間隔反復（§4.4）に使うのは、`correct`、`wrong`、`spelling`、`timeout` だけ。
- `detection-issue` は、画面の「入力の状態」（入力過大の割合など）に集計し、機器の設定の見直しを促す。

## 4.4 データ管理（学習記録ストア）

### 4.4.1 方針

- **`settings.json`（schemaVersion=3）は変更しない。** 新しいファイル `training-data.json` を同じアプリデータ領域に置く。
- Rust 側（新規・提案名 `src-tauri/src/training.rs`）の役割
  - 版番号の確認、サイズの上限（8 MB）。
  - 一時ファイルからの置き換えによる原子的な書き込み、直前のバックアップ。
  - 新しい版のファイルを上書きしない。
  - 書き込み・バックアップの方式は、既存の `storage.rs` と同じにする（実装前に確認する）。
- Rust は中身を `serde_json::Value` として最上位の項目と版だけを検証する。細かい検証は TS のデコーダーで行う。既存の `profiles: BTreeMap<String, Value>` と同じ分担。
- Tauri command: `load_training_data`、`save_training_data`。
  - 新しい command の権限の要否は、`src-tauri/capabilities/main.json` と `build.rs` を確認する。
  - 既存のアプリ独自の command は、`lib.rs` の invoke_handler に登録しているだけ。
- TS 側（新規・提案名 `src/platform/training-store.ts`）
  - `SettingsRepository` と同じく、保存要求を順番に処理するキューを持つ。
  - プレビュー用に localStorage の代替を持つ。
  - 書き出し・読み込みは設定とは別のボタンにする（設定の64KBの上限とは独立）。
- SQLite は使わない（新しい依存を増やさないため）。

### 4.4.2 データ構造（schemaVersion=1）

```ts
type SkillLayer = 'knowledge' /* 選択・入力 */ | 'fretboard' /* クリック */ | 'performance' /* 演奏 */;
interface Attempt {
  itemId: string; layer: SkillLayer; trainer: string; method: 'choice'|'name'|'click'|'play'|'tap'|'self';
  result: 'correct'|'wrong'|'spelling'|'timeout'|'skipped'|'self-marked'|'detection-issue';
  errorKind?: string; responseMs: number | null; instrument: 'guitar'|'bass4'|'bass5'; at: string /* ISO */;
}
interface ItemStat {
  itemId: string; layer: SkillLayer; attempts: number; correct: number; wrong: number; detectionIssues: number;
  recentMs: number[] /* 直近5件 */; box: 0|1|2|3|4|5; dueAt: string; lastAt: string; firstAt: string;
}
interface TrainingData {
  schemaVersion: 1;
  preferences: Record<string, unknown>;            // トレーナーごとの設定（各トレーナーのデコーダーで検証）
  progressions: Progression[];                     // 利用者が作った進行（100件まで）
  stats: Record<string, ItemStat>;                 // キー = `${layer}|${itemId}`
  daily: { date: string; seconds: number; attempts: number; correct: number }[];   // 400日分
  attempts: Attempt[];                             // 直近2,000件のリングバッファ
  takes: PhraseTake[];                             // 直近20件
  calibration: { tapOffsetMs: number | null; inputOffsetMs: number | null };
}
```

- **同じ項目でも、知識・指板・演奏の層は別の統計にする。** 「G7 の 3rd は B と分かる」と「指板上で B を見つける」と「B を弾ける」は別の能力なので、それぞれを測る（依頼の §9 の段階に対応する）。
- `itemId` の形式は、先頭に種類を付けた正規化文字列にする。
  - 例: `ct:dom7:G:3`、`iv:E♭:M3:up`、`fb:guitar:6:5`、`arp:min:A:inv1:s321:up`、`ear:melody:4:diatonic`
  - 形式を変えるときは、先頭の種類に版を付ける（`ct2:` のように）。
- 書き込み: 練習の終了時、30秒ごと、アプリの終了時（`window-lifecycle` の保存待ちに追加）にまとめて書く。

### 4.4.3 間隔反復（純粋関数）

```ts
function review(stat: ItemStat | undefined, a: Attempt, now: Date, targetMs: number): ItemStat;
// correct かつ responseMs ≤ targetMs: box+1（上限5）
// correct で responseMs が目標を超えた: box は変えない
// wrong / spelling / timeout: box = 1
// skipped / self-marked / detection-issue: box も dueAt も変えない（回数だけ数える）
// dueAt = now + [0,1,2,4,8,16][box] 日（ローカルの日付で切り上げる）
```

## 4.5 時計・音の出力・オンセット

| 要素 | 実装 | 時計 |
| --- | --- | --- |
| 音の出力（メトロノーム、合成音、ドローン） | Web Audio（新規・提案名 `src/platform/sound.ts`）。最初の利用者の操作で AudioContext を作る | AudioContext の時計。`getOutputTimestamp()` で performance の時刻へ変換する |
| タップ | `keydown` / `pointerdown` の `event.timeStamp` | performance の時刻 |
| 単音の観測 | 既存（Rust → Channel） | 入力デバイスのサンプル時刻（`audioTimeMs`）。受信時刻は performance の時刻 |
| オンセット（R2） | Rust の `analysis.rs` に、ネイティブのサンプルレートで 5 ms ごとのエネルギーの増加を見る検出器を追加する。`Observation` に `onsets: number[]`（入力の時計の ms）を追加する | 入力の時計 |

**オンセット検出の設計方針（P12 で実装）**
- 高域を強調したエネルギーの包絡を 5 ms ごとに求める。
- 次の条件をすべて満たしたらオンセットとする。
  - 直前 20 ms の最小値から、しきい値（既定 +9 dB）以上上昇した。
  - しきい値のゲートを超えている。
  - 前のオンセットから 50 ms 以上経っている。
- 通知の頻度（約15 Hz）は変えず、その間に検出したオンセットを配列で送る。
- 音声のコールバックには処理を追加しない（既存の設計規則）。
- 入力の時計と performance の時刻の対応: `受信時刻 − audioTimeMs` の最近 N 件の最小値で求める（受信の揺れの下限）。一定のずれは補正の手順で吸収する。

## 4.6 機能間の連携（学習の流れ）

依頼の §9 にある「G7 を見る → B と認識 → 指板上で見つける → 弾く → 次の Cmaj7 の E へつなぐ」を、次のように各練習の層へ対応させる。

```text
[ハーモニー: 知識]   G7 → 3rd? → 選択／入力で「B」             … knowledge 層
        ↓ 定着（箱≥4）すると、同じ項目の「指板」層の出題を増やす
[ハーモニー: 指板]   G7 → 3rd? → 指板上の B をすべて／指定の窓で  … fretboard 層
        ↓
[ハーモニー: 演奏]   G7 → 3rd? → 弾く（音高クラス）             … performance 層
        ↓
[進行: 段階2〜4]     Dm7 | G7 | Cmaj7 の 3rd / 7th を弾く         … 進行の中で
        ↓
[進行: ライン]       F → F → E（ボイスリーディング）
        ↓
[進行: 自由＋着地]   自由に弾き、変わり目の着地だけを確認する
        ↓
[進行: フレーズ]     モチーフの発展（自己評価）
```

並行する練習（毎日少しずつ）: 指板トレーニング、インターバル、聴音、リズム。

### 4.6.1 レベル（到達の判定）

各レベルは、項目の集合と、その **80% 以上が「定着」**（§3.11）していることを条件にする。開放の制限は上級（L7）だけにかけ、いつでも「すべて表示」で外せるようにする。

| レベル | 内容 | 主な項目の集合 |
| --- | --- | --- |
| L1 指板 | 全弦の自然音（0〜12F） | `fb:*`（ナチュラル） |
| L2 指板＋ | 全音（♯/♭を含む） | `fb:*` |
| L3 インターバル基礎 | m3, M3, P5, m7, M7（上行） | `iv:*` |
| L4 ガイドトーン | maj7/m7/7/m7♭5 の 3rd・7th（知識と指板） | `ct:*` |
| L5 アルペジオ | トライアドと7thの転回形・弦セット | `arp:*` |
| L6 進行 | 段階2〜5を、ライブラリの代表的な進行で | 進行の結果 |
| L7 上級 | テンション、アプローチ、コード・スケール | 上級の項目 |

## 4.7 テストの方針

- 和声エンジン・matcher・分割・間隔反復・リズムの判定は**純粋関数**にし、`tests/*.test.ts` に表を使ったテストを書く。
- 音声の判定は、`tests/fixtures/*.json`（解析結果だけ。音声は保存しない）を再生するテストで回帰を確認する。既存の `play-guitar-events.json` と同じ形式を使う。
- 各フェーズの終わりに、次を実行する。
  - `npm.cmd test`（既存の36件を含む）
  - `npm.cmd run typecheck`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  - 開発プレビューでの操作確認
  - `npm.cmd run desktop:install`
