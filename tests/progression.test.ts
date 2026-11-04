import test from 'node:test';
import assert from 'node:assert/strict';
import { chordName, chordTones, parseChordSymbol, toneByRole } from '../src/domain/music/harmony';
import {
  library, materialize, parseProgression, formatProgression, stageTargets, ninthFromKey, ProgressionRun, decodeStored, fromStored, flatten,
  type ProgressionChord,
} from '../src/domain/training/progression';
import { minorTonics } from '../src/domain/training/key-questions';
import { heldInto } from '../src/domain/practice/note-events';

const majorTonics = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const symbols = (id: string, tonic: string) => materialize(library.find(e => e.id === id)!, tonic).bars.map(bar => bar.map(c => c.symbol).join(' '));

test('every library progression spells correctly in every key and round-trips through chord symbols',()=>{
  for (const entry of library) for (const tonic of entry.mode === 'major' ? majorTonics : minorTonics) {
    const p = materialize(entry, tonic);
    assert.equal(p.romanNumerals!.length, flatten(p).length);
    for (const chord of flatten(p)) {
      assert.deepEqual(parseChordSymbol(chordName(chord)), { root: chord.root, quality: chord.quality }, `${entry.id} ${tonic} ${chord.symbol}`);
      assert.equal(chordTones(chord).length > 2, true);
    }
    assert.deepEqual(parseProgression(formatProgression(p.bars)), p.bars, `${entry.id} ${tonic}`);
  }
});

test('library examples: minor ii–V–i uses the harmonic-minor V7, and keys keep their spelling',()=>{
  assert.deepEqual(symbols('minor-ii-v-i', 'C'), ['Dm7♭5', 'G7', 'Cm7', 'Cm7']);
  assert.equal(toneByRole({ root: 'G', quality: 'dom7' }, 'third')!.name, 'B');
  assert.deepEqual(symbols('major-ii-v-i', 'F♯').slice(0, 3), ['G♯m7', 'C♯7', 'F♯maj7']);
  assert.deepEqual(symbols('major-ii-v-i', 'G♭').slice(0, 3), ['A♭m7', 'D♭7', 'G♭maj7']);
  assert.deepEqual(symbols('blues-jazz', 'F'), ['F7', 'B♭7', 'F7', 'Cm7 F7', 'B♭7', 'Bdim7', 'F7', 'Am7 D7', 'Gm7', 'C7', 'F7 D7', 'Gm7 C7']);
  assert.deepEqual(symbols('blues-basic', 'A'), ['A7', 'D7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7']);
  assert.deepEqual(symbols('secondary-i-ii7-ii-v-i', 'C'), ['Cmaj7', 'D7', 'Dm7', 'G7', 'Cmaj7']);
  assert.deepEqual(symbols('minor-i-bvi-bvii', 'A'), ['Am7', 'Fmaj7', 'G7', 'Am7']);
  assert.equal(materialize(library.find(e => e.id === 'blues-jazz')!, 'F').bars[3][0].beats, 2);
});

test('progression text parses bars, splits beats, accepts alternate symbols and reports where it fails',()=>{
  const bars = parseProgression('D-7 G7 | CΔ7 | Bb7 |') as ProgressionChord[][];
  assert.deepEqual(bars.map(bar => bar.map(c => `${c.symbol}:${c.beats}`)), [['Dm7:2', 'G7:2'], ['Cmaj7:4'], ['B♭7:4']]);
  assert.equal(formatProgression(bars), 'Dm7 G7 | Cmaj7 | B♭7 |');
  assert.deepEqual(parseProgression('Cmaj7 | Dm7 Xyz |'), { error: '2小節目の2番目「Xyz」は未対応のコードです', bar: 2, index: 2 });
  assert.equal((parseProgression('C D E F G |') as { bar: number }).bar, 1);
  assert.ok('error' in parseProgression('   '));
  assert.ok('error' in parseProgression('C | | D'));
  assert.deepEqual((parseProgression('C G Am | F |', 3) as ProgressionChord[][])[0].map(c => c.beats), [1, 1, 1]);
});

