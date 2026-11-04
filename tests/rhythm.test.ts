import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, describeTendency, expectedOnsets, judgeHits, metronomeClicks, patterns, summary, transform, windowsFor, bpmBand } from '../src/domain/training/rhythm';

const pattern = (id: string) => patterns.find(p => p.id === id)!;
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test('expected onsets follow the grid, rests and swing',()=>{
  assert.deepEqual(expectedOnsets(pattern('quarters'), 120, 0).map(o => o.timeMs), [0, 500, 1000, 1500]);
  assert.deepEqual(expectedOnsets(pattern('offbeats'), 120, 1000).map(o => o.timeMs), [1250, 1750, 2250, 2750]);
  assert.deepEqual(expectedOnsets(pattern('triplets'), 60, 0).slice(0, 4).map(o => Math.round(o.timeMs)), [0, 333, 667, 1000]);
  assert.deepEqual(expectedOnsets(pattern('sixteenths'), 120, 0).slice(0, 5).map(o => o.timeMs), [0, 125, 250, 375, 500]);
  const swung = expectedOnsets(pattern('eighths'), 60, 0, 1, 2 / 3).map(o => Math.round(o.timeMs));
  assert.deepEqual(swung.slice(0, 4), [0, 667, 1000, 1667]);
  assert.equal(expectedOnsets(pattern('quarters'), 120, 0, 2).length, 8);
  assert.deepEqual(expectedOnsets(pattern('charleston'), 120, 0).map(o => [o.timeMs, o.accent]), [[0, true], [750, false]]);
});

test('windows shrink below half the smallest gap so neighbours never overlap',()=>{
  const sixteenths = expectedOnsets(pattern('sixteenths'), 120, 0).map(o => o.timeMs);
  assert.deepEqual(windowsFor(sixteenths), { tight: 35, ok: 61.5 });
  assert.deepEqual(windowsFor(expectedOnsets(pattern('quarters'), 60, 0).map(o => o.timeMs)), { tight: 35, ok: 70 });
  assert.deepEqual(windowsFor(expectedOnsets(pattern('sixteenths'), 200, 0).map(o => o.timeMs)), { tight: 35, ok: 36.5 });
});

test('taps are paired in order and classified; extras and misses are kept apart',()=>{
  const expected = expectedOnsets(pattern('quarters'), 120, 0);
  const hits = judgeHits(expected, [-20, 560, 1100, 1300, 1490]);
  assert.deepEqual(hits.map(h => h.verdict), ['tight', 'ok', 'late', 'extra', 'tight']);
  assert.deepEqual(judgeHits(expected, [5, 1003]).map(h => h.verdict), ['tight', 'missed', 'tight', 'missed']);
  assert.deepEqual(judgeHits(expected, [0, 400]).map(h => h.verdict), ['tight', 'early', 'missed', 'missed']);
  const s = summary(hits);
  assert.equal(s.extra, 1); assert.equal(s.late, 1); assert.equal(s.accuracy, 3 / 4);
  assert.ok(Math.abs(s.meanMs! - 32.5) < 1e-9);
});

test('synthetic taps with a known lean and jitter come out as that lean',()=>{
  const expected = expectedOnsets(pattern('eighths'), 100, 0, 4), random = seeded(5);
  const taps = expected.map(e => e.timeMs - 18 + (random() - .5) * 20);
  const s = summary(judgeHits(expected, taps));
  assert.equal(s.missed + s.extra, 0); assert.ok(s.meanMs! > -24 && s.meanMs! < -12, String(s.meanMs));
  assert.ok(s.sdMs! < 10); assert.equal(s.accuracy, 1);
  assert.match(describeTendency(s.meanMs), /早い/); assert.equal(describeTendency(3), 'ほぼ正確'); assert.match(describeTendency(40), /遅い/);
});

test('calibration takes the median offset and ignores stray taps',()=>{
  const clicks = Array.from({ length: 16 }, (_, i) => i * 667);
  assert.equal(calibrate(clicks, clicks.map((c, i) => c + 40 + (i % 3) - 1)), 40);
  assert.equal(calibrate(clicks, [...clicks.map(c => c + 30), 5000 + 300]), 30);
  assert.equal(calibrate(clicks, clicks.slice(0, 3).map(c => c + 20)), null);
});

test('rhythm transforms shift by a beat, double and halve note values',()=>{
  const eighths = pattern('eighth-two-sixteenths');
  assert.deepEqual(transform(eighths, 'shift')!.cells.slice(0, 8), ['rest', 'rest', 'rest', 'rest', 'note', 'rest', 'note', 'note']);
  const doubled = transform(pattern('eighths'), 'double')!;
  assert.equal(doubled.beats, 8); assert.deepEqual(expectedOnsets(doubled, 120, 0).slice(0, 3).map(o => o.timeMs), [0, 500, 1000]);
  const halved = transform(pattern('quarters'), 'half')!;
  assert.equal(halved.beats, 2); assert.deepEqual(expectedOnsets(halved, 120, 0).map(o => o.timeMs), [0, 250, 500, 750]);
  assert.equal(transform(pattern('sixteenths'), 'half'), null);
});

test('metronome slices never repeat or skip clicks, and modes thin the clicks after the count-in',()=>{
  const all = metronomeClicks(500, 4, 4, 8, 'backbeat', 0, 1e9);
  assert.deepEqual(all.map(c => c.timeMs), [0, 500, 1000, 1500, 2500, 3500, 4500, 5500]);
  assert.deepEqual(metronomeClicks(500, 4, 4, 8, 'one', 0, 1e9).map(c => c.timeMs), [0, 500, 1000, 1500, 2000, 4000]);
  const pieces: number[] = [];
  for (let from = 0; from < 7000; from += 37) pieces.push(...metronomeClicks(500, 4, 4, 8, 'all', from, from + 37).map(c => c.timeMs));
  assert.deepEqual(pieces, metronomeClicks(500, 4, 4, 8, 'all', 0, 1e9).map(c => c.timeMs));
  assert.equal(bpmBand(72), '60-79'); assert.equal(bpmBand(120), '120-139');
});
