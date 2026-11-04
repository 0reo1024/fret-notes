export type ProfileId = 'guitar' | 'bass4' | 'bass5';
export const profileIds: ProfileId[] = ['guitar', 'bass4', 'bass5'];
export interface TuningPreset { id: string; name: string; instrumentId: ProfileId; openMidi: number[] }
export interface TuningConfig { selectedTuningId: string; customTunings: TuningPreset[] }
export interface InstrumentProfile {
  id: ProfileId; displayName: string; instrument: 'guitar' | 'bass'; fretCount: number;
  strings: { id: string; number: number; openMidi: number }[];
  tuning: TuningPreset;
}
const specifications = {
  guitar: { displayName: 'Guitar', instrument: 'guitar', openMidi: [64, 59, 55, 50, 45, 40] },
  bass4: { displayName: '4弦 Bass', instrument: 'bass', openMidi: [43, 38, 33, 28] },
  bass5: { displayName: '5弦 Bass', instrument: 'bass', openMidi: [43, 38, 33, 28, 23] },
} as const;
export const pitchNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const midiName = (midi: number) => `${pitchNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const defaultTuning = (): TuningConfig => ({ selectedTuningId: 'standard', customTunings: [] });
export function presetsFor(id: ProfileId): TuningPreset[] {
  const standard: number[] = [...specifications[id].openMidi];
  const dropped = standard.slice(); dropped[dropped.length - 1] -= 2;
  const presets = [
    { id: 'standard', name: '標準', instrumentId: id, openMidi: standard },
    { id: id === 'bass5' ? 'drop-a' : 'drop-d', name: id === 'bass5' ? 'Drop A' : 'Drop D', instrumentId: id, openMidi: dropped },
    { id: 'half-step-down', name: '半音下げ', instrumentId: id, openMidi: standard.map(n => n - 1) },
  ];
  // Bass standard is already in fourths; only guitar gets a separate all-fourths preset.
  if (id === 'guitar') presets.push({ id: 'all-fourths', name: '4度チューニング（E A D G C F）', instrumentId: id, openMidi: fourthsGuitar.slice() });
  return presets;
}
const fourthsGuitar = [65, 60, 55, 50, 45, 40];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
export function decodeTuning(input: unknown, id: ProfileId): TuningConfig {
  if (input === undefined) return defaultTuning();
  if (!object(input) || !onlyKeys(input, ['selectedTuningId', 'customTunings']) || typeof input.selectedTuningId !== 'string' || !Array.isArray(input.customTunings) || input.customTunings.length > 12) throw new Error('チューニング設定が不正です');
  const customTunings = input.customTunings.map((tuning): TuningPreset => {
    if (!object(tuning) || !onlyKeys(tuning, ['id', 'name', 'instrumentId', 'openMidi']) || typeof tuning.id !== 'string' || !/^user:[a-zA-Z0-9-]{1,64}$/.test(tuning.id)
      || tuning.instrumentId !== id || typeof tuning.name !== 'string' || !tuning.name.trim() || [...tuning.name].length > 40 || /[\u0000-\u001f\u007f]/.test(tuning.name)
      || !Array.isArray(tuning.openMidi) || tuning.openMidi.length !== specifications[id].openMidi.length
      || !tuning.openMidi.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 115)) throw new Error('各弦の音高・チューニング名を確認してください');
    return { id: tuning.id, name: tuning.name.trim(), instrumentId: id, openMidi: tuning.openMidi.slice() };
  });
  if (new Set(customTunings.map(t => t.id)).size !== customTunings.length || ![...presetsFor(id), ...customTunings].some(t => t.id === input.selectedTuningId)) throw new Error('選択中のチューニングが見つかりません');
  return { selectedTuningId: input.selectedTuningId, customTunings };
}
export function resolveInstrument(id: ProfileId, input?: TuningConfig): InstrumentProfile {
  const config = decodeTuning(input, id);
  const tuning = [...presetsFor(id), ...config.customTunings].find(t => t.id === config.selectedTuningId)!;
  const specification = specifications[id];
  return {
    id, displayName: specification.displayName, instrument: specification.instrument, fretCount: 12,
    strings: tuning.openMidi.map((openMidi, index) => ({ id: `${id}:string:${index + 1}`, number: index + 1, openMidi })), tuning,
  };
}
const matches = (profile: InstrumentProfile, openMidi: readonly number[]) =>
  profile.strings.length === openMidi.length && profile.strings.every((string, index) => string.number === index + 1 && string.openMidi === openMidi[index]);
export function matchesStandardTuning(profile: InstrumentProfile): boolean {
  return matches(profile, specifications[profile.id].openMidi);
}
/** Tunings with chord shapes: standard, or all fourths on guitar (by absolute pitch, octave included). */
export function shapeTuning(profile: InstrumentProfile): 'standard' | 'fourths' | null {
  if (matchesStandardTuning(profile)) return 'standard';
  return profile.id === 'guitar' && matches(profile, fourthsGuitar) ? 'fourths' : null;
}
