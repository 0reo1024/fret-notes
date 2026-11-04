import { profileIds, type ProfileId } from '../instruments/profiles';
import { validPlayPosition, weakConstants, type PlayPositionDay } from '../practice/weak-positions';

export type SkillLayer = 'knowledge' | 'fretboard' | 'performance';
export type AttemptMethod = 'choice' | 'name' | 'click' | 'play' | 'sing' | 'tap' | 'self';
export type AttemptResult = 'correct' | 'wrong' | 'spelling' | 'timeout' | 'skipped' | 'self-marked' | 'detection-issue';
export interface Attempt {
  itemId: string; layer: SkillLayer; trainer: string; method: AttemptMethod; result: AttemptResult;
  errorKind?: string; responseMs: number | null; instrument: ProfileId; at: string;
}
export type Box = 0 | 1 | 2 | 3 | 4 | 5;
export interface ItemStat {
  itemId: string; layer: SkillLayer; attempts: number; correct: number; wrong: number; detectionIssues: number;
  recentMs: number[]; box: Box; dueAt: string; lastAt: string; firstAt: string;
}
export interface DailySummary { date: string; seconds: number; attempts: number; correct: number }
export interface Calibration { tapOffsetMs: number | null; inputOffsetMs: number | null }
/** `progressions` and `takes` are typed by the trainers that add them; here they are only bounded lists.
 * `playPositions` (single-note practice per day and asked position) was added later and may be missing from older files. */
export interface TrainingData {
  schemaVersion: 1; preferences: Record<string, unknown>; progressions: unknown[]; stats: Record<string, ItemStat>;
  daily: DailySummary[]; attempts: Attempt[]; takes: unknown[]; calibration: Calibration; playPositions: PlayPositionDay[];
}
export const limits = { progressions: 100, daily: 400, attempts: 2000, takes: 20, recentMs: 5, playPositions: weakConstants.maximumEntries };
export const emptyTrainingData = (): TrainingData => ({ schemaVersion: 1, preferences: {}, progressions: [], stats: {}, daily: [], attempts: [], takes: [], calibration: { tapOffsetMs: null, inputOffsetMs: null }, playPositions: [] });

const layers: SkillLayer[] = ['knowledge', 'fretboard', 'performance'];
const methods: AttemptMethod[] = ['choice', 'name', 'click', 'play', 'sing', 'tap', 'self'];
const results: AttemptResult[] = ['correct', 'wrong', 'spelling', 'timeout', 'skipped', 'self-marked', 'detection-issue'];
/** Box n is due again after this many days. */
const intervals = [0, 1, 2, 4, 8, 16];
/** A correct answer slower than this does not move the item up a box. Recorded play time includes detection delay. */
export const defaultTargetMs = (method: AttemptMethod) => ({ choice: 2500, name: 3000, click: 3000, play: 4000, sing: 4000, tap: 4000, self: 4000 })[method];
export const statKey = (layer: SkillLayer, itemId: string) => `${layer}|${itemId}`;

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar date, so a session after midnight counts for the new day. */
export const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
function addDays(date: Date, days: number) { const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days); return localDate(next); }
export const isDue = (stat: ItemStat, now: Date) => stat.dueAt <= localDate(now);
const median = (values: number[]) => { const sorted = values.slice().sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2; };
export const isMastered = (stat: ItemStat, targetMs: number) => stat.box >= 4 && stat.recentMs.length > 0 && median(stat.recentMs) <= targetMs;

/** Leitner step for one attempt. Skips, self-marks and detection issues are counted but never move the box or due date,
 * so a misheard input cannot mark an item weak. A clock that went backwards leaves the due date alone. */
export function review(stat: ItemStat | undefined, attempt: Attempt, now: Date, targetMs: number): ItemStat {
  const at = now.toISOString();
  const next: ItemStat = stat ? { ...stat, recentMs: stat.recentMs.slice() }
    : { itemId: attempt.itemId, layer: attempt.layer, attempts: 0, correct: 0, wrong: 0, detectionIssues: 0, recentMs: [], box: 0, dueAt: localDate(now), lastAt: at, firstAt: at };
  next.attempts++;
  const clockWentBack = !!stat && at < stat.lastAt;
  if (!clockWentBack) next.lastAt = at;
  if (attempt.result === 'detection-issue') { next.detectionIssues++; return next; }
  if (attempt.result === 'skipped' || attempt.result === 'self-marked') return next;
  if (attempt.result === 'correct') {
    next.correct++;
    if (attempt.responseMs !== null) next.recentMs = [...next.recentMs, attempt.responseMs].slice(-limits.recentMs);
    if (attempt.responseMs === null || attempt.responseMs <= targetMs) next.box = Math.min(5, next.box + 1) as Box;
  } else { next.wrong++; next.box = 1; }
  if (!clockWentBack) next.dueAt = addDays(now, intervals[next.box]);
  return next;
}

