# P5 ハーモニー・トレーナーとコードトーン瞬間回答（3rd/7th 重視）

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は新しい機能タブ「ハーモニー」を作り、最初の出題の種類として**コードトーン瞬間回答**を実装します。これはアプリの最重要機能です。

## 目的
- コード名を見た瞬間に 3rd・7th などが分かり、それを指板で見つけ、弾けるようにする。
- 回答方法は4種類: 選択肢、音名の入力、指板クリック、演奏。
- 仕様は `docs/training-expansion/03-feature-specs.md` の §3.0 と §3.2、`04-architecture.md` の §4.1.2（共通の骨格）と §4.6。

## 最初に確認すること（既存コード）
- P1 の和声エンジン（提案名 `src/domain/music/harmony.ts`）: `toneByRole`、`chordTones`、`chordName`、`samePitchClass`。実際の名前を確認する。
- P2 の `PitchMatcher`、`PerformanceSession` の `accept`、`SequenceTracker`、音声ハブ、`mountAudioSettings`。
- P3 の `TrainingRepository`、`review`。
- P4 で作った回答方法の部品（4択の生成、音名の入力のキーボード処理）があれば再利用する。
- `src/ui/fretboard-layout.ts`（`fretboardColumns`、`fretboardSurface`、`inlayFrets`）と、`performance/view.ts` の `renderBoard`（表示専用の指板の組み立て方）。
- `src/app/main.ts` と `index.html` の機能タブ（P3 で汎用化したもの）。
- `src/domain/instruments/core.ts` の `create`、`candidates`、`pitch`、`midi`。

## 変更対象
1. ドメイン（新規・提案名 `src/domain/training/tone-questions.ts`）
   - `ToneQuestion` の生成器を作る。入力は度数のモード（third / seventh / guide（3rd と 7th）/ all / ninth）、品質の集合、ルートの集合、乱数。
   - 一巡するまで重複させず、同じ問題を連続させない（`PracticeSession` の方式に合わせる）。
   - §3.0.4 の表に従い、該当する度数がないコードを除外する。
   - `checkNameAnswer(question, spelled, strict)`: 結果は correct / spelling / wrong。wrong の場合は `errorKind`（quality-confusion / degree-confusion / other）を付ける。
   - `choices(question, random)`: 正解、品質を取り違えた音（長3度と短3度、長7度と短7度）、別の度数（5th、ルート）、近い音から4択を作る。綴りが厳密なときは、異名同音の選択肢を1つ混ぜてよい。
   - 項目ID は `ct:<quality>:<root>:<role>` とする。guide の場合は `ct:<quality>:<root>:guide`。
2. 表示専用の指板の部品（新規・提案名 `src/ui/marked-fretboard.ts`）
   - 引数: `InstrumentProfile`、フレットの範囲、目印の配列 `{position, label, tone: 'root'|'target'|'correct'|'wrong'|'hint'}`、クリック時のコールバック（任意）。
   - `fretboardSurface` と `fretboardColumns` を使う。**既存の `board.ts` は変更しない。**
   - aria-label には弦・フレット・音名・度数を含める（既存の方針に合わせる）。
3. 画面（新規・提案名 `src/features/harmony/view.ts`）
   - 機能タブ「ハーモニー」を追加する。サブタブ（出題の種類）は、今回は「コードトーン」だけ有効にする。インターバル・アルペジオ・知識は P6 で追加する（グレーで「準備中」と表示するか、まだ出さない）。
   - 共通の骨格（§4.1.2）
     - 出題カード: 例は「G7」と「3rd ?」。guide のときは「3rd と 7th」。
     - 回答エリア、結果、指板。
     - 右パネルに設定と音声入力（`mountAudioSettings`）。
   - 回答方法の切り替え: 選択／入力／指板／演奏。設定は `TrainingRepository.updatePreferences('harmony', …)` に保存する。
   - 正解: 緑で600 ms 表示し、自動で次へ進む。
   - 誤答: 正しい綴りと度数を表示し、指板に該当する全位置を度数ラベルで表示する。Space で次へ進む。
   - 指板クリック: 範囲（弦・フレット）は、指板学習の `range.ts` を再利用して設定できるようにする。正誤は音高クラスで判定する（§3.0.2）。
   - 演奏
     - matcher は音高クラス。音域の窓は楽器の範囲（開放の最低音〜最高弦の12F）。
     - 安定時間の既定は 200 ms。
     - guide のときは `SequenceTracker` の順番なしで、2音を判定する。
     - 誤った安定音は「A♯ / B♭ が聞こえました（G7 の ♯9 にあたる音。G から短3度）」のように度数で説明する。度数の名前は、そのコードのルートからのインターバルで求める。
     - **「スキップ（S）」と「正解として扱う（自己判定）」のボタンを常に表示する。**
   - 時間制（なし／5秒／3秒／2秒）と問題数（10／20／60秒の時間制）。
   - 結果: 正解数、平均と中央値の反応時間、誤答の分類ごとの件数、間違えた問題の一覧。
