# P8 音の出力（メトロノーム）・自動進行・ターゲット着地

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は、アプリに初めて**音の出力**（Web Audio）を追加し、進行トレーナーにテンポに合わせた自動進行と、自由な即興の中で「着地」だけを確かめる段階7を追加します。

## 目的
- 仕様は `docs/training-expansion/03-feature-specs.md` の §3.5（自動進行、段階7）、`04-architecture.md` の §4.5、`07-proposals.md` の P-2・P-6。
- 内容
  - メトロノーム: 4拍すべて／2・4拍／1拍目だけ。カウントインあり。
  - 自動進行: テンポ（40〜160 BPM）とコードあたりの拍数に合わせてコードが変わり、各コードの窓の中で正解音が出たかを判定する。
  - 段階7「自由＋着地」: 採点せず、コードが変わった直後に最初に安定した音の度数だけを表示する。
  - ベースの骨格（任意）: 1拍目はルート、3拍目は 3rd か 5th。

## 最初に確認すること（既存コード）
- P7 の `src/features/progression/view.ts` と、進行の状態（現在のコードの番号を外から進められる形か）。
- P2 の音声ハブと `NoteSegmenter`。
- `src-tauri/tauri.conf.json` の CSP。Web Audio はネットワークを使わないため、CSP の変更は不要のはず。AudioWorklet を使う場合は `script-src 'self'` で読み込めるか確認する。**今回は AudioWorklet を使わない設計を推奨する。**
- アプリ内に音の出力が存在しないこと（`AudioContext` の利用がないこと）を確認する。

## 変更対象と要件
1. 音の出力（新規・提案名 `src/platform/sound.ts`）
   - 最初の利用者の操作（開始ボタン）で `AudioContext` を作る。最小化と終了で `suspend` / `close` する。
   - `scheduleClick(time, accent)`: 短い減衰音。OscillatorNode と GainNode を使う。
   - `playNote(midi, start, duration, referenceHz)`: P10 で使う簡単な合成音。三角波またはのこぎり波に、ローパスとエンベロープを付ける。
   - 先読みのスケジューラー: 約25 ms ごとに、100 ms 先までのクリックを AudioContext の時刻で予約する。`setTimeout` の揺れに依存しない。
   - `toPerformanceTime(contextTime)`: `getOutputTimestamp()` を使う。対応していない場合は `currentTime` と `performance.now()` の差で近似する。
   - 音量の設定。preferences に保存する。
   - 外部の音声ファイルやライブラリは使わない。
2. ドメイン（新規・提案名 `src/domain/training/timeline.ts`）。純粋関数として作る。
   - `buildTimeline(progression, bpm, countInBars)`: 各コードの開始・終了（ms、練習開始からの相対）。
   - `windowFor(index, graceMs)`: 判定窓（開始から、終了＋猶予まで）。
   - `judgeWindow(events, current, window, matchers)`: 結果は hit / missed / wrong。最初に正解した時刻と、最初に安定した音の度数も返す。
     - 対象にするのは、窓の中で確定したイベントと、§4.3.3「共通音の保持の規則」に当てはまる伸ばしている音（コード開始＋`minHoldMs` の時点でまだ鳴っているもの）。
   - 段階7の `landingDegree(events, chordStartMs, chord)`: コードの開始以後に、最初に確定した音の度数。
3. 画面（P7 の画面に追加）
   - 方式の切り替え: ステップ式／自動進行。
   - テンポ、コードあたりの拍数（4・2）、クリック方式、カウントイン（1小節）、繰り返し回数。
   - 自動進行の間は、現在のコードの強調を拍に合わせて動かす。拍の位置（1・2・3・4）も表示する。
   - 段階7: 進行表の各コードの下に、着地した度数（例: 3、♭7、9、R）を表示する。採点しない。3rd/7th への着地の割合だけを参考指標として表示する。
   - 2拍未満のコード、または1秒未満のコードは、自動進行では選べないようにする（判定の精度のため）。
4. 時計の対応
   - 観測を受け取った時刻（`performance.now()`）を、`NoteEvent` の時刻へ対応させる。
   - P2 の分割器は `audioTimeMs` を使っているので、受信時の `performance.now() − audioTimeMs` の最近の最小値で、入力の時計を performance の時刻へ変換する関数を用意する。
   - 精度は約 ±100 ms。猶予（既定 300 ms）で吸収する。

## UI・UX 要件
- 開始したら、終わるまで画面に触らなくてよい。Space で一時停止・再開する。
- クリックの音量と、「判定音の確認」を右パネルに置く。
- マイクで入力している場合、クリック音が入力に入る可能性がある。ヘッドホンの使用を推奨する案内を表示する。ライン入力（DI）なら問題ない。

## 音声認識との連携要件
- 判定窓で使うのは、確定した `NoteEvent` だけにする。
- クリックの音を誤って音高として拾った場合への対策: クリックは高めで短い音にし、`minHoldMs`（≥120 ms）より短くする。クリックが安定音として確定しないことを、フィクスチャまたは合成した観測で確認する。
- 入力が中断したら、自動進行を一時停止する。

## 音楽理論の検証事項
- 着地の度数の表示は、そのコードのルートからのインターバルで綴る。例: G7 の上で A♭ → ♭9、A → 9、C → 11（4ではなく、テンションとしての表記）。テンションとしての表記にするのは段階7の表示だけ。
- 3rd/7th の判定は P1 の `toneByRole` に従う。

## テスト
- `buildTimeline`: 拍とテンポから ms への変換、1小節に2つのコードがある場合、カウントイン。
- `judgeWindow`
  - 猶予の境界。
  - **前のコードの間に終わった音は数えない。**
  - **前のコードから伸ばし続け、コード開始＋`minHoldMs` の時点でまだ鳴っている正解音は hit になる**（例: Dm7 の F → G7）。
- `landingDegree`。
- スケジューラーは、時計を差し替えられる構造にしてテストする（予約の重複・抜けがないこと）。

## 動作確認
- プレビュー（ブラウザー）でメトロノームが鳴り、自動進行の表示が拍に合うことを確認する。
- 実機があれば、60 BPM・4拍で ii–V–I の段階2を1周弾き、判定が妥当か確認する。結果を `migration-progress.md` に記録する。

## 完成条件
- §3.5 の自動進行の受け入れ条件。全テストが成功する。版は 0.7.1 にする。

## 次のフェーズとの関係
- `sound.ts` は、P10（聴音の再生・ドローン）、P11（リズムのメトロノーム）、P13（モチーフの再生）で再利用する。
- `timeline.ts` はリズムの判定（P11）の基礎になる。

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
