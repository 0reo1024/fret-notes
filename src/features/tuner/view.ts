import { $ } from '../../ui/dom';
import { resolveInstrument, type InstrumentProfile } from '../../domain/instruments/profiles';
import { describePitch, stringTargets } from '../../domain/tuner/pitch';
import type { SettingsRepository } from '../../platform/settings';
import { mountPerformance } from '../performance/view';
import { mountAudioSettings } from '../audio/settings';
import type { AudioConsumer, AudioHub } from '../audio/hub';
import type { AudioSettings } from '../../domain/tuner/settings';

/** Another feature that borrows the single audio panel while it is shown. */
export interface AudioPanelOwner { onStart(input: AudioSettings): void; onStop(): void; onChange(): void }

export function mountTuner(repository: SettingsRepository, hub: AudioHub, onPlayResult?: Parameters<typeof mountPerformance>[4], training: Parameters<typeof mountPerformance>[5] = null) {
  const controller = hub.controller;
  let profile = resolveInstrument(repository.current.lastInstrument,repository.current.instruments[repository.current.lastInstrument]);
  let selectedString: number | null = null, visible = false;
  let mode: 'tuner'|'play' = 'tuner';
  const play = mountPerformance(repository,controller,profile,()=>render(),onPlayResult,training);
  const playConsumer: AudioConsumer = { consume: observation => play.consume(observation), sync: () => play.sync(), pause: () => play.pause() };
  let frame: number | null = null, watchdog: ReturnType<typeof setInterval> | null = null;
  let owner: AudioPanelOwner | null = null;
  const audio = mountAudioSettings($('.audio-settings'),repository,controller,{
    onStart(input) { if(owner){owner.onStart(input);return;} if(mode==='play')play.prepare(); repository.updateAudio(input); void controller.start(input); },
    onStop() { if(owner){owner.onStop();return;} play.pause(); void controller.stop(); },
    onChange() { buildTargets(); if(owner)owner.onChange(); else render(); },
  });
  function text(selector: string, value: string) { const element = $(selector); if (element.textContent !== value) element.textContent = value; }
  function buildTargets() {
    const buttons: HTMLButtonElement[] = [];
    const chromatic = document.createElement('button'); chromatic.type = 'button'; chromatic.textContent = 'クロマチック'; chromatic.dataset.targetString = '0'; buttons.push(chromatic);
    for (const target of stringTargets(profile,repository.current.audio.referenceHz).slice().reverse()) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `${target.number}弦 · ${target.note}`; button.dataset.targetString = String(target.number);
      button.disabled = !target.supported; if (!target.supported) button.title = 'この弦の音高はチューナーの対応音域外です'; buttons.push(button);
    }
    $('#tuner-strings').replaceChildren(...buttons);
    text('#tuner-profile',`${profile.displayName} · ${profile.tuning.name}`);
  }
  $('#tuner-strings').addEventListener('click',event=>{
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-target-string]'); if (!button || button.disabled) return;
    selectedString = Number(button.dataset.targetString) || null; render();
  });
  function render() {
    const phase = controller.phase, observation = controller.observation;
    const active = phase === 'starting' || phase === 'running';
    const selected = selectedString ? stringTargets(profile,repository.current.audio.referenceHz).find(s => s.number === selectedString) : undefined;
    if (selected && !selected.supported) selectedString = null;
    const target = selected?.supported ? selected : undefined;
    const pitch = phase === 'running' && observation?.state === 'stable' && observation.frequency !== null ? describePitch(observation.frequency,repository.current.audio.referenceHz,target?.openMidi) : null;
    $('#tuner-panel').dataset.signal = pitch?.inTune ? 'in-tune' : pitch ? 'detected' : observation?.state ?? 'idle';
    text('#tuner-note',pitch?.note ?? '—');
    text('#tuner-frequency',pitch && observation?.frequency ? `${observation.frequency.toFixed(2)} Hz` : '— Hz');
    text('#tuner-cents',pitch ? `${pitch.cents >= 0 ? '+' : ''}${pitch.cents.toFixed(1)} セント` : '— セント');
    text('#tuner-target-name',target ? `${target.number}弦 · ${target.note}` : 'クロマチック');
    text('#tuner-target-frequency',target ? `目標 ${target.frequency.toFixed(2)} Hz` : `A4 = ${repository.current.audio.referenceHz} Hz · 最も近い音を表示`);
    const needle = $('#tuner-needle'); needle.hidden = !pitch; needle.style.left = `${50 + Math.max(-50,Math.min(50,pitch?.cents ?? 0))}%`;
    const statuses = { warming:'音を確認しています',silence:'音を待っています',unstable:'音高が安定していません',stable:pitch?.inTune ? 'チューニングが合っています' : pitch && pitch.cents < 0 ? '低い音です' : '高い音です',clipping:'入力が大きすぎます。入力側の音量を下げてください',error:'入力エラー',stopped:'入力は停止しています' };
    text('#tuner-signal-status', phase === 'error' ? controller.error : phase === 'starting' ? '入力を開始しています…' : phase === 'stopping' ? '入力を停止しています…' : phase === 'idle' ? '入力を開始して、単音を弾いてください' : observation ? observation.message ?? statuses[observation.state] : '入力の応答を待っています');
    if(!owner)audio.render({ startBlocked: mode==='play' && !play.canStart(), startLabel: mode==='play'?play.startLabel():'入力を開始', stopLabel: mode==='play'?'一時停止':'停止', lockReference: mode==='play' });
    if(mode==='play')play.render();
    for (const button of $('#tuner-strings').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed',String(Number(button.dataset.targetString) === (selectedString ?? 0)));
    if (active && watchdog === null) watchdog = setInterval(()=>controller.tick(),250);
    if (!active && watchdog !== null) { clearInterval(watchdog); watchdog = null; }
  }
  hub.onChange(() => { if (frame === null) frame = requestAnimationFrame(()=>{ frame = null; render(); }); });
  document.addEventListener('visibilitychange',()=>{ if (document.hidden) {play.pause();void controller.stop();} });
  buildTargets(); render();
  return {
    audio,
    /** Hands the audio panel to another feature (it renders it), or back to the tuner with null. */
    setAudioOwner(next: AudioPanelOwner | null) { owner = next; if(!owner)render(); },
    setInstrument(next: InstrumentProfile) { profile = next; play.setInstrument(next); if(mode==='play')void controller.stop(); if (selectedString && selectedString > profile.strings.length) selectedString = null; buildTargets(); render(); },
    show(show: boolean, nextMode:'tuner'|'play'='tuner') {
      if(!show || mode!==nextMode){play.pause();void controller.stop();}
      visible=show;mode=nextMode; $('#tuner-display').hidden=mode==='play';$('#play-display').hidden=mode!=='play';
      hub.setActiveConsumer(visible && mode==='play' ? playConsumer : null);
      $('#tuner-panel').setAttribute('aria-label',mode==='play'?'演奏練習':'チューナー');
      if(visible) audio.attach($('#tuner-panel'));
      if(visible && !audio.loaded)void audio.refreshDevices(); if(mode==='play' && controller.phase==='idle')play.render(); render();
    },
    async shutdown() { visible = false; hub.setActiveConsumer(null); play.pause(); await controller.stop(); },
  };
}
