import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PerformanceSession, acceptedMidis, validMatcher, type PitchMatcher, type PlayObservation, type PlayTarget } from '../src/domain/practice/performance';
import { NoteSegmenter, defaultSegmenterOptions, type NoteEvent } from '../src/domain/practice/note-events';
import { SequenceTracker } from '../src/domain/practice/sequence';
import { AudioController, type AudioBackend, type AudioObservation } from '../src/platform/audio';
import { AudioHub, switchFeatures, type AudioConsumer } from '../src/features/audio/hub';
import { defaultAudioSettings } from '../src/domain/tuner/settings';

const hz = (midi: number, cents = 0) => 440*2**((midi-69+cents/100)/12);
const anyE: PitchMatcher = { kind: 'pitch-class', pitchClasses: [4], register: [40, 76] };
const targetE: PlayTarget = { string: 6, fret: 0, midi: 40, note: 'E2', accept: anyE };
function practice(targets: PlayTarget[] = [targetE, { ...targetE, string: 5 }]) {
  const session = new PerformanceSession(targets, { toleranceCents: 10, holdMs: 350, referenceHz: 440 }, () => .2);
  session.bind('s'); let sequence = 0, time = 0;
  const send = (frequency: number | null, state = 'stable') => { time += 70; session.consume({ sessionId: 's', sequence: ++sequence, audioTimeMs: time, state, frequency }); };
  const hold = (frequency: number, count = 6) => { for (let n = 0; n < count; n++) send(frequency); };
  return { session, send, hold };
}

test('pitch-class matcher accepts any octave inside the register and reads cents from the nearest one',()=>{
  assert.deepEqual(acceptedMidis(anyE), [40, 52, 64, 76]);
  for (const midi of [40, 52, 64]) { const { session, hold } = practice(); hold(hz(midi)); assert.equal(session.results.length, 1, String(midi)); }
  const sharp = practice(); sharp.send(hz(52, 8)); assert.ok(Math.abs(sharp.session.cents! - 8) < 1e-9);
  const wrong = practice(); wrong.hold(hz(51)); wrong.hold(hz(51), 10);
  assert.equal(wrong.session.results.length, 0); assert.equal(wrong.session.wrongAttempts, 1);
  const outside = practice(); outside.hold(hz(88));
  assert.equal(outside.session.results.length, 0); assert.equal(outside.session.wrongAttempts, 1);
  assert.ok(Math.abs(outside.session.cents! - 1200) < 1e-9);
  // Without `accept` the exact-note behaviour is unchanged: E3 does not answer E2.
  const exact = practice([{ string: 6, fret: 0, midi: 40, note: 'E2' }]); exact.hold(hz(52));
  assert.equal(exact.session.results.length, 0); assert.equal(exact.session.wrongAttempts, 1);
});

test('matchers and limits are validated',()=>{
  assert.equal(validMatcher({ kind: 'pitch-class', pitchClasses: [], register: [40, 76] }), false);
  assert.equal(validMatcher({ kind: 'pitch-class', pitchClasses: [4], register: [41, 51] }), false);
  assert.equal(validMatcher({ kind: 'pitch-class', pitchClasses: [12], register: [40, 76] }), false);
  assert.equal(validMatcher({ kind: 'midi', midi: 128 }), false);
  assert.throws(() => new PerformanceSession([{ ...targetE, accept: { kind: 'pitch-class', pitchClasses: [4], register: [41, 51] } }], { toleranceCents: 10, holdMs: 350, referenceHz: 440 }));
  assert.throws(() => new PerformanceSession([targetE], { toleranceCents: 50, holdMs: 300, referenceHz: 440 }));
  const singing = new PerformanceSession([targetE], { toleranceCents: 50, holdMs: 300, referenceHz: 440 }, Math.random, { toleranceCents: [50], holdMs: [300] });
  assert.equal(singing.options.toleranceCents, 50);
});

type Step = [number, string, number | null];
function segment(steps: Step[], segmenter = new NoteSegmenter(defaultSegmenterOptions())) {
  segmenter.bind('s'); let sequence = 0;
  const started: NoteEvent[] = [], ended: NoteEvent[] = [];
  for (const [time, state, midi] of steps) {
    const change = segmenter.push({ sessionId: 's', sequence: ++sequence, audioTimeMs: time, state, frequency: midi === null ? null : hz(midi) });
    if (change.started) started.push(change.started); if (change.ended) ended.push(change.ended);
  }
  return { segmenter, started, ended };
}
const run = (from: number, count: number, state: string, midi: number | null): Step[] => Array.from({ length: count }, (_, i) => [from + i*70, state, midi]);

