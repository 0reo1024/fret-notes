import { chordName, chordTones, diatonicSevenths, parseChordSymbol, toneByRole, transpose, type ChordSymbol, type ChordTone, type KeyMode } from '../music/harmony';
import { pitchOf, scales, tonesFor } from '../music/theory';

export interface ProgressionChord extends ChordSymbol { symbol: string; beats: number }
export type KeyInfo = { tonic: string; mode: 'major' | 'minor' };
export interface Progression {
  id: string; name: string; source: 'builtin' | 'user'; key?: KeyInfo; romanNumerals?: string[];
  bars: ProgressionChord[][]; beatsPerBar: 4 | 3;
}
export type ParseError = { error: string; bar: number; index: number };

/** `Dm7 G7 | Cmaj7 | Cmaj7 |` — bars split by `|`, chords in a bar share its beats equally. */
export function parseProgression(text: string, beatsPerBar: 4 | 3 = 4): ProgressionChord[][] | ParseError {
  const bars = text.split('|').map(bar => bar.trim()).filter((bar, i, all) => bar || i < all.length - 1);
  if (!bars.length || bars.every(bar => !bar)) return { error: 'コードを入力してください', bar: 1, index: 1 };
  const result: ProgressionChord[][] = [];
  for (const [b, bar] of bars.entries()) {
    const tokens = bar.split(/\s+/).filter(Boolean);
    if (!tokens.length) return { error: `${b + 1}小節目が空です`, bar: b + 1, index: 1 };
    if (tokens.length > beatsPerBar) return { error: `${b + 1}小節目のコードが多すぎます（1小節に${beatsPerBar}つまで）`, bar: b + 1, index: tokens.length };
    const chords: ProgressionChord[] = [];
    for (const [i, token] of tokens.entries()) {
      const parsed = parseChordSymbol(token);
      if ('error' in parsed) return { error: `${b + 1}小節目の${i + 1}番目「${token}」は未対応のコードです`, bar: b + 1, index: i + 1 };
      chords.push({ ...parsed, symbol: chordName(parsed), beats: beatsPerBar / tokens.length });
    }
    result.push(chords);
  }
  if (result.length > 64) return { error: '64小節までです', bar: 65, index: 1 };
  return result;
}
export const formatProgression = (bars: ProgressionChord[][]) => bars.map(bar => bar.map(c => c.symbol).join(' ')).join(' | ') + ' |';
export const flatten = (progression: Progression) => progression.bars.flatMap((bar, b) => bar.map((chord, i) => ({ ...chord, bar: b, slot: i })));

/** Library entries are written as roman numerals: label, degree above the tonic, catalog quality. */
type Roman = [label: string, degree: string, quality: string];
interface LibraryEntry { id: string; name: string; mode: 'major' | 'minor'; bars: Roman[][] }
const R = (label: string, degree: string, quality: string): Roman => [label, degree, quality];
const I = R('Imaj7', 'R', 'maj7'), ii = R('ii7', '2', 'min7'), iii = R('iii7', '3', 'min7'), IV = R('IVmaj7', '4', 'maj7'), V = R('V7', '5', 'dom7'), vi = R('vi7', '6', 'min7');
const I7 = R('I7', 'R', 'dom7'), IV7 = R('IV7', '4', 'dom7'), VI7 = R('VI7', '6', 'dom7'), II7 = R('II7', '2', 'dom7'), v7 = R('v7', '5', 'min7');
const i7 = R('i7', 'R', 'min7'), iv7 = R('iv7', '4', 'min7'), ii7b5 = R('iiø7', '2', 'half-dim'), bVI = R('♭VImaj7', '♭6', 'maj7'), bVII = R('♭VII7', '♭7', 'dom7');
/** Common progressions only; no song melodies or lyrics are bundled. */
export const library: LibraryEntry[] = [
  { id: 'major-ii-v-i', name: 'II–V–I（メジャー）', mode: 'major', bars: [[ii], [V], [I], [I]] },
  { id: 'minor-ii-v-i', name: 'II–V–I（マイナー。V7 はハーモニックマイナー由来）', mode: 'minor', bars: [[ii7b5], [V], [i7], [i7]] },
  { id: 'major-i-iv-v-i', name: 'I–IV–V–I', mode: 'major', bars: [[I], [IV], [V], [I]] },
  { id: 'major-i-vi-ii-v', name: 'I–vi–ii–V（循環）', mode: 'major', bars: [[I], [vi], [ii], [V]] },
  { id: 'major-iii-vi-ii-v-i', name: 'iii–vi–ii–V–I', mode: 'major', bars: [[iii], [vi], [ii], [V], [I]] },
  { id: 'minor-i-iv-v-i', name: 'i–iv–v–i（ナチュラルマイナー）', mode: 'minor', bars: [[i7], [iv7], [v7], [i7]] },
  { id: 'minor-i-bvi-bvii', name: 'i–♭VI–♭VII–i（ナチュラルマイナー）', mode: 'minor', bars: [[i7], [bVI], [bVII], [i7]] },
  { id: 'secondary-i-vi7-ii-v', name: 'I–VI7–ii–V（セカンダリードミナント）', mode: 'major', bars: [[I], [VI7], [ii], [V]] },
  { id: 'secondary-i-ii7-ii-v-i', name: 'I–II7–ii–V–I（V7/V）', mode: 'major', bars: [[I], [II7], [ii], [V], [I]] },
  { id: 'blues-basic', name: '12小節ブルース（基本型）', mode: 'major', bars: [[I7], [IV7], [I7], [I7], [IV7], [IV7], [I7], [I7], [V], [IV7], [I7], [V]] },
  { id: 'blues-jazz', name: 'ジャズブルース（一般的な一例）', mode: 'major',
    bars: [[I7], [IV7], [I7], [v7, I7], [IV7], [R('♯iv°7', '♯4', 'dim7')], [I7], [iii, VI7], [ii], [V], [I7, VI7], [ii, V]] },
];
/** Spells every chord from the chosen tonic, so G♭ major's ii–V–I is A♭m7–D♭7–G♭maj7. */
export function materialize(entry: LibraryEntry, tonic: string): Progression {
  const bars = entry.bars.map(bar => bar.map(([, degree, quality]) => {
    const root = transpose(tonic, degree), chord = { root, quality };
    return { ...chord, symbol: chordName(chord), beats: 4 / bar.length };
  }));
  return { id: entry.id, name: entry.name, source: 'builtin', key: { tonic, mode: entry.mode }, romanNumerals: entry.bars.flat().map(([label]) => label), bars, beatsPerBar: 4 };
}

