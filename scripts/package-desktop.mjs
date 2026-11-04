import { copyFile, mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'release');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await mkdir(destination, { recursive: true });
await copyFile(path.join(root, 'src-tauri/target/release/fret-notes.exe'), path.join(destination, 'Fret Notes.exe'));
const readme = [
  `Fret Notes Desktop ${version}`, '',
  'Fret Notes.exe をダブルクリックして起動してください。',
  'Node.jsや開発サーバーは不要です。Microsoft Edge WebView2 Runtimeが必要です。',
  '設定はWindowsのアプリデータ領域 (jp.fretnotes.desktop) に保存します。', '',
  'チューニングは右側のプロパティ（小さい画面では「表示・出題設定」）から選択できます。標準、Drop D/Drop A、半音下げ、楽器ごとの独自設定に対応します。',
  '標準以外のコードシェイプは未対応です。構成音の位置は指板で確認できます。', '',
  'チューナーは左側の「チューナー」から開きます。入力デバイス・チャンネルを選び、「入力を開始」を押してください。',
  'クロマチック表示と、現在の楽器/チューニングの開放弦を目標にする表示に対応します。単音を弾き、他の弦はミュートしてください。',
  'A4基準は400〜480 Hz、対応入力音域は25〜1500 Hzです。入力レベル、音名、周波数、セント差を表示します。',
  '無音・不安定・入力過大の間は音名を消します。画面切り替え・最小化・終了時は入力を停止し、音声ファイルは保存しません。',
  'このPCの実音検証ではNano Cortex (3+4)の入力1でギター6弦開放Eを確認しました。', '',
  '旧版の設定は自動移行し、settings.v1.backup.json / settings.v2.backup.jsonを保持します。',
  '「演奏練習」では、指板学習の範囲から単音を出題します。問題数、許容セント幅、安定時間を選び「練習を開始」を押してください。一時停止後は「練習を再開」で続けます。',
  '音高とオクターブを採点し、押さえる位置は表示しません。正解すると緑の「正解！」を600 ms表示し、ミュートを待たず次の問題へ進みます。',
  '一時停止/再開と今回の結果表示に対応します。結果と判定条件はアプリ終了時に消えます。実際の演奏による一連の操作確認は再接続後に行います。', '',
].join('\n');
await writeFile(path.join(destination, 'README.txt'), readme, 'utf8');
const size = (await stat(path.join(destination, 'Fret Notes.exe'))).size;
console.log(`Desktop app: ${path.join(destination, 'Fret Notes.exe')} (${(size / 1048576).toFixed(2)} MiB)`);
