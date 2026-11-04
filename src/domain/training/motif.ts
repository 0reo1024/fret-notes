import { toneByRole } from '../music/harmony';
import { pitchOf } from '../music/theory';
import { generateMelody, nameInKey, scaleOf, tonicMidi } from './ear';
import { flatten, type KeyInfo, type Progression } from './progression';
import type { TimedNote } from './timeline';

/** A short figure in a key: pitches with lengths in beats, starting `startBeat` beats into the bar (a rest before it). */
export interface MotifNote { midi: number; beats: number }
export interface Motif { id: string; name: string; key: KeyInfo; notes: MotifNote[]; startBeat: number }
type Pitched = { midi: number };

/** Semitones between neighbours: C–D–E is [2, 2]. */
export const contour = (notes: Pitched[]) => notes.slice(1).map((n, i) => n.midi - notes[i].midi);
/** Position on the key's scale (seven steps per octave), or null when any note is outside the key. */
export function scaleSteps(notes: Pitched[], key: KeyInfo): number[] | null {
  const tonic = pitchOf(key.tonic), offsets = scaleOf(key).map(t => (t.pitch - tonic + 12) % 12);
  const steps: number[] = [];
  for (const { midi } of notes) {
    const index = offsets.indexOf(((midi - tonic) % 12 + 12) % 12);
    if (index < 0) return null;
    steps.push(Math.floor((midi - tonic) / 12) * 7 + index);
  }
  return steps;
}
/** Scale steps between neighbours: C–D–E and D–E–F in C major are both [1, 1]. */
export const scaleContour = (notes: Pitched[], key: KeyInfo) => { const steps = scaleSteps(notes, key); return steps && steps.slice(1).map((s, i) => s - steps[i]); };
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Played notes are searched for the motif as a run of consecutive notes anywhere in the take, since a phrase over a
 * progression has other notes around it. Each returns the index of the first matching note, or null. Pitch only: the
 * rhythm of what was played is shown separately and never judged. */
export function matchesRepeat(events: Pitched[], motif: Motif, options: { pitchClass?: boolean } = {}): number | null {
  const want = motif.notes.map(n => options.pitchClass ? n.midi % 12 : n.midi);
  for (let i = 0; i + want.length <= events.length; i++)
    if (want.every((m, j) => (options.pitchClass ? events[i + j].midi % 12 : events[i + j].midi) === m)) return i;
  return null;
}
/** Same contour from a given pitch class, in any octave. With `inKey`, the contour is counted in scale steps instead of
 * semitones (C–D–E moved within C major to D–E–F), and every note must be in the key. */
export function matchesTransposed(events: Pitched[], motif: Motif, startPitchClass: number, inKey: KeyInfo | null = null): number | null {
  const want = inKey ? scaleContour(motif.notes, inKey) : contour(motif.notes), size = motif.notes.length;
  if (!want) return null;
  for (let i = 0; i + size <= events.length; i++) {
    const window = events.slice(i, i + size);
    if (window[0].midi % 12 !== startPitchClass) continue;
    const got = inKey ? scaleContour(window, inKey) : contour(window);
    if (got && same(got, want)) return i;
  }
  return null;
}

/** Reference figures for a take (never a score). Times are on the take's clock; notes still sounding end at `toMs`. */
export interface PhraseMetrics { notes: number; pitchClasses: number; restRatio: number | null; contourSimilarity: number | null; outside: number | null }
export function phraseMetrics(events: TimedNote[], fromMs: number, toMs: number, motif: Motif | null, allowedMidis: Set<number> | null = null): PhraseMetrics {
  const inside = events.filter(e => e.startMs < toMs && (e.endMs ?? toMs) > fromMs);
  let covered = 0, reach = fromMs;
  for (const e of inside.slice().sort((a, b) => a.startMs - b.startMs)) {
    const start = Math.max(e.startMs, reach), end = Math.min(e.endMs ?? toMs, toMs);
    if (end > start) { covered += end - start; reach = end; }
  }
  return {
    notes: inside.length, pitchClasses: new Set(inside.map(e => e.midi % 12)).size,
    restRatio: toMs > fromMs ? 1 - covered / (toMs - fromMs) : null,
    contourSimilarity: motif ? contourSimilarity(inside, motif) : null,
    outside: allowedMidis ? inside.filter(e => !allowedMidis.has(e.midi)).length : null,
  };
}
/** Best share of matching directions (up, down, same) between the motif and any run of played notes of its length. */
export function contourSimilarity(events: Pitched[], motif: Motif): number | null {
  const want = contour(motif.notes).map(Math.sign), got = contour(events).map(Math.sign);
  if (!want.length || got.length < want.length) return null;
  let best = 0;
  for (let i = 0; i + want.length <= got.length; i++) best = Math.max(best, want.filter((s, j) => s === got[i + j]).length / want.length);
  return best;
}

