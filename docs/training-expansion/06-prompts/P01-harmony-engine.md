# P1 和声エンジン（純粋関数とテスト）

あなたは Fret Notes（Tauri 2 + TypeScript + Rust）の開発を担当します。今回は**画面を変えず**に、後続の全トレーナーが使う和声エンジンを、DOM に依存しない純粋な TypeScript モジュールとして実装し、網羅的なテストを書きます。

## 目的
- コード記号・コードトーンの度数の種類（3rd系、7th系）・インターバル・ダイアトニックコード・移調を、**綴り（異名同音）まで正しく**計算できるようにする。
- 仕様は `docs/training-expansion/03-feature-specs.md` の §3.0（共通定義）、§3.2、§3.3、§3.5。

## 最初に確認すること（既存コード）
- `src/domain/music/theory.ts`: `chords`（19品質。id・degrees・suffix）、`scales`、`spell(root, degree)`、`pitchOf(name)`、`interval(degree)`、`tonesFor(root, pattern)`、`roots`（17種類。E♯、B♯、C♭、F♭ を含まない）、`normalize`。
  - `spell` は文字を度数の分だけ進め、変化記号で調整する。`pitchOf` は任意の数の ♭/♯ を受け付ける。
- `tests/theory.test.cjs` と `tests/migration.test.ts`（旧版との一致を確認している。**既存のエントリと挙動を変えない**）。

## 変更対象
- 新規（提案名）: `src/domain/music/harmony.ts`。必要なら `intervals.ts` に分けてよい。
- 新規: `tests/harmony.test.ts`。
- `theory.ts` は**変更しない**。どうしても export の追加が必要な場合だけ、最小限に追加する。

## 実装するAPI（名前は既存の書き方に合わせて調整してよい）
```ts
export type SpelledNote = string;                 // /^[A-G](♭{1,2}|♯{1,2})?$/
export function isSpelledNote(s: string): boolean;
export function transpose(note: SpelledNote, degree: string, direction?: 'up'|'down'): SpelledNote;  // spell を使う。下行は転回音程で綴る
export type IntervalId = 'm2'|'M2'|'m3'|'M3'|'P4'|'A4'|'d5'|'P5'|'A5'|'m6'|'M6'|'m7'|'M7'|'P8'|'m9'|'M9'|'A9'|'P11'|'A11'|'m13'|'M13';
export function intervalDegree(id: IntervalId): string;            // M3→'3', m7→'♭7', A4→'♯4', d5→'♭5', A9→'♯9', m13→'♭13' …
export function intervalSemitones(id: IntervalId): number;
export type ChordSymbol = { root: SpelledNote; quality: string };  // quality は chords の id
export function chordName(c: ChordSymbol): string;                // root + suffix
export function parseChordSymbol(text: string): ChordSymbol | { error: string };
//   受け付ける別表記の例: 'Dm7','D-7','Dmin7','Dø','Dm7b5','D°7','Ddim7','CΔ7','CM7','Cmaj7','Bb7','F#m7','C7sus4','Cm(maj7)','CmMaj7'
//   ASCII の b/# を ♭/♯ に正規化する（ルートの直後だけ。'Bb7' は B♭7。'Cb' は C♭）。カタログにない記号はエラーにする。
export type DegreeRole = 'root'|'third'|'fifth'|'seventh'|'ninth'|'sixth'|'fourth'|'second';
export function toneByRole(c: ChordSymbol, role: DegreeRole): { degree: string; name: SpelledNote; pitchClass: number } | null;
//   third = '3'|'♭3'、seventh = '7'|'♭7'|'♭♭7'、fifth = '5'|'♭5'|'♯5'、ninth = '9'|'♭9'|'♯9'。構成式にない場合は null（sus の third、6 の seventh など）
export function chordTones(c: ChordSymbol): { degree: string; name: SpelledNote; pitchClass: number }[];
export type KeyMode = 'major'|'natural-minor'|'harmonic-minor';
export function diatonicSevenths(tonic: SpelledNote, mode: KeyMode): { roman: string; chord: ChordSymbol; func: 'T'|'SD'|'D' | null }[];
export function transposeProgression(chords: ChordSymbol[], from: SpelledNote, to: SpelledNote): ChordSymbol[];
export function samePitchClass(a: SpelledNote, b: SpelledNote): boolean;
```
- ダイアトニックのルートは `spell(tonic, scaleDegree)` で綴る。**`roots` で検証しない**（F♯ メジャーの vii = E♯m7♭5、G♭ メジャーの IV = C♭maj7 を正しく出すため）。
- 機能（T/SD/D）の表はアプリの方針として固定し、ソース上のコメントに根拠を短く書く。
  - メジャー: I・iii・vi = T、ii・IV = SD、V・vii = D。
  - マイナーは流派の差が大きいため、`func` は i = T、iv・iiø = SD、V7（ハーモニックマイナー）= D にとどめ、他は null でよい。

## テスト（必須・表を使って書く）
1. 全19品質 × 標準12ルート（C, D♭, D, E♭, E, F, F♯, G, A♭, A, B♭, B）の `chordTones` の綴りが、`tonesFor` と一致する。代表的な20件以上は**手で書いた正解表**と比べる。
   - 例: E♭7 = E♭ G B♭ D♭、F♯m7♭5 = F♯ A C E、C dim7 = C E♭ G♭ B♭♭、A♭maj7 = A♭ C E♭ G、B7 = B D♯ F♯ A。
2. `toneByRole`
   - sus2・sus4・7sus4 の third は null。
   - six・min6・major・minor・dim・aug・add9 の seventh は null。
   - dim7 の seventh の degree は '♭♭7'。
   - aug の fifth は '♯5'（C aug → G♯）。
3. インターバル: 12ルート × 全 `IntervalId` × 上下の音高クラスが半音数と一致する。綴りの代表例は手書きの表で確認する。
   - 例: E+m3=G、B♭+m3=D♭、F+A4=B、B+d5=F、A+M6=F♯、D−m7=E、C−M3=A♭。
4. ダイアトニック
   - 12メジャー調と12マイナー調（ナチュラル）で、7つのルートの文字（A〜G）がすべて異なる。
   - C メジャー = Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7♭5。
   - A ナチュラルマイナー = Am7 Bm7♭5 Cmaj7 Dm7 Em7 Fmaj7 G7。
   - C ハーモニックマイナーの V = G7、vii = Bdim7。
   - F♯ メジャーの vii = E♯m7♭5。
5. `parseChordSymbol`: 上記の別表記がすべて正しく解析されること。`'Cmaj13'`、`'H7'`、空文字はエラーになること。

## 注意点
- 綴りの規則は既存の `spell` と同じにする（独自の音名表を作らない）。
- 二重変化記号は `♭♭` / `♯♯` の2文字で表す（既存の表記に合わせる）。
- このフェーズでは UI を変えない。

## 動作確認
- テスト、型検査、Rust テスト。UI に変更がないことをプレビューで目視で確認する。

## 完成条件
- 上記のテストが成功し、既存の36件も成功する。`docs/migration-progress.md` に、和声エンジンの範囲と未対応の記号を記録する。

## 次のフェーズとの関係
- P5（コードトーン）、P6（インターバル・ダイアトニックの知識問題）、P7（進行の解析・移調）、P9（ライン）、P14（上級）が、このAPIを使う。

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
