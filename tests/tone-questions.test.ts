import test from 'node:test';
import assert from 'node:assert/strict';
import { toneByRole } from '../src/domain/music/harmony';
import { pitchOf } from '../src/domain/music/theory';
import { allQuestions, checkName, describePitchClass, makeQuestion, rootsFor, stageQualities, toneChoices, toneDeck, ToneDrill, type ToneConfig, type ToneMode } from '../src/domain/training/tone-questions';

const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const config = (mode: ToneMode, stage: ToneConfig['stage'] = 3): ToneConfig => ({ mode, stage, roots: 'standard', sharpSix: true });

test('questions match the chord formula for every stage, standard root and mode',()=>{
  for (const stage of ['triads', 1, 2, 3] as const) for (const mode of ['third', 'seventh', 'guide', 'all', 'ninth'] as const) {
    for (const question of allQuestions(config(mode, stage))) {
      assert.ok(stageQualities[stage].includes(question.chord.quality));
      assert.deepEqual(question.answers, question.roles.map(role => toneByRole(question.chord, role)), question.itemId);
      assert.ok(question.answers.every(a => a !== null && a.degree !== 'R'));
    }
  }
  const qualities = (mode: ToneMode, stage: ToneConfig['stage'] = 3) => new Set(allQuestions(config(mode, stage)).map(q => q.chord.quality));
  assert.ok(!qualities('seventh').has('six') && !qualities('seventh').has('min6'));
  assert.ok(!qualities('guide').has('six') && qualities('guide').has('dim7'));
  assert.equal(allQuestions(config('seventh', 'triads')).length, 0);
  assert.equal(allQuestions(config('ninth', 1)).length, 0);
  assert.deepEqual([...qualities('ninth')].sort(), ['maj9', 'min9', 'nine']);
  assert.equal(allQuestions(config('guide', 1)).length, 36);
  assert.equal(allQuestions({ ...config('third', 1), roots: 'extended' }).length, 51);
  assert.ok(rootsFor('standard', false).includes('G♭') && !rootsFor('standard', false).includes('F♯'));
  const dim7 = allQuestions(config('seventh', 2)).find(q => q.symbol === 'Cdim7')!;
  assert.deepEqual(dim7.answers, [{ degree: '♭♭7', name: 'B♭♭', pitchClass: 9 }]);
  assert.equal(makeQuestion({ root: 'G', quality: 'dom7' }, ['third', 'seventh']).itemId, 'ct:dom7:G:guide');
});

test('names are judged by pitch, with spelling slips and mix-ups classified',()=>{
  const q = makeQuestion({ root: 'E♭', quality: 'dom7' }, ['third']);
  assert.deepEqual(checkName(q, 0, 'G', false), { result: 'correct' });
  assert.deepEqual(checkName(q, 0, 'F♯♯', false), { result: 'spelling', errorKind: 'spelling' });
  assert.deepEqual(checkName(q, 0, 'F♯♯', true), { result: 'wrong', errorKind: 'spelling' });
  assert.deepEqual(checkName(q, 0, 'G♭', false), { result: 'wrong', errorKind: 'quality-confusion' });
  assert.deepEqual(checkName(q, 0, 'B♭', false), { result: 'wrong', errorKind: 'degree-confusion' });
  assert.deepEqual(checkName(q, 0, 'A', false), { result: 'wrong', errorKind: 'other' });
  const m7 = makeQuestion({ root: 'D', quality: 'min7' }, ['seventh']);
  assert.equal(checkName(m7, 0, 'C♯', false).errorKind, 'quality-confusion'); assert.equal(checkName(m7, 0, 'C', false).result, 'correct');
});

test('choices have four spellings with exactly one correct answer',()=>{
  for (const mode of ['third', 'seventh', 'all', 'ninth'] as const) for (const q of allQuestions({ ...config(mode), roots: 'extended' })) for (const strict of [false, true]) {
    const choices = toneChoices(q, 0, seeded(q.itemId.length), strict);
    assert.equal(choices.length, 4, q.itemId); assert.equal(new Set(choices).size, 4, q.itemId);
    assert.equal(choices.filter(c => checkName(q, 0, c, true).result === 'correct').length, 1, `${q.itemId} ${choices}`);
    if (!strict) assert.equal(new Set(choices.map(pitchOf)).size, 4, `${q.itemId} ${choices}`);
  }
  const g7 = toneChoices(makeQuestion({ root: 'G', quality: 'dom7' }, ['third']), 0, seeded(5));
  assert.ok(g7.includes('B') && g7.includes('B♭'), String(g7));
  for (let seed = 1; seed < 10; seed++) {
    const minor = toneChoices(makeQuestion({ root: 'D♭', quality: 'min7' }, ['third']), 0, seeded(seed));
    assert.ok(minor.includes('F♭') && minor.includes('F') && !minor.some(c => /♭♭|♯♯/.test(c)), String(minor));
  }
  assert.ok(toneChoices(makeQuestion({ root: 'C', quality: 'dim7' }, ['seventh']), 0, seeded(3)).includes('B♭'));
});

