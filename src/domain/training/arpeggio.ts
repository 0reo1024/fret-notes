import { chordName, chordTones } from '../music/harmony';
import type { forInstrument, Position } from '../instruments/core';
import { rootsFor, type DrillQuestion } from './tone-questions';

export type ArpeggioChords = 'triads' | 'sevenths' | 'both';
export type ArpeggioDirection = 'up' | 'down' | 'updown';
export interface ArpeggioConfig { chords: ArpeggioChords; inversions: 'root' | 'all'; direction: ArpeggioDirection; sharpSix: boolean }
export const arpeggioQualities = { triads: ['major', 'minor', 'dim', 'aug'], sevenths: ['maj7', 'min7', 'dom7', 'half-dim', 'dim7', 'minmaj7'] };
export const inversionNames = ['基本形', '第1転回形', '第2転回形', '第3転回形'];
const directionNames: Record<ArpeggioDirection, string> = { up: '上行', down: '下行', updown: '上行→下行' };
/** Largest fret distance inside one arpeggio shape (open strings count as fret 0). Closed 7th shapes on four strings
 * often need four frets, so a five-fret window is allowed. */
export const maximumSpan = 4;

/** Adjacent string groups from low to high, e.g. [3,2,1] on guitar or [4,3,2] on bass. */
export function stringSets(stringCount: number, size: number): number[][] {
  const sets: number[][] = [];
  for (let low = stringCount; low - size + 1 >= 1; low--) sets.push(Array.from({ length: size }, (_, i) => low - i));
  return sets.reverse();
}
/** Every way to play the pitch classes in order, one per string from low to high, each note above the last, inside the fret window.
 * Works from absolute pitches, so any tuning is supported. */
export function resolveArpeggio(core: ReturnType<typeof forInstrument>, pitchClasses: number[], strings: number[], window: [number, number]): Position[][] {
  const results: Position[][] = [];
  const walk = (index: number, path: Position[]) => {
    if (index === strings.length) { results.push(path); return; }
    for (let fret = window[0]; fret <= window[1]; fret++) {
      const position = { string: strings[index], fret };
      if (core.pitch(position) !== pitchClasses[index]) continue;
      if (path.length && core.midi(position) <= core.midi(path.at(-1)!)) continue;
      walk(index + 1, [...path, position]);
    }
  };
  walk(0, []);
  return results;
}
const span = (path: Position[]) => Math.max(...path.map(p => p.fret)) - Math.min(...path.map(p => p.fret));

/** One question per chord, inversion and string set, using one compact shape picked at random from those within reach. */
export function arpeggioQuestions(core: ReturnType<typeof forInstrument>, config: ArpeggioConfig, random = Math.random): DrillQuestion[] {
  const groups = config.chords === 'both' ? [...arpeggioQualities.triads, ...arpeggioQualities.sevenths] : arpeggioQualities[config.chords];
  return rootsFor('standard', config.sharpSix).flatMap(root => groups.flatMap(quality => {
    const tones = chordTones({ root, quality }), symbol = chordName({ root, quality });
    const inversions = config.inversions === 'root' ? [0] : tones.map((_, i) => i);
    return inversions.flatMap(inversion => {
      const order = [...tones.slice(inversion), ...tones.slice(0, inversion)];
      return stringSets(core.stringCount, order.length).flatMap(strings => {
        const shapes = resolveArpeggio(core, order.map(t => t.pitchClass), strings, [0, core.fretCount]).filter(path => span(path) <= maximumSpan);
        if (!shapes.length) return [];
        const up = shapes[Math.floor(random() * shapes.length)];
        const path = config.direction === 'up' ? up : config.direction === 'down' ? up.slice().reverse() : [...up, ...up.slice(0, -1).reverse()];
        const steps = config.direction === 'up' ? order : config.direction === 'down' ? order.slice().reverse() : [...order, ...order.slice(0, -1).reverse()];
        const frets = up.map(p => p.fret);
        return [{
          itemId: `arp:${quality}:${root}:inv${inversion}:s${strings.join('')}:${config.direction}`,
          title: symbol, ask: `${inversionNames[inversion]} · ${strings.join('-')}弦 · ${directionNames[config.direction]} · ${Math.min(...frets)}〜${Math.max(...frets)}F`,
          root, answers: steps, related: tones, ordered: true, positions: path, midis: path.map(p => core.midi(p)),
        }];
      });
    });
  }));
}
