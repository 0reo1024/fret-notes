# Fret Notes

- アプリに変更を加えたら、最後に必ず `npm.cmd run desktop:install` を実行し、インストール済みのアプリ（`%LOCALAPPDATA%\Programs\Fret Notes`）を置き換える。
- バージョンを上げるときは `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` を揃える。
- `installer/fret-notes.iss` の AppId は変更しない（変えると上書き更新されなくなる）。
