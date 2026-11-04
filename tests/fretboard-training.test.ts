import test from 'node:test';
import assert from 'node:assert/strict';
import { create, type Position } from '../src/domain/instruments/core';
import { resolveInstrument, defaultTuning } from '../src/domain/instruments/profiles';
import { FindAllSession } from '../src/domain/practice/find-all';
import { pitchClassChoices, pitchClassLabel, noteEntryKey, entryName, emptyEntry, checkPitchClassName } from '../src/domain/training/note-answers';
import { PerformanceSession, type PlayTarget } from '../src/domain/practice/performance';

const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const profiles = [
  resolveInstrument('guitar'), resolveInstrument('guitar', { ...defaultTuning(), selectedTuningId: 'drop-d' }),
  resolveInstrument('bass5', { ...defaultTuning(), selectedTuningId: 'drop-a' }),
  resolveInstrument('guitar', { selectedTuningId: 'user:open-d', customTunings: [{ id: 'user:open-d', name: 'Open D', instrumentId: 'guitar', openMidi: [62, 57, 54, 50, 45, 38] }] }),
];

test('find-all answers are exactly the in-range positions of the asked pitch class',()=>{
  for (const profile of profiles) {
    const core = create(profile), settings = core.normalize({ frets: [0, 1, 2, 3, 4, 5, 6, 7], strings: [1, 2, 3, 4] });
    const session = new FindAllSession(core, settings, seeded());
    const pcs = new Set(core.candidates(settings).map(p => core.pitch(p)));
    assert.equal(session.deck.length, pcs.size, profile.tuning.name);
    assert.deepEqual(new Set(session.deck), pcs);
    for (let n = 0; n < session.deck.length; n++, session.next()) {
      const pc = session.current()!;
      assert.deepEqual(session.answers(), core.candidates(settings).filter(p => core.pitch(p) === pc), `${profile.tuning.name} ${pc}`);
      assert.ok(session.answers().every(p => settings.strings.includes(p.string) && settings.frets.includes(p.fret)));
    }
  }
});

test('find-all toggles picks, scores found, wrong and missed, and keeps the score fixed',()=>{
  const core = create(resolveInstrument('guitar')), settings = core.normalize({ strings: [6, 5], frets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  const session = new FindAllSession(core, settings, seeded(3));
  while (session.current() !== 4) session.next();
  assert.deepEqual(session.answers(), [{ string: 5, fret: 7 }, { string: 6, fret: 0 }, { string: 6, fret: 12 }]);
  session.toggle({ string: 6, fret: 0 }); session.toggle({ string: 5, fret: 6 }); session.toggle({ string: 5, fret: 6 }); session.toggle({ string: 5, fret: 5 });
  session.toggle({ string: 1, fret: 0 });
  assert.equal(session.selected.size, 2);
  const result = session.complete()!;
  assert.deepEqual(result.found, [{ string: 6, fret: 0 }]); assert.deepEqual(result.wrong, [{ string: 5, fret: 5 }]);
  assert.deepEqual(result.missed, [{ string: 5, fret: 7 }, { string: 6, fret: 12 }]); assert.equal(result.correct, false);
  session.toggle({ string: 5, fret: 7 }); assert.equal(session.complete(), result);
  session.next(); assert.equal(session.selected.size, 0); assert.equal(session.result, null);
  for (const p of session.answers()) session.toggle(p);
  assert.equal(session.complete()!.correct, true);
});

test('find-all rounds avoid a repeat at the boundary, respect natural notes and handle an empty range',()=>{
  const core = create(resolveInstrument('bass4'));
  const naturals = new FindAllSession(core, core.normalize({ naturalOnly: true }), seeded(7));
  assert.deepEqual([...naturals.deck].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
  for (let round = 0; round < 20; round++) {
    const last = naturals.deck.at(-1)!;
    for (let n = 0; n < 7; n++) naturals.next();
    assert.notEqual(naturals.deck[0], last); assert.equal(naturals.index, 0);
  }
  const empty = new FindAllSession(core, core.normalize({ strings: [], frets: [] }));
  assert.equal(empty.current(), null); assert.deepEqual(empty.answers(), []); assert.equal(empty.complete(), null);
  empty.toggle({ string: 1, fret: 0 } as Position); empty.next(); assert.equal(empty.selected.size, 0);
  assert.equal(create(resolveInstrument('guitar')).normalize({ mode: 'find-all' }).mode, 'find-all');
  assert.equal(create(resolveInstrument('guitar')).normalize({ mode: 'find-some' }).mode, 'forward');
});

test('note choices hold four distinct pitch classes with the answer exactly once',()=>{
  for (let pc = 0; pc < 12; pc++) for (let seed = 1; seed < 40; seed++) {
    const choices = pitchClassChoices(pc, seeded(seed));
    assert.equal(choices.length, 4); assert.equal(new Set(choices).size, 4);
    assert.equal(choices.filter(c => c === pc).length, 1);
    assert.equal(new Set(choices.map(c => pitchClassLabel(c, 'both'))).size, 4);
  }
  assert.equal(pitchClassLabel(1, 'both'), 'C♯ / D♭'); assert.equal(pitchClassLabel(1, 'flat'), 'D♭'); assert.equal(pitchClassLabel(4, 'both'), 'E');
});

test('note entry builds a spelled name and either common spelling is correct',()=>{
  let entry = emptyEntry();
  assert.equal(noteEntryKey(entry, 'ArrowUp'), null);
  entry = noteEntryKey(entry, 'd')!; entry = noteEntryKey(entry, 'ArrowDown')!; assert.equal(entryName(entry), 'D♭');
  entry = noteEntryKey(entry, 'ArrowDown')!; entry = noteEntryKey(entry, 'ArrowDown')!; assert.equal(entryName(entry), 'D♭♭');
  entry = noteEntryKey(entry, 'F')!; assert.equal(entryName(entry), 'F');
  for (let n = 0; n < 4; n++) entry = noteEntryKey(entry, 'ArrowUp')!;
  assert.equal(entryName(entry), 'F♯♯'); assert.equal(noteEntryKey(entry, 'Enter'), null); assert.equal(noteEntryKey(entry, '1'), null);
  assert.equal(checkPitchClassName('C♯', 1), 'correct'); assert.equal(checkPitchClassName('D♭', 1), 'correct');
  assert.equal(checkPitchClassName('B♯', 0), 'spelling'); assert.equal(checkPitchClassName('F♭', 4), 'spelling');
  assert.equal(checkPitchClassName('D', 0), 'wrong'); assert.equal(checkPitchClassName('E', 4), 'correct');
});

test('octave-free decks avoid asking the same pitch class twice in a row',()=>{
  const register: [number, number] = [40, 64];
  const any = (string: number, fret: number, midi: number): PlayTarget => ({ string, fret, midi, note: '', accept: { kind: 'pitch-class', pitchClasses: [midi % 12], register } });
  const targets = [any(6, 0, 40), any(4, 2, 52), any(1, 0, 64), any(5, 0, 45), any(3, 2, 57), any(4, 0, 50)];
  for (let seed = 1; seed < 30; seed++) {
    const session = new PerformanceSession(targets, { toleranceCents: 10, holdMs: 350, referenceHz: 440 }, seeded(seed));
    const keys = session.deck.map(t => t.midi % 12);
    // Three E targets and three others: alternation is always possible.
    for (let i = 1; i < keys.length; i++) assert.notEqual(keys[i], keys[i-1], `seed ${seed}: ${keys}`);
  }
});
