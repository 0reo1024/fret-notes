import { chordName, diatonicSevenths, transpose, type DiatonicChord, type KeyMode } from '../music/harmony';
import { pitchOf } from '../music/theory';
import { rootsFor, type DrillQuestion } from './tone-questions';

export type KeyQuestionType = 'degree' | 'function' | 'secondary';
export type KeyModes = 'major' | 'minor' | 'both';
export interface KeyConfig { types: KeyQuestionType | 'all'; modes: KeyModes; sharpSix: boolean }
export const minorTonics = ['A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D', 'G', 'C', 'F', 'B♭', 'E♭'];
const modeNames: Record<KeyMode, string> = { major: 'メジャー', 'natural-minor': 'ナチュラルマイナー', 'harmonic-minor': 'ハーモニックマイナー' };
export const functionNames: Record<string, string> = { T: 'T（トニック）', SD: 'SD（サブドミナント）', D: 'D（ドミナント）' };
const label = (chord: DiatonicChord) => chordName(chord.chord!);
const tone = (degree: string, name: string, root: string) => ({ degree, name, pitchClass: pitchOf(root) });

function keys(modes: KeyModes, sharpSix: boolean): [string, KeyMode][] {
  const major = rootsFor('standard', sharpSix).map(t => [t, 'major'] as [string, KeyMode]);
  const minor = minorTonics.flatMap(t => [[t, 'natural-minor'], [t, 'harmonic-minor']] as [string, KeyMode][]);
  return modes === 'major' ? major : modes === 'minor' ? minor : [...major, ...minor];
}

/** Knowledge questions about keys. Natural and harmonic minor are separate tables, so the minor ii–V–i dominant (V7)
 * is never confused with natural minor's v7. Choices come from the same key and from the same root in other qualities. */
export function keyQuestions(config: KeyConfig): DrillQuestion[] {
  const wanted = (type: KeyQuestionType) => config.types === 'all' || config.types === type;
  return keys(config.modes, config.sharpSix).flatMap(([tonic, mode]) => {
    const table = diatonicSevenths(tonic, mode).filter(c => c.chord), key = `${tonic} ${modeNames[mode]}`;
    const names = table.map(label);
    const sameRoot = (root: string) => ['maj7', 'min7', 'dom7', 'half-dim'].map(quality => chordName({ root, quality }));
    const questions: DrillQuestion[] = [];
    if (wanted('degree')) for (const chord of table) questions.push({
      itemId: `key:${tonic}:${mode}:${chord.roman}`, title: key, ask: `${chord.roman} は?`, root: chord.root, labels: true,
      answers: [tone(chord.roman, label(chord), chord.root)], related: [], choicePool: [...names, ...sameRoot(chord.root)],
    });
    if (wanted('function')) for (const chord of table.filter(c => c.func)) questions.push({
      itemId: `keyf:${tonic}:${mode}:${chord.roman}`, title: label(chord), ask: `${key}での機能は?`, root: chord.root, labels: true,
      answers: [tone(chord.roman, functionNames[chord.func!], chord.root)], related: [], choicePool: Object.values(functionNames),
    });
    if (wanted('secondary') && mode === 'major') {
      const targets = diatonicSevenths(tonic, 'major').slice(1, 6);
      const dominants = targets.map(t => chordName({ root: transpose(t.root, '5'), quality: 'dom7' }));
      targets.forEach((target, i) => {
        const root = transpose(target.root, '5'), base = target.roman.replace(/(maj7|7|ø7)$/, '');
        questions.push({
          itemId: `key:${tonic}:major:V7/${base}`, title: key, ask: `V7/${base} は?`, root, labels: true,
          answers: [tone(`V7/${base}`, dominants[i], root)], related: [], choicePool: [...dominants, ...sameRoot(root), ...names],
        });
      });
    }
    return questions;
  });
}
