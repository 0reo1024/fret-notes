import { chordName, chordTones, diatonicSevenths, transpose } from '../music/harmony';
import { pitchOf, scales, tonesFor } from '../music/theory';

export type EarKind = 'single' | 'interval' | 'melody' | 'chord';
export type EarKey = { tonic: string; mode: 'major' | 'minor' };
export interface EarNote { midi: number; name: string; degree: string }
export interface EarQuestion { kind: EarKind; key: EarKey; notes: EarNote[]; chord: string | null; chromatic: boolean; level: number; itemId: string }
export const maxLevel = 8;
export const kindNames: Record<EarKind, string> = { single: '単音', interval: 'インターバル', melody: 'メロディ', chord: 'コードトーンのメロディ' };

/** What each level asks: how many notes, the widest leap in semitones, and whether notes outside the key appear. */
export function levelShape(kind: EarKind, level: number) {
  const l = Math.min(maxLevel, Math.max(1, Math.round(level)));
  if (kind === 'single') return { length: 1, leap: [5, 7, 12, 12, 12, 17, 17, 19][l - 1], chromatic: l >= 5 };
  if (kind === 'interval') return { length: 2, leap: [4, 5, 7, 9, 12, 12, 12, 12][l - 1], chromatic: l >= 6 };
  if (kind === 'chord') return { length: [2, 3, 3, 4, 4, 5, 6, 8][l - 1], leap: [7, 7, 9, 9, 12, 12, 12, 12][l - 1], chromatic: false };
  return { length: [2, 3, 3, 4, 4, 5, 6, 8][l - 1], leap: [2, 2, 4, 4, 7, 7, 9, 12][l - 1], chromatic: l >= 7 };
}

