import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create, forInstrument } from '../src/domain/instruments/core';
import { resolveInstrument, profileIds, presetsFor, defaultTuning, decodeTuning, midiName, type TuningConfig } from '../src/domain/instruments/profiles';
import { forProfile, get } from '../src/domain/instruments/shapes';
import * as Theory from '../src/domain/music/theory';
import { PracticeSession } from '../src/domain/practice/session';
import { decodeSettings, defaults, SettingsRepository, type SettingsFile } from '../src/platform/settings';

test('built-in tunings preserve explicit string numbers and absolute pitches on all instruments', () => {
  const standard = { guitar: [64, 59, 55, 50, 45, 40], bass4: [43, 38, 33, 28], bass5: [43, 38, 33, 28, 23] };
  for (const id of profileIds) {
    for (const preset of presetsFor(id)) {
      const profile = resolveInstrument(id, { ...defaultTuning(), selectedTuningId: preset.id });
      const core = create(profile);
      assert.equal(profile.strings.length, standard[id].length);
      for (const string of profile.strings) {
        assert.equal(string.id, `${id}:string:${string.number}`);
        const expected = standard[id][string.number - 1] - (preset.id === 'half-step-down' ? 1 : preset.id.startsWith('drop-') && string.number === profile.strings.length ? 2 : preset.id === 'all-fourths' && string.number <= 2 ? -1 : 0);
        assert.equal(core.midi({ string: string.number, fret: 0 }), expected);
        for (let fret = 0; fret <= 12; fret++) {
          assert.equal(core.midi({ string: string.number, fret }), expected + fret);
          assert.equal(core.pitch({ string: string.number, fret }), (expected + fret) % 12);
          assert.ok(Math.abs(core.frequency({ string: string.number, fret }) - 440 * 2 ** ((expected + fret - 69) / 12)) < 1e-8);
        }
      }
    }
  }
  assert.equal(midiName(23), 'B0'); assert.equal(midiName(40), 'E2'); assert.equal(midiName(64), 'E4');
});

test('Drop D changes questions, natural-note filtering and answer positions without old quiz state', () => {
  const standard = forInstrument();
  const drop = create(resolveInstrument('guitar', { ...defaultTuning(), selectedTuningId: 'drop-d' }));
  const settings = { ...drop.normalize(), strings: [6], frets: [0, 1, 2, 12], naturalOnly: true, mode: 'reverse' as const };
  assert.equal(standard.name({ string: 6, fret: 0 }), 'E');
  assert.equal(drop.name({ string: 6, fret: 0 }), 'D');
  assert.deepEqual(drop.candidates(settings).map(p => p.fret), [0, 2, 12]);
  assert.equal(drop.isCorrect({ string: 6, fret: 0 }, { string: 6, fret: 12 }, settings), true);
  assert.equal(drop.isCorrect({ string: 6, fret: 0 }, { string: 6, fret: 2 }, settings), false);
  const oldSession = new PracticeSession(standard, settings); oldSession.reveal(); oldSession.next();
  const nextSession = new PracticeSession(drop, settings);
  assert.equal(nextSession.state.revealed, false); assert.equal(nextSession.state.index, 0);
  assert.equal(nextSession.state.round, 1); assert.equal(nextSession.state.chosen, null);
  assert.ok(nextSession.state.deck.every(p => drop.isNatural(p)));
  const dTones = Theory.tones({ ...Theory.normalize(), studyView: 'chord', studyRoot: 'D', studyChord: 'major' });
  assert.equal(dTones.find(t => t.pitch === drop.pitch({ string: 6, fret: 0 }))?.degree, 'R');
});

test('shape compatibility checks absolute tuning, including custom standard and an octave change', () => {
  for (const id of profileIds) for (const preset of presetsFor(id)) {
    const profile = resolveInstrument(id, { ...defaultTuning(), selectedTuningId: preset.id });
    const shapes = forProfile('C', 'major', profile);
    assert.equal(shapes.supported, preset.id === 'standard' || preset.id === 'all-fourths');
    if (preset.id === 'standard') assert.deepEqual(shapes.shapes, get('C', 'major', profile.instrument, profile.strings.length));
    else if (shapes.supported) assert.deepEqual(shapes.shapes, get('C', 'major', profile.instrument, profile.strings.length, 'fourths'));
    else { assert.deepEqual(shapes.shapes, []); assert.match(shapes.message, /未対応/); }
  }
  const standard = presetsFor('guitar')[0];
  const custom: TuningConfig = { selectedTuningId: 'user:standard-copy', customTunings: [{ ...standard, id: 'user:standard-copy', name: 'コピー' }] };
  assert.equal(forProfile('E', 'major', resolveInstrument('guitar', custom)).supported, true);
  custom.customTunings[0].openMidi[5] += 12;
  assert.equal(forProfile('E', 'major', resolveInstrument('guitar', custom)).supported, false);
});

