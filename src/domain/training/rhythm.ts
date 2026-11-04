/** Rhythm patterns and timing judgement. All times are milliseconds on one clock; the caller maps taps or onsets onto it. */
export type Cell = 'note' | 'accent' | 'rest';
export interface RhythmPattern { id: string; name: string; subdivision: 1 | 2 | 3 | 4 | 6; beats: number; cells: Cell[] }
export type Verdict = 'tight' | 'ok' | 'early' | 'late' | 'extra' | 'missed';
export interface RhythmHit { expectedMs: number | null; actualMs: number | null; offsetMs: number | null; verdict: Verdict; accent: boolean }
export interface Windows { tight: number; ok: number }

const n: Cell = 'note', a: Cell = 'accent', r: Cell = 'rest';
const repeat = <T,>(items: T[], times: number) => Array.from({ length: times }, () => items).flat();
export const patterns: RhythmPattern[] = [
  { id: 'quarters', name: '4分音符', subdivision: 1, beats: 4, cells: [a, n, n, n] },
  { id: 'eighths', name: '8分音符', subdivision: 2, beats: 4, cells: repeat([n, n], 4) },
  { id: 'offbeats', name: '8分の裏だけ', subdivision: 2, beats: 4, cells: repeat([r, n], 4) },
  { id: 'accent-offbeats', name: '8分・裏にアクセント', subdivision: 2, beats: 4, cells: repeat([n, a], 4) },
  { id: 'triplets', name: '3連符', subdivision: 3, beats: 4, cells: repeat([a, n, n], 4) },
  { id: 'sixteenths', name: '16分音符', subdivision: 4, beats: 4, cells: repeat([a, n, n, n], 4) },
  { id: 'eighth-two-sixteenths', name: '8分＋16分2つ', subdivision: 4, beats: 4, cells: repeat([n, r, n, n], 4) },
  { id: 'syncopation', name: 'シンコペーション（裏から次の拍へ）', subdivision: 2, beats: 4, cells: [n, n, r, n, n, n, r, n] },
  { id: 'with-rests', name: '休符を含む8分', subdivision: 2, beats: 4, cells: [n, r, n, n, r, n, n, r] },
  { id: 'charleston', name: 'チャールストン', subdivision: 2, beats: 4, cells: [a, r, r, n, r, r, r, r] },
];

/** Cell start inside its beat as a fraction. Swing (0.5 straight … 0.67 triplet feel … 0.75) moves the eighth off-beat;
 * sixteenths in between scale with it. Only 8th and 16th grids swing. */
function fraction(index: number, subdivision: number, swing: number) {
  const f = index / subdivision;
  if (swing === .5 || (subdivision !== 2 && subdivision !== 4)) return f;
  return f < .5 ? f / .5 * swing : swing + (f - .5) / .5 * (1 - swing);
}
/** Expected onsets for `bars` repetitions after `startMs`. Rests produce nothing. */
export function expectedOnsets(pattern: RhythmPattern, bpm: number, startMs: number, bars = 1, swing = .5): { timeMs: number; accent: boolean }[] {
  const beatMs = 60000 / bpm, out: { timeMs: number; accent: boolean }[] = [];
  for (let bar = 0; bar < bars; bar++) pattern.cells.forEach((cell, i) => {
    if (cell === 'rest') return;
    const beat = Math.floor(i / pattern.subdivision), within = i % pattern.subdivision;
    out.push({ timeMs: startMs + (bar * pattern.beats + beat + fraction(within, pattern.subdivision, swing)) * beatMs, accent: cell === 'accent' });
  });
  return out;
}
/** Windows narrow automatically so neighbouring expected notes never share one: the "ok" window stays under half the smallest gap. */
export function windowsFor(expected: number[], tight = 35, ok = 70): Windows {
  const gaps = expected.slice(1).map((t, i) => t - expected[i]), smallest = gaps.length ? Math.min(...gaps) : Infinity;
  const limit = Math.min(ok, smallest / 2 - 1);
  return { tight: Math.min(tight, limit), ok: limit };
}
/** One-to-one, order-preserving pairing of taps with expected notes (fewest misses and extras, then smallest offsets).
 * A pair counts only within half the gap to the neighbouring note; beyond the ok window it is early or late. */
