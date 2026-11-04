import '../ui/style.css';
import { isTauri } from '@tauri-apps/api/core';
import { SettingsRepository, settingsBackend } from '../platform/settings';
import { mountStudy } from '../features/fretboard-study/view';
import { mountTransfer } from '../features/settings/transfer';
import { $, $$ } from '../ui/dom';
import { createCloseHandler, flushAll } from '../platform/window-lifecycle';
import { mountTuner } from '../features/tuner/view';
import { AudioController, audioBackend } from '../platform/audio';
import { AudioHub, switchFeatures } from '../features/audio/hub';
import { TrainingRepository, trainingBackend } from '../platform/training-store';
import { mountRecords } from '../features/records/view';
import { mountHarmony } from '../features/harmony/view';
import { mountProgression } from '../features/progression/view';
import { mountPhrase } from '../features/phrase/view';
import { mountEar } from '../features/ear/view';
import { mountRhythm } from '../features/rhythm/view';
import { create } from '../domain/instruments/core';
import { resolveInstrument } from '../domain/instruments/profiles';
import type { Focus } from '../domain/training/analysis';

/** Each feature tab shows exactly one panel; tuner and performance practice share theirs. */
const panels: Record<string, string> = { study: '#study-panel', tuner: '#tuner-panel', play: '#tuner-panel', harmony: '#harmony-panel', progression: '#progression-panel', ear: '#ear-panel', records: '#records-panel' };

/** One fixed notice; settings and training problems are joined into it. */
function notice(message: string) {
  const existing = document.querySelector('#startup-notice');
  if (existing) { existing.textContent += ` ／ ${message}`; return; }
  const element = document.createElement('p'); element.id = 'startup-notice'; element.setAttribute('role', 'status');
  element.textContent = message; $('main').prepend(element);
}

async function main() {
  const repository = new SettingsRepository(settingsBackend());
  let loadError = '';
  try { await repository.load(); } catch (error) { loadError = String(error); }
  repository.onStatus = message => { $('#save-status').textContent = message; };
  if (loadError || repository.recovered) notice(loadError ? `設定を読み込めません：${loadError}` : '直前の正常な設定から復旧しました');
  const training = new TrainingRepository(trainingBackend());
  let trainingError = '';
  try { await training.load(); } catch (error) { trainingError = String(error); }
  training.onStatus = message => { $('#save-status').textContent = message; };
  if (trainingError || training.recovered) notice(trainingError ? `学習記録を読み込めません。今回の記録は保存されない場合があります：${trainingError}` : '学習記録を直前の正常な状態から復旧しました');
  let core = create(resolveInstrument(repository.current.lastInstrument, repository.current.instruments[repository.current.lastInstrument]));
  const open = (feature: string) => $(`[data-feature="${feature}"]`).click();
  // The trainers are mounted below; the records tab reaches them through this once they exist.
  let navigate: (focus: Focus) => void = () => {};
  const records = mountRecords(training, { core: () => core, navigate: focus => navigate(focus), openRecords: () => open('records'), openTuner: () => open('tuner') });
  training.onChange = () => records.render();
  const hub = new AudioHub(new AudioController(audioBackend()));
  const tuner = mountTuner(repository, hub, (result, instrument) => training.add({
    // Any-octave answers are one skill per pitch class; exact ones per note.
    itemId: result.target.accept?.kind === 'pitch-class' ? `play-any:${instrument}:${result.target.midi % 12}` : `play:${instrument}:${result.target.midi}`, layer: 'performance', trainer: 'play', method: 'play', result: 'correct',
    // Off-target stable notes before the answer are kept as context, not as wrong answers.
    ...(result.wrongAttempts ? { errorKind: `off-target:${result.wrongAttempts}` } : {}),
    responseMs: Math.round(result.listeningMs), instrument,
  }), training);
  const harmony = mountHarmony(repository, hub, tuner, training);
  const progression = mountPhrase(repository, hub, tuner, training, mountProgression(repository, hub, tuner, training));
  let instrument = repository.current.lastInstrument;
  const rhythm = mountRhythm(training, () => instrument, { repository, hub, tuner });
  const ear = mountEar(repository, hub, tuner, training, rhythm);
  const study = mountStudy(repository,profile => { tuner.setInstrument(profile); harmony.setInstrument(profile); progression.setInstrument(profile); ear.setInstrument(profile); instrument = profile.id; core = create(profile); },training);
  /** Opens the trainer for a focus; with item ids, only those items are practised (nothing about the focus is saved). */
  navigate = focus => {
    const ids = focus.itemIds ?? [];
    if (focus.feature === 'harmony') { open('harmony'); if (ids.length) harmony.focus(focus); else if (focus.kind) harmony.showKind(focus.kind); }
    else if (focus.feature === 'study') { open('study'); if (ids.length) study.focus(focus); }
    else if (focus.feature === 'ear') { open('ear'); if (ids.length) ear.focus(ids, focus.label); else ear.section('ear'); }
    else if (focus.feature === 'rhythm') { open('ear'); ear.section('rhythm'); if (ids.length) rhythm.focus(ids, focus.label); }
    else if (focus.feature === 'progression' || focus.feature === 'phrase') { open('progression'); $(`[data-prog-section="${focus.feature === 'phrase' ? 'phrase' : 'changes'}"]`).click(); }
    else open('play');
  };
  mountTransfer(repository);
  $$('[data-feature]').forEach(button=>button.addEventListener('click',()=>{
    const feature = button.dataset.feature!, panel = panels[feature], audio = feature === 'tuner' || feature === 'play';
    for (const selector of new Set(Object.values(panels))) $(selector).hidden = selector !== panel;
    document.body.classList.toggle('tuner-open',audio);
    document.body.classList.toggle('play-open',feature === 'play');
    document.body.classList.toggle('records-open',feature === 'records');
    document.body.classList.toggle('harmony-open',feature === 'harmony');
    document.body.classList.toggle('progression-open',feature === 'progression');
    document.body.classList.toggle('ear-open',feature === 'ear');
    $$('[data-feature]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab === button)));
    switchFeatures([
      { selected: audio, show: show => tuner.show(show, feature === 'play' ? 'play' : 'tuner') },
      { selected: feature === 'records', show: records.show },
      { selected: feature === 'harmony', show: harmony.show },
      { selected: feature === 'progression', show: progression.show },
      { selected: feature === 'ear', show: ear.show },
    ]);
  }));
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    await appWindow.onCloseRequested(createCloseHandler(
      async () => { await tuner.shutdown(); await flushAll(() => repository.flush(), () => training.flush())(); },
      error => { $('#save-status').textContent = `終了前の処理に失敗しました。設定・学習記録を書き出せます。もう一度閉じると保存せず終了します：${String(error)}`; },
    ));
  }
}
void main().catch(error => {
  const notice = document.createElement('p'); notice.id = 'startup-notice';
  notice.textContent = `起動できません：${String(error)}`; document.body.prepend(notice);
});
