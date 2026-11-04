import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPlayPosition, focusPositions, mergePlayPreferences, playPositionEntry, playPreferences, rankPositions, rankingDates, validPlayPosition, weakConstants, weaknessScore,
  type PlayPositionDay,
} from '../src/domain/practice/weak-positions';
import { PerformanceSession, type PlayTarget } from '../src/domain/practice/performance';
import { create } from '../src/domain/instruments/core';
import { resolveInstrument, type ProfileId } from '../src/domain/instruments/profiles';
import { decodeTrainingData, emptyTrainingData, localDate } from '../src/domain/training/records';

const midiAtFor = (id: ProfileId, tuning = 'standard') => {
  const profile = resolveInstrument(id, { selectedTuningId: tuning, customTunings: [] }), core = create(profile);
  return (string: number, fret: number) => string >= 1 && string <= core.stringCount && fret >= 0 && fret <= profile.fretCount ? core.midi({ string, fret }) : null;
};
const guitar = midiAtFor('guitar');
/** Standard guitar: string 6 = E2 (40), 5 = A2 (45), 4 = D3 (50), 3 = G3 (55), 2 = B3 (59), 1 = E4 (64). */
const day = (date: string, string: number, fret: number, asked: number, wrong: number, totalMs: number, answered = asked, instrument: ProfileId = 'guitar', midi = guitar(string, fret)!): PlayPositionDay =>
  ({ date, instrument, string, fret, midi, asked, answered, wrong, totalMs });

test('weakness score blends mistakes and time, pulling positions with few questions toward ordinary',()=>{
  const table: [number, number, number, number][] = [
    [10, 0, 25000, 33], [1, 2, 9000, 131], [5, 3, 25000, 99], [3, 0, 20000, 66], [1, 0, 2000, 35], [1, 1, 12000, 110],
  ];
  for (const [asked, wrong, totalMs, score] of table) assert.equal(weaknessScore({ asked, wrong, totalMs }, 4000), score, `${asked}/${wrong}/${totalMs}`);
  // A stricter goal makes the same playing weaker: e = 0.2/7, t = (20000 + 3600)/7 against 3000 ms.
  assert.equal(weaknessScore({ asked: 5, wrong: 0, totalMs: 20000 }, 3000), 59);
});

test('entries: answers keep their time up to the cap, abandoned questions only when the player struggled',()=>{
  const spot = { string: 5, fret: 3, midi: 48 };
  assert.deepEqual(playPositionEntry(spot, { kind: 'answered', listeningMs: 2345.6, wrongAttempts: 1 }, 'guitar', '2026-10-29', 4000),
    { date: '2026-10-29', instrument: 'guitar', string: 5, fret: 3, midi: 48, asked: 1, answered: 1, wrong: 1, totalMs: 2346 });
  assert.equal(playPositionEntry(spot, { kind: 'answered', listeningMs: 60000, wrongAttempts: 0 }, 'guitar', '2026-10-29', 4000)!.totalMs, 12000);
  assert.equal(playPositionEntry(spot, { kind: 'abandoned', listeningMs: 3999, wrongAttempts: 0 }, 'guitar', '2026-10-29', 4000), null);
  const gaveUp = playPositionEntry(spot, { kind: 'abandoned', listeningMs: 4000, wrongAttempts: 0 }, 'guitar', '2026-10-29', 4000)!;
  assert.deepEqual([gaveUp.asked, gaveUp.answered, gaveUp.wrong, gaveUp.totalMs], [1, 0, 1, 12000]);
  const missed = playPositionEntry(spot, { kind: 'abandoned', listeningMs: 500, wrongAttempts: 2 }, 'guitar', '2026-10-29', 3000)!;
  assert.deepEqual([missed.wrong, missed.totalMs], [1, 9000]);
  // However many wrong notes come before the answer, the question is one mistake.
  assert.equal(playPositionEntry(spot, { kind: 'answered', listeningMs: 2000, wrongAttempts: 4 }, 'guitar', '2026-10-29', 4000)!.wrong, 1);
});

