# P12 Rust のオンセット検出と演奏によるリズム判定

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は Rust の音声解析に**オンセット（発音の立ち上がり）検出**を追加します。これにより、ギター・ベースの演奏でリズムを判定し、同じ音の連打を区切れるようにします。

## 目的
- 仕様は `docs/training-expansion/03-feature-specs.md` の §3.8（R2）、`04-architecture.md` の §4.5。
- 今の音声エンジンは、約67 ms ごとの音高の通知と、約170 ms の窓しか持たない。発音の時刻は分からない。このため、ネイティブのサンプルレートで動く軽量の検出器を解析スレッドに追加する。

## 最初に確認すること（既存コード）
- `src-tauri/src/audio/analysis.rs`: `Analyzer::push`（1サンプルごと。レベル用の窓、ローパス、間引き）、`analyze`、`reset`、`invalid`、テスト。
- `src-tauri/src/audio/engine.rs`: `analyze_loop`（キューから最大32768サンプルを取り出して push、67 ms ごとに analyze と通知）、`Observation` の構造と、シリアライズされる項目。
- `src/platform/audio.ts`: `AudioObservation` の型、`AudioController.consume` の検証（未知の項目の扱い）。
- `src-tauri/src/bin/audio-live-probe.rs`（実機での評価に使う）。
- P0 のフィクスチャ（同じ音の連打、8分音符の刻み）。
- P11 の `judgeHits`。

## 変更対象と要件
1. Rust（`analysis.rs`）
   - `OnsetDetector` を追加する。
     - ネイティブのレートで、5 ms ごとに高域を強調したエネルギーを計算する（1次のハイパスでよい）。
     - 次の条件をすべて満たしたらオンセットとする。
       - 直前 20 ms の最小値から、しきい値（既定 +9 dB）以上上昇した。
       - ゲートより大きい。
       - 前のオンセットから 50 ms 以上経っている（不応期）。
     - オンセットの時刻はサンプル番号から求めた ms（入力の時計）で、`audio_time_ms` と同じ基準にする。
     - 強さ（上昇した dB）も持つ。
   - `Analyzer::push` から呼ぶ。**音声のコールバックには処理を追加しない**（既存の設計規則）。
   - `reset` と `invalid`（不連続、NaN、オーバーフロー）で状態を初期化する。
2. Rust（`engine.rs`）
   - `Observation` に `onsets: Vec<{audio_time_ms, strength_db}>` を追加する（前回の通知以後に検出したもの。最大16件）。
   - 通知の頻度（67 ms）と受信確認の仕組みは変えない。
3. TS
   - `AudioObservation` に `onsets` を追加する。
   - `AudioController.consume` の検証で、有限の値か、時刻が単調に増えるかを確認する。
   - 古い版の Rust と組み合わせることは想定しない。ただし項目がない場合は空の配列として扱う。
   - `NoteSegmenter`（P2）: 同じ MIDI でも、オンセットがあれば新しいイベントとして区切る（オプション。既定はオン）。
   - リズム（P11）
     - 回答方法に「演奏」を追加する。
     - 入力の時計から performance の時刻への変換は、`受信時刻 − audioTimeMs` の最近 N 件の最小値で求める。
     - 補正（`inputOffsetMs`）は、クリックに合わせてギターをミュートで刻む手順で求める。
   - 聴音（P10）・アルペジオ（P6）: オンセットがあれば、同じ音の連続を含む問題を許可するオプションを追加する。既定はオフ。
4. 実機での評価（利用者の協力が必要）
   - `audio-live-probe` の出力にオンセットを追加する。
   - P0 と同じ録取り（同じ音の連打、8分音符の刻み、レガート、ミュート）で、検出の取りこぼし・誤検出の数を数え、`migration-progress.md` に表で記録する。
   - しきい値の既定値は、実測をもとに決める。

## 音声認識との連携要件
- 音高の推定（YIN、stable の判定）は変えない。既存の Rust テスト（`streaming_low_notes_sample_rates_and_silence` など）がすべて成功すること。
- CPU の負荷: 解析スレッドの処理時間が、既存より大きく増えないこと。可能であれば簡単な計測を行い、記録する。

## テスト
- Rust: 合成した減衰パルス列（間隔 125 ms、250 ms、異なる振幅）で、オンセットが ±10 ms 以内で検出される。不応期の中で重複しない。サイン波を伸ばしただけでは誤検出しない。ノイズのゲートより下では検出しない。不連続のときに初期化される。
- TS: 観測の検証（不正な onsets で失敗）、`NoteSegmenter` の再アタックによる区切り、`judgeHits` への接続（合成の観測列）。

## 実装時の注意点
- オンセットの検出は、和音のストロークでも1回の発音として扱う。単音か和音かは区別しない。リズムの判定には十分である。
- 演奏データ（音声）を保存しない。`audio-live-probe` のレポートも、時刻と強さだけを含める。

## 完成条件
- §3.8 R2 の受け入れ条件。Rust と TS のテストがすべて成功する。実機での誤検出率が記録されている（実機がない場合は「未検証」と明記し、演奏によるリズムの回答方法を「試験的」と表示する）。版は 0.8.2 にする。

## 次のフェーズとの関係
- P13 のフレーズの記録で、リズムの細部（連打、音価）を記録できるようになる。

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
