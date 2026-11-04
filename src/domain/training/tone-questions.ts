import { chordName, chordTones, toneByRole, isSpelledNote, type ChordSymbol, type ChordTone, type DegreeRole } from '../music/harmony';
import { pitchOf } from '../music/theory';
import type { AttemptResult } from './records';
import type { Position } from '../instruments/core';

/** Which tones a question asks for. `guide` asks the 3rd and the 7th together. */
export type ToneMode = 'third' | 'seventh' | 'guide' | 'all' | 'ninth';
export type QualityStage = 'triads' | 1 | 2 | 3;
export type RootSet = 'standard' | 'extended';
export interface ToneConfig { mode: ToneMode; stage: QualityStage; roots: RootSet; sharpSix: boolean }
/** Shape shared by every harmony question kind (chord tones, intervals, arpeggios, keys).
 * `related` are the tones a near miss is compared with; `labels` questions answer with names such as chord symbols. */
export interface DrillQuestion {
  itemId: string; title: string; ask: string; answers: ChordTone[]; related: ChordTone[]; root: string;
  labels?: boolean; choicePool?: string[];
  /** Fretboard questions: a shown starting point and the exact positions that count. */
  rootPosition?: Position; positions?: Position[]; hint?: string;
  /** Sequences (arpeggios) are answered in order; played notes must match these absolute pitches. */
  ordered?: boolean; midis?: number[];
}
export interface ToneQuestion extends DrillQuestion { chord: ChordSymbol; symbol: string; roles: DegreeRole[] }