test('stage targets substitute missing tones and only add ninths from the formula or the key',()=>{
  const sus = stageTargets({ root: 'G', quality: 'sus4' }, 'third');
  assert.deepEqual(sus.tones.map(t => t.name), ['C']); assert.ok(sus.substituted);
  const six = stageTargets({ root: 'C', quality: 'six' }, 'seventh');
  assert.deepEqual(six.tones.map(t => t.name), ['E']); assert.ok(six.substituted);
  assert.deepEqual(stageTargets({ root: 'D', quality: 'min7' }, 'guide').tones.map(t => t.name), ['F', 'C']);
  assert.equal(stageTargets({ root: 'D', quality: 'min7' }, 'guide').need, 'all');
  assert.equal(stageTargets({ root: 'C', quality: 'dim7' }, 'seventh').tones[0].name, 'B♭♭');
  assert.deepEqual(stageTargets({ root: 'D', quality: 'min7' }, 'with-tensions').tones.map(t => t.degree), ['R', '♭3', '5', '♭7']);
  const minor = { tonic: 'C', mode: 'minor' as const };
  assert.deepEqual(ninthFromKey({ root: 'G', quality: 'dom7' }, minor), { degree: '♭9', name: 'A♭', pitchClass: 8 });
  assert.deepEqual(ninthFromKey({ root: 'D', quality: 'half-dim' }, minor), { degree: '♭9', name: 'E♭', pitchClass: 3 });
  const major = { tonic: 'C', mode: 'major' as const };
  assert.equal(ninthFromKey({ root: 'D', quality: 'min7' }, major)!.name, 'E');
  assert.equal(ninthFromKey({ root: 'E', quality: 'min7' }, major)!.degree, '♭9');
  assert.equal(ninthFromKey({ root: 'A', quality: 'dom7' }, major), null);
  assert.equal(stageTargets({ root: 'G', quality: 'dom7' }, 'with-tensions', minor).tones.at(-1)!.name, 'A♭');
  assert.equal(stageTargets({ root: 'G', quality: 'nine' }, 'with-tensions', major).tones.filter(t => t.degree === '9').length, 1);
});

test('step runs advance on the target, mark mistakes, need both guide tones and stop after the repeats',()=>{
  const p = materialize(library.find(e => e.id === 'major-ii-v-i')!, 'C');
  const run = new ProgressionRun(p, 'third', 1);
  assert.equal(run.chord.symbol, 'Dm7'); assert.equal(run.nextChord!.symbol, 'G7');
  assert.equal(run.answer(5, 800), 'hit'); assert.equal(run.chord.symbol, 'G7');
  assert.equal(run.answer(10, 300), 'miss'); assert.equal(run.answer(11, 900), 'hit');
  assert.deepEqual(run.results.map(r => [r.status, r.mistakes]), [['hit', 0], ['late', 1]]);
  run.skip(); assert.equal(run.statusOf(2), 'skipped');
  assert.equal(run.answer(4, 500), 'hit'); assert.equal(run.phase, 'finished'); assert.equal(run.nextChord, null);
  const guide = new ProgressionRun(p, 'guide', null);
  assert.equal(guide.answer(5, 100), 'partial'); assert.equal(guide.answer(5, 120), 'repeat'); assert.equal(guide.answer(0, 300), 'hit');
  guide.move(2); assert.equal(guide.index, 3); guide.move(1); assert.equal(guide.index, 0);
  for (let n = 0; n < 4; n++) guide.skip();
  assert.equal(guide.pass, 2); assert.equal(guide.phase, 'playing');
  guide.pause(); assert.equal(guide.answer(5, 1), null); guide.resume(); assert.equal(guide.answer(5, 1), 'partial');
});

test('a note held across the change counts for the next chord only while still sounding',()=>{
  const held = { midi: 65, startMs: 1000, endMs: null, cents: 0 };
  assert.equal(heldInto(held, 2000, 2150, 200), false);
  assert.equal(heldInto(held, 2000, 2200, 200), true);
  assert.equal(heldInto({ ...held, endMs: 1900 }, 2000, 2300, 200), false);
  assert.equal(heldInto({ ...held, startMs: 2050 }, 2000, 2300, 200), false);
  assert.equal(heldInto(null, 2000, 2300, 200), false);
  // Dm7 → G7 at the 3rd/7th stage: F is Dm7's 3rd and G7's 7th, so holding it completes nothing until G7's 3rd stage says otherwise.
  assert.ok(stageTargets({ root: 'G', quality: 'dom7' }, 'seventh').tones.some(t => t.pitchClass === 5));
});

test('stored user progressions are re-checked on load',()=>{
  const good = { id: 'user:abc', name: '枯葉っぽい', text: 'Cm7 F7 | B♭maj7 |', key: { tonic: 'B♭', mode: 'major' } };
  const list = decodeStored([good, { ...good, id: 'bad id' }, { ...good, id: 'user:x', text: 'Cm7 | Nope |' }, { ...good, id: 'user:y', name: ' ' }, null, 'text']);
  assert.deepEqual(list, [good]);
  const p = fromStored(list[0]);
  assert.equal(p.source, 'user'); assert.deepEqual(p.key, good.key);
  assert.deepEqual(flatten(p).map(c => c.symbol), ['Cm7', 'F7', 'B♭maj7']);
  assert.equal(decodeStored(Array.from({ length: 120 }, (_, i) => ({ ...good, id: `user:n${i}` }))).length, 100);
});