4. 記録
   - 1問ごとに `Attempt` を記録する。層は、選択・入力なら knowledge、クリックなら fretboard、演奏なら performance。
   - `detection-issue`（入力過大の継続、入力の中断）と `skipped` を正しく分類する。

## UI・UX 要件
- ギターを持ったまま操作できるようにする。
  - Space: 開始／次へ
  - 1〜4: 選択
  - A〜G と ↑↓、Enter: 入力
  - S: スキップ
  - 演奏モードでは、画面に触れずに連続して練習できる。
- 出題カードは最大の文字にする。700 px の幅でも出題と正誤が見えること。
- 色だけに頼らず、文字（「正解」「B が正解」）でも示す。

## 音声認識との連携要件
- 音声入力の開始と停止は、P2 の音声ハブを通す。タブを切り替えたら一時停止する（既存の方針）。
- 演奏の判定は matcher と `SequenceTracker` だけで行い、独自の判定を書かない。
- 新しい問題に切り替えたら、証拠を破棄して集め直す（既存の `PerformanceSession.advance()` と同じ方式）。
  - 伸ばしている音は、`holdMs` の後に新しい問題で改めて判定される。
  - そのため、生成器は**同じ答えの音高クラスを持つ問題を連続させない**（例: G7 の 7th(F) の次に Dm7 の 3rd(F) を出さない）。
  - 詳細は `docs/training-expansion/04-architecture.md` §4.3.3「共通音の保持の規則」を参照。

## 音楽理論の検証事項（テストで確認する）
- 段階1〜3の全品質 × 標準12ルート × 全モードで、出題の正解が P1 の `toneByRole` と一致する。
- sus 系に3rd、6/m6/トライアドに7thを出題しない。
- dim7 の7thは `♭♭7`（C dim7 → B♭♭）。表示と記録の両方で正しく扱う。
- 名前の判定: E♭7 の 3rd に「G」が正解、「F𝄪」（`F♯♯`）は spelling、「G♭」は wrong（quality-confusion）。
- 選択肢に正解がちょうど1つだけ含まれる。
- 演奏: G7 の 3rd で B2・B3 のどちらも正解。B♭ は wrong（quality-confusion）で、度数の説明は ♯9（G から短3度。♭9 は A♭）。
- guide のとき、F→B でも B→F でも完了する。

## テスト
- 上記に加え、生成器の一巡と連続回避、時間切れの記録、フィクスチャの再生（P0 のログ、または合成した観測列）による演奏の判定。

## 動作確認
- プレビューで、4つの回答方法すべてを操作して確認する。ギター→4弦ベース→Drop D でも確認する。
- 既存の指板学習・チューナー・演奏練習が今までどおり動くことを確認する。
- 実機があれば、演奏で10問を解いて、記録タブに反映されることを確認する。

## 完成条件
- §3.2 の受け入れ条件。全テストが成功する。版は 0.6.0 にする。README に「ハーモニー」を記載する。

## 次のフェーズとの関係
- P6 は同じ画面にインターバル・アルペジオ・知識の出題を追加する。このため、出題の種類ごとに生成器と判定を差し替えられる構造にしておく。
  - 例: `QuestionKind` ごとに `{generate, check, describe}` を登録する形。
- 過度な抽象化は避け、2種類目を追加するときに必要な分だけ一般化する。

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