/** Library motifs in scale steps from the tonic (0 = tonic, 2 = third), with beats. Generic figures, not quotations. */
const shapes: { id: string; name: string; steps: [number, number][]; startBeat: number }[] = [
  { id: 'climb', name: '3音の上行', steps: [[0, 1], [1, 1], [2, 2]], startBeat: 0 },
  { id: 'arch', name: '山形', steps: [[2, 1], [3, 1], [4, 1], [2, 1]], startBeat: 0 },
  { id: 'neighbor', name: '刺しゅう音', steps: [[4, .5], [5, .5], [4, 2]], startBeat: 1 },
  { id: 'leap', name: '跳躍して戻る', steps: [[0, 1], [4, 1], [3, .5], [2, 1.5]], startBeat: 0 },
  { id: 'turn', name: 'ターン', steps: [[2, .5], [1, .5], [0, .5], [-1, .5], [0, 2]], startBeat: 0 },
  { id: 'call', name: '休符からの問いかけ', steps: [[4, 1], [2, 2]], startBeat: 1 },
];
export const motifShapes = shapes.map(s => ({ id: s.id, name: s.name }));
/** The key a progression is heard in: its own, or the first chord's root (minor if that chord is minor). */
export function keyOf(progression: Progression): KeyInfo {
  if (progression.key) return progression.key;
  const first = flatten(progression)[0];
  return { tonic: first.root, mode: toneByRole(first, 'third')?.degree === '♭3' ? 'minor' : 'major' };
}
export function libraryMotif(id: string, key: KeyInfo, register: [number, number]): Motif {
  const shape = shapes.find(s => s.id === id) ?? shapes[0], tonic = tonicMidi(key, register);
  const offsets = scaleOf(key).map(t => (t.pitch - pitchOf(key.tonic) + 12) % 12);
  const midiOf = (step: number) => tonic + Math.floor(step / 7) * 12 + offsets[((step % 7) + 7) % 7];
  return { id: shape.id, name: shape.name, key, notes: shape.steps.map(([step, beats]) => ({ midi: midiOf(step), beats })), startBeat: shape.startBeat };
}
/** A random motif of 2–5 notes in the key (no repeated pitch back to back, which needs onsets to tell apart). */
export function randomMotif(length: number, key: KeyInfo, register: [number, number], random = Math.random): Motif {
  const size = Math.min(5, Math.max(2, Math.round(length)));
  const melody = generateMelody('melody', size <= 3 ? 3 : 6, key, register, random).notes.slice(0, size);
  const lengths = [[.5, .5, 1], [1, 1, 2], [1, .5, .5, 2], [.5, .5, .5, .5, 2], [1, 1, 1, 1, 2]];
  const options = lengths.filter(l => l.length >= size), beats = options[Math.floor(random() * options.length)].slice(0, size - 1);
  return { id: 'random', name: 'ランダム', key, notes: melody.map((n, i) => ({ midi: n.midi, beats: i < size - 1 ? beats[i] : 2 })), startBeat: random() < .3 ? 1 : 0 };
}
export const motifBeats = (motif: Motif) => motif.notes.reduce((sum, n) => sum + n.beats, 0);
/** Sound events for the synthesizer, in seconds at the tempo, starting with the motif's leading rest. */
export const motifEvents = (motif: Motif, bpm: number) => {
  let at = motif.startBeat * 60 / bpm;
  return motif.notes.map(n => { const event = { midis: [n.midi], at, duration: n.beats * 60 / bpm * .9 }; at += n.beats * 60 / bpm; return event; });
};
export const describeMotif = (motif: Motif) => motif.notes.map(n => { const named = nameInKey(motif.key, n.midi); return `${named.name}（${named.degree}）`; }).join(' – ');

