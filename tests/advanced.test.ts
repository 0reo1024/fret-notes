import test from 'node:test';
import assert from 'node:assert/strict';
import { chordTones, parseChordSymbol } from '../src/domain/music/harmony';
import { chords, scales, tonesFor } from '../src/domain/music/theory';
import * as Shapes from '../src/domain/instruments/shapes';
import {
  advancedStatus, approachNotes, approachSteps, ApproachRun, avoidNotes, chordScale, chordScaleQuestions, describeAvoid, scaleTensions, tensionQuestions,
  type ApproachPattern,
} from '../src/domain/training/advanced';
import { candidatesFor } from '../src/domain/training/voice-leading';
import { checkName, toneChoices } from '../src/domain/training/tone-questions';
import { library, materialize, flatten } from '../src/domain/training/progression';
import { NoteSegmenter, defaultSegmenterOptions, type NoteEvent } from '../src/domain/practice/note-events';
import { SequenceTracker } from '../src/domain/practice/sequence';
import { emptyTrainingData, statKey, type ItemStat } from '../src/domain/training/records';

/** Written out by hand, not computed: each root's 3, 5, ♭7, 7, 6, ♭3, 9, ♭9, ♯9, 11, ♯11, 13, ♭13. */
const columns = ['3', '5', '♭7', '7', '6', '♭3', '9', '♭9', '♯9', '11', '♯11', '13', '♭13'];
const byHand: Record<string, string> = {
  C: 'E G B♭ B A E♭ D D♭ D♯ F F♯ A A♭',
  'D♭': 'F A♭ C♭ C B♭ F♭ E♭ E♭♭ E G♭ G B♭ B♭♭',
  D: 'F♯ A C C♯ B F E E♭ E♯ G G♯ B B♭',
  'E♭': 'G B♭ D♭ D C G♭ F F♭ F♯ A♭ A C C♭',
  E: 'G♯ B D D♯ C♯ G F♯ F F♯♯ A A♯ C♯ C',
  F: 'A C E♭ E D A♭ G G♭ G♯ B♭ B D D♭',
  'F♯': 'A♯ C♯ E E♯ D♯ A G♯ G G♯♯ B B♯ D♯ D',
  G: 'B D F F♯ E B♭ A A♭ A♯ C C♯ E E♭',
  'A♭': 'C E♭ G♭ G F C♭ B♭ B♭♭ B D♭ D F F♭',
  A: 'C♯ E G G♯ F♯ C B B♭ B♯ D D♯ F♯ F',
  'B♭': 'D F A♭ A G D♭ C C♭ C♯ E♭ E G G♭',
  B: 'D♯ F♯ A A♯ G♯ D C♯ C C♯♯ E E♯ G♯ G',
};
const formulas: Record<string, string> = {
  dom7b9: 'R 3 5 ♭7 ♭9', dom7s9: 'R 3 5 ♭7 ♯9', dom7s11: 'R 3 5 ♭7 9 ♯11', thirteen: 'R 3 5 ♭7 9 13',
  dom7b13: 'R 3 5 ♭7 ♭13', min11: 'R ♭3 5 ♭7 9 11', maj7s11: 'R 3 5 7 9 ♯11', 'six-nine': 'R 3 5 6 9',
};

test('added qualities spell as the hand-written table on the twelve roots',()=>{
  for (const [root, row] of Object.entries(byHand)) {
    const names = row.split(' '), at = (degree: string) => degree === 'R' ? root : names[columns.indexOf(degree)];
    for (const [quality, formula] of Object.entries(formulas))
      assert.deepEqual(chordTones({ root, quality }).map(t => t.name), formula.split(' ').map(at), `${root} ${quality}`);
  }
  const names = (root: string, quality: string) => chordTones({ root, quality }).map(t => t.name).join(' ');
  assert.equal(names('C', 'dom7s9'), 'C E G B♭ D♯'); assert.equal(names('F', 'thirteen'), 'F A C E♭ G D');
  assert.equal(names('B♭', 'dom7b9'), 'B♭ D F A♭ C♭'); assert.equal(names('E♭', 'maj7s11'), 'E♭ G B♭ D F A');
});

