import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceSession, playTargets, type PlayObservation, type PlayTarget } from '../src/domain/practice/performance';
import { create } from '../src/domain/instruments/core';
import { resolveInstrument } from '../src/domain/instruments/profiles';
import { AudioController, type AudioBackend, type AudioObservation } from '../src/platform/audio';
import { defaultAudioSettings } from '../src/domain/tuner/settings';
import { readFile } from 'node:fs/promises';

const target:PlayTarget={string:6,fret:0,midi:40,note:'E2'};
const frequency=440*2**((40-69)/12);
// Two positions with the same pitch keep the expected frequency for every question.
function setup(targets=[target,{...target,string:5}]) {
  const session=new PerformanceSession(targets,{toleranceCents:10,holdMs:350,referenceHz:440},()=>.2);
  session.bind('first');let sequence=0,time=0;
  const send=(hz:number|null=frequency,state='stable',duration=70)=>{
    time+=duration;session.consume({sessionId:'first',sequence:++sequence,audioTimeMs:time,state,frequency:hz});
  };
  const hold=(hz=frequency)=>{for(let n=0;n<6;n++)send(hz);};
  return {session,send,hold,packet:(change:Partial<PlayObservation>)=>session.consume({sessionId:'first',sequence:++sequence,audioTimeMs:time+70,state:'stable',frequency,...change})};
}
test('success feedback prevents duplicate scoring, then advances without muting',()=>{
  const {session,hold,send}=setup();
  hold();assert.equal(session.results.length,1);assert.equal(session.phase,'accepted');
  for(let n=0;n<40;n++)send();
  assert.equal(session.results.length,1);assert.equal(session.index,0);
  session.continueAfterAnswer();assert.equal(session.index,1);assert.equal(session.phase,'listening');
  session.continueAfterAnswer();assert.equal(session.index,1);
});

test('each round asks every target once, then reshuffles instead of finishing',()=>{
  const targets:PlayTarget[]=[target,{string:5,fret:0,midi:45,note:'A2'},{string:4,fret:0,midi:50,note:'D3'}];
  const session=new PerformanceSession(targets,{toleranceCents:10,holdMs:350,referenceHz:440});
  assert.equal(session.deck.length,3);
  assert.deepEqual(session.deck.map(t=>t.midi).sort(),[40,45,50]);
  const first=session.deck.slice();
  session.bind('rounds');let time=0,sequence=0;
  for(const question of first){
    for(let n=0;n<6;n++)session.consume({sessionId:'rounds',sequence:++sequence,audioTimeMs:time+=70,state:'stable',frequency:440*2**((question.midi-69)/12)});
    assert.equal(session.phase,'accepted');session.continueAfterAnswer();
  }
  assert.equal(session.round,2);assert.equal(session.index,0);assert.equal(session.phase,'listening');
  assert.deepEqual(session.deck.map(t=>t.midi).sort(),[40,45,50]);
  assert.notEqual(session.deck[0].midi,first.at(-1)!.midi);
  assert.equal(session.results.length,3);
});

test('wrong octave and off target episodes are counted without repeated penalties',()=>{
  const {session,hold,send}=setup();
  hold(frequency*2);for(let n=0;n<20;n++)send(frequency*2);
  assert.equal(session.results.length,0);assert.equal(session.wrongAttempts,1);
  send(null,'silence');hold(frequency/2);assert.equal(session.wrongAttempts,2);
  hold(frequency*2**(9/1200));assert.equal(session.results.length,1);assert.equal(session.totalWrongAttempts,2);
  assert.ok(Math.abs(session.results[0].cents-9)<.001);
});
test('silence, clipping, instability and missing data break the stable hold',()=>{
  for(const state of ['silence','clipping','unstable','warming']) {
    const {session,send,hold}=setup();for(let n=0;n<4;n++)send();send(null,state);for(let n=0;n<4;n++)send();
    assert.equal(session.results.length,0,state);hold();assert.equal(session.results.length,1,state);
  }
  const {session,send}=setup();for(let n=0;n<4;n++)send();send(frequency,'stable',500);for(let n=0;n<4;n++)send();
  assert.equal(session.results.length,0);send();assert.equal(session.results.length,1);
});
test('next question needs no silence packet and requires fresh stable pitch evidence',()=>{
  const {session,hold,send}=setup();hold();
  session.continueAfterAnswer();assert.equal(session.index,1);assert.equal(session.progress,0);
  for(let n=0;n<20;n++)send(null,'unstable');
  assert.equal(session.results.length,1);
  for(let n=0;n<4;n++)send();assert.equal(session.results.length,1);
  hold();assert.equal(session.results.length,2);
});