export type PhraseTaskKind = 'repeat' | 'transpose' | 'diatonic' | 'rhythm' | 'rests' | 'call-response' | 'develop';
export const taskKinds: { kind: PhraseTaskKind; name: string; objective: boolean }[] = [
  { kind: 'repeat', name: 'そのまま反復', objective: true },
  { kind: 'transpose', name: '移して反復（半音単位で同じ形）', objective: true },
  { kind: 'diatonic', name: '調の中で移して反復（音階上で同じ形）', objective: true },
  { kind: 'rhythm', name: 'リズムを変えて反復', objective: false },
  { kind: 'rests', name: '休符を入れる', objective: false },
  { kind: 'call-response', name: 'コール＆レスポンス', objective: false },
  { kind: 'develop', name: '自由に発展させる', objective: false },
];
export interface PhraseStart { pitchClass: number; name: string; chordIndex: number; chord: string }
export interface PhraseTask { id: string; kind: PhraseTaskKind; title: string; instruction: string; objective: boolean; motif: Motif; start: PhraseStart | null }
const instructions: Record<PhraseTaskKind, string> = {
  repeat: 'モチーフを同じ高さのまま、進行の上でもう一度弾いてください（どこで弾いても構いません）。',
  transpose: '', diatonic: '',
  rhythm: '音の並びはそのままに、リズム（長さ・置く拍）を変えて反復してください。',
  rests: 'モチーフを使いながら、休符で間を作ってください。弾かない時間も演奏の一部です。',
  'call-response': 'モチーフを「問い」として弾き、次の小節でそれに「答える」フレーズを弾いてください。',
  develop: 'モチーフを出発点に、進行に合わせて自由に変形・発展させてください。',
};
/** A task over a progression. Moving the motif starts it on the third of a chord after the first, so the contour has
 * to be heard over a new harmony; the in-key version needs a key and a motif inside it, otherwise it falls back. */
export function phraseTask(kind: PhraseTaskKind, progression: Progression, motif: Motif, random = Math.random): PhraseTask {
  const chords = flatten(progression), key = keyOf(progression);
  if (kind === 'diatonic' && (!progression.key || !scaleSteps(motif.notes, key))) kind = 'transpose';
  const info = taskKinds.find(k => k.kind === kind)!;
  let start: PhraseStart | null = null;
  if (kind === 'transpose' || kind === 'diatonic') {
    const scalePcs = scaleOf(key).map(t => t.pitch);
    const candidates = chords.map((chord, index) => ({ chord, index, third: toneByRole(chord, 'third') }))
      .filter(c => c.third && (kind === 'transpose' || scalePcs.includes(c.third.pitchClass)));
    const later = candidates.filter(c => c.index > 0), pool = later.length ? later : candidates;
    if (!pool.length) return phraseTask('repeat', progression, motif, random);
    const chosen = pool[Math.floor(random() * pool.length)];
    start = { pitchClass: chosen.third!.pitchClass, name: chosen.third!.name, chordIndex: chosen.index, chord: chosen.chord.symbol };
  }
  const instruction = start ? `${start.chord} の 3rd（${start.name}）から始めて、モチーフと同じ形で弾いてください。${kind === 'diatonic' ? `形は${key.tonic}${key.mode === 'major' ? 'メジャー' : 'マイナー'}の音階上の段数で比べます（半音の幅は変わってよい）。` : '形は半音単位で比べます（どのオクターブでも可）。'}` : instructions[kind];
  return { id: `${kind}:${motif.id}`, kind, title: info.name, instruction, objective: info.objective, motif, start };
}

