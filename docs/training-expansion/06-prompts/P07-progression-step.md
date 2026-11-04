# P7 進行モデル・進行ライブラリ・ステップ式のコードチェンジ

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は新しい機能タブ「進行」を作り、コード進行に合わせてコードトーンを弾く練習を、**テンポのないステップ式**（正解すると次のコードへ進む）で実装します。

## 目的
- 仕様は `docs/training-expansion/03-feature-specs.md` の §3.5（段階1〜6、ステップ式）、`04-architecture.md` の §4.6。
- 内容
  - 進行のデータモデル
  - 同梱の進行ライブラリ（調を移せる）
  - 利用者による進行の入力・保存・編集・削除・複製
  - ステップ式のコードチェンジ（段階: ルート、3rd、7th、3rdと7th、任意のコードトーン、テンションの追加）

## 最初に確認すること（既存コード）
- P1 の和声エンジン: `parseChordSymbol`、`chordName`、`toneByRole`、`chordTones`、`diatonicSevenths`、`transposeProgression`。
- P2 の matcher、`SequenceTracker`、音声ハブ。P3 の `TrainingRepository`（`progressions` の保存先、件数の上限100）。
- P5 の画面の骨格と表示専用の指板。
- `docs/training-expansion/04-architecture.md` の §4.4.2（`Progression` の型）。

## 変更対象と要件
1. ドメイン（新規・提案名 `src/domain/training/progression.ts`）
   - 型は `Progression`、`ProgressionChord`（§3.5 の10）。
   - `parseProgression(text)`
     - 入力の書式は `Dm7 G7 | Cmaj7 | Cmaj7 |`。小節は `|` で区切る。1小節に複数のコードを書いた場合は、拍を等分する。
     - 未対応の記号は、どの小節の何番目かを示すエラーにする。
   - `formatProgression`: `parseProgression` の逆変換。往復できること。
   - 同梱のライブラリ（`builtinProgressions`）
     - メジャー: I–IV–V–I、ii–V–I、I–vi–ii–V、iii–vi–ii–V–I
     - ナチュラルマイナー: i–iv–v–i、i–♭VI–♭VII–i
     - II–V–I: メジャー（ii7–V7–Imaj7）／マイナー（iiø7–V7–im7。V7 はハーモニックマイナー由来）
     - セカンダリードミナント: I–VI7–ii7–V7、I–II7–ii7–V7–I
     - 12小節ブルース
       - 基本型: I7 | IV7 | I7 | I7 | IV7 | IV7 | I7 | I7 | V7 | IV7 | I7 | V7
       - ジャズブルース型（F の場合）: F7 | B♭7 | F7 | Cm7 F7 | B♭7 | Bdim7 | F7 | Am7 D7 | Gm7 | C7 | F7 D7 | Gm7 C7
       - 6小節目は ♯iv°7（F なら Bdim7）。バリエーションが多い型なので、「一般的な一例」と説明に書く。
     - 上記はローマ数字で保持し、選んだ調で実体化する。
   - `stageTargets(chord, stage)`: 段階に応じた `PitchMatcher` の集合を返す。
     - 3rd のないコード（sus）では、段階2でルートか4thに置き換え、`substituted: true` を返す。
     - 7th のないコードでは、段階3で 3rd に置き換える。
     - 段階6（テンションを追加）は、`docs/training-expansion/03-feature-specs.md` §3.5 の「段階6の9thの規則」に従う。
       - 既定: 構成式にある9thだけを使う。
       - オプション: 調のある進行に限り、調の音階から9thを導く。マイナーの V7 と iiø7 は ♭9。調の外のコードには9thを許可しない。
       - テスト: C マイナーの ii–V–i で、G7 の9thが A♭ になる。Dm7 は既定では9thを許可しない。
   - 曲のメロディ・歌詞は同梱しない。進行は一般的な型だけにする。
2. 画面（新規・提案名 `src/features/progression/view.ts`）
   - 機能タブ「進行」を追加する。
   - 上部: 進行表。小節を横に並べ、現在のコードを強調する。
   - 中央: 巨大な「G7 → 3rd」。答えの音名（B）は設定で表示・非表示を切り替える。
   - その下: 次のコードを小さく表示する。
   - 下部: 指板（任意。ガイドの表示はオン／オフ／正解後だけ）。
   - 進行の選択（ライブラリ／自作）、調、段階、繰り返し回数、音域の窓（最低〜最高の音、またはフレットの窓から求める）。
   - 進行の編集画面: テキスト入力とプレビュー（解析結果を小節表で示す）、保存・複製・削除（確認つき）。
   - 操作
     - Space: 開始／一時停止
     - ←→: 1つ戻る／進む
     - 正解したら自動で次のコードへ進む
     - 最後まで来たら、繰り返すか、結果を表示する
   - 結果: コードごとの成否（色と記号）、反応時間、苦手な品質と度数。
