import { profileIds, type ProfileId } from '../instruments/profiles';

/** One day of single-note practice at one asked position. The string is the one asked for: audio cannot tell strings apart. */
export interface PlayPositionDay {
  date: string; instrument: ProfileId; string: number; fret: number; midi: number;
  asked: number; answered: number; wrong: number; totalMs: number;
}
/** Smoothing pulls positions with few questions toward an ordinary player (10% wrong, 60% of the goal time);
 * a score of 100 means one mistake in two questions at the goal time. */
export const weakConstants = {
  priorCount: 2, priorError: .1, priorTimeShare: .6, timeCapShare: 3, weakThreshold: 70, tentativeBelow: 3,
  focusMinimum: 40, focusMinimumPositions: 2, focusCounts: [5, 10, 15], defaultFocusCount: 10, retentionDays: 400, maximumEntries: 20000,
};
export interface Spot { string: number; fret: number; midi: number }
/** The MIDI note at a position in the current tuning, or null when the position does not exist. */
export type MidiAt = (string: number, fret: number) => number | null;
export type PlayOutcome = { kind: 'answered' | 'abandoned'; listeningMs: number; wrongAttempts: number };

const keyOf = (e: PlayPositionDay) => `${e.date}|${e.instrument}|${e.string}|${e.fret}|${e.midi}`;
const timeCap = (targetMs: number) => Math.round(targetMs * weakConstants.timeCapShare);

/** One question as a day entry. A question counts as at most one mistake however many wrong notes were played; a question
 * left unanswered counts as a mistake at the time cap, but only when the player struggled with it (a mistake or the goal
 * time passed); stopping right away is not recorded. */
export function playPositionEntry(target: Spot, outcome: PlayOutcome, instrument: ProfileId, date: string, targetMs: number): PlayPositionDay | null {
  const base = { date, instrument, string: target.string, fret: target.fret, midi: target.midi, asked: 1 };
  if (outcome.kind === 'answered') return { ...base, answered: 1, wrong: outcome.wrongAttempts > 0 ? 1 : 0, totalMs: Math.round(Math.min(outcome.listeningMs, timeCap(targetMs))) };
  if (outcome.wrongAttempts < 1 && outcome.listeningMs < targetMs) return null;
  return { ...base, answered: 0, wrong: 1, totalMs: timeCap(targetMs) };
}
/** Adds the entry to its day and position; only the newest 400 dates and 20000 entries are kept. */
export function addPlayPosition(list: PlayPositionDay[], entry: PlayPositionDay): PlayPositionDay[] {
  const key = keyOf(entry), index = list.findIndex(e => keyOf(e) === key);
  const next = index < 0 ? [...list, { ...entry }] : list.map((e, i) => i !== index ? e : { ...e, asked: e.asked + entry.asked, answered: e.answered + entry.answered, wrong: e.wrong + entry.wrong, totalMs: e.totalMs + entry.totalMs });
  const kept = new Set([...new Set(next.map(e => e.date))].sort().slice(-weakConstants.retentionDays));
  return next.filter(e => kept.has(e.date)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).slice(-weakConstants.maximumEntries);
}
export function weaknessScore(entry: Pick<PlayPositionDay, 'asked' | 'wrong' | 'totalMs'>, targetMs: number) {
  const { priorCount: k, priorError, priorTimeShare } = weakConstants;
  const error = (entry.wrong + k * priorError) / (entry.asked + k), time = (entry.totalMs + k * priorTimeShare * targetMs) / (entry.asked + k);
  return Math.round(100 * (error + .5 * time / targetMs));
}

export interface RankedPosition extends PlayPositionDay { score: number; averageMs: number; weak: boolean; tentative: boolean; previousRank: number | null }
interface Scope { instrument: ProfileId; midiAt: MidiAt }
/** Entries for the instrument whose note still sits at that position in the current tuning. */
const inScope = (list: PlayPositionDay[], scope: Scope) => list.filter(e => e.instrument === scope.instrument && scope.midiAt(e.string, e.fret) === e.midi);
/** Dates with records for the instrument and tuning, newest first. */
export function rankingDates(list: PlayPositionDay[], scope: Scope): string[] {
  return [...new Set(inScope(list, scope).map(e => e.date))].sort().reverse();
}
function dayRanking(list: PlayPositionDay[], date: string, targetMs: number) {
  return list.filter(e => e.date === date).map(e => ({ ...e, score: weaknessScore(e, targetMs), averageMs: e.totalMs / e.asked }))
    .sort((a, b) => b.score - a.score || b.wrong - a.wrong || b.averageMs - a.averageMs || a.string - b.string || a.fret - b.fret);
}
/** The day's positions, weakest first, with the rank each had on the previous day with records. */
export function rankPositions(list: PlayPositionDay[], query: Scope & { date: string; targetMs: number }): RankedPosition[] {
  const scoped = inScope(list, query), previous = rankingDates(scoped, query).find(d => d < query.date);
  const before = new Map((previous ? dayRanking(scoped, previous, query.targetMs) : []).map((e, i) => [`${e.string}:${e.fret}`, i + 1]));
  return dayRanking(scoped, query.date, query.targetMs).map(e => ({
    ...e, weak: e.score >= weakConstants.weakThreshold, tentative: e.asked < weakConstants.tentativeBelow, previousRank: before.get(`${e.string}:${e.fret}`) ?? null,
  }));
}
export interface FocusSelection { date: string; positions: { string: number; fret: number }[] }
/** Weak positions to drill: from today when it already has two or more, otherwise from the latest day that does,
 * so the first answers of a day do not replace yesterday's list. Null when no day has enough. */
export function focusPositions(list: PlayPositionDay[], query: Scope & { today: string; targetMs: number; count: number; playable: (spot: Spot) => boolean }): FocusSelection | null {
  const scoped = inScope(list, query);
  for (const date of rankingDates(scoped, query).filter(d => d <= query.today)) {
    const candidates = dayRanking(scoped, date, query.targetMs).filter(e => e.score >= weakConstants.focusMinimum && query.playable(e));
    if (candidates.length >= weakConstants.focusMinimumPositions) return { date, positions: candidates.slice(0, query.count).map(({ string, fret }) => ({ string, fret })) };
  }
  return null;
}

const whole = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const entryKeys = ['date', 'instrument', 'string', 'fret', 'midi', 'asked', 'answered', 'wrong', 'totalMs'];
export function validPlayPosition(value: unknown): value is PlayPositionDay {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>, keys = Object.keys(e);
  return keys.length === entryKeys.length && entryKeys.every(k => keys.includes(k))
    && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && profileIds.includes(e.instrument as ProfileId)
    && whole(e.string, 1, 6) && whole(e.fret, 0, 24) && whole(e.midi, 0, 127) && whole(e.asked, 1) && whole(e.answered, 0, e.asked as number)
    && whole(e.wrong, 0) && whole(e.totalMs, 0);
}

export interface PlayPreferences { octave: 'exact' | 'any'; focus: boolean; focusCount: number }
/** Reads the play preferences; anything unexpected falls back to the default. */
export function playPreferences(value: unknown): PlayPreferences {
  const stored = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    octave: stored.octave === 'any' ? 'any' : 'exact', focus: stored.focus === true,
    focusCount: weakConstants.focusCounts.includes(stored.focusCount as number) ? stored.focusCount as number : weakConstants.defaultFocusCount,
  };
}
/** Applies a change on top of what is stored, so changing one setting keeps the others. */
export const mergePlayPreferences = (stored: unknown, change: Partial<PlayPreferences>) =>
  ({ ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}), ...change });
