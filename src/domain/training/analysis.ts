import { pitchOf } from '../music/theory';
import type { create } from '../instruments/core';
import { defaultTargetMs, isDue, isMastered, localDate, type Attempt, type AttemptMethod, type DailySummary, type ItemStat, type SkillLayer, type TrainingData } from './records';
import { advancedStatus, approachPatterns, chordScaleQuestions, guideToneQualities, tensionQuestions } from './advanced';
import { intervalStages } from './interval-questions';
import { arpeggioQualities } from './arpeggio';
import { patterns as rhythmPatterns } from './rhythm';

// Targets ---------------------------------------------------------------------------------------------------------
export type TargetMethod = 'choice' | 'name' | 'click' | 'play';
export type Targets = Record<TargetMethod, number>;
export const targetMethods: TargetMethod[] = ['choice', 'name', 'click', 'play'];
export const targetChoices = [1500, 2000, 2500, 3000, 4000, 5000, 6000];
/** Response-time goal per answer method, from the preferences; anything unexpected falls back to the default. */
export function targetsOf(preferences: Record<string, unknown>): Targets {
  const stored = (preferences.targets && typeof preferences.targets === 'object' ? preferences.targets : {}) as Record<string, unknown>;
  return Object.fromEntries(targetMethods.map(m => [m, targetChoices.includes(stored[m] as number) ? stored[m] as number : defaultTargetMs(m)])) as Targets;
}
/** Singing, tapping and self-marking share the play goal. */
export const targetFor = (targets: Targets, method: AttemptMethod) => method === 'choice' || method === 'name' || method === 'click' ? targets[method] : targets.play;
/** Goal used when only the layer is known (the stat does not keep the method): typed names for knowledge, as in the summary. */
export const layerTarget = (targets: Targets, layer: SkillLayer) => layer === 'knowledge' ? targets.name : layer === 'fretboard' ? targets.click : targets.play;

