import { inlayFrets } from '../../ui/fretboard-layout';

export interface RangeSettings { strings: number[]; frets: number[]; naturalOnly: boolean }

const fretSets = {
  all: Array.from({ length: 13 }, (_, i) => i), dots: inlayFrets, low: [0, 1, 2, 3, 4, 5], mid: [5, 6, 7, 8, 9], high: [9, 10, 11, 12],
};
const markup = `<fieldset><legend>弦</legend><div class="string-options" data-range="strings"></div><div class="presets" data-range="string-presets"></div></fieldset>
 <fieldset><legend>フレット</legend><div class="presets fret-presets"><button type="button" data-frets="all">全フレット</button><button type="button" data-frets="dots">ドット位置</button><button type="button" data-frets="low">0〜5</button><button type="button" data-frets="mid">5〜9</button><button type="button" data-frets="high">9〜12</button></div>
  <div class="fret-options">${fretSets.all.map(n => `<label class="choice ${inlayFrets.includes(n) ? 'dot-fret' : ''}"><input type="checkbox" data-fret="${n}" aria-label="${n}フレット"><span>${n}</span></label>`).join('')}</div></fieldset>
 <fieldset><legend>出題する音名</legend><label class="open-toggle"><span>ナチュラル音のみ <small>A・B・C・D・E・F・G</small></span><input data-range="natural" type="checkbox" role="switch"></label></fieldset>`;

/** String, fret and note-name filters shared by the study quiz and performance practice. */
export function mountRange(root: HTMLElement, onChange: (next: RangeSettings) => void) {
  root.innerHTML = markup;
  let current: RangeSettings = { strings: [], frets: [], naturalOnly: false }, stringCount = 0;
  const part = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-range="${name}"]`)!;
  const change = (next: Partial<RangeSettings>) => onChange({ ...current, ...next });
  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.dataset.strings) change({ strings: button.dataset.strings.split(',').map(Number).sort((a, b) => a - b) });
    if (button?.dataset.frets) change({ frets: fretSets[button.dataset.frets as keyof typeof fretSets].slice() });
  });
  root.addEventListener('change', event => {
    const input = event.target as HTMLInputElement, checked = (selector: string, key: 'string' | 'fret') =>
      [...root.querySelectorAll<HTMLInputElement>(`${selector}:checked`)].map(x => Number(x.dataset[key])).sort((a, b) => a - b);
    if (input.dataset.string) change({ strings: checked('[data-string]', 'string') });
    else if (input.dataset.fret) change({ frets: checked('[data-fret]', 'fret') });
    else if (input.dataset.range === 'natural') change({ naturalOnly: input.checked });
  });
  return {
    render(count: number, bass: boolean, settings: RangeSettings) {
      current = { strings: settings.strings.slice(), frets: settings.frets.slice(), naturalOnly: settings.naturalOnly };
      if (count !== stringCount) {
        stringCount = count;
        const strings = Array.from({ length: count }, (_, i) => count - i), pairs = bass ? [[count, count - 1], [2, 1]] : [[6, 5], [4, 3], [2, 1]];
        part('strings').innerHTML = strings.map(n => `<label class="choice"><input type="checkbox" data-string="${n}" aria-label="${n}弦"><span>${n}</span></label>`).join('');
        part('string-presets').innerHTML = `<button type="button" data-strings="${strings.join(',')}">全弦</button>` + pairs.map(pair => `<button type="button" data-strings="${pair.join(',')}">${pair.join('・')}弦</button>`).join('');
        root.style.setProperty('--string-count', String(count));
      }
      root.querySelectorAll<HTMLInputElement>('[data-string]').forEach(el => el.checked = current.strings.includes(Number(el.dataset.string)));
      root.querySelectorAll<HTMLInputElement>('[data-fret]').forEach(el => el.checked = current.frets.includes(Number(el.dataset.fret)));
      part<HTMLInputElement>('natural').checked = current.naturalOnly;
    },
  };
}
