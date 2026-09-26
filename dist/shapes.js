(function(root){
 'use strict';
 const T=root.FretTheory||(typeof require==='function'?require('./theory.js'):null);
 // Six strings, low E to high E. null means mute; offsets transpose with the root.
 const form=(base,frets)=>({base,frets});
 const forms={
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
 const tuning=[4,9,2,7,11,4],mod=n=>(n%12+12)%12;
 function get(rootName,id){
  const pattern=T.chords.find(p=>p.id===id);if(!pattern)return [];
  const tones=pattern.degrees.map(degree=>({degree,name:T.spell(rootName,degree),pitch:mod(T.pitchOf(rootName)+T.interval(degree))}));
  const results=[];
  for(const template of forms[id]||[]){
   let shift=mod(T.pitchOf(rootName)-T.pitchOf(template.base));
   while(template.frets.some(f=>f!==null&&f+shift<0))shift+=12;
   for(const offset of [shift,shift+12]){
    const frets=template.frets.map(f=>f===null?null:f+offset);
    if(Math.max(...frets.filter(f=>f!==null))>15)continue;
    const notes=frets.map((f,i)=>f===null?null:tones.find(t=>t.pitch===mod(tuning[i]+f)));
    const positive=frets.filter(f=>f>0),start=frets.includes(0)?1:Math.min(...positive);
    results.push({frets,notes,start,label:frets.includes(0)?'開放弦を使う形':`${6-frets.findIndex(f=>f!==null)}弦ルート・${Math.min(...positive)}F付近`});
   }
  }
  return results.sort((a,b)=>Math.max(...a.frets)-Math.max(...b.frets)).slice(0,3);
 }
 const api={get};root.FretShapes=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
