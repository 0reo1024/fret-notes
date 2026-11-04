import * as T from '../music/theory';
import { shapeTuning, type InstrumentProfile } from './profiles';
export function forProfile(root: string, pattern: string, profile: InstrumentProfile) {
  const kind = shapeTuning(profile), supported = kind !== null;
  return { supported, shapes: kind ? get(root, pattern, profile.instrument, profile.strings.length, kind) : [],
    message: supported ? '' : 'このチューニングのコードシェイプは未対応です。構成音の位置は指板で確認できます。' };
}
export interface ChordShape { frets: (number | null)[]; notes: (T.Tone | null | undefined)[]; start: number; rootString: number; omitted: string[]; label: string }
 // Six strings, low E to high E. null means mute; offsets transpose with the root.
 const form=(base: string,frets: (number | null)[],omitted: string[]=[])=>({base,frets,omitted});
 const forms: Record<string, ReturnType<typeof form>[]>={
  major:[form('E',[0,2,2,1,0,0]),form('A',[null,0,2,2,2,0])],
  minor:[form('E',[0,2,2,0,0,0]),form('A',[null,0,2,2,1,0])],
  maj7:[form('E',[0,2,1,1,0,0]),form('A',[null,0,2,1,2,0])],
  min7:[form('E',[0,2,0,0,0,0]),form('A',[null,0,2,0,1,0])],
  dom7:[form('E',[0,2,0,1,0,0]),form('A',[null,0,2,0,2,0])],
  'half-dim':[form('A',[null,0,1,0,1,null]),form('E',[0,null,0,0,-1,null])],
  dim:[form('A',[null,0,1,2,1,null])],
  dim7:[form('A',[null,0,1,-1,1,null]),form('E',[0,null,-1,0,-1,null])],
  aug:[form('A',[null,0,3,2,2,null]),form('E',[0,3,2,1,1,0])],
  sus2:[form('A',[null,0,2,2,0,0])],
  sus4:[form('A',[null,0,2,2,3,0]),form('E',[0,2,2,2,0,0])],
  '7sus4':[form('A',[null,0,2,0,3,0]),form('E',[0,2,0,2,0,0])],
  six:[form('A',[null,0,2,2,2,2])],
  min6:[form('A',[null,0,2,2,1,2])],
  minmaj7:[form('A',[null,0,2,1,1,0]),form('E',[0,2,1,0,0,0])],
  add9:[form('C',[null,3,2,0,3,0])],
  nine:[form('A',[null,0,-1,0,0,0])],
  maj9:[form('A',[null,0,-1,1,0,0])],
  min9:[form('A',[null,0,-2,0,0,0])]
 };
 // Four-string D shapes and three-string G shapes, with explicit omissions.
 const dForms: Record<string, (number | null)[]>={
  major:[0,2,3,2],minor:[0,2,3,1],maj7:[0,2,2,2],min7:[0,2,1,1],dom7:[0,2,1,2],
  'half-dim':[0,1,1,1],dim:[0,1,3,1],dim7:[0,1,0,1],aug:[0,3,3,2],
  sus2:[0,2,3,0],sus4:[0,2,3,3],'7sus4':[0,2,1,3],six:[0,2,0,2],min6:[0,2,0,1],
  minmaj7:[0,2,2,1],add9:[0,-1,-2,0],nine:[0,-1,1,0],maj9:[0,-1,2,0],min9:[0,-2,1,0]
 };
 const gForms: Record<string, (number | null)[]>={major:[0,0,-2],minor:[0,-1,-2],dim:[0,-1,-3],aug:[0,0,-1],sus2:[0,-2,-2],sus4:[0,1,-2],
  maj7:[0,0,2],min7:[0,-1,1],dom7:[0,0,1],'7sus4':[0,1,1],six:[0,0,0],min6:[0,-1,0],minmaj7:[0,-1,2]};
 const extensions=['nine','maj9','min9'],shells=['maj7','min7','dom7','7sus4','six','min6','minmaj7'];
 for(const [id,frets] of Object.entries(dForms))forms[id].push(form('D',[null,null,...frets],extensions.includes(id)?['5']:[]));
 for(const [id,frets] of Object.entries(gForms))forms[id].push(form('G',[null,null,null,...frets],shells.includes(id)?['5']:[]));
 // Standard bass tuning is in fourths throughout; its voicings use that tuning.
 const bassFour: Record<string, (number | null)[]>={major:[0,2,2,1],minor:[0,2,2,0],maj7:[0,2,1,1],min7:[0,2,0,0],dom7:[0,2,0,1],
  'half-dim':[0,1,0,0],dim:[0,1,2,0],dim7:[0,1,-1,0],aug:[0,3,2,1],sus2:[0,-3,-3,null],
  sus4:[0,2,2,2],'7sus4':[0,2,0,2],six:[0,2,-1,1],min6:[0,2,-1,0],minmaj7:[0,2,1,0],
  add9:[0,-1,-3,-1],nine:[0,-1,0,-1],maj9:[0,-1,1,-1],min9:[0,-2,0,-1]};
 const bassThree: Record<string, (number | null)[]>={major:[0,-1,-3],minor:[0,-2,-3],dim:[0,-2,-4],aug:[0,-1,-2],sus2:[0,-3,-3],sus4:[0,0,-3],
  maj7:[0,-1,1],min7:[0,-2,0],dom7:[0,-1,0],'7sus4':[0,0,0],six:[0,-1,-1],min6:[0,-2,-1],minmaj7:[0,-2,1]};
 const mod=(n: number)=>(n%12+12)%12;
 export function get(rootName: string,id: string,instrument='guitar',stringCount=6,tuningKind: 'standard'|'fourths'='standard'): ChordShape[]{
  const pattern=T.chords.find(p=>p.id===id);if(!pattern)return [];
  const bass=instrument==='bass',count=bass?(stringCount===5?5:4):6,fourths=!bass&&tuningKind==='fourths';
  const tuning=bass?(count===5?[11,4,9,2,7]:[4,9,2,7]):fourths?[4,9,2,7,0,5]:[4,9,2,7,11,4];
  let templates=forms[id]||[];
  // All fourths raises strings 2 and 1 a semitone (B→C, E→F); one fret lower keeps each guitar form's pitches.
  if(fourths)templates=templates.map(t=>form(t.base,t.frets.map((f,i)=>f!==null&&i>=4?f-1:f),t.omitted));
  // Bass voicings exist only for the original qualities; newer ones (tensions) have no shape, as on guitar.
  if(bass&&!bassFour[id])templates=[];
  else if(bass){
   templates=[form('E',[...Array(count-4).fill(null),...bassFour[id]],extensions.includes(id)?['5']:[])];
   if(bassThree[id])templates.push(form('A',[...Array(count-3).fill(null),...bassThree[id]],shells.includes(id)?['5']:[]));
   if(count===5)templates.unshift(form('B',[...bassFour[id],extensions.includes(id)?-1:null]));
  }
  const tones=pattern.degrees.map(degree=>({degree,name:T.spell(rootName,degree),pitch:mod(T.pitchOf(rootName)+T.interval(degree))}));
  const results: ChordShape[]=[];
  for(const template of templates){
   let shift=mod(T.pitchOf(rootName)-T.pitchOf(template.base));
   while(template.frets.some(f=>f!==null&&f+shift<0))shift+=12;
   for(const offset of [shift,shift+12]){
    const frets=template.frets.map(f=>f===null?null:f+offset);
    if(Math.max(...frets.filter((f): f is number=>f!==null))>15)continue;
    const notes=frets.map((f,i)=>f===null?null:tones.find(t=>t.pitch===mod(tuning[i]+f)));
    const positive=frets.filter((f): f is number=>f!==null&&f>0),start=frets.includes(0)?1:Math.min(...positive);
    const rootString=count-frets.findIndex(f=>f!==null);
    const omitted=tones.filter(t=>!notes.some(n=>n?.pitch===t.pitch)).map(t=>t.degree);
    if(notes.some((note,i)=>frets[i]!==null&&!note)||omitted.some(d=>!template.omitted.includes(d)))continue;
    // Converted forms can widen by a fret; keep them within the five-fret diagram and drop duplicates.
    if(fourths&&(Math.max(...frets.map(f=>f??0))-start>4||results.some(r=>r.frets.join()===frets.join())))continue;
    results.push({frets,notes,start,rootString,omitted,label:`${rootString}弦ルート・${frets.includes(0)?'開放弦あり':Math.min(...positive)+'F付近'}`});
   }
  }
  return results.sort((a,b)=>b.rootString-a.rootString||Math.max(...a.frets.map(f=>f??0))-Math.max(...b.frets.map(f=>f??0)));
 }
