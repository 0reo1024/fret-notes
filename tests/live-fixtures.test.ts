import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NoteSegmenter, defaultSegmenterOptions } from '../src/domain/practice/note-events';
import { PerformanceSession, type PlayObservation } from '../src/domain/practice/performance';

// Real guitar takes from the P0 baseline (analysis values only). Tuning was all fourths: E2 A2 D3 G3 C4 F4.
type Observation = Omit<PlayObservation, 'sessionId' | 'sequence'> & { levelDb: number };
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/live-guitar-${name}.json`, import.meta.url), 'utf8')) as { targets?: number[]; picks?: number; timeline: Observation[] };
/** Replays a take through the note segmenter with the default (provisional) settings. */
function notes(name: string) {
  const segmenter = new NoteSegmenter(defaultSegmenterOptions()); segmenter.bind('replay');
  const started: { midi: number; startMs: number }[] = [];
  load(name).timeline.forEach((o, i) => { const change = segmenter.push({ ...o, sessionId: 'replay', sequence: i + 1 }); if (change.started) started.push(change.started); });
  return started;
}
/** Picks seen as a jump in input level: at least 9 dB up to above −40 dB, 150 ms apart. */
function levelRises(name: string) {
  const timeline = load(name).timeline, rises: number[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const jump = timeline[i].levelDb - timeline[i-1].levelDb;
    if (jump >= 9 && timeline[i].levelDb > -40 && (!rises.length || timeline[i].audioTimeMs - rises.at(-1)! >= 150)) rises.push(timeline[i].audioTimeMs);
  }
  return rises;
}

test('single notes, muted steps and legato are segmented into the played pitches',()=>{
  for (const name of ['e2-sustain', 'muted-steps', 'legato']) assert.deepEqual(notes(name).map(n => n.midi), load(name).targets, name);
  // First stable pitch arrives about 0.24–0.37 s after the first sound in these takes.
  for (const name of ['e2-sustain', 'muted-steps', 'legato']) {
    const timeline = load(name).timeline, sound = timeline.find(o => o.levelDb > -55 && o.state !== 'warming')!, stable = timeline.find(o => o.state === 'stable')!;
    assert.ok(stable.audioTimeMs - sound.audioTimeMs < 500, name);
  }
});

test('the held E2 answers an exact-note question once',()=>{
  const session = new PerformanceSession([{ string: 6, fret: 0, midi: 40, note: 'E2' }], { toleranceCents: 20, holdMs: 350, referenceHz: 440 });
  session.bind('replay');
  load('e2-sustain').timeline.forEach((o, i) => session.consume({ ...o, sessionId: 'replay', sequence: i + 1 }));
  assert.equal(session.results.length, 1); assert.equal(session.phase, 'accepted');
});

test('repeated picks of one pitch: the segmenter merges most of them, level jumps show the picks',()=>{
  // A muted string still read about −45 to −52 dB, above the −55 dB gate, so it stayed "stable" and did not end the note.
  const picked = notes('repeated');
  assert.ok(picked.every(n => n.midi === 55));
  assert.equal(picked.length, 3);
  // Level rises catch the picks the pitch stream cannot separate (one unmuted re-pick rose by less than 9 dB).
  assert.equal(levelRises('repeated').length, 7);
});

test('strummed chords give either the lowest note or a phantom low pitch, never a reliable single note',()=>{
  const midis = notes('chords').map(n => n.midi);
  assert.ok(midis.length > 0);
  // 44 is G♯2, the root on the 6th string; 25 (C♯1) lies below the guitar's lowest string and is not in either chord.
  assert.ok(midis.every(m => m === 44 || m < 40), String(midis));
  assert.ok(midis.some(m => m < 40));
});

test('room noise with the guitar untouched stays under the silence gate',()=>{
  const timeline = load('noise').timeline;
  assert.deepEqual(notes('noise'), []);
  assert.ok(Math.max(...timeline.map(o => o.levelDb)) < -60);
});
