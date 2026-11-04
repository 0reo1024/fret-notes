import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describePitch, frequencyForMidi, stringTargets } from '../src/domain/tuner/pitch';
import { defaultAudioSettings, decodeAudioSettings } from '../src/domain/tuner/settings';
import { resolveInstrument, defaultTuning } from '../src/domain/instruments/profiles';
import { AudioController, type AudioBackend, type AudioObservation, type AudioRequest } from '../src/platform/audio';
import { decodeSettings, defaults, SettingsRepository, type SettingsFile } from '../src/platform/settings';

test('tuner calibration, cents, octave-aware targets and arbitrary tunings',()=>{
  assert.equal(describePitch(440)?.note,'A4'); assert.ok(describePitch(440)?.inTune);
  assert.ok(describePitch(432,432)?.inTune);
  const sharp = describePitch(440*2**(12/1200))!; assert.ok(Math.abs(sharp.cents-12)<1e-9); assert.equal(sharp.inTune,false);
  assert.ok(Math.abs(describePitch(440,440,57)!.cents-1200)<1e-9);
  assert.ok(Math.abs(describePitch(220,440,69)!.cents+1200)<1e-9);
  assert.equal(describePitch(NaN),null); assert.equal(describePitch(0),null);
  const drop = resolveInstrument('bass5',{...defaultTuning(),selectedTuningId:'drop-a'});
  assert.equal(stringTargets(drop)[4].note,'A0'); assert.equal(stringTargets(drop)[4].frequency,27.5);
  assert.equal(stringTargets(resolveInstrument('guitar'))[5].openMidi,40);
  assert.equal(frequencyForMidi(69,432),432);
});
function mock() {
  const stops: (string|null)[] = [], acknowledgements: number[] = [];
  let receive: (observation: AudioObservation)=>void = ()=>{};
  let clock = 0, id = 0;
  let startResolve: ((value: {sessionId:string;deviceName:string;sampleRate:number;analysisSampleRate:number;channels:number;channel:number})=>void) | null = null;
  let pendingRequest: AudioRequest;
  const backend: AudioBackend = { available:true, async list(){return[];}, async start(request,callback){ pendingRequest=request; receive=callback; return new Promise(resolve=>{startResolve=resolve;}); }, async stop(id){stops.push(id);}, async acknowledge(_id,seq){acknowledgements.push(seq);} };
  const controller = new AudioController(backend,()=>clock,()=>`session-${++id}`);
  const observation = (change: Partial<AudioObservation> = {}): AudioObservation=>({sessionId:pendingRequest.sessionId,sequence:1,audioTimeMs:200,state:'stable',frequency:110,levelDb:-20,peak:.3,confidence:.99,droppedSamples:0,message:null,...change});
  return {backend,controller,stops,acknowledgements,receive:(change:Partial<AudioObservation>={})=>receive(observation(change)), now:(time:number)=>{clock=time;}, ready:()=>startResolve!({sessionId:pendingRequest.sessionId,deviceName:'test',sampleRate:48000,analysisSampleRate:12000,channels:2,channel:pendingRequest.channel})};
}
test('audio lifecycle rejects stale sessions and clears silence, clipping, duplicates and missing input',async()=>{
  const m=mock(),start=m.controller.start(defaultAudioSettings()); m.ready(); await start;
  m.receive(); assert.equal(m.controller.observation?.frequency,110);
  m.receive({sessionId:'old-session',sequence:99,frequency:220}); assert.equal(m.controller.observation?.frequency,110);
  m.receive({sequence:1,frequency:220}); assert.equal(m.controller.observation?.frequency,110);
  m.receive({sequence:2,audioTimeMs:100,frequency:220}); assert.equal(m.controller.observation?.frequency,110);
  m.receive({sequence:3,audioTimeMs:300,state:'silence'}); assert.equal(m.controller.observation?.frequency,null);
  m.receive({sequence:4,audioTimeMs:400,state:'stable'}); assert.equal(m.controller.observation?.frequency,110);
  m.receive({sequence:5,audioTimeMs:500,state:'clipping'}); assert.equal(m.controller.observation?.frequency,null);
  m.now(600); m.controller.tick(); assert.equal(m.controller.observation,null);
  m.now(2100); m.controller.tick(); assert.equal(m.controller.phase,'error'); assert.ok(m.stops.includes('session-1'));
  assert.deepEqual(m.acknowledgements,[1,1,2,3,4,5]);
});
test('stop during startup ignores a delayed start result and repeated stop calls share completion',async()=>{
  const m=mock(),start=m.controller.start(defaultAudioSettings());
  const stop=m.controller.stop(),again=m.controller.stop(); assert.equal(stop,again); await stop;
  m.ready(); await start; assert.equal(m.controller.phase,'idle'); assert.deepEqual(m.stops,['session-1']);
  m.receive(); assert.equal(m.controller.observation,null);
});
test('device errors, invalid observations and failed acknowledgements stop input without a stale pitch',async()=>{
  const m=mock(),start=m.controller.start(defaultAudioSettings()); m.ready(); await start; m.receive();
  m.receive({sequence:2,state:'error',audioTimeMs:0,message:'disconnected'}); assert.equal(m.controller.phase,'error'); assert.equal(m.controller.observation,null);
  const bad=mock(),starting=bad.controller.start(defaultAudioSettings()); bad.ready(); await starting;
  bad.receive({frequency:NaN}); assert.equal(bad.controller.phase,'error');
  const ack=mock(); ack.backend.acknowledge=async()=>{throw new Error('IPC failure');}; const begin=ack.controller.start(defaultAudioSettings());ack.ready();await begin;ack.receive();await Promise.resolve();
  assert.equal(ack.controller.phase,'error'); assert.equal(ack.controller.observation,null);
});
test('native suspension stops the display even if startup finishes later',async()=>{
  const m=mock(),start=m.controller.start(defaultAudioSettings());
  m.receive({state:'stopped',sequence:2,frequency:null}); assert.equal(m.controller.phase,'idle');
  m.ready();await start;assert.equal(m.controller.phase,'idle');assert.equal(m.controller.observation,null);
});
test('audio settings migrate and round-trip with calibration while malformed imports preserve existing data',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/settings-v3.json',import.meta.url),'utf8'));
  // Files saved before performance practice had its own settings load with an empty play section and default input settings.
  assert.deepEqual(decodeSettings(fixture),{...fixture,play:{},playOptions:{toleranceCents:10,holdMs:350}});
  assert.deepEqual(decodeSettings({...fixture,playOptions:{toleranceCents:20,holdMs:200}}).playOptions,{toleranceCents:20,holdMs:200});
  for(const playOptions of [{toleranceCents:15,holdMs:350},{toleranceCents:10,holdMs:350,count:10}]) assert.throws(()=>decodeSettings({...fixture,playOptions}));
  const play={strings:[1,2],frets:[0,3,5],naturalOnly:true,tuning:{selectedTuningId:'drop-d',customTunings:[]}};
  assert.deepEqual(decodeSettings({...fixture,lastInstrument:'guitar',play:{guitar:play}}).play.guitar,play);
  for(const bad of [{...play,strings:'1'},{...play,tuning:{selectedTuningId:'missing',customTunings:[]}},{...play,naturalOnly:1}]) assert.throws(()=>decodeSettings({...fixture,play:{guitar:bad}}));
  assert.throws(()=>decodeSettings({...fixture,play:{ukulele:play}}));
  const v2=JSON.parse(await readFile(new URL('./fixtures/settings-v2.json',import.meta.url),'utf8'));
  assert.deepEqual(decodeSettings(v2).audio,defaultAudioSettings());
  for(const change of [{channel:64},{channel:-1},{referenceHz:0},{referenceHz:481},{gateDb:NaN},{deviceId:''},{channel:1.5},{extra:true}]) assert.throws(()=>decodeAudioSettings({...defaultAudioSettings(),...change}));
  let stored:SettingsFile=defaults(); const repository=new SettingsRepository({async load(){return{settings:stored,recovered:false};},async save(value){stored=structuredClone(value);}});await repository.load();
  await repository.updateAudio(fixture.audio); assert.deepEqual(decodeSettings(JSON.parse(await repository.exportJson())).audio,fixture.audio);
  const before=structuredClone(repository.current); await assert.rejects(repository.replace({...fixture,audio:{...fixture.audio,referenceHz:999}}));assert.deepEqual(repository.current,before);
});
