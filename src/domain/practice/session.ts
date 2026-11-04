import { forInstrument, type Position, type PracticeSettings } from '../instruments/core';

export interface QuizState { deck: Position[]; index: number; round: number; revealed: boolean; chosen: Position | null }
export class PracticeSession {
  state: QuizState;
  /** `order` builds each round from the positions (for example weak positions first); by default they are shuffled. */
  constructor(private core: ReturnType<typeof forInstrument>, private settings: PracticeSettings, private random = Math.random,
    private order: (positions: Position[], last: Position | null) => Position[] = (positions, last) => core.shuffled(positions, last, random)) {
    this.state = { deck: order(core.candidates(settings), null), index: 0, round: 1, revealed: false, chosen: null };
  }
  current() { return this.state.deck[this.state.index] ?? null; }
  reveal() {
    if (!this.current() || this.settings.mode === 'study') return;
    this.state.revealed = true;
  }
  next() {
    if (!this.current()) return;
    if (this.state.index + 1 < this.state.deck.length) this.state.index++;
    else {
      this.state.deck = this.order(this.core.candidates(this.settings), this.current());
      this.state.index = 0; this.state.round++;
    }
    this.state.revealed = false; this.state.chosen = null;
  }
  answer(position: Position) {
    if (this.settings.mode !== 'reverse' || !this.current()) return;
    if (this.state.revealed) { this.next(); return; }
    if (!this.core.allowed(position, this.settings)) return;
    this.state.chosen = position; this.state.revealed = true;
  }
}
