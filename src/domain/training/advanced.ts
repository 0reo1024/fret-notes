import { chordName, chordTones, diatonicSevenths, transpose, type ChordSymbol, type ChordTone } from '../music/harmony';
import { pitchOf, scales, tonesFor } from '../music/theory';
import type { PitchMatcher } from '../practice/performance';
import type { NoteEvent } from '../practice/note-events';
import { SequenceTracker, type SequenceStep } from '../practice/sequence';
import { stageTargets, type KeyInfo, type ProgressionChord, type StageTarget } from './progression';
import { defaultTargetMs, isMastered, type TrainingData } from './records';
import { rootsFor, type DrillQuestion, type RootSet } from './tone-questions';

const scale = (id: string) => scales.find(s => s.id === id)!;
const steps = (degree: string) => degree === 'R' ? 0 : (Number(/\d+$/.exec(degree)![0]) - 1) % 7;

/** The tension that defines each advanced quality, asked as "G7♭9 の ♭9 は?". */
export const tensionOf: Record<string, string> = { dom7b9: '♭9', dom7s9: '♯9', dom7s11: '♯11', thirteen: '13', dom7b13: '♭13', min11: '11', maj7s11: '♯11', 'six-nine': '9' };
export function tensionQuestions(roots: RootSet, sharpSix: boolean): DrillQuestion[] {
  return rootsFor(roots, sharpSix).flatMap(root => Object.entries(tensionOf).map(([quality, degree]) => {
    const chord = { root, quality }, tones = chordTones(chord), symbol = chordName(chord);
    return { itemId: `tn:${quality}:${root}:${degree}`, title: symbol, ask: `${degree} は?`, answers: [tones.find(t => t.degree === degree)!], related: tones, root };
  }));
}

/** Chord-scale contexts. The chord's function is part of the question, since Dm7 is dorian as ii but phrygian as iii.
 * `alsoRight` are scales a common school would also accept there; they are never offered as wrong choices. */
interface ScaleContext { id: string; quality: string | null; symbol: (root: string) => string; role: string; scale: string; alsoRight: string[] }
const contexts: ScaleContext[] = [
  { id: 'I', quality: 'maj7', symbol: r => `${r}maj7`, role: 'メジャーキーの I', scale: 'ionian', alsoRight: ['major-bebop', 'lydian'] },
  { id: 'maj7s11', quality: 'maj7s11', symbol: r => `${r}maj7♯11`, role: '♯11 を含む', scale: 'lydian', alsoRight: [] },
  { id: 'ii', quality: 'min7', symbol: r => `${r}m7`, role: 'メジャーキーの ii', scale: 'dorian', alsoRight: [] },
  { id: 'iii', quality: 'min7', symbol: r => `${r}m7`, role: 'メジャーキーの iii', scale: 'phrygian', alsoRight: [] },
  { id: 'vi', quality: 'min7', symbol: r => `${r}m7`, role: 'メジャーキーの vi', scale: 'aeolian', alsoRight: ['dorian'] },
  { id: 'V', quality: 'dom7', symbol: r => `${r}7`, role: 'メジャーキーの V（解決する）', scale: 'mixolydian', alsoRight: ['dominant-bebop', 'lydian-dominant'] },
  { id: 'alt', quality: null, symbol: r => `${r}7alt`, role: 'オルタード・ドミナント', scale: 'altered', alsoRight: ['diminished-hw'] },
  { id: 'dom7s11', quality: 'dom7s11', symbol: r => `${r}7♯11`, role: '♯11 を含む（解決しない）', scale: 'lydian-dominant', alsoRight: [] },
  { id: 'iiø', quality: 'half-dim', symbol: r => `${r}m7♭5`, role: 'マイナーキーの iiø', scale: 'locrian', alsoRight: ['locrian-natural2'] },
  { id: 'V7b9', quality: 'dom7b9', symbol: r => `${r}7♭9`, role: 'マイナーキーの V', scale: 'hmp5', alsoRight: ['diminished-hw', 'altered'] },
  { id: 'i-mmaj7', quality: 'minmaj7', symbol: r => `${r}m(maj7)`, role: 'マイナーの i', scale: 'melodic-minor', alsoRight: ['harmonic-minor'] },
];
const choiceScales = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian', 'melodic-minor', 'harmonic-minor', 'altered', 'lydian-dominant', 'locrian-natural2', 'hmp5', 'diminished-hw', 'whole-tone'];
/** Modes of melodic minor named with their parent, so G altered reads as A♭ melodic minor's seventh mode. */
const parents: Record<string, [string, string]> = { altered: ['♭2', '第7モード'], 'lydian-dominant': ['5', '第4モード'], 'locrian-natural2': ['♭3', '第6モード'], 'lydian-augmented': ['6', '第3モード'] };
export function parentOf(root: string, scaleId: string): string | null {
  const parent = parents[scaleId];
  return parent ? `${transpose(root, parent[0])} メロディックマイナーの${parent[1]}` : null;
}
export const scaleName = (root: string, scaleId: string) => `${root} ${scale(scaleId).label}`;
export function chordScaleQuestions(roots: RootSet, sharpSix: boolean, avoid: AvoidOptions = { dorianThirteenth: false }): DrillQuestion[] {
  return rootsFor(roots, sharpSix).flatMap(root => contexts.map(c => {
    const name = scaleName(root, c.scale), parent = parentOf(root, c.scale), avoidText = describeAvoid(root, c.scale, avoid);
    return {
      itemId: `cs:${c.id}:${root}`, title: c.symbol(root), ask: `${c.role} ／ 使うスケールは?`, root, labels: true,
      answers: [{ degree: c.role, name, pitchClass: pitchOf(root) }], related: [],
      choicePool: choiceScales.filter(s => s !== c.scale && !c.alsoRight.includes(s)).map(s => scaleName(root, s)),
      hint: [parent, c.alsoRight.length ? `ほかに使われることがあるもの：${c.alsoRight.map(s => scale(s).label).join('、')}` : '', avoidText ? `アヴォイド（文脈に依存するガイド）：${avoidText}` : ''].filter(Boolean).join(' ／ '),
    };
  }));
}

