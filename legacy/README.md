# Fret Notes for Guitar / Bass

Workで開発したFret Notesを、このPCで起動・開発できるようにしたものです。

## このPCで起動

`Start Fret Notes.cmd` をダブルクリックすると、ブラウザーで <http://localhost:4173> が開きます。起動したウィンドウは使用中そのままにしてください。終了はウィンドウで `Ctrl+C`、またはウィンドウを閉じます。

Node.js 20以上が必要です。このPCには導入済みです。追加パッケージのインストールやビルドは不要です。

開発時はこのフォルダで `npm run dev` を実行し、同じURLを開いてください。`npm start` はブラウザーも自動で開きます。`dist/` のファイルを編集し、ブラウザーを再読み込みすると反映されます。

設定はこのPCのブラウザーに保存されます。Work版とは保存先が異なるため、設定は自動移行されません。サーバーはこのPCのループバックアドレスだけで待ち受けます。

## 引き継いだ機能

- Instant Guitar / 4-string Bass / 5-string Bass switching; each instrument retains its settings.
- Position → note, note → position, and the full fretboard reference.
- 19 chord types and 21 scales; up to four mixed layers, with numbered color markers and per-note degree inspection.
- Root-position chord shapes on supported strings, with explicitly stated omissions.
- Keyboard practice and accessible modal close button, Escape, and backdrop click.
- Standard tunings; quizzes cover frets 0–12. Chord examples may extend to fret 15.

画面は `dist/index.html` / `dist/bass.html`、操作・表示は `dist/app.js` / `dist/style.css`、指板・音楽理論・シェイプは `dist/core.js` / `dist/theory.js` / `dist/shapes.js`、ローカルサーバーは `scripts/server.mjs` にあります。

## Checks

`npm test` で指板、出題、コード、スケール、コードシェイプの既存テストを実行します。

Manual UI checks: both quiz directions, all-note map, each instrument and reload persistence, mixed layers and note inspection, chord shape modal (including a chord layered over a scale), backdrop dismissal, keyboard navigation, and mobile overflow.

Work版から取得したソースのコミット: `2b4e98ce13e1f65800f35fc7d329550c35ffbad8`。
`.openai/hosting.json` は既存Sitesの識別情報です。このPC内での編集・起動では公開版は更新されません。