export type ChangeStage = 'root' | 'third' | 'seventh' | 'guide' | 'any-chord-tone' | 'with-tensions';
export const stageNames: Record<ChangeStage, string> = { root: 'ルート', third: '3rd', seventh: '7th', guide: '3rd と 7th', 'any-chord-tone': 'コードトーン', 'with-tensions': 'コードトーン＋9th' };
export interface StageTarget {
  /** Tones that count; `all` needs every one of them (3rd and 7th), `any` needs one. */
  tones: ChordTone[]; need: 'all' | 'any'; label: string;
  /** Set when the chord lacks the asked tone and another stands in (sus has no 3rd, 6 has no 7th). */
  substituted?: string;
}
/** Ninth taken from the key's scale for diatonic chords: the scale note one letter above the root.
 * Minor keys use harmonic minor for V7 and natural minor otherwise; chords outside the key get none. */
export function ninthFromKey(chord: ChordSymbol, key: KeyInfo): ChordTone | null {
  const tables: [KeyMode, string][] = key.mode === 'major' ? [['major', 'ionian']] : [['harmonic-minor', 'harmonic-minor'], ['natural-minor', 'aeolian']];
  for (const [mode, scale] of tables) {
    const diatonic = diatonicSevenths(key.tonic, mode).find(c => c.chord && c.chord.root === chord.root && c.chord.quality === chord.quality);
    if (!diatonic) continue;
    const names = tonesFor(key.tonic, scales.find(s => s.id === scale)!).map(t => t.name);
    const letter = 'CDEFGAB'[('CDEFGAB'.indexOf(chord.root[0]) + 1) % 7];
    const name = names.find(n => n[0] === letter)!, semitones = (pitchOf(name) - pitchOf(chord.root) + 12) % 12;
    return { degree: semitones === 1 ? '♭9' : semitones === 3 ? '♯9' : '9', name, pitchClass: pitchOf(name) };
  }
  return null;
}
export function stageTargets(chord: ChordSymbol, stage: ChangeStage, key: KeyInfo | null = null): StageTarget {
  const tone = (role: Parameters<typeof toneByRole>[1]) => toneByRole(chord, role);
  const root = tone('root')!, third = tone('third'), seventh = tone('seventh');
  if (stage === 'root') return { tones: [root], need: 'any', label: 'ルート' };
  if (stage === 'third') {
    if (third) return { tones: [third], need: 'any', label: '3rd' };
    const fourth = tone('fourth') ?? tone('second');
    return { tones: [fourth ?? root], need: 'any', label: fourth ? fourth.degree === '4' ? '4th' : '2nd' : 'ルート', substituted: `${chordName(chord)} には 3rd がないため ${fourth ? fourth.degree === '4' ? '4th' : '2nd' : 'ルート'}` };
  }
  if (stage === 'seventh') {
    if (seventh) return { tones: [seventh], need: 'any', label: '7th' };
    const stand = third ?? root;
    return { tones: [stand], need: 'any', label: stand === third ? '3rd' : 'ルート', substituted: `${chordName(chord)} には 7th がないため ${stand === third ? '3rd' : 'ルート'}` };
  }
  if (stage === 'guide') {
    if (third && seventh) return { tones: [third, seventh], need: 'all', label: '3rd と 7th' };
    const present = [third, seventh].filter((t): t is ChordTone => !!t);
    return { tones: present.length ? present : [root], need: 'all', label: present.length ? present.map(t => t === third ? '3rd' : '7th').join(' と ') : 'ルート', substituted: `${chordName(chord)} には ${third ? '7th' : '3rd'} がありません` };
  }
  const tones = chordTones(chord);
  if (stage === 'any-chord-tone') return { tones, need: 'any', label: 'コードトーン' };
  // Tensions: never inferred from the quality. Formula ninths only, or the key's ninth when a key is given.
  const ninth = tones.some(t => ['9', '♭9', '♯9'].includes(t.degree)) || !key ? null : ninthFromKey(chord, key);
  return { tones: ninth ? [...tones, ninth] : tones, need: 'any', label: ninth ? `コードトーン＋${ninth.degree}` : 'コードトーン' };
}

