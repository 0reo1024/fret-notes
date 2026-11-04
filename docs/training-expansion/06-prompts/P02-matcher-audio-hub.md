# P2 判定の一般化（matcher）・音のイベントへの分割・音声ハブ

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は、既存の単音演奏の判定を**挙動を変えずに**一般化し、複数のトレーナーが1つの音声入力を共有できるようにします。

## 目的
- 「1つの MIDI」に限られている判定の目標を、次の形にも対応させる。
  - 音高クラスの集合（オクターブを問わない。音域の窓の中）
  - 音の並び（順番あり／なし）
- 観測（AudioObservation）を「音のイベント」に分割する純粋なロジックを作る。
- `AudioController` の所有者を `mountTuner` から `main.ts` へ移し、通知を表示中の機能1つへ流す。
- 仕様は `docs/training-expansion/04-architecture.md` の §4.2、§4.3。

## 最初に確認すること（既存コード）
- `src/domain/practice/performance.ts`
  - `PlayTarget {string, fret, midi, note}`、`PerformanceSession` の `consume` / `bind` / `pause` / `finish` / `continueAfterAnswer`。
  - 証拠の管理（`candidateAt`、`wrongAt`、`wrongMidi`、`wrongCounted`）。
  - 250 ms を超える間隔で証拠を破棄する処理。
  - コンストラクターの検証（許容幅は 5/10/20、安定時間は 200/350/500）。
- `tests/performance.test.ts`（全件）と `tests/tuner.test.ts`。
- `src/platform/audio.ts` の `AudioController`（onObservation / onChange / tick）。
- `src/features/tuner/view.ts` の `mountTuner`
  - controller の生成、`mode: 'tuner'|'play'`、`controller.onObservation` の振り分け、`visibilitychange` での停止。
  - `index.html` の `aside.audio-settings`（`#audio-device`、`#audio-channel`、`#audio-reference`、`#audio-gate`、`#audio-start`、`#audio-stop`、`#audio-level` など）。
- `src/app/main.ts` の機能タブの切り替え（`data-feature`）。
- P0 で追加したフィクスチャと、`docs/migration-progress.md` の推奨設計値（P0 を実施していない場合は、最小の安定時間 200 ms、区切りの無音 120 ms を仮の値にする）。

## 変更対象
1. `src/domain/practice/performance.ts`
   - `PlayTarget` に任意の `accept?: PitchMatcher` を追加する。
   - `PitchMatcher = {kind:'midi',midi} | {kind:'pitch-class',pitchClasses:number[],register:[number,number]}`。
   - `accept` がなければ、今の `midi` 判定と完全に同じ挙動にする。
   - セント差は、許される MIDI のうち観測に最も近いものに対して計算する。
   - 外れた音の判定（誤答の回数）も、同じ「許される集合」を基準にする。
   - **既存のテストは1行も変えずに成功させる。**
2. 新規（提案名）: `src/domain/practice/note-events.ts`
   - `NoteSegmenter` を作る。`push(observation)` で `NoteEvent {midi, startMs, endMs, cents}` の確定・終了を返す。
   - 設計は §4.3.3 に従う。最小の安定時間と区切りの無音の長さは引数で受け取る。
   - 確定したイベントに加えて、**現在鳴っているイベント**（`current()`）を公開する。§4.3.3 の「共通音の保持の規則」を後のフェーズで実装するために必要になる。テストも書く。
   - セッションIDの検証、順序番号の検証、時刻の逆行の破棄は、`PerformanceSession.consume` と同じ規則にする。
3. 新規（提案名）: `src/domain/practice/sequence.ts`
   - `SequenceTracker` を作る。`SequenceSpec {kind:'ordered'|'unordered', steps: PitchMatcher[]}` を受け取り、`NoteEvent` を順に受けて、進み具合・誤り（何番目に何が来たか）・完了を返す。
   - 誤りのときの方針は、オプションで選べるようにする。
     - 最初からやり直す（既定）
     - その段階で待つ
