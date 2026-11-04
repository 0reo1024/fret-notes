import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../src/domain/instruments/core';
import { resolveInstrument, defaultTuning } from '../src/domain/instruments/profiles';
import { chordTones, intervalSemitones, type IntervalId } from '../src/domain/music/harmony';
import { pitchOf } from '../src/domain/music/theory';
import { intervalQuestions, boardIntervalQuestions, relation, skipForStandard, intervalStages } from '../src/domain/training/interval-questions';
import { arpeggioQuestions, resolveArpeggio, stringSets, arpeggioQualities, maximumSpan } from '../src/domain/training/arpeggio';
import { keyQuestions, minorTonics } from '../src/domain/training/key-questions';
import { ToneDrill, checkName, toneChoices, type DrillQuestion } from '../src/domain/training/tone-questions';

const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const letter = (note: string) => 'CDEFGAB'.indexOf(note[0]);
const mod = (n: number, m = 12) => (n % m + m) % m;

test('interval questions keep letter steps and semitones, and standard roots skip unusual spellings',()=>{
  for (const roots of ['standard', 'extended'] as const) for (const q of intervalQuestions({ stage: 4, direction: 'both', roots, sharpSix: true })) {
    const [, , id, direction] = q.itemId.split(':') as [string, string, IntervalId, 'up' | 'down'];
    const sign = direction === 'up' ? 1 : -1, number = Number(/\d+$/.exec(q.answers[0].degree)![0]);
    assert.equal(q.answers[0].pitchClass, mod(pitchOf(q.root) + sign * intervalSemitones(id)), q.itemId);
    assert.equal(letter(q.answers[0].name), mod(letter(q.root) + sign * (number - 1), 7), q.itemId);
    if (roots === 'standard') assert.ok(!skipForStandard(id, q.answers[0].name), q.itemId);
  }
  const find = (roots: 'standard' | 'extended', id: string) => intervalQuestions({ stage: 3, direction: 'up', roots, sharpSix: true }).find(q => q.itemId === id);
  assert.equal(find('standard', 'iv:B♭:d5:up'), undefined);
  assert.equal(find('extended', 'iv:B♭:d5:up')!.answers[0].name, 'F♭');
  assert.equal(find('standard', 'iv:F:A4:up')!.answers[0].name, 'B'); assert.equal(find('standard', 'iv:B:d5:up')!.answers[0].name, 'F');
  assert.equal(find('standard', 'iv:E♭:M3:up')!.ask, '長3度上 ?');
  assert.equal(intervalQuestions({ stage: 1, direction: 'up', roots: 'standard', sharpSix: true }).length, 12 * intervalStages[1].length);
  assert.equal(find('standard', 'iv:F♯:M7:up')!.answers[0].name, 'E♯'); assert.equal(find('standard', 'iv:D♭:m3:up')!.answers[0].name, 'F♭');
});

test('fretboard interval questions use exact pitches and shapes, including the G–B string offset',()=>{
  const core = create(resolveInstrument('guitar')), scope = core.normalize();
  for (const condition of ['same', 'adjacent', 'window'] as const) for (const q of boardIntervalQuestions(core, scope, { stage: 2, direction: 'both' }, condition, 'guitar')) {
    const [, , id, direction] = q.itemId.split(':') as [string, string, IntervalId, 'up' | 'down'];
    const target = core.midi(q.rootPosition!) + (direction === 'up' ? 1 : -1) * intervalSemitones(id);
    for (const p of q.positions!) {
      assert.equal(core.midi(p), target, q.itemId);
      if (condition === 'same') assert.equal(p.string, q.rootPosition!.string);
      if (condition === 'adjacent') assert.equal(Math.abs(p.string - q.rootPosition!.string), 1);
      if (condition === 'window') assert.ok(Math.abs(p.fret - q.rootPosition!.fret) <= 4);
    }
  }
  const adjacent = boardIntervalQuestions(core, scope, { stage: 1, direction: 'up' }, 'adjacent', 'guitar');
  const fromG = adjacent.find(q => q.rootPosition!.string === 3 && q.rootPosition!.fret === 0 && q.ask.startsWith('長3度'))!;
  assert.deepEqual(fromG.positions, [{ string: 2, fret: 0 }, { string: 4, fret: 9 }]); assert.equal(fromG.hint, '1本高い弦の同じフレット ／ 1本低い弦の9フレット上');
  const fromD = adjacent.find(q => q.rootPosition!.string === 4 && q.rootPosition!.fret === 2 && q.ask.startsWith('長3度'))!;
  assert.deepEqual(fromD.positions![0], { string: 3, fret: 1 }); assert.ok(fromD.hint!.startsWith('1本高い弦の1フレット下（ナット側）'));
  // Other neighbouring strings are a fourth apart, so a major 3rd sits one fret lower; G–B is a major 3rd, so the same fret.
  const fromA = adjacent.find(q => q.rootPosition!.string === 5 && q.rootPosition!.fret === 3 && q.ask.startsWith('長3度'))!;
  assert.ok(fromA.positions!.some(p => p.string === 4 && p.fret === 2));
  assert.equal(relation({ string: 2, fret: 5 }, { string: 4, fret: 7 }), '2本低い弦の2フレット上');
  assert.equal(fromG.title, '3弦 0F（G）');
});