test('all-fourths guitar shapes sound every chord tone on the actual strings and fit the diagram', () => {
  const profile = resolveInstrument('guitar', { ...defaultTuning(), selectedTuningId: 'all-fourths' });
  assert.deepEqual(profile.strings.map(s => s.openMidi), [65, 60, 55, 50, 45, 40]);
  const core = create(profile);
  assert.deepEqual(forProfile('F', 'major', profile).shapes[0].frets, [1, 3, 3, 2, 0, 0]);
  let total = 0;
  for (const root of ['C', 'E', 'F', 'B♭', 'F♯']) for (const pattern of Theory.chords) {
    const { shapes } = forProfile(root, pattern.id, profile);
    total += shapes.length;
    for (const shape of shapes) {
      const fretted = shape.frets.filter((f): f is number => f !== null);
      assert.ok(Math.max(...fretted) - shape.start <= 4);
      assert.equal(new Set(shapes.map(s => s.frets.join())).size, shapes.length);
      shape.frets.forEach((fret, i) => {
        if (fret === null) return;
        assert.equal(core.pitch({ string: 6 - i, fret }), shape.notes[i]!.pitch);
      });
    }
  }
  assert.ok(total > 0);
  const raised: TuningConfig = { selectedTuningId: 'user:fourths-up', customTunings: [{ ...presetsFor('guitar')[3], id: 'user:fourths-up', name: '1オクターブ上', openMidi: [77, 72, 67, 62, 57, 52] }] };
  assert.equal(forProfile('C', 'major', resolveInstrument('guitar', raised)).supported, false);
});

test('custom tunings reject malformed input, duplicate IDs, wrong instruments and excessive entries', () => {
  const preset = { ...presetsFor('guitar')[0], id: 'user:valid', name: 'カスタム' };
  const valid = { selectedTuningId: preset.id, customTunings: [preset] };
  const invalid = [
    { ...valid, selectedTuningId: 'missing' }, { ...valid, customTunings: [preset, preset] },
    ...[{ id: 'standard' }, { instrumentId: 'bass4' }, { name: '' }, { name: 'x'.repeat(41) }, { name: 'bad\nname' }, { openMidi: [64] }, { openMidi: [64, 59, 55, 50, 45, -1] }, { openMidi: [64, 59, 55, 50, 45, 116] }, { openMidi: [64, 59, 55, 50, 45, 38.5] }, { extra: true }].map(p => ({ ...valid, customTunings: [{ ...preset, ...p }] })),
    { ...valid, customTunings: Array.from({ length: 13 }, (_, i) => ({ ...preset, id: `user:${i}` })) },
  ];
  for (const input of invalid) assert.throws(() => decodeTuning(input, 'guitar'));
  const boundary = { ...valid, customTunings: [{ ...preset, openMidi: [0, 115, 55, 50, 45, 38] }] };
  const core = create(resolveInstrument('guitar', decodeTuning(boundary, 'guitar')));
  assert.equal(core.midi({ string: 2, fret: 12 }), 127);
  assert.equal(core.name({ string: 1, fret: 0 }), 'C');
  const decoded = decodeTuning(valid, 'guitar'); decoded.customTunings[0].openMidi[0] = 0;
  assert.equal(preset.openMidi[0], 64);
});

test('schema 1 migrates to standard tuning without changing existing practice settings', async () => {
  const previous = JSON.parse(await readFile(new URL('./fixtures/settings-v1.json', import.meta.url), 'utf8'));
  const migrated = decodeSettings(previous);
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.profiles, previous.profiles);
  assert.equal(migrated.bassStringCount, 5);
  for (const id of profileIds) assert.deepEqual(migrated.instruments[id], defaultTuning());
  assert.deepEqual(decodeSettings(JSON.parse(JSON.stringify(migrated))), migrated);
});

test('schema 2 round-trips custom tunings and rejects incompatible or incomplete files', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/settings-v2.json', import.meta.url), 'utf8'));
  const migrated = decodeSettings(fixture);
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.instruments, fixture.instruments);
  assert.deepEqual(decodeSettings(JSON.parse(JSON.stringify(migrated))),migrated);
  assert.throws(() => decodeSettings({ ...fixture, schemaVersion: 4 }));
  assert.throws(() => decodeSettings({ ...fixture, instruments: {} }));
  assert.throws(() => decodeSettings({ ...fixture, instruments: { ...fixture.instruments, extra: defaultTuning() } }));
  assert.throws(() => decodeSettings({ ...fixture, instruments: { ...fixture.instruments, bass4: { ...defaultTuning(), selectedTuningId: 'drop-a' } } }));
});

test('tuning and practice settings save as one snapshot, restore independently, and failed import preserves both', async () => {
  let stored: SettingsFile = defaults(), fail = false;
  const repository = new SettingsRepository({
    async load() { return { settings: structuredClone(stored), recovered: false }; },
    async save(settings) { if (fail) throw new Error('disk error'); stored = structuredClone(settings); },
  });
  await repository.load();
  const settings = { ...forInstrument().normalize(), ...Theory.normalize(), strings: [6] };
  await repository.update('guitar', settings, 'guitar', 4, { ...defaultTuning(), selectedTuningId: 'drop-d' });
  const restored = decodeSettings(JSON.parse(await repository.exportJson()));
  assert.equal(restored.instruments.guitar.selectedTuningId, 'drop-d');
  assert.equal(restored.instruments.bass4.selectedTuningId, 'standard');
  assert.deepEqual(restored.profiles.guitar?.strings, [6]);
  fail = true;
  await assert.rejects(repository.replace({ ...defaults(), lastInstrument: 'bass5', bassStringCount: 5 }));
  assert.deepEqual(repository.current, restored);
});
