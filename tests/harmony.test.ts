import test from 'node:test';
import assert from 'node:assert/strict';
import { chords, tonesFor, pitchOf } from '../src/domain/music/theory';
import {
  chordTones, toneByRole, chordName, parseChordSymbol, transpose, intervalIds, intervalDegree, intervalSemitones,
  diatonicSevenths, transposeProgression, samePitchClass, isSpelledNote, type ChordSymbol, type IntervalId,
} from '../src/domain/music/harmony';

const standardRoots = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const names = (root: string, quality: string) => chordTones({ root, quality }).map(t => t.name);
const letterIndex = (note: string) => 'CDEFGAB'.indexOf(note[0]);
const mod = (n: number, m = 12) => (n % m + m) % m;

test('chord tones match theory for every quality and standard root',()=>{
  for (const pattern of chords) for (const root of standardRoots) {
    const expected = tonesFor(root, pattern).map(t => ({ degree: t.degree, name: t.name, pitchClass: t.pitch }));
    assert.deepEqual(chordTones({ root, quality: pattern.id }), expected, `${root} ${pattern.id}`);
  }
});

test('hand-checked chord spellings',()=>{
  const table: [string, string, string][] = [
    ['E♭', 'dom7', 'E♭ G B♭ D♭'], ['F♯', 'half-dim', 'F♯ A C E'], ['C', 'dim7', 'C E♭ G♭ B♭♭'], ['A♭', 'maj7', 'A♭ C E♭ G'],
    ['B', 'dom7', 'B D♯ F♯ A'], ['D', 'min7', 'D F A C'], ['G', 'dom7', 'G B D F'], ['C', 'maj7', 'C E G B'],
    ['D♭', 'maj7', 'D♭ F A♭ C'], ['E', 'min7', 'E G B D'], ['F', 'min6', 'F A♭ C D'], ['B♭', 'minmaj7', 'B♭ D♭ F A'],
    ['C', 'aug', 'C E G♯'], ['B', 'dim', 'B D F'], ['G', 'sus4', 'G C D'], ['A', 'sus2', 'A B E'], ['E', '7sus4', 'E A B D'],
    ['F♯', 'nine', 'F♯ A♯ C♯ E G♯'], ['A♭', 'maj9', 'A♭ C E♭ G B♭'], ['B', 'min9', 'B D F♯ A C♯'], ['D', 'six', 'D F♯ A B'],
    ['E', 'add9', 'E G♯ B F♯'], ['B', 'dim7', 'B D F A♭'], ['E♯', 'half-dim', 'E♯ G♯ B D♯'], ['C♭', 'maj7', 'C♭ E♭ G♭ B♭'],
  ];
  for (const [root, quality, expected] of table) assert.equal(names(root, quality).join(' '), expected, `${root} ${quality}`);
});

test('degree roles exist only where the chord formula has them',()=>{
  for (const quality of ['sus2', 'sus4', '7sus4']) for (const root of standardRoots) assert.equal(toneByRole({ root, quality }, 'third'), null, quality);
  for (const quality of ['six', 'min6', 'major', 'minor', 'dim', 'aug', 'add9']) for (const root of standardRoots) assert.equal(toneByRole({ root, quality }, 'seventh'), null, quality);
  assert.deepEqual(toneByRole({ root: 'C', quality: 'dim7' }, 'seventh'), { degree: '♭♭7', name: 'B♭♭', pitchClass: 9 });
  assert.deepEqual(toneByRole({ root: 'C', quality: 'aug' }, 'fifth'), { degree: '♯5', name: 'G♯', pitchClass: 8 });
  assert.equal(toneByRole({ root: 'G', quality: 'dom7' }, 'third')!.name, 'B');
  assert.equal(toneByRole({ root: 'G', quality: 'dom7' }, 'seventh')!.name, 'F');
  assert.equal(toneByRole({ root: 'D', quality: 'min7' }, 'third')!.name, 'F');
  assert.equal(toneByRole({ root: 'E♭', quality: 'min7' }, 'seventh')!.name, 'D♭');
  assert.equal(toneByRole({ root: 'D', quality: 'min9' }, 'ninth')!.name, 'E');
  assert.equal(toneByRole({ root: 'D', quality: 'min7' }, 'ninth'), null);
  assert.equal(toneByRole({ root: 'C', quality: 'six' }, 'sixth')!.name, 'A');
  assert.equal(toneByRole({ root: 'C', quality: 'sus4' }, 'fourth')!.name, 'F');
  for (const pattern of chords) for (const root of standardRoots) assert.equal(toneByRole({ root, quality: pattern.id }, 'root')!.name, root);
});