test('segmenter splits legato, separates repeats only across a release and ignores passing tones',()=>{
  const legato = segment([...run(70, 5, 'stable', 60), ...run(420, 5, 'stable', 62), ...run(770, 5, 'stable', 64)]);
  assert.deepEqual(legato.started.map(e => [e.midi, e.startMs]), [[60, 70], [62, 420], [64, 770]]);
  assert.deepEqual(legato.ended.map(e => [e.midi, e.endMs]), [[60, 420], [62, 770]]);
  const repeated = segment([...run(70, 5, 'stable', 55), ...run(420, 3, 'silence', null), ...run(630, 5, 'stable', 55)]);
  assert.deepEqual(repeated.started.map(e => e.midi), [55, 55]); assert.equal(repeated.ended[0].endMs, 420);
  const held = segment([...run(70, 15, 'stable', 55), ...run(1120, 1, 'unstable', null), ...run(1190, 5, 'stable', 55)]);
  assert.equal(held.started.length, 1); assert.equal(held.segmenter.current()?.midi, 55);
  const passing = segment([...run(70, 6, 'stable', 60), ...run(490, 2, 'stable', 62), ...run(630, 6, 'stable', 60)]);
  assert.deepEqual(passing.started.map(e => e.midi), [60]); assert.equal(passing.ended.length, 0);
  const released = segment([...run(70, 5, 'stable', 60), ...run(420, 3, 'silence', null)]);
  assert.equal(released.segmenter.current(), null); assert.equal(released.ended.length, 1);
});

test('segmenter rejects stale input and ends notes on gaps and stopped input',()=>{
  const segmenter = new NoteSegmenter(defaultSegmenterOptions()); segmenter.bind('s');
  const push = (o: Partial<PlayObservation>) => segmenter.push({ sessionId: 's', sequence: 1, audioTimeMs: 70, state: 'stable', frequency: hz(60), ...o });
  for (let n = 1; n <= 5; n++) push({ sequence: n, audioTimeMs: n*70 });
  assert.equal(segmenter.current()?.midi, 60);
  assert.equal(push({ sequence: 6, audioTimeMs: 300, frequency: hz(62) }).started, null);
  assert.equal(push({ sequence: 5, audioTimeMs: 900 }).started, null);
  assert.equal(push({ sessionId: 'old', sequence: 9, audioTimeMs: 900 }).started, null);
  assert.equal(push({ sequence: 7, audioTimeMs: 700 }).ended?.endMs, 350);
  for (let n = 8; n <= 11; n++) push({ sequence: n, audioTimeMs: 700 + (n-7)*70 });
  assert.equal(segmenter.current()?.midi, 60);
  assert.equal(push({ sequence: 12, audioTimeMs: 1050, state: 'stopped', frequency: null }).ended?.midi, 60);
  segmenter.bind('next'); assert.equal(segmenter.current(), null);
});

test('recorded guitar events give only E2 notes and drop a two-frame stray pitch',async()=>{
  const fixture = JSON.parse((await readFile(new URL('./fixtures/play-guitar-events.json', import.meta.url), 'utf8')).replace(/^﻿/, ''));
  const segmenter = new NoteSegmenter(defaultSegmenterOptions()); segmenter.bind('replay');
  const started: NoteEvent[] = [];
  fixture.timeline.forEach((event: Omit<PlayObservation, 'sessionId'|'sequence'>, i: number) => { const change = segmenter.push({ ...event, sessionId: 'replay', sequence: i+1 }); if (change.started) started.push(change.started); });
  assert.ok(started.length >= 1);
  assert.ok(started.every(e => e.midi === fixture.targetMidi));
  // Unstable runs of about 230 ms in this log exceed the 120 ms release, so they split the note.
  assert.equal(started.length, 4);
});

const note = (midi: number, startMs = 0): NoteEvent => ({ midi, startMs, endMs: null, cents: 0 });
const exact = (midi: number): PitchMatcher => ({ kind: 'midi', midi });

test('ordered sequences restart on a mistake, or wait when asked',()=>{
  const triad = new SequenceTracker({ kind: 'ordered', steps: [exact(60), exact(64), exact(67)] });
  assert.equal(triad.push(note(60)), 'progress'); assert.equal(triad.push(note(65)), 'error');
  assert.deepEqual(triad.lastError, { step: 1, midi: 65 }); assert.equal(triad.progress, 0);
  assert.equal(triad.push(note(60)), 'progress'); assert.equal(triad.push(note(64)), 'progress'); assert.equal(triad.push(note(67)), 'complete');
  assert.equal(triad.push(note(72)), 'ignored'); assert.equal(triad.errors, 1);
  const restartOnRoot = new SequenceTracker({ kind: 'ordered', steps: [exact(60), exact(64), exact(67)] });
  restartOnRoot.push(note(60)); restartOnRoot.push(note(64)); assert.equal(restartOnRoot.push(note(60)), 'error');
  assert.equal(restartOnRoot.progress, 1);
  const waiting = new SequenceTracker({ kind: 'ordered', steps: [exact(60), exact(64)] }, 'wait');
  waiting.push(note(60)); assert.equal(waiting.push(note(62)), 'error'); assert.equal(waiting.progress, 1); assert.equal(waiting.push(note(64)), 'complete');
});

