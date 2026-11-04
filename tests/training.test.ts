import test from 'node:test';
import assert from 'node:assert/strict';
import {
  review, record, decodeTrainingData, emptyTrainingData, isMastered, isDue, summarize, statKey, localDate, limits, clearPlayDay, hasPlayDay,
  type Attempt, type ItemStat, type TrainingData,
} from '../src/domain/training/records';
import { TrainingRepository, autosaveMs, type TrainingBackend } from '../src/platform/training-store';
import { createCloseHandler, flushAll } from '../src/platform/window-lifecycle';

const day = (d: number, h = 12) => new Date(2026, 9, d, h);
const attempt = (change: Partial<Attempt> = {}): Attempt => ({ itemId: 'ct:dom7:G:third', layer: 'knowledge', trainer: 'harmony', method: 'choice', result: 'correct', responseMs: 1200, instrument: 'guitar', at: day(26).toISOString(), ...change });

test('review moves boxes on graded answers and leaves them for skips and detection issues',()=>{
  let stat: ItemStat | undefined;
  for (let n = 1; n <= 3; n++) stat = review(stat, attempt(), day(20 + n), 2500);
  assert.equal(stat!.box, 3); assert.equal(stat!.dueAt, '2026-10-27');
  const slow = review(stat, attempt({ responseMs: 4000 }), day(24), 2500);
  assert.equal(slow.box, 3); assert.equal(slow.correct, 4); assert.deepEqual(slow.recentMs, [1200, 1200, 1200, 4000]);
  for (const result of ['skipped', 'self-marked', 'detection-issue'] as const) {
    const same = review(stat, attempt({ result }), day(25), 2500);
    assert.equal(same.box, 3, result); assert.equal(same.dueAt, stat!.dueAt, result); assert.equal(same.attempts, 4, result);
  }
  assert.equal(review(stat, attempt({ result: 'detection-issue' }), day(25), 2500).detectionIssues, 1);
  for (const result of ['wrong', 'spelling', 'timeout'] as const) {
    const wrong = review(stat, attempt({ result }), day(25), 2500);
    assert.equal(wrong.box, 1, result); assert.equal(wrong.dueAt, '2026-10-26', result); assert.equal(wrong.wrong, 1, result);
  }
  const top = [1, 2, 3, 4, 5, 6].reduce<ItemStat | undefined>((s, n) => review(s, attempt(), day(n), 2500), undefined)!;
  assert.equal(top.box, 5); assert.equal(top.dueAt, '2026-10-22');
  const first = review(undefined, attempt({ result: 'skipped' }), day(26), 2500);
  assert.equal(first.box, 0); assert.equal(first.dueAt, '2026-10-26');
});

test('a clock that goes backwards does not push the due date or last time',()=>{
  const stat = review(review(undefined, attempt(), day(20), 2500), attempt(), day(22), 2500);
  const back = review(stat, attempt(), day(10), 2500);
  assert.equal(back.dueAt, stat.dueAt); assert.equal(back.lastAt, stat.lastAt); assert.equal(back.box, 3);
});

test('mastery needs a high box and a quick median; due items follow the local date',()=>{
  const stat: ItemStat = { itemId: 'x', layer: 'knowledge', attempts: 5, correct: 5, wrong: 0, detectionIssues: 0, recentMs: [1000, 3000, 1500], box: 4, dueAt: '2026-10-26', lastAt: day(25).toISOString(), firstAt: day(1).toISOString() };
  assert.ok(isMastered(stat, 2500)); assert.ok(!isMastered({ ...stat, box: 3 }, 2500)); assert.ok(!isMastered({ ...stat, recentMs: [3000, 3000, 1000] }, 2500));
  assert.ok(!isMastered({ ...stat, recentMs: [] }, 2500));
  assert.ok(isDue(stat, day(26, 0))); assert.ok(!isDue(stat, day(25, 23)));
  assert.equal(localDate(day(26, 0)), '2026-10-26');
});

