import type { forInstrument, Position, PracticeSettings } from '../instruments/core';

export interface FindAllResult { pitchClass: number; found: Position[]; wrong: Position[]; missed: Position[]; correct: boolean }

/** "Select every B in range": one question per pitch class present in the range, each once per round. */
export class FindAllSession {
  deck: number[]; index = 0; round = 1;
  readonly selected = new Map<string, Position>();
  result: FindAllResult | null = null;
  constructor(private core: ReturnType<typeof forInstrument>, private settings: PracticeSettings, private random = Math.random) {
    this.deck = this.shuffled(null);
  }
  private shuffled(last: number | null) {
    const deck = [...new Set(this.core.candidates(this.settings).map(p => this.core.pitch(p)))];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    if (deck.length > 1 && deck[0] === last) [deck[0], deck[1]] = [deck[1], deck[0]];
    return deck;
  }
  current() { return this.deck[this.index] ?? null; }
  /** Every in-range position of the asked pitch class. */
  answers(): Position[] {
    const pc = this.current();
    return pc === null ? [] : this.core.candidates(this.settings).filter(p => this.core.pitch(p) === pc);
  }
  isSelected(p: Position) { return this.selected.has(this.core.key(p)); }
  /** Selecting again removes the mark; outside the range or after scoring nothing changes. */
  toggle(p: Position) {
    if (this.result || this.current() === null || !this.core.allowed(p, this.settings)) return;
    const key = this.core.key(p);
    if (this.selected.has(key)) this.selected.delete(key); else this.selected.set(key, { ...p });
  }
  complete(): FindAllResult | null {
    const pc = this.current();
    if (pc === null) return null;
    if (this.result) return this.result;
    const answers = this.answers(), chosen = [...this.selected.values()];
    const found = chosen.filter(p => this.core.pitch(p) === pc), wrong = chosen.filter(p => this.core.pitch(p) !== pc);
    const missed = answers.filter(p => !this.selected.has(this.core.key(p)));
    this.result = { pitchClass: pc, found, wrong, missed, correct: !wrong.length && !missed.length };
    return this.result;
  }
  next() {
    if (this.current() === null) return;
    if (this.index + 1 < this.deck.length) this.index++;
    else { this.deck = this.shuffled(this.current()); this.index = 0; this.round++; }
    this.selected.clear(); this.result = null;
  }
}
