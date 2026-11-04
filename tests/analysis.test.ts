import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../src/domain/instruments/core';
import { resolveInstrument } from '../src/domain/instruments/profiles';
import { emptyTrainingData, record, statKey, type Attempt, type AttemptResult, type ItemStat, type SkillLayer, type TrainingData } from '../src/domain/training/records';
import {
  inputHealth, levelContext, levelProgress, priorityOf, reachedDates, streakDays, targetFor, targetsOf, todayMenu, weakness, weightedDeck, allLevels,
} from '../src/domain/training/analysis';
import { advancedStatus } from '../src/domain/training/advanced';
import { allQuestions, toneDeck, ToneDrill, questionClash } from '../src/domain/training/tone-questions';
import { PracticeSession } from '../src/domain/practice/session';

const now = new Date(2026, 9, 27, 12);
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const stat = (itemId: string, patch: Partial<ItemStat> = {}, layer: SkillLayer = 'knowledge'): ItemStat => ({
  itemId, layer, attempts: 6, correct: 6, wrong: 0, detectionIssues: 0, recentMs: [1000], box: 2, dueAt: '2026-10-30', lastAt: now.toISOString(), firstAt: now.toISOString(), ...patch,
});
const withStats = (list: ItemStat[]): TrainingData => ({ ...emptyTrainingData(), stats: Object.fromEntries(list.map(s => [statKey(s.layer, s.itemId), s])) });
const mastered = (itemId: string, layer: SkillLayer = 'knowledge') => stat(itemId, { box: 4 }, layer);
const guitar = levelContext(create(resolveInstrument('guitar')), 'guitar');
const attempt = (itemId: string, result: AttemptResult, patch: Partial<Attempt> = {}): Attempt => ({ itemId, layer: 'knowledge', trainer: 'harmony', method: 'choice', result, responseMs: 1200, instrument: 'guitar', at: now.toISOString(), ...patch });

test('weakness: cells per quality × role, graded answers only, insufficient under five and layers kept apart', () => {
  let data = emptyTrainingData();
  for (let i = 0; i < 4; i++) data = record(data, attempt('ct:dom7:G:third', i ? 'correct' : 'wrong'), now);
  for (let i = 0; i < 5; i++) data = record(data, attempt('ct:dom7:C:third', 'correct', { responseMs: 1000 + i * 100 }), now);
  for (let i = 0; i < 6; i++) data = record(data, attempt('ct:dom7:C:third', 'detection-issue', { method: 'play', layer: 'performance' }), now);
  data = record(data, attempt('ct:min7:D:seventh', 'skipped'), now);
  data = record(data, attempt('ct:dom7:G:third', 'correct', { method: 'click', layer: 'fretboard' }), now);
  const grid = weakness(data.stats, { table: 'ct', layer: 'knowledge' });
  assert.deepEqual(grid.rows, ['min7', 'dom7']);
  const cell = grid.cells.find(c => c.row === 'dom7' && c.column === 'third')!;
  // 4 + 5 graded answers in the knowledge layer; the fretboard answer and detection issues are elsewhere.
  assert.equal(cell.attempts, 9); assert.equal(cell.accuracy, 8 / 9); assert.equal(cell.insufficient, false);
  assert.deepEqual(cell.itemIds.sort(), ['ct:dom7:C:third', 'ct:dom7:G:third']);
  const skipped = grid.cells.find(c => c.row === 'min7')!;
  assert.equal(skipped.attempts, 0); assert.equal(skipped.accuracy, null); assert.equal(skipped.insufficient, true);
  const performance = weakness(data.stats, { table: 'ct', layer: 'performance' });
  assert.equal(performance.cells[0].attempts, 0, 'detection issues are not graded');
  const board = weakness(data.stats, { table: 'ct', layer: 'fretboard' });
  assert.equal(board.cells.length, 1); assert.equal(board.cells[0].attempts, 1); assert.equal(board.cells[0].insufficient, true);
});

