import Core, { type Position, type Notation, type PracticeMode } from '../../domain/instruments/core';
import * as T from '../../domain/music/theory';
import * as Shapes from '../../domain/instruments/shapes';
import { advancedOptions, describeAvoid } from '../../domain/training/advanced';
import { $, $$, inputTarget } from '../../ui/dom';
import type { SettingsRepository, InstrumentSettings, ProfileId } from '../../platform/settings';
import { Fretboard } from './board';
import { PracticeSession } from '../../domain/practice/session';
import { mountTuning } from '../settings/tuning';
import { mountRange } from '../settings/range';
import { resolveInstrument, type TuningConfig, type InstrumentProfile } from '../../domain/instruments/profiles';
import { FindAllSession } from '../../domain/practice/find-all';
import { checkPitchClassName, pitchClassChoices, pitchClassLabel } from '../../domain/training/note-answers';
import { statKey, type AttemptResult } from '../../domain/training/records';
import { targetFor, targetsOf, weightedDeck, type Focus } from '../../domain/training/analysis';
import type { NewAttempt, TrainingRepository } from '../../platform/training-store';
import { NoteAnswerInput } from '../answers/note-answer';
import { sound } from '../../platform/sound';
type AnswerMethod = 'self'|'choice'|'name';
const answerMethods: AnswerMethod[] = ['self','choice','name'];
const median=(values: number[])=>{const s=values.slice().sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
/** `training` records answers and response times; without it the study view works as before. */
export function mountStudy(repository: SettingsRepository,onInstrumentChange: (profile: InstrumentProfile)=>void=()=>{},training: TrainingRepository|null=null) {
 const lastInstrument=repository.current.lastInstrument;
 const requestedInstrument=['#guitar','#bass','#bass4','#bass5'].includes(location.hash)?location.hash.slice(1):lastInstrument||document.body.dataset.instrument||'guitar';
 let isBass=requestedInstrument.startsWith('bass');
 let bassCount=repository.current.bassStringCount;
 if(requestedInstrument==='bass4'||requestedInstrument==='bass5')bassCount=Number(requestedInstrument.slice(-1));
 let STORAGE=(isBass?'bass'+bassCount:'guitar') as ProfileId;
 let tuningConfig=repository.current.instruments[STORAGE];
 let C=Core.create(resolveInstrument(STORAGE,tuningConfig));
 const stored=repository.current.profiles[STORAGE];
 let settings: InstrumentSettings={...C.normalize(stored),...T.normalize(stored)}; let deck: Position[]=[],index=0,round=1,revealed=false; let chosen: Position|null=null,cursor: Position|null=null,inspected: Position|null=null;
 const current=()=>deck[index]||null;
 const allowed=(p: Position)=>C.allowed(p,settings);
 const firstOnString=(string: number)=>C.candidates(settings).find(p=>p.string===string)!;
 function save(){repository.update(STORAGE,focus?{...settings,...focus.restore}:settings,isBass?'bass'+bassCount:'guitar',bassCount,tuningConfig);}
 const tuningView=mountTuning($('#study-tuning'),(next: TuningConfig)=>{
  const nextCore=Core.create(resolveInstrument(STORAGE,next));
  tuningConfig=next;C=nextCore;save();updateInstrument();reset();
 });
 const rangeView=mountRange($('#study-range'),next=>{endFocus();Object.assign(settings,next);changeScope();});
 /** Rounds ordered from the records when weighting or focus is on; otherwise the session's own shuffle. */
 function order(){
  if(!training||!(weighted||focus)||settings.mode==='find-all'||settings.mode==='study')return undefined;
  const layer=settings.mode==='reverse'?'fretboard' as const:'knowledge' as const,targetMethod=settings.mode==='reverse'?'click' as const:method==='name'?'name' as const:'choice' as const;
  return (positions: Position[],last: Position|null)=>weightedDeck(positions.filter(p=>!focus||focus.keys.has(C.key(p))),new Date(),Math.random,{
   stat:p=>training.current.stats[statKey(layer,`fb:${STORAGE}:${p.string}:${p.fret}`)],targetMs:targetFor(targetsOf(training.current.preferences),targetMethod),last,clash:(a,b)=>C.key(a)===C.key(b),
  });
 }
 function endFocus(){if(!focus)return;Object.assign(settings,focus.restore);method=focus.method;focus=null;}
 let session=new PracticeSession(C,settings);
 let findAll=new FindAllSession(C,settings);
 // Answer method for position → name; kept in the training store so settings.json is unchanged.
 const studyPrefs=()=>{const value=training?.preference('study');return (value&&typeof value==='object'?value:{}) as {forwardMethod?: string;weighted?: boolean};};
 const savedMethod=studyPrefs().forwardMethod;
 // Weak-first order is optional here so the quiz keeps its plain shuffled rounds by default.
 let weighted=studyPrefs().weighted===true;
 /** Focused practice on chosen positions. The range and mode it needs are never saved: `restore` keeps the user's own values. */
 let focus: {keys: Set<string>; label: string; restore: Pick<InstrumentSettings,'mode'|'strings'|'frets'|'naturalOnly'>; method: AnswerMethod}|null=null;
 let method: AnswerMethod=answerMethods.includes(savedMethod as AnswerMethod)?savedMethod as AnswerMethod:'self';
 let named: {name: string; result: AttemptResult}|null=null, choices: number[]=[];
 let shownAt=performance.now(), times: number[]=[], questionKey='', answerInputKey='';
 const answerInput=new NoteAnswerInput($('#answer-input'),name=>answerName(name));
 function log(attempt: Omit<NewAttempt,'instrument'|'responseMs'|'trainer'>){
  const responseMs=Math.round(performance.now()-shownAt);
  if(['correct','wrong','spelling'].includes(attempt.result))times.push(responseMs);
  training?.add({...attempt,trainer:'fretboard',responseMs,instrument:STORAGE});
 }
 function syncPractice(){
  ({deck,index,round,revealed,chosen}=session.state);
  // A new question restarts the response clock and the answer controls.
  const key=settings.mode==='find-all'?`${findAll.round}:${findAll.index}:${findAll.current()}`:`${settings.mode}:${round}:${index}`;
  if(key!==questionKey){questionKey=key;shownAt=performance.now();named=null;const target=current();choices=target?pitchClassChoices(C.pitch(target)):[];}
  render();
 }
 function reset(){session=new PracticeSession(C,settings,Math.random,order());findAll=new FindAllSession(C,settings);cursor=null;inspected=null;times=[];questionKey='';syncPractice();}
 function next(){if(settings.mode==='find-all')findAll.next();else session.next();cursor=null;syncPractice();}
 function reveal(){
  if(settings.mode==='find-all'){const result=findAll.complete();if(result)log({itemId:`note:${STORAGE}:${result.pitchClass}`,layer:'fretboard',method:'click',result:result.correct?'correct':'wrong',...(result.correct?{}:{errorKind:`missed:${result.missed.length},wrong:${result.wrong.length}`})});syncPractice();return;}
  // Giving up on a choice/name question is a skip, not a wrong answer.
  if(settings.mode==='forward'&&method!=='self'&&!revealed&&current())log({itemId:`fb:${STORAGE}:${current().string}:${current().fret}`,layer:'knowledge',method,result:'skipped'});
  session.reveal();syncPractice();
 }
 function primary(){if(settings.mode==='find-all'?findAll.result:revealed)next();else reveal();}
 function answer(p: Position){
  const target=current(),first=settings.mode==='reverse'&&!revealed&&!!target&&allowed(p);
  session.answer(p);cursor=null;
  if(first&&target)log({itemId:`fb:${STORAGE}:${target.string}:${target.fret}`,layer:'fretboard',method:'click',result:C.isCorrect(target,p,settings)?'correct':'wrong'});
  syncPractice();
 }
 function answerName(name: string){
  const target=current();if(settings.mode!=='forward'||method==='self'||revealed||!target)return;
  const result=checkPitchClassName(name,C.pitch(target));
  named={name,result};
  log({itemId:`fb:${STORAGE}:${target.string}:${target.fret}`,layer:'knowledge',method,result});
  session.reveal();syncPractice();
 }
 function toggleFind(p: Position){findAll.toggle(p);cursor=p;renderBoard();renderFindHelp();}
 function changeScope(){save();reset();}
 function renderInspection(){
  const panel=$('#note-inspection');panel.hidden=settings.mode!=='study'||!inspected;
  if(panel.hidden||!inspected)return;
  const position=inspected;
  const layers=T.layers(settings),matches=layers.map(layer=>({layer,tone:layer.tones.find(t=>t.pitch===C.pitch(position))})).filter((entry): entry is typeof entry & {tone: T.Tone}=>!!entry.tone);
  panel.innerHTML=`<strong>${position.string}弦 ${position.fret}F · ${C.name(position,settings.notation)}</strong><div>${matches.map(({layer,tone})=>`<span class="inspection-entry layer-${layer.index}"><span class="layer-tag">${layer.index+1}</span>${layer.root} ${layer.pattern.label}：${tone.name}（${tone!.degree}）</span>`).join('')||`<span class="inspection-empty">${layers.length?'選択中のコード・スケールには含まれません。':'指板をタップして音名を確認できます。'}</span>`}</div>`;
 }
 function options(catalog: T.Pattern[]){const groups=[...new Set(catalog.map(p=>p.group))];return groups.map(group=>`<optgroup label="${group}">${catalog.filter(p=>p.group===group).map(p=>`<option value="${p.id}">${p.label}</option>`).join('')}</optgroup>`).join('');}
 function shapeDiagram(shape: Shapes.ChordShape,chordName: string){
  const positions=shape.frets.map(f=>f===null?'×':f).join('・');
  let svg=`<svg viewBox="0 0 230 228" role="img" aria-label="${chordName}、${C.stringCount}弦から1弦のフレット：${positions}">`;
  for(let f=0;f<=5;f++)svg+=`<line class="shape-fret" x1="40" x2="190" y1="${44+f*30}" y2="${44+f*30}" ${f===0&&shape.start===1?'style="stroke-width:4"':''}/>`;
  for(let f=0;f<5;f++)svg+=`<text class="shape-fret-number" x="19" y="${64+f*30}">${shape.start+f}</text>`;
  shape.frets.forEach((f,i)=>{
   const x=40+i*150/(C.stringCount-1),tone=shape.notes[i];
   svg+=`<line class="shape-string" x1="${x}" x2="${x}" y1="44" y2="194"/><text class="shape-string-number" x="${x}" y="216">${C.stringCount-i}</text>`;
   if(f===null||f===0)svg+=`<text class="shape-open" x="${x}" y="29">${f===null?'×':'○'}</text>`;
   else {const y=59+(f!-shape.start)*30;svg+=`<circle class="${tone!.degree==='R'?'shape-root':'shape-tone'}" cx="${x}" cy="${y}" r="12.5"/><text class="shape-degree" x="${x}" y="${y}" dominant-baseline="central">${tone!.degree}</text>`;}
  });
  return svg+'</svg>';
 }
 function renderShapes(){
  const availability=Shapes.forProfile('C','major',C);
  if(!availability.supported){$('#shapes-content').replaceChildren();const notice=document.createElement('p');notice.className='shapes-help';notice.textContent=availability.message;$('#shapes-content').append(notice);return;}
  $('#shapes-content').innerHTML=T.layers(settings).filter(layer=>layer.kind==='chord').map(layer=>{
   const name=layer.root+layer.pattern.suffix,shapes=Shapes.forProfile(layer.root,layer.pattern.id,C).shapes;
   if(!shapes.length)return `<section class="shape-group layer-${layer.index}"><h3><span class="layer-tag">${layer.index+1}</span>${name}<small>${layer.pattern.label}</small></h3><p class="shapes-help">このコードのシェイプは収録していません（テンションのコードなど）。指板の構成音の表示を使ってください。</p></section>`;
   return `<section class="shape-group layer-${layer.index}"><h3><span class="layer-tag">${layer.index+1}</span>${name}<small>${layer.pattern.label}</small></h3><div class="shape-cards">${shapes.map(shape=>`<figure class="shape-card"><figcaption>${shape.label}</figcaption><p class="shape-omissions">${shape.omitted.length?shape.omitted.map(d=>d+'度').join('・')+'省略':'構成音をすべて含む'}</p>${shapeDiagram(shape,name)}<p aria-label="${C.stringCount}弦から1弦のフレット">${shape.frets.map(f=>f===null?'×':f).join(' · ')}</p></figure>`).join('')}</div></section>`;
  }).join('');
 }
 // Drone for hearing a mode's colour against its root: root in the third octave plus a fifth, until stopped.
 let stopDrone: (()=>void)|null=null, droneRoot='';
 function setDrone(on: boolean){
  if(stopDrone){stopDrone();stopDrone=null;}
  if(on){const root=48+T.pitchOf(settings.studyRoot);stopDrone=sound.drone([root,root+7],repository.current.audio.referenceHz);}
  $('#scale-drone').setAttribute('aria-pressed',String(on));$('#scale-drone').textContent=on?'ドローンを止める':'ドローン（ルート＋5度）を鳴らす';
 }
 function buildStudyControls(){
  $('#scale-drone').addEventListener('click',()=>setDrone(!stopDrone));
  $$('[data-feature]').forEach(tab=>tab.addEventListener('click',()=>{if(tab.dataset.feature!=='study')setDrone(false);}));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setDrone(false);});
  $('#show-shapes').addEventListener('click',()=>{renderShapes();$<HTMLDialogElement>('#chord-shapes').showModal();});
  const shapesDialog=$<HTMLDialogElement>('#chord-shapes');
  const onBackdrop=(event: MouseEvent)=>{
   const rect=shapesDialog.getBoundingClientRect();
   return event.target===shapesDialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);
  };
  let pressedBackdrop=false;
  shapesDialog.addEventListener('pointerdown',event=>{pressedBackdrop=onBackdrop(event);});
  shapesDialog.addEventListener('click',event=>{if(pressedBackdrop&&onBackdrop(event))shapesDialog.close();pressedBackdrop=false;});
  $('#study-root').innerHTML=T.roots.map(note=>`<option value="${note}">${note}</option>`).join('');
  $$('[data-study-view]').forEach(button=>button.addEventListener('click',()=>{settings.studyView=button.dataset.studyView as T.StudySettings['studyView'];save();render();}));
  $('#study-root').addEventListener('change',e=>{settings.studyRoot=inputTarget(e).value;save();render();});
  $('#study-pattern').addEventListener('change',e=>{settings[settings.studyView==='chord'?'studyChord':'studyScale']=inputTarget(e).value;save();render();});
  $('#tone-labels').addEventListener('change',e=>{settings.toneLabels=inputTarget(e).value as T.StudySettings['toneLabels'];save();render();});
  $('#add-layer').addEventListener('click',()=>{
   if(settings.studyLayers.length>=3)return;
   const kind=settings.studyView==='chord'?'chord':'scale',pattern=kind==='chord'?(settings.studyChord==='min7'?'maj7':'min7'):(settings.studyScale==='minor-pentatonic'?'dorian':'minor-pentatonic');
   settings.studyLayers.push({kind,root:settings.studyRoot,pattern});save();render();
  });
  $('#comparison-layers').addEventListener('change',e=>{
   const field=inputTarget(e).dataset.layerField as keyof T.StudyLayer,index=Number(inputTarget(e).dataset.layerIndex),layer=settings.studyLayers[index];if(!layer||!['kind','root','pattern'].includes(field))return;
   if(field==='kind')layer.kind=inputTarget(e).value==='chord'?'chord':'scale';else layer[field]=inputTarget(e).value;
   if(field==='kind')layer.pattern=layer.kind==='chord'?'major':'ionian';
   settings.studyLayers=T.normalize(settings).studyLayers;save();render();
  });
  $('#comparison-layers').addEventListener('click',e=>{
   const button=(e.target as HTMLElement).closest<HTMLElement>('[data-remove-layer]');if(!button)return;
   settings.studyLayers.splice(Number(button.dataset.removeLayer),1);save();render();
  });
 }
 function renderStudy(){
  const study=settings.mode==='study',pattern=T.selected(settings),layers=T.layers(settings),multiple=layers.length>1;
  document.body.classList.toggle('comparing',study&&multiple);
  const hasChords=layers.some(layer=>layer.kind==='chord');
  $('#show-shapes').hidden=!study||!hasChords;
  const droneable=study&&settings.studyView==='scale'&&!!pattern;
  $('#scale-drone').hidden=!droneable;
  if(!droneable&&stopDrone)setDrone(false);
  else if(stopDrone&&droneRoot!==settings.studyRoot)setDrone(true);
  droneRoot=settings.studyRoot;
  $('#comparison-legend').hidden=!study||!multiple;
  $('#comparison-legend').innerHTML=study&&multiple?layers.map(layer=>`<span class="layer-legend layer-${layer.index}"><span class="layer-tag">${layer.index+1}</span>${layer.root} ${layer.pattern.label}</span>`).join(''):'';
  if($<HTMLDialogElement>('#chord-shapes').open){if(study&&hasChords)renderShapes();else $<HTMLDialogElement>('#chord-shapes').close();}
  $('#study-tools').hidden=!study;
  $('#theory-controls').hidden=!pattern;
  $('#theory-summary').hidden=!study||!pattern;
  $('#comparison-layers').hidden=!pattern||!settings.studyLayers.length;
  $('#add-layer').hidden=!pattern;
  $$('[data-study-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.studyView===settings.studyView)));
  if(!study||!pattern)return;
  const isChord=settings.studyView==='chord';
  const title=isChord?settings.studyRoot+pattern.suffix:settings.studyRoot+' '+pattern.label;
  $('#question').textContent=title;
  $('#question-kicker').textContent=isChord?'CHORD TONES':'SCALE MAP';
  $('#question-help').textContent=`${multiple?'音の下の番号・色が所属先です。指板をタップすると各所属先での度数を確認できます。':'構成音の全位置を表示。指板をタップすると音名と度数を確認できます。'}`;
  $('#mode-label').textContent=isChord?'コードの構成音を確認する':'スケールの構成音を確認する';
  $('#board-legend').textContent=multiple?'番号＋色＝所属先 ／ 選択して詳細':'R：ルート（赤）／ 構成音（黒）';
  $<HTMLSelectElement>('#study-root').value=settings.studyRoot;
  $<HTMLSelectElement>('#tone-labels').value=settings.toneLabels;
  $('#tone-labels').closest('label')!.hidden=multiple;
  $('#pattern-label').textContent=isChord?'コード':'スケール';
  const catalog=isChord?T.chords:T.scales;
  $('#study-pattern').innerHTML=options(catalog);
  $<HTMLSelectElement>('#study-pattern').value=pattern.id;
  const focus=(document.activeElement as HTMLElement|null)?.dataset,focusField=focus?.layerField,focusIndex=focus?.layerIndex;
  $('#comparison-layers').innerHTML=settings.studyLayers.map((layer,index)=>`<div class="comparison-row layer-${index+1}"><span class="layer-tag">${index+2}</span><label>種類<select data-layer-index="${index}" data-layer-field="kind" aria-label="比較対象 ${index+2} の種類"><option value="chord" ${layer.kind==='chord'?'selected':''}>コード</option><option value="scale" ${layer.kind==='scale'?'selected':''}>スケール</option></select></label><label>ルート<select data-layer-index="${index}" data-layer-field="root" aria-label="比較対象 ${index+2} のルート">${T.roots.map(root=>`<option value="${root}" ${root===layer.root?'selected':''}>${root}</option>`).join('')}</select></label><label>コード・スケール<select data-layer-index="${index}" data-layer-field="pattern" aria-label="比較対象 ${index+2} のコード・スケール">${options(layer.kind==='chord'?T.chords:T.scales)}</select></label><button type="button" class="remove-layer" data-remove-layer="${index}" aria-label="比較対象 ${index+2} を削除">削除</button></div>`).join('');
  settings.studyLayers.forEach((layer,index)=>{$<HTMLSelectElement>(`#comparison-layers [data-layer-index="${index}"][data-layer-field="pattern"]`).value=layer.pattern;});
  if(focusField)$('#comparison-layers').querySelector<HTMLElement>(`[data-layer-index="${focusIndex}"][data-layer-field="${focusField}"]`)?.focus({preventScroll:true});
  $<HTMLButtonElement>('#add-layer').disabled=settings.studyLayers.length>=3;
  $('#add-layer').textContent=settings.studyLayers.length>=3?'最大4つまで比較できます':'＋ 比較対象を追加';
  $('#tone-list').innerHTML=multiple?layers.map(layer=>`<div class="layer-summary layer-${layer.index}"><div class="layer-heading"><span class="layer-tag">${layer.index+1}</span><strong>${layer.root} ${layer.pattern.label}</strong></div><div class="layer-tones">${layer.tones.map(t=>`<span>${t.name}<small>${t.degree}</small></span>`).join('')}</div></div>`).join(''):T.tones(settings).map(t=>`<span class="tone-chip ${t.degree==='R'?'root-chip':''}"><span>${t.name}</span><small>${t.degree}</small></span>`).join('');
  // Avoid notes are a context-dependent guide for the scale, shown beside its description, never as marks of error.
  const avoid=isChord?'':describeAvoid(settings.studyRoot,pattern.id,training?advancedOptions(training.current):undefined);
  $('#pattern-description').textContent=[pattern.description,avoid?`アヴォイド（文脈に依存するガイド）：${avoid}`:''].filter(Boolean).join(' ');
  $('#pattern-description').hidden=multiple||!$('#pattern-description').textContent;
  $('#notation-example').textContent='コード・スケール表示では、ルートと度数に沿った表記を使います。';
 }
 function switchInstrument(kind: string|undefined,count: string|number=bassCount){
  const nextBass=kind==='bass',nextCount=Number(count)===5?5:4;
  if(isBass===nextBass&&(!nextBass||C.stringCount===nextCount))return;
  endFocus();
  const fallback={...settings,strings:isBass!==nextBass||settings.strings.length===C.stringCount?undefined:settings.strings};
  save();isBass=nextBass;bassCount=nextCount;
  
  STORAGE=(isBass?'bass'+bassCount:'guitar') as ProfileId;
  tuningConfig=repository.current.instruments[STORAGE];
  C=Core.create(resolveInstrument(STORAGE,tuningConfig));
  const saved=repository.current.profiles[STORAGE];
  settings={...C.normalize(saved||fallback),...T.normalize(saved||fallback)};
  updateInstrument();save();reset();
  history.replaceState(null,'','#'+(isBass?'bass'+bassCount:'guitar'));
 }
 function updateInstrument(){
  document.body.dataset.instrument=C.instrument;
  document.title=`Fret Notes for ${isBass?'Bass':'Guitar'}`;
  $$('[data-instrument-switch]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.instrumentSwitch===C.instrument&&(!isBass||Number(button.dataset.stringCount)===C.stringCount))));
  
  document.body.style.setProperty('--string-count',String(C.stringCount));
  const tuningNotes=document.createElement('span');tuningNotes.textContent=C.openNames.slice().reverse().join(' ');
  $('.tuning').replaceChildren(document.createTextNode(C.tuning.name+' '),tuningNotes);
  tuningView.render(STORAGE,tuningConfig);
  onInstrumentChange(C);
  $('#board').setAttribute('aria-label',`${isBass?'ベース':'ギター'}指板 ${C.stringCount}弦 0〜12フレット`);
  $('#string-direction').textContent=`上：1弦 · 下：${C.stringCount}弦`;
  $('#shapes-guide').textContent=`左から${C.stringCount}弦→1弦。○＝開放弦、×＝弾かない弦。丸の中は度数（R＝ルート）です。`;
 }
 function buildControls(){
  buildStudyControls();
  updateInstrument();
  $$('[data-instrument-switch]').forEach(button=>button.addEventListener('click',()=>switchInstrument(button.dataset.instrumentSwitch,button.dataset.stringCount||bassCount)));
  window.addEventListener('hashchange',()=>{const hash=location.hash.slice(1);if(hash==='guitar')switchInstrument('guitar');else if(['bass','bass4','bass5'].includes(hash))switchInstrument('bass',hash==='bass'?bassCount:Number(hash.slice(-1)));});
  $('#highlight-range').addEventListener('change',e=>{settings.highlightRange=inputTarget(e).checked;save();render();});
  $('#show-tuning').addEventListener('change',e=>{settings.showTuning=inputTarget(e).checked;save();render();});
  $$<HTMLInputElement>('input[name=notation]').forEach(el=>el.addEventListener('change',()=>{settings.notation=el.value as Notation;save();render();}));
  $$('#study-panel .mode[data-mode]').forEach(el=>el.addEventListener('click',()=>{if(settings.mode===el.dataset.mode&&!focus)return;endFocus();settings.mode=el.dataset.mode as PracticeMode;save();reset();$('.practice').scrollTop=0;$('#settings').scrollTop=0;}));
  $$<HTMLInputElement>('input[name=answer-method]').forEach(el=>el.addEventListener('change',()=>{method=el.value as AnswerMethod;if(focus)focus.method=method;training?.updatePreferences('study',{...studyPrefs(),forwardMethod:method});questionKey='';syncPractice();}));
  $('#study-weighted').addEventListener('change',e=>{weighted=inputTarget(e).checked;training?.updatePreferences('study',{...studyPrefs(),weighted});reset();});
  $('#study-focus-end').addEventListener('click',()=>{endFocus();reset();});
  const settingsToggle=$('#settings-toggle');
  settingsToggle.addEventListener('click',()=>{const show=$('#settings').classList.toggle('is-open');settingsToggle.setAttribute('aria-expanded',String(show));});
  document.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&$('#settings').classList.contains('is-open')){
    $('#settings').classList.remove('is-open');settingsToggle.setAttribute('aria-expanded','false');settingsToggle.focus();
   }
  });
  $('#primary').addEventListener('click',primary);
 }
 const boardView=new Fretboard($('#board'),$('.board-shell'),position=>{if(settings.mode==='study'){inspected=position;cursor=position;renderBoard();renderInspection();}else if(settings.mode==='find-all')toggleFind(position);else answer(position);});
 function renderBoard(){boardView.render({core:C,settings,target:current(),revealed,chosen,cursor,inspected,findAll:settings.mode==='find-all'?{selected:new Set(findAll.selected.keys()),result:findAll.result}:null});}
 function render(){
  const target=current(),study=settings.mode==='study',reverse=settings.mode==='reverse',count=deck.length;
  document.body.classList.toggle('study',study);
  document.body.classList.toggle('answered',revealed&&!study);
  document.body.classList.toggle('reverse',reverse);
  $$('#study-panel .mode[data-mode]').forEach(el=>{const on=el.dataset.mode===settings.mode;el.classList.toggle('active',on);el.setAttribute('aria-pressed',String(on));});
  rangeView.render(C.stringCount,isBass,settings);
  $<HTMLInputElement>('#highlight-range').checked=settings.highlightRange;
  $<HTMLInputElement>('#show-tuning').checked=settings.showTuning;
  $('.tuning').hidden=!study&&!settings.showTuning;
  $$<HTMLInputElement>('input[name=notation]').forEach(el=>el.checked=el.value===settings.notation);
  $('#notation-example').textContent='例：'+({both:'C♯ / D♭',sharp:'C♯',flat:'D♭'}[settings.notation]);
  $('#candidate-count').textContent=count+'か所';
  const stringText=settings.strings.length===C.stringCount?'全弦':settings.strings.slice().sort((a,b)=>b-a).join('・')+'弦';
  const fretText=settings.frets.length===13?'0〜12F':settings.frets.join('・')+'F';
  $('#scope-summary').textContent=study?`全弦 ／ 0〜${C.fretCount}F`:count?`${stringText} ／ ${fretText}${settings.naturalOnly?' ／ ナチュラル音のみ':''} ／ ${count}か所`:'出題対象なし：範囲や音名の条件を変更してください';
  $('#mode-label').textContent=study?'音名のつながりを確認する':reverse?'音名から位置を見つける':'位置から音名を思い出す';
  $('#progress-label').textContent=study?'リファレンス':count?`${round}周目 · ${index+1} / ${count}`:'0 / 0';
  $('#progress-fill').style.width=study?'100%':count?`${(index+1)/count*100}%`:'0%';
  $('#question-kicker').textContent=study?'FRETBOARD MAP':reverse?'FIND THE NOTE':'NAME THE NOTE';
  $('#question').textContent=study?'指板リファレンス':!target?'出題範囲を設定':reverse?`${target.string}弦の ${C.name(target,settings.notation)}`:'この位置の音名は？';
  $('#question-help').textContent=study?'すべての音名を表示。位置を選ぶと詳細を確認できます。':!target?'弦・フレットを選ぶか、音名の条件を変更してください。':reverse?(revealed?(chosen&&C.isCorrect(target,chosen,settings)?'正解。指板を選択して次へ。':'緑の位置が正解。指板を選択して次へ。'):'指板の位置を選択して回答してください。'):(revealed?`正解：${C.name(target,settings.notation)}`:'青いマーカーの音名を確認してください。');
  $('#board-legend').textContent=study?'全音名':reverse?(revealed?'正解位置':'指板を選択'):'出題位置';
  $('#shuffle-label').textContent=study?`${C.tuning.name} / 0〜${C.fretCount}F`:'一巡するまで、重複なし';
  const answerArea=$('#answer-area');
  if(!target){answerArea.innerHTML='<span class="answer-placeholder">出題対象がありません</span>';}
  else if(!revealed){answerArea.innerHTML=`<span class="answer-placeholder">${reverse?'選択後に正解を確認できます':'答えは、準備ができたら。'}</span>`;}
  else{
   const matches=C.candidates(settings).filter(p=>C.isCorrect(target,p,settings)).map(p=>`${p.fret}F`).join('・');
   const correct=chosen&&C.isCorrect(target,chosen,settings);
   const title=reverse?(chosen?(correct?'正解！':'正解はこちら'):'正解の位置'):C.name(target,settings.notation);
   const detail=reverse?`${target.string}弦 ${matches}：${C.name(target,settings.notation)}${chosen&&!correct?` ／ 選んだ位置は ${chosen.string}弦 ${chosen.fret}F（${C.name(chosen,settings.notation)}）`:''}`:`${target.string}弦 · ${target.fret}フレット${target.fret===0?'（開放弦）':''}`;
   const yours=!reverse&&named?`<span class="answer-yours ${named.result==='wrong'?'is-wrong':'is-right'}">あなたの回答：${named.name}　${{correct:'正解',spelling:'正解（一般的な綴りは '+C.name(target,settings.notation)+'）',wrong:'不正解'}[named.result as 'correct'|'spelling'|'wrong']}</span>`:'';
   answerArea.innerHTML=`<span class="answer-main">${title}</span><span class="answer-detail">${detail}</span>${yours}`;
  }
  $<HTMLButtonElement>('#primary').disabled=!target;
  const asking=settings.mode==='forward'&&method!=='self'&&!revealed&&!!target;
  $('#primary').innerHTML=revealed?'次の問題 <span aria-hidden="true">→</span>':reverse?'押弦後に答えを表示 <span aria-hidden="true">↵</span>':asking?'答えを見る（スキップ） <span aria-hidden="true">↵</span>':'答えを表示 <span aria-hidden="true">↵</span>';
  $('.keyboard-hint').innerHTML=reverse?'<kbd>↑↓←→</kbd> 移動 <kbd>Enter</kbd> 回答 ／ <kbd>Space</kbd> 表示・次へ':asking?(method==='choice'?'<kbd>1</kbd>〜<kbd>4</kbd> 回答 ／ <kbd>Space</kbd> スキップ':'<kbd>A</kbd>〜<kbd>G</kbd> <kbd>↑↓</kbd> <kbd>Enter</kbd> 回答 ／ <kbd>Space</kbd> スキップ'):'<kbd>Space</kbd> で表示・次へ';
  if(asking){if(method==='choice')answerInput.showChoices(choices.map(pc=>({value:pitchClassLabel(pc,'sharp'),label:pitchClassLabel(pc,settings.notation)})));else if(`${questionKey}:${method}`!==answerInputKey)answerInput.showEntry();answerInputKey=`${questionKey}:${method}`;$('#question-help').textContent=method==='choice'?'選択肢から音名を選んでください。':'音名を入力してください（♯・♭どちらの綴りでも正解）。';}
  else{answerInput.hide();answerInputKey='';}
  $('#answer-method-settings').hidden=settings.mode!=='forward';
  $('#study-weighted-settings').hidden=!training||(settings.mode!=='forward'&&settings.mode!=='reverse');$<HTMLInputElement>('#study-weighted').checked=weighted;
  // The range is set for the focus and not saved, so it cannot be changed until the focus ends.
  $('#study-range').hidden=!!focus;
  $('#study-focus').hidden=!focus;$('#study-focus-text').textContent=focus?`苦手を練習中：${focus.label}（${focus.keys.size}か所）。範囲とモードは保存しません`:'';
  $$<HTMLInputElement>('input[name=answer-method]').forEach(el=>el.checked=el.value===method);
  const recent=times.length?`反応 平均 ${(times.reduce((a,b)=>a+b,0)/times.length/1000).toFixed(1)}秒 · 中央値 ${(median(times)/1000).toFixed(1)}秒（${times.length}問）`:'';
  $('#response-summary').textContent=study?'':recent;
  if(settings.mode==='find-all')renderFindAll();
  renderStudy();
  renderBoard();
  renderInspection();
  if(target&&!study&&settings.mode!=='find-all'){const f=reverse?firstOnString(target.string).fret:target.fret;const el=$(`[data-position="${target.string}:${f}"]`);if(el&&!revealed&&!cursor){const shell=$('.board-shell');const left=el.offsetLeft-$('#board').offsetLeft;shell.scrollLeft=Math.max(0,left-shell.clientWidth/2+el.clientWidth/2);}}
 }
 /** Find-all overrides the question texts that render() set for the position quizzes. */
 function renderFindAll(){
  const pc=findAll.current(),result=findAll.result,total=findAll.answers().length;
  document.body.classList.toggle('answered',!!result);
  $('#mode-label').textContent='ある音名のすべての位置を見つける';
  $('#progress-label').textContent=pc===null?'0 / 0':`${findAll.round}周目 · ${findAll.index+1} / ${findAll.deck.length}`;
  $('#progress-fill').style.width=pc===null?'0%':`${(findAll.index+1)/findAll.deck.length*100}%`;
  $('#question-kicker').textContent='FIND EVERY NOTE';
  $('#question').textContent=pc===null?'出題範囲を設定':`範囲内のすべての ${pitchClassLabel(pc,settings.notation)} を選択`;
  renderFindHelp();
  $('#board-legend').textContent=result?'緑：正解 ／ 橙：誤り ／ 点線：見落とし':'選択した位置';
  $('#shuffle-label').textContent='音名ごとに一巡するまで、重複なし';
  $('#answer-area').innerHTML=pc===null?'<span class="answer-placeholder">出題対象がありません</span>':result?`<span class="answer-main">${result.correct?'正解！':`${result.found.length} / ${total}`}</span><span class="answer-detail">${pitchClassLabel(pc,settings.notation)}：範囲内に ${total}か所${result.correct?'。すべて見つけました':`。見落とし ${result.missed.length}か所 ／ 誤り ${result.wrong.length}か所`}</span>`:'';
  $<HTMLButtonElement>('#primary').disabled=pc===null;
  $('#primary').innerHTML=result?'次の問題 <span aria-hidden="true">→</span>':'採点する <span aria-hidden="true">↵</span>';
  $('.keyboard-hint').innerHTML='<kbd>↑↓←→</kbd> 移動 <kbd>Enter</kbd> 選択 ／ <kbd>Space</kbd> 採点・次へ';
 }
 function renderFindHelp(){if(settings.mode==='find-all'&&!findAll.result)$('#question-help').textContent=`該当する位置をすべて選び、Space で採点します（選択中 ${findAll.selected.size}か所）。もう一度選ぶと解除します。`;}
 document.addEventListener('keydown',e=>{
  if($('#study-panel').hidden)return;
  if(e.repeat)return;
  const el=e.target as HTMLElement;if(el.closest('#settings,.modes,.instrument-bar,.feature-tabs,#settings-toggle,#chord-shapes')||el.matches('input,select,textarea,[contenteditable=true]'))return;
  if(settings.mode==='study'){
   if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&el.dataset.position){
    e.preventDefault();const [string,fret]=el.dataset.position.split(':').map(Number);
    cursor={string:Math.max(1,Math.min(C.stringCount,string+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0))),fret:Math.max(0,Math.min(12,fret+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)))};
    $$('#board .cell').forEach(x=>x.tabIndex=-1);const cell=$<HTMLElement>(`[data-position="${C.key(cursor!)}"]`);cell.tabIndex=0;cell.focus();
   }
   return;
  }
  if(!current())return;
  if(settings.mode==='forward'&&method!=='self'&&!revealed&&e.code!=='Space'&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&answerInput.key(e.key)){e.preventDefault();return;}
  if(e.code==='Space'){e.preventDefault();primary();return;}
  if(settings.mode==='find-all'){
   if(findAll.result)return;
   if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
    e.preventDefault();
    const from=el.dataset.position?el.dataset.position.split(':').map(Number):null;
    cursor=C.movePosition(settings,from?{string:from[0],fret:from[1]}:cursor,e.key);
    $$('#board .cell').forEach(x=>x.tabIndex=-1);const b=$(`[data-position="${C.key(cursor!)}"]`);b.tabIndex=0;b.focus();
   }else if(e.key==='Enter'&&el.dataset.position){e.preventDefault();const [string,fret]=el.dataset.position.split(':').map(Number);toggleFind({string,fret});}
   return;
  }
  if(settings.mode!=='reverse'||revealed)return;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
   e.preventDefault();
   const from=el.dataset.position?el.dataset.position.split(':').map(Number):null;
   cursor=from?{string:from[0],fret:from[1]}:cursor||firstOnString(current().string);
   cursor=C.movePosition(settings,cursor,e.key);
   $$('#board .cell').forEach(x=>x.tabIndex=-1);const b=$(`[data-position="${C.key(cursor!)}"]`);b.tabIndex=0;b.focus();
  }else if(e.key==='Enter'&&el.dataset.position){e.preventDefault();const [string,fret]=el.dataset.position.split(':').map(Number);answer({string,fret});}
 });
 buildControls();reset();save();
 return {
  /** Practise only the given positions: naming them (knowledge) or finding them (fretboard), on the whole board. */
  focus(target: Focus){
   const keys=new Set((target.itemIds??[]).flatMap(id=>{const p=id.split(':');return p[0]==='fb'&&p[1]===STORAGE?[`${p[2]}:${p[3]}`]:[];}));
   if(!keys.size)return;
   endFocus();
   focus={keys,label:target.label,restore:{mode:settings.mode,strings:settings.strings,frets:settings.frets,naturalOnly:settings.naturalOnly},method};
   Object.assign(settings,{mode:target.layer==='fretboard'?'reverse':'forward',strings:Array.from({length:C.stringCount},(_,i)=>i+1),frets:Array.from({length:C.fretCount+1},(_,i)=>i),naturalOnly:false});
   if(settings.mode==='forward'&&method==='self')method='choice';
   reset();
  },
 };

}