test('enharmonic tensions keep their own degrees',()=>{
  const degrees = (quality: string) => chordTones({ root: 'C', quality }).map(t => `${t.degree}:${t.name}`);
  assert.ok(degrees('dom7s11').includes('♯11:F♯') && !degrees('dom7s11').some(d => d.startsWith('♭5')));
  assert.ok(degrees('half-dim').includes('♭5:G♭'));
  assert.ok(degrees('dom7b13').includes('♭13:A♭') && degrees('aug').includes('♯5:G♯'));
  assert.ok(degrees('dom7s9').includes('♯9:D♯') && degrees('min7').includes('♭3:E♭'));
});

test('the catalog keeps its first entries, adds at the end, and the new qualities parse but have no shapes',()=>{
  assert.equal(chords.length, 27); assert.equal(scales.length, 23);
  assert.equal(chords[0].id, 'major'); assert.equal(scales[0].id, 'ionian');
  assert.deepEqual(chords.slice(19).map(c => c.group), Array(8).fill('テンション'));
  for (const [text, quality] of [['G7♭9', 'dom7b9'], ['G7b9', 'dom7b9'], ['C7#9', 'dom7s9'], ['F13', 'thirteen'], ['Dm11', 'min11'], ['Fmaj7#11', 'maj7s11'], ['C6/9', 'six-nine'], ['C69', 'six-nine'], ['E♭7♭13', 'dom7b13'], ['A7♯11', 'dom7s11']] as const)
    assert.deepEqual(parseChordSymbol(text), { root: text[0] + (/^[A-G](♭|b)/.test(text) ? '♭' : ''), quality }, text);
  for (const quality of Object.keys(formulas)) for (const [kind, count] of [['guitar', 6], ['bass', 4], ['bass', 5]] as const) assert.deepEqual(Shapes.get('C', quality, kind, count), []);
  assert.deepEqual(tonesFor('G', scales.find(s => s.id === 'dominant-bebop')!).map(t => t.name), ['G', 'A', 'B', 'C', 'D', 'E', 'F', 'F♯']);
  assert.deepEqual(tonesFor('C', scales.find(s => s.id === 'major-bebop')!).map(t => t.name), ['C', 'D', 'E', 'F', 'G', 'G♯', 'A', 'B']);
});

test('tension questions ask the defining tension, double accidentals included',()=>{
  const questions = tensionQuestions('standard', true);
  assert.equal(questions.length, 96);
  const ask = (title: string) => questions.find(q => q.title === title)!;
  assert.equal(ask('G7♭9').answers[0].name, 'A♭'); assert.equal(ask('G7♭9').ask, '♭9 は?');
  assert.equal(ask('C13').answers[0].name, 'A'); assert.equal(ask('Dm11').answers[0].name, 'G'); assert.equal(ask('F6/9').answers[0].name, 'G');
  const dflat = ask('D♭7♭9');
  assert.equal(dflat.answers[0].name, 'E♭♭'); assert.equal(checkName(dflat, 0, 'E♭♭', false).result, 'correct'); assert.equal(checkName(dflat, 0, 'D', false).result, 'spelling');
  for (const q of questions) { const choices = toneChoices(q, 0, () => .3); assert.equal(choices.filter(c => c === q.answers[0].name).length, 1, q.title); assert.equal(new Set(choices).size, 4); }
});

test('chord-scale questions name the function and keep accepted alternatives out of the wrong choices',()=>{
  const questions = chordScaleQuestions('standard', true);
  const find = (title: string, role: string) => questions.find(q => q.title === title && q.ask.includes(role))!;
  const alt = find('G7alt', 'オルタード');
  assert.equal(alt.answers[0].name, 'G オルタード'); assert.match(alt.hint!, /A♭ メロディックマイナーの第7モード/);
  assert.equal(find('Cmaj7♯11', '♯11').answers[0].name, 'C リディアン');
  assert.equal(find('Dm7', 'ii').answers[0].name, 'D ドリアン'); assert.equal(find('Em7', 'iii').answers[0].name, 'E フリジアン');
  assert.match(find('G7♯11', '♯11').hint!, /D メロディックマイナーの第4モード/);
  assert.match(find('Bm7♭5', 'iiø').hint!, /ロクリアン♮2/);
  for (const q of questions) {
    assert.ok(!q.choicePool!.includes(q.answers[0].name));
    const choices = toneChoices(q, 0, () => .5); assert.equal(choices.length, 4); assert.ok(choices.includes(q.answers[0].name));
  }
  const I = find('Cmaj7', 'I');
  assert.ok(!I.choicePool!.some(c => c === 'C リディアン' || /ビバップ/.test(c)));
  assert.ok(!find('G7♭9', 'マイナーキーの V').choicePool!.some(c => /コンディミ|オルタード/.test(c)));
});

