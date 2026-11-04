import { $, $$ } from '../../ui/dom';
import { create, type Position } from '../../domain/instruments/core';
import { resolveInstrument, type InstrumentProfile } from '../../domain/instruments/profiles';
import { pitchOf } from '../../domain/music/theory';
import { allQuestions, describeOver, makeQuestion, questionClash, roleLabels, toneChoices, ToneDrill, type DrillOutcome, type DrillQuestion, type QualityStage, type RootSet, type ToneMode, type ToneQuestion } from '../../domain/training/tone-questions';
import { boardIntervalQuestions, intervalQuestions, type BoardCondition, type DirectionSet, type IntervalStage } from '../../domain/training/interval-questions';
import { arpeggioQuestions, type ArpeggioChords, type ArpeggioDirection } from '../../domain/training/arpeggio';
import { keyQuestions, type KeyModes, type KeyQuestionType } from '../../domain/training/key-questions';
import { advancedOpen, advancedOptions, advancedStatus, avoidPolicy, chordScaleQuestions, tensionQuestions } from '../../domain/training/advanced';
import { pitchClassLabel } from '../../domain/training/note-answers';
import { statKey, type AttemptMethod, type SkillLayer } from '../../domain/training/records';
import { targetFor, targetsOf, weightedDeck, type Focus } from '../../domain/training/analysis';
import type { DegreeRole } from '../../domain/music/harmony';
import { NoteSegmenter, defaultSegmenterOptions } from '../../domain/practice/note-events';
import type { AudioObservation } from '../../platform/audio';
import type { SettingsRepository } from '../../platform/settings';
import type { TrainingRepository } from '../../platform/training-store';
import type { AudioConsumer, AudioHub } from '../audio/hub';
import type { mountTuner } from '../tuner/view';
import { mountRange } from '../settings/range';
import { NoteAnswerInput } from '../answers/note-answer';
import { MarkedFretboard, type Mark } from '../../ui/marked-fretboard';

