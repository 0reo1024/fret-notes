import test from 'node:test';
import assert from 'node:assert/strict';
import { fretPosition, fretboardColumns } from '../src/ui/fretboard-layout';

test('physical fret positions halve the vibrating length at each octave', () => {
  assert.equal(fretPosition(0), 0);
  assert.equal(fretPosition(12), .5);
  assert.equal(fretPosition(24), .75);
  const spaces = Array.from({length: 12}, (_, i) => fretPosition(i + 1) - fretPosition(i));
  for (let i = 1; i < spaces.length; i++) {
    assert.ok(Math.abs(spaces[i] / spaces[i - 1] - 2 ** (-1 / 12)) < 1e-12);
  }
  const tracks = [...fretboardColumns.matchAll(/([\d.]+)fr/g)].map(match => Number(match[1]));
  assert.equal(tracks.length, 12);
  for (let i = 0; i < tracks.length; i++) {
    assert.ok(Math.abs(tracks[i] - spaces[i] / spaces[0]) < 1e-9);
  }
});