/** Returns new data with the attempt logged, its item reviewed and today's summary updated. */
export function record(data: TrainingData, attempt: Attempt, now: Date, targetMs = defaultTargetMs(attempt.method)): TrainingData {
  const key = statKey(attempt.layer, attempt.itemId), date = localDate(now);
  const seconds = attempt.responseMs === null ? 0 : Math.min(attempt.responseMs, 60000) / 1000;
  const today = data.daily.find(d => d.date === date) ?? { date, seconds: 0, attempts: 0, correct: 0 };
  const updated = { date, seconds: Math.round((today.seconds + seconds) * 10) / 10, attempts: today.attempts + 1, correct: today.correct + (attempt.result === 'correct' ? 1 : 0) };
  const daily = [...data.daily.filter(d => d.date !== date), updated].sort((a, b) => a.date < b.date ? -1 : 1).slice(-limits.daily);
  return { ...data, stats: { ...data.stats, [key]: review(data.stats[key], attempt, now, targetMs) }, daily, attempts: [...data.attempts, attempt].slice(-limits.attempts) };
}

/** Removes one day's single-note practice for an instrument: its weak-spot entries, its answers, and their share of
 * the day's summary and item counts. Boxes and due dates are not rolled back; an item left with no answers is dropped. */
export function clearPlayDay(data: TrainingData, date: string, instrument: ProfileId): TrainingData {
  const removed = data.attempts.filter(a => a.trainer === 'play' && a.instrument === instrument && localDate(new Date(a.at)) === date);
  const stats = { ...data.stats };
  for (const attempt of removed) {
    const key = statKey(attempt.layer, attempt.itemId), stat = stats[key];
    if (!stat) continue;
    const next = { ...stat, attempts: stat.attempts - 1, correct: stat.correct - (attempt.result === 'correct' ? 1 : 0), wrong: stat.wrong - (attempt.result === 'wrong' ? 1 : 0) };
    if (next.attempts <= 0) delete stats[key]; else stats[key] = { ...next, correct: Math.max(0, next.correct), wrong: Math.max(0, next.wrong) };
  }
  const seconds = removed.reduce((sum, a) => sum + (a.responseMs === null ? 0 : Math.min(a.responseMs, 60000) / 1000), 0);
  const daily = data.daily.map(d => d.date !== date ? d : {
    date, seconds: Math.max(0, Math.round((d.seconds - seconds) * 10) / 10), attempts: Math.max(0, d.attempts - removed.length),
    correct: Math.max(0, d.correct - removed.filter(a => a.result === 'correct').length),
  }).filter(d => d.date !== date || d.attempts > 0);
  return { ...data, stats, daily, attempts: data.attempts.filter(a => !removed.includes(a)),
    playPositions: data.playPositions.filter(e => e.date !== date || e.instrument !== instrument) };
}
/** Whether that day has any single-note practice for the instrument. */
export const hasPlayDay = (data: TrainingData, date: string, instrument: ProfileId) =>
  data.playPositions.some(e => e.date === date && e.instrument === instrument)
  || data.attempts.some(a => a.trainer === 'play' && a.instrument === instrument && localDate(new Date(a.at)) === date);

