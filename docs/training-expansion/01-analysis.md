# Part 1：既存アプリの分析結果

調査日: 2026-10-26 / 対象: 作業ツリーの現状（版 0.4.0）
調査方法: ソースコード、テスト、`docs/` の既存文書を読んだ。`npm.cmd test` を実行し、TypeScriptのテスト36件がすべて成功した。Rustのテスト（`cargo test`）と実機の音声入力は、今回は実行していない。

> 判断の根拠は実際のコードとした。README や `docs/migration-progress.md` の記載がコードと食い違う箇所は、1.10 に挙げた。

---

## 1.1 技術スタック

| 層 | 採用技術（確認元） |
| --- | --- |
| アプリ外枠 | Tauri 2（`@tauri-apps/api ^2.12.1`、`src-tauri/tauri.conf.json`）。Windows向けの専用ウィンドウ（最小 700×550）、WebView2 |
| 画面 | TypeScript 5.9（strict）、Vite 8。UIフレームワークはなく、DOMを直接操作する。CSSは `src/ui/style.css` の1ファイル（400行） |
| ネイティブ | Rust。音声入力は CPAL、保存は serde_json（`src-tauri/src/storage.rs`） |
| テスト | `node --test`（tsx 経由）。対象は `tests/*.test.ts` と `tests/*.test.cjs`。Rust は `#[cfg(test)]` |
| 配布 | `npm.cmd run desktop:install` で Inno Setup のインストーラーを作り、`%LOCALAPPDATA%\Programs\Fret Notes` へ上書きインストールする |
| 通信制限 | CSP は `connect-src ipc: http://ipc.localhost`。画面から外部ネットワークへ接続できない |

ランタイムの依存は `@tauri-apps/api` だけ。外部APIやクラウドサービスは使っていない。

## 1.2 ファイル構成（主要部分）

```text
src/
  app/main.ts                     起動、機能タブ（study / tuner / play）の切替、終了処理
  domain/                         DOMに依存しない純粋なロジック
    music/theory.ts               音名・度数・綴り、19コード、21スケール、比較レイヤー
    instruments/profiles.ts       楽器プロファイル、チューニング（プリセット＋独自12件）、midiName
    instruments/core.ts           指板計算（pitch/midi/frequency/name）、出題範囲、移動、判定
    instruments/shapes.ts         コードシェイプ（ギター標準 E/A/D/G/C 型、ベース 4/3弦型）
    practice/session.ts           PracticeSession（位置→音名／音名→位置クイズの状態）
    practice/performance.ts       PerformanceSession（単音演奏の判定）、playTargets
    tuner/pitch.ts                周波数⇔MIDI、セント差、弦の目標音
    tuner/settings.ts             音声設定の検証
  features/
    fretboard-study/board.ts      Fretboard クラス（セルを保持し、差分だけ更新）
    fretboard-study/view.ts       指板学習の画面全体（mountStudy、約250行のクロージャ）
    performance/view.ts           演奏練習の画面（mountPerformance）
    tuner/view.ts                 チューナー画面。AudioController を生成して所有する（mountTuner）
    settings/range.ts             弦・フレット・ナチュラル音の範囲UI（指板学習と演奏練習で共用）
    settings/tuning.ts            チューニング選択・独自設定の編集UI
    settings/transfer.ts          設定JSONの書き出し・読み込み（上限64KB）
  platform/
    audio.ts                      AudioBackend（Tauriの呼び出し）、AudioController（状態機械）
    settings.ts                   SettingsRepository、decodeSettings、プレビュー用の localStorage
    window-lifecycle.ts           終了時の保存待ち
  ui/dom.ts, ui/fretboard-layout.ts, ui/style.css
src-tauri/src/
  lib.rs                          Tauri command: load_settings, save_settings, list_input_devices, start_audio, stop_audio, ack_audio
  storage.rs                      設定JSON（schemaVersion=3、deny_unknown_fields、バックアップ、版の移行）
  audio/engine.rs                 入力ストリーム、固定容量キュー、解析スレッド、通知の受信確認
  audio/analysis.rs               ローパス→間引き→窓→YIN→安定判定
  audio/pitch.rs                  YIN推定（倍音補正つき）
  bin/audio-probe.rs, bin/audio-live-probe.rs   デバイス列挙、実入力の検証
tests/                            36件（TS）。fixtures/play-guitar-events.json は実機ギターE2の解析ログ
legacy/                           移行前のWeb版（PWA）。参照用
```

## 1.3 既存機能一覧（コードで確認したもの）

