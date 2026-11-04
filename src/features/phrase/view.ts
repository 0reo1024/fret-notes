import { $, $$ } from '../../ui/dom';
import { create } from '../../domain/instruments/core';
import { resolveInstrument, type InstrumentProfile } from '../../domain/instruments/profiles';
import { chordTones } from '../../domain/music/harmony';
import { decodeStored, flatten, fromStored, library, materialize, type Progression } from '../../domain/training/progression';
import { minorTonics } from '../../domain/training/key-questions';
import { nameInKey } from '../../domain/training/ear';
import { describeOver } from '../../domain/training/tone-questions';
import { AutoProgress, InputClock, type ClickMode } from '../../domain/training/timeline';
import {
  checklist, constraintCards, decodePhraseTakes, describeMotif, drawConstraint, keyOf, libraryMotif, matchesRepeat, matchesTransposed, maxMemo, maxPasses,
  maxTakeEvents, motifBeats, motifEvents, motifShapes, phraseMetrics, phraseTask, randomMotif, taskKinds,
  timelineRows, type ConstraintCard, type PhraseTake, type PhraseTask, type PhraseTaskKind, type SelfMark,
} from '../../domain/training/motif';
import { NoteSegmenter, defaultSegmenterOptions } from '../../domain/practice/note-events';
import type { AudioObservation } from '../../platform/audio';
import type { SettingsRepository } from '../../platform/settings';
import type { TrainingRepository } from '../../platform/training-store';
import { ClickScheduler, sound } from '../../platform/sound';
import type { AudioConsumer, AudioHub } from '../audio/hub';
import type { mountTuner } from '../tuner/view';

interface PhrasePreferences {
  kind: PhraseTaskKind | 'any'; source: 'library' | 'random'; shape: string; length: number; progressionId: string; majorTonic: string; minorTonic: string;
  bpm: number; passes: number; click: ClickMode; volume: number; pitchClass: boolean; withCard: boolean;
}
const majorTonics = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
function decodePreferences(input: unknown): PhrasePreferences {
  const value = (input && typeof input === 'object' ? input : {}) as Partial<PhrasePreferences>;
  const pick = <T,>(candidate: unknown, allowed: readonly T[], fallback: T) => allowed.includes(candidate as T) ? candidate as T : fallback;
  return {
    kind: pick(value.kind, ['any', ...taskKinds.map(k => k.kind)] as const, 'any'), source: pick(value.source, ['library', 'random'] as const, 'library'),
    shape: pick(value.shape, motifShapes.map(s => s.id), motifShapes[0].id), length: pick(value.length, [2, 3, 4, 5], 3),
    progressionId: typeof value.progressionId === 'string' ? value.progressionId : library[0].id,
    majorTonic: pick(value.majorTonic, majorTonics, 'C'), minorTonic: pick(value.minorTonic, minorTonics, 'A'),
    bpm: typeof value.bpm === 'number' && value.bpm >= 40 && value.bpm <= 160 ? Math.round(value.bpm) : 80,
    passes: pick(value.passes, [1, 2, 4], 2), click: pick(value.click, ['all', 'backbeat', 'one', 'none'] as const, 'all'),
    volume: typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 1 ? value.volume : .6,
    pitchClass: value.pitchClass === true, withCard: value.withCard === true,
  };
}
const marks: [SelfMark, string][] = [['yes', 'はい'], ['partial', '一部'], ['no', 'いいえ']];

/** Phrase section of the progression tab: motif tasks over an auto-advancing progression. The take is kept as note
 * events only and replayed with the synthesizer. Only the two repeat tasks are checked; everything else is self-assessed.
 * The tab's two sections are switched here, like the ear tab hosts rhythm. */