test('adding sums the same day and position and keeps every other key apart',()=>{
  let list = addPlayPosition([], day('2026-10-29', 5, 3, 1, 0, 2000));
  list = addPlayPosition(list, day('2026-10-29', 5, 3, 1, 2, 5000, 0));
  assert.deepEqual(list, [day('2026-10-29', 5, 3, 2, 2, 7000, 1)]);
  for (const other of [day('2026-10-28', 5, 3, 1, 0, 1), day('2026-10-29', 4, 3, 1, 0, 1), day('2026-10-29', 5, 4, 1, 0, 1),
    day('2026-10-29', 5, 3, 1, 0, 1, 1, 'guitar', 47), day('2026-10-29', 3, 3, 1, 0, 1, 1, 'bass4', 46)]) list = addPlayPosition(list, other);
  assert.equal(list.length, 6);
  assert.equal(list[0].date, '2026-10-28');
});

test('only the newest 400 dates and the entry limit are kept',()=>{
  let list: PlayPositionDay[] = [];
  const start = new Date(2025, 0, 1);
  for (let n = 0; n < 402; n++) list.push(day(localDate(new Date(2025, 0, 1 + n)), 6, 0, 1, 0, 1000));
  list = addPlayPosition(list, day(localDate(new Date(2025, 0, 1 + 402)), 6, 0, 1, 0, 1000));
  assert.equal(list.length, 400);
  assert.equal(list[0].date, localDate(new Date(start.getFullYear(), 0, 4)));
  const many = Array.from({ length: weakConstants.maximumEntries }, (_, i) => day('2026-10-28', 1 + i % 6, i % 13, 1, 0, 1000, 1, 'guitar', i % 128));
  const trimmed = addPlayPosition(many, day('2026-10-29', 6, 0, 1, 0, 1000));
  assert.equal(trimmed.length, weakConstants.maximumEntries);
  assert.equal(trimmed.at(-1)!.date, '2026-10-29');
});

test('ranking orders by score, then mistakes, average time and position; marks weak, tentative and the previous rank',()=>{
  const list = [
    day('2026-10-28', 4, 2, 5, 3, 25000), day('2026-10-28', 5, 3, 10, 0, 25000),
    day('2026-10-29', 6, 1, 10, 0, 25000), day('2026-10-29', 5, 3, 1, 2, 9000), day('2026-10-29', 4, 2, 5, 3, 25000),
    day('2026-10-29', 3, 0, 10, 0, 25000), day('2026-10-29', 2, 0, 1, 0, 2000),
  ];
  const ranked = rankPositions(list, { date: '2026-10-29', instrument: 'guitar', midiAt: guitar, targetMs: 4000 });
  assert.deepEqual(ranked.map(r => `${r.string}:${r.fret}`), ['5:3', '4:2', '2:0', '3:0', '6:1']);
  assert.deepEqual(ranked.map(r => r.score), [131, 99, 35, 33, 33]);
  assert.deepEqual(ranked.map(r => r.weak), [true, true, false, false, false]);
  assert.deepEqual(ranked.map(r => r.tentative), [true, false, true, false, false]);
  assert.deepEqual(ranked.map(r => r.previousRank), [2, 1, null, null, null]);
  assert.equal(ranked[0].averageMs, 9000);
  // Equal scores and mistakes: the slower average first.
  const tie = rankPositions([day('2026-10-29', 1, 0, 4, 0, 8000), day('2026-10-29', 2, 0, 4, 0, 8100)], { date: '2026-10-29', instrument: 'guitar', midiAt: guitar, targetMs: 4000 });
  assert.equal(tie[0].score, tie[1].score); assert.deepEqual(tie.map(r => r.string), [2, 1]);
  assert.deepEqual(rankPositions(list, { date: '2026-10-27', instrument: 'guitar', midiAt: guitar, targetMs: 4000 }), []);
});

