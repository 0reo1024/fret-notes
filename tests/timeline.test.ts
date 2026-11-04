import test from 'node:test';
import assert from 'node:assert/strict';
import { library, materialize, stageTargets } from '../src/domain/training/progression';
import { AutoProgress, InputClock, judgeWindow, landingDegree, playableAuto, shortestChord, type Slot } from '../src/domain/training/timeline';
import { ClickScheduler } from '../src/platform/sound';

const progression = (id: string, tonic = 'C') => materialize(library.find(e => e.id === id)!, tonic);
const iiVI = progression('major-ii-v-i');

test('slots follow tempo, count-in, chord lengths and passes',()=>{
  const run = new AutoProgress(iiVI, 'third', { bpm: 120, scale: 1, countInBars: 1, passes: 2 });
  assert.equal(run.beatMs, 500); assert.equal(run.countInMs, 2000);
  assert.deepEqual(run.slotAt(2500), { pass: 1, index: 0, startMs: 2000, endMs: 4000 });
  assert.deepEqual(run.slotAt(4000), { pass: 1, index: 1, startMs: 4000, endMs: 6000 });
  assert.equal(run.slotAt(1999), null);
  assert.deepEqual(run.slotAt(10500), { pass: 2, index: 0, startMs: 10000, endMs: 12000 });
  assert.equal(run.endMs, 18000); assert.equal(run.slotAt(18000), null);
  const doubled = new AutoProgress(iiVI, 'third', { bpm: 120, scale: 2, countInBars: 1, passes: 1 });
  assert.deepEqual(doubled.slotAt(2000), { pass: 1, index: 0, startMs: 2000, endMs: 6000 });
  const endless = new AutoProgress(iiVI, 'third', { bpm: 120, scale: 1, countInBars: 1, passes: null });
  assert.equal(endless.slotAt(2000 + 8000 * 50 + 10)!.pass, 51); assert.equal(endless.endMs, Infinity);
  const blues = new AutoProgress(progression('blues-jazz', 'F'), 'third', { bpm: 120, scale: 1, countInBars: 1, passes: 1 });
  assert.deepEqual(blues.slotAt(2000 + 3 * 2000 + 1000), { pass: 1, index: 4, startMs: 9000, endMs: 10000 });
  assert.deepEqual(blues.beatAt(2000 + 3 * 2000 + 1000), { countIn: false, beat: 3 });
  assert.deepEqual(blues.beatAt(500), { countIn: true, beat: 2 });
});

test('auto-advance is refused when a chord is shorter than two beats or one second',()=>{
  const blues = progression('blues-jazz', 'F');
  assert.deepEqual(shortestChord(blues, 120, 1), { beats: 2, ms: 1000 });
  assert.equal(playableAuto(blues, 120, 1), true);
  assert.equal(playableAuto(blues, 140, 1), false);
  assert.equal(playableAuto(blues, 140, 2), true);
  assert.equal(playableAuto(iiVI, 160, 1), true);
});

test('clicks: count-in on every beat, then by mode, never repeated or skipped across windows',()=>{
  const run = new AutoProgress(iiVI, 'third', { bpm: 120, scale: 1, countInBars: 1, passes: 1 });
  const all = (mode: Parameters<typeof run.clickTimes>[0]) => run.clickTimes(mode, 0, 100000);
  assert.deepEqual(all('backbeat').map(c => c.timeMs), [0, 500, 1000, 1500, 2500, 3500, 4500, 5500, 6500, 7500, 8500, 9500]);
  assert.deepEqual(all('one').map(c => c.timeMs), [0, 500, 1000, 1500, 2000, 4000, 6000, 8000]);
  assert.deepEqual(all('none').map(c => c.timeMs), [0, 500, 1000, 1500]);
  assert.equal(all('all').length, 20); assert.ok(all('all').filter(c => c.accent).every(c => c.timeMs % 2000 === 0));
  for (const step of [25, 100, 333]) {
    const pieces: number[] = [];
    for (let from = 0; from < 10000; from += step) pieces.push(...run.clickTimes('all', from, from + step).map(c => c.timeMs));
    assert.deepEqual(pieces, all('all').map(c => c.timeMs), String(step));
  }
});