test('weakness: interval, fretboard band, ear and rhythm tables', () => {
  const stats = withStats([
    stat('iv:C:M3:up'), stat('iv:D:M3:down'), stat('ivf:guitar:P5:up:same', {}, 'fretboard'),
    stat('fb:guitar:6:1', {}, 'fretboard'), stat('fb:guitar:6:13', {}, 'fretboard'), stat('fb:bass4:4:3', {}, 'fretboard'),
    stat('ear:melody:3:diatonic', {}, 'performance'), stat('ear:melody:3:chromatic', {}, 'performance'),
    stat('rhy:offbeats:80-99', { recentMs: [] }, 'performance'), stat('rhyplay:offbeats:80-99', {}, 'performance'),
  ]).stats;
  const iv = weakness(stats, { table: 'iv' });
  assert.deepEqual([iv.rows, iv.columns], [['M3'], ['up', 'down']]);
  assert.deepEqual(weakness(stats, { table: 'ivf', instrument: 'guitar' }).rows, ['P5']);
  const fb = weakness(stats, { table: 'fb', instrument: 'guitar' });
  assert.deepEqual([fb.rows, fb.columns], [['6'], ['0–2F', '12–14F']]);
  const ear = weakness(stats, { table: 'ear' });
  assert.deepEqual([ear.rows, ear.columns], [['3'], ['melody', 'melody:chromatic']]);
  const rhy = weakness(stats, { table: 'rhy' });
  assert.deepEqual([rhy.rows, rhy.columns], [['offbeats', 'offbeats:play'], ['80-99']]);
});

test('weakness: at most twelve rows, the weakest kept', () => {
  const qualities = ['major', 'minor', 'dim', 'aug', 'maj7', 'min7', 'dom7', 'half-dim', 'dim7', 'minmaj7', 'six', 'min6', 'nine', 'maj9'];
  const grid = weakness(withStats(qualities.map((q, i) => stat(`ct:${q}:C:third`, { correct: i, wrong: 13 - i }))).stats, { table: 'ct' });
  assert.equal(grid.rows.length, 12); assert.equal(grid.hiddenRows, 2);
  assert.ok(!grid.rows.includes('nine') && !grid.rows.includes('maj9'), 'the two best rows are left out');
});

