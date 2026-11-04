import { resolveInstrument, pitchNames, type InstrumentProfile, type TuningConfig } from './profiles';
export type { InstrumentProfile } from './profiles';
export interface Position { string: number; fret: number }
export type InstrumentKind = 'guitar' | 'bass';
export type Notation = 'both' | 'sharp' | 'flat';
export type PracticeMode = 'forward' | 'reverse' | 'find-all' | 'study';
export interface PracticeSettings {
  highlightRange: boolean; showTuning: boolean; naturalOnly: boolean;
  strings: number[]; frets: number[]; notation: Notation; mode: PracticeMode;
}
const sharp = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const flat = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function create(profile: InstrumentProfile) {
  const openMidi = profile.strings.map(string => string.openMidi), opens = openMidi.map(midi => midi % 12);
  const openNames = opens.map(pitch => pitchNames[pitch]), stringCount = opens.length;
  const key = (p: Position) => `${p.string}:${p.fret}`;
  const pitch = (p: Position) => (opens[p.string - 1] + p.fret) % 12;
  const midi = (p: Position) => openMidi[p.string - 1] + p.fret;
  const frequency = (p: Position, reference = 440) => reference * 2 ** ((midi(p) - 69) / 12);
  function name(p: Position, notation: Notation = 'both') {
    const n = pitch(p);
    return notation === 'flat' ? flat[n] : notation === 'sharp' ? sharp[n] : sharp[n] === flat[n] ? sharp[n] : `${sharp[n]} / ${flat[n]}`;
  }
  const isNatural = (p: Position) => [0, 2, 4, 5, 7, 9, 11].includes(pitch(p));
  const allowed = (p: Position, settings: PracticeSettings) => settings.strings.includes(p.string) && settings.frets.includes(p.fret) && (!settings.naturalOnly || isNatural(p));
  const candidates = (settings: PracticeSettings): Position[] => settings.strings.flatMap(string => settings.frets.map(fret => ({ string, fret }))).filter(p => allowed(p, settings));
  function movePosition(settings: PracticeSettings, p: Position | null, direction: string): Position | null {
    const all = candidates(settings);
    if (!all.length) return null;
    if (!p || !allowed(p, settings)) return all[0];
    const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight', step = direction === 'ArrowLeft' || direction === 'ArrowUp' ? -1 : 1;
    const options = all.filter(q => horizontal ? q.string === p.string && (q.fret - p.fret) * step > 0 : (q.string - p.string) * step > 0);
    options.sort((a, b) => horizontal ? Math.abs(a.fret - p.fret) - Math.abs(b.fret - p.fret) : Math.abs(a.string - p.string) - Math.abs(b.string - p.string) || Math.abs(a.fret - p.fret) - Math.abs(b.fret - p.fret) || a.fret - b.fret);
    return options[0] || p;
  }
  function shuffled(positions: Position[], last: Position | null = null, random = Math.random) {
    const a = positions.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (a.length > 1 && last && key(a[0]) === key(last)) { const j = 1 + Math.floor(random() * (a.length - 1)); [a[0], a[j]] = [a[j], a[0]]; }
    return a;
  }
  function isCorrect(target: Position | null, selected: Position, settings: PracticeSettings) {
    return !!target && allowed(selected, settings) && target.string === selected.string && pitch(target) === pitch(selected);
  }
  function normalize(input?: unknown): PracticeSettings {
    const data = record(input);
    const values = (value: unknown, max: number, min: number, fallback: number[]) => Array.isArray(value) ? [...new Set(value.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max))].sort((a, b) => a - b) : fallback;
    return {
      highlightRange: data.highlightRange !== false, showTuning: data.showTuning !== false, naturalOnly: data.naturalOnly === true,
      strings: values(data.strings, stringCount, 1, Array.from({ length: stringCount }, (_, i) => i + 1)), frets: values(data.frets, profile.fretCount, 0, Array.from({ length: profile.fretCount + 1 }, (_, i) => i)),
      notation: ['both', 'sharp', 'flat'].includes(String(data.notation)) ? data.notation as Notation : 'both',
      mode: ['forward', 'reverse', 'find-all', 'study'].includes(String(data.mode)) ? data.mode as PracticeMode : 'forward',
    };
  }
  return { key, pitch, midi, frequency, name, isNatural, allowed, candidates, movePosition, shuffled, isCorrect, normalize, ...profile, opens, openMidi, openNames, stringCount };
}
export function forInstrument(kind: string = 'guitar', count = 4, tuning?: TuningConfig) {
  return create(resolveInstrument(kind === 'bass' ? (count === 5 ? 'bass5' : 'bass4') : 'guitar', tuning));
}
const core = { ...forInstrument(), forInstrument, create };
export const { key, pitch, midi, frequency, name, isNatural, allowed, candidates, movePosition, shuffled, isCorrect, normalize } = core;
export default core;