export type ChordStatus = 'pending' | 'hit' | 'late' | 'skipped';
export interface ChordResult { index: number; status: ChordStatus; mistakes: number; responseMs: number | null }
/** Step mode: each chord waits for its target tones; a correct answer advances. Mistakes are counted, never block. */
export class ProgressionRun {
  readonly chords: (ProgressionChord & { bar: number; slot: number })[];
  index = 0; pass = 1; found = new Set<number>(); mistakes = 0;
  results: ChordResult[] = [];
  phase: 'playing' | 'paused' | 'finished' = 'playing';
  constructor(readonly progression: Progression, readonly stage: ChangeStage, readonly repeats: number | null, private readonly ninthsFromKey = false) {
    this.chords = flatten(progression);
    if (!this.chords.length) throw new Error('進行が空です');
  }
  get chord() { return this.chords[this.index]; }
  get nextChord() { return this.chords[this.index + 1] ?? (this.repeats === null || this.pass < this.repeats ? this.chords[0] : null); }
  target(index = this.index) { return stageTargets(this.chords[index], this.stage, this.ninthsFromKey ? this.progression.key ?? null : null); }
  /** One confirmed pitch class. Returns 'hit' when the chord is complete (and the run moved on), 'partial', 'repeat' or 'miss'. */
  answer(pc: number, responseMs: number): 'hit' | 'partial' | 'repeat' | 'miss' | null {
    if (this.phase !== 'playing') return null;
    const target = this.target(), index = target.tones.findIndex((t, i) => t.pitchClass === pc && !this.found.has(i));
    if (index < 0) {
      if (target.tones.some(t => t.pitchClass === pc)) return 'repeat';
      this.mistakes++; return 'miss';
    }
    if (target.need === 'all') { this.found.add(index); if (this.found.size < target.tones.length) return 'partial'; }
    this.record(this.mistakes ? 'late' : 'hit', responseMs); this.advance();
    return 'hit';
  }
  private record(status: ChordStatus, responseMs: number | null) { this.results.push({ index: this.index, status, mistakes: this.mistakes, responseMs }); }
  skip() { if (this.phase !== 'playing') return; this.record('skipped', null); this.advance(); }
  private advance() {
    this.found.clear(); this.mistakes = 0;
    if (this.index + 1 < this.chords.length) { this.index++; return; }
    if (this.repeats !== null && this.pass >= this.repeats) { this.phase = 'finished'; return; }
    this.index = 0; this.pass++;
  }
  /** Arrow keys move freely without recording; the chord's evidence starts over. */
  move(by: number) { if (this.phase === 'finished') return; this.index = (this.index + by + this.chords.length) % this.chords.length; this.found.clear(); this.mistakes = 0; }
  pause() { if (this.phase === 'playing') this.phase = 'paused'; }
  resume() { if (this.phase === 'paused') this.phase = 'playing'; }
  finish() { this.phase = 'finished'; }
  /** Latest result per chord position for the chart. */
  statusOf(index: number): ChordStatus { return this.results.filter(r => r.index === index).at(-1)?.status ?? 'pending'; }
}

export interface StoredProgression { id: string; name: string; text: string; key: KeyInfo | null }
/** User progressions live in the training store as text, so they are re-parsed (and checked) on load. */
export function decodeStored(list: unknown[]): StoredProgression[] {
  return list.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>, key = value.key as KeyInfo | null;
    if (typeof value.id !== 'string' || !/^user:[a-z0-9-]{1,64}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40 || typeof value.text !== 'string' || value.text.length > 2000) return [];
    if (key !== null && !(key && typeof key === 'object' && typeof key.tonic === 'string' && ['major', 'minor'].includes(key.mode))) return [];
    return 'error' in parseProgression(value.text) ? [] : [{ id: value.id, name: value.name.trim(), text: value.text, key: key ?? null }];
  }).slice(0, 100);
}
export function fromStored(stored: StoredProgression): Progression {
  const bars = parseProgression(stored.text) as ProgressionChord[][];
  return { id: stored.id, name: stored.name, source: 'user', ...(stored.key ? { key: stored.key } : {}), bars, beatsPerBar: 4 };
}
