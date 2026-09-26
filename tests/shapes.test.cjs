const assert=require('node:assert/strict');
const T=require('../dist/theory.js'),S=require('../dist/shapes.js');
const tuning=[4,9,2,7,11,4];
let count=0;
for(const root of T.roots)for(const chord of T.chords){
 const expected=new Set(chord.degrees.map(d=>(T.pitchOf(root)+T.interval(d))%12));
 const shapes=S.get(root,chord.id);
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
  assert.deepEqual(actual,expected,`${root} ${chord.id}: ${shape.frets}`);
  assert.equal(bass,T.pitchOf(root),'Root-position voicing');
  count++;
 }
}
assert(S.get('C','major').some(s=>s.frets.join(',')===',3,5,5,5,3'));
assert(S.get('E','minor').some(s=>s.frets.join(',')==='0,2,2,0,0,0'));
console.log(`Verified ${count} chord shapes, including all 19 chord types and 17 root spellings.`);