/** Avoid notes as a context-dependent guide, never a wrong answer. Adopted definition: the scale tone a half step above a
 * chord tone of the scale's own seventh chord (Ionian and Mixolydian 11, Phrygian and Locrian ♭9, Aeolian ♭13).
 * Dorian 13 is avoided by some schools and not by others, so it is shown only on request. */
export interface AvoidOptions { dorianThirteenth: boolean }
export const avoidPolicy = 'アヴォイドノートは、スケール固有の7thコードのコードトーンの半音上にあたる音（アイオニアン・ミクソリディアンの11、フリジアン・ロクリアンの♭9、エオリアンの♭13）を代表的な定義として示します。誤りではなく、長く伸ばすと響きがぶつかりやすい音の目安です。ドリアンの13は流派によって扱いが異なります。';
const avoidDegrees: Record<string, string[]> = { ionian: ['4'], mixolydian: ['4'], phrygian: ['♭2'], aeolian: ['♭6'], locrian: ['♭2'] };
const tensionNames: Record<string, string> = { '4': '11', '♭2': '♭9', '♭6': '♭13', '6': '13' };
export function avoidNotes(scaleId: string, options: AvoidOptions = { dorianThirteenth: false }): { degree: string; tension: string }[] {
  const degrees = scaleId === 'dorian' ? options.dorianThirteenth ? ['6'] : [] : avoidDegrees[scaleId] ?? [];
  return degrees.map(degree => ({ degree, tension: tensionNames[degree] }));
}
export function describeAvoid(root: string, scaleId: string, options: AvoidOptions = { dorianThirteenth: false }) {
  const tones = tonesFor(root, scale(scaleId));
  return avoidNotes(scaleId, options).map(a => `${tones.find(t => t.degree === a.degree)!.name}（${a.tension}${scaleId === 'dorian' ? '・流派によって扱いが異なる' : ''}）`).join('、');
}

/** The scale a chord is heard in: the key's when the chord is diatonic to it (as `ninthFromKey`), otherwise a default by
 * quality. Major sevenths default to Ionian, so the step above Cmaj7's 3rd is F. */