test('avoid notes are a guide with the adopted definition; Dorian 13 only on request',()=>{
  assert.deepEqual(avoidNotes('ionian'), [{ degree: '4', tension: '11' }]);
  assert.deepEqual(avoidNotes('mixolydian'), [{ degree: '4', tension: '11' }]);
  assert.deepEqual(['phrygian', 'aeolian', 'locrian', 'lydian', 'dorian'].map(s => avoidNotes(s).map(a => a.tension)), [['♭9'], ['♭13'], ['♭9'], [], []]);
  assert.deepEqual(avoidNotes('dorian', { dorianThirteenth: true }), [{ degree: '6', tension: '13' }]);
  assert.equal(describeAvoid('C', 'ionian'), 'F（11）'); assert.equal(describeAvoid('E', 'phrygian'), 'F（♭9）'); assert.equal(describeAvoid('A', 'aeolian'), 'F（♭13）');
  assert.match(describeAvoid('D', 'dorian', { dorianThirteenth: true }), /^B（13・流派/);
});

test('approach notes are spelled as leading tones and the diatonic step comes from the key or the quality',()=>{
  const cmaj7 = { root: 'C', quality: 'maj7' }, E = chordTones(cmaj7)[1];
  const spelled = (pattern: ApproachPattern, chord = cmaj7, target = E, key: Parameters<typeof approachNotes>[3] = null) => approachNotes(chord, target, pattern, key).map(n => `${n.name}${n.offset}`).join(' ');
  assert.equal(spelled('enclosure-diatonic'), 'F1 D♯-1 E0');
  assert.equal(spelled('enclosure-diatonic', cmaj7, E, { tonic: 'C', mode: 'major' }), 'F1 D♯-1 E0');
  assert.equal(spelled('enclosure-chromatic'), 'F1 D♯-1 E0');
  assert.equal(spelled('below'), 'D♯-1 E0'); assert.equal(spelled('double-above'), 'F♯2 F1 E0'); assert.equal(spelled('double-below'), 'D-2 D♯-1 E0');
  // G7's 3rd B: the step above is C (Mixolydian), a half step; Dm7's 3rd F: G, a whole step.
  const g7 = { root: 'G', quality: 'dom7' }, dm7 = { root: 'D', quality: 'min7' };
  assert.equal(spelled('above-diatonic', g7, chordTones(g7)[1]), 'C1 B0'); assert.equal(spelled('enclosure-diatonic', dm7, chordTones(dm7)[1]), 'G2 E-1 F0');
  // In A minor, E7 is the harmonic-minor V: above its 3rd G♯ comes A.
  const e7 = { root: 'E', quality: 'dom7' };
  assert.equal(spelled('above-diatonic', e7, chordTones(e7)[1], { tonic: 'A', mode: 'minor' }), 'A1 G♯0');
  assert.deepEqual(chordScale({ root: 'D', quality: 'min7' }, { tonic: 'C', mode: 'major' }).map(t => `${t.name}${t.degree}`), ['DR', 'E2', 'F♭3', 'G4', 'A5', 'B6', 'C♭7']);
});

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Notes held 420 ms with short gaps, pushed through the segmenter as analysis observations. */
function played(midis: number[]): NoteEvent[] {
  const segmenter = new NoteSegmenter(defaultSegmenterOptions()); segmenter.bind('s');
  const events: NoteEvent[] = []; let t = 0, sequence = 0;
  for (const midi of midis) {
    for (let i = 0; i < 6; i++) { const change = segmenter.push({ sessionId: 's', sequence: ++sequence, audioTimeMs: t += 70, state: 'stable', frequency: hz(midi) }); if (change.started) events.push(change.started); }
    for (let i = 0; i < 3; i++) segmenter.push({ sessionId: 's', sequence: ++sequence, audioTimeMs: t += 70, state: 'unstable', frequency: null });
  }
  return events;
}
test('approach patterns are judged in order and at fixed distances from the first note',()=>{
  const steps = approachSteps(approachNotes({ root: 'C', quality: 'maj7' }, chordTones({ root: 'C', quality: 'maj7' })[1], 'enclosure-diatonic'), 4, [40, 88]);
  const run = (midis: number[]) => { const tracker = new SequenceTracker({ kind: 'ordered', steps }); let last = ''; for (const e of played(midis)) last = tracker.push(e); return { last, errors: tracker.errors }; };
  assert.deepEqual(run([65, 63, 64]), { last: 'complete', errors: 0 });
  assert.deepEqual(run([77, 75, 76]), { last: 'complete', errors: 0 }, 'any octave of the first note');
  assert.equal(run([65, 51, 64]).last, 'error', 'D♯ two octaves down is not an enclosure');
  assert.equal(run([63, 65, 64]).last, 'error', 'order matters');
  assert.deepEqual(run([62, 65, 63, 64]), { last: 'complete', errors: 1 }, 'a wrong note first, then the pattern');
  // A run over ii–V–I: approach each 3rd from below.
  const chords = flatten(materialize(library.find(e => e.id === 'major-ii-v-i')!, 'C'));
  const approach = new ApproachRun(chords, 'below', 'third', { tonic: 'C', mode: 'major' }, [40, 88], 1);
  const answers = played([64, 65, 70, 71, 63, 64, 63, 64]).map(e => approach.answer(e, 500));
  assert.deepEqual(answers, ['progress', 'hit', 'progress', 'hit', 'progress', 'hit', 'progress', 'hit']);
  assert.equal(approach.phase, 'finished'); assert.deepEqual(approach.results.map(r => r.mistakes), [0, 0, 0, 0]);
  const sus = new ApproachRun([{ root: 'C', quality: 'sus4', symbol: 'Csus4', beats: 4 }], 'below', 'third', null, [40, 88], 1);
  assert.equal(sus.notes().map(n => n.name).join(' '), 'E F', 'no 3rd: the 4th stands in');
});