test('arpeggio shapes play the inversion in order on adjacent strings, rising, within reach, in any tuning',()=>{
  assert.deepEqual(stringSets(6, 3), [[3, 2, 1], [4, 3, 2], [5, 4, 3], [6, 5, 4]]);
  assert.deepEqual(stringSets(6, 4), [[4, 3, 2, 1], [5, 4, 3, 2], [6, 5, 4, 3]]);
  assert.deepEqual(stringSets(4, 3), [[3, 2, 1], [4, 3, 2]]); assert.deepEqual(stringSets(5, 4), [[4, 3, 2, 1], [5, 4, 3, 2]]);
  const profiles = [resolveInstrument('guitar'), resolveInstrument('guitar', { ...defaultTuning(), selectedTuningId: 'drop-d' }), resolveInstrument('bass5', { ...defaultTuning(), selectedTuningId: 'drop-a' })];
  for (const profile of profiles) {
    const core = create(profile);
    const questions = arpeggioQuestions(core, { chords: 'both', inversions: 'all', direction: 'up', sharpSix: true }, seeded(9));
    assert.ok(questions.length > 100, profile.tuning.name);
    for (const q of questions) {
      const [, quality, root, inv] = q.itemId.split(':'), tones = chordTones({ root, quality }), n = Number(inv.slice(3));
      const order = [...tones.slice(n), ...tones.slice(0, n)];
      assert.deepEqual(q.answers, order, q.itemId);
      assert.deepEqual(q.positions!.map(p => core.pitch(p)), order.map(t => t.pitchClass));
      assert.ok(q.midis!.every((m, i) => i === 0 || m > q.midis![i-1]), q.itemId);
      const frets = q.positions!.map(p => p.fret); assert.ok(Math.max(...frets) - Math.min(...frets) <= maximumSpan, q.itemId);
      assert.deepEqual(q.positions!.map(p => p.string), q.itemId.split(':')[4].slice(1).split('').map(Number));
    }
    const qualities = new Set(questions.map(q => q.itemId.split(':')[1]));
    // One note per string within a five-fret window: every triad fits, but some closed 7th shapes do not (guitar dim7; most 7ths on a bass in fourths).
    for (const quality of arpeggioQualities.triads) assert.ok(qualities.has(quality), `${profile.tuning.name} ${quality}`);
    if (profile.id === 'guitar') assert.deepEqual(arpeggioQualities.sevenths.filter(quality => !qualities.has(quality)), ['dim7']);
  }
  const core = create(resolveInstrument('guitar'));
  // A minor on the top three strings: A (G string 2F), C (B string 1F), E (open high E).
  assert.deepEqual(resolveArpeggio(core, [9, 0, 4], [3, 2, 1], [0, 2]), [[{ string: 3, fret: 2 }, { string: 2, fret: 1 }, { string: 1, fret: 0 }]]);
  assert.deepEqual(resolveArpeggio(core, [9, 0, 4], [3, 2, 1], [5, 8]), []);
  // Second inversion E–A–C on 4-3-2: E (D string 2F), A (G string 2F), C (B string 1F).
  assert.deepEqual(resolveArpeggio(core, [4, 9, 0], [4, 3, 2], [0, 3]), [[{ string: 4, fret: 2 }, { string: 3, fret: 2 }, { string: 2, fret: 1 }]]);
  const updown = arpeggioQuestions(core, { chords: 'triads', inversions: 'root', direction: 'updown', sharpSix: true }, seeded(2))[0];
  assert.equal(updown.answers.length, 5); assert.deepEqual(updown.midis!.slice(3), updown.midis!.slice(0, 2).reverse());
  const down = arpeggioQuestions(core, { chords: 'triads', inversions: 'root', direction: 'down', sharpSix: true }, seeded(2))[0];
  assert.ok(down.midis!.every((m, i) => i === 0 || m < down.midis![i-1]));
});