const defaultScales: Record<string, string> = {
  major: 'ionian', maj7: 'ionian', maj9: 'ionian', six: 'ionian', 'six-nine': 'ionian', add9: 'ionian', maj7s11: 'lydian',
  minor: 'dorian', min7: 'dorian', min9: 'dorian', min11: 'dorian', min6: 'dorian', minmaj7: 'melodic-minor',
  dom7: 'mixolydian', nine: 'mixolydian', thirteen: 'mixolydian', '7sus4': 'mixolydian', sus2: 'mixolydian', sus4: 'mixolydian',
  dom7b9: 'hmp5', dom7s9: 'altered', dom7b13: 'altered', dom7s11: 'lydian-dominant',
  'half-dim': 'locrian', dim: 'diminished-wh', dim7: 'diminished-wh', aug: 'whole-tone',
};
export function chordScale(chord: ChordSymbol, key: KeyInfo | null = null): ChordTone[] {
  if (key) {
    const tables: [Parameters<typeof diatonicSevenths>[1], string][] = key.mode === 'major' ? [['major', 'ionian']] : [['harmonic-minor', 'harmonic-minor'], ['natural-minor', 'aeolian']];
    for (const [mode, scaleId] of tables) {
      if (!diatonicSevenths(key.tonic, mode).some(c => c.chord && c.chord.root === chord.root && c.chord.quality === chord.quality)) continue;
      // The key's notes, renamed as degrees over this chord's root.
      const names = tonesFor(key.tonic, scale(scaleId)).map(t => t.name), start = names.findIndex(n => n === chord.root);
      return names.map((_, i) => names[(start + i) % 7]).map((name, i) => {
        const semis = (pitchOf(name) - pitchOf(chord.root) + 12) % 12, natural = [0, 2, 4, 5, 7, 9, 11][i], alter = semis - natural > 6 ? semis - natural - 12 : semis - natural < -6 ? semis - natural + 12 : semis - natural;
        return { degree: i === 0 ? 'R' : `${alter < 0 ? '♭'.repeat(-alter) : '♯'.repeat(alter)}${i + 1}`, name, pitchClass: pitchOf(name) };
      });
    }
  }
  return tonesFor(chord.root, scale(defaultScales[chord.quality] ?? 'ionian')).map(t => ({ degree: t.degree, name: t.name, pitchClass: t.pitch }));
}

export type ApproachPattern = 'below' | 'above-diatonic' | 'double-above' | 'double-below' | 'enclosure-diatonic' | 'enclosure-chromatic';
export const approachPatterns: { id: ApproachPattern; name: string }[] = [
  { id: 'below', name: '下からの半音' },
  { id: 'above-diatonic', name: '上からの全音階音' },
  { id: 'double-above', name: '二重の半音（上から）' },
  { id: 'double-below', name: '二重の半音（下から）' },
  { id: 'enclosure-diatonic', name: 'エンクロージャー（上の全音階音＋下の半音）' },
  { id: 'enclosure-chromatic', name: 'エンクロージャー（上の半音＋下の半音）' },
];
/** A spelled note and its distance in semitones from the target; the target itself comes last with offset 0.
 * Chromatic neighbours are spelled as leading tones to the target (E is approached from D♯, not E♭). */
export interface ApproachNote { name: string; offset: number }
export function approachNotes(chord: ChordSymbol, target: ChordTone, pattern: ApproachPattern, key: KeyInfo | null = null): ApproachNote[] {
  const below = { name: transpose(target.name, '♭2', 'down'), offset: -1 }, above = { name: transpose(target.name, '♭2'), offset: 1 };
  const diatonic = () => {
    const tones = chordScale(chord, key), letter = 'CDEFGAB'[('CDEFGAB'.indexOf(target.name[0]) + 1) % 7], tone = tones.find(t => t.name[0] === letter);
    return tone ? { name: tone.name, offset: (tone.pitchClass - target.pitchClass + 12) % 12 } : above;
  };
  const end = { name: target.name, offset: 0 };
  switch (pattern) {
    case 'below': return [below, end];
    case 'above-diatonic': return [diatonic(), end];
    case 'double-above': return [{ name: transpose(target.name, '2'), offset: 2 }, above, end];
    case 'double-below': return [{ name: transpose(target.name, '2', 'down'), offset: -2 }, below, end];
    case 'enclosure-diatonic': return [diatonic(), below, end];
    case 'enclosure-chromatic': return [above, below, end];
  }
}
/** Ordered steps: the first note may be in any octave inside the register; each following note is then fixed by its
 * distance, so F4 → D♯2 → E5 does not count as an enclosure of E. */
export function approachSteps(notes: ApproachNote[], targetPc: number, register: [number, number]): SequenceStep[] {
  const first: PitchMatcher = { kind: 'pitch-class', pitchClasses: [((targetPc + notes[0].offset) % 12 + 12) % 12], register };
  return notes.map((note, i) => i === 0 ? first : (previous: NoteEvent | null): PitchMatcher => ({ kind: 'midi', midi: Math.min(127, Math.max(0, (previous?.midi ?? 0) - notes[i - 1].offset + note.offset)) }));
}
export type ApproachRole = 'third' | 'seventh' | 'root';
export interface ApproachResult { index: number; mistakes: number; responseMs: number | null }
/** Step mode for the approach stage: each chord waits for its pattern, played in order; a wrong note restarts the
 * pattern (the wrong note may itself start it again) and is counted, never blocking. */