test('ranking follows the instrument and the tuning: drop D hides standard string 6 records',()=>{
  const dropD = midiAtFor('guitar', 'drop-d');
  const list = [day('2026-10-29', 6, 0, 1, 0, 2000), day('2026-10-29', 6, 0, 1, 1, 6000, 1, 'guitar', 38), day('2026-10-29', 5, 0, 1, 0, 2000)];
  assert.deepEqual(rankPositions(list, { date: '2026-10-29', instrument: 'guitar', midiAt: guitar, targetMs: 4000 }).map(r => r.midi).sort(), [40, 45]);
  assert.deepEqual(rankPositions(list, { date: '2026-10-29', instrument: 'guitar', midiAt: dropD, targetMs: 4000 }).map(r => r.midi).sort(), [38, 45]);
  const bass4 = midiAtFor('bass4'), bass5 = midiAtFor('bass5');
  const basses = [day('2026-10-29', 4, 0, 1, 0, 2000, 1, 'bass4', 28), day('2026-10-29', 5, 0, 1, 0, 2000, 1, 'bass5', 23), day('2026-10-29', 5, 0, 1, 0, 2000, 1, 'bass4', 23)];
  assert.deepEqual(rankPositions(basses, { date: '2026-10-29', instrument: 'bass4', midiAt: bass4, targetMs: 4000 }).map(r => r.string), [4]);
  assert.deepEqual(rankPositions(basses, { date: '2026-10-29', instrument: 'bass5', midiAt: bass5, targetMs: 4000 }).map(r => r.string), [5]);
});

test('ranking dates are per instrument and tuning, newest first, split at local midnight',()=>{
  const late = localDate(new Date(2026, 9, 28, 23, 59)), early = localDate(new Date(2026, 9, 29, 0, 1));
  assert.notEqual(late, early);
  const list = [day(late, 6, 0, 1, 0, 1), day(early, 6, 0, 1, 0, 1), day('2026-10-20', 1, 0, 1, 0, 1, 1, 'bass4', 43), day('2026-10-21', 6, 0, 1, 0, 1, 1, 'guitar', 38)];
  assert.deepEqual(rankingDates(list, { instrument: 'guitar', midiAt: guitar }), ['2026-10-29', '2026-10-28']);
});

test('focus takes the weak positions of today, or of the latest day with enough of them',()=>{
  const playable = () => true, query = { today: '2026-10-29', instrument: 'guitar' as const, midiAt: guitar, targetMs: 4000, count: 10, playable };
  const yesterday = Array.from({ length: 8 }, (_, i) => day('2026-10-28', 1 + i % 6, i, 1, 2, 9000));
  // The first answer of the day must not replace yesterday's list.
  const morning = [...yesterday, day('2026-10-29', 5, 3, 1, 2, 9000)];
  assert.deepEqual(focusPositions(morning, query), { date: '2026-10-28', positions: yesterday.map(({ string, fret }) => ({ string, fret })).sort((a, b) => a.string - b.string || a.fret - b.fret) });
  const today = [...morning, day('2026-10-29', 4, 2, 5, 3, 25000), day('2026-10-29', 3, 0, 10, 0, 25000)];
  assert.deepEqual(focusPositions(today, query), { date: '2026-10-29', positions: [{ string: 5, fret: 3 }, { string: 4, fret: 2 }] });
  assert.equal(focusPositions(today, { ...query, count: 5 })!.positions.length, 2);
  assert.equal(focusPositions(yesterday, { ...query, count: 3 })!.positions.length, 3);
  assert.equal(focusPositions(yesterday, { ...query, playable: spot => spot.string !== 1 && spot.string !== 2 })!.positions.length, 4);
  assert.equal(focusPositions([day('2026-10-29', 5, 3, 1, 2, 9000), day('2026-10-29', 3, 0, 10, 0, 25000)], query), null);
  assert.equal(focusPositions(yesterday.map(e => ({ ...e, date: '2026-10-30' })), query), null);
});

