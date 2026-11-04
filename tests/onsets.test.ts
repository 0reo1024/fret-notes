import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioController, type AudioBackend, type AudioObservation } from '../src/platform/audio';
import { defaultAudioSettings } from '../src/domain/tuner/settings';
import { NoteSegmenter, defaultSegmenterOptions } from '../src/domain/practice/note-events';
import { InputClock } from '../src/domain/training/timeline';
import { expectedOnsets, judgeHits, patterns, summary } from '../src/domain/training/rhythm';
import { generateMelody } from '../src/domain/training/ear';

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
async function controller() {
  let receive: (o: AudioObservation) => void = () => {};
  const backend: AudioBackend = { available: true, async list() { return []; }, async start(request, callback) { receive = callback; return { sessionId: request.sessionId, deviceName: 't', sampleRate: 48000, analysisSampleRate: 12000, channels: 1, channel: 0 }; }, async stop() {}, async acknowledge() {} };
  const c = new AudioController(backend, () => 0, () => 's');
  const seen: AudioObservation[] = []; c.onObservation = o => seen.push(o);
  await c.start(defaultAudioSettings());
  let sequence = 0;
  const send = (audioTimeMs: number, onsets?: AudioObservation['onsets']) => receive({ sessionId: 's', sequence: ++sequence, audioTimeMs, state: 'stable', frequency: 110, levelDb: -20, peak: .2, confidence: .99, droppedSamples: 0, message: null, ...(onsets ? { onsets } : {}) });
  return { c, seen, send };
}

test('the controller accepts ordered onsets and stops on malformed ones',async()=>{
  const ok = await controller();
  ok.send(100); ok.send(170, [{ audioTimeMs: 120, strengthDb: 20 }, { audioTimeMs: 160, strengthDb: 12 }]); ok.send(240, [{ audioTimeMs: 230, strengthDb: 15 }]);
  assert.deepEqual(ok.seen.map(o => o.onsets!.length), [0, 2, 1]); assert.equal(ok.c.phase, 'running');
  for (const bad of [[{ audioTimeMs: Number.NaN, strengthDb: 9 }], [{ audioTimeMs: 150, strengthDb: 9 }, { audioTimeMs: 140, strengthDb: 9 }], [{ audioTimeMs: 999, strengthDb: 9 }], [{ audioTimeMs: 50, strengthDb: 9 }]]) {
    const run = await controller(); run.send(100, [{ audioTimeMs: 60, strengthDb: 10 }]); run.send(200, bad);
    assert.equal(run.c.phase, 'error', JSON.stringify(bad));
  }
});

type Step = [number, number | null, number[]?];
function segment(steps: Step[], useOnsets = true) {
  const s = new NoteSegmenter({ ...defaultSegmenterOptions(), useOnsets }); s.bind('r');
  const started: [number, number][] = [];
  steps.forEach(([t, midi, onsets], i) => {
    const change = s.push({ sessionId: 'r', sequence: i + 1, audioTimeMs: t, state: midi === null ? 'unstable' : 'stable', frequency: midi === null ? null : hz(midi), onsets: onsets?.map(audioTimeMs => ({ audioTimeMs })) });
    if (change.started) started.push([change.started.midi, change.started.startMs]);
  });
  return started;
}
const held = (from: number, count: number, midi: number, onsetAt?: number): Step[] => Array.from({ length: count }, (_, i) => [from + i * 70, midi, onsetAt !== undefined && i === 0 ? [onsetAt] : undefined]);

test('an onset splits a repeated pitch and dates each note from its attack',()=>{
  const steps = [...held(70, 6, 55, 40), ...held(490, 6, 55, 470), ...held(910, 6, 55, 895)];
  assert.deepEqual(segment(steps), [[55, 40], [55, 470], [55, 895]]);
  assert.deepEqual(segment(steps, false).map(n => n[0]), [55]);
  assert.deepEqual(segment(held(70, 15, 55)).length, 1);
  // A second detection right after the first attack (within 60 ms) is not a re-pick.
  assert.deepEqual(segment([...held(70, 6, 55, 40), [490, 55, [80]], ...held(560, 5, 55)]).length, 1);
  // Legato (hammer-on) has no new attack: the new pitch still starts when it is confirmed.
  assert.deepEqual(segment([...held(70, 6, 60, 40), ...held(490, 6, 62)]), [[60, 40], [62, 490]]);
});

test('onsets mapped through the input clock judge played rhythm like taps',()=>{
  const clock = new InputClock();
  // Observations arrive 25–60 ms after capture; capture time 0 is performance time 5000.
  [25, 60, 40, 30, 55].forEach((delay, i) => clock.observe(5000 + i * 70 + delay, i * 70));
  const expected = expectedOnsets(patterns.find(p => p.id === 'eighths')!, 120, 2000, 2);
  const onsetsCapture = expected.map((e, i) => e.timeMs - 5000 + 5000 + (i % 2 ? 12 : -8));
  const played = onsetsCapture.map(t => clock.toPerformance(t)! - 5000 - 25);
  const s = summary(judgeHits(expected, played));
  assert.equal(s.missed + s.extra, 0); assert.equal(s.accuracy, 1); assert.ok(Math.abs(s.meanMs! - 2) < 1e-9);
});

test('repeated pitches appear in melodies only when allowed',()=>{
  const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const repeats = (allow: boolean) => Array.from({ length: 60 }, (_, i) => generateMelody('melody', 8, { tonic: 'C', mode: 'major' }, [40, 76], seeded(i + 1), allow))
    .some(q => q.notes.some((n, i) => i > 0 && n.midi === q.notes[i - 1].midi));
  assert.equal(repeats(false), false); assert.equal(repeats(true), true);
});
