import { $, $$ } from '../../ui/dom';
import { create } from '../../domain/instruments/core';
import { resolveInstrument, type InstrumentProfile } from '../../domain/instruments/profiles';
import { compareSequence, generateMelody, kindNames, levelShape, maxLevel, playbackPlan, staircase, type EarKind, type EarKey, type EarQuestion, type Staircase } from '../../domain/training/ear';
import { minorTonics } from '../../domain/training/key-questions';
import { pitchClassLabel } from '../../domain/training/note-answers';
import type { AttemptResult } from '../../domain/training/records';
import { NoteSegmenter } from '../../domain/practice/note-events';
import type { AudioObservation } from '../../platform/audio';
import type { SettingsRepository } from '../../platform/settings';
import type { TrainingRepository } from '../../platform/training-store';
import { sound } from '../../platform/sound';
import type { AudioConsumer, AudioHub } from '../audio/hub';
import type { mountTuner } from '../tuner/view';
import { MarkedFretboard, type Mark } from '../../ui/marked-fretboard';

type Method = 'play' | 'sing' | 'sing-then-play';
type Stage = 'sing' | 'play';
interface EarPreferences {
  kind: EarKind; key: string; auto: boolean; level: number; octave: 'pc' | 'exact'; errorMode: 'reset' | 'end';
  context: 'tonic' | 'cadence' | 'none'; noteSeconds: number; replays: number; length: number; method: Method; singChannel: 'same' | '0' | '1' | '2' | '3'; allowRepeats: boolean;
}
const majorKeys = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'].map(t => `major:${t}`);
const minorKeys = minorTonics.map(t => `minor:${t}`);
const marginMs = 300;
function decodePreferences(input: unknown): EarPreferences {
  const value = (input && typeof input === 'object' ? input : {}) as Partial<EarPreferences>;
  const pick = <T,>(candidate: unknown, allowed: readonly T[], fallback: T) => allowed.includes(candidate as T) ? candidate as T : fallback;
  return {
    kind: pick(value.kind, ['single', 'interval', 'melody', 'chord'] as const, 'melody'), key: pick(value.key, [...majorKeys, ...minorKeys], 'major:C'),
    auto: value.auto !== false, level: pick(value.level, [1, 2, 3, 4, 5, 6, 7, 8], 1), octave: pick(value.octave, ['pc', 'exact'] as const, 'pc'),
    errorMode: pick(value.errorMode, ['reset', 'end'] as const, 'reset'), context: pick(value.context, ['tonic', 'cadence', 'none'] as const, 'tonic'),
    noteSeconds: pick(value.noteSeconds, [.8, .6, .45], .6), replays: pick(value.replays, [0, 3], 0), length: pick(value.length, [10, 20], 10),
    method: pick(value.method, ['play', 'sing', 'sing-then-play'] as const, 'play'), singChannel: pick(value.singChannel, ['same', '0', '1', '2', '3'] as const, 'same'), allowRepeats: value.allowRepeats === true,
  };
}
interface Outcome { question: EarQuestion; stage: Stage; result: AttemptResult; played: string[]; mistakes: number }

