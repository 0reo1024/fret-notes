const assert=require('node:assert/strict');
const T=require('../src/domain/music/theory.ts'),S=require('../src/domain/instruments/shapes.ts');
const profiles=[['guitar',6,[4,9,2,7,11,4]],['bass',4,[4,9,2,7]],['bass',5,[11,4,9,2,7]]];
let count=0;
// Voicings exist for the original qualities; the tension qualities added in P14 have none (checked in advanced.test.ts).
const voiced=T.chords.filter(c=>c.group!=='テンション');
for(const [instrument,stringCount,tuning] of profiles)for(const root of T.roots)for(const chord of voiced){
 const expected=new Set(chord.degrees.map(d=>(T.pitchOf(root)+T.interval(d))%12));
 const shapes=S.get(root,chord.id,instrument,stringCount);
 assert(shapes.length>0,`Missing shapes: ${root} ${chord.id}`);
 for(const shape of shapes){
  const actual=new Set();let bass;
  shape.frets.forEach((f,i)=>{
   if(f===null)return;
   assert(Number.isInteger(f)&&f>=0&&f<=15);
   const pitch=(tuning[i]+f)%12;actual.add(pitch);bass??=pitch;
   assert.equal(shape.notes[i]?.pitch,pitch);
   if(f>0)assert(f>=shape.start&&f<shape.start+5,'Dot must lie inside the diagram');
  });
  assert.equal(shape.frets.length,stringCount);
  for(const degree of shape.omitted){assert.equal(degree,'5','Only the perfect fifth may be omitted');actual.add((T.pitchOf(root)+T.interval(degree))%12);}
  assert.deepEqual(actual,expected,`${instrument} ${root} ${chord.id}: ${shape.frets}`);
  assert.equal(bass,T.pitchOf(root),'Root-position voicing');
  count++;
 }
}
assert(S.get('C','major').some(s=>s.frets.join(',')===',3,5,5,5,3'));
assert(S.get('E','minor').some(s=>s.frets.join(',')==='0,2,2,0,0,0'));
for(const root of T.roots){
 for(const chord of voiced)assert(S.get(root,chord.id).some(s=>s.rootString===4),`Missing 4th-string shape: ${root} ${chord.id}`);
 for(const id of ['major','minor','dim','aug','sus2','sus4','maj7','min7','dom7','7sus4','six','min6','minmaj7'])assert(S.get(root,id).some(s=>s.rootString===3),`Missing 3rd-string shape: ${root} ${id}`);
}
console.log(`Verified ${count} guitar and bass chord shapes, with explicit omissions, tuning, root strings and diagram bounds.`);