test('resume keeps the question, clears old evidence and needs no mute',()=>{
  const {session,send,hold}=setup();for(let n=0;n<4;n++)send();session.pause();
  hold();assert.equal(session.results.length,0);session.bind('second');
  assert.equal(session.phase,'listening');assert.equal(session.index,0);
  for(let n=1;n<=4;n++)session.consume({sessionId:'second',sequence:n,audioTimeMs:n*70,state:'stable',frequency});
  assert.equal(session.results.length,0);
  for(let n=5;n<=6;n++)session.consume({sessionId:'second',sequence:n,audioTimeMs:n*70,state:'stable',frequency});
  assert.equal(session.results.length,1);
  session.pause();assert.equal(session.index,1);session.bind('third');
  for(let n=1;n<=4;n++)session.consume({sessionId:'third',sequence:n,audioTimeMs:n*70,state:'stable',frequency});
  assert.equal(session.results.length,1);assert.equal(session.index,1);
});

test('old session, replay, reversed/identical time and invalid frequencies do not grant credit',()=>{
  const {session,send,packet}=setup();for(let n=0;n<4;n++)send();
  packet({sessionId:'old',audioTimeMs:5000});packet({sequence:0,audioTimeMs:5000});packet({audioTimeMs:0});packet({audioTimeMs:280});
  assert.equal(session.results.length,0);
  packet({audioTimeMs:350,frequency:NaN});assert.equal(session.cents,null);
  session.consume({sessionId:'first',sequence:100,audioTimeMs:420,state:'error',frequency:null});assert.equal(session.phase,'paused');
});
test('targets follow tuning and study ranges, include B0, reject out of range and empty sets',()=>{
  const profile=resolveInstrument('bass5'), core=create(profile);
  const targets=playTargets(profile,core.normalize({strings:[5],frets:[0]}),440);
  assert.deepEqual(targets,[{string:5,fret:0,midi:23,note:'B0'}]);
  const drop=resolveInstrument('guitar',{selectedTuningId:'drop-d',customTunings:[]});
  assert.equal(playTargets(drop,create(drop).normalize({strings:[6],frets:[0]}),432)[0].midi,38);
  const extreme=resolveInstrument('guitar',{selectedTuningId:'user:low',customTunings:[{id:'user:low',name:'低音',instrumentId:'guitar',openMidi:[0,0,0,0,0,0]}]});
  assert.equal(playTargets(extreme,create(extreme).normalize(),440).length,0);
  assert.throws(()=>new PerformanceSession([],{toleranceCents:10,holdMs:350,referenceHz:440}));
  assert.throws(()=>new PerformanceSession([target],{toleranceCents:0,holdMs:350,referenceHz:440}));
});
test('validated controller observations feed practice directly and stop before stale input can score',async()=>{
  let receive:(o:AudioObservation)=>void=()=>{}, acknowledgements=0;
  const backend:AudioBackend={available:true,async list(){return[];},async start(request,callback){receive=callback;return{sessionId:request.sessionId,deviceName:'fixture',sampleRate:48000,analysisSampleRate:12000,channels:1,channel:0};},async stop(){},async acknowledge(){acknowledgements++;}};
  const controller=new AudioController(backend,()=>0,()=> 'integration');
  const session=new PerformanceSession([target],{toleranceCents:10,holdMs:350,referenceHz:440});
  controller.onChange=()=>{if(controller.phase==='running')session.bind(controller.started!.sessionId);else if(controller.phase==='idle' || controller.phase==='error')session.pause();};
  controller.onObservation=o=>session.consume(o);
  await controller.start(defaultAudioSettings());
  const send=(sequence:number,hz:number)=>receive({sessionId:'integration',sequence,audioTimeMs:sequence*70,state:'stable',frequency:hz,levelDb:-20,peak:.2,confidence:.99,droppedSamples:0,message:null});
  for(let n=1;n<=6;n++)send(n,frequency);assert.equal(session.results.length,1);assert.equal(acknowledgements,6);
  await controller.stop();send(7,frequency);assert.equal(session.phase,'paused');assert.equal(session.results.length,1);
});
test('previous real guitar analysis events accept E2 once without treating unstable attack as release',async()=>{
  const fixture=JSON.parse((await readFile(new URL('./fixtures/play-guitar-events.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
  const session=new PerformanceSession([target],{toleranceCents:10,holdMs:350,referenceHz:440});session.bind('replay');
  fixture.timeline.forEach((event:Omit<PlayObservation,'sessionId'|'sequence'>,i:number)=>session.consume({...event,sessionId:'replay',sequence:i+1}));
  assert.equal(session.results.length,1);assert.equal(session.results[0].target.midi,fixture.targetMidi);
  assert.equal(session.index,0);assert.equal(session.phase,'accepted');
});