test('levelProgress: 79% is not reached and 80% is, fixed denominators', () => {
  // L3 has 5 intervals × 12 pitches = 60 slots: 48 reach it.
  const roots = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'], ids = ['m3', 'M3', 'P5', 'm7', 'M7'].flatMap(id => roots.map(r => `iv:${r}:${id}:up`));
  const l3 = (n: number) => levelProgress(withStats(ids.slice(0, n).map(id => mastered(id))), 'L3', guitar);
  assert.equal(l3(47).total, 60); assert.equal(l3(47).reached, false); assert.equal(l3(48).reached, true);
  // G♭ and F♯ fill the same slot; a downward answer does not count for the upward level.
  assert.equal(levelProgress(withStats([mastered('iv:G♭:M3:up'), mastered('iv:F♯:M3:up'), mastered('iv:C:M3:down')]), 'L3', guitar).mastered, 1);
  // L1: natural notes on six strings, frets 0–12; any layer counts.
  const naturals = guitar.positions.filter(p => p.natural), l1 = levelProgress(withStats(naturals.slice(0, Math.ceil(naturals.length * .8)).map((p, i) => mastered(`fb:guitar:${p.string}:${p.fret}`, i % 2 ? 'fretboard' : 'knowledge'))), 'L1', guitar);
  assert.equal(l1.total, naturals.length); assert.equal(l1.reached, true);
  assert.equal(levelProgress(withStats([mastered('fb:bass4:1:0')]), 'L1', guitar).mastered, 0, 'another instrument does not count');
  // L4 is the advanced unlock count itself.
  const guide = withStats(['maj7', 'min7', 'dom7', 'half-dim'].flatMap(q => roots.map(r => mastered(`ct:${q}:${r}:guide`))));
  assert.deepEqual(levelProgress(guide, 'L4', guitar).mastered, advancedStatus(guide).mastered);
  assert.equal(levelProgress(withStats([stat('ct:maj7:C:third', { box: 3 })]), 'L4', guitar).mastered, 0);
  const all = allLevels(emptyTrainingData(), guitar);
  assert.deepEqual(all.map(l => l.id), ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
  assert.ok(all.every(l => l.total > 0 && !l.reached));
  assert.equal(all[4].total, 12 * (4 * 3 + 4 * 4)); assert.equal(all[5].total, 16);
});

test('reachedDates: written once, fretboard levels per instrument', () => {
  const progress = allLevels(emptyTrainingData(), guitar).map(p => p.id === 'L1' || p.id === 'L3' ? { ...p, reached: true } : p);
  const first = reachedDates({}, progress, guitar, now)!;
  assert.deepEqual(first, { 'L1:guitar': '2026-10-27', L3: '2026-10-27' });
  assert.equal(reachedDates(first, progress, guitar, new Date(2026, 10, 1)), null, 'an earlier date is kept');
});

test('weightedDeck: due first, then weak, new, learning, mastered; a full round without repeats', () => {
  const items = ['new-1', 'new-2', 'due', 'weak', 'learning', 'mastered'];
  const stats: Record<string, ItemStat> = {
    due: stat('due', { box: 2, dueAt: '2026-10-27' }), weak: stat('weak', { correct: 1, wrong: 3, box: 1, dueAt: '2026-10-28' }),
    learning: stat('learning'), mastered: stat('mastered', { box: 5, dueAt: '2026-11-10' }),
  };
  for (let seed = 1; seed < 30; seed++) {
    const deck = weightedDeck(items, now, seeded(seed), { stat: id => stats[id], targetMs: 2500 });
    assert.deepEqual(deck.slice().sort(), items.slice().sort(), 'every item once');
    assert.deepEqual([deck[0], deck[1]], ['due', 'weak']);
    assert.deepEqual(deck.slice(4), ['learning', 'mastered']);
  }
  assert.equal(priorityOf(stat('slow', { recentMs: [4000, 4200] }), now, 2500), 'weak');
  assert.equal(priorityOf(stat('mastered-due', { box: 4, dueAt: '2026-10-20' }), now, 2500), 'due');
});

test('weightedDeck: no item or clash back to back, also across rounds', () => {
  const questions = allQuestions({ mode: 'guide', stage: 1, roots: 'standard', sharpSix: true });
  for (let seed = 1; seed < 20; seed++) {
    const random = seeded(seed), first = weightedDeck(questions, now, random, { stat: () => undefined, targetMs: 2500, clash: questionClash });
    const second = weightedDeck(questions, now, random, { stat: () => undefined, targetMs: 2500, clash: questionClash, last: first.at(-1)! });
    const both = [...first, ...second];
    assert.ok(both.every((q, i) => i === 0 || q !== both[i - 1]), 'never the same question twice in a row');
    assert.equal(both.filter((q, i) => i > 0 && questionClash(both[i - 1], q)).length, 0, 'no clash remains, as with the plain shuffle');
  }
  // A single item still yields a round.
  assert.deepEqual(weightedDeck(['only'], now, Math.random, { stat: () => undefined, targetMs: 1, last: 'only' }), ['only']);
});

test('weighting off: the drill and the study session behave exactly as before', () => {
  const questions = allQuestions({ mode: 'guide', stage: 2, roots: 'standard', sharpSix: true });
  const before = toneDeck(questions, seeded(7)), drill = new ToneDrill(questions, null, seeded(7));
  assert.deepEqual(drill.deck.map(q => q.itemId), before.map(q => q.itemId));
  const core = create(resolveInstrument('guitar')), settings = core.normalize({ mode: 'reverse' });
  const plain = new PracticeSession(core, settings, seeded(3)), old = core.shuffled(core.candidates(settings), null, seeded(3));
  assert.deepEqual(plain.state.deck, old);
  // With an order the session uses it each round.
  const ordered = new PracticeSession(core, settings, seeded(3), positions => positions.slice().sort((a, b) => b.fret - a.fret));
  assert.equal(ordered.state.deck[0].fret, Math.max(...settings.frets));
});

test('todayMenu: empty data, only due items, and every kind', () => {
  const empty = todayMenu(emptyTrainingData(), now, guitar);
  assert.deepEqual(empty.map(s => s.kind), ['new']);
  assert.equal(empty[0].focus.feature, 'study');
  const dueOnly = todayMenu(withStats([stat('iv:C:M3:up', { dueAt: '2026-10-26' }), stat('iv:D:M3:up', { dueAt: '2026-10-27' })]), now, guitar);
  assert.deepEqual(dueOnly.map(s => s.kind), ['review', 'new']);
  assert.deepEqual([dueOnly[0].focus.feature, dueOnly[0].focus.kind, dueOnly[0].focus.layer, dueOnly[0].focus.itemIds!.length], ['harmony', 'interval', 'knowledge', 2]);
  assert.deepEqual(dueOnly.map(s => s.minutes), [5, 3]);
  const all = todayMenu(withStats([
    stat('fb:guitar:6:5', { dueAt: '2026-10-20' }, 'fretboard'), stat('ct:dom7:G:third', { correct: 1, wrong: 4, box: 1, dueAt: '2026-10-28' }),
  ]), now, guitar);
  assert.deepEqual(all.map(s => [s.kind, s.minutes, s.focus.feature]), [['review', 5, 'study'], ['weak', 5, 'harmony'], ['new', 3, 'study'], ['progression', 5, 'progression']]);
  // New items are concrete and never answered: the tried position is left out.
  const fresh = all.find(s => s.kind === 'new')!.focus;
  assert.equal(fresh.layer, 'knowledge'); assert.equal(fresh.itemIds!.length, 30);
  assert.ok(fresh.itemIds!.every(id => id.startsWith('fb:guitar:') && id !== 'fb:guitar:6:5'));
  assert.deepEqual(empty[0].focus.itemIds!.slice(0, 2), ['fb:guitar:1:0', 'fb:guitar:1:1']);
});

test('todayMenu: other instruments are left out and board intervals are grouped by condition', () => {
  const due = { dueAt: '2026-10-20' };
  const menu = todayMenu(withStats([
    stat('fb:bass4:4:3', due, 'fretboard'), stat('fb:bass4:4:5', due, 'fretboard'), stat('fb:bass4:3:5', due, 'fretboard'),
    stat('ivf:guitar:M3:up:same', due, 'fretboard'), stat('ivf:guitar:P5:up:same', due, 'fretboard'), stat('ivf:guitar:M3:up:window', due, 'fretboard'),
    stat('iv:C:M3:up', due, 'fretboard'),
  ]), now, guitar);
  assert.equal(menu[0].kind, 'review');
  assert.deepEqual(menu[0].focus.itemIds, ['ivf:guitar:M3:up:same', 'ivf:guitar:P5:up:same']);
  // When every item of the next level was tried, there is nothing new to offer.
  const roots = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const triedAll = withStats([...guitar.positions.filter(p => p.natural).map(p => stat(`fb:guitar:${p.string}:${p.fret}`, { box: 1, dueAt: '2026-11-30' })), ...roots.map(r => stat(`iv:${r}:M3:up`))]);
  assert.ok(!todayMenu(triedAll, now, guitar).some(s => s.kind === 'new'));
});

test('targets: per method from preferences, used for future reviews only', () => {
  const targets = targetsOf({ targets: { choice: 4000, play: 123 } });
  assert.deepEqual(targets, { choice: 4000, name: 3000, click: 3000, play: 4000 });
  assert.equal(targetFor(targets, 'sing'), 4000); assert.equal(targetFor(targets, 'choice'), 4000);
  let data = record(emptyTrainingData(), attempt('iv:C:M3:up', 'correct', { responseMs: 3500 }), now, 2500);
  assert.equal(data.stats[statKey('knowledge', 'iv:C:M3:up')].box, 0, 'slow under the old goal');
  data = record(data, attempt('iv:C:M3:up', 'correct', { responseMs: 3500 }), now, targetFor(targets, 'choice'));
  assert.equal(data.stats[statKey('knowledge', 'iv:C:M3:up')].box, 1, 'the new goal applies from now on; the past box is not recomputed');
});

test('streak and input health', () => {
  const daily = ['2026-10-24', '2026-10-25', '2026-10-26'].map(date => ({ date, seconds: 10, attempts: 2, correct: 1 }));
  assert.equal(streakDays(daily, now), 3, 'today not practised yet');
  assert.equal(streakDays([...daily, { date: '2026-10-27', seconds: 1, attempts: 1, correct: 1 }], now), 4);
  assert.equal(streakDays([{ date: '2026-10-20', seconds: 1, attempts: 1, correct: 1 }], now), 0);
  const played = Array.from({ length: 10 }, (_, i) => attempt('play:guitar:40', i < 3 ? 'detection-issue' : 'correct', { method: 'play' }));
  assert.deepEqual(inputHealth([...played, attempt('iv:C:M3:up', 'detection-issue')]), { played: 10, issues: 3, ratio: .3, warn: true });
  assert.equal(inputHealth(played.slice(0, 9)).warn, false, 'too few played answers to judge');
});

test('analysis of large records stays under 50 ms', () => {
  const data = emptyTrainingData(), roots = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const ids = [
    ...['maj7', 'min7', 'dom7', 'half-dim', 'dim7', 'minmaj7'].flatMap(q => roots.flatMap(r => ['third', 'seventh', 'guide', 'fifth'].map(role => `ct:${q}:${r}:${role}`))),
    ...Array.from({ length: 6 }, (_, s) => Array.from({ length: 25 }, (_, f) => `fb:guitar:${s + 1}:${f}`)).flat(),
    ...['m3', 'M3', 'P5', 'm7', 'M7', 'P4', 'M6'].flatMap(id => roots.flatMap(r => [`iv:${r}:${id}:up`, `iv:${r}:${id}:down`])),
    ...roots.flatMap(r => [0, 1, 2, 3].flatMap(inv => Array.from({ length: 10 }, (_, n) => `arp:maj7:${r}:inv${inv}:s${n}:up`))),
  ];
  const layers: SkillLayer[] = ['knowledge', 'fretboard', 'performance'];
  assert.ok(ids.length * 3 >= 3000);
  for (let i = 0; Object.keys(data.stats).length < 3000; i++) {
    const s = stat(ids[i % ids.length], { box: (i % 6) as ItemStat['box'], recentMs: [900, 1500, 2600, 3100, 4000] }, layers[Math.floor(i / ids.length) % 3]);
    data.stats[statKey(s.layer, s.itemId)] = s;
  }
  data.attempts = Array.from({ length: 2000 }, (_, i) => attempt(ids[i % ids.length], i % 7 ? 'correct' : 'detection-issue', { method: i % 2 ? 'play' : 'choice' }));
  assert.equal(Object.keys(data.stats).length, 3000);
  // What the records tab computes on each render; the first run warms up, and the best of three is kept so other
  // test files running in parallel do not decide the result.
  const render = () => { weakness(data.stats, { table: 'ct', layer: 'knowledge', instrument: 'guitar' }); allLevels(data, guitar); todayMenu(data, now, guitar); inputHealth(data.attempts); };
  const best = (run: () => void) => { run(); return Math.min(...[0, 1, 2].map(() => { const started = performance.now(); run(); return performance.now() - started; })); };
  const elapsed = best(render);
  assert.ok(elapsed < 50, `took ${elapsed.toFixed(1)} ms`);
  // Every table at once also stays within the budget.
  const tables = best(() => { for (const table of ['ct', 'iv', 'ivf', 'fb', 'ear', 'rhy'] as const) weakness(data.stats, { table, instrument: 'guitar' }); });
  assert.ok(tables < 50, `tables took ${tables.toFixed(1)} ms`);
});
