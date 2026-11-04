import { create, type PracticeSettings } from '../instruments/core';
import { midiName, type InstrumentProfile } from '../instruments/profiles';
import { frequencyForMidi } from '../tuner/pitch';

/** What counts as the right pitch: one exact note, or any octave of some pitch classes within a register. */
export type PitchMatcher =
  | { kind: 'midi'; midi: number }
  | { kind: 'pitch-class'; pitchClasses: number[]; register: [number, number] };
export interface PlayTarget { string: number; fret: number; midi: number; note: string; accept?: PitchMatcher }
export interface PlayObservation { sessionId: string; sequence: number; audioTimeMs: number; state: string; frequency: number | null; onsets?: { audioTimeMs: number }[] }
export interface PlayOptions { toleranceCents: number; holdMs: number; referenceHz: number }
export interface PlayLimits { toleranceCents: number[]; holdMs: number[] }
export const defaultPlayLimits = (): PlayLimits => ({ toleranceCents: [5,10,20], holdMs: [200,350,500] });
export function acceptedMidis(matcher: PitchMatcher): number[] {
  if (matcher.kind === 'midi') return [matcher.midi];
  const [low, high] = matcher.register, result: number[] = [];
  for (let midi = Math.max(0,low); midi <= Math.min(127,high); midi++) if (matcher.pitchClasses.includes(midi % 12)) result.push(midi);
  return result;
}
export const matchesMidi = (matcher: PitchMatcher, midi: number) => acceptedMidis(matcher).includes(midi);
export function validMatcher(matcher: PitchMatcher) {
  if (matcher.kind === 'midi') return Number.isInteger(matcher.midi) && matcher.midi >= 0 && matcher.midi <= 127;
  const [low, high] = matcher.register;
  return matcher.pitchClasses.length > 0 && matcher.pitchClasses.every(pc => Number.isInteger(pc) && pc >= 0 && pc < 12)
    && Number.isInteger(low) && Number.isInteger(high) && low <= high && acceptedMidis(matcher).length > 0;
}
/** Cents from the accepted note closest to the observed frequency, so E3 heard for an E2-or-E3 target reads as E3. */
export function nearestAccepted(matcher: PitchMatcher, frequency: number, referenceHz: number) {
  let best: { midi: number; cents: number } | null = null;
  for (const midi of acceptedMidis(matcher)) {
    const cents = 1200*Math.log2(frequency/frequencyForMidi(midi,referenceHz));
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { midi, cents };
  }
  return best;
}
export type PlayPhase = 'ready' | 'listening' | 'candidate' | 'accepted' | 'paused' | 'finished';
export interface PlayResult { target: PlayTarget; listeningMs: number; wrongAttempts: number; cents: number }
export function playTargets(profile: InstrumentProfile, settings: PracticeSettings, referenceHz: number): PlayTarget[] {
  const core = create(profile);
  return core.candidates(core.normalize(settings)).map(p => ({ ...p, midi: core.midi(p), note: midiName(core.midi(p)) }))
    .filter(p => { const hz = frequencyForMidi(p.midi, referenceHz); return hz >= 25 && hz <= 1500; });
}
/** Uses capture time for pitch evidence; the view advances after success feedback.
 * Like the study quiz, each round asks every target once in random order, then reshuffles. */