type Method = 'choice' | 'name' | 'click' | 'play';
type Kind = 'chord' | 'interval' | 'arpeggio' | 'key' | 'tension' | 'chord-scale';
interface HarmonyPreferences {
  kind: Kind; methods: Record<Kind, Method>;
  mode: ToneMode; stage: QualityStage; roots: RootSet; sharpSix: boolean; strict: boolean; limitMs: number; length: number | 'timed';
  strings: number[] | null; frets: number[] | null;
  ivStage: IntervalStage; ivDirection: DirectionSet; ivBoard: 'off' | BoardCondition;
  arpChords: ArpeggioChords; arpInversions: 'root' | 'all'; arpDirection: ArpeggioDirection; arpError: 'restart' | 'wait';
  keyTypes: KeyQuestionType | 'all'; keyModes: KeyModes;
  /** Due, weak and new items first (on by default); off restores the plain shuffled round. */
  weighted: boolean;
}
const defaults = (): HarmonyPreferences => ({
  kind: 'chord', methods: { chord: 'choice', interval: 'choice', arpeggio: 'click', key: 'choice', tension: 'choice', 'chord-scale': 'choice' },
  mode: 'guide', stage: 1, roots: 'standard', sharpSix: true, strict: false, limitMs: 0, length: 10, strings: null, frets: null,
  ivStage: 1, ivDirection: 'up', ivBoard: 'off', arpChords: 'triads', arpInversions: 'root', arpDirection: 'up', arpError: 'restart', keyTypes: 'all', keyModes: 'major', weighted: true,
});
const kinds: Kind[] = ['chord', 'interval', 'arpeggio', 'key', 'tension', 'chord-scale'];
/** Advanced (L7) kinds: offered once the guide tones are mastered, or always with "show everything". */
const advancedKinds: Kind[] = ['tension', 'chord-scale'];
const kindTitles: Record<Kind, [string, string, string]> = {
  chord: ['CHORD TONES', 'コードトーン', '開始すると、コード名と問う音を表示します'],
  interval: ['INTERVALS', 'インターバル', '開始すると、ルートとインターバルを表示します'],
  arpeggio: ['ARPEGGIOS', 'アルペジオ', '開始すると、コード・転回形・弦セットを表示します'],
  key: ['KEYS & FUNCTIONS', '調と機能', '開始すると、調とディグリーなどを表示します'],
  tension: ['TENSIONS · 上級', 'テンション', '開始すると、コード名と問うテンションを表示します'],
  'chord-scale': ['CHORD SCALES · 上級', 'コード・スケール', '開始すると、コードとその働きを表示します'],
};
const layerOf: Record<Method, SkillLayer> = { choice: 'knowledge', name: 'knowledge', click: 'fretboard', play: 'performance' };
const errorLabels: Record<string, string> = { 'quality-confusion': 'コードの種類の取り違え（長短など）', 'degree-confusion': '別の構成音', spelling: '綴り違い', other: 'その他', 'out-of-range': '音域外', 'wrong-position': '同じ音名の別の位置', octave: 'オクターブ違い' };
/** Interval mistakes read differently from chord ones: a quality slip is major/minor or augmented/diminished, a degree slip is the root. */
const errorLabel = (kind: string, interval = false) => interval && kind === 'quality-confusion' ? '長短・増減の取り違え' : interval && kind === 'degree-confusion' ? 'ルートを答えた' : errorLabels[kind] ?? kind;
const median = (values: number[]) => { const s = values.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
const timedMs = 60000, feedbackMs = 600;

/** Normalises stored preferences so an old or edited store cannot break the trainer. */
function decodePreferences(input: unknown): HarmonyPreferences {
  const value = (input && typeof input === 'object' ? input : {}) as Partial<HarmonyPreferences> & { method?: unknown }, base = defaults();
  const pick = <T,>(candidate: unknown, allowed: readonly T[], fallback: T) => allowed.includes(candidate as T) ? candidate as T : fallback;
  const numbers = (list: unknown) => Array.isArray(list) && list.every(n => Number.isInteger(n)) ? list as number[] : null;
  const stored = (value.methods && typeof value.methods === 'object' ? value.methods : {}) as Partial<Record<Kind, unknown>>;
  // 0.6.0 kept a single method for the chord-tone trainer.
  const methods = Object.fromEntries(kinds.map(kind => [kind, pick(stored[kind] ?? (kind === 'chord' ? value.method : undefined), allowedMethods(kind), base.methods[kind])])) as Record<Kind, Method>;
  return {
    kind: pick(value.kind, kinds, base.kind), methods,
    mode: pick(value.mode, ['third', 'seventh', 'guide', 'all', 'ninth'] as const, base.mode), stage: pick(value.stage, ['triads', 1, 2, 3] as const, base.stage),
    roots: pick(value.roots, ['standard', 'extended'] as const, base.roots), sharpSix: value.sharpSix !== false, strict: value.strict === true,
    limitMs: pick(value.limitMs, [0, 5000, 3000, 2000] as const, 0), length: pick(value.length, [10, 20, 'timed'] as const, 10),
    strings: numbers(value.strings), frets: numbers(value.frets),
    ivStage: pick(value.ivStage, [1, 2, 3, 4] as const, 1), ivDirection: pick(value.ivDirection, ['up', 'down', 'both'] as const, 'up'),
    ivBoard: pick(value.ivBoard, ['off', 'same', 'adjacent', 'window'] as const, 'off'),
    arpChords: pick(value.arpChords, ['triads', 'sevenths', 'both'] as const, 'triads'), arpInversions: pick(value.arpInversions, ['root', 'all'] as const, 'root'),
    arpDirection: pick(value.arpDirection, ['up', 'down', 'updown'] as const, 'up'), arpError: pick(value.arpError, ['restart', 'wait'] as const, 'restart'),
    keyTypes: pick(value.keyTypes, ['all', 'degree', 'function', 'secondary'] as const, 'all'), keyModes: pick(value.keyModes, ['major', 'minor', 'both'] as const, 'major'),
    weighted: value.weighted !== false,
  };
}
/** Answer methods that make sense per kind: arpeggios are sequences on the board, key questions are names of chords. */
function allowedMethods(kind: Kind, board: 'off' | BoardCondition = 'off'): Method[] {
  if (kind === 'arpeggio' || kind === 'interval' && board !== 'off') return ['click', 'play'];
  if (kind === 'key' || kind === 'chord-scale') return ['choice'];
  return ['choice', 'name', 'click', 'play'];
}

/** Harmony trainer: chord tones, intervals, arpeggios and keys share one drill, answer area, board and record. */
export function mountHarmony(repository: SettingsRepository, hub: AudioHub, tuner: ReturnType<typeof mountTuner>, training: TrainingRepository) {
  const controller = hub.controller;
  let profile = resolveInstrument(repository.current.lastInstrument, repository.current.instruments[repository.current.lastInstrument]);
  let prefs = decodePreferences(training.preference('harmony'));
  let drill: ToneDrill | null = null, visible = false, shownAt = 0, endsAt: number | null = null, choices: string[] = [];
  let limitTimer: ReturnType<typeof setTimeout> | null = null, advanceTimer: ReturnType<typeof setTimeout> | null = null;
  let clicked: { position: Position; right: boolean }[] = [], heard = '', observed = 0, clipping = 0, message = '', slip = '';
  /** Practice limited to chosen items (from the records tab). Nothing is saved while it lasts; ending it restores the settings. */
  let focus: { itemIds: Set<string>; label: string; saved: HarmonyPreferences; count: number } | null = null;
  const segmenter = new NoteSegmenter(defaultSegmenterOptions(repository.current.audio.referenceHz));
  const input = new NoteAnswerInput($('#harmony-input'), name => answerName(name));
  const board = new MarkedFretboard($('#harmony-board'), position => answerClick(position));
  const range = mountRange($('#harmony-range'), next => { prefs = { ...prefs, strings: next.strings, frets: next.frets }; save(); restart(); });

  const method = () => prefs.methods[prefs.kind];
  const core = () => create(profile);
  const scope = () => core().normalize({ strings: prefs.strings ?? undefined, frets: prefs.frets ?? undefined });
  const positions = () => core().candidates(scope());
  const register = (): [number, number] | null => { const midis = positions().map(p => core().midi(p)); return midis.length ? [Math.min(...midis), Math.max(...midis)] : null; };
  /** Every question an item id of the kind can name, whatever the current settings, for focused practice. */
  function focusPool(ids: Set<string>): DrillQuestion[] {
    const sharps = [true, false];
    if (prefs.kind === 'chord') return [...ids].flatMap(id => { const [, quality, root, role] = id.split(':'); try { return [makeQuestion({ root, quality }, role === 'guide' ? ['third', 'seventh'] : [role as DegreeRole])]; } catch { return []; } });
    if (prefs.kind === 'interval') {
      // Board items may name several conditions (same string, adjacent, window); each is built with its own.
      const conditions = [...new Set([...ids].filter(id => id.startsWith('ivf:')).map(id => id.split(':')[4] as BoardCondition))];
      return prefs.ivBoard === 'off' ? intervalQuestions({ stage: 4, direction: 'both', roots: 'extended', sharpSix: true }) : conditions.flatMap(condition => boardIntervalQuestions(core(), scope(), { stage: 4, direction: 'both' }, condition, profile.id));
    }
    if (prefs.kind === 'arpeggio') return (['up', 'down', 'updown'] as const).flatMap(direction => sharps.flatMap(sharpSix => arpeggioQuestions(core(), { chords: 'both', inversions: 'all', direction, sharpSix })));
    if (prefs.kind === 'tension') return tensionQuestions('extended', true);
    if (prefs.kind === 'chord-scale') return chordScaleQuestions('extended', true, advancedOptions(training.current));
    return sharps.flatMap(sharpSix => keyQuestions({ types: 'all', modes: 'both', sharpSix }));
  }
  function questions(): DrillQuestion[] {
    if (focus) { const ids = focus.itemIds, seen = new Set<string>(); return focusPool(ids).filter(q => ids.has(q.itemId) && !seen.has(q.itemId) && !!seen.add(q.itemId)); }
    if (prefs.kind === 'chord') return allQuestions(prefs);
    if (prefs.kind === 'interval') {
      const config = { stage: prefs.ivStage, direction: prefs.ivDirection, roots: prefs.roots, sharpSix: prefs.sharpSix };
      return prefs.ivBoard === 'off' ? intervalQuestions(config) : boardIntervalQuestions(core(), scope(), config, prefs.ivBoard, profile.id);
    }
    if (prefs.kind === 'arpeggio') return arpeggioQuestions(core(), { chords: prefs.arpChords, inversions: prefs.arpInversions, direction: prefs.arpDirection, sharpSix: prefs.sharpSix });
    if (prefs.kind === 'tension') return tensionQuestions(prefs.roots, prefs.sharpSix);
    if (prefs.kind === 'chord-scale') return chordScaleQuestions(prefs.roots, prefs.sharpSix, advancedOptions(training.current));
    return keyQuestions({ types: prefs.keyTypes, modes: prefs.keyModes, sharpSix: prefs.sharpSix });
  }
  /** A stored advanced kind falls back to chord tones while it is locked (for example after the records were cleared). */
  function checkLock() { if (advancedKinds.includes(prefs.kind) && !advancedOpen(training.current)) { prefs = { ...prefs, kind: 'chord' }; drill = null; } }
  function save() { if (!focus) training.updatePreferences('harmony', prefs); }
  function endFocus() { if (!focus) return; prefs = focus.saved; focus = null; }
  /** Each round is ordered from the records at the time it starts, looked up in the layer of the current answer method. */
  const order = (list: DrillQuestion[], last: DrillQuestion | null) => weightedDeck(list, new Date(), Math.random, {
    stat: q => training.current.stats[statKey(layerOf[method()], q.itemId)], targetMs: targetFor(targetsOf(training.current.preferences), method() as AttemptMethod), last, clash: questionClash,
  });
  const text = (selector: string, value: string) => { const element = $(selector); if (element.textContent !== value) element.textContent = value; };
  function clearTimers() { if (limitTimer) clearTimeout(limitTimer); if (advanceTimer) clearTimeout(advanceTimer); limitTimer = advanceTimer = null; }
  const usesBoard = () => method() === 'click' || method() === 'play' || prefs.kind === 'arpeggio' || prefs.kind === 'interval' && prefs.ivBoard !== 'off';

  function start() {
    clearTimers(); message = '';
    const list = questions();
    if (focus) focus.count = list.length;
    if (!list.length) { drill = null; message = prefs.kind === 'chord' ? 'この組み合わせで出題できるコードがありません（例：トライアドに 7th はありません）。' : 'この条件で出題できる問題がありません。範囲や条件を広げてください。'; render(); return; }
    if (usesBoard() && prefs.kind !== 'arpeggio' && !positions().length) { drill = null; message = '指板の範囲を選んでください。'; render(); return; }
    drill = new ToneDrill(list, prefs.length === 'timed' ? null : prefs.length, Math.random, prefs.weighted || focus ? order : undefined);
    endsAt = prefs.length === 'timed' ? performance.now() + timedMs : null;
    if (method() === 'play' && controller.phase === 'idle') { repository.updateAudio(repository.current.audio); void controller.start(repository.current.audio); }
    ask();
  }
  function restart() { if (drill) { drill = null; clearTimers(); } render(); }
  /** A new question restarts the clock and drops pitch evidence; a held note is judged again after the hold time. */
  function ask() {
    if (!drill) return;
    shownAt = performance.now(); clicked = []; heard = ''; observed = 0; clipping = 0; slip = ''; segmenter.reset();
    choices = method() === 'choice' ? toneChoices(drill.question, 0, Math.random, prefs.strict) : [];
    if (method() === 'name') input.showEntry();
    if (prefs.limitMs) limitTimer = setTimeout(() => { limitTimer = null; settle(drill?.timeout() ?? null); }, prefs.limitMs);
    render();
  }
  function settle(outcome: DrillOutcome | null | 'partial' | 'repeat' | 'restart') {
    if (outcome === 'partial' || outcome === 'restart') {
      if (outcome === 'partial' && method() === 'choice') choices = toneChoices(drill!.question, drill!.step, Math.random, prefs.strict);
      if (outcome === 'partial' && method() === 'name') input.showEntry();
      render(); return;
    }
    if (!outcome || outcome === 'repeat') return;
    if (limitTimer) { clearTimeout(limitTimer); limitTimer = null; }
    const { question, result, errorKind, responseMs } = outcome;
    training.add({ itemId: question.itemId, layer: layerOf[method()], trainer: 'harmony', method: method() as AttemptMethod, result, ...(errorKind ? { errorKind } : {}), responseMs, instrument: profile.id });
    if (result === 'correct' || result === 'spelling') advanceTimer = setTimeout(() => { advanceTimer = null; next(); }, feedbackMs);
    render();
  }
  function next() {
    if (!drill || drill.phase !== 'answered') return;
    clearTimers();
    if (endsAt !== null && performance.now() >= endsAt) drill.finish(); else drill.next();
    if ((drill.phase as ToneDrill['phase']) === 'finished') { if (method() === 'play') void controller.stop(); render(); return; }
    ask();
  }
  const elapsed = () => Math.round(performance.now() - shownAt);
  function answerName(name: string) { if (drill?.phase === 'asking' && (method() === 'choice' || method() === 'name')) settle(drill.answerName(name, prefs.strict, elapsed())); }
  /** Ordered sequences check each step; fretboard interval questions need the exact place; others accept the pitch class anywhere in range. */
  function judge(pc: number, label: string, at: { position?: Position; midi?: number }) {
    if (!drill || drill.phase !== 'asking') return null;
    const q = drill.question, step = drill.step;
    if (q.ordered) {
      const ok = at.position ? q.positions![step].string === at.position.string && q.positions![step].fret === at.position.fret : at.midi === q.midis![step];
      if (!ok) slip = `${step + 1}音目：${q.answers[step].name}（${q.answers[step].degree}）を期待、${label} でした`;
      else slip = '';
      return drill.answerOrdered(ok, q.answers[step].name, elapsed(), prefs.arpError);
    }
    if (q.positions) {
      const hit = at.position ? q.positions.some(p => p.string === at.position!.string && p.fret === at.position!.fret) : at.midi === core().midi(q.positions[0]);
      if (!hit && pc === q.answers[0].pitchClass) return drill.reject(label, at.position ? 'wrong-position' : 'octave', elapsed());
    }
    return drill.answerPitchClass(pc, label, elapsed());
  }
  function answerClick(position: Position) {
    if (drill?.phase !== 'asking' || method() !== 'click') return;
    const pc = core().pitch(position), label = core().name(position, 'both');
    const outcome = judge(pc, label, { position });
    if (outcome === 'restart' && prefs.arpError === 'restart') clicked = [];
    if (outcome !== 'repeat') clicked.push({ position, right: outcome === 'partial' || outcome !== null && outcome !== 'restart' && outcome.result === 'correct' });
    settle(outcome);
  }
  /** Mostly clipped input points at the input level, not at the player, so it is not held against the item. */
  function skip(kind: 'skipped' | 'self-marked') {
    if (drill?.phase !== 'asking') return;
    const result = kind === 'skipped' && method() === 'play' && observed > 5 && clipping / observed > .5 ? 'detection-issue' : kind;
    settle(drill.skip(result, elapsed()));
  }
  const consumer: AudioConsumer = {
    consume(o: AudioObservation) {
      if (!drill || drill.phase !== 'asking' || method() !== 'play' || controller.phase !== 'running' || !controller.started) return;
      segmenter.bind(controller.started.sessionId);
      observed++; if (o.state === 'clipping') clipping++;
      const change = segmenter.push(o), note = segmenter.current(), q = drill.question;
      heard = note ? `${pitchClassLabel(note.midi % 12, 'both')}（${describeOver(q.root, q.related, note.midi % 12)}）` : '';
      if (!change.started) { render(); return; }
      const midi = change.started.midi, pc = midi % 12, label = pitchClassLabel(pc, 'both'), window = register();
      if (!q.ordered && !q.positions && window && (midi < window[0] || midi > window[1])) settle(drill.reject(label, 'out-of-range', elapsed()));
      else settle(judge(pc, label, { midi }));
    },
    sync() { if (controller.phase === 'error' && drill?.phase === 'asking' && method() === 'play') settle(drill.skip('detection-issue', null)); render(); },
    pause() { segmenter.reset(); },
  };
  hub.onChange(() => { if (visible) render(); });

  /** While asking: the shown root, the player's own clicks and finished steps. After the answer: where the answer lies. */
  function marks(): Mark[] {
    if (!drill || drill.phase === 'finished' || prefs.kind === 'key' || prefs.kind === 'chord-scale') return [];
    const C = core(), q = drill.question, rootPc = pitchOf(q.root), answered = drill.phase === 'answered';
    const own: Mark[] = clicked.map(c => c.right
      ? { position: c.position, label: '✓', tone: 'correct' as const, description: '正解の位置' }
      : { position: c.position, label: C.name(c.position, 'both').split(' / ')[0], tone: 'wrong' as const, description: '選んだ位置（不正解）' });
    const root: Mark[] = q.rootPosition ? [{ position: q.rootPosition, label: `${q.root}<small>R</small>`, tone: 'root', description: `ルート ${q.root}` }] : [];
    if (!answered) return [...root, ...own];
    const shown = [...root, ...own.filter(m => m.tone === 'wrong')], taken = new Set(shown.map(m => C.key(m.position)));
    const add = (position: Position, label: string, tone: Mark['tone'], description: string) => { if (!taken.has(C.key(position))) { taken.add(C.key(position)); shown.push({ position, label, tone, description }); } };
    if (q.ordered) q.positions!.forEach((position, i) => add(position, `${q.answers[i].degree}<small>${i + 1}</small>`, q.answers[i].degree === 'R' ? 'root' : 'correct', `${i + 1}音目 ${q.answers[i].name}（${q.answers[i].degree}）`));
    else if (q.positions) q.positions.forEach(position => add(position, `${q.answers[0].name}<small>${q.answers[0].degree}</small>`, 'correct', `${q.answers[0].name}（${q.answers[0].degree}）`));
    else for (const position of positions()) {
      const pc = C.pitch(position), answer = q.answers.find(a => a.pitchClass === pc);
      if (answer) add(position, `${answer.name}<small>${answer.degree}</small>`, 'correct', `${answer.name}（${answer.degree}）`);
      else if (pc === rootPc) add(position, 'R', 'root', `ルート ${q.root}`);
    }
    return shown;
  }
  /** Name of the next expected answer while a multi-answer question is in progress. */
  const stepName = (q: DrillQuestion, step: number) => 'roles' in q ? roleLabels[(q as ToneQuestion).roles[step]] : `${step + 1}つ目`;
  function progressLine() {
    if (!drill || drill.phase !== 'asking') return '';
    const q = drill.question;
    if (q.ordered) return `${q.answers.map((_, i) => i < drill!.step ? '●' : '○').join(' ')}${drill.given.length ? `　${drill.given.join(' → ')}` : ''}${slip ? `<br><span class="is-wrong">${slip}${prefs.arpError === 'restart' ? '。最初から' : '。その音から'}</span>` : ''}`;
    if (drill.step > 0) return `${drill.given.join('・')} ✓ 続けて ${stepName(q, drill.step)}`;
    if (drill.found.size) return `${drill.given.join('・')} ✓ 残り ${q.answers.length - drill.found.size}音`;
    return '';
  }
  function statusLine() {
    const q = drill?.question, m = method();
    if (!q) return '';
    if (prefs.kind === 'key' || prefs.kind === 'chord-scale') return '選択肢から選んでください';
    if (q.ordered) return m === 'click' ? '指定の弦で、指定の順に位置を選んでください' : '指定の順に1音ずつ弾いてください（同じ高さで判定。弦は判定しません）';
    if (q.positions) return m === 'click' ? '条件に合う位置を選んでください' : 'その高さで弾いてください（オクターブも判定します）';
    return { choice: '選択肢から選んでください', name: '音名を入力してください', click: '指板上の位置を選んでください（どの位置でも可）', play: q.answers.length > 1 ? '2つの音を、どちらの順番でも弾いてください' : 'その音を弾いてください（どのオクターブでも可）' }[m];
  }
  function render() {
    if (!visible) return;
    const C = core(), finished = drill?.phase === 'finished', asking = drill?.phase === 'asking', answered = drill?.phase === 'answered', m = method();
    const [kicker, title, idle] = kindTitles[prefs.kind];
    checkLock();
    const open = advancedOpen(training.current), status = advancedStatus(training.current);
    $$<HTMLButtonElement>('#harmony-panel .harmony-kinds .mode').forEach(button => { const on = button.dataset.kind === prefs.kind, locked = advancedKinds.includes(button.dataset.kind as Kind) && !open; button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on)); button.disabled = locked; button.title = locked ? '上級：ガイドトーンの定着後に開放（学習記録の「すべて表示」でいつでも開けます）' : ''; });
    $('#harmony-focus').hidden = !focus; text('#harmony-focus-text', focus ? `苦手を練習中：${focus.label}（${focus.count}問）。設定は保存しません` : '');
    $<HTMLInputElement>('#harmony-weighted').checked = prefs.weighted;
    $('#harmony-locked').hidden = open; text('#harmony-locked', open ? '' : `上級（テンション・コード・スケール）は、maj7・m7・7・m7♭5 の 3rd と 7th が80%定着すると開きます（いま ${status.mastered} / ${status.total}）。学習記録の「すべて表示」でいつでも開けます。`);
    text('#harmony-avoid-policy', avoidPolicy);
    text('#harmony-kicker', kicker); text('#harmony-settings-title', title);
    $$<HTMLElement>('.harmony-settings [data-for]').forEach(el => { el.hidden = !el.dataset.for!.split(' ').includes(prefs.kind); });
    const allowed = allowedMethods(prefs.kind, prefs.ivBoard);
    $$<HTMLInputElement>('input[name=harmony-method]').forEach(el => { el.checked = el.value === m; el.disabled = !allowed.includes(el.value as Method); el.closest('label')!.hidden = el.disabled; });
    $<HTMLSelectElement>('#harmony-mode').value = prefs.mode; $<HTMLSelectElement>('#harmony-stage').value = String(prefs.stage);
    $<HTMLSelectElement>('#harmony-roots').value = prefs.roots; $<HTMLSelectElement>('#harmony-six').value = prefs.sharpSix ? 'sharp' : 'flat';
    $<HTMLInputElement>('#harmony-strict').checked = prefs.strict; $<HTMLSelectElement>('#harmony-limit').value = String(prefs.limitMs);
    $<HTMLSelectElement>('#harmony-length').value = String(prefs.length);
    $<HTMLSelectElement>('#interval-stage').value = String(prefs.ivStage); $<HTMLSelectElement>('#interval-direction').value = prefs.ivDirection; $<HTMLSelectElement>('#interval-board').value = prefs.ivBoard;
    $<HTMLSelectElement>('#arp-chords').value = prefs.arpChords; $<HTMLSelectElement>('#arp-inversions').value = prefs.arpInversions;
    $<HTMLSelectElement>('#arp-direction').value = prefs.arpDirection; $<HTMLSelectElement>('#arp-error').value = prefs.arpError;
    $<HTMLSelectElement>('#key-types').value = prefs.keyTypes; $<HTMLSelectElement>('#key-modes').value = prefs.keyModes;
    range.render(profile.strings.length, profile.instrument === 'bass', { ...scope(), naturalOnly: false });
    const window = register();
    text('#harmony-scope', `${profile.displayName} · ${profile.tuning.name}${m === 'play' && window && prefs.kind !== 'arpeggio' && !(prefs.kind === 'interval' && prefs.ivBoard !== 'off') ? ` · 音域 ${midiText(window[0])}〜${midiText(window[1])}（弦は判定しません）` : ''}`);
    if (!drill || finished) { text('#harmony-chord', finished ? '終了' : title); text('#harmony-role', finished ? '' : idle); }
    else { text('#harmony-chord', drill.question.title); text('#harmony-role', drill.question.ask); }
    text('#harmony-progress', drill && !finished ? `${drill.round}周目 · ${drill.outcomes.length + (asking ? 1 : 0)}${prefs.length === 'timed' ? '' : ` / ${prefs.length}`}問 · 正解 ${drill.outcomes.filter(o => o.result === 'correct' || o.result === 'spelling').length}${endsAt ? ` · 残り ${Math.max(0, Math.ceil((endsAt - performance.now()) / 1000))}秒` : ''}` : '');
    if (asking && m === 'choice') input.showChoices(choices.map(name => ({ value: name, label: name })));
    else if (!(asking && m === 'name')) input.hide();
    $('#harmony-heard').hidden = !(asking && m === 'play');
    text('#harmony-heard', controller.phase === 'running' ? `入力 ${heard || '—'}` : '入力は停止しています');
    $('#harmony-feedback').innerHTML = answered && drill ? feedback(drill.last!) : `<span class="answer-detail">${progressLine()}</span>`;
    text('#harmony-status', message || (m === 'play' && controller.phase === 'error' ? controller.error : asking ? statusLine() : answered ? (drill!.last!.result === 'correct' || drill!.last!.result === 'spelling' ? '' : 'Space で次の問題へ') : ''));
    $<HTMLButtonElement>('#harmony-primary').textContent = !drill || finished ? '開始' : answered ? '次の問題 →' : '開始し直す';
    $<HTMLButtonElement>('#harmony-skip').disabled = !asking; $<HTMLButtonElement>('#harmony-self').disabled = !asking;
    $<HTMLButtonElement>('#harmony-self').hidden = m !== 'play'; $<HTMLButtonElement>('#harmony-finish').disabled = !drill || finished;
    text('#harmony-keys', { choice: 'キー 1〜4 で回答', name: 'A〜G で音名、↑↓ で ♯・♭、Enter で回答', click: '指板をクリックして回答', play: '弾いて回答' }[m] + ' ／ Space 開始・次へ ／ S スキップ');
    $('#harmony-board').closest<HTMLElement>('.board-shell')!.hidden = prefs.kind === 'key' || prefs.kind === 'chord-scale';
    board.render(profile, marks(), position => !!asking && m === 'click' && (prefs.kind === 'arpeggio' || C.allowed(position, scope())));
    renderResults();
    if (m === 'play') tuner.audio.render({ startBlocked: false, startLabel: '入力を開始', stopLabel: '停止', lockReference: true });
  }
  const midiText = (midi: number) => `${pitchClassLabel(midi % 12, 'sharp')}${Math.floor(midi / 12) - 1}`;
  const describeQuestion = (q: DrillQuestion) => `${q.title}・${q.ask.replace(/ ?\?$/, '')}`;
  const answerText = (q: DrillQuestion) => q.labels ? q.answers.map(a => a.name).join('・') : q.answers.map(a => `${a.name}（${a.degree}）`).join(q.ordered ? ' → ' : '・');
  function feedback(outcome: DrillOutcome) {
    const q = outcome.question;
    const given = outcome.given.length ? ` ／ あなたの回答：${outcome.given.join(q.ordered ? ' → ' : '・')}` : '';
    const heading = { correct: '正解！', spelling: '正解（綴りに注意）', wrong: '不正解', timeout: '時間切れ', skipped: 'スキップ', 'self-marked': '正解として記録', 'detection-issue': '入力の問題として記録（判定から除外）' }[outcome.result];
    const kind = outcome.errorKind?.startsWith('restarts:') ? ` ／ 途中で ${outcome.errorKind.split(':')[1]}回 間違えました` : outcome.errorKind && outcome.result !== 'spelling' ? ` ／ ${errorLabel(outcome.errorKind, prefs.kind === 'interval')}` : '';
    const right = outcome.result === 'correct' || outcome.result === 'spelling' || outcome.result === 'self-marked';
    const hint = q.hint ? `<br>${q.hint}` : '';
    return `<span class="answer-main ${right ? 'is-right' : 'is-wrong'}">${heading}</span><span class="answer-detail">${describeQuestion(q)}：${answerText(q)}${given}${kind}${hint}</span>`;
  }
  function renderResults() {
    const finished = drill?.phase === 'finished';
    $('#harmony-results').hidden = !finished;
    if (!finished || !drill) return;
    const graded = drill.outcomes.filter(o => ['correct', 'spelling', 'wrong', 'timeout'].includes(o.result)), right = graded.filter(o => o.result === 'correct' || o.result === 'spelling');
    const times = right.map(o => o.responseMs).filter((ms): ms is number => ms !== null);
    const kindsSeen = new Map<string, number>(); for (const o of drill.outcomes) if (o.errorKind && o.result !== 'spelling') { const key = o.errorKind.startsWith('restarts:') ? 'restarts' : o.errorKind; kindsSeen.set(key, (kindsSeen.get(key) ?? 0) + 1); }
    const skipped = drill.outcomes.length - graded.length;
    text('#harmony-summary', `正解 ${right.length} / ${graded.length}問${skipped ? `（スキップ等 ${skipped}問は除く）` : ''}${times.length ? ` · 反応 平均 ${(times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1)}秒 · 中央値 ${(median(times) / 1000).toFixed(1)}秒` : ''}${kindsSeen.size ? ` · ${[...kindsSeen].map(([k, n]) => `${k === 'restarts' ? '途中の間違い' : errorLabel(k, prefs.kind === 'interval')} ${n}`).join('、')}` : ''}`);
    $('#harmony-misses').replaceChildren(...graded.filter(o => !right.includes(o)).map(o => { const item = document.createElement('li'); item.textContent = `${describeQuestion(o.question)}：${answerText(o.question)}`; return item; }));
  }

  // Settings
  const change = (patch: Partial<HarmonyPreferences>) => {
    // Changing a setting ends focused practice; the change applies to the saved settings.
    endFocus();
    prefs = { ...prefs, ...patch };
    const allowed = allowedMethods(prefs.kind, prefs.ivBoard);
    if (!allowed.includes(method())) prefs = { ...prefs, methods: { ...prefs.methods, [prefs.kind]: allowed[0] } };
    save(); restart(); attachAudio();
  };
  const select = (id: string, apply: (value: string) => Partial<HarmonyPreferences>) => $(id).addEventListener('change', e => change(apply((e.target as HTMLSelectElement).value)));
  select('#harmony-mode', v => ({ mode: v as ToneMode }));
  select('#harmony-stage', v => ({ stage: (v === 'triads' ? v : Number(v)) as QualityStage }));
  select('#harmony-roots', v => ({ roots: v as RootSet }));
  select('#harmony-six', v => ({ sharpSix: v === 'sharp' }));
  select('#harmony-limit', v => ({ limitMs: Number(v) }));
  select('#harmony-length', v => ({ length: v === 'timed' ? 'timed' : Number(v) }));
  select('#interval-stage', v => ({ ivStage: Number(v) as IntervalStage }));
  select('#interval-direction', v => ({ ivDirection: v as DirectionSet }));
  select('#interval-board', v => ({ ivBoard: v as HarmonyPreferences['ivBoard'] }));
  select('#arp-chords', v => ({ arpChords: v as ArpeggioChords }));
  select('#arp-inversions', v => ({ arpInversions: v as 'root' | 'all' }));
  select('#arp-direction', v => ({ arpDirection: v as ArpeggioDirection }));
  select('#arp-error', v => ({ arpError: v as 'restart' | 'wait' }));
  select('#key-types', v => ({ keyTypes: v as HarmonyPreferences['keyTypes'] }));
  select('#key-modes', v => ({ keyModes: v as KeyModes }));
  $('#harmony-strict').addEventListener('change', e => change({ strict: (e.target as HTMLInputElement).checked }));
  $('#harmony-weighted').addEventListener('change', e => change({ weighted: (e.target as HTMLInputElement).checked }));
  $('#harmony-focus-end').addEventListener('click', () => { if (method() === 'play') void controller.stop(); endFocus(); restart(); attachAudio(); });
  $$<HTMLInputElement>('input[name=harmony-method]').forEach(el => el.addEventListener('change', () => { if (method() === 'play' && el.value !== 'play') void controller.stop(); change({ methods: { ...prefs.methods, [prefs.kind]: el.value as Method } }); }));
  // Only this panel's kind buttons: the progression and ear tabs reuse the same nav class for their sections.
  $$<HTMLButtonElement>('#harmony-panel .harmony-kinds .mode[data-kind]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.kind === prefs.kind || button.disabled) return;
    if (method() === 'play') void controller.stop();
    change({ kind: button.dataset.kind as Kind });
  }));
  $('#harmony-primary').addEventListener('click', () => { if (drill?.phase === 'answered') next(); else start(); });
  $('#harmony-skip').addEventListener('click', () => skip('skipped'));
  $('#harmony-self').addEventListener('click', () => skip('self-marked'));
  $('#harmony-finish').addEventListener('click', () => { clearTimers(); drill?.finish(); if (method() === 'play') void controller.stop(); render(); });
  document.addEventListener('keydown', event => {
    if (!visible || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('.harmony-settings,.feature-tabs,.instrument-bar,.harmony-kinds') || target.matches('input,select,textarea,[contenteditable=true]')) return;
    if (event.code === 'Space') { event.preventDefault(); if (drill?.phase === 'answered') next(); else if (!drill || drill.phase === 'finished') start(); return; }
    if (drill?.phase !== 'asking') return;
    if ((event.key === 's' || event.key === 'S') && method() !== 'name') { event.preventDefault(); skip('skipped'); return; }
    if (input.key(event.key)) event.preventDefault();
  });

  /** The single audio panel moves here while the trainer is shown with the play method. */
  function attachAudio() {
    if (!visible) return;
    const playing = method() === 'play';
    if (playing) { tuner.audio.attach($('#harmony-audio')); tuner.setAudioOwner(owner); hub.setActiveConsumer(consumer); if (!tuner.audio.loaded) void tuner.audio.refreshDevices(); }
    else { tuner.setAudioOwner(null); hub.setActiveConsumer(null); }
    $('#harmony-audio').hidden = !playing;
  }
  const owner = {
    onStart(settings: Parameters<typeof controller.start>[0]) { repository.updateAudio(settings); void controller.start(settings); if (!drill || drill.phase === 'finished') start(); },
    onStop() { void controller.stop(); },
    onChange() { render(); },
  };
  return {
    setInstrument(next: InstrumentProfile) { profile = next; restart(); },
    /** Switches to a question kind, as its button would (a locked advanced kind is left alone). */
    showKind(kind: string) {
      if (!kinds.includes(kind as Kind) || kind === prefs.kind && !focus || advancedKinds.includes(kind as Kind) && !advancedOpen(training.current)) return;
      if (method() === 'play') void controller.stop();
      change({ kind: kind as Kind });
    },
    /** Practise only the given items (shown first). The answer method follows the items' layer so the same records improve. */
    focus(target: Focus) {
      if (!target.kind || !kinds.includes(target.kind as Kind) || !target.itemIds?.length) return;
      const kind = target.kind as Kind, saved = focus?.saved ?? prefs, ids = target.itemIds;
      const ivBoard = kind === 'interval' ? ids[0].startsWith('ivf:') ? ids[0].split(':')[4] as BoardCondition : 'off' : saved.ivBoard;
      const wanted: Method = target.layer === 'fretboard' ? 'click' : target.layer === 'performance' ? 'play' : saved.methods[kind] === 'name' ? 'name' : 'choice';
      const allowed = allowedMethods(kind, ivBoard);
      if (method() === 'play') void controller.stop();
      prefs = { ...saved, kind, ivBoard, methods: { ...saved.methods, [kind]: allowed.includes(wanted) ? wanted : allowed[0] } };
      focus = { itemIds: new Set(ids), label: target.label, saved, count: 0 };
      attachAudio(); start();
    },
    show(show: boolean) {
      if (visible && !show) { endFocus(); clearTimers(); if (drill?.phase === 'asking' || drill?.phase === 'answered') drill = null; tuner.setAudioOwner(null); hub.setActiveConsumer(null); void controller.stop(); }
      visible = show; if (show) checkLock(); attachAudio(); render();
    },
  };
}