3. 判定
   - 段階1〜3と5〜6: 音高クラスの集合の matcher。
   - 段階4（3rdと7th）: `SequenceTracker` の順番なし。
   - **共通音の扱い**: `docs/training-expansion/04-architecture.md` §4.3.3「共通音の保持の規則」に従う。
     - 前のコードの正解音を伸ばしたまま、それが次のコードでも正解である場合（例: Dm7 の F → G7 の F）は正解にする。
     - この扱いを画面の説明にも書く。
     - テストに「伸ばしたまま」のケースを入れる。
   - 記録: 項目ID は `chg:<quality>:<role>`（ルートに依存しない集計）と、`ct:<quality>:<root>:<role>`（P5 と共通。層は performance）の両方に記録する。

## UI・UX 要件
- 演奏中にほとんど画面を操作しなくて済むようにする。
- 先読み（次のコード）を見やすくする。
- 進行表は700 px の幅で折り返して表示する。

## 音声認識との連携要件
- 音声ハブを使う。タブの切り替え、最小化、入力の中断で一時停止し、同じコードから再開する。
- 判定は matcher と `SequenceTracker` だけで行う。

## 音楽理論の検証事項（テストで確認する）
- 同梱の全進行を12調で実体化したとき、`parseChordSymbol(chordName(c))` が元に戻る。各コードの構成音の綴りが P1 と一致する。
- マイナー II–V–I（C マイナー）は Dm7♭5 – G7 – Cm7 で、G7 の 3rd が B（ナチュラル）になる。
- ii–V–I を F♯ メジャーで実体化すると G♯m7 – C♯7 – F♯maj7 になる。G♭ メジャーなら A♭m7 – D♭7 – G♭maj7。
- `parseProgression` の往復、エラーの位置、1小節に2つのコードがある場合の拍の配分。
- sus と 6 のコードでの置き換え。

## テスト
- 上記と、ステップ式の進行の状態（開始、正解で進む、戻る、繰り返し、一時停止と再開）。合成した観測列で、段階2〜4の判定を確認する。

## 完成条件
- §3.5 のステップ式の受け入れ条件。自作の進行が再起動後も残る。全テストが成功する。版は 0.7.0 にする。

## 次のフェーズとの関係
- P8 で、この画面にメトロノームと自動進行を追加する。
- P9 で、段階「ライン」（ボイスリーディング）を追加する。
- 進行の状態は、テンポの有無に依存しない形（「現在のコードの番号」を外から進められる形）にしておく。

## 共通ルール（必ず守ること）
- 作業前に CLAUDE.md、docs/training-expansion/ の該当節、docs/migration-progress.md を読む。仕様と実際のコードが食い違う場合は、コードを確認したうえで食い違いを報告し、既存の挙動を壊さない側を選ぶ。
- 既存の機能を削除・変更しない（このプロンプトで明示した変更を除く）。既存のテストを削除しない。
- 新しいライブラリ・外部API・クラウドサービスを追加しない。src-tauri/tauri.conf.json の CSP（connect-src）を広げない。
- 音声データを保存・送信しない。テスト用のフィクスチャは解析結果（時刻・状態・周波数・レベル）だけにする。
- 音楽理論と判定のロジックは、DOM に依存しない src/domain/ に置き、tests/*.test.ts（node --test、tsx）で表を使ったテストを書く。
- ギター、4弦／5弦ベース、任意チューニングのすべてで動くようにする。単音認識しかできない前提を守り、和音認識を前提にしない。
- 新しいファイルの書き方は src/domain/practice/performance.ts に合わせる。既存ファイルを整形し直さない。不必要な大規模リファクタリングをしない。
- 完了時:
  1) npm.cmd test、npm.cmd run typecheck、cargo test --manifest-path src-tauri/Cargo.toml --lib をすべて成功させる。
  2) 開発プレビュー（.claude/launch.json の web）で、新機能と既存の3機能（指板学習・チューナー・演奏練習）を操作して確認する。
  3) docs/migration-progress.md と README.md を更新する。実装したこと、検証したこと、未検証のことを分けて書く。
  4) 版を上げる場合は package.json、src-tauri/tauri.conf.json、src-tauri/Cargo.toml を揃える。installer/fret-notes.iss の AppId は変更しない。
  5) 最後に npm.cmd run desktop:install を実行する。
- git のコミット・プッシュは、利用者の指示があるまで行わない。