export const stageQualities: Record<string, string[]> = {
  triads: ['major', 'minor', 'dim', 'aug'],
  1: ['maj7', 'min7', 'dom7'],
  2: ['maj7', 'min7', 'dom7', 'half-dim', 'dim7', 'minmaj7'],
  3: ['maj7', 'min7', 'dom7', 'half-dim', 'dim7', 'minmaj7', 'six', 'min6', 'nine', 'maj9', 'min9'],
};
/** Usual key spellings; F♯ or G♭ by preference. The extended set adds roots that lead to double accidentals. */
export function rootsFor(set: RootSet, sharpSix: boolean) {
  const standard = ['C', 'D♭', 'D', 'E♭', 'E', 'F', sharpSix ? 'F♯' : 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  return set === 'standard' ? standard : ['C', 'C♯', 'D♭', 'D', 'D♯', 'E♭', 'E', 'F', 'F♯', 'G♭', 'G', 'G♯', 'A♭', 'A', 'A♯', 'B♭', 'B'];
}
export const roleLabels: Record<DegreeRole, string> = { root: 'ルート', third: '3rd', fifth: '5th', seventh: '7th', ninth: '9th', sixth: '6th', fourth: '4th', second: '2nd' };
const askable: DegreeRole[] = ['third', 'fifth', 'seventh', 'sixth', 'fourth', 'second', 'ninth'];
/** Role sets asked for one chord; a chord without the role (sus has no 3rd, 6 has no 7th) is left out. */
function roleSets(chord: ChordSymbol, mode: ToneMode): DegreeRole[][] {
  const has = (role: DegreeRole) => toneByRole(chord, role) !== null;
  if (mode === 'guide') return has('third') && has('seventh') ? [['third', 'seventh']] : [];
  if (mode === 'all') return askable.filter(has).map(role => [role]);
  const role: DegreeRole = mode === 'third' ? 'third' : mode === 'seventh' ? 'seventh' : 'ninth';
  return has(role) ? [[role]] : [];
}
export function makeQuestion(chord: ChordSymbol, roles: DegreeRole[]): ToneQuestion {
  const symbol = chordName(chord);
  return {
    chord, symbol, roles, answers: roles.map(role => toneByRole(chord, role)!), title: symbol, ask: `${roles.map(role => roleLabels[role]).join(' と ')} ?`,
    related: chordTones(chord), root: chord.root,
    itemId: `ct:${chord.quality}:${chord.root}:${roles.length === 2 ? 'guide' : roles[0]}`,
  };
}
export function allQuestions(config: ToneConfig): ToneQuestion[] {
  return rootsFor(config.roots, config.sharpSix).flatMap(root => stageQualities[config.stage].flatMap(quality => {
    const chord = { root, quality };
    return roleSets(chord, config.mode).map(roles => makeQuestion(chord, roles));
  }));
}
/** Shuffled round with no chord and no answer pitch repeated back to back where avoidable, including across rounds.
 * A held note must not answer the next question by accident. */
/** Same chord, or an answer pitch in common: a held note must not answer the next question. */
export const questionClash = (a: DrillQuestion | null, b: DrillQuestion) => !!a && (a.title === b.title || a.answers.some(x => b.answers.some(y => x.pitchClass === y.pitchClass)));
export function toneDeck<Q extends DrillQuestion>(questions: Q[], random = Math.random, last: Q | null = null): Q[] {
  const clash = questionClash;
  // Greedy placement can strand clashing questions at the end, so a few shuffles are tried and the cleanest kept.
  let best: Q[] = [], bestClashes = Infinity;
  for (let attempt = 0; attempt < 20 && bestClashes > 0; attempt++) {
    const round = questions.slice(), deck: Q[] = [];
    for (let i = round.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [round[i], round[j]] = [round[j], round[i]]; }
    while (round.length) {
      const index = round.findIndex(q => !clash(deck.at(-1) ?? last, q));
      deck.push(round.splice(index < 0 ? 0 : index, 1)[0]);
    }
    const clashes = deck.filter((q, i) => clash(i ? deck[i-1] : last, q)).length;
    if (clashes < bestClashes) { best = deck; bestClashes = clashes; }
  }
  return best;
}

export type NameVerdict = { result: 'correct' | 'spelling' | 'wrong'; errorKind?: 'quality-confusion' | 'degree-confusion' | 'spelling' | 'other' };
/** Pitch decides by default and a different spelling of the right pitch is marked `spelling`; strict spelling makes it wrong.
 * Wrong answers are classified: same letter (G♭ for G) is a quality mix-up, another chord tone is a degree mix-up. */
export function checkName(question: DrillQuestion, step: number, name: string, strict: boolean): NameVerdict {
  const expected = question.answers[step];
  if (question.labels) return name === expected.name ? { result: 'correct' } : { result: 'wrong', errorKind: 'other' };
  if (!isSpelledNote(name)) return { result: 'wrong', errorKind: 'other' };
  if (name === expected.name) return { result: 'correct' };
  const pc = pitchOf(name);
  if (pc === expected.pitchClass) return strict ? { result: 'wrong', errorKind: 'spelling' } : { result: 'spelling', errorKind: 'spelling' };
  if (name[0] === expected.name[0]) return { result: 'wrong', errorKind: 'quality-confusion' };
  if (question.related.some(t => t.pitchClass === pc)) return { result: 'wrong', errorKind: 'degree-confusion' };
  return { result: 'wrong', errorKind: 'other' };
}

const shiftAccidental = (name: string, by: number) => {
  const alter = [...name.slice(1)].reduce((n, a) => n + (a === '♯' ? 1 : -1), 0) + by;
  return Math.abs(alter) > 2 ? null : name[0] + (alter < 0 ? '♭'.repeat(-alter) : '♯'.repeat(alter));
};
/** Four spelled choices with exactly one right answer. Distractors in order of usefulness: the other quality's tone
 * (same letter), the chord's other tones, then near neighbours. Strict spelling may add an enharmonic of the answer. */
export function toneChoices(question: DrillQuestion, step: number, random = Math.random, strict = false): string[] {
  const expected = question.answers[step];
  if (question.labels) {
    const pool = [...new Set(question.choicePool ?? [])].filter(name => name !== expected.name);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const picked = pool.slice(0, 3); picked.splice(Math.floor(random() * (picked.length + 1)), 0, expected.name);
    return picked;
  }
  const others = question.related.filter(t => t.pitchClass !== expected.pitchClass).map(t => t.name);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  // Double accidentals only appear as distractors when the answer itself has one (B♭♭ → B♭, not F♭ → F♭♭).
  const doubled = (name: string | null) => !!name && /♭♭|♯♯/.test(name) && !/♭♭|♯♯/.test(expected.name);
  const sameLetter = [shiftAccidental(expected.name, -1), shiftAccidental(expected.name, 1)].filter(name => !doubled(name));
  const neighbours = [1, -1, 2, -2].map(semi => {
    const pc = (expected.pitchClass + semi + 12) % 12;
    return ['C', 'D', 'E', 'F', 'G', 'A', 'B'].flatMap(l => ['', '♯', '♭'].map(a => l + a)).find(n => pitchOf(n) === pc)!;
  });
  const enharmonic = strict ? ['C', 'D', 'E', 'F', 'G', 'A', 'B'].flatMap(l => ['♯', '♭'].map(a => l + a)).find(n => pitchOf(n) === expected.pitchClass && n !== expected.name) : undefined;
  const pool = [enharmonic, ...sameLetter, ...others, ...neighbours].filter((n): n is string => !!n && isSpelledNote(n));
  const picked: string[] = [], pcs = new Set([expected.pitchClass]);
  for (const name of pool) {
    if (picked.length === 3) break;
    if (name === expected.name || picked.includes(name)) continue;
    const pc = pitchOf(name);
    if (pc === expected.pitchClass && name !== enharmonic) continue;
    if (pc !== expected.pitchClass && pcs.has(pc)) continue;
    picked.push(name); pcs.add(pc);
  }
  picked.splice(Math.floor(random() * (picked.length + 1)), 0, expected.name);
  return picked;
}

/** Degree of any pitch over the chord root, using the chord's own spelling for chord tones and tension names otherwise. */
export function describePitchClass(chord: ChordSymbol, pc: number): string { return describeOver(chord.root, chordTones(chord), pc); }
/** Same, over any root with the question's own named tones. */
export function describeOver(root: string, tones: ChordTone[], pc: number): string {
  const tone = tones.find(t => t.pitchClass === pc);
  if (tone) return tone.degree;
  return ['R', '♭9', '9', '♯9', '3', '11', '♯11', '5', '♭13', '13', '♭7', '7'][(pc - pitchOf(root) + 12) % 12];
}

export interface DrillOutcome { question: DrillQuestion; result: AttemptResult; errorKind?: string; responseMs: number | null; given: string[] }
/** One practice run: questions in rounds, the 3rd-then-7th order for typed guide answers, ordered sequences, and a fixed number of outcomes. */
export class ToneDrill {
  deck: DrillQuestion[]; index = 0; round = 1; step = 0;
  given: string[] = []; found = new Set<number>();
  private spelled = false;
  /** Wrong notes inside an ordered sequence before it was completed. */
  mistakes = 0;
  readonly outcomes: DrillOutcome[] = [];
  phase: 'asking' | 'answered' | 'finished' = 'asking';
  /** `order` builds each round (for example weak items first); by default the round is shuffled. */
  constructor(private readonly questions: DrillQuestion[], private readonly limit: number | null, private readonly random = Math.random,
    private readonly order: (questions: DrillQuestion[], last: DrillQuestion | null) => DrillQuestion[] = (q, last) => toneDeck(q, random, last)) {
    if (!questions.length) throw new Error('出題できるコードがありません');
    this.deck = order(questions, null);
  }
  get question() { return this.deck[this.index]; }
  get last() { return this.outcomes.at(-1) ?? null; }
  private resolve(result: AttemptResult, responseMs: number | null, errorKind?: string) {
    if (this.phase !== 'asking') return null;
    const outcome: DrillOutcome = { question: this.question, result, responseMs, given: this.given.slice(), ...(errorKind ? { errorKind } : {}) };
    this.outcomes.push(outcome); this.phase = 'answered';
    return outcome;
  }
  /** Typed or chosen names; guide questions take the 3rd, then the 7th. */
  answerName(name: string, strict: boolean, responseMs: number) {
    if (this.phase !== 'asking') return null;
    const verdict = checkName(this.question, this.step, name, strict);
    this.given.push(name);
    if (verdict.result === 'wrong') return this.resolve('wrong', responseMs, verdict.errorKind);
    if (this.step + 1 < this.question.answers.length) { this.step++; if (verdict.result === 'spelling') this.spelled = true; return 'partial' as const; }
    return this.resolve(verdict.result === 'spelling' || this.spelled ? 'spelling' : 'correct', responseMs, verdict.result === 'spelling' || this.spelled ? 'spelling' : undefined);
  }
  /** Clicked or played pitch classes, any order. A pitch that is not asked for ends the question as wrong. */
  answerPitchClass(pc: number, label: string, responseMs: number) {
    if (this.phase !== 'asking') return null;
    const index = this.question.answers.findIndex((a, i) => a.pitchClass === pc && !this.found.has(i));
    if (index < 0) {
      if (this.question.answers.some(a => a.pitchClass === pc)) return 'repeat' as const;
      this.given.push(label);
      const other = this.question.related.some(t => t.pitchClass === pc);
      // A semitone off an asked tone (major for minor 3rd, ♭7 for 7) is read as mixing up the chord quality.
      const semitoneOff = this.question.answers.some((a, i) => !this.found.has(i) && [1, 11].includes((a.pitchClass - pc + 12) % 12));
      return this.resolve('wrong', responseMs, other ? 'degree-confusion' : semitoneOff ? 'quality-confusion' : 'other');
    }
    this.found.add(index); this.given.push(this.question.answers[index].name);
    return this.found.size === this.question.answers.length ? this.resolve('correct', responseMs) : 'partial' as const;
  }
  /** One step of an ordered sequence. A wrong note restarts the sequence (or, with 'wait', stays on the step);
   * a sequence finished after mistakes is recorded as wrong so the item is reviewed again. */
  answerOrdered(ok: boolean, label: string, responseMs: number, onError: 'restart' | 'wait' = 'restart') {
    if (this.phase !== 'asking') return null;
    if (!ok) { this.mistakes++; if (onError === 'restart') { this.step = 0; this.given = []; } return 'restart' as const; }
    this.given.push(label); this.step++;
    if (this.step < this.question.answers.length) return 'partial' as const;
    return this.mistakes ? this.resolve('wrong', responseMs, `restarts:${this.mistakes}`) : this.resolve('correct', responseMs);
  }
  /** A wrong pitch found outside the question's rules (e.g. outside the playing register). */
  reject(label: string, errorKind: string, responseMs: number) { if (this.phase !== 'asking') return null; this.given.push(label); return this.resolve('wrong', responseMs, errorKind); }
  timeout() { return this.resolve('timeout', null); }
  skip(result: 'skipped' | 'self-marked' | 'detection-issue', responseMs: number | null) { return this.resolve(result, responseMs); }
  next() {
    if (this.phase !== 'answered') return;
    if (this.limit !== null && this.outcomes.length >= this.limit) { this.phase = 'finished'; return; }
    if (this.index + 1 < this.deck.length) this.index++;
    else { this.deck = this.order(this.questions, this.question); this.index = 0; this.round++; }
    this.step = 0; this.given = []; this.found.clear(); this.spelled = false; this.mistakes = 0; this.phase = 'asking';
  }
  finish() { this.phase = 'finished'; }
}