test('unordered sets accept either order, ignore repeats and support steps that depend on the previous note',()=>{
  const g7guide = (): PitchMatcher[] => [{ kind: 'pitch-class', pitchClasses: [11], register: [40, 88] }, { kind: 'pitch-class', pitchClasses: [5], register: [40, 88] }];
  for (const order of [[59, 65], [65, 59]]) {
    const tracker = new SequenceTracker({ kind: 'unordered', steps: g7guide() });
    assert.equal(tracker.push(note(order[0])), 'progress'); assert.equal(tracker.push(note(order[0] + 12)), 'ignored');
    assert.equal(tracker.push(note(order[1])), 'complete');
  }
  const wrong = new SequenceTracker({ kind: 'unordered', steps: g7guide() });
  wrong.push(note(59)); assert.equal(wrong.push(note(60)), 'error'); assert.equal(wrong.progress, 0);
  const near = (previous: NoteEvent | null): PitchMatcher => previous ? { kind: 'pitch-class', pitchClasses: [4, 5], register: [previous.midi - 2, previous.midi + 2] } : exact(65);
  const line = new SequenceTracker({ kind: 'ordered', steps: [exact(65), near] });
  line.push(note(65)); assert.equal(line.push(note(76)), 'error');
  line.push(note(65)); assert.equal(line.push(note(64)), 'complete');
});

test('audio hub sends input only to the visible feature and pauses the one it replaces',async()=>{
  let receive: (o: AudioObservation) => void = () => {};
  const backend: AudioBackend = { available: true, async list() { return []; }, async start(request, callback) { receive = callback; return { sessionId: request.sessionId, deviceName: 'test', sampleRate: 48000, analysisSampleRate: 12000, channels: 1, channel: 0 }; }, async stop() {}, async acknowledge() {} };
  const hub = new AudioHub(new AudioController(backend, () => 0, () => 'hub'));
  const log: string[] = [];
  const consumer = (name: string): AudioConsumer => ({ consume: o => log.push(`${name}:${o.sequence}`), sync: () => log.push(`${name}:sync`), pause: () => log.push(`${name}:pause`) });
  const a = consumer('a'), b = consumer('b'); let changes = 0; hub.onChange(() => changes++);
  hub.setActiveConsumer(a); await hub.controller.start(defaultAudioSettings());
  const send = (sequence: number) => receive({ sessionId: 'hub', sequence, audioTimeMs: sequence*70, state: 'stable', frequency: 110, levelDb: -20, peak: .2, confidence: .99, droppedSamples: 0, message: null });
  send(1); hub.setActiveConsumer(b); send(2); hub.setActiveConsumer(null); send(3);
  assert.deepEqual(log.filter(entry => !entry.endsWith('sync')), ['a:1', 'a:pause', 'b:2', 'b:pause']);
  assert.ok(log.includes('a:sync') && log.includes('b:sync')); assert.ok(changes >= 3);
});

test('switching tabs hides the old feature before the new one claims the input',async()=>{
  // Like the trainers: showing claims the hub, hiding a visible feature releases it without checking who holds it.
  let receive: (o: AudioObservation) => void = () => {};
  const backend: AudioBackend = { available: true, async list() { return []; }, async start(request, callback) { receive = callback; return { sessionId: request.sessionId, deviceName: 'test', sampleRate: 48000, analysisSampleRate: 12000, channels: 1, channel: 0 }; }, async stop() {}, async acknowledge() {} };
  const hub = new AudioHub(new AudioController(backend, () => 0, () => 'hub'));
  const log: string[] = [];
  const feature = (name: string) => {
    let visible = false;
    const consumer: AudioConsumer = { consume: o => log.push(`${name}:${o.sequence}`), sync() {}, pause: () => log.push(`${name}:pause`) };
    return { consumer, show(show: boolean) { if (visible && !show) hub.setActiveConsumer(null); visible = show; if (show) hub.setActiveConsumer(consumer); } };
  };
  const play = feature('play'), harmony = feature('harmony');
  const open = (selected: 'play' | 'harmony') => switchFeatures([{ selected: selected === 'play', show: play.show }, { selected: selected === 'harmony', show: harmony.show }]);
  open('harmony'); open('play');
  assert.equal(hub.activeConsumer, play.consumer);
  await hub.controller.start(defaultAudioSettings());
  receive({ sessionId: 'hub', sequence: 1, audioTimeMs: 70, state: 'stable', frequency: 110, levelDb: -20, peak: .2, confidence: .99, droppedSamples: 0, message: null });
  assert.deepEqual(log, ['harmony:pause', 'play:1']);
  open('harmony'); assert.equal(hub.activeConsumer, harmony.consumer);
});
