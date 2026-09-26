const assert=require('node:assert/strict'),Core=require('../dist/core.js');
for(const n of [4,5]){
 const C=Core.forInstrument('bass',n),settings=C.normalize();
 assert.equal(C.candidates(settings).length,n*13);
 const open=n===4?['G','D','A','E']:['G','D','A','E','B'];
 for(let string=1;string<=n;string++){
  assert.equal(C.name({string,fret:0}),open[string-1]);
  assert.equal(C.name({string,fret:12}),open[string-1]);
  assert(C.isCorrect({string,fret:0},{string,fret:12},settings));
 }
 assert(C.candidates({...settings,naturalOnly:true}).every(p=>['A','B','C','D','E','F','G'].includes(C.name(p))));
 assert(!C.normalize({strings:[1,6]}).strings.includes(6));
 assert.equal(C.movePosition(settings,{string:n,fret:4},'ArrowDown').string,n);
 assert.equal(C.movePosition(settings,{string:n,fret:4},'ArrowUp').string,n-1);
}
assert.equal(Core.forInstrument('bass',5).name({string:5,fret:1}),'C');
assert.equal(Core.name({string:2,fret:0}),'B');
console.log('Bass tunings, candidates, answer matching, natural notes and keyboard bounds verified.');
