import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contour, contourSimilarity, decodePhraseTakes, drawConstraint, keyOf, libraryMotif, matchesRepeat, matchesTransposed, maxPasses, motifBeats, motifEvents,
  motifShapes, phraseMetrics, phraseTask, randomMotif, scaleContour, taskKinds, timelineRows, type Motif, type PhraseTake,
} from '../src/domain/training/motif';
import { library, materialize, parseProgression, type Progression } from '../src/domain/training/progression';
import { scaleOf } from '../src/domain/training/ear';
import { emptyTrainingData, limits } from '../src/domain/training/records';
import { TrainingRepository } from '../src/platform/training-store';

const C = { tonic: 'C', mode: 'major' as const };
const motif = (...midis: number[]): Motif => ({ id: 't', name: 't', key: C, notes: midis.map(midi => ({ midi, beats: 1 })), startBeat: 0 });
const notes = (...midis: number[]) => midis.map(midi => ({ midi }));
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const iiVI = materialize(library.find(e => e.id === 'major-ii-v-i')!, 'C');

test('contours in semitones and in scale steps',()=>{
  assert.deepEqual(contour(notes(60, 62, 64)), [2, 2]);
  assert.deepEqual(scaleContour(notes(60, 62, 64), C), [1, 1]);
  assert.deepEqual(scaleContour(notes(62, 64, 65), C), [1, 1]);
  assert.deepEqual(scaleContour(notes(71, 72, 74), C), [1, 1], 'B to C crosses the octave in steps too');
  assert.equal(scaleContour(notes(60, 61), C), null, 'C♯ is outside C major');
  assert.deepEqual(scaleContour(notes(57, 59, 60), { tonic: 'A', mode: 'minor' }), [1, 1]);
});

test('repeat: the same pitches as consecutive notes anywhere in the take',()=>{
  const m = motif(60, 62, 64);
  for (const [played, options, expected] of [
    [[60, 62, 64], {}, 0], [[55, 57, 60, 62, 64, 67], {}, 2], [[60, 62, 65], {}, null], [[60, 62], {}, null],
    [[60, 59, 62, 64], {}, null], [[72, 74, 76], {}, null], [[72, 74, 76], { pitchClass: true }, 0], [[72, 62, 76], { pitchClass: true }, 0],
  ] as [number[], { pitchClass?: boolean }, number | null][]) assert.equal(matchesRepeat(notes(...played), m, options), expected, played.join(','));
});

test('moved repeat: same contour from the asked pitch class',()=>{
  const m = motif(60, 62, 64), F = 5, D = 2;
  assert.equal(matchesTransposed(notes(65, 67, 69), m, F), 0, 'F–G–A has the contour of C–D–E');
  assert.equal(matchesTransposed(notes(65, 67, 68), m, F), null, 'F–G–A♭ (+2, +1) does not');
  assert.equal(matchesTransposed(notes(53, 55, 57), m, F), 0, 'any octave');
  assert.equal(matchesTransposed(notes(67, 69, 71), m, F), null, 'G–A–B has the contour but the wrong start');
  assert.equal(matchesTransposed(notes(60, 65, 67, 69, 72), m, F), 1);
  // Moving within C major: D–E–F is one step up twice on the scale, although its semitones are (+2, +1).
  assert.equal(matchesTransposed(notes(62, 64, 65), m, D), null);
  assert.equal(matchesTransposed(notes(62, 64, 65), m, D, C), 0);
  assert.equal(matchesTransposed(notes(62, 64, 66), m, D, C), null, 'F♯ leaves the key');
  assert.equal(matchesTransposed(notes(62, 64, 65), motif(60, 61, 64), D, C), null, 'a chromatic motif cannot be moved within the key');
});

test('reference figures: notes, pitch classes, rests, contour and the fret window',()=>{
  const events = [{ midi: 60, startMs: 0, endMs: 500 }, { midi: 64, startMs: 400, endMs: 1000 }, { midi: 72, startMs: 2000, endMs: null }, { midi: 67, startMs: 5000, endMs: 5200 }];
  const m = phraseMetrics(events, 0, 4000, motif(60, 64, 67), new Set([60, 64]));
  assert.deepEqual({ ...m, restRatio: Math.round(m.restRatio! * 1000) / 1000 }, { notes: 3, pitchClasses: 2, restRatio: .25, contourSimilarity: 1, outside: 1 });
  const empty = phraseMetrics([], 0, 4000, motif(60, 64), null);
  assert.deepEqual(empty, { notes: 0, pitchClasses: 0, restRatio: 1, contourSimilarity: null, outside: null });
  assert.equal(contourSimilarity(notes(60, 62, 61, 65), motif(60, 64, 67)), .5);
  assert.equal(contourSimilarity(notes(67, 65, 64), motif(60, 64, 67)), 0);
});

