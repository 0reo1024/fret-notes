import { chordName, chordTones, type ChordSymbol } from '../music/harmony';
import { describeOver } from './tone-questions';
import { scaleTensions } from './advanced';

/** Which chord tones a line may use, how far it may move between chords, and the register it stays in. */
export interface LineConstraint { allowedDegrees: 'guide' | 'chord-tones' | 'tensions'; maxSemitones: number; register: [number, number] }
export type LineStart = 'free' | 'third' | 'seventh';
export interface LineNote { midi: number; name: string; degree: string }
const thirds = ['3', '♭3'], sevenths = ['7', '♭7', '♭♭7'];
const role = (degree: string) => thirds.includes(degree) ? 'third' : sevenths.includes(degree) ? 'seventh' : 'other';
/** Chords without a 3rd or 7th (sus, 6) fall back to all chord tones so a guide-tone line can still pass through.
 * `tensions` adds the 9th and 13th of the chord's scale to all chord tones. */
function allowedTones(chord: ChordSymbol, constraint: LineConstraint) {
  const tones = chordTones(chord), guide = tones.filter(t => role(t.degree) !== 'other');
  if (constraint.allowedDegrees === 'tensions') return [...tones, ...scaleTensions(chord)];
  return constraint.allowedDegrees === 'guide' && guide.length ? guide : tones.filter(t => t.degree !== 'R' || constraint.allowedDegrees === 'chord-tones');
}
/** Every allowed note of the chord inside the register, spelled from the chord. */
export function candidatesFor(chord: ChordSymbol, constraint: LineConstraint): LineNote[] {
  const tones = allowedTones(chord, constraint), notes: LineNote[] = [];
  for (let midi = constraint.register[0]; midi <= constraint.register[1]; midi++) {
    const tone = tones.find(t => t.pitchClass === midi % 12);
    if (tone) notes.push({ midi, name: tone.name, degree: tone.degree });
  }
  return notes;
}
export const nextAllowed = (previous: number, chord: ChordSymbol, constraint: LineConstraint) => candidatesFor(chord, constraint).filter(n => Math.abs(n.midi - previous) <= constraint.maxSemitones);
const startsWith = (start: LineStart) => (note: LineNote) => start === 'free' || role(note.degree) === start;

/** All lines through the chords (one note per chord) that satisfy the constraint, stopping at `limit`.
 * Every one of them is a right answer; none is preferred. */
export function enumerateLines(chords: ChordSymbol[], start: number | LineStart | null, constraint: LineConstraint, limit = 200): LineNote[][] {
  const lines: LineNote[][] = [];
  const first = candidatesFor(chords[0], constraint).filter(n => typeof start === 'number' ? n.midi === start : startsWith(start ?? 'free')(n));
  const walk = (path: LineNote[]) => {
    if (lines.length >= limit) return;
    if (path.length === chords.length) { lines.push(path); return; }
    for (const note of nextAllowed(path.at(-1)!.midi, chords[path.length], constraint)) walk([...path, note]);
  };
  for (const note of first) walk([note]);
  return lines;
}