export function mountPhrase(repository: SettingsRepository, hub: AudioHub, tuner: ReturnType<typeof mountTuner>, training: TrainingRepository, changes: { show(show: boolean): void; setInstrument(profile: InstrumentProfile): void }) {
  const controller = hub.controller;
  let profile = resolveInstrument(repository.current.lastInstrument, repository.current.instruments[repository.current.lastInstrument]);
  let prefs = decodePreferences(training.preference('phrase'));
  let section: 'changes' | 'phrase' = training.preference('progressionSection') === 'phrase' ? 'phrase' : 'changes';
  let panelVisible = false, visible = false, task: PhraseTask | null = null, card: ConstraintCard | null = null, status = '', heard = '';
  // A run, and after it the take under review until it is saved or discarded (a stopped run keeps its notes).
  let auto: AutoProgress | null = null, running = false, scheduler: ClickScheduler | null = null, t0Perf = 0, frame: number | null = null, frameKey = '';
  let take: { events: PhraseTake['events']; endMs: number; objective: boolean | null; matchAt: number | null; onsets: boolean } | null = null;
  let selfMarks: Partial<Record<string, SelfMark>> = {}, sawOnsets = false;
  const segmenter = new NoteSegmenter(defaultSegmenterOptions(repository.current.audio.referenceHz)), inputClock = new InputClock();

  const core = () => create(profile);
  const register = (): [number, number] => { const C = core(), midis = C.candidates(C.normalize({})).map(p => C.midi(p)); return [Math.min(...midis), Math.max(...midis)]; };
  const save = () => training.updatePreferences('phrase', prefs);
  const text = (selector: string, value: string) => { const element = $(selector); if (element.textContent !== value) element.textContent = value; };
  const stored = () => decodeStored(training.current.progressions);
  function progression(): Progression | null {
    const builtin = library.find(e => e.id === prefs.progressionId);
    if (builtin) return materialize(builtin, builtin.mode === 'major' ? prefs.majorTonic : prefs.minorTonic);
    const user = stored().find(s => s.id === prefs.progressionId);
    return user ? fromStored(user) : null;
  }
  function newTask() {
    const p = progression();
    if (!p) { task = null; return; }
    const key = keyOf(p), motif = prefs.source === 'library' ? libraryMotif(prefs.shape, key, register()) : randomMotif(prefs.length, key, register());
    const kinds = taskKinds.map(k => k.kind), kind = prefs.kind === 'any' ? kinds[Math.floor(Math.random() * kinds.length)] : prefs.kind;
    task = phraseTask(kind, p, motif);
    card = prefs.withCard ? drawConstraint(Math.random, card?.id ?? null) : null;
    take = null; status = '';
  }
  function listen() {
    if (!task) return;
    sound.setVolume(prefs.volume);
    sound.play(motifEvents(task.motif, prefs.bpm), repository.current.audio.referenceHz);
  }

  const now = () => performance.now() - t0Perf;
  function start() {
    const p = progression();
    if (!p || !task) { status = '進行を選んでください'; render(); return; }
    stopRun(); take = null; selfMarks = {}; sawOnsets = false; $<HTMLTextAreaElement>('#phrase-memo').value = '';
    auto = new AutoProgress(p, 'free', { bpm: prefs.bpm, scale: 1, countInBars: 1, passes: Math.min(prefs.passes, maxPasses(p)) });
    const context = sound.ensure(); sound.setVolume(prefs.volume);
    const startAt = context.currentTime + .25; t0Perf = sound.toPerformanceTime(startAt);
    const run = auto;
    scheduler = new ClickScheduler(sound, startAt, (from, to) => run.clickTimes(prefs.click, from, to)); scheduler.start();
    inputClock.reset(); segmenter.reset(); running = true; status = '';
    if (controller.phase === 'idle') { repository.updateAudio(repository.current.audio); void controller.start(repository.current.audio); }
    frame = requestAnimationFrame(tick); render();
  }
  /** Ends the run and turns what was played into the take under review. */
  function finishRun() {
    if (!auto || !running) return;
    const end = Math.min(now(), auto.endMs);
    stopRun();
    auto.endNote(end);
    const offset = auto.countInMs, events = auto.notes.filter(n => n.startMs >= offset - 100 && n.startMs < end).slice(0, maxTakeEvents)
      .map(n => ({ midi: n.midi, startMs: Math.round(n.startMs - offset), endMs: Math.round(Math.max(n.startMs, Math.min(n.endMs ?? end, end)) - offset) }));
    let matchAt: number | null = null, objective: boolean | null = null;
    if (task?.objective && events.length) {
      matchAt = task.kind === 'repeat' ? matchesRepeat(events, task.motif, { pitchClass: prefs.pitchClass }) : matchesTransposed(events, task.motif, task.start!.pitchClass, task.kind === 'diatonic' ? task.motif.key : null);
      objective = matchAt !== null;
      training.add({ itemId: `phr:${task.kind}`, layer: 'performance', trainer: 'phrase', method: 'play', result: objective ? 'correct' : 'wrong', responseMs: null, instrument: profile.id });
    }
    take = { events, endMs: Math.max(0, Math.round(end - offset)), objective, matchAt, onsets: sawOnsets };
    status = events.length ? '' : '音が記録されませんでした（音声入力が止まっていないか確かめてください）';
    render();
  }
  function stopRun() {
    scheduler?.stop(); scheduler = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (running) { running = false; sound.suspend(); void controller.stop(); }
  }
  function tick() {
    frame = null;
    if (!auto || !running) return;
    const t = now();
    auto.update(t);
    if (auto.finished(t)) { finishRun(); return; }
    const slot = auto.slotAt(t), beat = auto.beatAt(t), key = `${slot?.pass}:${slot?.index}:${beat.beat}:${beat.countIn}:${auto.notes.length}`;
    if (key !== frameKey) { frameKey = key; render(); }
    frame = requestAnimationFrame(tick);
  }
  function saveTake() {
    if (!take || !task) return;
    const p = progression(), memo = $<HTMLTextAreaElement>('#phrase-memo').value.trim().slice(0, maxMemo);
    const entry: PhraseTake = { trainer: 'phrase', id: `take:${Date.now().toString(36)}`, taskId: task.id, progressionId: p?.id ?? prefs.progressionId, tempo: prefs.bpm, events: take.events,
      objective: take.objective, constraintId: card?.id ?? null, selfAssessment: { ...selfMarks }, memo, at: new Date().toISOString() };
    training.addTake(entry);
    // Self-assessment is logged for the records but never moves an item's review box.
    if (Object.keys(selfMarks).length) training.add({ itemId: `phr:${task.kind}`, layer: 'performance', trainer: 'phrase', method: 'self', result: 'self-marked', responseMs: null, instrument: profile.id });
    take = null; status = '保存しました'; render();
  }
  function replay(events: PhraseTake['events']) {
    if (!events.length) return;
    sound.setVolume(prefs.volume);
    const first = events[0].startMs;
    sound.play(events.map(e => ({ midis: [e.midi], at: (e.startMs - first) / 1000, duration: Math.max(.08, (e.endMs - e.startMs) / 1000) })), repository.current.audio.referenceHz);
  }
  function toggle() { if (running) finishRun(); else start(); }

  const consumer: AudioConsumer = {
    consume(o: AudioObservation) {
      if (!auto || !running || controller.phase !== 'running' || !controller.started) return;
      segmenter.bind(controller.started.sessionId); inputClock.observe(performance.now(), o.audioTimeMs);
      if (o.onsets?.length) sawOnsets = true;
      const change = segmenter.push(o), current = segmenter.current(), timeOf = (audioMs: number) => (inputClock.toPerformance(audioMs) ?? performance.now()) - t0Perf;
      heard = current ? nameInKey(task!.motif.key, current.midi).name : '';
      if (change.ended) auto.endNote(timeOf(change.ended.endMs!));
      if (change.started) auto.startNote(change.started.midi, timeOf(change.started.startMs));
    },
    sync() { if (controller.phase === 'error' && running) { finishRun(); status = '入力が中断したため停止しました（それまでの記録は残しています）'; } render(); },
    pause() { segmenter.reset(); },
  };
  hub.onChange(() => { if (visible) render(); });

  const option = (value: string, label: string) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
  function renderSettings() {
    const kind = $<HTMLSelectElement>('#phrase-kind');
    if (!kind.options.length) kind.replaceChildren(option('any', 'おまかせ'), ...taskKinds.map(k => option(k.kind, `${k.name}${k.objective ? '' : '（自己評価）'}`)));
    kind.value = prefs.kind;
    const shape = $<HTMLSelectElement>('#phrase-shape');
    if (!shape.options.length) shape.replaceChildren(...motifShapes.map(s => option(s.id, s.name)));
    shape.value = prefs.shape; $<HTMLSelectElement>('#phrase-source').value = prefs.source; $<HTMLSelectElement>('#phrase-length').value = String(prefs.length);
    $('#phrase-shape-row').hidden = prefs.source !== 'library'; $('#phrase-length-row').hidden = prefs.source !== 'random';
    const select = $<HTMLSelectElement>('#phrase-progression'), list = stored(), ids = [...library.map(e => e.id), ...list.map(s => s.id)].join(',');
    if (select.dataset.ids !== ids) {
      select.dataset.ids = ids;
      const builtin = document.createElement('optgroup'); builtin.label = 'ライブラリ'; builtin.append(...library.map(e => option(e.id, e.name)));
      const mine = document.createElement('optgroup'); mine.label = '自分の進行'; mine.append(...list.map(s => option(s.id, s.name)));
      select.replaceChildren(builtin, ...(list.length ? [mine] : []));
    }
    if (!library.some(e => e.id === prefs.progressionId) && !list.some(s => s.id === prefs.progressionId)) prefs = { ...prefs, progressionId: library[0].id };
    select.value = prefs.progressionId;
    const builtin = library.find(e => e.id === prefs.progressionId), key = $<HTMLSelectElement>('#phrase-key');
    $('#phrase-key-row').hidden = !builtin;
    if (builtin) {
      const tonics = builtin.mode === 'major' ? majorTonics : minorTonics, wanted = tonics.join(',') + builtin.mode;
      if (key.dataset.list !== wanted) { key.dataset.list = wanted; key.replaceChildren(...tonics.map(t => option(t, builtin.mode === 'major' ? `${t} メジャー` : `${t} マイナー`))); }
      key.value = builtin.mode === 'major' ? prefs.majorTonic : prefs.minorTonic;
    }
    $<HTMLInputElement>('#phrase-bpm').value = String(prefs.bpm); $<HTMLSelectElement>('#phrase-passes').value = String(prefs.passes);
    $<HTMLSelectElement>('#phrase-click').value = prefs.click; $<HTMLInputElement>('#phrase-volume').value = String(prefs.volume);
    $<HTMLInputElement>('#phrase-pitch-class').checked = prefs.pitchClass; $<HTMLInputElement>('#phrase-with-card').checked = prefs.withCard;
  }
  function renderChart(p: Progression | null) {
    const chart = $('#phrase-chart');
    if (!p) { chart.replaceChildren(); return; }
    const current = running && auto ? auto.slotAt(now())?.index ?? -1 : -1;
    let flat = 0;
    chart.replaceChildren(...p.bars.map(bar => {
      const element = document.createElement('div'); element.className = 'prog-bar';
      for (const chord of bar) {
        const index = flat++, cell = document.createElement('span');
        cell.className = `prog-chord${index === current ? ' is-current' : ''}${task?.start?.chordIndex === index ? ' is-hit' : ''}`;
        cell.textContent = chord.symbol;
        if (task?.start?.chordIndex === index) { const small = document.createElement('small'); small.textContent = `ここの3rd ${task.start.name} から`; cell.append(small); }
        element.append(cell);
      }
      return element;
    }));
  }
  /** One row per pass: chords as columns, each note placed at its start time and named with its degree over the chord. */
  function renderTimeline(p: Progression) {
    const chords = flatten(p), matched = new Set<number>(take!.matchAt === null ? [] : task!.motif.notes.map((_, i) => take!.matchAt! + i));
    $('#phrase-timeline').replaceChildren(...timelineRows(take!.events, p, prefs.bpm, take!.endMs).map(r => {
      const row = document.createElement('div'); row.className = 'phrase-row'; row.setAttribute('aria-label', `${r.pass}周目`);
      for (const chord of chords) { const cell = document.createElement('span'); cell.className = 'phrase-row-chord'; cell.style.flexGrow = String(chord.beats); cell.textContent = chord.symbol; row.append(cell); }
      for (const note of r.notes) {
        const chord = chords[note.chordIndex], chip = document.createElement('span');
        chip.className = `phrase-note${matched.has(note.index) ? ' is-match' : ''}`; chip.style.left = `${Math.min(94, note.share * 100)}%`;
        chip.textContent = nameInKey(task!.motif.key, note.midi).name;
        const degree = document.createElement('small'); degree.textContent = describeOver(chord.root, chordTones(chord), note.midi % 12); chip.append(degree);
        row.append(chip);
      }
      return row;
    }));
  }
  function referenceText(p: Progression) {
    const t = take!, beat = 60000 / prefs.bpm, chords = flatten(p);
    const C = core(), window = card?.reference === 'fret-window' && card.frets ? new Set(C.candidates(C.normalize({ frets: Array.from({ length: card.frets[1] - card.frets[0] + 1 }, (_, i) => card!.frets![0] + i) })).map(pos => C.midi(pos))) : null;
    const m = phraseMetrics(t.events, 0, Math.max(1, t.endMs), task!.motif, window);
    const parts = [`弾いた音 ${m.notes}`, `使った音名 ${m.pitchClasses}種類`];
    if (m.restRatio !== null) parts.push(`休符の割合 ${Math.round(m.restRatio * 100)}%`);
    if (m.contourSimilarity !== null) parts.push(`モチーフとの輪郭の近さ ${Math.round(m.contourSimilarity * 100)}%`);
    if (m.outside !== null) parts.push(`${card!.frets![0]}〜${card!.frets![1]}フレットの外の音 ${m.outside}回`);
    const landings = auto?.outcomes.filter(o => o.landing) ?? [];
    if (landings.length) parts.push(`コードが変わった直後の着地：${landings.slice(0, 16).map(o => `${chords[o.slot.index].symbol}→${o.landing}`).join('、')}`);
    if (card?.reference === 'bar-landings') { const heads = landings.filter(o => chords[o.slot.index].slot === 0); parts.push(`小節の頭の着地 ${heads.filter(o => ['3', '♭3'].includes(o.landing!)).length} / ${heads.length}回が 3rd`); }
    if (card?.reference === 'first-note' && t.events.length) parts.push(`最初の音は1拍目から ${(t.events[0].startMs / beat).toFixed(1)}拍後`);
    if (t.matchAt !== null && t.onsets) {
      const played = t.events.slice(t.matchAt, t.matchAt + task!.motif.notes.length), gaps = played.slice(1).map((e, i) => ((e.startMs - played[i].startMs) / beat).toFixed(1));
      parts.push(`リズム（参考）：弾いた間隔 ${gaps.join('・')}拍 ／ モチーフ ${task!.motif.notes.slice(0, -1).map(n => n.beats).join('・')}拍`);
    }
    return `参考（点数ではありません）：${parts.join(' · ')}`;
  }
  function renderChecklist() {
    const box = $('#phrase-checklist');
    const items = checklist.filter(c => c.id !== 'constraint' || card);
    if (box.dataset.items !== items.map(c => c.id).join(',')) {
      box.dataset.items = items.map(c => c.id).join(',');
      box.replaceChildren(box.querySelector('legend')!, ...items.map(c => {
        const row = document.createElement('div'); row.className = 'phrase-check';
        const label = document.createElement('span'); label.textContent = c.text;
        const choices = document.createElement('span');
        for (const [value, name] of marks) {
          const l = document.createElement('label'), input = document.createElement('input');
          input.type = 'radio'; input.name = `phrase-check-${c.id}`; input.value = value;
          input.addEventListener('change', () => { selfMarks = { ...selfMarks, [c.id]: value }; });
          l.append(input, name); choices.append(l);
        }
        row.append(label, choices); return row;
      }));
    }
    $$<HTMLInputElement>('#phrase-checklist input').forEach(input => input.checked = selfMarks[input.name.replace('phrase-check-', '')] === input.value);
  }
  function renderTakes() {
    const takes = decodePhraseTakes(training.current.takes).reverse();
    const list = $('#phrase-takes');
    if (!takes.length) { const empty = document.createElement('li'); empty.textContent = 'まだありません'; list.replaceChildren(empty); return; }
    list.replaceChildren(...takes.map(t => {
      const item = document.createElement('li'), kind = taskKinds.find(k => t.taskId.startsWith(`${k.kind}:`));
      const constraint = constraintCards.find(c => c.id === t.constraintId), marked = Object.values(t.selfAssessment);
      item.textContent = `${new Date(t.at).toLocaleString()} · ${kind?.name ?? t.taskId} · ${t.tempo} BPM · ${t.events.length}音${t.objective === null ? '' : t.objective ? ' · 一致' : ' · 不一致'}${constraint ? ` · 制約「${constraint.text}」` : ''}${marked.length ? ` · 自己評価 はい${marked.filter(m => m === 'yes').length}・一部${marked.filter(m => m === 'partial').length}・いいえ${marked.filter(m => m === 'no').length}` : ''}${t.memo ? ` · ${t.memo}` : ''}`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '再生'; button.disabled = !t.events.length;
      button.addEventListener('click', () => replay(t.events)); item.append(button);
      return item;
    }));
  }
  function render() {
    if (!visible) return;
    const p = progression();
    if (!task && p) newTask();
    renderSettings(); renderChart(p);
    text('#phrase-title', task ? task.title : 'フレーズ');
    text('#phrase-instruction', task ? task.instruction : '進行を選んでください');
    text('#phrase-motif', task ? `モチーフ（${task.motif.name}・${motifBeats(task.motif)}拍${task.motif.startBeat ? `、${task.motif.startBeat}拍休んでから` : ''}）：${describeMotif(task.motif)}` : '');
    $('#phrase-constraint').hidden = !card; text('#phrase-constraint', card ? `制約カード：${card.text} — ${card.detail}` : '');
    if (running && auto) {
      const t = now(), beat = auto.beatAt(t), slot = auto.slotAt(t);
      text('#phrase-progress', `${prefs.bpm} BPM · ${beat.countIn ? 'カウント' : `${slot?.pass ?? 1}周目`} · 拍 ${beat.beat} · 記録 ${auto.notes.filter(n => n.startMs >= auto!.countInMs - 100).length}音`);
      text('#phrase-status', beat.countIn ? 'カウントのあと、進行の上で弾いてください' : `いま ${slot ? auto.chords[slot.index].symbol : ''}（Space で停止。止めても記録は残ります）`);
    } else { text('#phrase-progress', ''); text('#phrase-status', status); }
    $('#phrase-heard').hidden = !running; text('#phrase-heard', controller.phase === 'running' ? `入力 ${heard || '—'}` : '入力は停止しています');
    $<HTMLButtonElement>('#phrase-primary').textContent = running ? '停止' : '開始';
    for (const id of ['#phrase-new', '#phrase-listen']) $<HTMLButtonElement>(id).disabled = running;
    $('#phrase-review').hidden = !take || running;
    if (take && !running && p && task) {
      renderTimeline(p);
      $('#phrase-verdict').innerHTML = !task.objective ? '<span class="answer-detail">この課題は自己評価です</span>' : !take.events.length ? '' : take.objective
        ? `<span class="is-right">モチーフの${task.kind === 'repeat' ? '反復' : '形'}が見つかりました（${take.matchAt! + 1}音目から）✓</span>`
        : `<span class="is-wrong">${task.kind === 'repeat' ? '同じ音の並び' : `${task.start!.name} から同じ形`}は見つかりませんでした</span>`;
      text('#phrase-metrics', take.events.length ? referenceText(p) : '');
      $<HTMLButtonElement>('#phrase-replay').disabled = !take.events.length;
      renderChecklist();
    }
    renderTakes();
    tuner.audio.render({ startBlocked: false, startLabel: '入力を開始', stopLabel: '停止', lockReference: true });
  }

  const change = (patch: Partial<PhrasePreferences>, renew = true) => { prefs = { ...prefs, ...patch }; save(); if (renew) { stopRun(); newTask(); } render(); };
  $('#phrase-kind').addEventListener('change', e => change({ kind: (e.target as HTMLSelectElement).value as PhrasePreferences['kind'] }));
  $('#phrase-source').addEventListener('change', e => change({ source: (e.target as HTMLSelectElement).value === 'random' ? 'random' : 'library' }));
  $('#phrase-shape').addEventListener('change', e => change({ shape: (e.target as HTMLSelectElement).value }));
  $('#phrase-length').addEventListener('change', e => change({ length: Number((e.target as HTMLSelectElement).value) }));
  $('#phrase-progression').addEventListener('change', e => change({ progressionId: (e.target as HTMLSelectElement).value }));
  $('#phrase-key').addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; change(library.find(x => x.id === prefs.progressionId)?.mode === 'minor' ? { minorTonic: v } : { majorTonic: v }); });
  $('#phrase-bpm').addEventListener('change', e => { const bpm = Math.round(Number((e.target as HTMLInputElement).value)); change({ bpm: Number.isFinite(bpm) ? Math.min(160, Math.max(40, bpm)) : prefs.bpm }, false); });
  $('#phrase-passes').addEventListener('change', e => change({ passes: Number((e.target as HTMLSelectElement).value) }, false));
  $('#phrase-click').addEventListener('change', e => change({ click: (e.target as HTMLSelectElement).value as ClickMode }, false));
  $('#phrase-volume').addEventListener('input', e => { prefs = { ...prefs, volume: Number((e.target as HTMLInputElement).value) }; sound.setVolume(prefs.volume); save(); });
  $('#phrase-pitch-class').addEventListener('change', e => change({ pitchClass: (e.target as HTMLInputElement).checked }, false));
  $('#phrase-with-card').addEventListener('change', e => { prefs = { ...prefs, withCard: (e.target as HTMLInputElement).checked }; save(); card = prefs.withCard ? drawConstraint(Math.random, card?.id ?? null) : null; render(); });
  $('#phrase-primary').addEventListener('click', toggle);
  $('#phrase-listen').addEventListener('click', listen);
  $('#phrase-replay-motif').addEventListener('click', listen);
  $('#phrase-new').addEventListener('click', () => { newTask(); render(); });
  // A card can be drawn on its own, to practise without recording.
  $('#phrase-draw').addEventListener('click', () => { card = drawConstraint(Math.random, card?.id ?? null); render(); });
  $('#phrase-replay').addEventListener('click', () => { if (take) replay(take.events); });
  $('#phrase-save').addEventListener('click', saveTake);
  $('#phrase-discard').addEventListener('click', () => { take = null; status = '保存しませんでした'; render(); });
  document.addEventListener('keydown', event => {
    if (!visible || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('.harmony-settings,.feature-tabs,.instrument-bar') || target.matches('input,select,textarea,[contenteditable=true]')) return;
    if (event.code === 'Space') { event.preventDefault(); toggle(); }
    else if ((event.key === 'm' || event.key === 'M') && !running) { event.preventDefault(); listen(); }
  });

  const owner = {
    onStart(settings: Parameters<typeof controller.start>[0]) { repository.updateAudio(settings); void controller.start(settings); if (!running) start(); },
    onStop() { if (running) finishRun(); void controller.stop(); },
    onChange() { render(); },
  };
  /** Hides the outgoing section first: leaving the chord changes clears the audio owner, which must not undo ours. */
  function applySection() {
    const phraseOn = panelVisible && section === 'phrase';
    if (!phraseOn) {
      if (visible) { if (running) finishRun(); tuner.setAudioOwner(null); hub.setActiveConsumer(null); void controller.stop(); }
      visible = false;
    }
    changes.show(panelVisible && section === 'changes');
    if (phraseOn && !visible) { visible = true; tuner.audio.attach($('#phrase-audio')); tuner.setAudioOwner(owner); hub.setActiveConsumer(consumer); if (!tuner.audio.loaded) void tuner.audio.refreshDevices(); }
    $('#prog-area').hidden = section !== 'changes'; $('#prog-settings').hidden = section !== 'changes';
    $('#phrase-area').hidden = section !== 'phrase'; $('#phrase-settings').hidden = section !== 'phrase';
    $$<HTMLButtonElement>('[data-prog-section]').forEach(button => { const on = button.dataset.progSection === section; button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on)); });
    render();
  }
  $$<HTMLButtonElement>('[data-prog-section]').forEach(button => button.addEventListener('click', () => {
    section = button.dataset.progSection === 'phrase' ? 'phrase' : 'changes'; training.updatePreferences('progressionSection', section); applySection();
  }));
  return {
    setInstrument(next: InstrumentProfile) { profile = next; changes.setInstrument(next); stopRun(); take = null; task = null; render(); },
    show(show: boolean) { panelVisible = show; applySection(); },
  };
}