| 機能 | 実装の場所 | 状態・補足 |
| --- | --- | --- |
| 指板上の音名表示（全音名表示） | `view.ts` の mode=`study`、`board.ts` | ♯／♭／両方の表記を切り替えられる。0〜12F |
| 位置→音名 | mode=`forward`、`PracticeSession` | **入力による判定はない**。位置を出し、利用者が「答えを表示」で自己確認する |
| 音名→位置 | mode=`reverse` | 指定された弦の上で、範囲内の位置をクリックする。弦が同じで音高クラスが一致すれば正解（`core.isCorrect`） |
| コードトーン・スケールの指板表示 | `theory.ts` の `tonesFor`、`layers` | 19コード、21スケール。最大4層を重ねて比較できる。度数・音名ラベル、タップで詳細を表示 |
| コードシェイプ | `shapes.ts`、`#chord-shapes` ダイアログ | 標準チューニングと絶対音高が一致する場合だけ表示する |
| 楽器の切替 | ギター、4弦／5弦ベース | 楽器ごとに設定とチューニングを持つ |
| チューニング | 標準、Drop D（Drop A）、半音下げ、独自（12件まで） | 指板・出題・判定に一括で反映される |
| 出題範囲 | `range.ts` | 弦、フレット（0〜12）、ナチュラル音のみ |
| チューナー | `tuner/view.ts` | クロマチックと弦指定。A4は400〜480 Hz、入力レベル表示 |
| 単音の演奏練習 | `performance.ts`、`performance/view.ts` | 「N弦の X を演奏」の形式。**オクターブを含む絶対音高で判定**し、弦は問わない。許容幅は±5／10／20セント、安定時間は200／350／500 ms。結果はメモリ上だけに残り、保存しない |
| キーボード操作 | `view.ts` | Space で表示・次へ、矢印で移動、Enter で回答 |
| 設定の保存・書き出し | Rust の `storage.rs`、`transfer.ts` | JSONのバックアップ、破損からの復旧、旧版からの移行 |

**未実装**（コード上に存在しない）: コードトーンを答えるクイズ、インターバル問題、コード進行、メトロノーム、音の再生（Web Audio の利用なし）、聴音、リズム判定、オンセット（発音の立ち上がり）検出、学習履歴・統計・復習、録音。

## 1.4 音楽理論の実装（`src/domain/music/theory.ts`）

- **綴り（spell）は正しく実装されている。** `spell(root, degree)` は文字（letter）を度数の分だけ進め、必要な変化記号を付ける。`tonesFor('E♭','dom7')` は E♭・G・B♭・D♭ になる。dim7 の ♭♭7 は二重フラットで綴られる（C dim7 なら B♭♭）。
- 度数の書式は `R`、`♭3`、`♯11`、`♭♭7` など。9／11／13 は `(n-1)%7` によって 2／4／6 と同じ音高クラスになる。
- 内部の表現は**音高クラス（0〜11）**。オクターブは楽器側（`core.midi`）が持つ。
- `roots` は 17 種類（C, C♯, D♭, D, D♯, E♭, E, F, F♯, G♭, G, G♯, A♭, A, A♯, B♭, B）。**E♯・B♯・C♭・F♭ は含まない。** `pitchOf` と `spell` 自体は任意の綴りを受け付けるが、`normalize` は `roots` 以外の値を C に戻す。
- コードの定義は `{id, label, degrees, suffix, group}`。品質は major, minor, maj7, min7, dom7, half-dim, dim, dim7, aug, sus2, sus4, 7sus4, six, min6, minmaj7, add9, nine, maj9, min9 の 19 種類。
- 「コード名の文字列（例: `Dm7`）を解析する機能」「インターバル（m3、P5 など）の型」「ダイアトニックコードの生成」「キーの概念」は**ない**。
- テストは `tests/theory.test.cjs`（47行）と `tests/migration.test.ts`。後者は旧版との突き合わせで、680通りの組み合わせを比較する。

## 1.5 指板表示の仕組み

- `ui/fretboard-layout.ts` は、実際のフレット間隔の比率でCSS Gridの列を作り、ドット（3,5,7,9,12）を描く。**0〜12Fを前提とした値が埋め込まれている**（`length: 12`、`fret <= 12` が `board.ts`、`performance/view.ts`、`range.ts`、`view.ts` など8か所以上）。
- `Fretboard` クラス（`board.ts`）はセルのDOMを保持し、`render(state)` のたびにクラス・ラベル・内容を差分で更新する。描画の条件は `InstrumentSettings`（mode が study／forward／reverse）に結び付いている。**新しい練習で目印を自由に置ける汎用APIはない。**
- 演奏練習の指板（`#play-board`）は、`fretboardSurface` と `fretboardColumns` を使って別に組み立てた表示専用の盤面。
- `profiles.ts` で `fretCount: 12` に固定されている。Rust 側も `frets ≤ 12` で検証する（`PlaySettings::validate`）。

