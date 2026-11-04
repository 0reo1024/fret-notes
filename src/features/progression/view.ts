import { $, $$ } from '../../ui/dom';
import { create, type Position } from '../../domain/instruments/core';
import { resolveInstrument, type InstrumentProfile } from '../../domain/instruments/profiles';
import {
  decodeStored, flatten, formatProgression, fromStored, library, materialize, parseProgression, ProgressionRun, stageNames,
  type ChangeStage, type ProgressionChord, type ChordResult, type KeyInfo, type Progression, type StoredProgression,
} from '../../domain/training/progression';
import { minorTonics } from '../../domain/training/key-questions';
import { pitchClassLabel } from '../../domain/training/note-answers';
import { NoteSegmenter, defaultSegmenterOptions, heldInto } from '../../domain/practice/note-events';
import type { AudioObservation } from '../../platform/audio';
import type { SettingsRepository } from '../../platform/settings';
import type { TrainingRepository } from '../../platform/training-store';
import type { AudioConsumer, AudioHub } from '../audio/hub';
import type { mountTuner } from '../tuner/view';
import { mountRange } from '../settings/range';
import { MarkedFretboard, type Mark } from '../../ui/marked-fretboard';
import { AutoProgress, InputClock, playableAuto, shortestChord, type ClickMode, type SlotOutcome } from '../../domain/training/timeline';
import { ClickScheduler, sound } from '../../platform/sound';
import { enumerateLines, formatLine, LineRun, representativeLines, traitText, describeLine, type LineConstraint, type LineStart } from '../../domain/training/voice-leading';
import { advancedOpen, advancedStatus, approachPatterns, ApproachRun, type ApproachPattern, type ApproachRole } from '../../domain/training/advanced';

type Method = 'play' | 'click';
type Guide = 'off' | 'after' | 'on';
type Stage = ChangeStage | 'free' | 'line' | 'approach';
interface ProgressionPreferences {
  progressionId: string; majorTonic: string; minorTonic: string; stage: Stage; ninth: boolean; repeats: number;
  mode: 'step' | 'auto'; bpm: number; scale: 1 | 2; click: ClickMode; volume: number;
  lineStart: LineStart; lineDegrees: LineConstraint['allowedDegrees']; lineMax: 2 | 4; lineHint: boolean; approachPattern: ApproachPattern; approachRole: ApproachRole;
  method: Method; showAnswer: boolean; guide: Guide; strings: number[] | null; frets: number[] | null;
}
const majorTonics = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const stages: Stage[] = ['root', 'third', 'seventh', 'guide', 'any-chord-tone', 'with-tensions', 'free', 'line', 'approach'];
/** Stages practised one chord at a time only (no auto-advance). */
const stepOnly: Stage[] = ['line', 'approach'];
/** Degrees counted as a guide-tone landing in the free stage. */
const guideDegrees = ['3', '♭3', '7', '♭7', '♭♭7'];
/** Stages that map onto the chord-tone trainer's items, so practice here also counts for "G7 → 3rd". */
const toneRole: Partial<Record<Stage, string>> = { root: 'root', third: 'third', seventh: 'seventh', guide: 'guide' };
const median = (values: number[]) => { const s = values.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };

function decodePreferences(input: unknown): ProgressionPreferences {
  const value = (input && typeof input === 'object' ? input : {}) as Partial<ProgressionPreferences>;
  const pick = <T,>(candidate: unknown, allowed: readonly T[], fallback: T) => allowed.includes(candidate as T) ? candidate as T : fallback;
  const numbers = (list: unknown) => Array.isArray(list) && list.every(n => Number.isInteger(n)) ? list as number[] : null;
  return {
    progressionId: typeof value.progressionId === 'string' ? value.progressionId : library[0].id,
    majorTonic: pick(value.majorTonic, majorTonics, 'C'), minorTonic: pick(value.minorTonic, minorTonics, 'A'),
    stage: pick(value.stage, stages, 'third'), ninth: value.ninth === true, repeats: pick(value.repeats, [1, 2, 4, 0], 2),
    mode: pick(value.mode, ['step', 'auto'] as const, 'step'), bpm: typeof value.bpm === 'number' && value.bpm >= 40 && value.bpm <= 160 ? Math.round(value.bpm) : 72,
    scale: pick(value.scale, [1, 2] as const, 1), click: pick(value.click, ['all', 'backbeat', 'one', 'none'] as const, 'all'),
    volume: typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 1 ? value.volume : .6,
    lineStart: pick(value.lineStart, ['free', 'third', 'seventh'] as const, 'free'), lineDegrees: pick(value.lineDegrees, ['guide', 'chord-tones', 'tensions'] as const, 'guide'),
    approachPattern: pick(value.approachPattern, approachPatterns.map(p => p.id), 'enclosure-diatonic'), approachRole: pick(value.approachRole, ['third', 'seventh', 'root'] as const, 'third'),
    lineMax: pick(value.lineMax, [2, 4] as const, 2), lineHint: value.lineHint === true,
    method: pick(value.method, ['play', 'click'] as const, 'play'), showAnswer: value.showAnswer !== false, guide: pick(value.guide, ['off', 'after', 'on'] as const, 'after'),
    strings: numbers(value.strings), frets: numbers(value.frets),
  };
}