export interface LineTraits { commonTones: number; halfSteps: number; wholeSteps: number; guideSwaps: number; ups: number; downs: number }
/** Facts about a line, never a grade: held common tones, half and whole steps, 3rd↔7th exchanges and direction. */
export function describeLine(line: LineNote[]): LineTraits {
  const traits: LineTraits = { commonTones: 0, halfSteps: 0, wholeSteps: 0, guideSwaps: 0, ups: 0, downs: 0 };
  for (let i = 1; i < line.length; i++) {
    const step = line[i].midi - line[i - 1].midi, a = role(line[i - 1].degree), b = role(line[i].degree);
    if (step === 0) traits.commonTones++; else if (Math.abs(step) === 1) traits.halfSteps++; else if (Math.abs(step) === 2) traits.wholeSteps++;
    if (step > 0) traits.ups++; if (step < 0) traits.downs++;
    if (a !== 'other' && b !== 'other' && a !== b) traits.guideSwaps++;
  }
  return traits;
}
export const formatLine = (line: LineNote[]) => line.map(n => `${n.name}(${n.degree})`).join(' → ');
export function traitText(traits: LineTraits, length: number) {
  const parts = [`共通音の保持 ${traits.commonTones}回`, `半音 ${traits.halfSteps}回`, `全音 ${traits.wholeSteps}回`];
  if (traits.guideSwaps) parts.push(`3rd↔7th の入れ替わり ${traits.guideSwaps}回`);
  parts.push(traits.ups > traits.downs ? '上行ぎみ' : traits.downs > traits.ups ? '下行ぎみ' : length > 1 ? '上下に均衡' : '');
  return parts.filter(Boolean).join('・');
}
/** Up to four example lines chosen by different traits, each labelled by what it shows. */
export function representativeLines(lines: LineNote[][]): { label: string; line: LineNote[] }[] {
  const picks: { label: string; score: (t: LineTraits) => number }[] = [
    { label: '共通音を多く保持', score: t => t.commonTones },
    { label: '半音の動きが多い', score: t => t.halfSteps },
    { label: '3rd と 7th が入れ替わる', score: t => t.guideSwaps },
    { label: '上行する', score: t => t.ups - t.downs },
    { label: '下行する', score: t => t.downs - t.ups },
  ];
  const chosen: { label: string; line: LineNote[] }[] = [];
  for (const pick of picks) {
    if (chosen.length === 4) break;
    // The best line for this trait that is not already shown (lines differing only by octave count as the same).
    const best = lines.map(line => ({ line, value: pick.score(describeLine(line)) })).filter(x => x.value > 0 && !chosen.some(c => formatLine(c.line) === formatLine(x.line))).sort((a, b) => b.value - a.value)[0];
    if (best) chosen.push({ label: pick.label, line: best.line });
  }
  return chosen;
}

export type LineVerdict = { ok: true; note: LineNote } | { ok: false; reason: string };
/** Step-by-step line practice: one note per chord; each note is checked against the chord, the start rule and the distance limit. */
export class LineRun {
  index = 0; mistakes = 0; readonly notes: LineNote[] = []; readonly mistakesAt: number[] = [];
  phase: 'playing' | 'finished' = 'playing';
  constructor(readonly chords: (ChordSymbol & { symbol?: string })[], readonly constraint: LineConstraint, readonly start: LineStart) {
    if (!chords.length) throw new Error('進行が空です');
  }
  get chord() { return this.chords[this.index]; }
  /** Notes allowed now, for the optional hint. */
  allowed(): LineNote[] {
    const all = candidatesFor(this.chord, this.constraint);
    return this.index === 0 ? all.filter(startsWith(this.start)) : all.filter(n => Math.abs(n.midi - this.notes.at(-1)!.midi) <= this.constraint.maxSemitones);
  }
  answer(midi: number): LineVerdict | null {
    if (this.phase !== 'playing') return null;
    const chord = this.chord, symbol = chord.symbol ?? chordName(chord), pc = midi % 12;
    const fail = (reason: string): LineVerdict => { this.mistakes++; this.mistakesAt.push(this.index); return { ok: false, reason }; };
    if (midi < this.constraint.register[0] || midi > this.constraint.register[1]) return fail('練習範囲の音域外です');
    const note = candidatesFor(chord, this.constraint).find(n => n.midi === midi);
    if (!note) return fail(`${symbol} の上でこの音は使えません（${describeOver(chord.root, chordTones(chord), pc)}）`);
    if (this.index === 0 && !startsWith(this.start)(note)) return fail(`最初の音は ${this.start === 'third' ? '3rd' : '7th'} から始めてください`);
    const previous = this.notes.at(-1);
    if (previous && Math.abs(midi - previous.midi) > this.constraint.maxSemitones) return fail(`前の音から ${Math.abs(midi - previous.midi)}半音です（上限 ${this.constraint.maxSemitones}半音）`);
    this.notes.push(note);
    if (++this.index >= this.chords.length) this.phase = 'finished';
    return { ok: true, note };
  }
  finish() { this.phase = 'finished'; }
}
