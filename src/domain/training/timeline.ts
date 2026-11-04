import { chordTones } from '../music/harmony';
import { describeOver } from './tone-questions';
import { flatten, stageTargets, type ChangeStage, type Progression, type ProgressionChord, type StageTarget } from './progression';

/** Times are milliseconds from the first count-in beat, on the performance clock. */
export interface TimedNote { midi: number; startMs: number; endMs: number | null }
export interface Slot { pass: number; index: number; startMs: number; endMs: number }
export type ClickMode = 'all' | 'backbeat' | 'one' | 'none';
export type WindowResult = 'hit' | 'missed' | 'wrong';
export interface SlotOutcome { slot: Slot; result: WindowResult | null; firstHitMs: number | null; landing: string | null }
export interface AutoOptions {
  bpm: number; scale: number; countInBars: number; passes: number | null; fromIndex?: number; ninthsFromKey?: boolean;
  graceMs?: number; minHoldMs?: number;
}
export const beatMs = (bpm: number) => 60000 / bpm;
/** Auto-advance needs at least two beats and one second per chord so that 0.2–0.4 s detection still fits inside the window. */
export function shortestChord(progression: Progression, bpm: number, scale: number) {
  const beats = Math.min(...flatten(progression).map(c => c.beats * scale));
  return { beats, ms: beats * beatMs(bpm) };
}
export const playableAuto = (progression: Progression, bpm: number, scale: number) => { const s = shortestChord(progression, bpm, scale); return s.beats >= 2 && s.ms >= 1000; };

/** Common-tone rule on timed notes: started before the chord and still sounding minHold after its start. */
const heldAt = (note: TimedNote, startMs: number, minHoldMs: number) => note.startMs < startMs && (note.endMs === null || note.endMs >= startMs + minHoldMs);
/** A chord's window runs from its start to its end plus a grace for detection delay. A matching note in it (or held into it)
 * is a hit; otherwise any other confirmed note is wrong; otherwise nothing reached it. */
export function judgeWindow(notes: TimedNote[], slot: Slot, target: StageTarget, graceMs: number, minHoldMs: number): { result: WindowResult; firstHitMs: number | null } {
  const inWindow = notes.filter(n => n.startMs >= slot.startMs && n.startMs < slot.endMs + graceMs);
  const held = notes.filter(n => heldAt(n, slot.startMs, minHoldMs));
  const pcs = target.tones.map(t => t.pitchClass), found = new Set<number>();
  let firstHitMs: number | null = null;
  for (const note of [...held.map(n => ({ ...n, at: slot.startMs + minHoldMs })), ...inWindow.map(n => ({ ...n, at: n.startMs }))].sort((a, b) => a.at - b.at)) {
    const pc = note.midi % 12;
    if (!pcs.includes(pc)) continue;
    found.add(pc); firstHitMs ??= note.at;
    if (target.need === 'any' || pcs.every(p => found.has(p))) return { result: 'hit', firstHitMs: note.at - slot.startMs };
  }
  // Only part of a 3rd-and-7th pair is not yet a hit; it is wrong only if a note outside the target was played.
  return { result: inWindow.some(n => !pcs.includes(n.midi % 12)) ? 'wrong' : 'missed', firstHitMs: null };
}
/** Degree of the first note after a chord change (or the note held into it), named over the chord: G7 with A♭ is ♭9, with C is 11. */
export function landingDegree(notes: TimedNote[], slot: Slot, chord: ProgressionChord, graceMs: number, minHoldMs: number): string | null {
  const held = notes.find(n => heldAt(n, slot.startMs, minHoldMs));
  const first = held ?? notes.filter(n => n.startMs >= slot.startMs && n.startMs < slot.endMs + graceMs).sort((a, b) => a.startMs - b.startMs)[0];
  return first ? describeOver(chord.root, chordTones(chord), first.midi % 12) : null;
}

