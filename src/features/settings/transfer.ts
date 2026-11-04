import { $, inputTarget } from '../../ui/dom';
import type { SettingsRepository } from '../../platform/settings';

export function mountTransfer(repository: SettingsRepository) {
  const status = $('#transfer-status');
  $('#export-settings').addEventListener('click', async () => {
    try {
      const data = await repository.exportJson();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'fret-notes-settings.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '設定ファイルを書き出しました';
    } catch (error) { status.textContent = `書き出せません：${String(error)}`; }
  });
  $('#import-settings').addEventListener('change', async event => {
    const input = inputTarget(event), file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('設定ファイルが大きすぎます');
      await repository.replace(JSON.parse(await file.text()));
      location.reload();
    } catch (error) { status.textContent = `読み込めません：${String(error)}`; }
    input.value = '';
  });
}