export const scaleOf = (key: EarKey) => tonesFor(key.tonic, scales.find(s => s.id === (key.mode === 'major' ? 'ionian' : 'aeolian'))!);
/** Names a pitch in the key: scale tones keep the key's spelling, other tones are named by their degree over the tonic. */
export function nameInKey(key: EarKey, midi: number): EarNote {
  const scale = scaleOf(key), pc = midi % 12, tone = scale.find(t => t.pitch === pc);
  if (tone) return { midi, name: tone.name, degree: tone.degree };
  // Outside the key: ♭2, ♭3, ♯4, ♭6, ♭7 in major; ♭2, 3, ♯4, 6, 7 in minor (the raised 6th and 7th of melodic/harmonic minor).
  const degree = ['R', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'][(pc - pitchOf(key.tonic) + 12) % 12];
  return { midi, name: transpose(key.tonic, degree), degree };
}
/** The tonic placed in the lower-middle of the playable range, so melodies above and below it stay playable. */
export function tonicMidi(key: EarKey, range: [number, number]) {
  const target = Math.round(range[0] + (range[1] - range[0]) * .35), pc = pitchOf(key.tonic);
  let midi = target - ((target - pc) % 12 + 12) % 12;
  if (midi < range[0]) midi += 12;
  return midi;
}

/** A melody for the kind and level: starts on the tonic or a chord tone, stays in range and, unless chromatic, in the key.
 * A pitch is repeated back to back only when `allowRepeats` is set (it needs onset detection to tell a re-pick from a held note). */
export function generateMelody(kind: EarKind, level: number, key: EarKey, range: [number, number], random = Math.random, allowRepeats = false): EarQuestion {
  const shape = levelShape(kind, level), tonic = tonicMidi(key, range);
  const low = Math.max(range[0], tonic - 7), high = Math.min(range[1], tonic + (shape.leap >= 12 ? 17 : 12));
  const scalePcs = scaleOf(key).map(t => t.pitch);
  let chord: { root: string; quality: string } | null = null, allowedPcs = scalePcs;
  if (kind === 'chord') {
    const table = diatonicSevenths(key.tonic, key.mode === 'major' ? 'major' : 'natural-minor').filter(c => c.chord);
    chord = table[Math.floor(random() * table.length)].chord!;
    allowedPcs = chordTones(chord).map(t => t.pitchClass);
  }
  const pool = (chromatic: boolean) => { const notes: number[] = []; for (let m = low; m <= high; m++) if (chromatic || allowedPcs.includes(m % 12)) notes.push(m); return notes; };
  const choose = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  const starts = kind === 'chord' ? pool(false).filter(m => Math.abs(m - tonic) <= 12) : kind === 'single' ? pool(shape.chromatic) : pool(false).filter(m => m % 12 === tonic % 12 || chordTones({ root: key.tonic, quality: key.mode === 'major' ? 'major' : 'minor' }).some(t => t.pitchClass === m % 12));
  const notes = [choose(starts.length ? starts : pool(false))];
  while (notes.length < shape.length) {
    const previous = notes.at(-1)!;
    const options = pool(shape.chromatic && kind !== 'chord').filter(m => (allowRepeats || m !== previous) && Math.abs(m - previous) <= shape.leap);
    notes.push(choose(options.length ? options : pool(false).filter(m => m !== previous)));
  }
  const named = notes.map(m => nameInKey(key, m));
  const chromatic = named.some(n => !scalePcs.includes(n.midi % 12));
  return {
    kind, key, notes: named, chord: chord ? chordName(chord) : null, chromatic, level,
    itemId: `ear:${kind}:${shape.length}:${chromatic ? 'chromatic' : 'diatonic'}`,
  };
}

/** Two right in a row move up a level; one wrong moves down. Skips leave it alone. */
export interface Staircase { level: number; streak: number }
export function staircase(state: Staircase, correct: boolean): Staircase {
  if (!correct) return { level: Math.max(1, state.level - 1), streak: 0 };
  return state.streak + 1 >= 2 ? { level: Math.min(maxLevel, state.level + 1), streak: 0 } : { level: state.level, streak: state.streak + 1 };
}

/** Compares a played sequence with the target after it is complete: per-note marks and how many edits separate them. */
export function compareSequence(target: number[], played: number[], matchOctave: boolean) {
  const same = (a: number, b: number) => matchOctave ? a === b : a % 12 === b % 12;
  const marks = target.map((t, i) => played[i] !== undefined && same(t, played[i]));
  const d = Array.from({ length: target.length + 1 }, (_, i) => Array.from({ length: played.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= target.length; i++) for (let j = 1; j <= played.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (same(target[i - 1], played[j - 1]) ? 0 : 1));
  return { marks, distance: d[target.length][played.length], correct: d[target.length][played.length] === 0 };
}
/** Playback timing: optional key context, then the melody; input is ignored until it ends plus a margin (half duplex). */
export function playbackPlan(question: EarQuestion, context: 'tonic' | 'cadence' | 'none', noteSeconds: number) {
  const events: { midis: number[]; at: number; duration: number }[] = [];
  let at = 0;
  const tonic = tonicMidi(question.key, [question.notes[0].midi - 24, question.notes[0].midi + 24]);
  const base = question.notes.reduce((m, n) => Math.min(m, n.midi), 127), root = base - ((base - tonic) % 12 + 12) % 12;
  if (context === 'tonic') { events.push({ midis: [root], at, duration: .8 }); at += 1.2; }
  if (context === 'cadence') {
    const third = question.key.mode === 'major' ? 4 : 3;
    for (const [offset, quality] of [[0, third], [5, question.key.mode === 'major' ? 4 : 3], [7, 4], [0, third]] as const) {
      events.push({ midis: [root + offset - 12, root + offset + quality - 12, root + offset + 7 - 12], at, duration: .55 }); at += .6;
    }
    at += .5;
  }
  for (const note of question.notes) { events.push({ midis: [note.midi], at, duration: noteSeconds * .9 }); at += noteSeconds; }
  return { events, totalSeconds: at };
}
