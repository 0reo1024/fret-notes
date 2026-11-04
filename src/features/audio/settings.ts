import { decodeAudioSettings, type AudioSettings } from '../../domain/tuner/settings';
import type { AudioController, InputDevice } from '../../platform/audio';
import type { SettingsRepository } from '../../platform/settings';

export interface AudioSettingsHooks {
  /** Start was pressed with valid settings; the owner prepares its session and starts input. */
  onStart(input: AudioSettings): void;
  onStop(): void;
  /** Saved settings changed (e.g. the A4 reference), or the device list finished loading. */
  onChange(): void;
}
export interface AudioPanelState { startBlocked: boolean; startLabel: string; stopLabel: string; lockReference: boolean }

/** Device, channel, reference and gate controls plus start/stop and the level meter.
 * There is a single panel element; `attach` moves it into whichever feature shows it, so ids stay unique. */
export function mountAudioSettings(root: HTMLElement, repository: SettingsRepository, controller: AudioController, hooks: AudioSettingsHooks) {
  const backend = controller.backend;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const device = find<HTMLSelectElement>('#audio-device'), channel = find<HTMLSelectElement>('#audio-channel');
  const reference = find<HTMLInputElement>('#audio-reference'), gate = find<HTMLInputElement>('#audio-gate');
  let devices: InputDevice[] = [], loaded = false, loading = false;
  reference.value = String(repository.current.audio.referenceHz); gate.value = String(repository.current.audio.gateDb);
  function text(selector: string, value: string) { const element = find(selector); if (element.textContent !== value) element.textContent = value; }
  function channels() {
    const selected = device.value ? devices.find(d => d.id === device.value) : devices.find(d => d.isDefault);
    channel.replaceChildren();
    for (let n = 0; n < Math.min(selected?.channels ?? 1,64); n++) { const option = document.createElement('option'); option.value = String(n); option.textContent = `入力 ${n+1}`; channel.append(option); }
    channel.value = String(Math.min(repository.current.audio.channel,Math.max(0,channel.options.length-1)));
  }
  const listKey = (list: InputDevice[]) => JSON.stringify(list.map(d => [d.id,d.name,d.channels,d.isDefault]));
  const busyPhase = () => ['starting','running','stopping'].includes(controller.phase);
  function applyDevices(list: InputDevice[]) {
    devices = list; device.replaceChildren();
    const defaultDevice = devices.find(d => d.isDefault);
    const standard = document.createElement('option'); standard.value = ''; standard.textContent = `Windowsの既定入力${defaultDevice ? ' · '+defaultDevice.name : ''}`; device.append(standard);
    for (const input of devices) { const option = document.createElement('option'); option.value = input.id; option.textContent = input.name; option.disabled = input.channels === null; device.append(option); }
    const saved = repository.current.audio.deviceId;
    if (saved && !devices.some(d => d.id === saved)) { const missing = document.createElement('option'); missing.value = saved; missing.textContent = '保存したデバイスが未接続です'; missing.disabled = true; device.append(missing); }
    device.value = saved ?? ''; channels(); loaded = true;
    text('#audio-device-status', saved && !devices.some(d => d.id === saved) ? 'デバイスを接続するか、別の入力を選んでください。' : backend.available ? (devices.length ? '' : '入力デバイスがありません。接続を確認してください。') : '音声入力はFret Notes.exeで利用できます。');
  }
  async function refreshDevices() {
    if (loading || busyPhase()) return;
    loading = true; hooks.onChange();
    try { applyDevices(await backend.list()); }
    catch (error) { text('#audio-device-status',`入力一覧を取得できません：${String(error)}`); }
    finally { loading = false; hooks.onChange(); }
  }
  /** Picks up plugged or unplugged devices; rebuilds the controls only when the list changed,
   * so an open dropdown and the Start button are left alone otherwise. */
  let watching = false;
  async function watchDevices() {
    if (watching || loading || !loaded || !backend.available || busyPhase() || document.hidden || !root.isConnected || !root.getClientRects().length) return;
    watching = true;
    try {
      const list = await backend.list();
      if (!loading && !busyPhase() && listKey(list) !== listKey(devices)) { applyDevices(list); hooks.onChange(); }
    } catch { /* Endpoints can fail briefly while a device is being plugged in; the next check retries. */ }
    finally { watching = false; }
  }
  setInterval(()=>{ void watchDevices(); },2000);
  window.addEventListener('focus',()=>{ void watchDevices(); });
  document.addEventListener('visibilitychange',()=>{ void watchDevices(); });
  function settings() { return decodeAudioSettings({ deviceId:device.value || null,channel:Number(channel.value),referenceHz:Number(reference.value),gateDb:Number(gate.value) }); }
  function saveSettings() {
    try { const next = settings(); if (JSON.stringify(next) !== JSON.stringify(repository.current.audio)) repository.updateAudio(next); hooks.onChange(); text('#audio-settings-status',''); }
    catch (error) { text('#audio-settings-status',String(error instanceof Error ? error.message : error)); reference.value = String(repository.current.audio.referenceHz); gate.value = String(repository.current.audio.gateDb); }
  }
  device.addEventListener('change',()=>{ channels(); saveSettings(); }); channel.addEventListener('change',saveSettings);
  reference.addEventListener('change',saveSettings); gate.addEventListener('change',saveSettings);
  const previewInput = () => { try { settings(); saveSettings(); } catch { /* Keep incomplete numeric edits until blur. */ } };
  reference.addEventListener('input',previewInput); gate.addEventListener('input',previewInput);
  find('#audio-refresh').addEventListener('click',()=>{ void refreshDevices(); });
  find('#audio-start').addEventListener('click',()=>{
    try { hooks.onStart(settings()); }
    catch (error) { text('#audio-settings-status',String(error)); }
  });
  find('#audio-stop').addEventListener('click',()=>hooks.onStop());
  return {
    get loaded() { return loaded; },
    refreshDevices,
    /** Moves the single panel into another feature's layout. */
    attach(container: HTMLElement) { if (root.parentElement !== container) container.append(root); },
    render(state: AudioPanelState) {
      const phase = controller.phase, observation = controller.observation;
      const active = phase === 'starting' || phase === 'running', busy = active || phase === 'stopping';
      const meter = find<HTMLMeterElement>('#audio-level'); meter.value = observation?.levelDb ?? -120;
      text('#audio-level-text',observation ? `${observation.levelDb.toFixed(1)} dB` : '— dB');
      text('#audio-activity',active ? '音声入力中' : phase === 'stopping' ? '停止中' : '音声入力は停止しています');
      const started = controller.started;
      text('#audio-stream-info',started ? `${started.deviceName} · 入力${started.channel+1} · ${started.sampleRate} Hz` : '');
      find<HTMLButtonElement>('#audio-start').disabled = busy || loading || !backend.available || !devices.length || device.selectedOptions[0]?.disabled === true || state.startBlocked;
      text('#audio-start',state.startLabel); text('#audio-stop',state.stopLabel);
      find<HTMLButtonElement>('#audio-stop').disabled = !active && phase !== 'error';
      find<HTMLButtonElement>('#audio-refresh').disabled = busy || loading || !backend.available;
      device.disabled = busy || !backend.available; channel.disabled = busy || !backend.available; gate.disabled = busy;
      reference.disabled = busy && state.lockReference;
    },
  };
}
