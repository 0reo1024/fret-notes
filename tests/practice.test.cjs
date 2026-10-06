const assert=require('node:assert/strict');
const Core=require('../dist/core.js'),T=require('../dist/theory.js');

// Known fretboard notes and reverse answers, including octave duplicates.
const cases=[
 ['guitar',6,{string:6,fret:3},'G'],
 ['guitar',6,{string:2,fret:1},'C'],
 ['bass',4,{string:4,fret:5},'A'],
 ['bass',5,{string:5,fret:3},'D']
];
for(const [kind,count,position,name] of cases){
 const C=Core.forInstrument(kind,count),settings=C.normalize();
 assert.equal(C.name(position),name);
 assert(C.isCorrect(position,position,settings));
 assert(!C.isCorrect(position,{...position,fret:position.fret+1},settings));
 assert(!C.isCorrect(position,{...position,string:position.string===1?2:1},settings));
 const candidates=C.candidates(settings),deck=C.shuffled(candidates,null,()=>0.41);
 assert.equal(new Set(deck.map(C.key)).size,count*13);
 assert.deepEqual(new Set(deck.map(C.key)),new Set(candidates.map(C.key)));
 const next=C.shuffled(candidates,deck.at(-1),()=>0.41);
 assert.notEqual(C.key(next[0]),C.key(deck.at(-1)));
 const open={string:1,fret:0},octave={string:1,fret:12};
 assert(C.isCorrect(open,octave,settings));
 assert(!C.isCorrect(open,octave,{...settings,frets:[0]}));
 assert.equal(C.candidates({...settings,strings:[]}).length,0);
 assert.equal(C.candidates({...settings,frets:[]}).length,0);
 const naturals={...settings,naturalOnly:true,frets:[1,3,5,7,9]};
 assert(C.candidates(naturals).every(p=>/^[A-G]$/.test(C.name(p))));
}

// One physical note has distinct harmonic roles in four mixed layers.
const layers=T.layers(T.normalize({studyView:'chord',studyRoot:'C',studyChord:'major',studyLayers:[
 {kind:'chord',root:'A',pattern:'minor'},
 {kind:'scale',root:'C',pattern:'ionian'},
 {kind:'scale',root:'E',pattern:'minor-pentatonic'}
]}));
assert.deepEqual(layers.map(layer=>layer.tones.find(t=>t.pitch===4).degree),['3','5','3','R']);
assert.deepEqual(layers.map(layer=>layer.tones.find(t=>t.pitch===5)?.degree||null),[null,null,'4',null]);
assert.equal(T.layers(T.normalize({studyView:'all',studyLayers:[]})).length,0);
console.log('Verified forward/reverse answers, all three instruments, full nonrepeating decks, empty scopes, natural-note filters and four-layer membership roles.');