test('pending is the open question while listening, holding or paused, and nothing after an answer',()=>{
  const targets: PlayTarget[] = [{ string: 6, fret: 0, midi: 40, note: 'E2' }, { string: 5, fret: 0, midi: 45, note: 'A2' }];
  const session = new PerformanceSession(targets, { toleranceCents: 10, holdMs: 350, referenceHz: 440 }, () => .2);
  assert.equal(session.pending(), null);
  session.bind('a'); let time = 0, sequence = 0;
  const send = (midi: number) => session.consume({ sessionId: 'a', sequence: ++sequence, audioTimeMs: time += 70, state: 'stable', frequency: 440 * 2 ** ((midi - 69) / 12) });
  const wrong = session.target!.midi === 40 ? 45 : 40;
  for (let n = 0; n < 7; n++) send(wrong);
  assert.equal(session.pending()!.wrongAttempts, 1); assert.equal(session.pending()!.target.midi, session.target!.midi);
  assert.ok(session.pending()!.listeningMs > 0);
  session.pause(); assert.equal(session.pending()!.wrongAttempts, 1);
  session.bind('b'); time = 0; sequence = 0;
  const right = session.target!.midi;
  const sendB = () => session.consume({ sessionId: 'b', sequence: ++sequence, audioTimeMs: time += 70, state: 'stable', frequency: 440 * 2 ** ((right - 69) / 12) });
  sendB(); assert.equal(session.phase, 'candidate'); assert.ok(session.pending());
  for (let n = 0; n < 6; n++) sendB();
  assert.equal(session.phase, 'accepted'); assert.equal(session.pending(), null);
  session.finish(); assert.equal(session.pending(), null);
});

test('play preferences: a change keeps the other settings and unexpected values fall back',()=>{
  const stored = { octave: 'exact', focus: true, focusCount: 15, other: 1 };
  assert.deepEqual(mergePlayPreferences(stored, { octave: 'any' }), { octave: 'any', focus: true, focusCount: 15, other: 1 });
  assert.deepEqual(playPreferences(mergePlayPreferences(stored, { octave: 'any' })), { octave: 'any', focus: true, focusCount: 15 });
  assert.deepEqual(playPreferences({ octave: 'odd', focus: 'yes', focusCount: 7 }), { octave: 'exact', focus: false, focusCount: 10 });
  assert.deepEqual(playPreferences(undefined), { octave: 'exact', focus: false, focusCount: 10 });
  assert.deepEqual(mergePlayPreferences(['x'], { focus: true }), { focus: true });
});

test('training data: old files without playPositions load, and broken entries are rejected',()=>{
  const { playPositions: _, ...old } = emptyTrainingData();
  assert.deepEqual(decodeTrainingData(old).playPositions, []);
  assert.deepEqual(decodeTrainingData(JSON.parse(JSON.stringify(emptyTrainingData()))), emptyTrainingData());
  const good = day('2026-10-29', 5, 3, 2, 1, 5000, 1);
  assert.deepEqual(decodeTrainingData({ ...emptyTrainingData(), playPositions: [good] }).playPositions, [good]);
  assert.ok(validPlayPosition(good));
  for (const broken of [{ ...good, asked: 0 }, { ...good, answered: 3 }, { ...good, wrong: -1 }, { ...good, totalMs: 1.5 }, { ...good, date: '2026/10/29' },
    { ...good, instrument: 'ukulele' }, { ...good, string: 7 }, { ...good, fret: 25 }, { ...good, midi: 128 }, { ...good, extra: 1 }, (({ wrong: _w, ...rest }) => rest)(good)]) {
    assert.equal(validPlayPosition(broken), false, JSON.stringify(broken));
    assert.throws(() => decodeTrainingData({ ...emptyTrainingData(), playPositions: [broken] }));
  }
  assert.throws(() => decodeTrainingData({ ...emptyTrainingData(), playPositions: {} }));
  assert.throws(() => decodeTrainingData({ ...emptyTrainingData(), playPositions: Array.from({ length: weakConstants.maximumEntries + 1 }, () => good) }));
});
