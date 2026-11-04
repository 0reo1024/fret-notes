import { $ } from '../../ui/dom';
import { create } from '../../domain/instruments/core';
import { resolveInstrument, type InstrumentProfile, type ProfileId } from '../../domain/instruments/profiles';
import { describePitch, frequencyForMidi } from '../../domain/tuner/pitch';
import { PerformanceSession, playTargets, type PlayResult, type PlayTarget } from '../../domain/practice/performance';
import { focusPositions, mergePlayPreferences, playPositionEntry, playPreferences, rankPositions, rankingDates, weakConstants, type FocusSelection, type PlayOutcome, type PlayPreferences } from '../../domain/practice/weak-positions';
import { hasPlayDay, localDate } from '../../domain/training/records';
import { targetsOf } from '../../domain/training/analysis';
import type { TrainingRepository } from '../../platform/training-store';
import type { AudioController, AudioObservation } from '../../platform/audio';
import type { PlaySettings, SettingsRepository } from '../../platform/settings';
import { mountRange } from '../settings/range';
import { mountTuning } from '../settings/tuning';
import { fretboardColumns, fretboardSurface } from '../../ui/fretboard-layout';

/** `refresh` re-renders the audio panel, whose start button depends on whether any target exists.
 * `onResult` receives each newly accepted answer once, for the practice record. */