test('windows count notes until the grace runs out, a held common tone, and tell wrong from missed',()=>{
  const slot: Slot = { pass: 1, index: 1, startMs: 4000, endMs: 6000 };
  const g7third = stageTargets({ root: 'G', quality: 'dom7' }, 'third'), g7seventh = stageTargets({ root: 'G', quality: 'dom7' }, 'seventh');
  const note = (midi: number, startMs: number, endMs: number | null = null) => ({ midi, startMs, endMs });
  assert.deepEqual(judgeWindow([note(59, 4300)], slot, g7third, 300, 200), { result: 'hit', firstHitMs: 300 });
  assert.equal(judgeWindow([note(59, 6299)], slot, g7third, 300, 200).result, 'hit');
  assert.equal(judgeWindow([note(59, 6300)], slot, g7third, 300, 200).result, 'missed');
  assert.equal(judgeWindow([note(59, 3000, 3900)], slot, g7third, 300, 200).result, 'missed');
  // F held from Dm7 into G7 is G7's 7th: a hit at the hold time, without re-picking.
  assert.deepEqual(judgeWindow([note(65, 2500)], slot, g7seventh, 300, 200), { result: 'hit', firstHitMs: 200 });
  assert.equal(judgeWindow([note(65, 2500, 4100)], slot, g7seventh, 300, 200).result, 'missed');
  assert.equal(judgeWindow([note(60, 4500)], slot, g7third, 300, 200).result, 'wrong');
  assert.equal(judgeWindow([note(60, 4500), note(71, 5000)], slot, g7third, 300, 200).result, 'hit');
  const guide = stageTargets({ root: 'G', quality: 'dom7' }, 'guide');
  assert.equal(judgeWindow([note(59, 4500)], slot, guide, 300, 200).result, 'missed');
  assert.equal(judgeWindow([note(59, 4500), note(77, 5000)], slot, guide, 300, 200).result, 'hit');
});

test('landing degree is the first note after the change, named over the chord',()=>{
  const slot: Slot = { pass: 1, index: 1, startMs: 4000, endMs: 6000 }, g7 = { root: 'G', quality: 'dom7', symbol: 'G7', beats: 4 };
  const note = (midi: number, startMs: number, endMs: number | null = null) => ({ midi, startMs, endMs });
  assert.equal(landingDegree([note(68, 4200), note(71, 4800)], slot, g7, 300, 200), '♭9');
  assert.equal(landingDegree([note(60, 4200)], slot, g7, 300, 200), '11');
  assert.equal(landingDegree([note(57, 4200)], slot, g7, 300, 200), '9');
  assert.equal(landingDegree([note(65, 3000)], slot, g7, 300, 200), '♭7');
  assert.equal(landingDegree([], slot, g7, 300, 200), null);
});

test('a run judges each chord once after its window, and the free stage only reports landings',()=>{
  const run = new AutoProgress(iiVI, 'third', { bpm: 120, scale: 1, countInBars: 1, passes: 1 });
  run.startNote(65, 2300); run.endNote(3500);
  run.startNote(60, 4400); run.startNote(71, 4900); run.endNote(5800);
  assert.deepEqual(run.update(4299), []);
  assert.deepEqual(run.update(4300).map(o => o.result), ['hit']);
  assert.deepEqual(run.update(4300), []);
  assert.deepEqual(run.update(10400).map(o => o.result), ['hit', 'missed', 'missed']);
  assert.equal(run.outcomeOf(0)!.firstHitMs, 300); assert.equal(run.finished(10299), false); assert.equal(run.finished(10300), true);
  const free = new AutoProgress(iiVI, 'free', { bpm: 120, scale: 1, countInBars: 1, passes: 1 });
  free.startNote(65, 2300); free.startNote(71, 4400);
  // F is still sounding when G7 arrives, so the held note is the landing (G7's ♭7), not the B picked later.
  assert.deepEqual(free.update(6400).map(o => [o.result, o.landing]), [[null, '♭3'], [null, '♭7']]);
  assert.equal(free.target(0), null);
});

test('the input clock maps capture time with the smallest recent delivery delay',()=>{
  const clock = new InputClock();
  assert.equal(clock.toPerformance(100), null);
  clock.observe(1100, 1000); clock.observe(1230, 1100); clock.observe(1260, 1200);
  assert.equal(clock.toPerformance(2000), 2060);
  clock.reset(); assert.equal(clock.toPerformance(2000), null);
});

test('the click scheduler books each click once on the audio clock',()=>{
  const run = new AutoProgress(iiVI, 'third', { bpm: 120, scale: 1, countInBars: 1, passes: 1 });
  let now = 10;
  const booked: number[] = [];
  const scheduler = new ClickScheduler({ get now() { return now; }, click: (at: number) => { booked.push(Math.round((at - 10) * 1000)); } }, 10, (from, to) => run.clickTimes('all', from, to));
  for (let t = 0; t <= 11000; t += 25 + (t % 3)) { now = 10 + t / 1000; scheduler.tick(); }
  assert.deepEqual(booked, run.clickTimes('all', 0, 100000).map(c => c.timeMs));
});