export class PerformanceSession {
  phase: PlayPhase = 'ready'; readonly results: PlayResult[] = []; deck: PlayTarget[];
  index = 0; round = 1; cents: number | null = null; wrongAttempts = 0; listeningMs = 0;
  private sessionId: string | null = null; private sequence = -1; private time: number | null = null;
  private candidateAt: number | null = null;
  private wrongAt: number | null = null; private wrongMidi: number | null = null; private wrongCounted = false;
  constructor(private readonly targets: PlayTarget[], readonly options: PlayOptions, private readonly random = Math.random, limits = defaultPlayLimits()) {
    if (!targets.length || !limits.toleranceCents.includes(options.toleranceCents)
      || !limits.holdMs.includes(options.holdMs) || !Number.isFinite(options.referenceHz) || options.referenceHz < 400 || options.referenceHz > 480
      || targets.some(t => !Number.isInteger(t.midi) || !Number.isFinite(frequencyForMidi(t.midi,options.referenceHz)) || frequencyForMidi(t.midi,options.referenceHz) < 25 || frequencyForMidi(t.midi,options.referenceHz) > 1500)
      || targets.some(t => t.accept !== undefined && !validMatcher(t.accept))) throw new Error('演奏練習の範囲・設定を確認してください');
    this.deck = this.shuffled(null);
  }
  /** Answers that sound the same: the exact note, or the pitch class when any octave is accepted. */
  private answerKey(t: PlayTarget) { return t.accept?.kind === 'pitch-class' ? t.midi % 12 : t.midi; }
  private shuffled(last: number | null) {
    const round = this.targets.map(t => ({...t})), deck: PlayTarget[] = [];
    for (let i=round.length-1;i>0;i--) { const j=Math.min(i,Math.max(0,Math.floor(this.random()*(i+1)))); [round[i],round[j]]=[round[j],round[i]]; }
    // Prefer a new pitch even when several positions share the same note, including across rounds.
    // An answer that fills more than half of what is left must go next, or it would end up repeated.
    while (round.length) {
      const previous = deck.length ? this.answerKey(deck.at(-1)!) : last, counts = new Map<number,number>();
      for (const t of round) counts.set(this.answerKey(t),(counts.get(this.answerKey(t))??0)+1);
      const crowded = [...counts].find(([key,count])=>key!==previous && count*2>round.length)?.[0];
      const different = round.findIndex(t=>crowded===undefined ? this.answerKey(t)!==previous : this.answerKey(t)===crowded);
      deck.push(round.splice(different < 0 ? 0 : different,1)[0]);
    }
    return deck;
  }
  get target() { return this.deck[this.index] ?? null; }
  get progress() { return this.phase === 'candidate' && this.candidateAt !== null && this.time !== null ? Math.min(1,(this.time-this.candidateAt)/this.options.holdMs) : 0; }
  /** The question asked but not yet answered (it survives a pause), for recording one left unanswered. */
  pending() { return this.target && ['listening','candidate','paused'].includes(this.phase) ? { target: {...this.target}, listeningMs: this.listeningMs, wrongAttempts: this.wrongAttempts } : null; }
  get totalWrongAttempts() { return this.results.reduce((sum,r)=>sum+r.wrongAttempts,0) + (this.phase==='accepted' ? 0 : this.wrongAttempts); }
  bind(sessionId: string) {
    if (this.phase === 'finished' || this.sessionId === sessionId) return;
    if (this.phase === 'accepted') this.advance();
    if (!this.target) return;
    this.sessionId=sessionId; this.sequence=-1; this.time=null; this.clearEvidence();
    this.phase='listening';
  }
  pause() {
    if (this.phase === 'accepted') this.advance();
    if (this.phase !== 'finished' && this.phase !== 'ready') { this.phase='paused'; this.sessionId=null; this.time=null; this.clearEvidence(); }
  }
  finish() { this.phase='finished'; this.sessionId=null; this.cents=null; this.clearEvidence(); }
  private clearEvidence() { this.candidateAt=null; this.wrongAt=null; this.wrongMidi=null; this.wrongCounted=false; this.cents=null; }
  continueAfterAnswer() { if (this.phase === 'accepted') this.advance(); }
  private advance() {
    this.index++; this.wrongAttempts=0; this.listeningMs=0; this.clearEvidence();
    if (this.index>=this.deck.length) { this.deck=this.shuffled(this.answerKey(this.deck.at(-1)!)); this.index=0; this.round++; }
    this.phase='listening';
  }
  consume(o: PlayObservation) {
    if (!this.sessionId || o.sessionId!==this.sessionId || !Number.isSafeInteger(o.sequence) || o.sequence<1 || o.sequence<=this.sequence || !Number.isFinite(o.audioTimeMs) || o.audioTimeMs<0 || this.time!==null && o.audioTimeMs<=this.time || ['ready','paused','finished'].includes(this.phase)) return;
    this.sequence=o.sequence;
    const gap=this.time===null ? 0 : o.audioTimeMs-this.time; this.time=o.audioTimeMs;
    if (gap>250) { this.clearEvidence(); if(this.phase==='candidate')this.phase='listening'; }
    if (['listening','candidate'].includes(this.phase) && gap<=250) this.listeningMs+=gap;
    if (o.state==='error' || o.state==='stopped') { this.pause(); return; }
    if (this.phase==='accepted') return;
    const valid=o.state==='stable' && o.frequency!==null && Number.isFinite(o.frequency) && o.frequency>=25 && o.frequency<=1500;
    this.cents=valid ? nearestAccepted(this.target!.accept ?? {kind:'midi',midi:this.target!.midi},o.frequency!,this.options.referenceHz)!.cents : null;
    if (this.cents!==null && Math.abs(this.cents)<=this.options.toleranceCents) {
      this.wrongAt=null; this.wrongMidi=null; this.wrongCounted=false;
      this.candidateAt ??= o.audioTimeMs; this.phase='candidate';
      if(o.audioTimeMs-this.candidateAt>=this.options.holdMs) {
        this.results.push({target:{...this.target!},listeningMs:this.listeningMs,wrongAttempts:this.wrongAttempts,cents:this.cents});
        this.phase='accepted';
      }
    } else {
      this.candidateAt=null; this.phase='listening';
      if(valid) {
        const midi=Math.round(69+12*Math.log2(o.frequency!/this.options.referenceHz));
        if(midi!==this.wrongMidi) { this.wrongMidi=midi; this.wrongAt=o.audioTimeMs; this.wrongCounted=false; }
        if(!this.wrongCounted && this.wrongAt!==null && o.audioTimeMs-this.wrongAt>=this.options.holdMs) { this.wrongAttempts++; this.wrongCounted=true; }
      } else { this.wrongAt=null; this.wrongMidi=null; this.wrongCounted=false; }
    }
  }
}