## 1.6 マイク入力と正誤判定の仕組み

### Rust 側（`src-tauri/src/audio/`）

```text
CPAL入力 → 選択チャンネルを取り出し、固定容量キューへ（コールバックでは解析しない）
→ 解析スレッド: 4次ローパス(≤1800 Hz) → 約12 kHzへ間引き → 窓2048サンプル(約170 ms)
→ 67 msごと（約15 Hz）に analyze()
   ├ 入力レベル(60 ms RMS) < しきい値(既定 -55 dB) → silence
   ├ ピーク ≥ 0.995 → clipping
   ├ YIN (25〜1500 Hz、倍音の補正つき)、信頼度 < 0.85 → unstable
   └ 連続3回の推定が30セント以内 → stable（中央値の周波数）
→ Observation {sessionId, sequence, audioTimeMs, state, frequency, levelDb, peak, confidence, droppedSamples, message}
→ Tauri Channel。画面の受信確認(ack)が2秒途切れたら停止。入力が1秒途切れても停止
```

**取得できる情報**
- 単音の基本周波数（stable のときだけ）、入力レベル、ピーク、信頼度、状態。
- `audioTimeMs` は入力デバイスのサンプル番号から求めた時刻で、**最後に受け取ったフレームの時刻**。発音の時刻ではない。

**取得できない情報**
- **和音（複数の音高）。** YIN は単音の推定器なので、和音を認識できない。
- **オンセット（発音の瞬間）と再アタック。** 同じ音を2回続けて弾いても区別できない。音の区切りとして分かるのは silence と unstable だけ。
- 弦・フレット（同じ音高なら、どの弦で弾いたかは分からない）。

**時間分解能と遅延**
- 通知は約67 msおきで、窓は約170 msある。stable には3回連続の一致が必要なため、発音から最初の stable まで**およそ200〜450 ms**かかる。実機ギターE2のログ（`tests/fixtures/play-guitar-events.json`）では、最初の stable が約440 msだった。
- そのため、リズムの正確さ（±数十 ms）を今のエンジンで判定することは**できない**。

### TypeScript 側

- `AudioController`（`platform/audio.ts`）が開始・停止・セッションID・順序番号・受信確認・ウォッチドッグを管理する。古いセッションや時刻が逆行した通知は捨てる。
- `PerformanceSession`（`domain/practice/performance.ts`）は、**目標を1つの `midi` 値**として、セント差が許容幅に収まる stable 通知が `holdMs` 続いたときに正解とする。外れた音が `holdMs` 続いた場合は誤答として1回だけ数える（同じ音を伸ばしても重複して数えない）。通知の間隔が250 msを超えたら、それまでの証拠を破棄する。
- 前の問題で伸ばしていた音が次の問題の目標と同じ高さなら、そのまま正解になりうる。出題の並びは、可能な限り同じ高さが続かないようにしている。
- **`AudioController` は `mountTuner` が生成して所有している。** 音声を使うモードは `'tuner' | 'play'` に固定されている。

### プライバシー

音声は Rust の中で解析だけに使われ、保存も送信もしない。画面に渡るのは解析結果だけ。CSP によって外部への通信も遮断されている。

## 1.7 練習モードの構成

- 左の機能タブは「指板学習」「チューナー」「演奏練習」の3つ（`index.html` の `data-feature`）。`main.ts` は study と tuner の2パネルを切り替え、tuner パネルの中で tuner 表示と play 表示を切り替えている。
- 指板学習の中には学習モードのボタンが3つある（位置→音名／音名→位置／全音名表示）。
- 画面は「中央の練習」と「右の設定パネル」の2列。700 px 以下では「表示・出題設定」で設定パネルを開閉する。

## 1.8 データの保存方式

- Rust が `settings.json` に保存する（アプリデータ領域 `jp.fretnotes.desktop`）。直前の正常な状態のバックアップと、版ごとのバックアップ（`settings.v1/v2.backup.json`）を残す。
- **schemaVersion=3。Rust の構造体は `deny_unknown_fields` を指定している。** 項目を追加するには、TS と Rust の両方で schemaVersion=4 への移行を書く必要がある。
- `profiles`（楽器ごとの学習設定）は Rust では `Value` として受け取るが、`Settings::validate` で次の点を検証している。
  - 項目数は16以下。
  - `strings` / `frets` の範囲（フレットは12以下）。
  - `mode` は forward/reverse/study のどれか。
  - `notation`、`studyView`、`toneLabels` の値。
  - 真偽値の項目。
  - **学習モードを1つ追加するだけでも、Rust 側の許可リストの変更が必要になる。**
