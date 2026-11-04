# P4 指板トレーニングの拡張

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は、既存の「指板学習」と「演奏練習」を拡張し、指板全体の音名を瞬時に認識し、どこでも弾けるようにする練習を強化します。

## 目的
- 仕様は `docs/training-expansion/03-feature-specs.md` の §3.1。
- 追加する機能
  1. 全位置探索（範囲内のすべての「B」をクリックする）
  2. 位置→音名を、選択肢または音名の入力で答えて判定する（今は自己確認だけ）
  3. 反応時間の計測と記録
  4. 演奏練習の「オクターブ自由」（音高クラスで判定する）

## 最初に確認すること（既存コード）
- `src/domain/instruments/core.ts`: `PracticeMode = 'forward'|'reverse'|'study'`、`normalize`、`candidates`、`isCorrect`、`name`。
- `src/domain/practice/session.ts`: `PracticeSession`（`QuizState`、`answer`、`reveal`、`next`）。
- `src/features/fretboard-study/view.ts`
  - `mountStudy`（`.mode` ボタン、`render`、`primary`、`answer`、キーボード処理）。
  - `#answer-area` と `#question-help` の文言。
- `src/features/fretboard-study/board.ts`: `Fretboard.render` のクラスの付け方（`correct`、`wrong`、`target`、`outside`）と aria-label。
- `index.html` の `.modes` ナビ。
- P2 で入った `PitchMatcher` と音声ハブ。P3 の `TrainingRepository`。
- `src/features/performance/view.ts`（`#play-tolerance`、`#play-hold`、`newSession`）と `PlaySettings`（`src/platform/settings.ts`）。

## 変更対象と要件
1. **全位置探索**
   - `PracticeMode` に `'find-all'` を追加し、TS の `normalize` の許可リストにも加える。
   - **注意: Rust の `src-tauri/src/storage.rs` の `Settings::validate` は、`profiles` の `mode` を `["forward","reverse","study"]` に限定して検証している。また、profile の項目数は16以下に制限している。**
     - `"find-all"` を Rust の許可リストに加え、Rust のテスト（保存と復元）を追加する。
     - 古い版（0.4.x）へ戻すと、この設定を読み込めずにバックアップから復旧することになる。この点を `docs/migration-progress.md` に明記する。
     - 新しい表示設定（回答方法など）は profile に足さず、P3 の `TrainingRepository.updatePreferences` に保存する。項目数の上限と schema の変更を避けるため。
   - 出題: 範囲内に1か所以上ある音高クラスをデッキにする（一巡するまで重複させない）。
   - 回答: クリックで選んだ位置を切り替える（もう一度クリックすると解除）。「完了」（Space）で採点する。
   - 表示: 正しい位置を緑、誤った位置を赤、見落とした位置を輪郭で示す。正解の綴りは表記設定に従う（ナチュラル音でない場合は C♯ / D♭ のように両方）。
   - 結果: 見つけた数 / 該当する数、誤って選んだ数、時間。全部を正しく見つけ、誤りがなければ correct とする。
   - 記録: 項目ID `note:<楽器>:<音高クラス>`、層は fretboard。
2. **位置→音名の判定**（既存の forward モードに「回答方法」を追加する）
   - 既定は今と同じ「自己確認」。オプションで「選択肢（4択）」と「音名の入力（A〜G＋♯/♭）」を選べるようにする。
   - 選択肢・入力では、ナチュラル音でない場合、♯/♭ のどちらの綴りでも正解にする。文脈のない単独の音名なので、§3.0.2 の綴りの厳密さは適用しない。
   - 記録: 項目ID `fb:<楽器>:<弦>:<フレット>`、層は knowledge。
   - 自己確認のモードでは記録しない（または `self-marked` として記録する）。
3. **反応時間**: 出題の表示からクリック・回答までを `performance.now()` で測り、`Attempt.responseMs` として記録する。結果の欄に、今回の平均と中央値を表示する。
4. **演奏練習のオクターブ自由**
   - 演奏練習の入力設定の欄（`index.html` の `.play-options`。`#play-tolerance` と `#play-hold` がある欄）に、「オクターブ: 指定／自由」を追加する。
   - 保存先は `TrainingRepository.updatePreferences`。`settings.json` の `playOptions` は変更しない。
   - 自由の場合は、`PlayTarget.accept` に音高クラスの matcher を設定する。音域の窓は `playTargets` が返す範囲の最低〜最高の MIDI にする。
   - 表示は「E を演奏（どのオクターブでも）」とする。
5. **既存の reverse・study・演奏練習の挙動は変えない。**

## UI・UX 要件
- モードのボタンが4つになっても、700 px の幅で折り返しが崩れないようにする（CSS は既存の `.modes` に合わせる）。
- キーボード操作
  - 全位置探索: 矢印で移動、Enter で選択の切り替え、Space で完了・次へ。
  - 選択肢: 1〜4。
  - 音名の入力: A〜G と ↑（♯）↓（♭）、Enter で確定。
- 指板学習の `document.addEventListener('keydown', …)` の除外条件（入力欄、ダイアログ）を守る。

## 音声認識との連携要件
- オクターブ自由は P2 の matcher で実現する。新しい判定のロジックを書かない。

## 音楽理論の検証事項
- 全位置探索の正解の集合が、`core.candidates(settings)` のうち音高クラスが一致するものと完全に一致する。Drop D、5弦ベース、独自チューニングでも確かめる。
- 演奏練習で、オクターブ自由のときに E2 の目標に E3・E4 が正解になる。範囲外の E（窓の外）は誤答になる。

## テスト
- 全位置探索の状態を扱うロジックは、`session.ts` に追加するか、新しい小さなクラスにする。そのテストを書く: 選択の切り替え、完了、見落とし、誤選択、空の範囲。
- forward の選択肢の生成: 正解を含む4択で、重複がなく、異名同音を別の選択肢にしない。
- 既存のテスト（`migration.test.ts` の出題の一巡など）が変わらずに成功する。

## 動作確認
- プレビューで4つのモードとキーボード操作を確認する。ギター→5弦ベース→Drop D の切り替えで、出題が作り直されることを確認する。
- 実機があれば、オクターブ自由の演奏で E3 を弾いて正解になることを確認する。

## 完成条件
- §3.1 の受け入れ条件。全テストが成功する。版は 0.5.0 にする。
- README に新しいモードを記載する。

## 次のフェーズとの関係
- 回答方法（選択・入力・クリック・演奏）の部品は、P5 のハーモニー・トレーナーで共通化して再利用する。共通化できそうな部品（音名入力のキーボード処理、4択の生成）は `src/features/` の下に独立した関数として作っておく。

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
