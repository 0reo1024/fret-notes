import { pitchOf } from '../music/theory';
import type { Notation } from '../instruments/core';

/** Answer helpers shared by trainers: multiple choice over pitch classes and letter + accidental entry. */
const sharp = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const flat = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const mod = (n: number) => (n % 12 + 12) % 12;
/** Same wording as the fretboard's note names: 'C♯ / D♭' when both spellings are shown. */
export function pitchClassLabel(pc: number, notation: Notation) {
  const n = mod(pc);
  return notation === 'flat' ? flat[n] : notation === 'sharp' ? sharp[n] : sharp[n] === flat[n] ? sharp[n] : `${sharp[n]} / ${flat[n]}`;
}

/** Four distinct pitch classes including the answer. Distractors are near misses: a semitone or tone away,
 * or a fourth/fifth away as when the neighbouring string is misread. */
export function pitchClassChoices(pc: number, random = Math.random, count = 4): number[] {
  const pool = [1, -1, 2, -2, 5, 7].map(d => mod(pc + d));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const choices = [...new Set(pool)].filter(n => n !== mod(pc)).slice(0, count - 1);
  choices.splice(Math.floor(random() * count), 0, mod(pc));
  return choices;
}

export interface NoteEntry { letter: string | null; accidental: number }
export const emptyEntry = (): NoteEntry => ({ letter: null, accidental: 0 });
/** A–G pick the letter (and reset the accidental); ↑/↓ raise or lower by a semitone up to a double accidental.
 * Returns null for keys the entry does not use, so the caller can handle them. */
export function noteEntryKey(entry: NoteEntry, key: string): NoteEntry | null {
  const letter = key.length === 1 ? key.toUpperCase() : '';
  if (/^[A-G]$/.test(letter)) return { letter, accidental: 0 };
  if (key === 'ArrowUp' && entry.letter) return { ...entry, accidental: Math.min(2, entry.accidental + 1) };
  if (key === 'ArrowDown' && entry.letter) return { ...entry, accidental: Math.max(-2, entry.accidental - 1) };
  return null;
}
export const entryName = (entry: NoteEntry) => entry.letter ? entry.letter + (entry.accidental < 0 ? '♭'.repeat(-entry.accidental) : '♯'.repeat(entry.accidental)) : null;

/** For a note without key context either common spelling is right; other names of the same pitch (E♯, C♭, double accidentals)
 * are reported as a spelling slip. */
export function checkPitchClassName(name: string, pc: number): 'correct' | 'spelling' | 'wrong' {
  if (mod(pitchOf(name)) !== mod(pc)) return 'wrong';
  return name === sharp[mod(pc)] || name === flat[mod(pc)] ? 'correct' : 'spelling';
}