- 書き出し・読み込みの上限は64KB（`transfer.ts`）。
- 練習結果・履歴は**保存していない**。
- ブラウザーのプレビュー（`npm run dev`）では、localStorage を使う代替の保存先に切り替わる。

## 1.9 再利用できる部分

| 資産 | 再利用の方法 |
| --- | --- |
| `spell` / `tonesFor` / `pitchOf` / `interval` | コードトーン、インターバル、ダイアトニックの綴りを計算する土台。綴りの規則は正しい |
| コードとスケールのカタログ | 出題対象の品質一覧。テンションは後からエントリを追加する |
| `core.create(profile)` | 弦・フレット⇔音高クラス／MIDI、範囲の判定。どのトレーナーでも位置計算に使える |
| `PracticeSession` の「一巡するまで重複しない」出題方式 | 新しい出題デッキでも同じ方式を使う |
| `PerformanceSession` の証拠管理（安定時間、誤答1回カウント、セッション・時刻の検証） | **新しい音声判定の中核。** 目標を「判定条件（matcher）」へ一般化して再利用する |
| `AudioController` | 単一の入力を全モードで共有する。所有者だけを外へ移す |
| `range.ts` / `tuning.ts` | 範囲とチューニングのUIを部品として使う |
| `fretboardSurface` / `fretboardColumns` | 新しい表示専用の指板の骨格 |
| `SettingsRepository` の保存キュー、Rust の保存・バックアップ方式 | 学習記録ストアを同じ方式で作る |
| 解析ログのフィクスチャを再生するテスト | 音声判定の回帰テストの型として使う |

## 1.10 技術的課題・リファクタリングが必要な部分

1. **音声の所有者が固定されている。** `mountTuner` が `AudioController` を生成し、モードを `'tuner'|'play'` に固定している。新しい音声モードを追加する前に、controller の生成を `main.ts` へ移し、通知を「現在表示している機能」へ流す最小限の変更が必要。
2. **判定の目標が1つの midi に限られている。** 音高クラス一致（オクターブを問わない）、複数の正解、音域の窓に対応するため、判定条件を抽象化する。
3. **0〜12Fが埋め込まれている。** 15F以上に拡張するには、レイアウト、範囲UI、Rust の検証、シェイプの上限を合わせて変える必要がある。後回しにしてよい（7章を参照）。
4. **指板の描画が指板学習の状態に結び付いている。** 新しいトレーナー用に、目印を自由に置ける表示専用の指板が必要。
   - 新しいトレーナーは `board.ts` を使わず、別の部品を使う。
   - 既存の `board.ts` には、指板学習の「全位置探索」（P4）のための小さな追加だけを行う。
5. **設定ファイルが厳格。** 新しい設定・記録を `settings.json` へ入れると、schema の移行が必要になり、64KBの上限にも当たる。学習記録とトレーナーの設定は、別のストアに保存するのが妥当。
6. **ルートの綴りに制限がある。** `roots` に E♯・C♭ などがないため、F♯ メジャーの vii（E♯m7♭5）や G♭ メジャーの IV（C♭maj7）を扱えない。新しい和声モジュールでは、綴りを `pitchOf` が受け付ける正規表現で検証し、`roots` には依存しない。
7. **音を出す仕組みがない。** 聴音とメトロノームには Web Audio API を使う（WebView2 で使え、外部ライブラリは不要）。
8. **オンセットを検出できない。** リズムの判定と同音の連打には、Rust への追加実装が必要。
9. **実機での確認が終わっていない。** 0.4.0 の文書には「最終推定器による実演奏、ベース低音、抜き差し・スリープは未検証」とある。音声の判定に依存する機能を増やす前に、短い実機確認を行う（Phase 0）。
10. **文書とコードに食い違いがある。**
    - README と `migration-progress.md` は「演奏練習の範囲は指板学習の範囲を使う」と書いている。コードでは、演奏練習が独自の `PlaySettings`（範囲・チューニング）を持つ（`SettingsRepository.play`）。
    - `migration-progress.md` は「推奨位置を表示」と書いている。現在の画面は弦番号だけを示し、指板には位置を表示しない。
    - 今後の実装プロンプトは、コードを正として扱う。
11. **コードの書き方が混在している。** `theory.ts`、`shapes.ts`、`view.ts` は1行に詰めた密度の高い書き方で、新しいファイルは比較的読みやすい。既存ファイルを整形し直すことは不要な大規模変更にあたるため、行わない。新しいファイルは `performance.ts` の書き方に合わせる。
12. **対象の端末。** 現在は Windows デスクトップ版だけ（CPAL、Tauri デスクトップ）。スマートフォン・タブレットには配布していない。レスポンシブ対応は「ウィンドウ幅 700 px 以上」が前提になっている（7章で扱う）。