export function judgeHits(expected: { timeMs: number; accent: boolean }[], actual: number[], windows = windowsFor(expected.map(e => e.timeMs))): RhythmHit[] {
  const times = expected.map(e => e.timeMs), reach = (i: number) => {
    const before = i > 0 ? times[i] - times[i - 1] : Infinity, after = i < times.length - 1 ? times[i + 1] - times[i] : Infinity;
    return Math.min(before, after, 1000) / 2;
  };
  const E = expected.length, A = actual.length, cost: number[][] = [], move: string[][] = [];
  for (let i = 0; i <= E; i++) { cost.push(new Array(A + 1).fill(0)); move.push(new Array(A + 1).fill('')); }
  for (let i = 1; i <= E; i++) { cost[i][0] = i; move[i][0] = 'miss'; }
  for (let j = 1; j <= A; j++) { cost[0][j] = j; move[0][j] = 'extra'; }
  for (let i = 1; i <= E; i++) for (let j = 1; j <= A; j++) {
    const offset = Math.abs(actual[j - 1] - times[i - 1]);
    const options: [number, string][] = [[cost[i - 1][j] + 1, 'miss'], [cost[i][j - 1] + 1, 'extra']];
    if (offset < reach(i - 1)) options.push([cost[i - 1][j - 1] + offset / reach(i - 1) * .9, 'pair']);
    const best = options.reduce((x, y) => y[0] < x[0] ? y : x);
    cost[i][j] = best[0]; move[i][j] = best[1];
  }
  const hits: RhythmHit[] = [];
  for (let i = E, j = A; i > 0 || j > 0;) {
    const m = move[i][j];
    if (m === 'pair') {
      const offsetMs = actual[j - 1] - times[i - 1], size = Math.abs(offsetMs);
      hits.push({ expectedMs: times[i - 1], actualMs: actual[j - 1], offsetMs, accent: expected[i - 1].accent, verdict: size <= windows.tight ? 'tight' : size <= windows.ok ? 'ok' : offsetMs < 0 ? 'early' : 'late' });
      i--; j--;
    } else if (m === 'miss') { hits.push({ expectedMs: times[i - 1], actualMs: null, offsetMs: null, verdict: 'missed', accent: expected[i - 1].accent }); i--; }
    else { hits.push({ expectedMs: null, actualMs: actual[j - 1], offsetMs: null, verdict: 'extra', accent: false }); j--; }
  }
  return hits.reverse();
}
/** Objective numbers: mean offset (negative = rushing), spread, and the share of expected notes inside the ok window. */
export function summary(hits: RhythmHit[]) {
  const offsets = hits.filter(h => h.offsetMs !== null).map(h => h.offsetMs!), expected = hits.filter(h => h.expectedMs !== null).length;
  const mean = offsets.length ? offsets.reduce((x, y) => x + y, 0) / offsets.length : null;
  const sd = offsets.length > 1 && mean !== null ? Math.sqrt(offsets.reduce((s, o) => s + (o - mean) ** 2, 0) / (offsets.length - 1)) : null;
  const inside = hits.filter(h => h.verdict === 'tight' || h.verdict === 'ok').length;
  const count = (v: Verdict) => hits.filter(h => h.verdict === v).length;
  return { meanMs: mean, sdMs: sd, accuracy: expected ? inside / expected : 0, tight: count('tight'), ok: count('ok'), early: count('early'), late: count('late'), extra: count('extra'), missed: count('missed') };
}
export const describeTendency = (meanMs: number | null) => meanMs === null ? '' : Math.abs(meanMs) < 10 ? 'ほぼ正確' : meanMs < 0 ? `全体に ${Math.round(-meanMs)} ms 早い（走りぎみ）` : `全体に ${Math.round(meanMs)} ms 遅い（もたりぎみ）`;

/** Calibration: median of tap−click offsets, ignoring taps more than 150 ms away (missed or double taps). */
export function calibrate(clicks: number[], taps: number[]): number | null {
  const offsets = taps.map(t => { const nearest = clicks.reduce((best, c) => Math.abs(c - t) < Math.abs(best - t) ? c : best, Infinity); return t - nearest; }).filter(o => Math.abs(o) <= 150).sort((x, y) => x - y);
  if (offsets.length < Math.min(8, clicks.length / 2)) return null;
  const mid = offsets.length >> 1;
  return Math.round(offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2);
}

export type Transform = 'none' | 'shift' | 'double' | 'half';
/** Motif-style rhythm changes: start one beat later, every value twice as long, or twice as short (when the grid allows). */
export function transform(pattern: RhythmPattern, kind: Transform): RhythmPattern | null {
  if (kind === 'none') return pattern;
  const name = `${pattern.name}（${{ shift: '1拍ずらし', double: '倍の長さ', half: '半分の長さ' }[kind]}）`;
  if (kind === 'shift') {
    const k = pattern.subdivision, cells = [...Array<Cell>(k).fill(r), ...pattern.cells.slice(0, -k)];
    return { ...pattern, id: `${pattern.id}-shift`, name, cells };
  }
  if (kind === 'double') return { ...pattern, id: `${pattern.id}-double`, name, beats: pattern.beats * 2, cells: pattern.cells.flatMap(c => [c, r]) };
  const sub = pattern.subdivision * 2;
  if (![2, 4, 6].includes(sub)) return null;
  return { ...pattern, id: `${pattern.id}-half`, name, subdivision: sub as RhythmPattern['subdivision'], beats: pattern.beats / 2, cells: pattern.cells };
}

/** Metronome clicks for a count-in plus `totalBeats`, as [fromMs, toMs) slices: count-in on every beat, then by mode. */
export function metronomeClicks(beatMs: number, beatsPerBar: number, countInBeats: number, totalBeats: number, mode: 'all' | 'backbeat' | 'one' | 'none', fromMs: number, toMs: number) {
  const clicks: { timeMs: number; accent: boolean }[] = [];
  for (let i = Math.max(0, Math.ceil(fromMs / beatMs - 1e-9)); i < countInBeats + totalBeats && i * beatMs < toMs; i++) {
    const timeMs = i * beatMs, beat = (i - countInBeats + beatsPerBar * 1000) % beatsPerBar + 1;
    if (timeMs < fromMs) continue;
    if (i < countInBeats || mode === 'all' || mode === 'one' && beat === 1 || mode === 'backbeat' && beat % 2 === 0) clicks.push({ timeMs, accent: beat === 1 });
  }
  return clicks;
}
export const bpmBand = (bpm: number) => { const low = Math.floor(bpm / 20) * 20; return `${low}-${low + 19}`; };
