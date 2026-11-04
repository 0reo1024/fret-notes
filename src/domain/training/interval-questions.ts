import { intervalDegree, intervalSemitones, transpose, type IntervalId } from '../music/harmony';
import { pitchOf } from '../music/theory';
import type { forInstrument, Position, PracticeSettings } from '../instruments/core';
import { rootsFor, type DrillQuestion, type RootSet } from './tone-questions';

export type IntervalStage = 1 | 2 | 3 | 4;
export type Direction = 'up' | 'down';
export type DirectionSet = Direction | 'both';
/** Fretboard shape condition between the shown root and the answer. */
export type BoardCondition = 'same' | 'adjacent' | 'window';
export interface IntervalConfig { stage: IntervalStage; direction: DirectionSet; roots: RootSet; sharpSix: boolean }

const basic: IntervalId[] = ['m3', 'M3', 'P5', 'm7', 'M7'];
export const intervalStages: Record<IntervalStage, IntervalId[]> = {
  1: basic,
  2: [...basic, 'P4', 'M6', 'M2', 'm2', 'm6'],
  3: [...basic, 'P4', 'M6', 'M2', 'm2', 'm6', 'A4', 'd5', 'A5'],
  4: [...basic, 'P4', 'M6', 'M2', 'm2', 'm6', 'A4', 'd5', 'A5', 'm9', 'M9', 'A9', 'P11', 'A11', 'm13', 'M13'],
};
export const intervalNames: Record<IntervalId, string> = {
  m2: '短2度', M2: '長2度', m3: '短3度', M3: '長3度', P4: '完全4度', A4: '増4度', d5: '減5度', P5: '完全5度', A5: '増5度',
  m6: '短6度', M6: '長6度', m7: '短7度', M7: '長7度', P8: '完全8度', m9: '短9度', M9: '長9度', A9: '増9度', P11: '完全11度', A11: '増11度', m13: '短13度', M13: '長13度',
};
const arrow = (direction: Direction) => direction === 'up' ? '上' : '下';
const directions = (set: DirectionSet): Direction[] => set === 'both' ? ['up', 'down'] : [set];
/** Spellings outside the usual key signatures. With the standard roots, double accidentals are never asked, and E♯/B♯/C♭/F♭
 * only where a key really uses them (F♯ up a major 7th is E♯); augmented and diminished intervals do not get them (B♭ up a d5 is F♭). */
export const unusualSpelling = (name: string) => /♭♭|♯♯/.test(name) || ['E♯', 'B♯', 'C♭', 'F♭'].includes(name);
const alteredIntervals: IntervalId[] = ['A4', 'd5', 'A5', 'A9', 'A11'];
export const skipForStandard = (id: IntervalId, name: string) => /♭♭|♯♯/.test(name) || alteredIntervals.includes(id) && unusualSpelling(name);

function question(root: string, id: IntervalId, direction: Direction, itemId: string, extra: Partial<DrillQuestion> = {}): DrillQuestion {
  const degree = intervalDegree(id), name = transpose(root, degree, direction);
  return {
    itemId, title: root, ask: `${intervalNames[id]}${arrow(direction)} ?`, root,
    answers: [{ degree, name, pitchClass: pitchOf(name) }], related: [{ degree: 'R', name: root, pitchClass: pitchOf(root) }], ...extra,
  };
}
/** Name questions: from a spelled root, name the note an interval above or below. */
export function intervalQuestions(config: IntervalConfig): DrillQuestion[] {
  return rootsFor(config.roots, config.sharpSix).flatMap(root => intervalStages[config.stage].flatMap(id => directions(config.direction).flatMap(direction => {
    const q = question(root, id, direction, `iv:${root}:${id}:${direction}`);
    return config.roots === 'standard' && skipForStandard(id, q.answers[0].name) ? [] : [q];
  })));
}

/** Words for the shape from the root to a target; string 1 is the highest, as on the board. */
export function relation(from: Position, to: Position) {
  const ds = to.string - from.string, df = to.fret - from.fret;
  const strings = ds === 0 ? '同じ弦' : `${Math.abs(ds)}本${ds < 0 ? '高い' : '低い'}弦`;
  const frets = df === 0 ? '同じフレット' : `${Math.abs(df)}フレット${df > 0 ? '上' : '下（ナット側）'}`;
  return `${strings}の${frets}`;
}
const commonNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Fretboard questions: from a shown root position, find the exact pitch an interval away under a shape condition.
 * Only root positions with at least one in-range answer are asked. */
export function boardIntervalQuestions(core: ReturnType<typeof forInstrument>, scope: PracticeSettings, config: Omit<IntervalConfig, 'roots' | 'sharpSix'>, condition: BoardCondition, instrument: string): DrillQuestion[] {
  const positions = core.candidates(scope);
  const fits = (root: Position, p: Position) => condition === 'same' ? p.string === root.string : condition === 'adjacent' ? Math.abs(p.string - root.string) === 1 : Math.abs(p.fret - root.fret) <= 4;
  return positions.flatMap(rootPosition => intervalStages[config.stage].flatMap(id => directions(config.direction).flatMap(direction => {
    const target = core.midi(rootPosition) + (direction === 'up' ? 1 : -1) * intervalSemitones(id);
    const answers = positions.filter(p => core.midi(p) === target && fits(rootPosition, p));
    if (!answers.length) return [];
    const root = commonNames[core.pitch(rootPosition)];
    const q = question(root, id, direction, `ivf:${instrument}:${id}:${direction}:${condition}`, { rootPosition, positions: answers, hint: answers.map(p => relation(rootPosition, p)).join(' ／ ') });
    return [{ ...q, title: `${rootPosition.string}弦 ${rootPosition.fret}F（${root}）` }];
  })));
}