export class ApproachRun {
  index = 0; pass = 1; phase: 'playing' | 'paused' | 'finished' = 'playing'; mistakes = 0;
  readonly results: ApproachResult[] = [];
  tracker: SequenceTracker;
  constructor(readonly chords: ProgressionChord[], readonly pattern: ApproachPattern, readonly role: ApproachRole, readonly key: KeyInfo | null,
    readonly register: [number, number], readonly repeats: number | null) {
    if (!chords.length) throw new Error('進行が空です');
    this.tracker = this.track();
  }
  get chord() { return this.chords[this.index]; }
  get nextChord() { return this.index + 1 < this.chords.length ? this.chords[this.index + 1] : this.repeats === null || this.pass < this.repeats ? this.chords[0] : null; }
  target(index = this.index): StageTarget { return stageTargets(this.chords[index], this.role); }
  notes(index = this.index) { const target = this.target(index).tones[0]; return approachNotes(this.chords[index], target, this.pattern, this.key); }
  private track() { return new SequenceTracker({ kind: 'ordered', steps: approachSteps(this.notes(), this.target().tones[0].pitchClass, this.register) }, 'restart'); }
  answer(event: NoteEvent, responseMs: number | null): 'progress' | 'miss' | 'hit' | 'ignored' {
    if (this.phase !== 'playing') return 'ignored';
    const result = this.tracker.push(event);
    if (result === 'error') { this.mistakes++; return 'miss'; }
    if (result !== 'complete') return result === 'progress' ? 'progress' : 'ignored';
    this.results.push({ index: this.index, mistakes: this.mistakes, responseMs }); this.advance();
    return 'hit';
  }
  skip() { if (this.phase !== 'playing') return; this.results.push({ index: this.index, mistakes: -1, responseMs: null }); this.advance(); }
  private advance() {
    this.mistakes = 0;
    if (this.index + 1 < this.chords.length) this.index++;
    else if (this.repeats !== null && this.pass >= this.repeats) { this.phase = 'finished'; return; }
    else { this.index = 0; this.pass++; }
    this.tracker = this.track();
  }
  pause() { if (this.phase === 'playing') { this.phase = 'paused'; this.tracker.reset(); } }
  resume() { if (this.phase === 'paused') this.phase = 'playing'; }
  finish() { this.phase = 'finished'; }
}

/** Ninths and thirteenths of the chord's scale (second and sixth letters above the root), named as tensions and not
 * already chord tones. Used by the line trainer's tension option. */
export function scaleTensions(chord: ChordSymbol, key: KeyInfo | null = null): ChordTone[] {
  const chordPcs = chordTones(chord).map(t => t.pitchClass), names: Record<string, string> = { '2': '9', '♭2': '♭9', '♯2': '♯9', '♭9': '♭9', '♯9': '♯9', '9': '9', '6': '13', '♭6': '♭13', '13': '13', '♭13': '♭13' };
  return chordScale(chord, key).filter(t => (steps(t.degree) === 1 || steps(t.degree) === 5) && names[t.degree] && !chordPcs.includes(t.pitchClass))
    .map(t => ({ ...t, degree: names[t.degree] }));
}

/** L7 opens when 80% of the L4 items are mastered (§4.6.1): the 3rd and the 7th of maj7, m7, 7 and m7♭5 on the twelve
 * pitch classes, 96 in all. An item counts when any of its records is mastered, in any layer; answering the 3rd and
 * 7th together (guide) counts for both. The denominator is fixed, so one mastered item out of one tried is not enough. */
export const guideToneQualities = ['maj7', 'min7', 'dom7', 'half-dim'];
export const unlockShare = .8;
export function advancedStatus(data: TrainingData) {
  const mastered = new Set<string>();
  for (const stat of Object.values(data.stats)) {
    const match = /^ct:([^:]+):([^:]+):(third|seventh|guide)$/.exec(stat.itemId);
    if (!match || !guideToneQualities.includes(match[1])) continue;
    let pc: number;
    try { pc = pitchOf(match[2]); } catch { continue; }
    if (!isMastered(stat, stat.layer === 'performance' ? defaultTargetMs('play') : defaultTargetMs('name'))) continue;
    for (const role of match[3] === 'guide' ? ['third', 'seventh'] : [match[3]]) mastered.add(`${match[1]}:${pc}:${role}`);
  }
  const total = guideToneQualities.length * 12 * 2;
  return { mastered: mastered.size, total, ratio: mastered.size / total, unlocked: mastered.size >= Math.ceil(total * unlockShare) };
}
/** Whether advanced content is offered: by mastery, or always when the player chose to show everything. */
export const advancedOpen = (data: TrainingData) => data.preferences.showAdvanced === true || advancedStatus(data).unlocked;
export const advancedOptions = (data: TrainingData): AvoidOptions => ({ dorianThirteenth: data.preferences.dorianThirteenth === true });