const median = (values: number[]) => { const s = values.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
const graded = (stat: ItemStat) => stat.correct + stat.wrong;
/** Mastered for analysis: box 4 or more and, when times were measured, a median within the goal. Trainers without
 * response times (rhythm, phrase) are judged on the box alone. */
export const masteredStat = (stat: ItemStat, targetMs: number) => stat.box >= 4 && (stat.recentMs.length === 0 || median(stat.recentMs) <= targetMs);
/** Weak: graded at least once and either under 75% right or slower than the goal. */
export const weakStat = (stat: ItemStat, targetMs: number) => graded(stat) > 0 && (stat.correct / graded(stat) < .75 || stat.recentMs.length > 0 && median(stat.recentMs) > targetMs);

// Weakness tables -------------------------------------------------------------------------------------------------
export type WeaknessTable = 'ct' | 'iv' | 'ivf' | 'fb' | 'ear' | 'rhy';
export const weaknessTables: { id: WeaknessTable; name: string; rows: string; columns: string }[] = [
  { id: 'ct', name: 'コードトーン', rows: '品質', columns: '度数' },
  { id: 'iv', name: 'インターバル（音名）', rows: 'インターバル', columns: '方向' },
  { id: 'ivf', name: 'インターバル（指板）', rows: 'インターバル', columns: '方向' },
  { id: 'fb', name: '指板', rows: '弦', columns: 'フレット帯' },
  { id: 'ear', name: '聴音', rows: '音数', columns: '種類' },
  { id: 'rhy', name: 'リズム', rows: 'パターン', columns: 'テンポ帯' },
];
export interface WeaknessFilter { table: WeaknessTable; layer?: SkillLayer; instrument?: string }
export interface WeaknessCell {
  row: string; column: string; itemIds: string[]; layer: SkillLayer | null;
  /** Graded answers only: skips, self-marks and detection issues are left out. */
  attempts: number; accuracy: number | null; medianMs: number | null; masteredShare: number; insufficient: boolean;
}
export interface WeaknessGrid { table: WeaknessTable; rows: string[]; columns: string[]; cells: WeaknessCell[]; hiddenRows: number }
export const minimumAttempts = 5, maximumRows = 12;
const fretBands = [[0, 2], [3, 5], [6, 8], [9, 11], [12, 14], [15, 17], [18, 24]];
export const bandLabel = (fret: number) => { const [low, high] = fretBands.find(([, h]) => fret <= h)!; return high === 24 ? `${low}F〜` : `${low}–${high}F`; };
const roleOrder = ['third', 'seventh', 'guide', 'fifth', 'sixth', 'fourth', 'second', 'ninth', 'root'];
export const roleNames: Record<string, string> = { third: '3rd', seventh: '7th', guide: '3rd+7th', fifth: '5th', sixth: '6th', fourth: '4th', second: '2nd', ninth: '9th', root: 'R' };
const earKindOrder = ['single', 'interval', 'melody', 'chord'];
/** Row and column of one item for a table, or null when the item does not belong to it. */
function place(table: WeaknessTable, itemId: string, instrument?: string): [string, string] | null {
  const parts = itemId.split(':');
  if (table === 'ct') return parts[0] === 'ct' && parts.length === 4 ? [parts[1], parts[3]] : null;
  if (table === 'iv') return parts[0] === 'iv' && parts.length === 4 ? [parts[2], parts[3]] : null;
  if (table === 'ivf') return parts[0] === 'ivf' && parts.length === 5 && (!instrument || parts[1] === instrument) ? [parts[2], parts[3]] : null;
  if (table === 'fb') return parts[0] === 'fb' && parts.length === 4 && (!instrument || parts[1] === instrument) ? [parts[2], bandLabel(Number(parts[3]))] : null;
  if (table === 'ear') return parts[0] === 'ear' && parts.length === 4 ? [parts[2], `${parts[1]}${parts[3] === 'chromatic' ? ':chromatic' : ''}`] : null;
  return (parts[0] === 'rhy' || parts[0] === 'rhyplay') && parts.length === 3 ? [parts[0] === 'rhy' ? parts[1] : `${parts[1]}:play`, parts[2]] : null;
}
function orderOf(table: WeaknessTable, axis: 'row' | 'column'): (value: string) => number {
  const index = (list: string[]) => (v: string) => { const i = list.indexOf(v); return i < 0 ? list.length : i; };
  if (table === 'ct') return axis === 'row' ? index([...new Set([...arpeggioQualities.triads, ...qualityOrder])]) : index(roleOrder);
  if (table === 'iv' || table === 'ivf') return axis === 'row' ? index(intervalStages[4]) : index(['up', 'down']);
  if (table === 'fb') return axis === 'row' ? Number : index(fretBands.map(([l]) => bandLabel(l)));
  if (table === 'ear') return axis === 'row' ? Number : (v: string) => earKindOrder.indexOf(v.split(':')[0]) * 2 + (v.endsWith(':chromatic') ? 1 : 0);
  return axis === 'row' ? (v: string) => rhythmPatterns.findIndex(p => p.id === v.split(':')[0]) * 2 + (v.endsWith(':play') ? 1 : 0) : (v: string) => parseInt(v, 10);
}
const qualityOrder = ['maj7', 'min7', 'dom7', 'half-dim', 'dim7', 'minmaj7', 'six', 'min6', 'nine', 'maj9', 'min9', 'sus4', 'sus2', 'seven-sus4'];
const sortBy = (order: (v: string) => number) => (a: string, b: string) => order(a) - order(b) || a.localeCompare(b);

/** Cross table of the recorded items: graded answers, accuracy, median response and the mastered share per cell.
 * Layers are kept apart (knowing a note is not finding it on the board), and cells under five graded answers are marked
 * insufficient. At most twelve rows are shown, the weakest first when there are more. */
export function weakness(stats: Record<string, ItemStat>, filter: WeaknessFilter, targets: Targets = targetsOf({})): WeaknessGrid {
  const groups = new Map<string, { row: string; column: string; stats: ItemStat[] }>();
  for (const stat of Object.values(stats)) {
    if (filter.layer && stat.layer !== filter.layer) continue;
    const at = place(filter.table, stat.itemId, filter.instrument);
    if (!at) continue;
    const key = `${at[0]}|${at[1]}`, group = groups.get(key) ?? { row: at[0], column: at[1], stats: [] };
    group.stats.push(stat); groups.set(key, group);
  }
  const cells: WeaknessCell[] = [...groups.values()].map(({ row, column, stats: list }) => {
    const attempts = list.reduce((n, s) => n + graded(s), 0), correct = list.reduce((n, s) => n + s.correct, 0), times = list.flatMap(s => s.recentMs);
    const layers = [...new Set(list.map(s => s.layer))];
    return {
      row, column, itemIds: [...new Set(list.map(s => s.itemId))], layer: layers.length === 1 ? layers[0] : null, attempts,
      accuracy: attempts ? correct / attempts : null, medianMs: times.length ? median(times) : null,
      masteredShare: list.filter(s => masteredStat(s, layerTarget(targets, s.layer))).length / list.length, insufficient: attempts < minimumAttempts,
    };
  });
  let rows = [...new Set(cells.map(c => c.row))].sort(sortBy(orderOf(filter.table, 'row')));
  const columns = [...new Set(cells.map(c => c.column))].sort(sortBy(orderOf(filter.table, 'column')));
  let hiddenRows = 0;
  if (rows.length > maximumRows) {
    const score = (row: string) => { const list = cells.filter(c => c.row === row && c.accuracy !== null); return list.length ? Math.min(...list.map(c => c.accuracy!)) : 2; };
    const kept = new Set(rows.slice().sort((a, b) => score(a) - score(b)).slice(0, maximumRows));
    hiddenRows = rows.length - kept.size; rows = rows.filter(r => kept.has(r));
  }
  return { table: filter.table, rows, columns, cells: cells.filter(c => rows.includes(c.row)), hiddenRows };
}

// Levels ----------------------------------------------------------------------------------------------------------
export type LevelId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7';
export const levels: { id: LevelId; name: string; description: string }[] = [
  { id: 'L1', name: '指板', description: '全弦の自然音（0〜12F）' },
  { id: 'L2', name: '指板＋', description: '全弦の全音（♯・♭を含む、0〜12F）' },
  { id: 'L3', name: 'インターバル基礎', description: 'm3・M3・P5・m7・M7（上行、12の音高）' },
  { id: 'L4', name: 'ガイドトーン', description: 'maj7・m7・7・m7♭5 の 3rd と 7th（12の音高）' },
  { id: 'L5', name: 'アルペジオ', description: 'トライアドと maj7・m7・7・m7♭5 の各転回形（弦セット・方向は問わない）' },
  { id: 'L6', name: '進行', description: 'maj7・m7・7・m7♭5 で、進行の段階 3rd・7th・3rd と 7th・コードトーン' },
  { id: 'L7', name: '上級', description: 'テンション、コード・スケール、アプローチ' },
];
export const reachShare = .8;
/** The fretboard levels depend on the instrument: its strings and the frets 0–12. */
export interface LevelContext { instrument: string; positions: { string: number; fret: number; natural: boolean }[] }
export function levelContext(core: ReturnType<typeof create>, instrument: string): LevelContext {
  const positions = Array.from({ length: core.stringCount }, (_, s) => Array.from({ length: 13 }, (_, fret) => ({ string: s + 1, fret }))).flat();
  return { instrument, positions: positions.map(p => ({ ...p, natural: core.isNatural(p) })) };
}
export interface LevelProgress { id: LevelId; name: string; description: string; mastered: number; total: number; ratio: number; reached: boolean }
const pcOf = (name: string) => { try { return pitchOf(name); } catch { return null; } };
/** Slot an item fills for a level (spellings of the same pitch, string sets and directions are one slot), or null. */
function slotFor(level: LevelId, itemId: string, context: LevelContext): string[] | null {
  const p = itemId.split(':');
  if (level === 'L1' || level === 'L2') return p[0] === 'fb' && p.length === 4 && p[1] === context.instrument ? [`${p[2]}:${p[3]}`] : null;
  if (level === 'L3') return p[0] === 'iv' && p.length === 4 && p[3] === 'up' && pcOf(p[1]) !== null ? [`${p[2]}:${pcOf(p[1])}`] : null;
  if (level === 'L5') return p[0] === 'arp' && p.length === 6 && pcOf(p[2]) !== null ? [`${p[1]}:${pcOf(p[2])}:${p[3]}`] : null;
  if (level === 'L6') return p[0] === 'chg' && p.length === 3 ? [`${p[1]}:${p[2]}`] : null;
  if (level === 'L7') {
    if (p[0] === 'tn' && p.length === 4 && pcOf(p[2]) !== null) return [`tn:${p[1]}:${pcOf(p[2])}:${p[3]}`];
    if (p[0] === 'cs' && p.length === 3 && pcOf(p[2]) !== null) return [`cs:${p[1]}:${pcOf(p[2])}`];
    if (p[0] === 'apr' && p.length === 3) return [`apr:${p[1]}:${p[2]}`];
  }
  return null;
}
const twelve = Array.from({ length: 12 }, (_, i) => i);
let advancedSlots: string[] | null = null;
function slotsOf(level: LevelId, context: LevelContext): string[] {
  if (level === 'L1') return context.positions.filter(p => p.natural).map(p => `${p.string}:${p.fret}`);
  if (level === 'L2') return context.positions.map(p => `${p.string}:${p.fret}`);
  if (level === 'L3') return intervalStages[1].flatMap(id => twelve.map(pc => `${id}:${pc}`));
  if (level === 'L5') return twelve.flatMap(pc => [...arpeggioQualities.triads.flatMap(q => [0, 1, 2].map(i => `${q}:${pc}:inv${i}`)), ...guideToneQualities.flatMap(q => [0, 1, 2, 3].map(i => `${q}:${pc}:inv${i}`))]);
  if (level === 'L6') return guideToneQualities.flatMap(q => ['third', 'seventh', 'guide', 'any-chord-tone'].map(stage => `${q}:${stage}`));
  advancedSlots ??= [...new Set([
    ...tensionQuestions('standard', true).flatMap(q => slotFor('L7', q.itemId, context) ?? []),
    ...chordScaleQuestions('standard', true).flatMap(q => slotFor('L7', q.itemId, context) ?? []),
    ...approachPatterns.flatMap(a => guideToneQualities.map(q => `apr:${a.id}:${q}`)),
  ])];
  return advancedSlots;
}
/** Progress toward one level: its fixed set of slots and how many are mastered in any layer (80% reaches it).
 * Mastery uses the same default goals as the advanced unlock, so L4 is exactly the unlock count. */
const masteredOf = (data: TrainingData) => Object.values(data.stats).filter(stat => isMastered(stat, stat.layer === 'performance' ? defaultTargetMs('play') : defaultTargetMs('name')));
export function levelProgress(data: TrainingData, level: LevelId, context: LevelContext, mastered = masteredOf(data)): LevelProgress {
  const info = levels.find(l => l.id === level)!;
  if (level === 'L4') { const s = advancedStatus(data); return { ...info, mastered: s.mastered, total: s.total, ratio: s.ratio, reached: s.unlocked }; }
  const wanted = new Set(slotsOf(level, context)), filled = new Set<string>();
  for (const stat of mastered) for (const slot of slotFor(level, stat.itemId, context) ?? []) if (wanted.has(slot)) filled.add(slot);
  const total = wanted.size, ratio = total ? filled.size / total : 0;
  return { ...info, mastered: filled.size, total, ratio, reached: total > 0 && filled.size >= Math.ceil(total * reachShare) };
}
export const allLevels = (data: TrainingData, context: LevelContext) => { const mastered = masteredOf(data); return levels.map(l => levelProgress(data, l.id, context, mastered)); };
/** Dates levels were first reached, keyed by level (fretboard levels per instrument). Returns null when nothing is new,
 * so the caller writes only on change. */
export function reachedDates(previous: Record<string, string>, progress: LevelProgress[], context: LevelContext, now: Date): Record<string, string> | null {
  const next = { ...previous };
  for (const p of progress) { const key = p.id === 'L1' || p.id === 'L2' ? `${p.id}:${context.instrument}` : p.id; if (p.reached && !next[key]) next[key] = localDate(now); }
  return Object.keys(next).length === Object.keys(previous).length ? null : next;
}
export const reachedKey = (level: LevelId, context: LevelContext) => level === 'L1' || level === 'L2' ? `${level}:${context.instrument}` : level;

// Weighted deck ---------------------------------------------------------------------------------------------------
export type Priority = 'due' | 'weak' | 'new' | 'learning' | 'mastered';
const priorities: Priority[] = ['due', 'weak', 'new', 'learning', 'mastered'];
export function priorityOf(stat: ItemStat | undefined, now: Date, targetMs: number): Priority {
  if (!stat || graded(stat) === 0) return 'new';
  if (stat.box > 0 && isDue(stat, now)) return 'due';
  if (masteredStat(stat, targetMs)) return 'mastered';
  return weakStat(stat, targetMs) ? 'weak' : 'learning';
}
export interface WeightOptions<T> {
  stat: (item: T) => ItemStat | undefined; targetMs: number; last?: T | null;
  /** Items that must not follow each other (always includes the same item). */
  clash?: (a: T, b: T) => boolean;
}
/** One round with every item exactly once, ordered due → weak → new → learning → mastered, so a short drill reaches
 * mastered items rarely. Within a tier the order is random (the weakest first among weak items); an item that clashes
 * with the one before is swapped with the next fitting item a few places ahead (further only when none fits), so priority mostly holds.
 * As with the plain shuffle, a few orders are tried and the one with the fewest clashes is kept. */
export function weightedDeck<T>(items: T[], now: Date, random: () => number, options: WeightOptions<T>): T[] {
  const tiers = new Map<Priority, { item: T; accuracy: number }[]>(priorities.map(p => [p, []]));
  for (const item of items) {
    const stat = options.stat(item);
    tiers.get(priorityOf(stat, now, options.targetMs))!.push({ item, accuracy: stat && graded(stat) ? stat.correct / graded(stat) : 1 });
  }
  const clash = (a: T | null | undefined, b: T | undefined) => a != null && b !== undefined && (a === b || !!options.clash?.(a, b));
  let best: T[] = [], bestClashes = Infinity;
  for (let attempt = 0; attempt < 20 && bestClashes > 0; attempt++) {
    const deck = arrange(priorities.flatMap(p => {
      const list = tiers.get(p)!.slice();
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      if (p === 'weak') list.sort((a, b) => a.accuracy - b.accuracy);
      return list.map(e => e.item);
    }), options.last, clash);
    const clashes = deck.filter((item, i) => clash(i ? deck[i - 1] : options.last, item)).length;
    if (clashes < bestClashes) { best = deck; bestClashes = clashes; }
  }
  return best;
}
function arrange<T>(ordered: T[], last: T | null | undefined, clash: (a: T | null | undefined, b: T | undefined) => boolean): T[] {
  const deck: T[] = [];
  while (ordered.length) {
    const previous = deck.at(-1) ?? last, lookahead = Math.min(ordered.length, 8);
    let index = ordered.findIndex((item, i) => i < lookahead && !clash(previous, item));
    if (index < 0) index = Math.max(0, ordered.findIndex(item => !clash(previous, item)));
    deck.push(ordered.splice(index, 1)[0]);
  }
  // Greedy placement can strand clashing items at the end; each is moved to the nearest place that fits on both sides.
  for (let i = 0; i < deck.length; i++) {
    const before = i ? deck[i - 1] : last;
    if (!clash(before, deck[i]) || clash(before, deck[i + 1])) continue;
    const [item] = deck.splice(i, 1);
    const fits = (k: number) => !clash(k ? deck[k - 1] : last, item) && !clash(item, deck[k]);
    const slot = Array.from({ length: deck.length + 1 }, (_, k) => k).sort((a, b) => Math.abs(a - i) - Math.abs(b - i)).find(fits) ?? -1;
    deck.splice(slot < 0 ? i : slot, 0, item);
  }
  return deck;
}

// Today's practice ------------------------------------------------------------------------------------------------
export type Feature = 'harmony' | 'study' | 'ear' | 'rhythm' | 'progression' | 'phrase' | 'play';
export interface Destination { feature: Feature; kind?: string; label: string }
/** Where an item is practised: the trainer tab and, for harmony, the question kind. */
export function destinationOf(itemId: string): Destination | null {
  const prefix = itemId.split(':')[0];
  const harmony: Record<string, [string, string]> = { ct: ['chord', 'コードトーン'], iv: ['interval', 'インターバル'], ivf: ['interval', 'インターバル（指板）'], arp: ['arpeggio', 'アルペジオ'], key: ['key', '調と機能'], keyf: ['key', '調と機能'], tn: ['tension', 'テンション'], cs: ['chord-scale', 'コード・スケール'] };
  if (harmony[prefix]) return { feature: 'harmony', kind: harmony[prefix][0], label: `ハーモニー・${harmony[prefix][1]}` };
  if (prefix === 'fb' || prefix === 'note') return { feature: 'study', label: '指板学習' };
  if (prefix === 'ear') return { feature: 'ear', label: '聴音' };
  if (prefix === 'rhy' || prefix === 'rhyplay') return { feature: 'rhythm', label: 'リズム' };
  if (prefix === 'chg' || prefix === 'apr') return { feature: 'progression', label: '進行' };
  if (prefix === 'phr') return { feature: 'phrase', label: 'フレーズ' };
  if (prefix === 'play' || prefix === 'play-any') return { feature: 'play', label: '演奏練習' };
  return null;
}
export type StepKind = 'review' | 'weak' | 'new' | 'progression';
export interface Focus { feature: Feature; kind?: string; layer?: SkillLayer; itemIds?: string[]; label: string }
export interface MenuStep { kind: StepKind; minutes: number; title: string; detail: string; focus: Focus }
const levelFocus: Record<LevelId, Focus> = {
  L1: { feature: 'study', label: '指板学習（自然音）' }, L2: { feature: 'study', label: '指板学習' },
  L3: { feature: 'harmony', kind: 'interval', label: 'ハーモニー・インターバル' }, L4: { feature: 'harmony', kind: 'chord', label: 'ハーモニー・コードトーン' },
  L5: { feature: 'harmony', kind: 'arpeggio', label: 'ハーモニー・アルペジオ' }, L6: { feature: 'progression', label: '進行' }, L7: { feature: 'harmony', kind: 'tension', label: 'ハーモニー・テンション' },
};
const maximumFocusItems = 30;
const instrumentPrefixes = ['fb', 'ivf', 'play', 'play-any', 'note'];
/** Items that name an instrument (positions, board intervals, played notes) count only for the selected one. */
const forInstrument = (itemId: string, instrument: string) => { const p = itemId.split(':'); return !instrumentPrefixes.includes(p[0]) || p[1] === instrument; };
/** The largest group of items of one kind (board intervals also by condition) and layer, as a focus on those items. */
function largestGroup(list: ItemStat[]): Focus | null {
  const groups = new Map<string, { destination: Destination; layer: SkillLayer; ids: string[] }>();
  for (const stat of list) {
    const destination = destinationOf(stat.itemId), parts = stat.itemId.split(':');
    if (!destination) continue;
    const key = `${parts[0]}${parts[0] === 'ivf' ? `:${parts[4]}` : ''}|${stat.layer}`, group = groups.get(key) ?? { destination, layer: stat.layer, ids: [] };
    group.ids.push(stat.itemId); groups.set(key, group);
  }
  const best = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length)[0];
  return best ? { feature: best.destination.feature, kind: best.destination.kind, layer: best.layer, itemIds: best.ids.slice(0, maximumFocusItems), label: best.destination.label } : null;
}
const standardRoots = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Items of a level never answered in any layer (up to 30), asked as knowledge. Arpeggio and progression slots do not
 * name exact items, so those levels return null and the step only opens the trainer. */