/** Chord-change trainer in step mode: the run waits on each chord's target tones and moves on when they are played. */
export function mountProgression(repository: SettingsRepository, hub: AudioHub, tuner: ReturnType<typeof mountTuner>, training: TrainingRepository) {
  const controller = hub.controller;
  let profile = resolveInstrument(repository.current.lastInstrument, repository.current.instruments[repository.current.lastInstrument]);
  let prefs = decodePreferences(training.preference('progression'));
  let stored: StoredProgression[] = decodeStored(training.current.progressions);
  let run: ProgressionRun | null = null, visible = false, chordShownAt = 0, heard = '', feedback = '', editingId: string | null = null;
  let changeAt: number | null = null, heldChecked = true, lastAudioMs = 0, previousTarget: { symbol: string; label: string; pcs: number[] } | null = null;
  const segmenter = new NoteSegmenter(defaultSegmenterOptions(repository.current.audio.referenceHz));
  // Auto mode: the run is laid out on the performance clock from the first count-in beat.
  let auto: AutoProgress | null = null, autoRunning = false, scheduler: ClickScheduler | null = null, t0Perf = 0, frame: number | null = null, autoKey = '';
  const inputClock = new InputClock();
  // Line stage (voice leading): one note per chord, one pass through the progression.
  let line: LineRun | null = null, lineCount = 0, lineMistakes = 0;
  // Approach stage (advanced): a short pattern into each chord's target, in order.
  let approach: ApproachRun | null = null;
  const board = new MarkedFretboard($('#prog-board'), position => answerClick(position));
  const range = mountRange($('#prog-range'), next => { prefs = { ...prefs, strings: next.strings, frets: next.frets }; save(); stop(); });

  const core = () => create(profile);
  const scope = () => core().normalize({ strings: prefs.strings ?? undefined, frets: prefs.frets ?? undefined });
  const positions = () => core().candidates(scope());
  const register = (): [number, number] | null => { const midis = positions().map(p => core().midi(p)); return midis.length ? [Math.min(...midis), Math.max(...midis)] : null; };
  const entry = () => library.find(e => e.id === prefs.progressionId);
  const userEntry = () => stored.find(s => s.id === prefs.progressionId);
  function progression(): Progression | null {
    const builtin = entry();
    if (builtin) return materialize(builtin, builtin.mode === 'major' ? prefs.majorTonic : prefs.minorTonic);
    const user = userEntry();
    return user ? fromStored(user) : null;
  }
  function save() { training.updatePreferences('progression', prefs); }
  const text = (selector: string, value: string) => { const element = $(selector); if (element.textContent !== value) element.textContent = value; };

  function start() {
    if (prefs.mode === 'auto') { startAuto(); return; }
    const p = progression();
    if (!p) { feedback = '進行を選んでください'; render(); return; }
    if (!positions().length) { feedback = '指板の範囲を選んでください'; render(); return; }
    if (prefs.stage === 'free') { feedback = '「自由」は自動進行でだけ使えます'; render(); return; }
    if (prefs.stage === 'line') { startLine(p); return; }
    if (prefs.stage === 'approach') { startApproach(p); return; }
    run = new ProgressionRun(p, prefs.stage, prefs.repeats || null, prefs.ninth);
    feedback = ''; previousTarget = null; showChord();
    if (prefs.method === 'play' && controller.phase === 'idle') { repository.updateAudio(repository.current.audio); void controller.start(repository.current.audio); }
  }
  function stop() { stopAuto(); run = null; auto = null; line = null; approach = null; feedback = ''; render(); }
  /** Advanced options fall back while locked, for example after the records were cleared. */
  function checkLock() {
    if (advancedOpen(training.current)) return;
    if (prefs.stage === 'approach') { prefs = { ...prefs, stage: 'third' }; approach = null; }
    if (prefs.lineDegrees === 'tensions') prefs = { ...prefs, lineDegrees: 'guide' };
  }
  function startApproach(p: Progression) {
    const window = register();
    if (!window) { feedback = '指板の範囲を選んでください'; render(); return; }
    run = null; line = null; approach = new ApproachRun(flatten(p), prefs.approachPattern, prefs.approachRole, p.key ?? null, window, prefs.repeats || null); feedback = '';
    if (prefs.method === 'play' && controller.phase === 'idle') { repository.updateAudio(repository.current.audio); void controller.start(repository.current.audio); }
    showChord();
  }
  const approachText = (a: ApproachRun, index = a.index) => a.notes(index).map(n => n.name).join(' → ');
  function answerApproach(midi: number, label: string) {
    if (!approach || approach.phase !== 'playing') return;
    const a = approach, chord = a.chord, notes = a.notes(), outcome = a.answer({ midi, startMs: 0, endMs: null, cents: 0 }, Math.round(performance.now() - chordShownAt));
    if (outcome === 'ignored') return;
    if (outcome === 'miss') feedback = `<span class="is-wrong">${label}：パターンは ${notes.map(n => n.name).join(' → ')}（最初から）</span>`;
    else if (outcome === 'progress') feedback = `${notes.slice(0, a.tracker.progress).map(n => n.name).join(' → ')} ✓ 続けて`;
    else {
      const result = a.results.at(-1)!;
      training.add({ itemId: `apr:${a.pattern}:${chord.quality}`, trainer: 'progression', layer: prefs.method === 'play' ? 'performance' : 'fretboard', method: prefs.method, result: result.mistakes ? 'wrong' : 'correct', responseMs: result.responseMs, instrument: profile.id, ...(result.mistakes ? { errorKind: `mistakes:${result.mistakes}` } : {}) });
      feedback = `<span class="is-right">${chord.symbol}：${notes.map(n => n.name).join(' → ')} ✓</span>`;
      if ((a.phase as ApproachRun['phase']) === 'finished') { if (prefs.method === 'play') void controller.stop(); render(); return; }
      showChord(); return;
    }
    render();
  }
  const lineConstraint = (): LineConstraint | null => { const window = register(); return window ? { allowedDegrees: prefs.lineDegrees, maxSemitones: prefs.lineMax, register: window } : null; };
  /** Checks first that some line exists under the chosen limits, so the player is never set an impossible task. */
  function startLine(p: Progression) {
    const constraint = lineConstraint(), chords = flatten(p);
    if (!constraint) { feedback = '指板の範囲を選んでください'; render(); return; }
    lineCount = enumerateLines(chords, prefs.lineStart, constraint, 200).length;
    if (!lineCount) { feedback = 'この条件では最後まで到達できるラインがありません。移動の上限を広げるか、許可する度数をコードトーンにしてください'; render(); return; }
    run = null; line = new LineRun(chords, constraint, prefs.lineStart); lineMistakes = 0; feedback = '';
    if (prefs.method === 'play' && controller.phase === 'idle') { repository.updateAudio(repository.current.audio); void controller.start(repository.current.audio); }
    showChord();
  }
  function answerLine(midi: number, label: string) {
    if (!line || line.phase !== 'playing') return;
    const chord = line.chord as ProgressionChord, verdict = line.answer(midi);
    if (!verdict) return;
    if (!verdict.ok) { lineMistakes++; feedback = `<span class="is-wrong">${label}：${verdict.reason}</span>`; render(); return; }
    const result = lineMistakes ? 'wrong' as const : 'correct' as const;
    training.add({ itemId: `chg:${chord.quality}:line`, trainer: 'progression', layer: prefs.method === 'play' ? 'performance' : 'fretboard', method: prefs.method, result, responseMs: Math.round(performance.now() - chordShownAt), instrument: profile.id, ...(lineMistakes ? { errorKind: `mistakes:${lineMistakes}` } : {}) });
    lineMistakes = 0; feedback = `<span class="is-right">${chord.symbol}：${verdict.note.name}（${verdict.note.degree}）✓</span>`;
    if ((line.phase as LineRun['phase']) === 'finished') { if (prefs.method === 'play') void controller.stop(); render(); return; }
    showChord();
  }
  const autoNow = () => performance.now() - t0Perf;
  function startAuto() {
    const p = progression();
    if (!p) { feedback = '進行を選んでください'; render(); return; }
    if (!playableAuto(p, prefs.bpm, prefs.scale)) { const short = shortestChord(p, prefs.bpm, prefs.scale); feedback = `自動進行では、各コードに2拍以上かつ1秒以上が必要です（いま最短 ${short.beats}拍・${(short.ms / 1000).toFixed(2)}秒）。テンポを下げるか、コードの長さを2倍にしてください`; render(); return; }
    if (!positions().length) { feedback = '指板の範囲を選んでください'; render(); return; }
    if (stepOnly.includes(prefs.stage)) { feedback = `${prefs.stage === 'line' ? 'ライン' : 'アプローチ'}はステップ式で練習します`; render(); return; }
    stopAuto(); run = null;
    auto = new AutoProgress(p, prefs.stage as ChangeStage | 'free', { bpm: prefs.bpm, scale: prefs.scale, countInBars: 1, passes: prefs.repeats || null, ninthsFromKey: prefs.ninth });
    const context = sound.ensure(); sound.setVolume(prefs.volume);
    const startAt = context.currentTime + .25; t0Perf = sound.toPerformanceTime(startAt);
    const running = auto;
    scheduler = new ClickScheduler(sound, startAt, (from, to) => running.clickTimes(prefs.click, from, to)); scheduler.start();
    inputClock.reset(); segmenter.reset(); autoRunning = true; feedback = ''; previousTarget = null;
    if (prefs.method === 'play' && controller.phase === 'idle') { repository.updateAudio(repository.current.audio); void controller.start(repository.current.audio); }
    frame = requestAnimationFrame(tickAuto); render();
  }
  function stopAuto() {
    scheduler?.stop(); scheduler = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (autoRunning) { autoRunning = false; sound.suspend(); if (prefs.method === 'play') void controller.stop(); }
  }
  /** Each frame: judge passed windows, end the run when done, and redraw only when the chord, beat or results change. */
  function tickAuto() {
    frame = null;
    if (!auto || !autoRunning) return;
    const now = autoNow();
    for (const outcome of auto.update(now)) recordAuto(outcome);
    if (auto.finished(now)) { stopAuto(); render(); return; }
    const slot = auto.slotAt(now), beat = auto.beatAt(now), key = `${slot?.pass}:${slot?.index}:${beat.beat}:${beat.countIn}:${auto.outcomes.length}:${auto.notes.length}`;
    if (key !== autoKey) { autoKey = key; render(); }
    frame = requestAnimationFrame(tickAuto);
  }
  function recordAuto(outcome: SlotOutcome) {
    if (!auto) return;
    const chord = auto.chords[outcome.slot.index], target = auto.target(outcome.slot.index);
    if (outcome.result === 'hit') previousTarget = { symbol: chord.symbol, label: target!.label, pcs: target!.tones.map(t => t.pitchClass) };
    feedback = outcome.result === 'hit' ? `<span class="is-right">${chord.symbol} ✓</span>` : outcome.result === 'wrong' ? `<span class="is-wrong">${chord.symbol}：狙う音に届きませんでした（別の音）</span>` : outcome.result === 'missed' ? `<span class="is-wrong">${chord.symbol}：音が届きませんでした</span>` : outcome.landing ? `${chord.symbol} の着地：${outcome.landing}` : '';
    // The free stage is never scored; only the landing degree is shown.
    if (!target || outcome.result === null) return;
    const result = outcome.result === 'hit' ? 'correct' as const : outcome.result === 'wrong' ? 'wrong' as const : 'timeout' as const;
    const base = { trainer: 'progression', layer: prefs.method === 'play' ? 'performance' as const : 'fretboard' as const, method: prefs.method, result, responseMs: outcome.firstHitMs === null ? null : Math.round(outcome.firstHitMs), instrument: profile.id };
    training.add({ ...base, itemId: `chg:${chord.quality}:${prefs.stage}` });
    const role = toneRole[prefs.stage];
    if (role && !target.substituted) training.add({ ...base, itemId: `ct:${chord.quality}:${chord.root}:${role}` });
  }
  /** A new chord: response clock restarts; a note held from the previous chord is checked once under the common-tone rule. */
  function showChord() { chordShownAt = performance.now(); changeAt = lastAudioMs; heldChecked = false; render(); }
  function record(result: ChordResult) {
    if (!run) return;
    const chord = run.chords[result.index], outcome = result.status === 'hit' ? 'correct' : result.status === 'late' ? 'wrong' : 'skipped';
    const base = { trainer: 'progression', layer: prefs.method === 'play' ? 'performance' as const : 'fretboard' as const, method: prefs.method, result: outcome as 'correct' | 'wrong' | 'skipped', responseMs: result.responseMs, instrument: profile.id, ...(result.mistakes ? { errorKind: `mistakes:${result.mistakes}` } : {}) };
    training.add({ ...base, itemId: `chg:${chord.quality}:${prefs.stage}` });
    const role = toneRole[prefs.stage];
    if (role && !run.target(result.index).substituted) training.add({ ...base, itemId: `ct:${chord.quality}:${chord.root}:${role}` });
  }
  function answer(pc: number, label: string) {
    if (!run || run.phase !== 'playing') return;
    const target = run.target(), symbol = run.chord.symbol;
    const outcome = run.answer(pc, Math.round(performance.now() - chordShownAt));
    if (outcome === 'miss') feedback = `<span class="is-wrong">${label} は ${symbol} の ${target.label} ではありません</span>`;
    else if (outcome === 'partial') feedback = `${label} ✓ 続けてもう1音`;
    else if (outcome === 'hit') {
      record(run.results.at(-1)!);
      previousTarget = { symbol, label: target.label, pcs: target.tones.map(t => t.pitchClass) };
      feedback = `<span class="is-right">${symbol}：${target.tones.map(t => `${t.name}（${t.degree}）`).join('・')} ✓</span>`;
      if ((run.phase as ProgressionRun['phase']) === 'finished') { if (prefs.method === 'play') void controller.stop(); render(); return; }
      showChord(); return;
    }
    render();
  }
  function answerClick(position: Position) {
    if (prefs.method !== 'click') return;
    if (auto && autoRunning) { const now = autoNow(); auto.startNote(core().midi(position), now); auto.endNote(now + 1); render(); return; }
    if (approach) { answerApproach(core().midi(position), core().name(position, 'both')); return; }
    if (line) { answerLine(core().midi(position), core().name(position, 'both')); return; }
    answer(core().pitch(position), core().name(position, 'both'));
  }
  function skip() {
    if (approach?.phase === 'playing') {
      const a = approach, chord = a.chord; a.skip(); feedback = 'スキップしました';
      training.add({ itemId: `apr:${a.pattern}:${chord.quality}`, trainer: 'progression', layer: prefs.method === 'play' ? 'performance' : 'fretboard', method: prefs.method, result: 'skipped', responseMs: null, instrument: profile.id });
      if ((a.phase as ApproachRun['phase']) === 'finished') { if (prefs.method === 'play') void controller.stop(); render(); return; }
      showChord(); return;
    }
    if (!run || run.phase !== 'playing') return;
    run.skip(); record(run.results.at(-1)!); feedback = 'スキップしました';
    if ((run.phase as ProgressionRun['phase']) === 'finished') { if (prefs.method === 'play') void controller.stop(); render(); return; }
    showChord();
  }
  function move(by: number) { if (!run) return; run.move(by); feedback = ''; segmenter.reset(); showChord(); }
  function togglePause() {
    if (prefs.mode === 'auto') { if (autoRunning) { stopAuto(); render(); } else startAuto(); return; }
    if (line) { if (line.phase === 'finished') start(); return; }
    if (approach) { if (approach.phase === 'finished') start(); else if (approach.phase === 'playing') { approach.pause(); segmenter.reset(); render(); } else { approach.resume(); showChord(); } return; }
    if (!run || run.phase === 'finished') { start(); return; }
    if (run.phase === 'playing') { run.pause(); segmenter.reset(); } else { run.resume(); showChord(); }
    render();
  }

  const consumer: AudioConsumer = {
    consume(o: AudioObservation) {
      if (auto && autoRunning && prefs.method === 'play' && controller.phase === 'running' && controller.started) {
        segmenter.bind(controller.started.sessionId); inputClock.observe(performance.now(), o.audioTimeMs);
        const change = segmenter.push(o), current = segmenter.current(), timeOf = (audioMs: number) => (inputClock.toPerformance(audioMs) ?? performance.now()) - t0Perf;
        heard = current ? pitchClassLabel(current.midi % 12, 'both') : '';
        if (change.ended) auto.endNote(timeOf(change.ended.endMs!));
        if (change.started) { const window = register(), midi = change.started.midi; if (!window || midi >= window[0] && midi <= window[1]) auto.startNote(midi, timeOf(change.started.startMs)); }
        return;
      }
      if (approach && approach.phase === 'playing' && prefs.method === 'play' && controller.phase === 'running' && controller.started) {
        segmenter.bind(controller.started.sessionId);
        const change = segmenter.push(o), current = segmenter.current();
        heard = current ? pitchClassLabel(current.midi % 12, 'both') : '';
        if (change.started) { answerApproach(change.started.midi, pitchClassLabel(change.started.midi % 12, 'both')); return; }
        render(); return;
      }
      if (line && line.phase === 'playing' && prefs.method === 'play' && controller.phase === 'running' && controller.started) {
        segmenter.bind(controller.started.sessionId);
        lastAudioMs = o.audioTimeMs; changeAt ??= o.audioTimeMs;
        const change = segmenter.push(o), current = segmenter.current();
        heard = current ? pitchClassLabel(current.midi % 12, 'both') : '';
        if (change.started) { heldChecked = true; answerLine(change.started.midi, pitchClassLabel(change.started.midi % 12, 'both')); return; }
        // A common tone held across the change is the line's next note without re-picking, if it is allowed there.
        if (!heldChecked && changeAt !== null && heldInto(current, changeAt, o.audioTimeMs, segmenter.options.minHoldMs)) {
          heldChecked = true;
          if (line.allowed().some(n => n.midi === current!.midi)) { answerLine(current!.midi, `${pitchClassLabel(current!.midi % 12, 'both')}（伸ばした音）`); return; }
        }
        render(); return;
      }
      if (!run || run.phase !== 'playing' || prefs.method !== 'play' || controller.phase !== 'running' || !controller.started) return;
      segmenter.bind(controller.started.sessionId);
      lastAudioMs = o.audioTimeMs; changeAt ??= o.audioTimeMs;
      const change = segmenter.push(o), current = segmenter.current(), window = register();
      heard = current ? `${pitchClassLabel(current.midi % 12, 'both')}` : '';
      if (change.started) {
        heldChecked = true;
        const midi = change.started.midi;
        if (window && (midi < window[0] || midi > window[1])) { feedback = `<span class="is-wrong">${pitchClassLabel(midi % 12, 'both')} は練習範囲の音域外です</span>`; render(); return; }
        answer(midi % 12, pitchClassLabel(midi % 12, 'both')); return;
      }
      // Held common tone: only a matching note counts; a held non-target is natural sustain, not a mistake.
      if (!heldChecked && changeAt !== null && heldInto(current, changeAt, o.audioTimeMs, segmenter.options.minHoldMs)) {
        heldChecked = true;
        if (run.target().tones.some(t => t.pitchClass === current!.midi % 12)) { answer(current!.midi % 12, `${pitchClassLabel(current!.midi % 12, 'both')}（伸ばした音）`); return; }
      }
      render();
    },
    sync() {
      if (controller.phase === 'error' && autoRunning) { stopAuto(); feedback = '入力が中断したため停止しました'; }
      if (controller.phase === 'error' && run?.phase === 'playing') { run.pause(); feedback = '入力が中断したため一時停止しました'; }
      render();
    },
    pause() { segmenter.reset(); if (run?.phase === 'playing') run.pause(); approach?.pause(); },
  };
  hub.onChange(() => { if (visible) render(); });

  function marks(): Mark[] {
    const C = core(), shown: Mark[] = [];
    if (approach) {
      if (approach.phase !== 'playing' || prefs.guide !== 'on') return [];
      const notes = approach.notes(), target = approach.target().tones[0];
      for (const position of positions()) {
        const pc = C.pitch(position), index = notes.findIndex(n => ((target.pitchClass + n.offset) % 12 + 12) % 12 === pc);
        if (index >= 0) shown.push({ position, label: `${notes[index].name}<small>${index + 1}</small>`, tone: index === notes.length - 1 ? 'correct' : 'hint', description: `${index + 1}音目 ${notes[index].name}` });
      }
      return shown;
    }
    if (line) {
      if (line.phase === 'finished' || !prefs.lineHint) return [];
      const allowed = line.allowed();
      for (const position of positions()) { const note = allowed.find(n => n.midi === C.midi(position)); if (note) shown.push({ position, label: `${note.name}<small>${note.degree}</small>`, tone: 'hint', description: `${note.name}（${note.degree}）` }); }
      return shown;
    }
    const add = (pcs: number[], tone: Mark['tone'], names: (pc: number) => string) => { for (const position of positions()) { const pc = C.pitch(position); if (pcs.includes(pc)) shown.push({ position, label: names(pc), tone, description: names(pc) }); } };
    if (auto && autoRunning) {
      const slot = auto.slotAt(autoNow()), target = slot ? auto.target(slot.index) : null;
      if (prefs.guide === 'on' && target) add(target.tones.map(t => t.pitchClass), 'hint', pc => { const t = target.tones.find(x => x.pitchClass === pc)!; return `${t.name}<small>${t.degree}</small>`; });
      else if (prefs.guide === 'after' && previousTarget) add(previousTarget.pcs, 'correct', pc => pitchClassLabel(pc, 'both').split(' / ')[0]);
      return shown;
    }
    if (!run || run.phase === 'finished' || prefs.guide === 'off') return [];
    if (prefs.guide === 'on') { const target = run.target(); add(target.tones.map(t => t.pitchClass), 'hint', pc => { const t = target.tones.find(x => x.pitchClass === pc)!; return `${t.name}<small>${t.degree}</small>`; }); }
    else if (previousTarget) add(previousTarget.pcs, 'correct', pc => pitchClassLabel(pc, 'both').split(' / ')[0]);
    return shown;
  }
  function renderChart() {
    const p = auto?.progression ?? run?.progression ?? progression();
    const chart = $('#prog-chart');
    if (!p) { chart.replaceChildren(); return; }
    let flat = 0;
    chart.replaceChildren(...p.bars.map(bar => {
      const element = document.createElement('div'); element.className = 'prog-bar';
      for (const chord of bar) {
        const index = flat++, cell = document.createElement('span'), outcome = auto?.outcomeOf(index) ?? null;
        const latest = approach?.results.filter(r => r.index === index).at(-1);
        const status = approach ? latest ? latest.mistakes === 0 ? 'hit' : latest.mistakes > 0 ? 'late' : 'skipped' : 'pending' : line ? index < line.notes.length ? line.mistakesAt.includes(index) ? 'late' : 'hit' : 'pending' : auto ? outcome?.result === 'hit' ? 'hit' : outcome?.result === 'wrong' ? 'late' : outcome?.result === 'missed' ? 'skipped' : 'pending' : run?.statusOf(index) ?? 'pending';
        const currentIndex = approach ? approach.phase === 'finished' ? -1 : approach.index : line ? line.phase === 'playing' ? line.index : -1 : auto ? autoRunning ? auto.slotAt(autoNow())?.index ?? -1 : -1 : run && run.phase !== 'finished' ? run.index : -1;
        cell.className = `prog-chord${currentIndex === index ? ' is-current' : ''}${status !== 'pending' ? ` is-${status}` : ''}`;
        cell.textContent = chord.symbol;
        if (line && line.notes[index]) { const played = document.createElement('small'); played.className = 'prog-landing'; played.textContent = `${line.notes[index].name}（${line.notes[index].degree}）`; cell.append(played); }
        if (auto && outcome?.landing) { const landing = document.createElement('small'); landing.className = 'prog-landing'; landing.textContent = `着地 ${outcome.landing}`; cell.append(landing); }
        const roman = p.romanNumerals?.[index];
        if (roman) { const small = document.createElement('small'); small.textContent = roman; cell.append(small); }
        cell.setAttribute('aria-label', `${chord.symbol}${status === 'hit' ? ' 正解' : status === 'late' ? ' 誤りのあと正解' : status === 'skipped' ? ' スキップ' : ''}${run && run.index === index ? ' 現在のコード' : ''}`);
        element.append(cell);
      }
      return element;
    }));
  }
  function render() {
    if (!visible) return;
    if (auto) { renderAuto(); return; }
    if (approach) { renderApproach(); return; }
    if (line) { renderLine(); return; }
    const C = core(), p = run?.progression ?? progression(), playing = run?.phase === 'playing', finished = run?.phase === 'finished';
    renderSettings();
    renderChart();
    if (run && !finished) {
      const target = run.target(), next = run.nextChord;
      text('#prog-chord', run.chord.symbol);
      text('#prog-target', `→ ${target.label}${prefs.showAnswer ? `（${target.tones.map(t => t.name).join('・')}）` : ''}`);
      text('#prog-next', next ? `次：${next.symbol}` : '次：終わり');
      text('#prog-progress', `${run.pass}周目${run.repeats ? ` / ${run.repeats}` : ''} · ${run.index + 1} / ${run.chords.length} · 正解 ${run.results.filter(r => r.status === 'hit').length}`);
      text('#prog-status', run.phase === 'paused' ? '一時停止中（Space で再開）' : target.substituted ? `${target.substituted}を弾いてください` : prefs.method === 'play' ? `${target.need === 'all' ? '2つの音をどちらの順でも' : 'その音を'}弾いてください（どのオクターブでも可）` : '指板上の位置を選んでください');
    } else {
      text('#prog-chord', finished ? '終了' : p ? p.name : '進行');
      text('#prog-target', finished ? '' : p ? formatProgression(p.bars) : '');
      text('#prog-next', ''); text('#prog-progress', ''); text('#prog-status', finished ? '' : '開始すると、最初のコードと狙う音を表示します');
    }
    $('#prog-feedback').innerHTML = `<span class="answer-detail">${feedback}</span>`;
    $('#prog-heard').hidden = !(playing && prefs.method === 'play');
    text('#prog-heard', controller.phase === 'running' ? `入力 ${heard || '—'}` : '入力は停止しています');
    $<HTMLButtonElement>('#prog-primary').textContent = !run || finished ? '開始' : run.phase === 'paused' ? '再開' : '一時停止';
    for (const id of ['#prog-back', '#prog-forward', '#prog-skip']) $<HTMLButtonElement>(id).disabled = !playing;
    $<HTMLButtonElement>('#prog-finish').disabled = !run || finished;
    text('#prog-board-caption', prefs.guide === 'on' && run && !finished ? `${run.chord.symbol} の ${run.target().label}` : prefs.guide === 'after' && previousTarget && run && !finished ? `直前の ${previousTarget.symbol} の ${previousTarget.label}` : '');
    board.render(profile, marks(), position => !!playing && prefs.method === 'click' && C.allowed(position, scope()));
    renderResults();
    if (prefs.method === 'play') tuner.audio.render({ startBlocked: false, startLabel: '入力を開始', stopLabel: '停止', lockReference: true });
  }
  function renderLine() {
    const C = core(), l = line!, playing = l.phase === 'playing';
    renderSettings(); renderChart();
    const limits = `${prefs.lineDegrees === 'guide' ? '3rd・7th' : prefs.lineDegrees === 'tensions' ? 'コードトーン＋9th・13th' : 'コードトーン'}、前の音から${prefs.lineMax}半音以内`;
    if (playing) {
      const chord = l.chord as ProgressionChord, next = l.chords[l.index + 1] as ProgressionChord | undefined;
      text('#prog-chord', chord.symbol);
      text('#prog-target', `→ ライン（${limits}）${l.index === 0 && prefs.lineStart !== 'free' ? `・${prefs.lineStart === 'third' ? '3rd' : '7th'}から` : ''}`);
      text('#prog-next', next ? `次：${next.symbol}` : '次：終わり');
      text('#prog-progress', `${l.index + 1} / ${l.chords.length} · この条件で成り立つ経路 ${lineCount >= 200 ? '200本以上' : `${lineCount}本`}`);
      text('#prog-status', l.notes.length ? `ここまで：${formatLine(l.notes)}` : '最初の音を弾いてください（ヒントをオンにすると、次に使える位置を指板に表示します）');
    } else { text('#prog-chord', '終了'); text('#prog-target', ''); text('#prog-next', ''); text('#prog-progress', ''); text('#prog-status', ''); }
    $('#prog-feedback').innerHTML = `<span class="answer-detail">${feedback}</span>`;
    $('#prog-heard').hidden = !(playing && prefs.method === 'play');
    text('#prog-heard', controller.phase === 'running' ? `入力 ${heard || '—'}` : '入力は停止しています');
    $<HTMLButtonElement>('#prog-primary').textContent = playing ? 'ライン練習中' : '開始';
    for (const id of ['#prog-back', '#prog-forward', '#prog-skip']) $<HTMLButtonElement>(id).disabled = true;
    $<HTMLButtonElement>('#prog-finish').disabled = !playing;
    text('#prog-board-caption', playing && prefs.lineHint ? `次に使える音（${limits}）` : '');
    board.render(profile, marks(), position => playing && prefs.method === 'click' && C.allowed(position, scope()));
    renderLineResults();
    if (prefs.method === 'play') tuner.audio.render({ startBlocked: false, startLabel: '入力を開始', stopLabel: '停止', lockReference: true });
  }
  function renderApproach() {
    const C = core(), a = approach!, playing = a.phase === 'playing', finished = a.phase === 'finished';
    renderSettings(); renderChart();
    if (!finished) {
      const target = a.target(), next = a.nextChord, pattern = approachPatterns.find(p => p.id === a.pattern)!.name;
      text('#prog-chord', a.chord.symbol);
      text('#prog-target', `→ ${target.label}（${target.tones[0].name}）へ ${pattern}${prefs.showAnswer ? `：${approachText(a)}` : ''}`);
      text('#prog-next', next ? `次：${next.symbol}` : '次：終わり');
      text('#prog-progress', `${a.pass}周目${a.repeats ? ` / ${a.repeats}` : ''} · ${a.index + 1} / ${a.chords.length} · 到達 ${a.results.filter(r => r.mistakes === 0).length}`);
      text('#prog-status', a.phase === 'paused' ? '一時停止中（Space で再開）' : target.substituted ? `${target.substituted}に向けて弾いてください` : prefs.method === 'play' ? 'パターンの音を順に弾いてください（最初の音はどのオクターブでも可）' : '指板上の位置を順に選んでください');
    } else { text('#prog-chord', '終了'); text('#prog-target', ''); text('#prog-next', ''); text('#prog-progress', ''); text('#prog-status', ''); }
    $('#prog-feedback').innerHTML = `<span class="answer-detail">${feedback}</span>`;
    $('#prog-heard').hidden = !(playing && prefs.method === 'play');
    text('#prog-heard', controller.phase === 'running' ? `入力 ${heard || '—'}` : '入力は停止しています');
    $<HTMLButtonElement>('#prog-primary').textContent = finished ? '開始' : a.phase === 'paused' ? '再開' : '一時停止';
    for (const id of ['#prog-back', '#prog-forward']) $<HTMLButtonElement>(id).disabled = true;
    $<HTMLButtonElement>('#prog-skip').disabled = !playing; $<HTMLButtonElement>('#prog-finish').disabled = finished;
    text('#prog-board-caption', playing && prefs.guide === 'on' ? `パターンの音（数字は順番）` : '');
    board.render(profile, marks(), position => playing && prefs.method === 'click' && C.allowed(position, scope()));
    $('#prog-results').hidden = !finished;
    if (finished) {
      const done = a.results.filter(r => r.mistakes >= 0), clean = done.filter(r => r.mistakes === 0);
      text('#prog-summary', `到達 ${done.length} / ${a.results.length}コード · 間違いなし ${clean.length}${a.results.length - done.length ? ` · スキップ ${a.results.length - done.length}` : ''}`);
      $('#prog-misses').replaceChildren(...a.results.filter(r => r.mistakes > 0).map(r => { const item = document.createElement('li'); item.textContent = `${a.chords[r.index].symbol}：${approachText(a, r.index)}（間違い ${r.mistakes}回）`; return item; }));
    }
    if (prefs.method === 'play') tuner.audio.render({ startBlocked: false, startLabel: '入力を開始', stopLabel: '停止', lockReference: true });
  }
  /** The player's line, its traits, and other lines from the same first note grouped by what they show. None is graded. */
  function renderLineResults() {
    const l = line!, done = l.phase === 'finished' && l.notes.length === l.chords.length;
    $('#prog-results').hidden = l.phase !== 'finished';
    if (l.phase !== 'finished') return;
    if (!done) { text('#prog-summary', `途中で終了しました：${formatLine(l.notes) || '（なし）'}`); $('#prog-misses').replaceChildren(); return; }
    const others = enumerateLines(l.chords, l.notes[0].midi, l.constraint, 200), examples = representativeLines(others);
    text('#prog-summary', `あなたのライン：${formatLine(l.notes)} ／ ${traitText(describeLine(l.notes), l.notes.length)} ／ 誤った音 ${l.mistakes}回 ／ 同じ最初の音から成り立つ経路 ${others.length >= 200 ? '200本以上' : `${others.length}本`}`);
    $('#prog-misses').replaceChildren(...examples.map(e => { const item = document.createElement('li'); item.textContent = `${e.label}：${formatLine(e.line)}（${traitText(describeLine(e.line), e.line.length)}）`; return item; }));
  }
  function renderAuto() {
    const C = core(), a = auto!, now = autoNow(), slot = autoRunning ? a.slotAt(now) : null, beat = a.beatAt(now);
    renderSettings(); renderChart();
    if (autoRunning && beat.countIn) { text('#prog-chord', now < 0 ? '…' : `${beat.beat}`); text('#prog-target', 'カウント'); text('#prog-next', `最初：${a.chords[a.options.fromIndex ?? 0].symbol}`); }
    else if (slot) {
      const chord = a.chords[slot.index], target = a.target(slot.index), next = a.nextSlot(slot);
      text('#prog-chord', chord.symbol);
      text('#prog-target', target ? `→ ${target.label}${prefs.showAnswer ? `（${target.tones.map(t => t.name).join('・')}）` : ''}` : '→ 自由に（着地を表示）');
      text('#prog-next', next ? `次：${a.chords[next.index].symbol}` : '次：終わり');
    } else { text('#prog-chord', autoRunning ? '…' : '終了'); text('#prog-target', ''); text('#prog-next', ''); }
    const scored = a.outcomes.filter(o => o.result !== null);
    text('#prog-progress', autoRunning ? `${prefs.bpm} BPM · ${slot ? `${slot.pass}周目 · ` : ''}拍 ${beat.beat} · 正解 ${scored.filter(o => o.result === 'hit').length}` : '');
    text('#prog-status', autoRunning ? (prefs.stage !== 'free' ? '拍に合わせて、コードが変わったら狙う音を弾いてください（Space で停止）' : '自由に弾いてください。コードが変わった直後の最初の音の度数を表示します（採点しません）') : '');
    $('#prog-feedback').innerHTML = `<span class="answer-detail">${feedback}</span>`;
    $('#prog-heard').hidden = !(autoRunning && prefs.method === 'play');
    text('#prog-heard', controller.phase === 'running' ? `入力 ${heard || '—'}` : '入力は停止しています');
    $<HTMLButtonElement>('#prog-primary').textContent = autoRunning ? '停止' : '開始';
    for (const id of ['#prog-back', '#prog-forward', '#prog-skip']) $<HTMLButtonElement>(id).disabled = true;
    $<HTMLButtonElement>('#prog-finish').disabled = !autoRunning;
    text('#prog-board-caption', prefs.guide === 'on' && slot ? `${a.chords[slot.index].symbol} の ${a.target(slot.index)?.label ?? 'コードトーン'}` : prefs.guide === 'after' && previousTarget && autoRunning ? `直前の ${previousTarget.symbol} の ${previousTarget.label}` : '');
    board.render(profile, marks(), position => autoRunning && prefs.method === 'click' && C.allowed(position, scope()));
    renderAutoResults();
    if (prefs.method === 'play') tuner.audio.render({ startBlocked: false, startLabel: '入力を開始', stopLabel: '停止', lockReference: true });
  }
  function renderAutoResults() {
    const a = auto!, done = !autoRunning && a.outcomes.length > 0;
    $('#prog-results').hidden = !done;
    if (!done) return;
    const landings = a.outcomes.filter(o => o.landing), guide = landings.filter(o => guideDegrees.includes(o.landing!));
    const landingText = landings.length ? `着地 ${landings.length}回のうち 3rd/7th ${guide.length}回（${Math.round(guide.length / landings.length * 100)}%、参考）` : '着地した音はありません';
    if (prefs.stage === 'free') { text('#prog-summary', `自由（採点なし） · ${landingText}`); $('#prog-misses').replaceChildren(); return; }
    const hits = a.outcomes.filter(o => o.result === 'hit'), times = hits.map(o => o.firstHitMs).filter((ms): ms is number => ms !== null);
    text('#prog-summary', `到達 ${hits.length} / ${a.outcomes.length}コード · 別の音 ${a.outcomes.filter(o => o.result === 'wrong').length} · 届かず ${a.outcomes.filter(o => o.result === 'missed').length}${times.length ? ` · コード開始から 平均 ${(times.reduce((x, y) => x + y, 0) / times.length / 1000).toFixed(2)}秒` : ''} · ${landingText}`);
    $('#prog-misses').replaceChildren(...a.outcomes.filter(o => o.result !== 'hit').map(o => { const item = document.createElement('li'), c = a.chords[o.slot.index], t = a.target(o.slot.index)!; item.textContent = `${o.slot.pass}周目 ${c.symbol} の ${t.label}：${t.tones.map(x => x.name).join('・')}（${o.result === 'wrong' ? '別の音' : '届かず'}${o.landing ? `、着地 ${o.landing}` : ''}）`; return item; }));
  }
  function renderResults() {
    const finished = run?.phase === 'finished';
    $('#prog-results').hidden = !finished;
    if (!finished || !run) return;
    const graded = run.results.filter(r => r.status !== 'skipped'), hits = graded.filter(r => r.status === 'hit');
    const times = hits.map(r => r.responseMs).filter((ms): ms is number => ms !== null);
    const weak = new Map<string, number>();
    for (const r of graded.filter(r => r.status === 'late')) { const c = run.chords[r.index], key = c.symbol.slice(c.root.length) || 'メジャー'; weak.set(key, (weak.get(key) ?? 0) + 1); }
    text('#prog-summary', `正解 ${hits.length} / ${graded.length}コード${run.results.length - graded.length ? `（スキップ ${run.results.length - graded.length}）` : ''}${times.length ? ` · 反応 平均 ${(times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1)}秒 · 中央値 ${(median(times) / 1000).toFixed(1)}秒` : ''}${weak.size ? ` · 誤りのあったコード：${[...weak].map(([k, n]) => `${k} ${n}`).join('、')}` : ''}`);
    $('#prog-misses').replaceChildren(...graded.filter(r => r.status === 'late').map(r => { const item = document.createElement('li'); const c = run!.chords[r.index], t = run!.target(r.index); item.textContent = `${c.symbol} の ${t.label}：${t.tones.map(x => x.name).join('・')}（誤り ${r.mistakes}回）`; return item; }));
  }

  // Settings and editor
  const option = (value: string, label: string) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
  function renderSettings() {
    checkLock();
    const open = advancedOpen(training.current), status = advancedStatus(training.current);
    $<HTMLOptionElement>('#prog-stage option[value=approach]').disabled = prefs.mode === 'auto' || !open;
    $<HTMLOptionElement>('#prog-line-degrees option[value=tensions]').disabled = !open;
    $('#prog-locked').hidden = open; text('#prog-locked', open ? '' : `上級（アプローチ・ラインのテンション）は、maj7・m7・7・m7♭5 の 3rd と 7th が80%定着すると開きます（いま ${status.mastered} / ${status.total}）。学習記録の「すべて表示」でいつでも開けます。`);
    $('#prog-approach-settings').hidden = prefs.stage !== 'approach';
    const patternSelect = $<HTMLSelectElement>('#prog-approach-pattern');
    if (!patternSelect.options.length) patternSelect.replaceChildren(...approachPatterns.map(p => option(p.id, p.name)));
    patternSelect.value = prefs.approachPattern; $<HTMLSelectElement>('#prog-approach-role').value = prefs.approachRole;
    $<HTMLOptionElement>('#prog-stage option[value=line]').disabled = prefs.mode === 'auto';
    $('#prog-line-settings').hidden = prefs.stage !== 'line';
    $<HTMLSelectElement>('#prog-line-start').value = prefs.lineStart; $<HTMLSelectElement>('#prog-line-degrees').value = prefs.lineDegrees;
    $<HTMLSelectElement>('#prog-line-max').value = String(prefs.lineMax); $<HTMLInputElement>('#prog-line-hint').checked = prefs.lineHint;
    const select = $<HTMLSelectElement>('#prog-select');
    const ids = [...library.map(e => e.id), ...stored.map(s => s.id)].join(',');
    if (select.dataset.ids !== ids) {
      select.dataset.ids = ids;
      const builtin = document.createElement('optgroup'); builtin.label = 'ライブラリ'; builtin.append(...library.map(e => option(e.id, e.name)));
      const mine = document.createElement('optgroup'); mine.label = '自分の進行'; mine.append(...stored.map(s => option(s.id, s.name)));
      select.replaceChildren(builtin, ...(stored.length ? [mine] : []));
    }
    if (!entry() && !userEntry()) prefs = { ...prefs, progressionId: library[0].id };
    select.value = prefs.progressionId;
    const builtin = entry(), key = $<HTMLSelectElement>('#prog-key');
    $('#prog-key-row').hidden = !builtin;
    if (builtin) {
      const list = builtin.mode === 'major' ? majorTonics : minorTonics, wanted = list.join(',') + builtin.mode;
      if (key.dataset.list !== wanted) { key.dataset.list = wanted; key.replaceChildren(...list.map(t => option(t, builtin.mode === 'major' ? `${t} メジャー` : `${t} マイナー`))); }
      key.value = builtin.mode === 'major' ? prefs.majorTonic : prefs.minorTonic;
    }
    $<HTMLSelectElement>('#prog-stage').value = prefs.stage; $<HTMLInputElement>('#prog-ninth').checked = prefs.ninth;
    $<HTMLOptionElement>('#prog-stage option[value=free]').disabled = prefs.mode !== 'auto';
    $<HTMLSelectElement>('#prog-mode').value = prefs.mode; $('#prog-auto-settings').hidden = prefs.mode !== 'auto';
    $<HTMLInputElement>('#prog-bpm').value = String(prefs.bpm); $<HTMLSelectElement>('#prog-scale').value = String(prefs.scale);
    $<HTMLSelectElement>('#prog-click').value = prefs.click; $<HTMLInputElement>('#prog-volume').value = String(prefs.volume);
    $('#prog-keys').textContent = prefs.mode === 'auto' ? 'Space 開始・停止' : 'Space 開始・一時停止 ／ ← → コードを戻る・進む ／ S スキップ';
    $('#prog-ninth-row').hidden = prefs.stage !== 'with-tensions';
    $<HTMLSelectElement>('#prog-repeats').value = String(prefs.repeats);
    $$<HTMLInputElement>('input[name=prog-method]').forEach(el => el.checked = el.value === prefs.method);
    $<HTMLInputElement>('#prog-show-answer').checked = prefs.showAnswer; $<HTMLSelectElement>('#prog-guide').value = prefs.guide;
    range.render(profile.strings.length, profile.instrument === 'bass', { ...scope(), naturalOnly: false });
    const editKey = $<HTMLSelectElement>('#prog-edit-key');
    if (!editKey.options.length) editKey.replaceChildren(option('', 'なし'), ...majorTonics.map(t => option(`major:${t}`, `${t} メジャー`)), ...minorTonics.map(t => option(`minor:${t}`, `${t} マイナー`)));
  }
  function loadEditor() {
    const user = userEntry(), p = progression();
    editingId = user?.id ?? null;
    $<HTMLInputElement>('#prog-name').value = user?.name ?? (p ? `${p.name}（コピー）` : '');
    $<HTMLTextAreaElement>('#prog-text').value = user?.text ?? (p ? formatProgression(p.bars) : '');
    const key = user?.key ?? p?.key ?? null;
    $<HTMLSelectElement>('#prog-edit-key').value = key ? `${key.mode}:${key.tonic}` : '';
    $<HTMLButtonElement>('#prog-delete').disabled = !user; $<HTMLButtonElement>('#prog-save').textContent = user ? '上書き保存' : '自分の進行として保存';
    $('#prog-confirm').hidden = true; preview();
  }
  function preview() {
    const parsed = parseProgression($<HTMLTextAreaElement>('#prog-text').value);
    text('#prog-preview', 'error' in parsed ? `⚠ ${parsed.error}` : `${parsed.length}小節：${parsed.map(bar => bar.map(c => c.symbol).join(' ')).join(' | ')}`);
    return parsed;
  }
  function persist(list: StoredProgression[]) { stored = list; training.updateProgressions(list); }
  function saveEditor(asCopy: boolean) {
    const parsed = preview(), name = $<HTMLInputElement>('#prog-name').value.trim(), keyValue = $<HTMLSelectElement>('#prog-edit-key').value;
    if ('error' in parsed) { text('#prog-edit-status', '保存できません：コードを確認してください'); return; }
    if (!name) { text('#prog-edit-status', '名前を入力してください'); return; }
    if (!editingId || asCopy) { if (stored.length >= 100) { text('#prog-edit-status', '保存できる進行は100件までです'); return; } }
    const [mode, tonic] = keyValue.split(':'), key: KeyInfo | null = keyValue ? { tonic, mode: mode as KeyInfo['mode'] } : null;
    const id = !editingId || asCopy ? `user:${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}` : editingId;
    const entryValue: StoredProgression = { id, name: asCopy ? `${name}（コピー）`.slice(0, 40) : name, text: formatProgression(parsed), key };
    persist(stored.some(s => s.id === id) ? stored.map(s => s.id === id ? entryValue : s) : [...stored, entryValue]);
    prefs = { ...prefs, progressionId: id }; save(); stop(); loadEditor();
    text('#prog-edit-status', asCopy ? '複製しました' : '保存しました');
  }
  $('#prog-text').addEventListener('input', () => preview());
  $('#prog-save').addEventListener('click', () => saveEditor(false));
  $('#prog-duplicate').addEventListener('click', () => saveEditor(true));
  $('#prog-delete').addEventListener('click', () => { if (editingId) $('#prog-confirm').hidden = false; });
  $('#prog-confirm-no').addEventListener('click', () => { $('#prog-confirm').hidden = true; });
  $('#prog-confirm-yes').addEventListener('click', () => {
    if (!editingId) return;
    persist(stored.filter(s => s.id !== editingId)); prefs = { ...prefs, progressionId: library[0].id }; save(); stop(); loadEditor();
    text('#prog-edit-status', '削除しました');
  });
  const change = (patch: Partial<ProgressionPreferences>) => { prefs = { ...prefs, ...patch }; save(); stop(); attachAudio(); };
  $('#prog-select').addEventListener('change', e => { change({ progressionId: (e.target as HTMLSelectElement).value }); loadEditor(); });
  $('#prog-key').addEventListener('change', e => { const v = (e.target as HTMLSelectElement).value; change(entry()?.mode === 'minor' ? { minorTonic: v } : { majorTonic: v }); loadEditor(); });
  $('#prog-stage').addEventListener('change', e => change({ stage: (e.target as HTMLSelectElement).value as Stage }));
  $('#prog-line-start').addEventListener('change', e => change({ lineStart: (e.target as HTMLSelectElement).value as LineStart }));
  $('#prog-line-degrees').addEventListener('change', e => change({ lineDegrees: (e.target as HTMLSelectElement).value as LineConstraint['allowedDegrees'] }));
  $('#prog-line-max').addEventListener('change', e => change({ lineMax: Number((e.target as HTMLSelectElement).value) === 4 ? 4 : 2 }));
  $('#prog-approach-pattern').addEventListener('change', e => change({ approachPattern: (e.target as HTMLSelectElement).value as ApproachPattern }));
  $('#prog-approach-role').addEventListener('change', e => change({ approachRole: (e.target as HTMLSelectElement).value as ApproachRole }));
  $('#prog-line-hint').addEventListener('change', e => { prefs = { ...prefs, lineHint: (e.target as HTMLInputElement).checked }; save(); render(); });
  $('#prog-mode').addEventListener('change', e => { const mode = (e.target as HTMLSelectElement).value as 'step' | 'auto'; change({ mode, ...(mode === 'step' && prefs.stage === 'free' || mode === 'auto' && stepOnly.includes(prefs.stage) ? { stage: 'third' as const } : {}) }); });
  $('#prog-bpm').addEventListener('change', e => { const bpm = Math.round(Number((e.target as HTMLInputElement).value)); change({ bpm: Number.isFinite(bpm) ? Math.min(160, Math.max(40, bpm)) : prefs.bpm }); });
  $('#prog-scale').addEventListener('change', e => change({ scale: Number((e.target as HTMLSelectElement).value) === 2 ? 2 : 1 }));
  $('#prog-click').addEventListener('change', e => { prefs = { ...prefs, click: (e.target as HTMLSelectElement).value as ClickMode }; save(); });
  $('#prog-volume').addEventListener('input', e => { prefs = { ...prefs, volume: Number((e.target as HTMLInputElement).value) }; sound.setVolume(prefs.volume); save(); });
  $('#prog-test-click').addEventListener('click', () => { const context = sound.ensure(); sound.setVolume(prefs.volume); [0, .5, 1, 1.5].forEach((t, i) => sound.click(context.currentTime + .05 + t, i === 0)); });
  $('#prog-ninth').addEventListener('change', e => change({ ninth: (e.target as HTMLInputElement).checked }));
  $('#prog-repeats').addEventListener('change', e => change({ repeats: Number((e.target as HTMLSelectElement).value) }));
  $('#prog-show-answer').addEventListener('change', e => { prefs = { ...prefs, showAnswer: (e.target as HTMLInputElement).checked }; save(); render(); });
  $('#prog-guide').addEventListener('change', e => { prefs = { ...prefs, guide: (e.target as HTMLSelectElement).value as Guide }; save(); render(); });
  $$<HTMLInputElement>('input[name=prog-method]').forEach(el => el.addEventListener('change', () => { if (prefs.method === 'play' && el.value !== 'play') void controller.stop(); change({ method: el.value as Method }); }));
  $('#prog-primary').addEventListener('click', togglePause);
  $('#prog-back').addEventListener('click', () => move(-1));
  $('#prog-forward').addEventListener('click', () => move(1));
  $('#prog-skip').addEventListener('click', skip);
  $('#prog-finish').addEventListener('click', () => { if (autoRunning) { stopAuto(); render(); return; } if (approach) { approach.finish(); if (prefs.method === 'play') void controller.stop(); render(); return; } if (line) { line.finish(); if (prefs.method === 'play') void controller.stop(); render(); return; } run?.finish(); if (prefs.method === 'play') void controller.stop(); render(); });
  document.addEventListener('keydown', event => {
    if (!visible || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('.harmony-settings,.feature-tabs,.instrument-bar') || target.matches('input,select,textarea,[contenteditable=true]')) return;
    if (event.code === 'Space') { event.preventDefault(); togglePause(); }
    else if (event.key === 'ArrowLeft' && run?.phase === 'playing') { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowRight' && run?.phase === 'playing') { event.preventDefault(); move(1); }
    else if ((event.key === 's' || event.key === 'S') && (run?.phase === 'playing' || approach?.phase === 'playing')) { event.preventDefault(); skip(); }
  });

  /** The single audio panel moves here while the trainer is shown with the play method. */
  function attachAudio() {
    if (!visible) return;
    const playing = prefs.method === 'play';
    if (playing) { tuner.audio.attach($('#prog-audio')); tuner.setAudioOwner(owner); hub.setActiveConsumer(consumer); if (!tuner.audio.loaded) void tuner.audio.refreshDevices(); }
    else { tuner.setAudioOwner(null); hub.setActiveConsumer(null); }
    $('#prog-audio').hidden = !playing;
  }
  const owner = {
    onStart(settings: Parameters<typeof controller.start>[0]) { repository.updateAudio(settings); void controller.start(settings); if (prefs.mode === 'auto') { if (!autoRunning) startAuto(); return; } if (line?.phase === 'playing') return; if (approach) { if (approach.phase === 'paused') { approach.resume(); showChord(); } else if (approach.phase === 'finished') start(); return; } if (!run || run.phase === 'finished') start(); else if (run.phase === 'paused') { run.resume(); showChord(); } },
    onStop() { run?.pause(); approach?.pause(); void controller.stop(); },
    onChange() { render(); },
  };
  return {
    setInstrument(next: InstrumentProfile) { profile = next; stop(); },
    show(show: boolean) {
      if (visible && !show) { stopAuto(); run?.pause(); approach?.pause(); tuner.setAudioOwner(null); hub.setActiveConsumer(null); void controller.stop(); }
      visible = show;
      if (show) { stored = decodeStored(training.current.progressions); renderSettings(); loadEditor(); }
      attachAudio(); render();
    },
  };
}