test('intervals keep letter distance and semitones in both directions',()=>{
  for (const root of standardRoots) for (const id of intervalIds) {
    const number = Number(/\d+$/.exec(intervalDegree(id))![0]), semitones = intervalSemitones(id);
    const up = transpose(root, intervalDegree(id)), down = transpose(root, intervalDegree(id), 'down');
    assert.ok(isSpelledNote(up) && isSpelledNote(down), `${root} ${id}`);
    assert.equal(pitchOf(up), mod(pitchOf(root) + semitones), `${root} up ${id}`);
    assert.equal(pitchOf(down), mod(pitchOf(root) - semitones), `${root} down ${id}`);
    assert.equal(letterIndex(up), mod(letterIndex(root) + number - 1, 7), `${root} up ${id} letter`);
    assert.equal(letterIndex(down), mod(letterIndex(root) - (number - 1), 7), `${root} down ${id} letter`);
  }
  const semitones: [IntervalId, number][] = [['m2',1],['M3',4],['A4',6],['d5',6],['P5',7],['A5',8],['m7',10],['P8',12],['m9',13],['A9',15],['P11',17],['A11',18],['m13',20],['M13',21]];
  for (const [id, expected] of semitones) assert.equal(intervalSemitones(id), expected, id);
  const table: [string, IntervalId, 'up'|'down', string][] = [
    ['E','m3','up','G'], ['B♭','m3','up','D♭'], ['F','A4','up','B'], ['B','d5','up','F'], ['A','M6','up','F♯'],
    ['D','m7','down','E'], ['C','M3','down','A♭'], ['C','M9','up','D'], ['E','m9','up','F'], ['C','A11','up','F♯'],
    ['G','m13','up','E♭'], ['F','P4','up','B♭'], ['A','m2','up','B♭'], ['C','P5','down','F'], ['E','m2','down','D♯'],
    ['F','M2','down','E♭'], ['B♭','d5','up','F♭'], ['C','A5','up','G♯'], ['G','A9','up','A♯'], ['E♭','M7','up','D'],
  ];
  for (const [root, id, direction, expected] of table) assert.equal(transpose(root, intervalDegree(id), direction), expected, `${root} ${direction} ${id}`);
  assert.notEqual(transpose('C', intervalDegree('A4')), transpose('C', intervalDegree('d5')));
  assert.ok(samePitchClass(transpose('C', intervalDegree('A4')), transpose('C', intervalDegree('d5'))));
});

