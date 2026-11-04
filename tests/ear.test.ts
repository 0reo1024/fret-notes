import test from 'node:test';
import assert from 'node:assert/strict';
import { chordTones, parseChordSymbol } from '../src/domain/music/harmony';
import { pitchOf, scales, tonesFor } from '../src/domain/music/theory';
import { compareSequence, generateMelody, levelShape, maxLevel, nameInKey, playbackPlan, staircase, tonicMidi, type EarKind, type EarKey } from '../src/domain/training/ear';

const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const guitar: [number, number] = [40, 76];
const keys: EarKey[] = [{ tonic: 'C', mode: 'major' }, { tonic: 'E♭', mode: 'major' }, { tonic: 'F♯', mode: 'major' }, { tonic: 'A', mode: 'minor' }, { tonic: 'C♯', mode: 'minor' }];
const scalePcs = (key: EarKey) => tonesFor(key.tonic, scales.find(s => s.id === (key.mode === 'major' ? 'ionian' : 'aeolian'))!).map(t => t.pitch);

test('melodies keep length, range, key and never repeat a pitch back to back',()=>{
  for (const kind of ['single', 'interval', 'melody', 'chord'] as EarKind[]) for (let level = 1; level <= maxLevel; level++) for (const key of keys) for (let seed = 1; seed < 8; seed++) {
    const q = generateMelody(kind, level, key, guitar, seeded(seed * 31 + level));
    const shape = levelShape(kind, level), midis = q.notes.map(n => n.midi);
    assert.equal(midis.length, shape.length, `${kind} ${level}`);
    assert.ok(midis.every(m => m >= guitar[0] && m <= guitar[1]));
    assert.ok(midis.every((m, i) => i === 0 || m !== midis[i - 1]), `${kind} ${level} ${midis}`);
    assert.ok(midis.every((m, i) => i === 0 || Math.abs(m - midis[i - 1]) <= Math.max(shape.leap, 12)));
    if (!q.chromatic) assert.ok(midis.every(m => scalePcs(key).includes(m % 12)), `${kind} ${level} ${key.tonic}`);
    if (!shape.chromatic) assert.equal(q.chromatic, false);
    if (kind === 'chord') {
      const chord = parseChordSymbol(q.chord!) as { root: string; quality: string };
      assert.ok(midis.every(m => chordTones(chord).some(t => t.pitchClass === m % 12)), q.chord!);
    }
    assert.ok(q.notes.every(n => pitchOf(n.name) === n.midi % 12), JSON.stringify(q.notes));
    assert.equal(q.itemId, `ear:${kind}:${shape.length}:${q.chromatic ? 'chromatic' : 'diatonic'}`);
  }
});

test('notes are named in the key, and notes outside it by their degree over the tonic',()=>{
  assert.equal(nameInKey({ tonic: 'E♭', mode: 'major' }, 67).name, 'G');
  assert.equal(nameInKey({ tonic: 'E♭', mode: 'major' }, 68).name, 'A♭');
  assert.deepEqual(nameInKey({ tonic: 'C', mode: 'major' }, 61), { midi: 61, name: 'D♭', degree: '♭2' });
  assert.deepEqual(nameInKey({ tonic: 'C', mode: 'major' }, 66), { midi: 66, name: 'F♯', degree: '♯4' });
  assert.deepEqual(nameInKey({ tonic: 'A', mode: 'minor' }, 68), { midi: 68, name: 'G♯', degree: '7' });
  assert.equal(nameInKey({ tonic: 'F♯', mode: 'major' }, 65).name, 'E♯');
  assert.equal(tonicMidi({ tonic: 'C', mode: 'major' }, guitar) % 12, 0);
});

test('the staircase climbs after two right answers and drops after one wrong, within 1–8',()=>{
  let state = { level: 1, streak: 0 };
  state = staircase(state, true); assert.deepEqual(state, { level: 1, streak: 1 });
  state = staircase(state, true); assert.deepEqual(state, { level: 2, streak: 0 });
  state = staircase(state, false); assert.deepEqual(state, { level: 1, streak: 0 });
  state = staircase(state, false); assert.deepEqual(state, { level: 1, streak: 0 });
  assert.deepEqual(staircase({ level: 8, streak: 1 }, true), { level: 8, streak: 0 });
});

test('played sequences are compared note by note with an edit distance',()=>{
  assert.deepEqual(compareSequence([60, 62, 64], [72, 62, 64], false), { marks: [true, true, true], distance: 0, correct: true });
  assert.deepEqual(compareSequence([60, 62, 64], [72, 62, 64], true).marks, [false, true, true]);
  assert.equal(compareSequence([60, 62, 64], [60, 64], false).distance, 1);
  assert.equal(compareSequence([60, 62, 64], [60, 63, 64], false).distance, 1);
});

test('playback plans a key cue, then the phrase, and reports when input may be judged',()=>{
  const q = generateMelody('melody', 4, { tonic: 'C', mode: 'major' }, guitar, seeded(3));
  const tonic = playbackPlan(q, 'tonic', .6);
  assert.equal(tonic.events[0].midis.length, 1); assert.equal(tonic.events[0].midis[0] % 12, 0);
  assert.deepEqual(tonic.events.slice(1).map(e => e.midis[0]), q.notes.map(n => n.midi));
  assert.ok(Math.abs(tonic.totalSeconds - (1.2 + q.notes.length * .6)) < 1e-9);
  const cadence = playbackPlan(q, 'cadence', .6);
  assert.equal(cadence.events.slice(0, 4).every(e => e.midis.length === 3), true);
  assert.deepEqual(cadence.events[0].midis.map(m => m % 12).sort((a, b) => a - b), [0, 4, 7]);
  assert.deepEqual(cadence.events[2].midis.map(m => m % 12).sort((a, b) => a - b), [2, 7, 11]);
  assert.equal(playbackPlan(q, 'none', .6).events.length, q.notes.length);
});