export function mountPerformance(repository: SettingsRepository, controller: AudioController, initial: InstrumentProfile, refresh: ()=>void, onResult: (result: PlayResult, instrument: ProfileId)=>void = ()=>{}, training: TrainingRepository|null = null) {
  let id: ProfileId=initial.id, play: PlaySettings=repository.play(id), profile=resolveInstrument(id,play.tuning);
  let session: PerformanceSession|null=null, boardKey='', sessionKey='';
  let feedbackTimer: ReturnType<typeof setTimeout>|null=null;
  const tolerance=$<HTMLSelectElement>('#play-tolerance'), hold=$<HTMLSelectElement>('#play-hold'), octave=$<HTMLSelectElement>('#play-octave');
  const focusSwitch=$<HTMLInputElement>('#play-focus'), focusCount=$<HTMLSelectElement>('#play-focus-count');
  // Octave and weak-spot focus live in the training store so settings.json keeps its schema.
  const preferences=playPreferences(training?.preference('play'));
  octave.value=preferences.octave; focusSwitch.checked=preferences.focus; focusCount.value=String(preferences.focusCount);
  /** Saves one change on top of the stored choices, so the octave does not reset the focus and the other way round. */
  const savePreferences=(change: Partial<PlayPreferences>)=>training?.updatePreferences('play',mergePlayPreferences(training.preference('play'),change));
  const anyOctave=()=>octave.value==='any';
  /** Weak positions are per asked string, so the focus needs records and an exact octave. */
  const focusWanted=()=>!!training && focusSwitch.checked && !anyOctave();
  /** Chosen when a session is made and kept for its life: new answers must not change the questions or the session key. */
  let focusSelection: FocusSelection|null=null;
  // The ranking shows today unless another day is picked; `rankingKey` and `rankedData` skip rebuilding an unchanged table.
  let rankingDate: string|null=null, rankingAll=false, rankingKey='', rankedData: unknown=null;
  const targetMs=()=>targetsOf(training?.current.preferences ?? {}).play;
  const midiAt=(string: number,fret: number)=>string>=1 && string<=profile.strings.length && fret>=0 && fret<=profile.fretCount?create(profile).midi({string,fret}):null;
  tolerance.value=String(repository.current.playOptions.toleranceCents); hold.value=String(repository.current.playOptions.holdMs);
  const text=(id:string,value:string)=>{ const el=$(id); if(el.textContent!==value)el.textContent=value; };
  const range=()=>create(profile).normalize({...repository.current.profiles[id],...play});
  function selectFocus() {
    if(!training || !focusWanted())return null;
    return focusPositions(training.current.playPositions,{today:localDate(new Date()),instrument:id,midiAt,targetMs:targetMs(),count:Number(focusCount.value),
      playable:spot=>{const hz=frequencyForMidi(spot.midi,repository.current.audio.referenceHz);return hz>=25 && hz<=1500;}});
  }
  /** While no session exists the selection follows the records; once one is made it stays fixed. */
  function selection(){ if(!session)focusSelection=selectFocus(); return focusSelection; }
  /** With any octave, each position still sets the pitch class; every octave inside the practice range counts.
   * In focus, the weak positions are asked whatever the practice range is. */
  function targets() {
    const focus=selection(), keys=new Set(focus?.positions.map(p=>`${p.string}:${p.fret}`));
    const list=focus?playTargets(profile,create(profile).normalize({strings:profile.strings.map(s=>s.number)}),repository.current.audio.referenceHz).filter(t=>keys.has(`${t.string}:${t.fret}`))
      :playTargets(profile,range(),repository.current.audio.referenceHz);
    if(!anyOctave()||!list.length)return list;
    const register:[number,number]=[Math.min(...list.map(t=>t.midi)),Math.max(...list.map(t=>t.midi))];
    return list.map(t=>({...t,accept:{kind:'pitch-class' as const,pitchClasses:[t.midi%12],register}}));
  }
  function configurationKey(){const {strings,frets,naturalOnly}=range();return JSON.stringify([id,profile.tuning.openMidi,strings,frets,naturalOnly,repository.current.audio.referenceHz,octave.value,focusWanted(),focusCount.value,focusSelection]);}
  function refreshConfiguration(){if(session && sessionKey!==configurationKey()){abandonPending();session=null;void controller.stop();}}
  /** Adds one question to the per-position record; any-octave questions name no string, so they are left out. */
  function recordPosition(target: PlayTarget, outcome: PlayOutcome) {
    if(!training || target.accept?.kind==='pitch-class')return;
    const entry=playPositionEntry(target,outcome,id,localDate(new Date()),targetMs());
    if(entry)training.addPlayPosition(entry);
  }
  /** Records the open question before its session is dropped (finish, settings, instrument); a pause keeps it open. */
  function abandonPending() { const open=session?.pending(); if(open)recordPosition(open.target,{kind:'abandoned',listeningMs:open.listeningMs,wrongAttempts:open.wrongAttempts}); }
  function change(next: PlaySettings){
    abandonPending();play=next;profile=resolveInstrument(id,play.tuning);void repository.updatePlay(id,play);
    session=null;boardKey='';void controller.stop();renderSettings();
    if(targets().length)newSession();
    refresh();
  }
  const tuningView=mountTuning($('#play-tuning'),tuning=>change({...play,tuning}));
  const rangeView=mountRange($('#play-range-settings'),next=>change({...play,...next}));
  function renderSettings(){tuningView.render(id,play.tuning);rangeView.render(profile.strings.length,profile.instrument==='bass',play);}
  function newSession() {
      // The focus is chosen again here; with no records left (cleared after a focused run) there may be nothing to ask.
      session=null; const list=targets(); if(!list.length)return;
      session=new PerformanceSession(list,{toleranceCents:Number(tolerance.value),holdMs:Number(hold.value),referenceHz:repository.current.audio.referenceHz});
      sessionKey=configurationKey();
  }
  function prepare() {
    refreshConfiguration();
    if(!session || session.phase==='finished')newSession();
    render();
  }
  function pause() { session?.pause(); render(); }
  $('#play-pause').addEventListener('click',()=>{ pause(); void controller.stop(); });
  $('#play-finish').addEventListener('click',()=>{ abandonPending(); session?.finish(); void controller.stop(); render(); });
  /** Settings that change which questions are asked start a new run. */
  function restart(){abandonPending();session=null;void controller.stop();if(targets().length)prepare();else render();refresh();}
  octave.addEventListener('change',()=>{savePreferences({octave:anyOctave()?'any':'exact'});restart();});
  focusSwitch.addEventListener('change',()=>{savePreferences({focus:focusSwitch.checked});restart();});
  focusCount.addEventListener('change',()=>{savePreferences({focusCount:Number(focusCount.value)});restart();});
  for(const control of [tolerance,hold])control.addEventListener('change',()=>{void repository.updatePlayOptions({toleranceCents:Number(tolerance.value),holdMs:Number(hold.value)});abandonPending();session=null; if(targets().length)prepare();else render();});
  function renderBoard() {
    const key=`${profile.id}:${profile.tuning.openMidi.join(',')}`;
    if(key===boardKey)return; boardKey=key;
    const board=$('#play-board'); board.replaceChildren(); board.style.setProperty('--play-strings',String(profile.strings.length));
    board.style.setProperty('--fret-columns',fretboardColumns);
    board.append(...fretboardSurface(profile.strings.length),document.createElement('span'));
    for(let fret=0;fret<=12;fret++){const label=document.createElement('span'); label.className='play-fret-label';label.textContent=fret===0?'0 開放':String(fret);if(fret===0)label.setAttribute('title','開放弦の右側の太い線がナット');board.append(label);}
    for(const string of profile.strings){
      const label=document.createElement('span');label.className='play-string-label';label.textContent=`${string.number}弦`;board.append(label);
      for(let fret=0;fret<=12;fret++){
        const cell=document.createElement('span');cell.className=`play-cell${fret===0?' open':''}`;
        board.append(cell);
      }
    }
    board.setAttribute('aria-label',`${profile.displayName}指板 0〜12フレット。開放弦の右側の太い線がナット。押さえる位置は表示しません。`);
  }
  /** Focus controls, the line above the question, and the practice range locked while weak positions are asked. */
  function renderFocus(busy: boolean) {
    const focus=focusWanted()?selection():null;
    focusSwitch.disabled=busy || !training || anyOctave(); focusCount.disabled=focusSwitch.disabled || !focusSwitch.checked;
    text('#play-focus-note',anyOctave()?'オクターブ指定で使えます':!focusSwitch.checked?'':focus?'苦手集中中は出題範囲を使いません':'苦手の記録が足りないため、通常の範囲で出題しています');
    $('#play-focus-banner').hidden=!focus; text('#play-focus-banner',focus?`苦手集中：${focus.positions.length}か所（${focus.date} の記録から）`:'');
    $('#play-range-settings').querySelectorAll('fieldset').forEach(fieldset=>fieldset.disabled=!!focus);
  }
  let rankingNeighbours: {older?: string; newer?: string}={};
  /** The weak-spot table for the shown day; rebuilt only when the day, the instrument, the records or the display change. */
  function renderRanking() {
    $('#play-weak').hidden=!training; if(!training)return;
    const list=training.current.playPositions, today=localDate(new Date()), date=rankingDate??today, notation=range().notation;
    const key=JSON.stringify([today,date,id,profile.tuning.openMidi,notation,rankingAll,targetMs(),anyOctave()]);
    if(key===rankingKey && rankedData===list)return;
    rankingKey=key; rankedData=list;
    const scope={instrument:id,midiAt}, dates=rankingDates(list,scope), options=[...new Set([today,date,...dates])].sort().reverse();
    const select=$<HTMLSelectElement>('#play-weak-date');
    select.replaceChildren(...options.map(d=>{const option=document.createElement('option');option.value=d;option.textContent=d===today?`${d}（今日）`:d;return option;})); select.value=date;
    rankingNeighbours={older:options.find(d=>d<date),newer:options.slice().reverse().find(d=>d>date)};
    $<HTMLButtonElement>('#play-weak-prev').disabled=!rankingNeighbours.older; $<HTMLButtonElement>('#play-weak-next').disabled=!rankingNeighbours.newer; $<HTMLButtonElement>('#play-weak-today').disabled=date===today;
    const ranked=rankPositions(list,{...scope,date,targetMs:targetMs()}), core=create(profile), earlier=dates.some(d=>d<date);
    text('#play-weak-summary',ranked.length?`この日の記録：${ranked.length}か所・${ranked.reduce((n,r)=>n+r.asked,0)}問`:'');
    $('#play-weak-octave').hidden=!anyOctave();
    const trend=(previous: number|null,rank: number)=>!earlier?'—':previous===null?'新':previous>rank?`↑${previous-rank}`:previous<rank?`↓${rank-previous}`:'→';
    $('#play-weak-list').innerHTML=!ranked.length?'<p class="play-weak-empty">この日の記録はありません</p>'
      :`<table class="play-weak-table"><caption>${date} の苦手ランキング</caption><thead><tr><th scope="col">順位</th><th scope="col">位置</th><th scope="col">音名</th><th scope="col">苦手度（点）</th><th scope="col">間違えた回数</th><th scope="col" class="col-optional">平均解答時間</th><th scope="col">出題数</th><th scope="col" class="col-optional" title="前の記録日の順位との差">前回比</th></tr></thead><tbody>${
        (rankingAll?ranked:ranked.slice(0,10)).map((r,i)=>`<tr${r.weak?' class="is-weak"':''}><td>${i+1}</td><th scope="row">${r.string}弦 ${r.fret}F</th><td>${core.name(r,notation)}</td><td>${r.score}${r.weak?'<span class="weak-tag">苦手</span>':''}</td><td>${r.wrong}</td><td class="col-optional">${(r.averageMs/1000).toFixed(1)}秒</td><td>${r.asked}${r.tentative?'<span class="tentative-tag">参考</span>':''}</td><td class="col-optional">${trend(r.previousRank,i+1)}</td></tr>`).join('')}</tbody></table>`;
    const {priorCount,priorError,priorTimeShare,timeCapShare,weakThreshold}=weakConstants, secondsOf=(share: number)=>(targetMs()*share/1000).toFixed(1);
    const formula=$('#play-weak-formula'); formula.hidden=!ranked.length;
    formula.textContent=`苦手度（点） = 100 ×（間違えた回数 ÷ 出題数 ＋ 0.5 × 平均解答時間 ÷ ${secondsOf(1)}秒）`;
    formula.title=`100点は、2問に1回間違え、毎回${secondsOf(1)}秒かかる場合です。出題が少ない位置は、間違えた割合${priorError*100}%・平均${secondsOf(priorTimeShare)}秒の仮の記録${priorCount}問分を足して計算します。1問の時間は${secondsOf(timeCapShare)}秒で頭打ちです。${weakThreshold}以上を苦手とします。`;
    const all=$<HTMLButtonElement>('#play-weak-all'); all.hidden=ranked.length<=10; all.textContent=rankingAll?'上位10件に戻す':`すべて表示（${ranked.length}件）`;
  }
  const showRanking=(date: string|undefined)=>{if(date===undefined)return;rankingDate=date===localDate(new Date())?null:date;renderRanking();};
  $('#play-weak-date').addEventListener('change',event=>showRanking((event.target as HTMLSelectElement).value));
  $('#play-weak-prev').addEventListener('click',()=>showRanking(rankingNeighbours.older));
  $('#play-weak-next').addEventListener('click',()=>showRanking(rankingNeighbours.newer));
  $('#play-weak-today').addEventListener('click',()=>showRanking(localDate(new Date())));
  $('#play-weak-all').addEventListener('click',()=>{rankingAll=!rankingAll;renderRanking();});
  /** Today's records for this instrument; the open question is dropped unrecorded and the run starts over. */
  let resetDate: string|null=null;
  const closeReset=()=>{resetDate=null;$('#play-reset-confirm').hidden=true;};
  $('#play-reset').addEventListener('click',()=>{
    resetDate=localDate(new Date()); text('#play-reset-status','');
    text('#play-reset-text',`${resetDate}（今日）の${profile.displayName}の演奏練習の記録を消去します。苦手ランキングと学習記録の回数から除きます。元に戻せません。`);
    $('#play-reset-confirm').hidden=false; $('#play-reset-yes').focus();
  });
  $('#play-reset-no').addEventListener('click',closeReset);
  $('#play-reset-yes').addEventListener('click',async()=>{
    const date=resetDate; closeReset(); if(!training || !date)return;
    session=null; void controller.stop();
    try { await training.clearPlayDay(date,id); text('#play-reset-status','今日の練習記録をリセットしました'); }
    catch(error){ text('#play-reset-status',`リセットを保存できません：${error instanceof Error?error.message:String(error)}`); }
    render(); refresh();
  });
  function render() {
    refreshConfiguration();
    if(!session && targets().length)newSession();
    const active=controller.phase==='running' || controller.phase==='starting';
    // Conditions stay editable; a change restarts the run with the new settings.
    tolerance.disabled=controller.phase==='starting' || controller.phase==='stopping'; hold.disabled=tolerance.disabled; octave.disabled=tolerance.disabled;
    const choices=targets(), core=create(profile), notation=range().notation;
    text('#play-profile',`${profile.displayName} · ${profile.tuning.name}`);
    const finished=session?.phase==='finished', target=session?.target, accepted=session?.phase==='accepted';
    text('#play-target-note',accepted?'正解！':finished?'終了':target?(anyOctave()?`${core.name(target,notation)} を演奏（どのオクターブでも）`:`${target.string}弦の ${core.name(target,notation)} を演奏`):'出題範囲を設定');
    text('#play-target-frequency',target&&!finished&&anyOctave()?`練習範囲内のどの高さでも · ±${session!.options.toleranceCents}セント · ${session!.options.holdMs} ms安定`:target&&!finished?`目標 ${frequencyForMidi(target.midi,session!.options.referenceHz).toFixed(2)} Hz · ±${session!.options.toleranceCents}セント · ${session!.options.holdMs} ms安定`:'');
    text('#play-progress',session?`${session.round}周目 · ${session.index+1} / ${session.deck.length} · 正解 ${session.results.length}`:'');
    const observation=controller.observation, detected=active && observation?.state==='stable' && observation.frequency!==null?describePitch(observation.frequency,repository.current.audio.referenceHz):null;
    text('#play-detected',detected?`入力 ${detected.note}${session?.cents!==null && session?.cents!==undefined ? ` · ${session.cents>=0?'+':''}${session.cents.toFixed(1)}セント`:''}`:'入力 —');
    const messages={ready:'',listening:'指定された音を弾いてください',candidate:'その音を保ってください',accepted:'',paused:'一時停止中',finished:'練習を終了しました。もう一度開始できます'};
    text('#play-status',controller.phase==='error'?controller.error:controller.phase==='starting'?'入力を開始しています…':!choices.length?'対応音域内の出題位置がありません。出題範囲を選んでください':session?messages[session.phase]:'');
    $<HTMLProgressElement>('#play-stability').value=session?.progress??0;
    $('#play-display').dataset.phase=session?.phase??'ready';
    $<HTMLButtonElement>('#play-pause').disabled=!active;
    $<HTMLButtonElement>('#play-finish').disabled=!session || session.phase==='finished';
    $('#play-results').hidden=!session || !finished;
    const results=session?.results??[], time=results.reduce((sum,r)=>sum+r.listeningMs,0);
    text('#play-result-summary',`正解 ${results.length}問 · 許容範囲外の安定した音 ${session?.totalWrongAttempts??0}回 · 正解した問題の聴き取り時間 ${(time/1000).toFixed(1)}秒`);
    if (!accepted && feedbackTimer!==null) { clearTimeout(feedbackTimer); feedbackTimer=null; }
    if (accepted && feedbackTimer===null) {
      const answeredSession=session!;
      feedbackTimer=setTimeout(()=>{
        feedbackTimer=null;
        if(session!==answeredSession || answeredSession.phase!=='accepted' || controller.phase!=='running')return;
        answeredSession.continueAfterAnswer();
        if(!answeredSession.target)void controller.stop();
        render();
      },600);
    }
    renderBoard(); renderFocus(tolerance.disabled); renderRanking();
    const reset=$<HTMLButtonElement>('#play-reset');
    reset.hidden=!training; reset.disabled=active || controller.phase==='stopping' || !training || !hasPlayDay(training.current,localDate(new Date()),id);
    if(reset.disabled)closeReset();
  }
  renderSettings();
  if(targets().length)prepare();else render();
  return {
    prepare, pause, render,
    canStart:()=>targets().length>0,
    startLabel:()=>session?.phase==='paused'?'練習を再開':'練習を開始',
    consume(observation:AudioObservation){ if(controller.phase==='running' && controller.started){const current=session,before=current?.results.length??0;current?.bind(controller.started.sessionId);current?.consume(observation);if(current && current.results.length>before){const result=current.results.at(-1)!;onResult(result,id);recordPosition(result.target,{kind:'answered',listeningMs:result.listeningMs,wrongAttempts:result.wrongAttempts});}if(session?.phase==='finished')void controller.stop();} },
    sync(){if(controller.phase==='running' && controller.started)session?.bind(controller.started.sessionId);else if(['idle','error'].includes(controller.phase))session?.pause();},
    setInstrument(next:InstrumentProfile){abandonPending();id=next.id;play=repository.play(id);profile=resolveInstrument(id,play.tuning);session=null;boardKey='';rankingDate=null;renderSettings();if(targets().length)prepare();else render();},
    reset(){abandonPending();session=null;render();},
  };
}
