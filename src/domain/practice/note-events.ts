import type { PlayObservation } from './performance';

export interface NoteEvent { midi: number; startMs: number; endMs: number | null; cents: number }
/** `useOnsets` (default on) lets attacks split a repeated pitch and date a note from its attack. */
export interface SegmenterOptions { minHoldMs: number; releaseMs: number; referenceHz: number; useOnsets?: boolean }
export interface SegmentChange { started: NoteEvent | null; ended: NoteEvent | null }
/** Provisional until a real-device baseline (P0) measures them. */
export const defaultSegmenterOptions = (referenceHz = 440): SegmenterOptions => ({ minHoldMs: 200, releaseMs: 120, referenceHz });

/** Turns stable pitch observations into notes on the capture clock.
 * A note starts once one pitch holds for minHoldMs and ends on a different confirmed pitch (legato),
 * releaseMs of silence/instability, or a gap over 250 ms. A repeated pitch is a new note when an onset
 * (attack) comes more than 60 ms into the sounding note, or, without onsets, when a release separates the two.
 * A note confirmed within 300 ms of an attack starts at the attack time. */
export class NoteSegmenter {
  private sessionId: string | null = null; private sequence = -1; private time: number | null = null;
  private candidate: { midi: number; startMs: number; cents: number } | null = null;
  private sounding: NoteEvent | null = null; private quietSince: number | null = null;
  private lastOnset: number | null = null; private reattackAt: number | null = null;
  constructor(readonly options: SegmenterOptions) {
    if (!(options.minHoldMs >= 0) || !(options.releaseMs >= 0) || !Number.isFinite(options.referenceHz) || options.referenceHz < 400 || options.referenceHz > 480) throw new Error('音の区切りの設定が不正です');
  }
  /** The confirmed note that is still sounding, if any. */
  current(): NoteEvent | null { return this.sounding ? { ...this.sounding } : null; }
  bind(sessionId: string) {
    if (this.sessionId === sessionId) return;
    this.reset(); this.sessionId = sessionId;
  }
  /** Drops all evidence; the next note needs a fresh hold. */
  reset() { this.sequence = -1; this.time = null; this.candidate = null; this.sounding = null; this.quietSince = null; this.lastOnset = null; this.reattackAt = null; }
  private end(at: number): NoteEvent | null {
    const ended = this.sounding ? { ...this.sounding, endMs: at } : null;
    this.sounding = null; this.reattackAt = null; return ended;
  }
  push(o: PlayObservation): SegmentChange {
    const none = { started: null, ended: null };
    if (!this.sessionId || o.sessionId !== this.sessionId || !Number.isSafeInteger(o.sequence) || o.sequence < 1 || o.sequence <= this.sequence
      || !Number.isFinite(o.audioTimeMs) || o.audioTimeMs < 0 || this.time !== null && o.audioTimeMs <= this.time) return none;
    this.sequence = o.sequence;
    const previous = this.time, t = o.audioTimeMs; this.time = t;
    let ended: NoteEvent | null = null;
    if (this.options.useOnsets !== false) for (const onset of o.onsets ?? []) {
      if (!Number.isFinite(onset.audioTimeMs)) continue;
      this.lastOnset = onset.audioTimeMs;
      if (this.sounding && onset.audioTimeMs > this.sounding.startMs + 60) this.reattackAt = onset.audioTimeMs;
    }
    if (previous !== null && t - previous > 250) { ended = this.end(previous); this.candidate = null; this.quietSince = null; }
    if (o.state === 'error' || o.state === 'stopped') { ended ??= this.end(t); this.candidate = null; this.quietSince = null; return { started: null, ended }; }
    const valid = o.state === 'stable' && o.frequency !== null && Number.isFinite(o.frequency) && o.frequency >= 25 && o.frequency <= 1500;
    if (!valid) {
      this.candidate = null; this.quietSince ??= t;
      if (this.sounding && t - this.quietSince >= this.options.releaseMs) ended ??= this.end(this.quietSince);
      return { started: null, ended };
    }
    this.quietSince = null;
    const exact = 69 + 12*Math.log2(o.frequency!/this.options.referenceHz), midi = Math.round(exact), cents = (exact - midi)*100;
    if (this.sounding?.midi === midi && this.reattackAt === null) { this.candidate = null; return { started: null, ended }; }
    if (this.sounding?.midi === midi) {
      // Re-picked the same pitch: the old note ends at the attack and the new one starts there.
      const at = this.reattackAt!; ended ??= this.end(at); this.candidate = { midi, startMs: at, cents };
    } else if (this.candidate?.midi !== midi) {
      const attack = this.lastOnset !== null && this.lastOnset <= t && t - this.lastOnset <= 300 && this.lastOnset > (this.sounding?.startMs ?? -Infinity) ? this.lastOnset : t;
      this.candidate = { midi, startMs: attack, cents };
    }
    if (t - this.candidate.startMs < this.options.minHoldMs) return { started: null, ended };
    const start = this.candidate.startMs; this.candidate = null;
    ended ??= this.end(start);
    this.sounding = { midi, startMs: start, endMs: null, cents };
    return { started: { ...this.sounding }, ended };
  }
}

/** Common-tone rule: a note that started before a chord change and is still sounding `minHoldMs` after it
 * counts for the new chord (F held from Dm7 into G7). A note that ended before the change never does. */
export function heldInto(current: NoteEvent | null, changeAtMs: number, nowMs: number, minHoldMs: number): boolean {
  return !!current && current.endMs === null && current.startMs < changeAtMs && nowMs - changeAtMs >= minHoldMs;
}
