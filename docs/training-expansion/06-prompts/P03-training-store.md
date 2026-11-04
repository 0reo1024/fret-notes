# P3 学習記録ストアと記録タブ（最小）

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は、練習の結果をローカルに保存する**新しいストア**を、既存の設定ファイルとは別に作ります。あわせて、最小限の「記録」タブを作ります。

## 目的
- 試行（Attempt）、項目ごとの統計（ItemStat）、日別の集計、トレーナーの設定、利用者が作った進行を、`training-data.json` に保存する。
- 間隔反復の計算（review 関数）を純粋関数として用意する。
- 仕様は `docs/training-expansion/04-architecture.md` の §4.4、`03-feature-specs.md` の §3.11。

## 最初に確認すること（既存コード）
- `src-tauri/src/storage.rs`
  - `SettingsStore` の読み込み・書き込み・バックアップ・復旧・新しい版の保護の方式。一時ファイルを使うか、置き換えの順序はどうなっているかを確認する。
  - `deny_unknown_fields` と `migrate`。
- `src-tauri/src/lib.rs`（command の登録）、`src-tauri/capabilities/main.json`、`src-tauri/build.rs`。アプリ独自の command に権限の設定が必要かどうかを確認する。
- `src/platform/settings.ts`
  - `SettingsRepository`（保存のキュー、`flush`、`onStatus`）。
  - `settingsBackend`（Tauri か localStorage かの切り替え）。
  - `decodeSettings` の検証の書き方。
- `src/platform/window-lifecycle.ts` と `main.ts` の `onCloseRequested`（終了時の保存待ち）。
- `src/features/settings/transfer.ts`（設定の書き出し・読み込み。64KB の上限）。

## 変更対象
1. Rust（新規・提案名 `src-tauri/src/training.rs`）
   - `TrainingStore` を作る。`load() -> {data: Value, recovered: bool}`、`save(Value)`。
   - 検証は最上位の項目と `schemaVersion == 1`、サイズの上限 8 MB とする。
   - 書き込み・バックアップ・破損からの復旧・新しい版の保護は、`storage.rs` と同じ方式にする。
   - command: `load_training_data`、`save_training_data`。`lib.rs` に登録する。
   - **`settings.json` と `storage.rs` の Settings 構造体は変更しない。**
   - Rust のテスト: 保存と復元、破損したときのバックアップからの復旧、新しい版を上書きしないこと、サイズの上限。
2. TS（新規・提案名 `src/domain/training/records.ts`）。純粋関数として次を作る。
   - 型: `TrainingData`、`Attempt`、`ItemStat`、`SkillLayer`、`DailySummary`（§4.4.2 のとおり）。
   - `decodeTrainingData(input): TrainingData`（厳格な検証。未知の版は拒否する）、`emptyTrainingData()`。
   - `review(stat, attempt, now, targetMs)`（§4.4.3）。
   - `record(data, attempt, now, targetMs)`: 統計・日別集計・リングバッファ（2,000件）を更新し、新しいデータを返す。
   - `isMastered(stat, targetMs)`: 箱が4以上で、直近5回の中央値が目標以下。
   - 日付はローカル時刻の `YYYY-MM-DD` で扱う。時計が戻った場合は `dueAt` を進めない。
3. TS（新規・提案名 `src/platform/training-store.ts`）
   - `TrainingRepository` を作る。`load`、`add(attempt)`、`flush`、`updatePreferences(key, value)`、`exportJson`、`replace(input)`。
   - 保存は30秒ごと、明示的な `flush`、終了時にまとめて行う。
   - プレビュー用に localStorage の代替（キー `fret-notes-training-preview-v1`）を用意する。
   - `main.ts` の終了処理で、設定の `flush` と並べてこのストアの `flush` を待つ。
4. UI（最小）
   - 左の機能タブに「記録」を追加する（`index.html` の `.feature-tabs` と `main.ts` の切り替え）。
   - 既存のタブ（study/tuner/play）の切り替えの挙動を壊さない。
   - **注意: 今の `main.ts` は `showTuner = button.dataset.feature !== 'study'` と判定している。** そのまま新しいタブを追加すると、チューナーのパネルが開き、`tuner.show(true,'tuner')` が呼ばれてしまう。次の3点を必ず実装する。
     1. タブ（`data-feature`）と表示するパネルを、1対1の表で対応させる。
     2. tuner / play 以外のタブでは `tuner.show(false)` を呼び、音声入力を止める。
     3. 指板学習の `document` レベルの `keydown`（`src/features/fretboard-study/view.ts`）は、今は `body.tuner-open` のときだけ処理をやめる。
        - 新しいタブでも Space などが指板学習の `primary()` を動かさないよう、「自分のパネルが表示されているときだけ処理する」条件に変える。
        - 新しいトレーナーのキー処理にも、同じ条件を付ける。
   - 確認: 記録タブで Space を押しても、指板学習の出題が進まないこと（プレビューで確認し、可能ならテストにする）。
   - 記録パネルに表示するもの: 今日・直近7日の練習時間と問題数、項目数、定着した項目数、復習が必要な項目数。
   - 記録の書き出し・読み込み（置き換え、確認つき）、消去（確認つき）。

## 音声認識との連携要件
- このフェーズでは、既存の演奏練習の結果（`PlayResult`）を記録へ送るだけにする。
  - 項目ID は `play:<楽器>:<midi>`、層は performance。
  - 許容範囲外の安定した音（`wrongAttempts`）は wrong として送らない。正解までの経過として `errorKind` に回数を残す。
  - 正解までにかかった時間を `responseMs` にする（「検出遅延を含む」）。

## テスト
- `review`: 昇格、降格、目標時間を超えたときに据え置き、`detection-issue`・`skipped`・`self-marked` で変わらない、期限の計算、日付の逆行。
- `record`: リングバッファの上限、日別の集計、同じ項目の層の分離。
- `decodeTrainingData`: 不正な型、件数の上限、未知の版の拒否。
- Rust のテスト（上記）。
- 終了時の保存待ち（`tests/window-lifecycle.test.ts` と同じ形で、2つのストアを待つことを確認する）。

## 実装時の注意点
- 設定ファイルの schemaVersion は 3 のままにする。
- 書き込みが失敗したときは、`#save-status` と同じ形でメッセージを表示する。終了時は既存の「書き出しの機会」を提示する仕組みに合わせる。
- 記録は個人の端末にだけ保存する。送信の機能は作らない。

## 完成条件
- 演奏練習で正解すると、記録タブの今日の問題数が増え、アプリを再起動した後も残る（実機で確認。プレビューでは localStorage で確認）。
- 全テストが成功する。版は 0.4.2 にする。

## 次のフェーズとの関係
- P4 以降の全トレーナーは `TrainingRepository.add` で試行を記録する。P15 でこのデータを使って分析と出題の重み付けをする。

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
