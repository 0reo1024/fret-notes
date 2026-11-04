import { chords, scales, spell, pitchOf, interval, tonesFor } from './theory';

/** A note name such as 'E♭', 'B♭♭' or 'E♯'. Roots outside theory's `roots` list are valid here. */
export type SpelledNote = string;
export interface ChordTone { degree: string; name: SpelledNote; pitchClass: number }
export type ChordSymbol = { root: SpelledNote; quality: string };

const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], naturals = [0, 2, 4, 5, 7, 9, 11];
const mod = (n: number, m = 12) => (n % m + m) % m;
export const isSpelledNote = (s: string) => /^[A-G](♭{1,2}|♯{1,2})?$/.test(s);
function checkNote(note: string) { if (!isSpelledNote(note)) throw new Error(`音名が不正です: ${note}`); }
/** Spells a pitch class on a given letter; more than a double accidental is an error. */
function spellOn(letter: number, pitchClass: number) {
  let delta = mod(pitchClass - naturals[letter]); if (delta > 6) delta -= 12;
  if (Math.abs(delta) > 2) throw new Error('三重以上の変化記号になります');
  return letters[letter] + (delta < 0 ? '♭'.repeat(-delta) : '♯'.repeat(delta));
}
const steps = (degree: string) => degree === 'R' ? 0 : (Number(/\d+$/.exec(degree)![0]) - 1) % 7;

/** Up uses theory's spell; down spells the letter that lies the same number of steps below. */
export function transpose(note: SpelledNote, degree: string, direction: 'up' | 'down' = 'up'): SpelledNote {
  checkNote(note);
  if (direction === 'up') return spell(note, degree);
  return spellOn(mod(letters.indexOf(note[0]) - steps(degree), 7), pitchOf(note) - interval(degree));
}

export type IntervalId = 'm2'|'M2'|'m3'|'M3'|'P4'|'A4'|'d5'|'P5'|'A5'|'m6'|'M6'|'m7'|'M7'|'P8'|'m9'|'M9'|'A9'|'P11'|'A11'|'m13'|'M13';
const intervalDegrees: Record<IntervalId, string> = {
  m2: '♭2', M2: '2', m3: '♭3', M3: '3', P4: '4', A4: '♯4', d5: '♭5', P5: '5', A5: '♯5', m6: '♭6', M6: '6', m7: '♭7', M7: '7',
  P8: '8', m9: '♭9', M9: '9', A9: '♯9', P11: '11', A11: '♯11', m13: '♭13', M13: '13',
};
export const intervalIds = Object.keys(intervalDegrees) as IntervalId[];
export const intervalDegree = (id: IntervalId) => intervalDegrees[id];
export function intervalSemitones(id: IntervalId) {
  const degree = intervalDegrees[id], number = Number(/\d+$/.exec(degree)![0]);
  return interval(degree) + 12 * Math.floor((number - 1) / 7);
}

const pattern = (quality: string) => { const p = chords.find(c => c.id === quality); if (!p) throw new Error(`未対応のコードです: ${quality}`); return p; };
export const chordName = (c: ChordSymbol) => c.root + pattern(c.quality).suffix;
export function chordTones(c: ChordSymbol): ChordTone[] {
  checkNote(c.root);
  return tonesFor(c.root, pattern(c.quality)).map(t => ({ degree: t.degree, name: t.name, pitchClass: t.pitch }));
}

export type DegreeRole = 'root'|'third'|'fifth'|'seventh'|'ninth'|'sixth'|'fourth'|'second';
const roleDegrees: Record<DegreeRole, string[]> = {
  root: ['R'], third: ['3', '♭3'], fifth: ['5', '♭5', '♯5'], seventh: ['7', '♭7', '♭♭7'],
  ninth: ['9', '♭9', '♯9'], sixth: ['6', '♭6'], fourth: ['4', '♯4'], second: ['2', '♭2'],
};
/** Only degrees present in the chord formula; sus chords have no third and sixth chords no seventh. */
export function toneByRole(c: ChordSymbol, role: DegreeRole): ChordTone | null {
  return chordTones(c).find(t => roleDegrees[role].includes(t.degree)) ?? null;
}