export interface TrainingSummary {
  today: DailySummary; week: DailySummary; days: DailySummary[]; items: number; mastered: number; due: number;
}
/** Overview for the records tab: today, the last seven days, and item counts across all layers. */
export function summarize(data: TrainingData, now: Date): TrainingSummary {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(now, i - 6));
  const days = dates.map(date => data.daily.find(d => d.date === date) ?? { date, seconds: 0, attempts: 0, correct: 0 });
  const week = days.reduce((sum, d) => ({ date: dates[0], seconds: Math.round((sum.seconds + d.seconds) * 10) / 10, attempts: sum.attempts + d.attempts, correct: sum.correct + d.correct }), { date: dates[0], seconds: 0, attempts: 0, correct: 0 });
  const stats = Object.values(data.stats);
  return {
    today: days[6], week, days, items: stats.length,
    mastered: stats.filter(s => isMastered(s, s.layer === 'performance' ? defaultTargetMs('play') : defaultTargetMs('name'))).length,
    due: stats.filter(s => s.box > 0 && isDue(s, now)).length,
  };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value: unknown, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const time = (value: unknown) => text(value, 40) && !Number.isNaN(Date.parse(value as string));
const day = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const offset = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 2000;
function validAttempt(a: unknown) {
  return object(a) && onlyKeys(a, ['itemId', 'layer', 'trainer', 'method', 'result', 'responseMs', 'instrument', 'at'], ['errorKind'])
    && text(a.itemId) && layers.includes(a.layer as SkillLayer) && text(a.trainer, 40) && methods.includes(a.method as AttemptMethod)
    && results.includes(a.result as AttemptResult) && (a.errorKind === undefined || text(a.errorKind, 80))
    && (a.responseMs === null || typeof a.responseMs === 'number' && Number.isFinite(a.responseMs) && a.responseMs >= 0)
    && profileIds.includes(a.instrument as ProfileId) && time(a.at);
}
function validStat(key: string, s: unknown) {
  return object(s) && onlyKeys(s, ['itemId', 'layer', 'attempts', 'correct', 'wrong', 'detectionIssues', 'recentMs', 'box', 'dueAt', 'lastAt', 'firstAt'])
    && text(s.itemId) && layers.includes(s.layer as SkillLayer) && key === statKey(s.layer as SkillLayer, s.itemId as string)
    && [s.attempts, s.correct, s.wrong, s.detectionIssues].every(count) && (s.correct as number) + (s.wrong as number) + (s.detectionIssues as number) <= (s.attempts as number)
    && Array.isArray(s.recentMs) && s.recentMs.length <= limits.recentMs && s.recentMs.every(ms => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0)
    && [0, 1, 2, 3, 4, 5].includes(s.box as number) && day(s.dueAt) && time(s.lastAt) && time(s.firstAt);
}
/** Strict decode for loading and importing; anything unexpected is rejected rather than repaired. */
export function decodeTrainingData(input: unknown): TrainingData {
  if (!object(input) || input.schemaVersion !== 1) throw new Error('対応するバージョンの学習記録ではありません');
  if (!onlyKeys(input, ['schemaVersion', 'preferences', 'progressions', 'stats', 'daily', 'attempts', 'takes', 'calibration'], ['playPositions'])) throw new Error('学習記録の項目が不正です');
  const { preferences, progressions, stats, daily, attempts, takes, calibration, playPositions = [] } = input;
  if (!object(preferences) || !Array.isArray(progressions) || progressions.length > limits.progressions || !Array.isArray(takes) || takes.length > limits.takes) throw new Error('学習記録の設定・進行が不正です');
  if (!object(stats) || !Object.entries(stats).every(([key, stat]) => validStat(key, stat))) throw new Error('項目ごとの記録が不正です');
  if (!Array.isArray(daily) || daily.length > limits.daily || !daily.every(d => object(d) && onlyKeys(d, ['date', 'seconds', 'attempts', 'correct']) && day(d.date)
    && typeof d.seconds === 'number' && Number.isFinite(d.seconds) && d.seconds >= 0 && count(d.attempts) && count(d.correct) && (d.correct as number) <= (d.attempts as number))) throw new Error('日別の記録が不正です');
  if (!Array.isArray(attempts) || attempts.length > limits.attempts || !attempts.every(validAttempt)) throw new Error('回答の記録が不正です');
  if (!object(calibration) || !onlyKeys(calibration, ['tapOffsetMs', 'inputOffsetMs']) || !offset(calibration.tapOffsetMs) || !offset(calibration.inputOffsetMs)) throw new Error('補正値が不正です');
  if (!Array.isArray(playPositions) || playPositions.length > limits.playPositions || !playPositions.every(validPlayPosition)) throw new Error('演奏位置の記録が不正です');
  return structuredClone({ ...input, playPositions }) as unknown as TrainingData;
}
