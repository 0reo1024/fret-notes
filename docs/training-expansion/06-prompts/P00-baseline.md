# P0 実機ベースラインと解析ログのフィクスチャ

あなたは Fret Notes（Tauri 2 + TypeScript + Rust、Windows）の開発を担当します。今回の作業は**新機能の実装ではありません**。既存の音声エンジンの実機性能を確認し、後のフェーズで音声判定の回帰テストに使う解析ログ（フィクスチャ）を用意します。

## 目的
- 版 0.4.0 で未検証として残っている項目を確認する（`docs/migration-progress.md` の「0.4.0」節に記載がある）。
  - 最終推定器による実際の演奏
  - ベースの低音
  - 一連の演奏練習
- 今後のトレーナー（コードトーンを演奏で答える、アルペジオ、聴音、ボイスリーディング）が使う「音のイベントへの分割」の設計値を、実測で決める。決める値は次の3つ。
  - 最小の安定時間
  - 無音とみなす区切りの長さ
  - オクターブ誤りの頻度

## 最初に確認すること
- `src-tauri/src/bin/audio-probe.rs`（デバイス一覧）と `src-tauri/src/bin/audio-live-probe.rs` の使い方。
  - 引数は `--device <ID>`（必須）、`--channel <n>`（既定 0）、`--seconds <1〜30>`、`--report <path>`、`--no-ack`。
  - `--report` は解析結果のJSONを書き出す。中身は timeline（audioTimeMs/state/frequency/levelDb）で、音声は含まない。
- `tests/fixtures/play-guitar-events.json` の形式と、それを使うテスト（`tests/performance.test.ts` の 'previous real guitar analysis events…'）。
- `src-tauri/src/audio/analysis.rs` の定数（窓2048、約12 kHz、信頼度0.85、30セント・3回で stable）と、`engine.rs` の通知間隔（67 ms）。

## 作業
1. 利用者に入力機器（例: Nano Cortex (3+4) / 入力1）を接続してもらい、`cargo run --manifest-path src-tauri/Cargo.toml --bin audio-probe` でデバイスIDを確認する。**利用者が楽器を演奏する必要がある。各録取りの前に、何を弾くかを日本語で具体的に伝え、準備ができたか確認してから実行する。**
2. 次の録取りを `audio-live-probe --report <一時ファイル>` で行う。
   - `--report` の出力は、`play-guitar-events.json` の形式とは異なる。中身は started、states、timeline（audioTimeMs/state/frequency/levelDb）など。
   - そのため、次の形に変換してから `tests/fixtures/` に保存する。
     - `source`（機材・入力・内容の説明）と `targetMidi`（または目標の列）を付ける。
     - timeline は `audioTimeMs`、`state`、`frequency`（必要なら `levelDb`）だけを残す。
     - 機器名・デバイスIDなど、テストに不要な情報は残さない。
   - ファイル名の例: `live-guitar-e2-sustain.json`。変換の手順（または小さな変換スクリプト）も残す。
   1. ギター: 6弦開放 E2 を伸ばす／5弦 A2 ／ 1弦 12F E5 ／ 1弦開放 E4
   2. ギター: レガートで C4→D4→E4（間を空けずに）
   3. ギター: 同じ音 G3 を4回、ミュートしながら弾く／ミュートせずに弾く
   4. ギター: 和音（Cメジャーのストローク）。**単音エンジンが和音で何を返すかの記録が目的**
   5. ベース（機材があれば）: 4弦 E1 ／ 5弦 B0 ／ 3弦 A1 の8分音符の刻み
   6. 無音（10秒）と環境ノイズ
3. 録取りごとに次を集計し、表にまとめる。
   - 最初の stable までの時間
   - stable の割合
   - オクターブ誤り（目標から±12半音）の回数
   - 同じ音の連打のうち、区切れた回数（間に silence/unstable が入ったか）
   - 和音で返った周波数
4. 既存の `PerformanceSession` に各ログを再生する、テスト用の小さな補助関数を `tests/` に作る（既存のフィクスチャ再生の処理があれば、それを使う）。単音のログで、正解が1回だけ数えられることを確認するテストを追加する。
5. `docs/migration-progress.md` に「実機ベースライン（P0）」の節を追加する。
   - 結果の表
   - 推奨する設計値: 音のイベントの最小の安定時間（ms）、区切りとみなす無音の長さ（ms）
   - 和音とレガートでの挙動
   - 未確認の機材

## 音楽理論の検証事項
- 各録取りの目標の MIDI 番号（E2=40、A2=45、E4=64、E5=76、E1=28、B0=23、A1=33、G3=55、C4=60）が、フィクスチャの `targetMidi` と一致すること。

## 注意点
- 音声ファイル（WAV など）は絶対に保存しない。
- 実機を使えない場合は、作業を止めて利用者に知らせる。合成信号で代用した結果を「実機での確認」として扱わない。
- アプリのコードは変更しない（テストの補助関数とフィクスチャの追加だけ）。そのため版は上げない。
- アプリに変更がないので、共通ルールの手順5（`npm.cmd run desktop:install`）は省略してよい。省略した場合は、そのことを報告する。

## 完成条件
- 上記のフィクスチャ（入手できたもの）とテストが追加され、`npm.cmd test` が成功する。
- 計測の結果と推奨する設計値が `docs/migration-progress.md` に記録されている。

## 次のフェーズとの関係
- P2（音のイベントへの分割）の既定値と、P12（オンセット検出）の評価用データになる。

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
