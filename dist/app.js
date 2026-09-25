(() => {
 'use strict';
 const T=window.FretTheory,C=window.FretCore,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const STORAGE='fret-notes-settings-v1',dots=[3,5,7,9,12];
 let stored;try{stored=JSON.parse(localStorage.getItem(STORAGE)||'null');}catch{}
 let settings={...C.normalize(stored),...T.normalize(stored)},deck=[],index=0,round=1,revealed=false,chosen=null,cursor=null;
 const current=()=>deck[index]||null;
 const allowed=p=>C.allowed(p,settings);
 const firstOnString=string=>C.candidates(settings).find(p=>p.string===string);
 function save(){try{localStorage.setItem(STORAGE,JSON.stringify(settings));$('#save-status').textContent='設定はこのブラウザーに自動保存';}catch{$('#save-status').textContent='このブラウザーでは設定を保存できません';}}
 function reset(){deck=C.shuffled(C.candidates(settings));index=0;round=1;revealed=false;chosen=null;cursor=null;render();}
 function next(){if(!current())return;if(index+1<deck.length)index++;else{deck=C.shuffled(C.candidates(settings),current());index=0;round++;}revealed=false;chosen=null;cursor=null;render();}
 function reveal(){if(!current()||settings.mode==='study')return;revealed=true;render();}
 function primary(){if(revealed)next();else reveal();}
 function answer(p){if(settings.mode!=='reverse'||!current())return;if(revealed){next();return;}if(!allowed(p))return;chosen=p;revealed=true;render();}
 function changeScope(){save();reset();}
 function noteHTML(p,tone=null){if(tone){if(settings.toneLabels==='degree')return tone.degree;if(settings.toneLabels==='name')return tone.name;return `${tone.name}<small>${tone.degree}</small>`;}const n=C.name(p,settings.notation).split(' / ');return n.length===1?n[0]:`${n[0]}<small>${n[1]}</small>`;}
 function options(catalog){const groups=[...new Set(catalog.map(p=>p.group))];return groups.map(group=>`<optgroup label="${group}">${catalog.filter(p=>p.group===group).map(p=>`<option value="${p.id}">${p.label}</option>`).join('')}</optgroup>`).join('');}
 function buildStudyControls(){
  $('#study-root').innerHTML=T.roots.map(note=>`<option value="${note}">${note}</option>`).join('');
  $$('[data-study-view]').forEach(button=>button.addEventListener('click',()=>{settings.studyView=button.dataset.studyView;save();render();}));
  $('#study-root').addEventListener('change',e=>{settings.studyRoot=e.target.value;save();render();});
  $('#study-pattern').addEventListener('change',e=>{settings[settings.studyView==='chord'?'studyChord':'studyScale']=e.target.value;save();render();});
  $('#tone-labels').addEventListener('change',e=>{settings.toneLabels=e.target.value;save();render();});
  $('#add-layer').addEventListener('click',()=>{
   if(settings.studyLayers.length>=3)return;
   const kind=settings.studyView,pattern=kind==='chord'?(settings.studyChord==='min7'?'maj7':'min7'):(settings.studyScale==='minor-pentatonic'?'dorian':'minor-pentatonic');
   settings.studyLayers.push({kind,root:settings.studyRoot,pattern});save();render();
  });
  $('#comparison-layers').addEventListener('change',e=>{
   const field=e.target.dataset.layerField,index=Number(e.target.dataset.layerIndex),layer=settings.studyLayers[index];if(!layer||!['kind','root','pattern'].includes(field))return;
   layer[field]=e.target.value;
   if(field==='kind')layer.pattern=layer.kind==='chord'?'major':'ionian';
   settings.studyLayers=T.normalize(settings).studyLayers;save();render();
  });
  $('#comparison-layers').addEventListener('click',e=>{
   const button=e.target.closest('[data-remove-layer]');if(!button)return;
   settings.studyLayers.splice(Number(button.dataset.removeLayer),1);save();render();
  });
 }
 function renderStudy(){
  const study=settings.mode==='study',pattern=T.selected(settings),layers=T.layers(settings),multiple=layers.length>1;
  $('#study-tools').hidden=!study;
  $('#theory-controls').hidden=!pattern;
  $('#theory-summary').hidden=!pattern;
  $('#comparison-layers').hidden=!pattern||!settings.studyLayers.length;
  $('#add-layer').hidden=!pattern;
  $$('[data-study-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.studyView===settings.studyView)));
  if(!study||!pattern)return;
  const isChord=settings.studyView==='chord';
  const title=isChord?settings.studyRoot+pattern.suffix:settings.studyRoot+' '+pattern.label;
  $('#question').textContent=title;
  $('#question-kicker').textContent=isChord?'CHORD TONES':'SCALE MAP';
  $('#question-help').textContent=`${multiple?'音名の下の色の目印で、共通音とそれぞれの音を比較できます。':'構成音の全位置を表示。'}${settings.highlightRange?'練習範囲外は暗く表示しています。':'範囲の色分けはOFFです。'}`;
  $('#mode-label').textContent=isChord?'コードの構成音を確認する':'スケールの構成音を確認する';
  $('#board-legend').textContent=multiple?'色の目印＝各比較対象の構成音':'R：ルート（黄緑）／ 構成音（青）';
  $('#study-root').value=settings.studyRoot;
  $('#tone-labels').value=settings.toneLabels;
  $('#tone-labels').closest('label').hidden=multiple;
  $('#pattern-label').textContent=isChord?'コード':'スケール';
  const catalog=isChord?T.chords:T.scales;
  $('#study-pattern').innerHTML=options(catalog);
  $('#study-pattern').value=pattern.id;
  const focus=document.activeElement?.dataset,focusField=focus?.layerField,focusIndex=focus?.layerIndex;
  $('#comparison-layers').innerHTML=settings.studyLayers.map((layer,index)=>`<div class="comparison-row layer-${index+1}"><span class="layer-tag">${index+2}</span><label>種類<select data-layer-index="${index}" data-layer-field="kind" aria-label="比較対象 ${index+2} の種類"><option value="chord" ${layer.kind==='chord'?'selected':''}>コード</option><option value="scale" ${layer.kind==='scale'?'selected':''}>スケール</option></select></label><label>ルート<select data-layer-index="${index}" data-layer-field="root" aria-label="比較対象 ${index+2} のルート">${T.roots.map(root=>`<option value="${root}" ${root===layer.root?'selected':''}>${root}</option>`).join('')}</select></label><label>コード・スケール<select data-layer-index="${index}" data-layer-field="pattern" aria-label="比較対象 ${index+2} のコード・スケール">${options(layer.kind==='chord'?T.chords:T.scales)}</select></label><button type="button" class="remove-layer" data-remove-layer="${index}" aria-label="比較対象 ${index+2} を削除">削除</button></div>`).join('');
  settings.studyLayers.forEach((layer,index)=>{$(`#comparison-layers [data-layer-index="${index}"][data-layer-field="pattern"]`).value=layer.pattern;});
  if(focusField)$('#comparison-layers').querySelector(`[data-layer-index="${focusIndex}"][data-layer-field="${focusField}"]`)?.focus({preventScroll:true});
  $('#add-layer').disabled=settings.studyLayers.length>=3;
  $('#add-layer').textContent=settings.studyLayers.length>=3?'最大4つまで比較できます':'＋ 比較対象を追加';
  $('#tone-list').innerHTML=multiple?layers.map(layer=>`<div class="layer-summary layer-${layer.index}"><div class="layer-heading"><span class="layer-tag">${layer.index+1}</span><strong>${layer.root} ${layer.pattern.label}</strong></div><div class="layer-tones">${layer.tones.map(t=>`<span>${t.name}<small>${t.degree}</small></span>`).join('')}</div></div>`).join(''):T.tones(settings).map(t=>`<span class="tone-chip ${t.degree==='R'?'root-chip':''}"><span>${t.name}</span><small>${t.degree}</small></span>`).join('');
  $('#pattern-description').textContent=pattern.description;
  $('#pattern-description').hidden=multiple||!pattern.description;
  $('#notation-example').textContent='コード・スケール表示では、ルートと度数に沿った表記を使います。';
 }
 function buildControls(){
  buildStudyControls();
  $('#string-options').innerHTML=[6,5,4,3,2,1].map(n=>`<label class="choice"><input type="checkbox" data-string="${n}" aria-label="${n}弦"><span>${n}</span></label>`).join('');
  $('#fret-options').innerHTML=Array.from({length:13},(_,n)=>`<label class="choice ${dots.includes(n)?'dot-fret':''}"><input type="checkbox" data-fret="${n}" aria-label="${n}フレット"><span>${n}</span></label>`).join('');
  $$('#string-options input').forEach(el=>el.addEventListener('change',()=>{settings.strings=$$('#string-options input:checked').map(x=>Number(x.dataset.string)).sort((a,b)=>a-b);changeScope();}));
  $$('#fret-options input').forEach(el=>el.addEventListener('change',()=>{settings.frets=$$('#fret-options input:checked').map(x=>Number(x.dataset.fret));changeScope();}));
  $$('#string-presets button').forEach(el=>el.addEventListener('click',()=>{settings.strings=el.dataset.strings.split(',').map(Number);changeScope();}));
  $$('#fret-presets button').forEach(el=>el.addEventListener('click',()=>{const sets={all:Array.from({length:13},(_,i)=>i),dots:[3,5,7,9,12],low:[0,1,2,3,4,5],mid:[5,6,7,8,9],high:[9,10,11,12]};settings.frets=sets[el.dataset.frets].slice();changeScope();}));
  $('#highlight-range').addEventListener('change',e=>{settings.highlightRange=e.target.checked;save();render();});
  $('#show-tuning').addEventListener('change',e=>{settings.showTuning=e.target.checked;save();render();});
  $('#natural-only').addEventListener('change',e=>{settings.naturalOnly=e.target.checked;changeScope();});
  $('#open-strings').addEventListener('change',e=>{settings.frets=settings.frets.filter(n=>n!==0);if(e.target.checked)settings.frets.unshift(0);changeScope();});
  $$('input[name=notation]').forEach(el=>el.addEventListener('change',()=>{settings.notation=el.value;save();render();}));
  $$('.mode').forEach(el=>el.addEventListener('click',()=>{if(settings.mode===el.dataset.mode)return;settings.mode=el.dataset.mode;save();reset();}));
  $('#settings-toggle').addEventListener('click',()=>{const show=$('#settings').classList.toggle('is-open');$('#settings-toggle').setAttribute('aria-expanded',String(show));});
  $('#primary').addEventListener('click',primary);
 }
 function renderBoard(){
  const board=$('#board'),scroll=$('.board-shell').scrollLeft,focused=document.activeElement?.dataset?.position;const target=current(),pattern=settings.mode==='study'?T.selected(settings):null,layers=pattern?T.layers(settings):[],multiple=layers.length>1,toneMap=new Map(T.tones(settings).map(t=>[t.pitch,t]));let html='<div></div>';
  for(let f=0;f<=12;f++)html+=`<div class="fret-label ${dots.includes(f)?'marked':''}">${f===0?'0 開放':f}</div>`;
  const openNames=['E','B','G','D','A','E'];
  for(let s=1;s<=6;s++){
   html+=`<div class="string-label">${s}${settings.showTuning?`<strong>${openNames[s-1]}</strong>`:''}</div>`;
   for(let f=0;f<=12;f++){
    const p={string:s,fret:f},active=allowed(p),istarget=target&&C.key(target)===C.key(p),study=settings.mode==='study',reverse=settings.mode==='reverse';
    const correct=reverse&&revealed&&C.isCorrect(target,p,settings),wrong=reverse&&revealed&&chosen&&C.key(chosen)===C.key(p)&&!correct;
    const showTarget=!study&&!reverse&&istarget;
    const matches=multiple?layers.map(layer=>({index:layer.index,tone:layer.tones.find(t=>t.pitch===C.pitch(p))})).filter(x=>x.tone):[];
    const tone=pattern?(toneMap.get(C.pitch(p))||matches[0]?.tone):null;
    const showName=(study&&(!pattern||!!tone))||(showTarget&&revealed)||correct||wrong;
    const noteClass=multiple&&matches.length?'study-combined':tone?(tone.degree==='R'?'study-root':'study-tone'):showTarget?'target'+(revealed?'':' blank'):correct?'correct':wrong?'wrong':'';
    let label=`${s}弦 ${f}フレット`;
    if(showName)label+=matches.length?` ${matches.map(x=>`${x.index+1}: ${x.tone.name} ${x.tone.degree}`).join('、')}`:tone?` ${tone.name} 度数 ${tone.degree}`:` ${C.name(p,settings.notation)}`;if(showTarget&&!revealed)label+=' 出題位置';
    if(correct)label+=' 正解';if(wrong)label+=' 選択した位置';
    const inlay=dots.includes(f)&&((f!==12&&s===3)||(f===12&&(s===2||s===4)));
    const clickable=reverse&&!!target&&(revealed||active);
    if(reverse&&revealed)label+=' 次の問題へ';
    const display=multiple&&matches.length?`<span class="combined-name">${tone.name}</span><span class="layer-marks">${matches.map(x=>`<i class="layer-mark layer-${x.index}" aria-hidden="true"></i>`).join('')}</span>`:noteHTML(p,tone);
    html+=`<button type="button" class="cell ${f===0?'open':''} ${!active&&settings.highlightRange?'outside':''} ${inlay?'inlay':''}" style="--string-size:${.6+s*.37}px" data-position="${s}:${f}" aria-label="${label}" ${clickable?'':'aria-disabled="true"'} tabindex="${clickable&&cursor&&C.key(cursor)===C.key(p)?0:-1}">${showName||showTarget?`<span class="note ${noteClass}">${showName?display:'?'}</span>`:''}</button>`;
   }
  }
  html+='<div></div>';for(let f=0;f<=12;f++)html+=`<div class="dot-row">${dots.includes(f)?'<i></i>':''}${f===12?'<i></i>':''}</div>`;
  board.innerHTML=html;
  if(settings.mode==='reverse'&&!revealed&&target){const first=board.querySelector(`[data-position="${C.key(firstOnString(target.string))}"]`);if(!cursor&&first)first.tabIndex=0;}
  board.querySelectorAll('[data-position]').forEach(el=>el.addEventListener('click',()=>{const [string,fret]=el.dataset.position.split(':').map(Number);answer({string,fret});}));
  $('.board-shell').scrollLeft=scroll;
  if(focused){if(revealed)$('#primary').focus({preventScroll:true});else board.querySelector(`[data-position="${focused}"]`)?.focus({preventScroll:true});}
 }
 function render(){
  const target=current(),study=settings.mode==='study',reverse=settings.mode==='reverse',count=deck.length;
  document.body.classList.toggle('study',study);
  $$('.mode').forEach(el=>{const on=el.dataset.mode===settings.mode;el.classList.toggle('active',on);el.setAttribute('aria-pressed',String(on));});
  $$('#string-options input').forEach(el=>el.checked=settings.strings.includes(Number(el.dataset.string)));
  $$('#fret-options input').forEach(el=>el.checked=settings.frets.includes(Number(el.dataset.fret)));
  $('#open-strings').checked=settings.frets.includes(0);
  $('#natural-only').checked=settings.naturalOnly;
  $('#highlight-range').checked=settings.highlightRange;
  $('#show-tuning').checked=settings.showTuning;
  $('.tuning').hidden=!settings.showTuning;
  $$('input[name=notation]').forEach(el=>el.checked=el.value===settings.notation);
  $('#notation-example').textContent='例：'+({both:'C♯ / D♭',sharp:'C♯',flat:'D♭'}[settings.notation]);
  $('#candidate-count').textContent=count+'か所';
  const stringText=settings.strings.length===6?'全弦':settings.strings.slice().sort((a,b)=>b-a).join('・')+'弦';
  const fretText=settings.frets.length===13?'0〜12F':settings.frets.join('・')+'F';
  $('#scope-summary').textContent=count?`${stringText} ／ ${fretText}${settings.naturalOnly?' ／ ナチュラル音のみ':''} ／ ${count}か所`:'出題対象なし：範囲や音名の条件を変更してください';
  $('#mode-label').textContent=study?'音名のつながりを確認する':reverse?'音名から位置を見つける':'位置から音名を思い出す';
  $('#progress-label').textContent=study?'REFERENCE':count?`${round}周目 · ${index+1} / ${count}`:'0 / 0';
  $('#progress-fill').style.width=study?'100%':count?`${(index+1)/count*100}%`:'0%';
  $('#question-kicker').textContent=study?'FRETBOARD MAP':reverse?'FIND THE NOTE':'NAME THE NOTE';
  $('#question').textContent=study?'音名を、見渡そう。':!target?'練習する範囲を選ぼう。':reverse?`${target.string}弦の ${C.name(target,settings.notation)} はどこ？`:'この位置の音名は？';
  $('#question-help').textContent=study?(settings.highlightRange?'選択中の範囲を明るく表示しています。':'すべての位置の音名を同じ明るさで表示しています。'):!target?'弦・フレットを選ぶか、ナチュラル音の条件を変更してください。':reverse?(revealed?'指板上のどこかをタップすると、次の問題へ進みます。':'指板上の位置をタップして回答。分からなければ答えを表示。'):'頭の中で思い浮かべてから、答えを表示。';
  $('#board-legend').textContent=study?(settings.highlightRange?'選択中の範囲':'全音名'):reverse?(revealed?'正解位置':'指板を選択'):'出題位置';
  $('#shuffle-label').textContent=study?'標準チューニング / 0〜12F':'一巡するまで、重複なし';
  const answerArea=$('#answer-area');
  if(!target){answerArea.innerHTML='<span class="answer-placeholder">出題対象がありません</span>';}
  else if(!revealed){answerArea.innerHTML=`<span class="answer-placeholder">${reverse?'選択後に正解を確認できます':'答えは、準備ができたら。'}</span>`;}
  else{
   const matches=C.candidates(settings).filter(p=>C.isCorrect(target,p,settings)).map(p=>`${p.fret}F`).join('・');
   const correct=chosen&&C.isCorrect(target,chosen,settings);
   const title=reverse?(chosen?(correct?'正解！':'正解を確認しよう'):'正解の位置'):C.name(target,settings.notation);
   const detail=reverse?`${target.string}弦 ${matches}：${C.name(target,settings.notation)}${chosen&&!correct?` ／ 選んだ位置は ${chosen.string}弦 ${chosen.fret}F（${C.name(chosen,settings.notation)}）`:''}`:`${target.string}弦 · ${target.fret}フレット${target.fret===0?'（開放弦）':''}`;
   answerArea.innerHTML=`<span class="answer-main">${title}</span><span class="answer-detail">${detail}</span>`;
  }
  $('#primary').disabled=!target;
  $('#primary').innerHTML=revealed?'次の問題 <span aria-hidden="true">→</span>':'答えを表示 <span aria-hidden="true">↵</span>';
  $('.keyboard-hint').innerHTML=reverse?'<kbd>↑↓←→</kbd> 移動 <kbd>Enter</kbd> 回答 ／ <kbd>Space</kbd> 表示・次へ':'<kbd>Space</kbd> で表示・次へ';
  renderStudy();
  renderBoard();
  if(target&&!study){const f=reverse?firstOnString(target.string).fret:target.fret;const el=$(`[data-position="${target.string}:${f}"]`);if(el&&!revealed&&!cursor){const shell=$('.board-shell');const left=el.offsetLeft-$('#board').offsetLeft;shell.scrollLeft=Math.max(0,left-shell.clientWidth/2+el.clientWidth/2);}}
 }
 document.addEventListener('keydown',e=>{
  if(e.repeat)return;
  const el=e.target;if(el.closest('#settings,.modes,#settings-toggle')||el.matches('input,select,textarea,[contenteditable=true]'))return;
  if(settings.mode==='study'||!current())return;
  if(e.code==='Space'){e.preventDefault();primary();return;}
  if(settings.mode!=='reverse'||revealed)return;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
   e.preventDefault();
   const from=el.dataset.position?el.dataset.position.split(':').map(Number):null;
   cursor=from?{string:from[0],fret:from[1]}:cursor||firstOnString(current().string);
   cursor=C.movePosition(settings,cursor,e.key);
   $$('#board .cell').forEach(x=>x.tabIndex=-1);const b=$(`[data-position="${C.key(cursor)}"]`);b.tabIndex=0;b.focus();
  }else if(e.key==='Enter'&&el.dataset.position){e.preventDefault();const [string,fret]=el.dataset.position.split(':').map(Number);answer({string,fret});}
 });
 buildControls();reset();
 // Optional browser tool support; the regular interface remains fully independent.
 const context=document.modelContext;
 if(context?.registerTool){const lifecycle=new AbortController();
  const state=()=>({mode:settings.mode,settings:{...settings},position:settings.mode==='forward'?current():undefined,question:$('#question').textContent,revealed,answer:revealed?$('#answer-area').textContent:null,progress:countProgress()});
  function countProgress(){return {round,index:deck.length?index+1:0,total:deck.length};}
  const tools=[
   {name:'read_practice_state',description:'Read the current guitar exercise, selected practice range, and visible answer.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>state()},
   {name:'reveal_practice_answer',description:'Reveal the answer to the current exercise, like pressing 答えを表示.',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:()=>{if(settings.mode==='study'||!current())throw new Error('No active quiz');reveal();return state();}},
   {name:'next_practice_question',description:'Move to the next exercise after the answer has been revealed.',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:()=>{if(!revealed||settings.mode==='study'||!current())throw new Error('Reveal the current answer first');next();return state();}}
  ];
  for(const tool of tools){const run=tool.execute;tool.execute=input=>{if(input===null||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('Expected an empty object');return run();};try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 }
})();
