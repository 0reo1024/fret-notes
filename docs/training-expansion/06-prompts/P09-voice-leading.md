# P9 ボイスリーディング（ガイドトーン・ライン）

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は進行トレーナーに段階「ライン」を追加し、前の音から次のコードトーンへ近い距離でつなぐ練習を実装します。

## 目的
- 仕様は `docs/training-expansion/03-feature-specs.md` の §3.6。
- 内容: 共通音の保持、半音・全音による接続、3rd と 7th の入れ替わり、移動距離の制約、**複数の正解経路を許すこと**。
- 最短距離の経路を「唯一の音楽的な正解」として扱わない。

## 最初に確認すること（既存コード）
- P7 の `progression.ts`（`Progression`、`stageTargets`）と画面。P8 の自動進行（ステップ式だけで先に実装し、自動進行への対応は任意）。
- P1 の `toneByRole`、`chordTones`。
- P2 の `SequenceTracker`。前の音に依存する matcher を作れるか確認する。必要なら、各段階の matcher を前のイベントから作る関数を受け取れるように最小限の拡張をする。
- P5 の表示専用の指板。

## 変更対象と要件
1. ドメイン（新規・提案名 `src/domain/training/voice-leading.ts`）
   - `LineConstraint {allowedDegrees: 'guide'|'chord-tones', maxSemitones: number, register: [minMidi, maxMidi]}`。
   - `candidatesFor(chord, constraint)`: 音域の中で許可された度数の MIDI の一覧（綴り・度数つき）。
   - `nextAllowed(prevMidi, chord, constraint)`: |差| ≤ maxSemitones の候補。
   - `enumerateLines(progression, startMidi | null, constraint, limit = 200)`: 条件を満たす全経路（上限つき）。
   - `describeLine(line, progression)`: 経路の性質を返す。共通音の保持の回数、半音の移動、全音の移動、3rd↔7th の入れ替わり、上行・下行の傾向。**良し悪しの評価はしない。**
   - `representativeLines(lines)`: 性質ごとに代表を最大4本選ぶ（共通音が最多、半音の移動が最多、入れ替わりが規則的、上行の傾向など）。
2. 画面（P7 の画面に段階「ライン」を追加）
   - 設定: 開始音（指定／自由）、許可する度数（ガイドトーン／コードトーン）、移動の上限（0〜2半音、0〜4半音）、音域の窓。
   - 練習の流れ
     1. 現在のコードで1音を弾く。
     2. 条件を満たせば確定し、次のコードへ進む。
     3. 最後まで弾いたら結果を表示する。
   - 進行表の上に、ラインを「`F(3) → F(7) → E(3)`」のように音名と度数で表示する。
   - 結果の表示
     - 利用者のラインの性質（`describeLine`）。
     - 「他にも成り立つラインの例」（`representativeLines`）。性質のラベル付きで並べる。
     - 「この条件で成り立つ経路は N 本」。
   - 指板: 現在のコードで許可された位置を薄く表示する（設定でオフにできる）。クリックで回答する場合は、フレットの距離の上限（例: 4F以内）も条件にできる。
   - 条件を満たす経路が0本の場合は、開始前に「この条件では到達できません」と表示し、上限を広げるよう案内する。

## UI・UX 要件
- 弾いている最中は、「次に許可される音」を画面に表示しない（設定でヒントの表示をオンにした場合だけ表示する）。
- 誤った音には、「G7 の上で E は許可されていません（13th）／前の音から3半音」のように、**どの条件を満たさなかったか**を示す。

## 音声認識との連携要件
- 共通音を保持する場合（同じ MIDI）、前のコードで伸ばした音が次のコードの正解になる。再アタックは不要とし、そのことを説明に書く。
- 実装は `docs/training-expansion/04-architecture.md` §4.3.3「共通音の保持の規則」に従い、`NoteSegmenter.current()` を使う。テストに「伸ばしたままの F で、Dm7 → G7 の段階が確定する」ケースを入れる。
- 判定は matcher と `SequenceTracker`（または段階ごとの matcher の切り替え）で行う。

## 音楽理論の検証事項（テストで確認する）
- Dm7 – G7 – Cmaj7、ガイドトーン、上限2半音、開始 F4（65）
  - F→F→E（65→65→64）を含む。
  - F→B（増4度＝6半音）を含まない。
- 開始 C5（72）: C→B→B（72→71→71）を含む。
- マイナー II–V–I: Dm7♭5 – G7 – Cm7 で、F→F→E♭ と C→B→B♭ を含む。
- `describeLine(F→F→E)` は、共通音1回、半音の移動1回、3rd→7th→3rd の入れ替わりと判定される。
- 音域の窓の外の候補を含まない。上限を超える数の経路が出た場合は、`limit` で打ち切られる。
- 12調へ移調しても、経路の数が変わらない（調の移動に対して不変であること）。

## テスト
- 上記と、全経路を列挙するコストの上限（5コード × ガイドトーン × 2オクターブで 200 本以内に打ち切る）。

## 完成条件
- §3.6 の受け入れ条件。全テストが成功する。版は 0.7.2 にする。

## 次のフェーズとの関係
- P14 で、アプローチノート・エンクロージャーを「ラインの各段階を3音の並びにしたもの」として追加する。

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
