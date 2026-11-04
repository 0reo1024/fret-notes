import type { Position } from '../domain/instruments/core';
import type { InstrumentProfile } from '../domain/instruments/profiles';
import { fretboardColumns, fretboardSurface, inlayFrets } from './fretboard-layout';

export type MarkTone = 'root' | 'target' | 'correct' | 'wrong' | 'hint';
export interface Mark { position: Position; label: string; tone: MarkTone; description: string }
const noteClass: Record<MarkTone, string> = { root: 'study-root', target: 'target', correct: 'correct', wrong: 'wrong', hint: 'study-tone hint' };

/** A display fretboard for trainers: marks are placed freely and cells may be clickable.
 * Uses the study board's look (.board/.cell/.note) without its quiz state. */
export class MarkedFretboard {
  private cells = new Map<string, HTMLButtonElement>();
  private key = '';
  constructor(private board: HTMLElement, onSelect: (position: Position) => void = () => {}) {
    board.addEventListener('click', event => {
      const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-position]');
      if (!cell || cell.getAttribute('aria-disabled') === 'true') return;
      const [string, fret] = cell.dataset.position!.split(':').map(Number);
      onSelect({ string, fret });
    });
  }
  private build(profile: InstrumentProfile) {
    const count = profile.strings.length;
    this.board.replaceChildren(); this.cells.clear();
    this.board.style.setProperty('--fret-columns', fretboardColumns);
    this.board.style.setProperty('--string-count', String(count));
    this.board.append(...fretboardSurface(count), document.createElement('div'));
    for (let fret = 0; fret <= profile.fretCount; fret++) {
      const label = document.createElement('div'); label.className = `fret-label ${inlayFrets.includes(fret) ? 'marked' : ''}`;
      label.textContent = fret === 0 ? '0 開放' : String(fret); this.board.append(label);
    }
    for (const string of profile.strings) {
      const label = document.createElement('div'); label.className = 'string-label'; label.textContent = `${string.number}弦`; this.board.append(label);
      for (let fret = 0; fret <= profile.fretCount; fret++) {
        const cell = document.createElement('button'); cell.type = 'button'; cell.dataset.position = `${string.number}:${fret}`;
        this.cells.set(cell.dataset.position, cell); this.board.append(cell);
      }
    }
  }
  render(profile: InstrumentProfile, marks: Mark[], clickable: (position: Position) => boolean) {
    const key = `${profile.id}:${profile.strings.map(s => s.openMidi).join(',')}`;
    if (key !== this.key) { this.key = key; this.build(profile); }
    const byKey = new Map(marks.map(mark => [`${mark.position.string}:${mark.position.fret}`, mark]));
    let tabbable = false;
    for (const [key, cell] of this.cells) {
      const [string, fret] = key.split(':').map(Number), mark = byKey.get(key), active = clickable({ string, fret });
      cell.className = `cell ${fret === 0 ? 'open' : ''}`;
      cell.setAttribute('aria-label', `${string}弦 ${fret}フレット${mark ? ` ${mark.description}` : ''}`);
      if (active) cell.removeAttribute('aria-disabled'); else cell.setAttribute('aria-disabled', 'true');
      cell.tabIndex = active && !tabbable ? 0 : -1; if (active) tabbable = true;
      const content = mark ? `<span class="note ${noteClass[mark.tone]}">${mark.label}</span>` : '';
      if (cell.innerHTML !== content) cell.innerHTML = content;
    }
  }
}