test('tensions for lines: the scale’s 9th and 13th, never duplicating chord tones',()=>{
  const names = (quality: string, root = 'C', key: Parameters<typeof scaleTensions>[1] = null) => scaleTensions({ root, quality }, key).map(t => `${t.name}:${t.degree}`);
  assert.deepEqual(names('maj7'), ['D:9', 'A:13']); assert.deepEqual(names('dom7', 'G'), ['A:9', 'E:13']); assert.deepEqual(names('dom7b9', 'G'), ['E♭:♭13'], 'its ♭9 is already a chord tone');
  assert.deepEqual(names('thirteen', 'G'), [], 'G13 already has its 9th and 13th'); assert.deepEqual(names('min7', 'E', { tonic: 'C', mode: 'major' }), ['F:♭9', 'C:♭13']);
  const notes = candidatesFor({ root: 'C', quality: 'maj7' }, { allowedDegrees: 'tensions', maxSemitones: 2, register: [60, 71] });
  assert.deepEqual(notes.map(n => `${n.name}${n.degree}`), ['CR', 'D9', 'E3', 'G5', 'A13', 'B7']);
  assert.deepEqual(candidatesFor({ root: 'C', quality: 'maj7' }, { allowedDegrees: 'guide', maxSemitones: 2, register: [60, 71] }).map(n => n.name), ['E', 'B']);
});

test('advanced content opens at 80% of the 96 guide-tone items',()=>{
  const mastered = (itemId: string, layer: ItemStat['layer'] = 'knowledge'): ItemStat => ({ itemId, layer, attempts: 6, correct: 6, wrong: 0, detectionIssues: 0, recentMs: [1000], box: 4, dueAt: '2026-11-01', lastAt: '2026-10-27T00:00:00Z', firstAt: '2026-10-01T00:00:00Z' });
  const data = (ids: string[]) => { const d = emptyTrainingData(); for (const id of ids) d.stats[statKey('knowledge', id)] = mastered(id); return d; };
  const roots = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const all = ['maj7', 'min7', 'dom7', 'half-dim'].flatMap(q => roots.flatMap(r => [`ct:${q}:${r}:third`, `ct:${q}:${r}:seventh`]));
  assert.deepEqual(advancedStatus(data(all.slice(0, 77))), { mastered: 77, total: 96, ratio: 77 / 96, unlocked: true });
  assert.equal(advancedStatus(data(all.slice(0, 76))).unlocked, false);
  // Guide answers count for both tones; G♭ and F♯ are the same item; other qualities and unmastered items do not count.
  assert.equal(advancedStatus(data(['ct:maj7:C:guide', 'ct:dom7:G♭:third', 'ct:dom7:F♯:third', 'ct:nine:C:third'])).mastered, 3);
  const weak = data(['ct:maj7:C:third']); weak.stats[statKey('knowledge', 'ct:maj7:C:third')].box = 3;
  assert.equal(advancedStatus(weak).mastered, 0);
  assert.equal(advancedStatus(data([])).unlocked, false);
});
