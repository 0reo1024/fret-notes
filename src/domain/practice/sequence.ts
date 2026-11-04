import { matchesMidi, type PitchMatcher } from './performance';
import type { NoteEvent } from './note-events';

/** A step may depend on the previous note, e.g. a voice-leading limit on the next interval. */
export type SequenceStep = PitchMatcher | ((previous: NoteEvent | null) => PitchMatcher);
export interface SequenceSpec { kind: 'ordered' | 'unordered'; steps: SequenceStep[] }
export type OnSequenceError = 'restart' | 'wait';
export type SequenceResult = 'progress' | 'error' | 'complete' | 'ignored';
export interface SequenceError { step: number; midi: number }

/** Checks confirmed notes against an ordered list (arpeggio, melody) or a set in any order (3rd and 7th). */
export class SequenceTracker {
  matched: NoteEvent[] = []; errors = 0; lastError: SequenceError | null = null;
  private used = new Set<number>();
  constructor(readonly spec: SequenceSpec, readonly onError: OnSequenceError = 'restart') {
    if (!spec.steps.length) throw new Error('判定する音がありません');
  }
  get complete() { return this.matched.length === this.spec.steps.length; }
  get progress() { return this.matched.length; }
  reset() { this.matched = []; this.used.clear(); this.lastError = null; }
  private matcher(index: number) { const step = this.spec.steps[index]; return typeof step === 'function' ? step(this.matched.at(-1) ?? null) : step; }
  private accept(event: NoteEvent, index: number): SequenceResult {
    this.matched.push({ ...event }); this.used.add(index); this.lastError = null;
    return this.complete ? 'complete' : 'progress';
  }
  push(event: NoteEvent): SequenceResult {
    if (this.complete) return 'ignored';
    if (this.spec.kind === 'ordered') {
      const index = this.matched.length;
      if (matchesMidi(this.matcher(index), event.midi)) return this.accept(event, index);
      this.errors++; this.lastError = { step: index, midi: event.midi };
      if (this.onError === 'restart') {
        const error = this.lastError; this.reset(); this.lastError = error;
        // The wrong note may itself be a fresh start of the sequence.
        if (index > 0 && matchesMidi(this.matcher(0), event.midi)) { this.accept(event, 0); this.lastError = error; }
      }
      return 'error';
    }
    const open = this.spec.steps.map((_, i) => i).filter(i => !this.used.has(i));
    const index = open.find(i => matchesMidi(this.matcher(i), event.midi));
    if (index !== undefined) return this.accept(event, index);
    // Replaying a note already counted is not a mistake.
    if ([...this.used].some(i => matchesMidi(this.matcher(i), event.midi))) return 'ignored';
    this.errors++; this.lastError = { step: this.matched.length, midi: event.midi };
    if (this.onError === 'restart') { const error = this.lastError; this.reset(); this.lastError = error; }
    return 'error';
  }
}