test('record keeps layers apart, totals each day and bounds the attempt log',()=>{
  let data = emptyTrainingData();
  data = record(data, attempt(), day(26)); data = record(data, attempt({ layer: 'performance', method: 'play', responseMs: 3000 }), day(26));
  data = record(data, attempt({ result: 'wrong', responseMs: 90000 }), day(26));
  assert.deepEqual(Object.keys(data.stats).sort(), [statKey('knowledge', 'ct:dom7:G:third'), statKey('performance', 'ct:dom7:G:third')].sort());
  assert.deepEqual(data.daily, [{ date: '2026-10-26', seconds: 64.2, attempts: 3, correct: 2 }]);
  for (let n = 0; n < limits.attempts + 5; n++) data = record(data, attempt({ itemId: `fb:guitar:1:${n % 13}` }), day(27));
  assert.equal(data.attempts.length, limits.attempts);
  assert.equal(data.daily.length, 2);
  const summary = summarize(data, day(27));
  assert.equal(summary.today.attempts, limits.attempts + 5); assert.equal(summary.week.attempts, limits.attempts + 8);
  assert.equal(summary.days.length, 7); assert.equal(summary.items, 15);
  assert.deepEqual(decodeTrainingData(JSON.parse(JSON.stringify(data))), data);
});

test('decode rejects malformed records, oversized lists and other versions',()=>{
  const valid = record(emptyTrainingData(), attempt(), day(26));
  const broken = (change: (data: Record<string, any>) => void) => { const copy: Record<string, any> = structuredClone(valid); change(copy); return copy; };
  assert.throws(() => decodeTrainingData(broken(d => { d.schemaVersion = 2; })));
  assert.throws(() => decodeTrainingData(broken(d => { d.extra = 1; })));
  assert.throws(() => decodeTrainingData(broken(d => { d.attempts[0].result = 'great'; })));
  assert.throws(() => decodeTrainingData(broken(d => { d.attempts[0].instrument = 'ukulele'; })));
  assert.throws(() => decodeTrainingData(broken(d => { d.attempts[0].responseMs = -1; })));
  assert.throws(() => decodeTrainingData(broken(d => { Object.values<any>(d.stats)[0].box = 6; })));
  assert.throws(() => decodeTrainingData(broken(d => { d.stats['performance|other'] = Object.values<any>(d.stats)[0]; })));
  assert.throws(() => decodeTrainingData(broken(d => { d.daily[0].correct = 5; })));
  assert.throws(() => decodeTrainingData(broken(d => { d.takes = Array(limits.takes + 1).fill({}); })));
  assert.throws(() => decodeTrainingData(broken(d => { d.calibration.tapOffsetMs = 'fast'; })));
  assert.throws(() => decodeTrainingData(null));
});

function store(fail = false) {
  const saved: TrainingData[] = [], timers: (() => void)[] = [];
  let failing = fail;
  const backend: TrainingBackend = { async load() { return { data: null, recovered: false }; }, async save(data) { if (failing) throw new Error('disk full'); saved.push(data); } };
  const repository = new TrainingRepository(backend, () => day(26), (run, ms) => { assert.equal(ms, autosaveMs); timers.push(run); return timers.length as unknown as ReturnType<typeof setTimeout>; }, () => {});
  return { repository, saved, timers, recover: () => { failing = false; } };
}
const newAttempt = (change: Partial<Attempt> = {}) => { const { at: _, ...rest } = attempt(change); return rest; };

test('repository batches saves, flushes on demand and retries a failed save',async()=>{
  const { repository, saved, timers } = store();
  await repository.load(); assert.deepEqual(repository.current, emptyTrainingData());
  repository.add(newAttempt()); repository.add(newAttempt()); repository.updatePreferences('play', { octave: 'any' });
  assert.equal(timers.length, 1); assert.equal(saved.length, 0);
  timers[0](); await repository.flush();
  assert.equal(saved.length, 1); assert.equal(saved[0].attempts.length, 2); assert.deepEqual(repository.preference('play'), { octave: 'any' });
  await repository.flush(); assert.equal(saved.length, 1);
  const failing = store(true), messages: string[] = []; failing.repository.onStatus = message => messages.push(message);
  failing.repository.add(newAttempt());
  await assert.rejects(failing.repository.flush(), /disk full/); assert.match(messages[0], /学習記録を保存できません/);
  failing.recover(); await failing.repository.flush();
  assert.equal(failing.saved.length, 1); assert.equal(messages.at(-1), '');
});