test('diatonic seventh chords are spelled from the key with seven distinct letters',()=>{
  const majorKeys = standardRoots, minorKeys = ['A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D', 'G', 'C', 'F', 'B♭', 'E♭'];
  for (const [mode, keys] of [['major', majorKeys], ['natural-minor', minorKeys], ['harmonic-minor', minorKeys]] as const) for (const tonic of keys) {
    const chordsInKey = diatonicSevenths(tonic, mode);
    assert.equal(new Set(chordsInKey.map(c => c.root[0])).size, 7, `${tonic} ${mode}`);
    assert.equal(chordsInKey[0].root, tonic);
  }
  const symbols = (tonic: string, mode: Parameters<typeof diatonicSevenths>[1]) => diatonicSevenths(tonic, mode).map(c => c.chord ? chordName(c.chord) : null);
  assert.deepEqual(symbols('C', 'major'), ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7♭5']);
  assert.deepEqual(diatonicSevenths('C', 'major').map(c => c.roman), ['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø7']);
  assert.deepEqual(diatonicSevenths('C', 'major').map(c => c.func), ['T', 'SD', 'T', 'SD', 'D', 'T', 'D']);
  assert.deepEqual(symbols('A', 'natural-minor'), ['Am7', 'Bm7♭5', 'Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7']);
  assert.deepEqual(diatonicSevenths('A', 'natural-minor').map(c => c.roman), ['i7', 'iiø7', '♭IIImaj7', 'iv7', 'v7', '♭VImaj7', '♭VII7']);
  assert.deepEqual(diatonicSevenths('A', 'natural-minor').map(c => c.func), ['T', 'SD', null, 'SD', null, null, null]);
  const harmonic = diatonicSevenths('C', 'harmonic-minor');
  assert.equal(chordName(harmonic[4].chord!), 'G7'); assert.equal(harmonic[4].func, 'D');
  assert.equal(chordName(harmonic[6].chord!), 'Bdim7'); assert.equal(harmonic[6].roman, 'vii°7');
  assert.equal(chordName(harmonic[0].chord!), 'Cm(maj7)');
  assert.equal(harmonic[2].chord, null); assert.equal(harmonic[2].roman, '♭III+maj7'); assert.equal(harmonic[2].root, 'E♭');
  assert.equal(chordName(diatonicSevenths('F♯', 'major')[6].chord!), 'E♯m7♭5');
  assert.equal(chordName(diatonicSevenths('G♭', 'major')[3].chord!), 'C♭maj7');
  assert.equal(chordName(diatonicSevenths('G♯', 'harmonic-minor')[4].chord!), 'D♯7');
  assert.equal(diatonicSevenths('G♯', 'harmonic-minor')[6].root, 'F♯♯');
});

test('chord symbols parse catalog suffixes and common alternate spellings',()=>{
  const table: [string, ChordSymbol][] = [
    ['Dm7', { root: 'D', quality: 'min7' }], ['D-7', { root: 'D', quality: 'min7' }], ['Dmin7', { root: 'D', quality: 'min7' }],
    ['Dø', { root: 'D', quality: 'half-dim' }], ['Dm7b5', { root: 'D', quality: 'half-dim' }], ['D°7', { root: 'D', quality: 'dim7' }],
    ['Ddim7', { root: 'D', quality: 'dim7' }], ['CΔ7', { root: 'C', quality: 'maj7' }], ['CM7', { root: 'C', quality: 'maj7' }],
    ['Cmaj7', { root: 'C', quality: 'maj7' }], ['Bb7', { root: 'B♭', quality: 'dom7' }], ['F#m7', { root: 'F♯', quality: 'min7' }],
    ['C7sus4', { root: 'C', quality: '7sus4' }], ['Cm(maj7)', { root: 'C', quality: 'minmaj7' }], ['CmMaj7', { root: 'C', quality: 'minmaj7' }],
    ['Cb', { root: 'C♭', quality: 'major' }], ['C', { root: 'C', quality: 'major' }], ['Am', { root: 'A', quality: 'minor' }],
    [' E♭maj9 ', { root: 'E♭', quality: 'maj9' }], ['G9', { root: 'G', quality: 'nine' }], ['C6', { root: 'C', quality: 'six' }],
    ['Caug', { root: 'C', quality: 'aug' }], ['C+', { root: 'C', quality: 'aug' }], ['Csus', { root: 'C', quality: 'sus4' }],
  ];
  for (const [text, expected] of table) assert.deepEqual(parseChordSymbol(text), expected, text);
  for (const text of ['Cmaj13', 'H7', '', 'c7', 'Cb♯7']) assert.ok('error' in parseChordSymbol(text), text);
  for (const pattern of chords) for (const root of standardRoots) {
    const chord = { root, quality: pattern.id };
    assert.deepEqual(parseChordSymbol(chordName(chord)), chord, chordName(chord));
  }
});

test('progressions transpose with correct spelling',()=>{
  const iiVI: ChordSymbol[] = [{ root: 'D', quality: 'min7' }, { root: 'G', quality: 'dom7' }, { root: 'C', quality: 'maj7' }];
  assert.deepEqual(transposeProgression(iiVI, 'C', 'F♯').map(chordName), ['G♯m7', 'C♯7', 'F♯maj7']);
  assert.deepEqual(transposeProgression(iiVI, 'C', 'G♭').map(chordName), ['A♭m7', 'D♭7', 'G♭maj7']);
  assert.deepEqual(transposeProgression(iiVI, 'C', 'B♭').map(chordName), ['Cm7', 'F7', 'B♭maj7']);
  for (const tonic of standardRoots) {
    const key = diatonicSevenths(tonic, 'major');
    assert.deepEqual(transposeProgression(iiVI, 'C', tonic), [key[1].chord, key[4].chord, key[0].chord], tonic);
  }
  const minor: ChordSymbol[] = [{ root: 'D', quality: 'half-dim' }, { root: 'G', quality: 'dom7' }, { root: 'C', quality: 'min7' }];
  assert.deepEqual(transposeProgression(minor, 'C', 'A').map(chordName), ['Bm7♭5', 'E7', 'Am7']);
  assert.equal(toneByRole(transposeProgression(minor, 'C', 'A')[1], 'third')!.name, 'G♯');
});