4. 音声ハブ
   - `main.ts` で `new AudioController(audioBackend())` を作り、`mountTuner(repository, controller)` へ渡す。
   - 新規（提案名）の `src/features/audio/hub.ts` に、`setActiveConsumer(consumer | null)` を用意する。`AudioConsumer {consume, sync, pause}` の形にする。
   - 既存の tuner/play の振り分けは、この仕組みの上に載せ替える。
   - **画面の挙動・要素ID・保存の内容は変えない。**
5. 音声設定UIの共通化（**IDを重複させない**）
   - `aside.audio-settings` の束縛処理を、関数（提案名 `src/features/audio/settings.ts` の `mountAudioSettings(...)`）に切り出す。
   - 推奨する方式: **既存の1つの `aside.audio-settings` 要素を、表示中の機能のパネルへ DOM 上で移動させる**（`appendChild` で付け替える）。要素を複製しない。
     - こうすると `#audio-device` などの ID が一意のまま保たれる。
     - `tuner/view.ts` のグローバルな `$()` の参照も、ほとんど変えずに済む。
   - 移動で対応できない理由が見つかった場合に限り、「渡された root の中を検索する」方式にする。その場合も、同じ ID を持つ要素を同時に2つ置かない。
   - チューナー画面での表示と挙動は今と同じにする。既存の要素ID（テストやCSSが参照しているもの）は維持する。

## UI・UX 要件
- 利用者から見た変化はない（リファクタリングだけ）。チューナー、演奏練習、指板学習の動作をプレビューで確認する。

## 音声認識との連携要件
- 入力を二重に開かない。古いセッションの通知を捨てる。
- 2秒の受信確認、1秒の入力の途切れ、最小化での停止を、すべて維持する。

## 音楽理論の検証事項
- 音高クラスの matcher（例: pitchClasses=[4]、register=[40,76]）で、E2・E3・E4 が正解、D♯3 が誤答、E6（88）が音域外になること。
- セント差: E3 の +8 セントを観測したとき、セント差が +8 になること（E2 との差を計算しないこと）。

## テスト
- 既存のテスト（変更しない）がすべて成功すること。
- 追加するテスト
  - pitch-class の matcher で、オクターブ違いが正解になる。
  - 音域外の音は誤答として1回だけ数えられる。
  - `NoteSegmenter`: レガート（C4→D4→E4）が3イベントになる。間に無音がある同音の連打が2イベントになる。無音がない同音の伸ばしは1イベントになる。120 ms未満の経過音は無視される。逆行した時刻は破棄される。伸ばしている間は `current()` がそのイベントを返し、無音になると null を返す。
  - `SequenceTracker`: 順番ありで正しい並びが完了する。誤りで最初に戻る。順番なし（3rd と 7th）は、どちらの順番でも完了する。
  - P0 のフィクスチャの再生（レガートと連打）。
  - 音声ハブ: 表示中でない機能に通知が届かない。タブを切り替えると前の機能の `pause` が呼ばれる。

## 実装時の注意点
- `performance/view.ts` と `tuner/view.ts` の書き換えは最小限にする。
- `PerformanceSession` のコンストラクターの許容値の検証は、そのまま残す。
- 新しいモードでは、別の許容値が必要になる場合がある（例: 歌唱の ±50 セント）。その場合は、検証を「許可された値の集合」として引数で渡せる形にする。既定値は今の集合のままにする。

## 完成条件
- 利用者から見た挙動が変わらず、既存と新規のテストがすべて成功する。
- `docs/migration-progress.md` に、内部構成の変更（音声ハブ、matcher、分割）を記録する。版は 0.4.1 にする（3ファイルを揃える）。

## 次のフェーズとの関係
- P4（演奏のオクターブ自由）、P5（コードトーンを演奏で答える）、P6（アルペジオの並び）、P7〜P10 のすべてが、このハブと matcher を使う。

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