/** Ear training: the app plays a short phrase, the player reproduces it on the guitar (or sings it first). Playback and input never overlap. */
export function mountEar(repository: SettingsRepository, hub: AudioHub, tuner: ReturnType<typeof mountTuner>, training: TrainingRepository, rhythm: { show(show: boolean): void }) {
  let panelVisible = false, section: 'ear' | 'rhythm' = training.preference('earSection') === 'rhythm' ? 'rhythm' : 'ear';
  const controller = hub.controller;
  let profile = resolveInstrument(repository.current.lastInstrument, repository.current.instruments[repository.current.lastInstrument]);
  let prefs = decodePreferences(training.preference('ear'));
  let ladder: Staircase = { level: prefs.level, streak: 0 };
  let question: EarQuestion | null = null, phase: 'idle' | 'playing' | 'listening' | 'answered' | 'finished' = 'idle', stage: Stage = 'play';
  let step = 0, played: number[] = [], mistakes = 0, replaysUsed = 0, listenedAt = 0, ignoreUntil = 0, count = 0, visible = false;
  let feedback = '', heard = '', playbackTimer: ReturnType<typeof setTimeout> | null = null, advanceTimer: ReturnType<typeof setTimeout> | null = null;
  const outcomes: Outcome[] = [];
  let segmenter = new NoteSegmenter({ minHoldMs: 200, releaseMs: 120, referenceHz: repository.current.audio.referenceHz });
  const board = new MarkedFretboard($('#ear-board'));
  const range = (): [number, number] => { const opens = profile.strings.map(s => s.openMidi); return [Math.min(...opens), Math.max(...opens) + profile.fretCount]; };
  const key = (): EarKey => { const [mode, tonic] = prefs.key.split(':'); return { tonic, mode: mode as EarKey['mode'] }; };
  /** Focused practice sets the kind and level for a weak item; those are never saved, the rest of the settings are. */
  let focus: { label: string; restore: Pick<EarPreferences, 'kind' | 'auto' | 'level'> } | null = null;
  const save = () => training.updatePreferences('ear', focus ? { ...prefs, ...focus.restore } : prefs);
  function endFocus() { if (!focus) return; prefs = { ...prefs, ...focus.restore }; ladder = { level: prefs.level, streak: 0 }; focus = null; }
  const text = (selector: string, value: string) => { const element = $(selector); if (element.textContent !== value) element.textContent = value; };
  const matchOctave = () => stage === 'play' && prefs.octave === 'exact';
  const same = (a: number, b: number) => matchOctave() ? a === b : a % 12 === b % 12;
  const clear = () => { if (playbackTimer) clearTimeout(playbackTimer); if (advanceTimer) clearTimeout(advanceTimer); playbackTimer = advanceTimer = null; };

  /** Singing may use another input channel (a vocal mic); the guitar uses the saved one. Switching restarts the input. */
  async function useInput(next: Stage) {
    const audio = repository.current.audio, channel = next === 'sing' && prefs.singChannel !== 'same' ? Number(prefs.singChannel) : audio.channel;
    segmenter = new NoteSegmenter({ minHoldMs: next === 'sing' ? 300 : 200, releaseMs: 120, referenceHz: audio.referenceHz });
    if (controller.phase === 'running' && controller.started?.channel === channel) return;
    if (controller.phase !== 'idle') await controller.stop();
    void controller.start({ ...audio, channel });
  }
  function start() {
    clear(); outcomes.length = 0; count = 0; ladder = { level: prefs.level, streak: 0 }; feedback = '';
    ask();
  }
  function ask() {
    clear();
    question = generateMelody(prefs.kind, prefs.auto ? ladder.level : prefs.level, key(), range(), Math.random, prefs.allowRepeats);
    stage = prefs.method === 'play' ? 'play' : 'sing'; replaysUsed = 0; reset(); feedback = '';
    void useInput(stage);
    playQuestion();
  }
  function reset() { step = 0; played = []; mistakes = 0; segmenter.reset(); }
  /** Half duplex: input is ignored while the phrase plays and for a short margin after, so the speaker cannot answer. */
  function playQuestion() {
    if (!question) return;
    clear(); phase = 'playing';
    const plan = playbackPlan(question, prefs.context, prefs.noteSeconds);
    const seconds = sound.play(plan.events, repository.current.audio.referenceHz);
    ignoreUntil = performance.now() + seconds * 1000 + marginMs;
    playbackTimer = setTimeout(() => { playbackTimer = null; phase = 'listening'; listenedAt = performance.now(); segmenter.reset(); render(); }, seconds * 1000 + marginMs);
    render();
  }
  function replay() {
    if (!question || phase === 'idle' || phase === 'finished') return;
    if (prefs.replays && replaysUsed >= prefs.replays) { feedback = `聞き直しは ${prefs.replays}回までです`; render(); return; }
    replaysUsed++; if (phase !== 'answered') reset(); playQuestion();
  }
  function handleNote(midi: number) {
    if (!question || phase !== 'listening') return;
    const target = question.notes.map(n => n.midi), label = pitchClassLabel(midi % 12, 'both');
    if (prefs.errorMode === 'end') {
      played.push(midi);
      if (played.length >= target.length) {
        const compared = compareSequence(target, played, matchOctave());
        mistakes = compared.distance; complete(compared.correct ? 'correct' : 'wrong');
      } else render();
      return;
    }
    if (same(target[step], midi)) { played.push(midi); step++; feedback = ''; if (step === target.length) complete(mistakes ? 'wrong' : 'correct'); else render(); return; }
    mistakes++;
    feedback = `<span class="is-wrong">${step + 1}音目が違います（${label}）。1音目から</span>`;
    played = []; step = 0;
    // The wrong note may itself be a correct first note.
    if (same(target[0], midi)) { played = [midi]; step = 1; }
    render();
  }
  function record(result: AttemptResult) {
    if (!question) return;
    training.add({ itemId: question.itemId, layer: 'performance', trainer: 'ear', method: stage === 'sing' ? 'sing' : 'play', result, responseMs: Math.round(performance.now() - listenedAt), instrument: profile.id, ...(mistakes ? { errorKind: `mistakes:${mistakes}` } : {}) });
  }
  function complete(result: AttemptResult) {
    if (!question) return;
    record(result);
    outcomes.push({ question, stage, result, played: played.map(m => pitchClassLabel(m % 12, 'both').split(' / ')[0]), mistakes });
    // Sing first, then the same phrase on the guitar.
    if (prefs.method === 'sing-then-play' && stage === 'sing' && result === 'correct') {
      stage = 'play'; reset(); feedback = '<span class="is-right">歌えました。次はギターで弾いてください</span>'; phase = 'listening'; listenedAt = performance.now();
      void useInput('play'); render(); return;
    }
    if (prefs.auto && (result === 'correct' || result === 'wrong')) { ladder = staircase(ladder, result === 'correct'); }
    phase = 'answered'; count++;
    feedback = result === 'correct' ? '<span class="is-right">正解！</span>' : result === 'wrong' ? `<span class="is-wrong">${prefs.errorMode === 'end' ? `${mistakes}か所違いました` : `途中で ${mistakes}回 間違えました`}</span>` : result === 'skipped' ? '答え' : '正解として記録しました';
    if (result === 'correct') advanceTimer = setTimeout(() => { advanceTimer = null; next(); }, 1200);
    render();
  }
  function next() {
    clear();
    if (count >= prefs.length) { phase = 'finished'; void controller.stop(); render(); return; }
    ask();
  }
  function skip(kind: 'skipped' | 'self-marked') { if (phase === 'listening' || phase === 'playing') { clear(); complete(kind); } }

  const consumer: AudioConsumer = {
    consume(o: AudioObservation) {
      if (phase !== 'listening' || performance.now() < ignoreUntil || controller.phase !== 'running' || !controller.started) return;
      segmenter.bind(controller.started.sessionId);
      const change = segmenter.push(o), current = segmenter.current();
      heard = current ? pitchClassLabel(current.midi % 12, 'both') : '';
      if (change.started) handleNote(change.started.midi); else render();
    },
    sync() { if (controller.phase === 'error' && phase === 'listening') feedback = `入力が中断しました：${controller.error}`; render(); },
    pause() { segmenter.reset(); },
  };
  hub.onChange(() => { if (visible) render(); });

  function marks(): Mark[] {
    if (!question || phase !== 'answered') return [];
    const C = create(profile), shown: Mark[] = [];
    question.notes.forEach((note, i) => {
      const position = C.candidates(C.normalize()).find(p => C.midi(p) === note.midi);
      if (position && !shown.some(m => m.position.string === position.string && m.position.fret === position.fret))
        shown.push({ position, label: `${note.name}<small>${i + 1}</small>`, tone: i === 0 ? 'root' : 'correct', description: `${i + 1}音目 ${note.name}（${note.degree}）` });
    });
    return shown;
  }
  function render() {
    if (!visible) return;
    renderSettings();
    $('#ear-focus').hidden = !focus; text('#ear-focus-text', focus ? `苦手を練習中：${focus.label}（レベル ${prefs.level} に固定。種類とレベルは保存しません）` : '');
    const k = key(), keyName = `${k.tonic} ${k.mode === 'major' ? 'メジャー' : 'マイナー'}`;
    if (!question || phase === 'idle') { text('#ear-title', '聴音'); text('#ear-subtitle', '開始すると短いフレーズを再生します。聴いて同じ音を弾いてください'); }
    else if (phase === 'finished') { text('#ear-title', '終了'); text('#ear-subtitle', ''); }
    else {
      const n = question.notes.length;
      text('#ear-title', `♪ ${kindNames[question.kind]}${n > 1 ? ` ${n}音` : ''}`);
      text('#ear-subtitle', `${keyName}${question.chord ? ` ／ ${question.chord} のコードトーン` : ''}${question.kind === 'interval' ? ` ／ 1音目は ${question.notes[0].name}` : ''}${stage === 'sing' ? ' ／ まず歌ってください' : ''}`);
    }
    const dots = question && phase !== 'idle' && phase !== 'finished' ? question.notes.map((_, i) => phase === 'answered' ? `<span class="${outcomes.at(-1)?.result === 'correct' ? 'is-right' : ''}">●</span>` : i < (prefs.errorMode === 'end' ? played.length : step) ? '●' : '○').join(' ') : '';
    $('#ear-dots').innerHTML = dots;
    const answer = question && phase === 'answered' ? `<br><span class="answer-detail">${question.notes.map(n => `${n.name}（${n.degree}）`).join(' → ')}${outcomes.at(-1)?.played.length ? ` ／ あなた：${outcomes.at(-1)!.played.join(' → ')}` : ''}</span>` : '';
    $('#ear-feedback').innerHTML = `<span class="answer-detail">${feedback}</span>${answer}`;
    text('#ear-status', phase === 'playing' ? '再生中…（この間の入力は判定しません）' : phase === 'listening' ? (stage === 'sing' ? '歌ってください（音名だけ判定）' : '弾いてください') : phase === 'answered' && outcomes.at(-1)?.result !== 'correct' ? 'Space で次の問題へ' : '');
    $('#ear-heard').hidden = phase !== 'listening';
    text('#ear-heard', controller.phase === 'running' ? `入力 ${heard || '—'}` : '入力は停止しています');
    text('#ear-progress', question && phase !== 'idle' && phase !== 'finished' ? `${count + (phase === 'answered' ? 0 : 1)} / ${prefs.length}問 · 段階 ${prefs.auto ? ladder.level : prefs.level}${prefs.replays ? ` · 聞き直し 残り${Math.max(0, prefs.replays - replaysUsed)}` : ''}` : '');
    $<HTMLButtonElement>('#ear-primary').textContent = phase === 'idle' || phase === 'finished' ? '開始' : phase === 'answered' ? '次の問題 →' : '開始し直す';
    $<HTMLButtonElement>('#ear-replay').disabled = !question || phase === 'idle' || phase === 'finished';
    $<HTMLButtonElement>('#ear-skip').disabled = !(phase === 'listening' || phase === 'playing');
    $<HTMLButtonElement>('#ear-self').disabled = phase !== 'listening';
    $<HTMLButtonElement>('#ear-finish').disabled = phase === 'idle' || phase === 'finished';
    board.render(profile, marks(), () => false);
    renderResults();
    tuner.audio.render({ startBlocked: false, startLabel: '入力を開始', stopLabel: '停止', lockReference: true });
  }
  function renderResults() {
    const done = phase === 'finished';
    $('#ear-results').hidden = !done;
    if (!done) return;
    const graded = outcomes.filter(o => o.result === 'correct' || o.result === 'wrong'), right = graded.filter(o => o.result === 'correct');
    text('#ear-summary', `正解 ${right.length} / ${graded.length}${outcomes.length - graded.length ? `（答えを見た・自己判定 ${outcomes.length - graded.length}）` : ''}${prefs.auto ? ` · 最後の段階 ${ladder.level}` : ''}`);
    $('#ear-list').replaceChildren(...outcomes.filter(o => o.result !== 'correct').map(o => { const item = document.createElement('li'); item.textContent = `${o.stage === 'sing' ? '歌' : 'ギター'}：${o.question.notes.map(n => n.name).join(' → ')}${o.played.length ? `（あなた：${o.played.join(' → ')}）` : ''}`; return item; }));
  }
  const option = (value: string, label: string) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
  function renderSettings() {
    const keySelect = $<HTMLSelectElement>('#ear-key');
    if (!keySelect.options.length) keySelect.replaceChildren(...majorKeys.map(k => option(k, `${k.split(':')[1]} メジャー`)), ...minorKeys.map(k => option(k, `${k.split(':')[1]} マイナー`)));
    keySelect.value = prefs.key; $<HTMLSelectElement>('#ear-kind').value = prefs.kind; $<HTMLInputElement>('#ear-auto').checked = prefs.auto;
    $<HTMLSelectElement>('#ear-level').value = String(prefs.auto ? ladder.level : prefs.level);
    $<HTMLSelectElement>('#ear-octave').value = prefs.octave; $<HTMLSelectElement>('#ear-error').value = prefs.errorMode;
    $<HTMLSelectElement>('#ear-context').value = prefs.context; $<HTMLSelectElement>('#ear-speed').value = String(prefs.noteSeconds);
    $<HTMLSelectElement>('#ear-replays').value = String(prefs.replays); $<HTMLSelectElement>('#ear-length').value = String(prefs.length);
    $$<HTMLInputElement>('input[name=ear-method]').forEach(el => el.checked = el.value === prefs.method);
    $<HTMLSelectElement>('#ear-sing-channel').value = prefs.singChannel; $<HTMLInputElement>('#ear-repeats').checked = prefs.allowRepeats;
    $('#ear-sing-channel').closest('label')!.hidden = prefs.method === 'play';
  }
  const change = (patch: Partial<EarPreferences>) => { prefs = { ...prefs, ...patch }; save(); clear(); if (phase !== 'idle') { phase = 'idle'; question = null; } render(); };
  const select = (id: string, apply: (v: string) => Partial<EarPreferences>) => $(id).addEventListener('change', e => change(apply((e.target as HTMLSelectElement).value)));
  select('#ear-kind', v => ({ kind: v as EarKind })); select('#ear-key', v => ({ key: v }));
  select('#ear-level', v => ({ level: Math.min(maxLevel, Math.max(1, Number(v))) }));
  select('#ear-octave', v => ({ octave: v as EarPreferences['octave'] })); select('#ear-error', v => ({ errorMode: v as EarPreferences['errorMode'] }));
  select('#ear-context', v => ({ context: v as EarPreferences['context'] })); select('#ear-speed', v => ({ noteSeconds: Number(v) }));
  select('#ear-replays', v => ({ replays: Number(v) })); select('#ear-length', v => ({ length: Number(v) }));
  select('#ear-sing-channel', v => ({ singChannel: v as EarPreferences['singChannel'] }));
  $('#ear-auto').addEventListener('change', e => change({ auto: (e.target as HTMLInputElement).checked }));
  $('#ear-repeats').addEventListener('change', e => change({ allowRepeats: (e.target as HTMLInputElement).checked }));
  $$<HTMLInputElement>('input[name=ear-method]').forEach(el => el.addEventListener('change', () => change({ method: el.value as Method })));
  $('#ear-primary').addEventListener('click', () => { if (phase === 'answered') next(); else start(); });
  $('#ear-replay').addEventListener('click', replay);
  $('#ear-skip').addEventListener('click', () => skip('skipped'));
  $('#ear-self').addEventListener('click', () => skip('self-marked'));
  $('#ear-finish').addEventListener('click', () => { clear(); phase = 'finished'; void controller.stop(); render(); });
  document.addEventListener('keydown', event => {
    if (!visible || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('.harmony-settings,.feature-tabs,.instrument-bar') || target.matches('input,select,textarea,[contenteditable=true]')) return;
    if (event.code === 'Space') { event.preventDefault(); if (phase === 'answered') next(); else if (phase === 'idle' || phase === 'finished') start(); }
    else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); replay(); }
    else if (event.key === 's' || event.key === 'S') { event.preventDefault(); skip('skipped'); }
  });
  const owner = {
    onStart(settings: Parameters<typeof controller.start>[0]) { repository.updateAudio(settings); void controller.start(settings); if (phase === 'idle' || phase === 'finished') start(); },
    onStop() { void controller.stop(); },
    onChange() { render(); },
  };
  /** The tab holds two sections; only listening uses the audio input, so leaving it releases the input. */
  function applySection() {
    const earOn = panelVisible && section === 'ear';
    if (visible && !earOn) { clear(); if (phase !== 'finished') { phase = 'idle'; question = null; } tuner.setAudioOwner(null); hub.setActiveConsumer(null); void controller.stop(); }
    const wasVisible = visible; visible = earOn;
    if (earOn && !wasVisible) { tuner.audio.attach($('#ear-audio')); tuner.setAudioOwner(owner); hub.setActiveConsumer(consumer); if (!tuner.audio.loaded) void tuner.audio.refreshDevices(); }
    $('#ear-area').hidden = section !== 'ear'; $('#ear-settings').hidden = section !== 'ear';
    $('#rhythm-area').hidden = section !== 'rhythm'; $('#rhythm-settings').hidden = section !== 'rhythm';
    $$<HTMLButtonElement>('[data-ear-section]').forEach(button => { const on = button.dataset.earSection === section; button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on)); });
    rhythm.show(panelVisible && section === 'rhythm');
    render();
  }
  $$<HTMLButtonElement>('[data-ear-section]').forEach(button => button.addEventListener('click', () => {
    section = button.dataset.earSection === 'rhythm' ? 'rhythm' : 'ear'; training.updatePreferences('earSection', section); applySection();
  }));
  $('#ear-focus-end').addEventListener('click', () => { endFocus(); render(); });
  return {
    setInstrument(next: InstrumentProfile) { profile = next; clear(); phase = 'idle'; question = null; render(); },
    show(show: boolean) { if (!show) endFocus(); panelVisible = show; applySection(); },
    /** Shows one section of the tab (for today's practice and focused practice) without saving the choice. */
    section(next: 'ear' | 'rhythm') { section = next; applySection(); },
    /** An ear item names a kind, a note count and whether notes outside the key appear: the lowest level with that shape is fixed. */
    focus(itemIds: string[], label: string) {
      const [, kind, length, chromatic] = itemIds[0]?.split(':') ?? [];
      if (!['single', 'interval', 'melody', 'chord'].includes(kind)) return;
      const levels = Array.from({ length: maxLevel }, (_, i) => i + 1), shape = (l: number) => levelShape(kind as EarKind, l);
      const level = levels.find(l => shape(l).length === Number(length) && shape(l).chromatic === (chromatic === 'chromatic')) ?? levels.find(l => shape(l).length === Number(length)) ?? 1;
      endFocus();
      focus = { label, restore: { kind: prefs.kind, auto: prefs.auto, level: prefs.level } };
      prefs = { ...prefs, kind: kind as EarKind, auto: false, level }; ladder = { level, streak: 0 };
      clear(); phase = 'idle'; question = null; section = 'ear'; applySection();
    },
  };
}