test('played or clicked pitches answer in any octave and order, and wrong pitches are described over the root',()=>{
  const guide = new ToneDrill([makeQuestion({ root: 'G', quality: 'dom7' }, ['third', 'seventh'])], null);
  assert.equal(guide.answerPitchClass(5, 'F', 900), 'partial'); assert.equal(guide.answerPitchClass(5, 'F', 1000), 'repeat');
  assert.equal(guide.answerPitchClass(11, 'B', 1400)!.valueOf().constructor, Object);
  assert.equal(guide.last!.result, 'correct'); assert.deepEqual(guide.last!.given, ['F', 'B']);
  const third = new ToneDrill([makeQuestion({ root: 'G', quality: 'dom7' }, ['third'])], null);
  const wrong = third.answerPitchClass(10, 'A♯ / B♭', 800);
  assert.ok(wrong && typeof wrong === 'object'); assert.equal(wrong.result, 'wrong'); assert.equal(wrong.errorKind, 'quality-confusion');
  assert.equal(describePitchClass({ root: 'G', quality: 'dom7' }, 10), '♯9');
  assert.equal(describePitchClass({ root: 'G', quality: 'dom7' }, 8), '♭9');
  assert.equal(describePitchClass({ root: 'G', quality: 'dom7' }, 5), '♭7');
  assert.equal(describePitchClass({ root: 'C', quality: 'min7' }, 3), '♭3');
  assert.equal(describePitchClass({ root: 'C', quality: 'dim7' }, 9), '♭♭7');
  const degree = new ToneDrill([makeQuestion({ root: 'G', quality: 'dom7' }, ['third'])], null);
  assert.equal((degree.answerPitchClass(2, 'D', 500) as { errorKind: string }).errorKind, 'degree-confusion');
});

test('typed guide answers go 3rd then 7th; a spelling slip on either marks the result',()=>{
  const q = makeQuestion({ root: 'G', quality: 'dom7' }, ['third', 'seventh']);
  const inOrder = new ToneDrill([q], null);
  assert.equal(inOrder.answerName('B', false, 500), 'partial'); assert.equal(inOrder.step, 1);
  assert.equal((inOrder.answerName('F', false, 900) as { result: string }).result, 'correct');
  const reversed = new ToneDrill([q], null);
  assert.equal((reversed.answerName('F', false, 500) as { errorKind: string }).errorKind, 'degree-confusion');
  const slipped = new ToneDrill([q], null);
  slipped.answerName('C♭', false, 400); assert.equal((slipped.answerName('F', false, 800) as { result: string }).result, 'spelling');
});

test('decks avoid repeating a chord or an answer pitch back to back, and drills stop at their length',()=>{
  const questions = allQuestions(config('guide', 1));
  for (let seed = 1; seed < 20; seed++) {
    const deck = toneDeck(questions, seeded(seed));
    assert.equal(deck.length, questions.length);
    for (let i = 1; i < deck.length; i++) {
      assert.notEqual(deck[i].symbol, deck[i-1].symbol);
      assert.ok(!deck[i].answers.some(a => deck[i-1].answers.some(b => a.pitchClass === b.pitchClass)), `${deck[i-1].itemId} → ${deck[i].itemId}`);
    }
  }
  const drill = new ToneDrill(allQuestions(config('third', 1)), 3, seeded(2));
  drill.answerPitchClass(drill.question.answers[0].pitchClass, '', 700); drill.next();
  assert.equal(drill.timeout()!.result, 'timeout'); drill.next();
  assert.equal(drill.skip('detection-issue', null)!.result, 'detection-issue'); drill.next();
  assert.equal(drill.phase, 'finished'); assert.equal(drill.outcomes.length, 3);
  assert.equal(drill.answerName('C', false, 1), null);
  const rounds = new ToneDrill(allQuestions(config('third', 'triads')).slice(0, 2), null, seeded(4));
  for (let n = 0; n < 5; n++) { rounds.skip('skipped', 1); rounds.next(); }
  assert.equal(rounds.round, 3);
  assert.throws(() => new ToneDrill([], 10));
});
