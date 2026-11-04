import { inputTarget } from '../../ui/dom';
import { presetsFor, resolveInstrument, decodeTuning, pitchNames, midiName, type ProfileId, type TuningConfig } from '../../domain/instruments/profiles';

const markup = `<legend>チューニング</legend>
  <label class="tuning-picker">プリセット<select data-tuning="preset"></select></label>
  <p class="setting-note" data-tuning="summary"></p>
  <details><summary>独自チューニングを作る・編集する</summary>
   <label class="tuning-picker">名前<input data-tuning="name" type="text" maxlength="40" autocomplete="off"></label>
   <p class="setting-note">上から1弦→最終弦。E4＝ギター1弦、E2＝ギター6弦、E1＝ベース4弦。開放音はC−1〜G8の範囲で設定できます。</p>
   <div data-tuning="strings"></div>
   <div class="tuning-actions"><button type="button" data-tuning="save-new">別名で保存・適用</button><button type="button" data-tuning="update" hidden>変更を保存・適用</button><button type="button" data-tuning="delete" hidden>削除して標準に戻す</button></div>
   <p class="setting-note">独自設定は楽器ごとに12件まで保存できます。</p>
  </details>
  <p class="tuning-status" data-tuning="status" role="status"></p>`;

/** Fills a fieldset with a tuning editor; each mount keeps its own selection. */
export function mountTuning(root: HTMLElement, onChange: (config: TuningConfig) => void) {
  root.classList.add('tuning-settings'); root.innerHTML = markup;
  const part = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-tuning="${name}"]`)!;
  let instrumentId: ProfileId = 'guitar';
  let config: TuningConfig;
  const picker = part<HTMLSelectElement>('preset');
  const name = part<HTMLInputElement>('name');
  const status = part('status');
  function apply(next: TuningConfig) {
    try { onChange(decodeTuning(next, instrumentId)); status.textContent = 'チューニングを適用しました。出題を最初から開始します。'; }
    catch (error) { status.textContent = String(error instanceof Error ? error.message : error); }
  }
  picker.addEventListener('change', () => apply({ ...config, selectedTuningId: picker.value }));
  function saveCustom(replace: boolean) {
    const openMidi = Array.from(part('strings').querySelectorAll<HTMLElement>('[data-tuning-string]')).map(row =>
      (Number(row.querySelector<HTMLSelectElement>('[data-octave]')!.value) + 1) * 12 + Number(row.querySelector<HTMLSelectElement>('[data-note]')!.value));
    const selected = config.customTunings.find(t => t.id === config.selectedTuningId);
    const id = replace && selected ? selected.id : `user:${crypto.randomUUID()}`;
    const preset = { id, name: name.value.trim(), instrumentId, openMidi };
    const customTunings = replace && selected ? config.customTunings.map(t => t.id === id ? preset : t) : [...config.customTunings, preset];
    apply({ selectedTuningId: id, customTunings });
  }
  part('save-new').addEventListener('click', () => saveCustom(false));
  part('update').addEventListener('click', () => saveCustom(true));
  part('delete').addEventListener('click', () => apply({ selectedTuningId: 'standard', customTunings: config.customTunings.filter(t => t.id !== config.selectedTuningId) }));
  part('strings').addEventListener('change', event => {
    const row = inputTarget(event).closest<HTMLElement>('[data-tuning-string]')!;
    const midi = (Number(row.querySelector<HTMLSelectElement>('[data-octave]')!.value) + 1) * 12 + Number(row.querySelector<HTMLSelectElement>('[data-note]')!.value);
    row.querySelector('output')!.textContent = midi <= 115 ? midiName(midi) : '音域外';
    status.textContent = '';
  });
  return {
    render(id: ProfileId, tuning: TuningConfig) {
      instrumentId = id; config = structuredClone(tuning);
      picker.replaceChildren();
      for (const preset of [...presetsFor(id), ...config.customTunings]) {
        const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.name;
        picker.append(option);
      }
      picker.value = config.selectedTuningId;
      const profile = resolveInstrument(id, config);
      part('summary').textContent = profile.strings.slice().reverse().map(string => `${string.number}弦 ${midiName(string.openMidi)}`).join(' · ');
      const custom = config.customTunings.some(t => t.id === config.selectedTuningId);
      name.value = custom ? profile.tuning.name : 'マイチューニング';
      part('update').hidden = !custom;
      part('delete').hidden = !custom;
      part<HTMLButtonElement>('save-new').disabled = config.customTunings.length >= 12;
      const rows = profile.strings.map(string => {
        const row = document.createElement('div'); row.className = 'tuning-string'; row.dataset.tuningString = String(string.number);
        const noteLabel = document.createElement('label'); noteLabel.textContent = `${string.number}弦`;
        const note = document.createElement('select'); note.dataset.note = ''; note.setAttribute('aria-label', `${string.number}弦の開放音`);
        pitchNames.forEach((pitch, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = pitch; note.append(option); });
        note.value = String(string.openMidi % 12); noteLabel.append(note);
        const octaveLabel = document.createElement('label'); octaveLabel.textContent = 'オクターブ';
        const octave = document.createElement('select'); octave.dataset.octave = ''; octave.setAttribute('aria-label', `${string.number}弦のオクターブ`);
        for (let n = -1; n <= 8; n++) { const option = document.createElement('option'); option.value = String(n); option.textContent = String(n); octave.append(option); }
        octave.value = String(Math.floor(string.openMidi / 12) - 1); octaveLabel.append(octave);
        const output = document.createElement('output'); output.textContent = midiName(string.openMidi);
        row.append(noteLabel, octaveLabel, output); return row;
      });
      part('strings').replaceChildren(...rows);
      status.textContent = '';
    },
  };
}
