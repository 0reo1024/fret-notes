# Part 6：Claude用の実装プロンプト集

## 使い方

1. 上から順に、1つのプロンプトを1回の開発セッションに貼り付けて使う。依存関係は [ロードマップ](../05-roadmap.md) を参照する。
2. 各プロンプトは単独で読めるように書いてあり、末尾に共通ルールを含む。
3. プロンプト内の「既存」のファイル名・関数名は、2026-10-26 時点のコード（版 0.4.0）で確認済み。「（新規・提案名）」は、これから作るファイルの名前の候補で、実装するセッションが既存の構成に合わせて変えてよい。
4. 前のフェーズの実装でファイル名やAPIが変わった場合は、プロンプトの冒頭に「前フェーズで ○○ は △△ に変わった」と1行追記してから貼り付ける。

| # | ファイル | 内容 | 前提 |
| --- | --- | --- | --- |
| P0 | [P00-baseline.md](P00-baseline.md) | 実機ベースラインと解析ログのフィクスチャ | — |
| P1 | [P01-harmony-engine.md](P01-harmony-engine.md) | 和声エンジン | — |
| P2 | [P02-matcher-audio-hub.md](P02-matcher-audio-hub.md) | matcher・音のイベントへの分割・音声ハブ | P0推奨 |
| P3 | [P03-training-store.md](P03-training-store.md) | 学習記録ストアと記録タブ（最小） | — |
| P4 | [P04-fretboard-extension.md](P04-fretboard-extension.md) | 指板トレーニングの拡張 | P2, P3 |
| P5 | [P05-chord-tone-trainer.md](P05-chord-tone-trainer.md) | ハーモニー・トレーナーとコードトーン（3rd/7th） | P1, P2, P3 |
| P6 | [P06-interval-arpeggio.md](P06-interval-arpeggio.md) | インターバル・アルペジオ・調と機能 | P5 |
| P7 | [P07-progression-step.md](P07-progression-step.md) | 進行モデル・ライブラリ・ステップ式のコードチェンジ | P5 |
| P8 | [P08-metronome-auto-advance.md](P08-metronome-auto-advance.md) | 音の出力・メトロノーム・自動進行・着地 | P7 |
| P9 | [P09-voice-leading.md](P09-voice-leading.md) | ボイスリーディング | P7 |
| P10 | [P10-ear-training.md](P10-ear-training.md) | 聴音と歌唱モード | P2, P8 |
| P11 | [P11-rhythm-tap.md](P11-rhythm-tap.md) | リズム（タップ）と遅延の補正 | P8 |
| P12 | [P12-onset-detection.md](P12-onset-detection.md) | Rust のオンセット検出と演奏リズム | P11, P0 |
| P13 | [P13-motif-phrase.md](P13-motif-phrase.md) | モチーフ・フレーズ・制約付き即興 | P8, P10 |
| P14 | [P14-advanced-harmony.md](P14-advanced-harmony.md) | 上級ハーモニー | P5, P7, P9 |
| P15 | [P15-learning-management.md](P15-learning-management.md) | 学習管理の高度化 | P3と各トレーナー |

## 共通ルール（全プロンプトの末尾に同じ内容を含めてある）

```text
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
```
