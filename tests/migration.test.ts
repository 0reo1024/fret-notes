import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as Core from '../src/domain/instruments/core';
import * as Theory from '../src/domain/music/theory';
import * as Shapes from '../src/domain/instruments/shapes';
import { PracticeSession } from '../src/domain/practice/session';
import { SettingsRepository, decodeSettings, defaults, type SettingsBackend, type SettingsFile } from '../src/platform/settings';

const require = createRequire(import.meta.url);
const oldCore = require('../legacy/web/core.js');
const oldTheory = require('../legacy/web/theory.js');
const oldShapes = require('../legacy/web/shapes.js');

// Scope: the retained version's 19 qualities and 21 scales. Entries added later (P14 tensions and bebop scales) are
// appended after them and checked in tests/advanced.test.ts.
test('migrated theory and all standard chord shapes match the retained version (its 19 qualities and 21 scales)', () => {
  assert.equal(oldTheory.chords.length, 19); assert.equal(oldTheory.scales.length, 21);
  assert.deepEqual(Theory.chords.slice(0, oldTheory.chords.length), oldTheory.chords); assert.deepEqual(Theory.scales.slice(0, oldTheory.scales.length), oldTheory.scales);
  for (const root of Theory.roots) for (const view of ['chord', 'scale'] as const) {
    const catalog: Theory.Pattern[] = view === 'chord' ? oldTheory.chords : oldTheory.scales;
    for (const pattern of catalog) {
      const settings = { ...Theory.normalize(), studyView: view, studyRoot: root, [view === 'chord' ? 'studyChord' : 'studyScale']: pattern.id };
      assert.deepEqual(Theory.tones(settings), oldTheory.tones(settings));
      if (view === 'chord') for (const [kind, count] of [['guitar', 6], ['bass', 4], ['bass', 5]] as const) {
        assert.deepEqual(Shapes.get(root, pattern.id, kind, count), oldShapes.get(root, pattern.id, kind, count));
      }
    }
  }
});
test('positions, scope normalization and octave-aware pitch retain fretboard behavior', () => {
  for (const [kind, count] of [['guitar', 6], ['bass', 4], ['bass', 5]] as const) {
    const core = Core.forInstrument(kind, count), old = oldCore.forInstrument(kind, count);
    const settings = core.normalize(); assert.deepEqual(settings, old.normalize());
    assert.deepEqual(core.candidates(settings), old.candidates(settings));
    for (const position of core.candidates(settings)) {
      assert.equal(core.name(position), old.name(position));
      assert.equal(core.midi(position) % 12, core.pitch(position));
      assert.equal(core.midi({ ...position, fret: position.fret + 12 }), core.midi(position) + 12);
    }
  }
  assert.equal(Core.forInstrument('guitar').midi({string:6,fret:0}), 40);
  assert.equal(Core.forInstrument('bass', 4).midi({string:4,fret:0}), 28);
  assert.equal(Core.forInstrument('bass', 5).midi({string:5,fret:0}), 23);
});
test('quiz state has full rounds, no boundary repeat, constrained answers and empty scope handling', () => {
  const core = Core.forInstrument(), settings = { ...core.normalize(), mode: 'reverse' as const, strings: [1], frets: [0, 1, 2] };
  const quiz = new PracticeSession(core, settings, () => 0.4);
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) { seen.add(core.key(quiz.current()!)); quiz.reveal(); if (i < 2) quiz.next(); }
  assert.equal(seen.size, 3); const last = core.key(quiz.current()!); quiz.next();
  assert.equal(quiz.state.round, 2); assert.notEqual(core.key(quiz.current()!), last);
  quiz.answer({string:6,fret:0}); assert.equal(quiz.state.revealed, false);
  quiz.answer(quiz.current()!); assert.equal(quiz.state.revealed, true);
  const empty = new PracticeSession(core, {...settings,strings:[]}); empty.reveal(); empty.next();
  assert.equal(empty.current(), null); assert.equal(empty.state.revealed, false);
});
test('settings writes are serialized and failed imports do not replace current settings', async () => {
  const writes: SettingsFile[] = []; let fail = false;
  const backend: SettingsBackend = {
    async load() { return {settings: defaults(), recovered: false}; },
    async save(snapshot) { await new Promise(resolve=>setTimeout(resolve,5)); if (fail) throw new Error('disk error'); writes.push(snapshot); },
  };
  const repository = new SettingsRepository(backend); await repository.load();
  const settings = {...Core.normalize(),...Theory.normalize()};
  repository.update('guitar', settings, 'guitar', 4);
  repository.update('guitar', {...settings,naturalOnly:true}, 'guitar', 4);
  await repository.flush(); assert.equal(writes[0].profiles.guitar?.naturalOnly, false); assert.equal(writes[1].profiles.guitar?.naturalOnly, true);
  fail = true; await assert.rejects(repository.replace({...defaults(),lastInstrument:'bass5',bassStringCount:5}));
  assert.equal(repository.current.lastInstrument, 'guitar');
  assert.throws(()=>decodeSettings({...defaults(),schemaVersion:4}));
  assert.throws(()=>decodeSettings({...defaults(),profiles:{unknown:{strings:[],frets:[]}}}));
});