test('motifs are placed in the key and the playable range',()=>{
  for (const shape of motifShapes) for (const key of [C, { tonic: 'E♭', mode: 'major' as const }, { tonic: 'F♯', mode: 'minor' as const }]) for (const range of [[40, 88], [28, 67], [23, 67]] as [number, number][]) {
    const m = libraryMotif(shape.id, key, range), pcs = scaleOf(key).map(t => t.pitch);
    assert.ok(m.notes.every(n => n.midi >= range[0] && n.midi <= range[1] && pcs.includes(n.midi % 12)), `${shape.id} ${key.tonic} ${range}`);
  }
  assert.deepEqual(libraryMotif('climb', C, [40, 88]).notes.map(n => n.midi % 12), [0, 2, 4]);
  for (let seed = 1; seed < 40; seed++) {
    const m = randomMotif(seed % 4 + 2, C, [40, 88], seeded(seed));
    assert.equal(m.notes.length, seed % 4 + 2);
    assert.ok(m.notes.every((n, i) => i === 0 || n.midi !== m.notes[i - 1].midi));
    assert.ok(m.notes.every(n => n.beats > 0));
  }
  const climb = libraryMotif('climb', C, [40, 88]);
  assert.equal(motifBeats(climb), 4);
  assert.deepEqual(motifEvents(climb, 120).map(e => e.at), [0, .5, 1]);
  assert.equal(motifEvents(libraryMotif('call', C, [40, 88]), 60)[0].at, 1);
});

test('tasks: moved repeats start on the third of a later chord; in-key needs a key',()=>{
  const m = libraryMotif('climb', C, [40, 88]);
  for (let seed = 1; seed < 20; seed++) {
    const t = phraseTask('transpose', iiVI, m, seeded(seed));
    assert.ok(t.start!.chordIndex > 0); assert.ok([['G7', 11], ['Cmaj7', 4]].some(([c, pc]) => t.start!.chord === c && t.start!.pitchClass === pc), JSON.stringify(t.start));
  }
  const inKey = phraseTask('diatonic', iiVI, m, seeded(3));
  assert.equal(inKey.kind, 'diatonic'); assert.ok(inKey.objective);
  const bars = parseProgression('Dm7 | G7 | Cmaj7 |'); if ('error' in bars) throw new Error();
  const keyless: Progression = { id: 'u', name: 'u', source: 'user', bars, beatsPerBar: 4 };
  assert.deepEqual(keyOf(keyless), { tonic: 'D', mode: 'minor' });
  assert.equal(phraseTask('diatonic', keyless, m).kind, 'transpose', 'no key: falls back to semitones');
  const sus = parseProgression('Csus4 | Gsus4 |'); if ('error' in sus) throw new Error();
  assert.equal(phraseTask('transpose', { ...keyless, bars: sus }, m).kind, 'repeat', 'no chord has a third');
  for (const kind of taskKinds) { const t = phraseTask(kind.kind, iiVI, m); assert.equal(t.objective, kind.objective); assert.ok(t.instruction.length > 0); assert.equal(t.id, `${t.kind}:climb`); }
  assert.equal(maxPasses(iiVI), 16); assert.equal(maxPasses(materialize(library.find(e => e.id === 'blues-basic')!, 'C')), 5);
});

test('constraint cards never repeat the previous one',()=>{
  let previous: string | null = null;
  for (let seed = 1; seed < 50; seed++) { const card = drawConstraint(seeded(seed), previous); assert.notEqual(card.id, previous); previous = card.id; }
});

test('takes: only well-formed phrase takes are read, and twenty are kept',async()=>{
  const take = (i: number): PhraseTake => ({ trainer: 'phrase', id: `t${i}`, taskId: 'repeat:climb', progressionId: 'major-ii-v-i', tempo: 80, events: [{ midi: 60, startMs: 0, endMs: 300 }],
    objective: true, constraintId: null, selfAssessment: { motif: 'yes', rests: 'partial' }, memo: '', at: new Date(2026, 9, 27).toISOString() });
  assert.equal(decodePhraseTakes([take(1), { ...take(2), trainer: 'other' }, { ...take(3), memo: 'x'.repeat(201) }, { ...take(4), selfAssessment: { motif: 'great' } },
    { ...take(5), events: [{ midi: 60, startMs: 10, endMs: 5 }] }, null, 'x']).length, 1);
  const saved: unknown[] = [];
  const repository = new TrainingRepository({ async load() { return { data: emptyTrainingData(), recovered: false }; }, async save(data) { saved.push(data); } }, () => new Date(), () => 0 as unknown as ReturnType<typeof setTimeout>, () => {});
  await repository.load();
  for (let i = 0; i < 25; i++) repository.addTake(take(i));
  assert.equal(repository.current.takes.length, limits.takes);
  assert.deepEqual(decodePhraseTakes(repository.current.takes).map(t => t.id), Array.from({ length: 20 }, (_, i) => `t${i + 5}`));
  await repository.flush(); assert.equal(saved.length, 1);
});

test('timeline: notes go to their pass and chord',()=>{
  // ii–V–I in C at 120 BPM: each chord one bar of 2 s, a pass of 8 s.
  const rows = timelineRows([{ midi: 62, startMs: 0 }, { midi: 65, startMs: 1950 }, { midi: 71, startMs: 2500 }, { midi: 60, startMs: 7950 }, { midi: 64, startMs: 9000 }], iiVI, 120, 9500);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].notes.map(n => [n.index, n.chordIndex]), [[0, 0], [1, 1], [2, 1]]);
  assert.deepEqual(rows[1].notes.map(n => [n.index, n.chordIndex, n.share]), [[3, 0, 0], [4, 0, .125]]);
  assert.equal(timelineRows([], iiVI, 120, 0).length, 1);
});
