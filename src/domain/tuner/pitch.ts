import { midiName, type InstrumentProfile } from '../instruments/profiles';
export const minimumFrequency = 25;
export const maximumFrequency = 1500;
export function frequencyForMidi(midi: number, referenceHz = 440) { return referenceHz * 2 ** ((midi - 69) / 12); }
export function describePitch(frequency: number, referenceHz = 440, targetMidi?: number) {
  if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(referenceHz) || referenceHz < 400 || referenceHz > 480) return null;
  const exactMidi = 69 + 12 * Math.log2(frequency / referenceHz);
  const midi = Math.round(exactMidi);
  if (midi < 0 || midi > 127 || (targetMidi !== undefined && (!Number.isInteger(targetMidi) || targetMidi < 0 || targetMidi > 127))) return null;
  const target = targetMidi ?? midi;
  const cents = 1200 * Math.log2(frequency / frequencyForMidi(target, referenceHz));
  return { midi, note: midiName(midi), targetMidi: target, targetNote: midiName(target), targetFrequency: frequencyForMidi(target,referenceHz), cents, inTune: Math.abs(cents) <= 5 };
}
export function stringTargets(profile: InstrumentProfile, referenceHz = 440) {
  return profile.strings.map(string => ({ ...string, note: midiName(string.openMidi), frequency: frequencyForMidi(string.openMidi,referenceHz), supported: frequencyForMidi(string.openMidi,referenceHz) >= minimumFrequency && frequencyForMidi(string.openMidi,referenceHz) <= maximumFrequency }));
}
