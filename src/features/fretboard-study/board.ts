import { forInstrument, type Position } from '../../domain/instruments/core';
import * as Theory from '../../domain/music/theory';
import type { InstrumentSettings } from '../../platform/settings';
import { fretboardColumns, fretboardSurface, inlayFrets } from '../../ui/fretboard-layout';

/** Find-all marks: picks before scoring, then found / wrong / missed positions. */
export interface FindAllMarks { selected: Set<string>; result: { found: Position[]; wrong: Position[]; missed: Position[] } | null }
interface BoardState {
  core: ReturnType<typeof forInstrument>; settings: InstrumentSettings; target: Position | null;
  revealed: boolean; chosen: Position | null; cursor: Position | null; inspected: Position | null;
  findAll?: FindAllMarks | null;
}
function noteHTML(core: BoardState['core'], settings: InstrumentSettings, position: Position, tone: Theory.Tone | null) {
  if (tone) {
    if (settings.toneLabels === 'degree') return tone.degree;
    if (settings.toneLabels === 'name') return tone.name;
    return `${tone.name}<small>${tone.degree}</small>`;
  }
  const names = core.name(position, settings.notation).split(' / ');
  return names.length === 1 ? names[0] : `${names[0]}<small>${names[1]}</small>`;
}

/** Keeps physical cells mounted so audio/state updates don't rebuild the board. */
export class Fretboard {
  private count = 0;
  private cells = new Map<string, HTMLButtonElement>();
  private labels: HTMLElement[] = [];
  constructor(private board: HTMLElement, private shell: HTMLElement, onSelect: (position: Position) => void) {
    board.addEventListener('click', event => {
      const element = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-position]');
      if (!element || element.getAttribute('aria-disabled') === 'true') return;
      const [string, fret] = element.dataset.position!.split(':').map(Number);
      onSelect({ string, fret });
    });
  }
  private build(count: number) {
    this.board.replaceChildren(); this.cells.clear(); this.labels = []; this.count = count;
    this.board.style.setProperty('--fret-columns', fretboardColumns);
    this.board.append(...fretboardSurface(count), document.createElement('div'));
    for (let fret = 0; fret <= 12; fret++) {
      const label = document.createElement('div'); label.className = `fret-label ${inlayFrets.includes(fret) ? 'marked' : ''}`;
      label.textContent = fret === 0 ? '0 開放' : String(fret); this.board.append(label);
    }
    for (let string = 1; string <= count; string++) {
      const label = document.createElement('div'); label.className = 'string-label'; this.labels.push(label); this.board.append(label);
      for (let fret = 0; fret <= 12; fret++) {
        const cell = document.createElement('button'); cell.type = 'button'; cell.dataset.position = `${string}:${fret}`;
        this.cells.set(cell.dataset.position, cell); this.board.append(cell);
      }
    }
  }
  render(state: BoardState) {
    const { core: C, settings, target, revealed, chosen, cursor, inspected } = state;
    const scroll = this.shell.scrollLeft, focused = (document.activeElement as HTMLElement | null)?.dataset.position;
    if (this.count !== C.stringCount) this.build(C.stringCount);
    if (settings.mode === 'find-all') { this.renderFindAll(state); this.shell.scrollLeft = scroll; if (focused) this.cells.get(focused)?.focus({preventScroll: true}); return; }
    const study = settings.mode === 'study', reverse = settings.mode === 'reverse';
    const pattern = study ? Theory.selected(settings) : null, layers = pattern ? Theory.layers(settings) : [], multiple = layers.length > 1;
    const toneMap = new Map(Theory.tones(settings).map(tone => [tone.pitch, tone]));
    this.labels.forEach((label, index) => {
      const content = `${index + 1}弦${study || settings.showTuning ? `<strong>${C.openNames[index]}</strong>` : ''}`;
      if (label.innerHTML !== content) label.innerHTML = content;
    });
    for (const [key, cell] of this.cells) {
      const [string, fret] = key.split(':').map(Number), position = { string, fret }, active = C.allowed(position, settings);
      const correct = reverse && revealed && C.isCorrect(target, position, settings);
      const wrong = reverse && revealed && chosen && C.key(chosen) === key && !correct;
      const showTarget = !study && !reverse && !!target && C.key(target) === key;
      const matches = multiple ? layers.map(layer => ({ index: layer.index, tone: layer.tones.find(tone => tone.pitch === C.pitch(position)) }))
        .filter((entry): entry is typeof entry & {tone: Theory.Tone} => !!entry.tone) : [];
      const tone = pattern ? toneMap.get(C.pitch(position)) ?? matches[0]?.tone ?? null : null;
      const showName = (study && (!pattern || !!tone)) || (showTarget && revealed) || correct || wrong;
      const noteClass = multiple && matches.length ? 'study-combined' : tone ? (tone.degree === 'R' ? 'study-root' : 'study-tone') : showTarget ? `target${revealed ? '' : ' blank'}` : correct ? 'correct' : wrong ? 'wrong' : '';
      let label = `${string}弦 ${fret}フレット`;
      if (showName) label += matches.length ? ` ${matches.map(entry => `${entry.index + 1}: ${layers[entry.index].root} ${layers[entry.index].pattern.label} の ${entry.tone.name} ${entry.tone.degree}`).join('、')}` : tone ? ` ${tone.name} 度数 ${tone.degree}` : ` ${C.name(position, settings.notation)}`;
      if (showTarget && !revealed) label += ' 出題位置';
      if (correct) label += ' 正解'; if (wrong) label += ' 選択した位置'; if (reverse && revealed) label += ' 次の問題へ';
      const clickable = study || (reverse && !!target && (revealed || active)), selected = study && !!inspected && C.key(inspected) === key;
      const tabbable = study ? (cursor ? C.key(cursor) === key : string === 1 && fret === 0) : clickable && !!cursor && C.key(cursor) === key;
      cell.className = `cell ${selected ? 'inspected' : ''} ${fret === 0 ? 'open' : ''} ${!study && !active && settings.highlightRange ? 'outside' : ''}`;
      cell.setAttribute('aria-label', label);
      if (study) cell.setAttribute('aria-pressed', String(selected)); else cell.removeAttribute('aria-pressed');
      if (clickable) cell.removeAttribute('aria-disabled'); else cell.setAttribute('aria-disabled', 'true');
      cell.tabIndex = tabbable ? 0 : -1;
      const display = multiple && matches.length ? `<span class="combined-name">${matches[0].tone.name}</span><span class="layer-marks">${matches.map(entry => `<span class="layer-mark layer-${entry.index}" aria-hidden="true">${entry.index + 1}</span>`).join('')}</span>` : noteHTML(C, settings, position, tone);
      const content = showName || showTarget ? `<span class="note ${noteClass}">${showName ? display : '?'}</span>` : '';
      if (cell.innerHTML !== content) cell.innerHTML = content;
    }
    if (reverse && !revealed && target && !cursor) {
      const first = C.candidates(settings).find(position => position.string === target.string);
      if (first) this.cells.get(C.key(first))!.tabIndex = 0;
    }
    this.shell.scrollLeft = scroll;
    if (focused) {
      if (revealed && !study) document.querySelector<HTMLElement>('#primary')?.focus({preventScroll: true});
      else this.cells.get(focused)?.focus({preventScroll: true});
    }
  }
  private renderFindAll({ core: C, settings, cursor, findAll }: BoardState) {
    const result = findAll?.result ?? null, keys = (list: Position[]) => new Set(list.map(C.key));
    const found = keys(result?.found ?? []), wrong = keys(result?.wrong ?? []), missed = keys(result?.missed ?? []);
    const firstAllowed = C.candidates(settings)[0];
    this.labels.forEach((label, index) => {
      const content = `${index + 1}弦${settings.showTuning ? `<strong>${C.openNames[index]}</strong>` : ''}`;
      if (label.innerHTML !== content) label.innerHTML = content;
    });
    for (const [key, cell] of this.cells) {
      const [string, fret] = key.split(':').map(Number), position = { string, fret }, active = C.allowed(position, settings);
      const picked = !result && !!findAll?.selected.has(key);
      const noteClass = found.has(key) ? 'correct' : wrong.has(key) ? 'wrong' : missed.has(key) ? 'missed' : picked ? 'picked' : '';
      let label = `${string}弦 ${fret}フレット`;
      if (noteClass && noteClass !== 'picked') label += ` ${C.name(position, settings.notation)}`;
      label += { correct: ' 正解', wrong: ' 選択した位置（不正解）', missed: ' 見落とした位置', picked: ' 選択中', '': '' }[noteClass];
      cell.className = `cell ${fret === 0 ? 'open' : ''} ${!active && settings.highlightRange ? 'outside' : ''}`;
      cell.setAttribute('aria-label', label);
      cell.setAttribute('aria-pressed', String(picked));
      if (active && !result) cell.removeAttribute('aria-disabled'); else cell.setAttribute('aria-disabled', 'true');
      cell.tabIndex = !result && (cursor ? C.key(cursor) === key : !!firstAllowed && C.key(firstAllowed) === key) ? 0 : -1;
      const names = C.name(position, settings.notation).split(' / '), display = names.length === 1 ? names[0] : `${names[0]}<small>${names[1]}</small>`;
      const content = noteClass ? `<span class="note ${noteClass}">${noteClass === 'picked' ? '✓' : display}</span>` : '';
      if (cell.innerHTML !== content) cell.innerHTML = content;
    }
  }
}