test('key questions name diatonic chords, functions and secondary dominants with spelled roots',()=>{
  const all = keyQuestions({ types: 'all', modes: 'both', sharpSix: true });
  const ask = (title: string, question: string) => all.find(q => q.title === title && q.ask === question)!.answers[0].name;
  assert.equal(ask('E♭ メジャー', 'ii7 は?'), 'Fm7');
  assert.equal(ask('A ナチュラルマイナー', '♭VImaj7 は?'), 'Fmaj7');
  assert.equal(ask('A ナチュラルマイナー', 'v7 は?'), 'Em7');
  assert.equal(ask('A ハーモニックマイナー', 'V7 は?'), 'E7');
  assert.equal(ask('F♯ メジャー', 'viiø7 は?'), 'E♯m7♭5');
  assert.equal(ask('G7', 'C メジャーでの機能は?'), 'D（ドミナント）');
  assert.equal(ask('Dm7', 'C メジャーでの機能は?'), 'SD（サブドミナント）');
  assert.equal(ask('E7', 'A ハーモニックマイナーでの機能は?'), 'D（ドミナント）');
  assert.ok(!all.some(q => q.title === 'Em7' && q.ask.startsWith('A ナチュラルマイナー')), 'natural minor v7 has no function label');
  assert.deepEqual(['ii', 'iii', 'IV', 'V', 'vi'].map(r => ask('C メジャー', `V7/${r} は?`)), ['A7', 'B7', 'C7', 'D7', 'E7']);
  assert.equal(ask('D メジャー', 'V7/V は?'), 'E7'); assert.equal(ask('F♯ メジャー', 'V7/iii は?'), 'E♯7');
  assert.ok(!all.some(q => q.ask.includes('+maj7')));
  assert.equal(new Set(all.filter(q => q.title.endsWith('マイナー')).map(q => q.title.split(' ')[0])).size, minorTonics.length);
  for (const q of all) for (let seed = 1; seed < 4; seed++) {
    const choices = toneChoices(q, 0, seeded(seed));
    assert.equal(new Set(choices).size, choices.length, q.itemId); assert.ok(choices.length >= 3);
    assert.equal(choices.filter(c => checkName(q, 0, c, false).result === 'correct').length, 1, q.itemId);
  }
});

test('ordered drills restart or wait on a wrong note and record a finished sequence with mistakes as wrong',()=>{
  const q: DrillQuestion = { itemId: 'arp:test', title: 'C', ask: '', root: 'C', related: [], ordered: true, answers: [
    { degree: 'R', name: 'C', pitchClass: 0 }, { degree: '3', name: 'E', pitchClass: 4 }, { degree: '5', name: 'G', pitchClass: 7 }] };
  const clean = new ToneDrill([q], null);
  assert.equal(clean.answerOrdered(true, 'C', 1), 'partial'); assert.equal(clean.answerOrdered(true, 'E', 2), 'partial');
  assert.equal((clean.answerOrdered(true, 'G', 3) as { result: string }).result, 'correct');
  const restart = new ToneDrill([q], null);
  restart.answerOrdered(true, 'C', 1); assert.equal(restart.answerOrdered(false, 'F', 2), 'restart'); assert.equal(restart.step, 0);
  ['C', 'E', 'G'].forEach((n, i) => restart.answerOrdered(true, n, 3 + i));
  assert.equal(restart.last!.result, 'wrong'); assert.equal(restart.last!.errorKind, 'restarts:1');
  const wait = new ToneDrill([q], null);
  wait.answerOrdered(true, 'C', 1); wait.answerOrdered(false, 'F', 2, 'wait'); assert.equal(wait.step, 1);
  wait.answerOrdered(true, 'E', 3, 'wait'); assert.equal((wait.answerOrdered(true, 'G', 4, 'wait') as { result: string }).result, 'wrong');
  const label: DrillQuestion = { itemId: 'key:x', title: 'C メジャー', ask: 'ii7 は?', root: 'D', related: [], labels: true, answers: [{ degree: 'ii7', name: 'Dm7', pitchClass: 2 }], choicePool: ['Dm7', 'D7', 'Em7'] };
  assert.equal(checkName(label, 0, 'Dm7', false).result, 'correct'); assert.equal(checkName(label, 0, 'D7', false).result, 'wrong');
});
