import test from 'node:test';
import assert from 'node:assert/strict';
import { transposeProgression, type ChordSymbol } from '../src/domain/music/harmony';
import { candidatesFor, describeLine, enumerateLines, formatLine, LineRun, nextAllowed, representativeLines, type LineConstraint } from '../src/domain/training/voice-leading';

const iiVI: ChordSymbol[] = [{ root: 'D', quality: 'min7' }, { root: 'G', quality: 'dom7' }, { root: 'C', quality: 'maj7' }];
const minor: ChordSymbol[] = [{ root: 'D', quality: 'half-dim' }, { root: 'G', quality: 'dom7' }, { root: 'C', quality: 'min7' }];
const guide: LineConstraint = { allowedDegrees: 'guide', maxSemitones: 2, register: [55, 79] };
const names = (lines: ReturnType<typeof enumerateLines>) => lines.map(line => line.map(n => n.name).join('→'));
const midis = (lines: ReturnType<typeof enumerateLines>) => lines.map(line => line.map(n => n.midi).join(','));

test('guide-tone lines through ii–V–I include the classic answers and respect the step limit',()=>{
  const fromF = enumerateLines(iiVI, 65, guide);
  assert.ok(midis(fromF).includes('65,65,64'), String(midis(fromF)));
  assert.ok(!fromF.some(line => line[1].midi % 12 === 11), 'F→B is a tritone away');
  assert.ok(fromF.every(line => line.every((n, i) => i === 0 || Math.abs(n.midi - line[i - 1].midi) <= 2)));
  assert.ok(midis(enumerateLines(iiVI, 72, guide)).includes('72,71,71'));
  assert.deepEqual(formatLine(fromF.find(l => midis([l])[0] === '65,65,64')!), 'F(♭3) → F(♭7) → E(3)');
});

test('minor ii–V–i guide-tone lines resolve to the minor tonic',()=>{
  const lines = names(enumerateLines(minor, null, guide));
  assert.ok(lines.includes('F→F→E♭') && lines.includes('C→B→B♭'), String(lines));
});

test('line traits are facts, not grades',()=>{
  const line = enumerateLines(iiVI, 65, guide).find(l => midis([l])[0] === '65,65,64')!;
  assert.deepEqual(describeLine(line), { commonTones: 1, halfSteps: 1, wholeSteps: 0, guideSwaps: 2, ups: 0, downs: 1 });
  const examples = representativeLines(enumerateLines(iiVI, null, guide));
  assert.ok(examples.length >= 2 && examples.length <= 4, String(examples.map(e => formatLine(e.line))));
  assert.equal(new Set(examples.map(e => formatLine(e.line))).size, examples.length);
});

test('candidates stay inside the register, the limit stops enumeration, and transposition keeps the count',()=>{
  assert.ok(candidatesFor(iiVI[0], { ...guide, register: [60, 72] }).every(n => n.midi >= 60 && n.midi <= 72));
  assert.deepEqual(candidatesFor(iiVI[0], { ...guide, register: [60, 72] }).map(n => n.name), ['C', 'F', 'C']);
  assert.deepEqual(nextAllowed(65, iiVI[1], guide).map(n => n.midi), [65]);
  const long = [...iiVI, ...iiVI].slice(0, 5), wide: LineConstraint = { allowedDegrees: 'chord-tones', maxSemitones: 4, register: [40, 88] };
  assert.equal(enumerateLines(long, null, wide, 200).length, 200);
  const count = enumerateLines(iiVI, null, { ...guide, register: [48, 84] }, 10000).length;
  assert.ok(count > 0);
  // Moving the key and the register together keeps the number of lines.
  for (const [tonic, shift] of [['F', 5], ['B♭', 10], ['E♭', 3], ['A', 9], ['D', 2], ['G♭', 6]] as const)
    assert.equal(enumerateLines(transposeProgression(iiVI, 'C', tonic), null, { ...guide, register: [48 + shift, 84 + shift] }, 10000).length, count, tonic);
  assert.equal(enumerateLines(iiVI, 65, { ...guide, maxSemitones: 0 }).length, 0);
});

test('line runs check the chord, the start rule and the distance, and say which one failed',()=>{
  const run = new LineRun(iiVI.map(c => ({ ...c })), guide, 'third');
  assert.match((run.answer(60) as { reason: string }).reason, /3rd から/);
  assert.match((run.answer(62) as { reason: string }).reason, /使えません（R）/);
  assert.equal(run.answer(65)!.ok, true);
  assert.match((run.answer(71) as { reason: string }).reason, /6半音/);
  assert.match((run.answer(64) as { reason: string }).reason, /使えません（13）/);
  assert.equal(run.answer(65)!.ok, true);
  assert.deepEqual(run.allowed().map(n => n.midi), [64]);
  assert.equal(run.answer(64)!.ok, true);
  assert.equal(run.phase, 'finished'); assert.equal(run.mistakes, 4); assert.equal(formatLine(run.notes), 'F(♭3) → F(♭7) → E(3)');
  assert.match((new LineRun(iiVI, guide, 'free').answer(90) as { reason: string }).reason, /音域外/);
});