/** Constraint cards (P-3): one rule per card. Those the app can measure get a reference figure; the rest are self-checked. */
export type ConstraintReference = 'pitch-classes' | 'first-note' | 'bar-landings' | 'fret-window';
export interface ConstraintCard { id: string; text: string; detail: string; reference: ConstraintReference | null; frets?: [number, number] }
export const constraintCards: ConstraintCard[] = [
  { id: 'three-notes', text: '3音だけで', detail: '使う音名を3つに決めて、その中だけで弾く。', reference: 'pitch-classes' },
  { id: 'one-string', text: '1本の弦だけで', detail: '横の移動で弾く（弦は判定できないので自己評価）。', reference: null },
  { id: 'rest-start', text: '休符で始める', detail: '各フレーズを拍の頭から始めない。', reference: 'first-note' },
  { id: 'eighths', text: '8分音符だけ', detail: '音の長さをそろえて、音選びに集中する（自己評価）。', reference: null },
  { id: 'bar-thirds', text: '各小節の頭は 3rd', detail: '小節の1拍目に、そのコードの3rdを置く。', reference: 'bar-landings' },
  { id: 'fret-window', text: '5〜7フレットだけ', detail: '狭い範囲の中で、弦をまたいで音を探す。', reference: 'fret-window', frets: [5, 7] },
  { id: 'question-answer', text: '2小節の問いと2小節の答え', detail: '問いは上がって終わり、答えは下がって終わる、など対にする。', reference: null },
  { id: 'approach', text: 'コードトーンへ半音で近づく', detail: '次のコードの音へ、半音上か下から入る。', reference: null },
  { id: 'long-note', text: '各コードで長い音を1つ', detail: '少なくとも1拍半以上伸ばす音を入れる。', reference: null },
];
/** A random card other than the previous one. */
export function drawConstraint(random = Math.random, previousId: string | null = null): ConstraintCard {
  const pool = constraintCards.filter(c => c.id !== previousId);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

export type SelfMark = 'yes' | 'partial' | 'no';
export const checklist = [
  { id: 'motif', text: 'モチーフが聞き取れる形で残っていたか' },
  { id: 'rests', text: '休符で間を作れたか' },
  { id: 'changes', text: 'コードの変わり目を意識できたか' },
  { id: 'constraint', text: '制約を守れたか' },
] as const;
/** A saved take: pitches and times only (no audio). Times are ms from the first beat after the count-in. */
export interface PhraseTake {
  trainer: 'phrase'; id: string; taskId: string; progressionId: string; tempo: number;
  events: { midi: number; startMs: number; endMs: number }[];
  objective: boolean | null; constraintId: string | null; selfAssessment: Partial<Record<string, SelfMark>>; memo: string; at: string;
}
export const maxTakeEvents = 1024, maxMemo = 200;
/** Longest recording: 64 bars, so the passes are capped for long progressions. */
export const maxPasses = (progression: Progression) => Math.max(1, Math.floor(64 / progression.bars.length));

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
/** Keeps the phrase takes that are well formed; takes of other trainers and anything malformed are left out. */
export function decodePhraseTakes(list: unknown[]): PhraseTake[] {
  return list.filter((t): t is PhraseTake => {
    if (!t || typeof t !== 'object') return false;
    const v = t as Record<string, unknown>;
    return v.trainer === 'phrase' && typeof v.id === 'string' && typeof v.taskId === 'string' && typeof v.progressionId === 'string'
      && finite(v.tempo) && Array.isArray(v.events) && v.events.length <= maxTakeEvents
      && v.events.every(e => e && typeof e === 'object' && Number.isInteger(e.midi) && e.midi >= 0 && e.midi <= 127 && finite(e.startMs) && finite(e.endMs) && e.endMs >= e.startMs)
      && (v.objective === null || typeof v.objective === 'boolean') && (v.constraintId === null || typeof v.constraintId === 'string')
      && !!v.selfAssessment && typeof v.selfAssessment === 'object' && Object.entries(v.selfAssessment).every(([k, m]) => checklist.some(c => c.id === k) && ['yes', 'partial', 'no'].includes(m as string))
      && typeof v.memo === 'string' && v.memo.length <= maxMemo && typeof v.at === 'string' && !Number.isNaN(Date.parse(v.at));
  });
}

/** Lays a take out for display: one row per pass of the progression, each note at its share of the pass (0–1) with the
 * chord sounding when it started. Notes up to 100 ms early count for the next chord (detection is late, not early). */
export function timelineRows(events: { midi: number; startMs: number }[], progression: Progression, bpm: number, endMs: number) {
  const chords = flatten(progression), beat = 60000 / bpm, ends: number[] = [];
  chords.reduce((sum, c) => { ends.push((sum + c.beats) * beat); return sum + c.beats; }, 0);
  const passMs = ends.at(-1)!, passes = Math.min(64, Math.max(1, Math.ceil((Math.max(endMs, ...events.map(e => e.startMs + 1)) + 100) / passMs)));
  return Array.from({ length: passes }, (_, pass) => ({
    pass: pass + 1,
    notes: events.flatMap((e, index) => {
      const within = e.startMs - pass * passMs;
      if (within < -100 || within >= passMs - 100) return [];
      const at = Math.max(0, within), chordIndex = Math.max(0, ends.findIndex(end => end > at + 100));
      return [{ index, midi: e.midi, share: at / passMs, chordIndex }];
    }),
  }));
}
