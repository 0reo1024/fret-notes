(() => {
 'use strict';
 const C=window.FretCore,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const STORAGE='fret-notes-settings-v1',dots=[3,5,7,9,12];
 let stored;try{stored=JSON.parse(localStorage.getItem(STORAGE)||'null');}catch{}
 let settings=C.normalize(stored),deck=[],index=0,round=1,revealed=false,chosen=null,cursor=null;
 const current=()=>deck[index]||null;
 const allowed=p=>settings.strings.includes(p.string)&&settings.frets.includes(p.fret);
 function save(){try{localStorage.setItem(STORAGE,JSON.stringify(settings));$('#save-status').textContent='設定はこのブラウザーに自動保存';}catch{$('#save-status').textContent='このブラウザーでは設定を保存できません';}}
 function reset(){deck=C.shuffled(C.candidates(settings));index=0;round=1;revealed=false;chosen=null;cursor=null;render();}
 function next(){if(!current())return;if(index+1<deck.length)index++;else{deck=C.shuffled(C.candidates(settings),current());index=0;round++;}revealed=false;chosen=null;cursor=null;render();}
 function reveal(){if(!current()||settings.mode==='study')return;revealed=true;render();}
 function primary(){if(revealed)next();else reveal();}
 function answer(p){if(settings.mode!=='reverse'||revealed||!allowed(p))return;chosen=p;revealed=true;render();}
 function changeScope(){save();reset();}
 function noteHTML(p){const n=C.name(p,settings.notation).split(' / ');return n.length===1?n[0]:`${n[0]}<small>${n[1]}</small>`;}
 function buildControls(){
  $('#string-options').innerHTML=[6,5,4,3,2,1].map(n=>`<label class="choice"><input type="checkbox" data-string="${n}" aria-label="${n}弦"><span>${n}</span></label>`).join('');
  $('#fret-options').innerHTML=Array.from({length:13},(_,n)=>`<label class="choice ${dots.includes(n)?'dot-fret':''}"><input type="checkbox" data-fret="${n}" aria-label="${n}フレット"><span>${n}</span></label>`).join('');
  $$('#string-options input').forEach(el=>el.addEventListener('change',()=>{settings.strings=$$('#string-options input:checked').map(x=>Number(x.dataset.string)).sort((a,b)=>a-b);changeScope();}));
  $$('#fret-options input').forEach(el=>el.addEventListener('change',()=>{settings.frets=$$('#fret-options input:checked').map(x=>Number(x.dataset.fret));changeScope();}));
  $$('#string-presets button').forEach(el=>el.addEventListener('click',()=>{settings.strings=el.dataset.strings.split(',').map(Number);changeScope();}));
  $$('#fret-presets button').forEach(el=>el.addEventListener('click',()=>{const sets={all:Array.from({length:13},(_,i)=>i),dots:[3,5,7,9,12],low:[0,1,2,3,4,5],mid:[5,6,7,8,9],high:[9,10,11,12]};settings.frets=sets[el.dataset.frets].slice();changeScope();}));
  $('#open-strings').addEventListener('change',e=>{settings.frets=settings.frets.filter(n=>n!==0);if(e.target.checked)settings.frets.unshift(0);changeScope();});
  $$('input[name=notation]').forEach(el=>el.addEventListener('change',()=>{settings.notation=el.value;save();render();}));
  $$('.mode').forEach(el=>el.addEventListener('click',()=>{if(settings.mode===el.dataset.mode)return;settings.mode=el.dataset.mode;save();reset();}));
  $('#settings-toggle').addEventListener('click',()=>{const show=$('#settings').classList.toggle('is-open');$('#settings-toggle').setAttribute('aria-expanded',String(show));});
  $('#primary').addEventListener('click',primary);
 }
 function renderBoard(){
  const board=$('#board'),scroll=$('.board-shell').scrollLeft,focused=document.activeElement?.dataset?.position;const target=current();let html='<div></div>';
  for(let f=0;f<=12;f++)html+=`<div class="fret-label ${dots.includes(f)?'marked':''}">${f===0?'0 開放':f}</div>`;
  const openNames=['E','B','G','D','A','E'];
  for(let s=1;s<=6;s++){
   html+=`<div class="string-label">${s}<strong>${openNames[s-1]}</strong></div>`;
   for(let f=0;f<=12;f++){
    const p={string:s,fret:f},active=allowed(p),istarget=target&&C.key(target)===C.key(p),study=settings.mode==='study',reverse=settings.mode==='reverse';
    const correct=reverse&&revealed&&C.isCorrect(target,p,settings),wrong=reverse&&revealed&&chosen&&C.key(chosen)===C.key(p)&&!correct;
    const showTarget=!study&&!reverse&&istarget;
    const showName=study||(showTarget&&revealed)||correct||wrong;
    const noteClass=showTarget?'target'+(revealed?'':' blank'):correct?'correct':wrong?'wrong':'';
    let label=`${s}弦 ${f}フレット`;
    if(showName)label+=` ${C.name(p,settings.notation)}`;if(showTarget&&!revealed)label+=' 出題位置';
    if(correct)label+=' 正解';if(wrong)label+=' 選択した位置';
    const inlay=dots.includes(f)&&((f!==12&&s===3)||(f===12&&(s===2||s===4)));
    const clickable=reverse&&!revealed&&active;
    html+=`<button type="button" class="cell ${f===0?'open':''} ${active?'':'outside'} ${inlay?'inlay':''}" style="--string-size:${.6+s*.37}px" data-position="${s}:${f}" aria-label="${label}" ${clickable?'':'aria-disabled="true"'} tabindex="${clickable&&cursor&&C.key(cursor)===C.key(p)?0:-1}">${showName||showTarget?`<span class="note ${noteClass}">${showName?noteHTML(p):'?'}</span>`:''}</button>`;
   }
  }
  html+='<div></div>';for(let f=0;f<=12;f++)html+=`<div class="dot-row">${dots.includes(f)?'<i></i>':''}${f===12?'<i></i>':''}</div>`;
  board.innerHTML=html;
  if(settings.mode==='reverse'&&!revealed&&target){const first=board.querySelector(`[data-position="${target.string}:${Math.min(...settings.frets)}"]`);if(!cursor&&first)first.tabIndex=0;}
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
  $$('input[name=notation]').forEach(el=>el.checked=el.value===settings.notation);
  $('#notation-example').textContent='例：'+({both:'C♯ / D♭',sharp:'C♯',flat:'D♭'}[settings.notation]);
  $('#candidate-count').textContent=count+'か所';
  const stringText=settings.strings.length===6?'全弦':settings.strings.slice().sort((a,b)=>b-a).join('・')+'弦';
  const fretText=settings.frets.length===13?'0〜12F':settings.frets.join('・')+'F';
  $('#scope-summary').textContent=count?`${stringText} ／ ${fretText} ／ ${count}か所`:'弦とフレットを選択してください';
  $('#mode-label').textContent=study?'音名のつながりを確認する':reverse?'音名から位置を見つける':'位置から音名を思い出す';
  $('#progress-label').textContent=study?'REFERENCE':count?`${round}周目 · ${index+1} / ${count}`:'0 / 0';
  $('#progress-fill').style.width=study?'100%':count?`${(index+1)/count*100}%`:'0%';
  $('#question-kicker').textContent=study?'FRETBOARD MAP':reverse?'FIND THE NOTE':'NAME THE NOTE';
  $('#question').textContent=study?'音名を、見渡そう。':!target?'練習する範囲を選ぼう。':reverse?`${target.string}弦の ${C.name(target,settings.notation)} はどこ？`:'この位置の音名は？';
  $('#question-help').textContent=study?'選択中の範囲を明るく表示しています。':!target?'弦とフレットを、それぞれ1つ以上選んでください。':reverse?'指板上の位置をタップして回答。分からなければ答えを表示。':'頭の中で思い浮かべてから、答えを表示。';
  $('#board-legend').textContent=study?'選択中の範囲':reverse?(revealed?'正解位置':'指板を選択'):'出題位置';
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
  renderBoard();
  if(target&&!study){const f=reverse?Math.min(...settings.frets):target.fret;const el=$(`[data-position="${target.string}:${f}"]`);if(el&&!revealed&&!cursor){const shell=$('.board-shell');const left=el.offsetLeft-$('#board').offsetLeft;shell.scrollLeft=Math.max(0,left-shell.clientWidth/2+el.clientWidth/2);}}
 }
 document.addEventListener('keydown',e=>{
  if(e.repeat)return;
  const el=e.target;if(el.closest('#settings,.modes,#settings-toggle')||el.matches('input,select,textarea,[contenteditable=true]'))return;
  if(settings.mode==='study'||!current())return;
  if(e.code==='Space'){e.preventDefault();primary();return;}
  if(settings.mode!=='reverse'||revealed)return;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
   e.preventDefault();const fs=settings.frets.slice().sort((a,b)=>a-b),ss=settings.strings.slice().sort((a,b)=>a-b);
   const from=el.dataset.position?el.dataset.position.split(':').map(Number):null;
   cursor=from?{string:from[0],fret:from[1]}:cursor||{string:current().string,fret:fs[0]};
   if(e.key==='ArrowLeft')cursor.fret=fs[Math.max(0,fs.indexOf(cursor.fret)-1)];
   if(e.key==='ArrowRight')cursor.fret=fs[Math.min(fs.length-1,fs.indexOf(cursor.fret)+1)];
   if(e.key==='ArrowUp')cursor.string=ss[Math.max(0,ss.indexOf(cursor.string)-1)];
   if(e.key==='ArrowDown')cursor.string=ss[Math.min(ss.length-1,ss.indexOf(cursor.string)+1)];
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
