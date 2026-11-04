import { emptyEntry, entryName, noteEntryKey, type NoteEntry } from '../../domain/training/note-answers';

export interface Choice { value: string; label: string }
const accidentals: [number, string][] = [[-2, '♭♭'], [-1, '♭'], [0, '♮'], [1, '♯'], [2, '♯♯']];

/** Note-name answer area: four choices (keys 1–4) or letter + accidental entry (A–G, ↑/↓, Enter).
 * The owner forwards key presses through `key`, so shortcuts only work while its panel is shown. */
export class NoteAnswerInput {
  private mode: 'none' | 'choice' | 'entry' = 'none';
  private choices: Choice[] = [];
  private entry: NoteEntry = emptyEntry();
  constructor(private root: HTMLElement, private onSubmit: (value: string) => void) {
    root.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
      if (button.dataset.choice !== undefined) this.onSubmit(button.dataset.choice);
      else if (button.dataset.letter) this.setEntry({ letter: button.dataset.letter, accidental: this.entry.accidental });
      else if (button.dataset.accidental !== undefined && this.entry.letter) this.setEntry({ ...this.entry, accidental: Number(button.dataset.accidental) });
      else if (button.dataset.submit !== undefined) this.submitEntry();
    });
  }
  hide() { this.mode = 'none'; this.root.hidden = true; this.root.replaceChildren(); }
  showChoices(choices: Choice[]) {
    this.mode = 'choice'; this.choices = choices; this.root.hidden = false;
    this.root.replaceChildren(...choices.map((choice, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'answer-choice'; button.dataset.choice = choice.value;
      const key = document.createElement('kbd'); key.textContent = String(index + 1); button.append(key, ` ${choice.label}`);
      return button;
    }));
  }
  showEntry() {
    this.mode = 'entry'; this.root.hidden = false; this.entry = emptyEntry();
    const row = (label: string, buttons: HTMLElement[]) => { const group = document.createElement('div'); group.className = 'entry-row'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', label); group.append(...buttons); return group; };
    const button = (text: string, data: Record<string, string>, aria?: string) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text; Object.assign(element.dataset, data);
      if (aria) element.setAttribute('aria-label', aria); return element;
    };
    const display = document.createElement('output'); display.className = 'entry-display'; display.setAttribute('aria-live', 'polite');
    this.root.replaceChildren(
      row('音名', 'CDEFGAB'.split('').map(letter => button(letter, { letter }))),
      row('変化記号', accidentals.map(([value, text]) => button(text, { accidental: String(value) }, { '-2': 'ダブルフラット', '-1': 'フラット', '0': 'ナチュラル', '1': 'シャープ', '2': 'ダブルシャープ' }[String(value)]))),
      row('回答', [display, button('回答する', { submit: '' })]),
    );
    this.setEntry(this.entry);
  }
  private setEntry(entry: NoteEntry) {
    this.entry = entry;
    const display = this.root.querySelector('.entry-display'); if (display) display.textContent = entryName(entry) ?? '—';
    this.root.querySelectorAll<HTMLButtonElement>('[data-letter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.letter === entry.letter)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-accidental]').forEach(b => { b.disabled = !entry.letter; b.setAttribute('aria-pressed', String(!!entry.letter && Number(b.dataset.accidental) === entry.accidental)); });
    const submit = this.root.querySelector<HTMLButtonElement>('[data-submit]'); if (submit) submit.disabled = !entry.letter;
  }
  private submitEntry() { const name = entryName(this.entry); if (name) this.onSubmit(name); }
  /** Returns true when the key was used for answering. */
  key(key: string): boolean {
    if (this.mode === 'choice') {
      const index = Number(key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < this.choices.length) { this.onSubmit(this.choices[index].value); return true; }
      return false;
    }
    if (this.mode !== 'entry') return false;
    if (key === 'Enter') { this.submitEntry(); return true; }
    const next = noteEntryKey(this.entry, key);
    if (!next) return false;
    this.setEntry(next); return true;
  }
}