/** An auto-advancing run: slots laid out by tempo, clicks by mode, and each chord judged once its window has passed. */
export class AutoProgress {
  readonly chords: (ProgressionChord & { bar: number; slot: number })[];
  readonly beatMs: number; readonly countInMs: number; readonly beatsPerBar: number;
  readonly graceMs: number; readonly minHoldMs: number;
  private slots: Slot[] = []; private evaluated = 0;
  readonly notes: TimedNote[] = [];
  readonly outcomes: SlotOutcome[] = [];
  constructor(readonly progression: Progression, readonly stage: ChangeStage | 'free', readonly options: AutoOptions) {
    this.chords = flatten(progression);
    if (!this.chords.length) throw new Error('進行が空です');
    this.beatMs = beatMs(options.bpm); this.beatsPerBar = progression.beatsPerBar;
    this.countInMs = options.countInBars * this.beatsPerBar * this.beatMs;
    this.graceMs = options.graceMs ?? 300; this.minHoldMs = options.minHoldMs ?? 200;
  }
  target(index: number) { return this.stage === 'free' ? null : stageTargets(this.chords[index], this.stage, this.options.ninthsFromKey ? this.progression.key ?? null : null); }
  /** Slots are generated as far as needed; endless runs simply keep extending. */
  private extend(untilMs: number) {
    while (true) {
      const last = this.slots.at(-1);
      if (last && last.startMs > untilMs) return;
      const next = last ? (last.index + 1 < this.chords.length ? { pass: last.pass, index: last.index + 1 } : { pass: last.pass + 1, index: 0 }) : { pass: 1, index: this.options.fromIndex ?? 0 };
      if (this.options.passes !== null && next.pass > this.options.passes) return;
      const startMs = last ? last.endMs : this.countInMs, length = this.chords[next.index].beats * this.options.scale * this.beatMs;
      this.slots.push({ ...next, startMs, endMs: startMs + length });
    }
  }
  get endMs() { if (this.options.passes === null) return Infinity; this.extend(Infinity); return this.slots.at(-1)!.endMs; }
  slotAt(timeMs: number): Slot | null { this.extend(timeMs); return this.slots.find(s => s.startMs <= timeMs && timeMs < s.endMs) ?? null; }
  nextSlot(slot: Slot) { this.extend(slot.endMs + 1); return this.slots.find(s => s.startMs === slot.endMs) ?? null; }
  /** Beat position for the display: count-in beats are negative bars. */
  beatAt(timeMs: number) {
    const beat = Math.floor(timeMs / this.beatMs);
    return { countIn: timeMs < this.countInMs, beat: beat % this.beatsPerBar + 1 };
  }
  /** Click times in [fromMs, toMs): every count-in beat, then by mode. Consecutive windows never repeat or skip a click. */
  clickTimes(mode: ClickMode, fromMs: number, toMs: number): { timeMs: number; accent: boolean }[] {
    const clicks: { timeMs: number; accent: boolean }[] = [], end = Math.min(toMs, this.endMs);
    for (let n = Math.max(0, Math.ceil(fromMs / this.beatMs - 1e-9)); n * this.beatMs < end; n++) {
      const timeMs = n * this.beatMs, beat = n % this.beatsPerBar + 1;
      if (timeMs < fromMs) continue;
      const counting = timeMs < this.countInMs;
      const on = counting || mode === 'all' || mode === 'one' && beat === 1 || mode === 'backbeat' && beat % 2 === 0;
      if (on) clicks.push({ timeMs, accent: beat === 1 });
    }
    return clicks;
  }
  startNote(midi: number, startMs: number) { this.endNote(startMs); this.notes.push({ midi, startMs, endMs: null }); }
  endNote(endMs: number) { const last = this.notes.at(-1); if (last && last.endMs === null) last.endMs = endMs; }
  /** Judges every chord whose window (plus grace) has passed by `nowMs`; returns the new outcomes. */
  update(nowMs: number): SlotOutcome[] {
    this.extend(nowMs);
    const fresh: SlotOutcome[] = [];
    while (this.evaluated < this.slots.length && this.slots[this.evaluated].endMs + this.graceMs <= nowMs) {
      const slot = this.slots[this.evaluated++], chord = this.chords[slot.index], target = this.target(slot.index);
      const judged = target ? judgeWindow(this.notes, slot, target, this.graceMs, this.minHoldMs) : null;
      const outcome = { slot, result: judged?.result ?? null, firstHitMs: judged?.firstHitMs ?? null, landing: landingDegree(this.notes, slot, chord, this.graceMs, this.minHoldMs) };
      this.outcomes.push(outcome); fresh.push(outcome);
    }
    return fresh;
  }
  finished(nowMs: number) { return nowMs >= this.endMs + this.graceMs; }
  /** Latest outcome per chord position, for the chart. */
  outcomeOf(index: number) { return this.outcomes.filter(o => o.slot.index === index).at(-1) ?? null; }
}

/** Maps the input device clock to the performance clock: the smallest (receive time − capture time) seen recently,
 * which is the delivery delay without its jitter. Precision is roughly ±100 ms. */
export class InputClock {
  private offsets: number[] = [];
  observe(receivedPerfMs: number, audioTimeMs: number) { this.offsets.push(receivedPerfMs - audioTimeMs); if (this.offsets.length > 32) this.offsets.shift(); }
  reset() { this.offsets = []; }
  toPerformance(audioTimeMs: number) { return this.offsets.length ? audioTimeMs + Math.min(...this.offsets) : null; }
}