// Alternate spellings map onto catalog suffixes; anything else is rejected rather than guessed.
const aliases: Record<string, string> = {
  M: '', maj: '', min: 'm', '-': 'm',
  M7: 'maj7', 'Δ7': 'maj7', 'Δ': 'maj7', ma7: 'maj7',
  '-7': 'm7', min7: 'm7', mi7: 'm7',
  'ø': 'm7♭5', 'ø7': 'm7♭5', '-7♭5': 'm7♭5', 'min7♭5': 'm7♭5',
  '°': 'dim', o: 'dim', '°7': 'dim7', o7: 'dim7', '+': 'aug', sus: 'sus4', '7sus': '7sus4',
  '-6': 'm6', min6: 'm6',
  mMaj7: 'm(maj7)', mmaj7: 'm(maj7)', 'm(M7)': 'm(maj7)', 'mΔ7': 'm(maj7)', 'm(Δ7)': 'm(maj7)', '-Δ7': 'm(maj7)', minmaj7: 'm(maj7)',
  M9: 'maj9', 'Δ9': 'maj9', '-9': 'm9', min9: 'm9',
  '69': '6/9', 'maj7(♯11)': 'maj7♯11', '7(♭9)': '7♭9', '7(♯9)': '7♯9', '7(♯11)': '7♯11', '7(♭13)': '7♭13',
};
export function parseChordSymbol(text: string): ChordSymbol | { error: string } {
  const match = /^([A-G])([b#♭♯]{0,2})(.*)$/.exec(text.trim());
  if (!match) return { error: `コード名を読み取れません: ${text}` };
  const root = match[1] + match[2].replace(/b/g, '♭').replace(/#/g, '♯');
  if (!isSpelledNote(root)) return { error: `ルートの変化記号が不正です: ${text}` };
  const raw = match[3].replace(/b/g, '♭').replace(/#/g, '♯'), suffix = aliases[raw] ?? raw;
  const found = chords.find(c => c.suffix === suffix);
  return found ? { root, quality: found.id } : { error: `未対応のコードです: ${text}` };
}

export type KeyMode = 'major'|'natural-minor'|'harmonic-minor';
export type HarmonicFunction = 'T'|'SD'|'D';
export interface DiatonicChord { roman: string; root: SpelledNote; chord: ChordSymbol | null; func: HarmonicFunction | null }
const modeScale: Record<KeyMode, string> = { major: 'ionian', 'natural-minor': 'aeolian', 'harmonic-minor': 'harmonic-minor' };
const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
// Stacked-third semitones (3rd, 5th, 7th) → catalog quality and roman-numeral suffix.
const seventhQualities: Record<string, { quality: string | null; upper: boolean; suffix: string }> = {
  '4,7,11': { quality: 'maj7', upper: true, suffix: 'maj7' }, '3,7,10': { quality: 'min7', upper: false, suffix: '7' },
  '4,7,10': { quality: 'dom7', upper: true, suffix: '7' }, '3,6,10': { quality: 'half-dim', upper: false, suffix: 'ø7' },
  '3,6,9': { quality: 'dim7', upper: false, suffix: '°7' }, '3,7,11': { quality: 'minmaj7', upper: false, suffix: '(maj7)' },
  // The catalog has no augmented major seventh (harmonic minor ♭III), so that chord has no symbol.
  '4,8,11': { quality: null, upper: true, suffix: '+maj7' },
};
/** Function labels are fixed by this app: major I/iii/vi=T, ii/IV=SD, V/vii=D.
 * Minor schools differ, so only i=T, iiø/iv=SD and the harmonic-minor V7=D are labelled. */
function functionOf(mode: KeyMode, index: number, quality: string | null): HarmonicFunction | null {
  if (mode === 'major') return ([0, 2, 5].includes(index) ? 'T' : [1, 3].includes(index) ? 'SD' : 'D');
  if (index === 0) return 'T';
  if (index === 1 || index === 3) return 'SD';
  return index === 4 && quality === 'dom7' ? 'D' : null;
}
/** Roots are spelled from the tonic, so F♯ major's vii is E♯m7♭5 and G♭ major's IV is C♭maj7. */
export function diatonicSevenths(tonic: SpelledNote, mode: KeyMode): DiatonicChord[] {
  checkNote(tonic);
  const degrees = scales.find(s => s.id === modeScale[mode])!.degrees, major = scales.find(s => s.id === 'ionian')!.degrees;
  const pcs = degrees.map(d => mod(pitchOf(tonic) + interval(d)));
  return degrees.map((degree, index) => {
    const root = spell(tonic, degree), stack = [2, 4, 6].map(n => mod(pcs[(index + n) % 7] - pcs[index]));
    const shape = seventhQualities[stack.join(',')];
    if (!shape) throw new Error(`未対応の七の和音です: ${root}`);
    const lowered = interval(degree) < interval(major[index]) ? '♭' : '';
    const numeral = shape.upper ? numerals[index] : numerals[index].toLowerCase();
    return { roman: lowered + numeral + shape.suffix, root, chord: shape.quality ? { root, quality: shape.quality } : null, func: functionOf(mode, index, shape.quality) };
  });
}

/** Moves every root by the letter distance and semitone distance between the two tonics. */
export function transposeProgression(progression: ChordSymbol[], from: SpelledNote, to: SpelledNote): ChordSymbol[] {
  checkNote(from); checkNote(to);
  const letterShift = letters.indexOf(to[0]) - letters.indexOf(from[0]), semitones = pitchOf(to) - pitchOf(from);
  return progression.map(c => { checkNote(c.root); return { root: spellOn(mod(letters.indexOf(c.root[0]) + letterShift, 7), pitchOf(c.root) + semitones), quality: c.quality }; });
}
export const samePitchClass = (a: SpelledNote, b: SpelledNote) => pitchOf(a) === pitchOf(b);