export function newItems(data: TrainingData, level: LevelId, context: LevelContext): string[] | null {
  const tried = new Set(Object.values(data.stats).filter(s => graded(s) > 0).map(s => s.itemId));
  let ids: string[];
  if (level === 'L1' || level === 'L2') ids = context.positions.filter(p => level === 'L2' || p.natural).map(p => `fb:${context.instrument}:${p.string}:${p.fret}`);
  else if (level === 'L3') ids = intervalStages[1].flatMap(id => standardRoots.map(root => `iv:${root}:${id}:up`));
  // Guide-tone items are asked together; one tried as 3rd, 7th or both is not new.
  else if (level === 'L4') ids = guideToneQualities.flatMap(q => standardRoots.map(root => `ct:${q}:${root}:guide`)).filter(id => !['third', 'seventh'].some(role => tried.has(id.replace(/guide$/, role))));
  else if (level === 'L7') ids = tensionQuestions('standard', true).map(q => q.itemId);
  else return null;
  return ids.filter(id => !tried.has(id)).slice(0, maximumFocusItems);
}
/** Review (5 min) → weak items (5) → new items from the lowest level not reached (3) → progression (5).
 * A stage with nothing to practise is left out; progression appears once chord tones or changes have been practised. */
export function todayMenu(data: TrainingData, now: Date, context: LevelContext, targets: Targets = targetsOf(data.preferences)): MenuStep[] {
  const stats = Object.values(data.stats).filter(s => forInstrument(s.itemId, context.instrument)), steps: MenuStep[] = [];
  const due = stats.filter(s => priorityOf(s, now, layerTarget(targets, s.layer)) === 'due');
  const weak = stats.filter(s => priorityOf(s, now, layerTarget(targets, s.layer)) === 'weak');
  const review = largestGroup(due);
  if (review) steps.push({ kind: 'review', minutes: 5, title: '復習', detail: `復習の時期が来た ${due.length}項目（${review.label}から ${review.itemIds!.length}項目）`, focus: review });
  const weakFocus = largestGroup(weak);
  if (weakFocus) steps.push({ kind: 'weak', minutes: 5, title: '弱点', detail: `正答率が低いか時間がかかる ${weak.length}項目（${weakFocus.label}から ${weakFocus.itemIds!.length}項目）`, focus: weakFocus });
  const mastered = masteredOf(data), next = levels.find(l => !levelProgress(data, l.id, context, mastered).reached);
  const fresh = next ? newItems(data, next.id, context) : null;
  // A level whose items were all tried has nothing new: the review and weak steps cover it.
  if (next && (!fresh || fresh.length)) steps.push({ kind: 'new', minutes: 3, title: '新しい項目', detail: `${next.id} ${next.name}：${next.description}${fresh ? `（まだ答えていない ${fresh.length}項目）` : ''}`, focus: fresh ? { ...levelFocus[next.id], layer: 'knowledge', itemIds: fresh } : levelFocus[next.id] });
  if (stats.some(s => s.itemId.startsWith('chg:') || s.itemId.startsWith('ct:'))) steps.push({ kind: 'progression', minutes: 5, title: '進行・フレーズ', detail: '進行の上で 3rd・7th やラインを弾く', focus: { feature: 'progression', label: '進行' } });
  return steps;
}

// Overview and input ----------------------------------------------------------------------------------------------
/** Consecutive days with practice, ending today (or yesterday when today has none yet). */
export function streakDays(daily: DailySummary[], now: Date) {
  const practised = new Set(daily.filter(d => d.attempts > 0).map(d => d.date));
  const day = (offset: number) => localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
  let start = practised.has(day(0)) ? 0 : 1, count = 0;
  while (practised.has(day(start + count))) count++;
  return count;
}
export interface InputHealth { played: number; issues: number; ratio: number; warn: boolean }
/** Share of detection issues among recent played or sung answers; a high share points at the input settings, not the player. */
export function inputHealth(attempts: Attempt[], recent = 200): InputHealth {
  const played = attempts.slice(-recent).filter(a => a.method === 'play' || a.method === 'sing');
  const issues = played.filter(a => a.result === 'detection-issue').length, ratio = played.length ? issues / played.length : 0;
  return { played: played.length, issues, ratio, warn: played.length >= 10 && ratio >= .2 };
}