test('replacing records validates first and restores the old data if saving fails',async()=>{
  const { repository, saved } = store();
  repository.add(newAttempt());
  await assert.rejects(repository.replace({ schemaVersion: 9 })); assert.equal(repository.current.attempts.length, 1);
  await repository.clear(); assert.deepEqual(repository.current, emptyTrainingData()); assert.deepEqual(saved.at(-1), emptyTrainingData());
  const failing = store(true); failing.repository.add(newAttempt());
  await assert.rejects(failing.repository.replace(emptyTrainingData())); assert.equal(failing.repository.current.attempts.length, 1);
});

test('closing waits for both settings and training records',async()=>{
  const release: (() => void)[] = [], done: string[] = [];
  const pending = (name: string) => () => new Promise<void>(resolve => { release.push(() => { done.push(name); resolve(); }); });
  let prevented = false, finished = false;
  const close = createCloseHandler(flushAll(pending('settings'), pending('training')), () => {});
  const closing = close({ preventDefault: () => { prevented = true; } }).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(release.length, 2);
  release[0](); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(finished, false);
  release[1](); await closing; assert.deepEqual(done, ['settings', 'training']); assert.equal(prevented, false);
  let error: unknown = null, trainingSaved = false;
  const failing = createCloseHandler(flushAll(async () => { throw new Error('settings failed'); }, async () => { trainingSaved = true; }), e => { error = e; });
  await failing({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented); assert.ok(trainingSaved); assert.match(String(error), /settings failed/);
});

test('clearPlayDay removes one day of single-note practice for one instrument only',()=>{
  const play = (d: number, change: Partial<Attempt> = {}) => attempt({ itemId: 'play:guitar:64', layer: 'performance', trainer: 'play', method: 'play', responseMs: 2000, at: day(d).toISOString(), ...change });
  let data = emptyTrainingData();
  data = record(data, play(25), day(25));
  data = record(data, play(26), day(26));
  data = record(data, play(26, { itemId: 'play:guitar:65' }), day(26));
  data = record(data, play(26, { itemId: 'play:bass4:40', instrument: 'bass4' }), day(26));
  data = record(data, attempt(), day(26));
  const position = { instrument: 'guitar' as const, string: 1, fret: 0, midi: 64, asked: 1, answered: 1, wrong: 0, totalMs: 2000 };
  data = { ...data, playPositions: [{ ...position, date: '2026-10-25' }, { ...position, date: '2026-10-26' }, { ...position, date: '2026-10-26', instrument: 'bass4', midi: 40 }] };
  assert.equal(hasPlayDay(data, '2026-10-26', 'guitar'), true);

  const cleared = clearPlayDay(data, '2026-10-26', 'guitar');
  assert.equal(hasPlayDay(cleared, '2026-10-26', 'guitar'), false);
  assert.equal(hasPlayDay(cleared, '2026-10-26', 'bass4'), true);
  assert.deepEqual(cleared.playPositions.map(e => `${e.date}:${e.instrument}`), ['2026-10-25:guitar', '2026-10-26:bass4']);
  assert.equal(cleared.attempts.length, 3);
  assert.deepEqual(cleared.daily.find(d => d.date === '2026-10-26'), { date: '2026-10-26', seconds: 3.2, attempts: 2, correct: 2 });
  assert.deepEqual(cleared.daily.find(d => d.date === '2026-10-25'), data.daily.find(d => d.date === '2026-10-25'));
  // The item answered yesterday too keeps yesterday's count; the one only answered today is gone.
  assert.equal(cleared.stats[statKey('performance', 'play:guitar:64')].attempts, 1);
  assert.equal(cleared.stats[statKey('performance', 'play:guitar:65')], undefined);
  assert.equal(cleared.stats[statKey('knowledge', 'ct:dom7:G:third')].attempts, 1);
  // A day left with no answers disappears from the summary.
  assert.equal(clearPlayDay(cleared, '2026-10-25', 'guitar').daily.some(d => d.date === '2026-10-25'), false);
});
