/** Distance from the nut as a fraction of the scale length (12-tone temperament). */
export const fretPosition = (fret: number): number => 1 - 2 ** (-fret / 12);

// Open strings sit to the left of the nut; only the twelve fretted columns scale.
// Each successive space is 2^(-1/12) times the preceding one.
export const fretboardColumns = '44px 52px ' + Array.from({ length: 12 }, (_, index) => {
  const width = (fretPosition(index + 1) - fretPosition(index)) / fretPosition(1);
  return `minmax(0, ${width.toFixed(9)}fr)`;
}).join(' ');

export const inlayFrets = [3, 5, 7, 9, 12];

/** Board surface and inlay dots, laid under the string rows so cells stay transparent. */
export function fretboardSurface(stringCount: number): HTMLElement[] {
  const rows = `2 / span ${stringCount}`, surface = document.createElement('div');
  surface.className = 'board-surface'; surface.style.gridRow = rows;
  const inlays = inlayFrets.map(fret => {
    const inlay = document.createElement('div'); inlay.className = 'inlay';
    inlay.style.gridColumn = `${fret + 2} / span 1`; inlay.style.gridRow = rows;
    inlay.append(document.createElement('i'));
    if (fret === 12) inlay.append(document.createElement('i'));
    return inlay;
  });
  return [surface, ...inlays];
}
