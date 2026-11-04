import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { AudioSettings } from '../domain/tuner/settings';
export type SignalState = 'warming' | 'silence' | 'unstable' | 'stable' | 'clipping' | 'error' | 'stopped';
export interface InputDevice { id: string; name: string; channels: number | null; sampleRate: number | null; isDefault: boolean }
/** A note attack on the capture clock, with how far its energy rose (dB). */
export interface Onset { audioTimeMs: number; strengthDb: number }
export interface AudioObservation { sessionId: string; sequence: number; audioTimeMs: number; state: SignalState; frequency: number | null; levelDb: number; peak: number; confidence: number; droppedSamples: number; message: string | null; onsets?: Onset[] }
export interface AudioStarted { sessionId: string; deviceName: string; sampleRate: number; analysisSampleRate: number; channels: number; channel: number }
export interface AudioRequest { sessionId: string; deviceId: string | null; channel: number; gateDb: number }
export interface AudioBackend {
  available: boolean;
  list(): Promise<InputDevice[]>;
  start(request: AudioRequest, onObservation: (observation: AudioObservation) => void): Promise<AudioStarted>;
  stop(sessionId: string | null): Promise<void>;
  acknowledge(sessionId: string, sequence: number): Promise<void>;
}
export function audioBackend(): AudioBackend {
  if (!isTauri()) return {
    available: false, async list() { return []; }, async start() { throw new Error('音声入力はFret Notes.exeで利用できます'); }, async stop() {}, async acknowledge() {},
  };
  return {
    available: true, list: () => invoke('list_input_devices'),
    async start(request, onObservation) { const onEvent = new Channel<AudioObservation>(); onEvent.onmessage = onObservation; return invoke('start_audio', { request, onEvent }); },
    stop: sessionId => invoke('stop_audio', { sessionId }),
    acknowledge: (sessionId, sequence) => invoke('ack_audio', { sessionId, sequence }),
  };
}
export type AudioPhase = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export class AudioController {
  phase: AudioPhase = 'idle'; observation: AudioObservation | null = null; started: AudioStarted | null = null; error = '';
  onChange: () => void = () => {};
  onObservation: (observation: AudioObservation) => void = () => {};
  private sessionId: string | null = null; private generation = 0; private sequence = 0;
  private lastEvent = 0; private lastAudioTime = -1; private lastOnsetTime = -1;
  private stopping: Promise<void> | null = null;
  constructor(readonly backend: AudioBackend, private now = () => performance.now(), private newId: () => string = () => crypto.randomUUID()) {}
  async start(settings: AudioSettings) {
    if (!this.backend.available) { this.error = '音声入力はFret Notes.exeで利用できます'; this.phase = 'error'; this.onChange(); return; }
    if (this.phase === 'starting' || this.phase === 'running' || this.phase === 'stopping') return;
    if (this.sessionId) { await this.stop(); if (this.phase === 'error') return; }
    const generation = ++this.generation, sessionId = this.newId(); this.sessionId = sessionId;
    this.phase = 'starting'; this.error = ''; this.observation = null; this.started = null; this.sequence = 0; this.lastAudioTime = -1; this.lastOnsetTime = -1; this.lastEvent = this.now(); this.onChange();
    try {
      const started = await this.backend.start({ sessionId, deviceId: settings.deviceId, channel: settings.channel, gateDb: settings.gateDb }, observation => this.consume(observation));
      if (generation !== this.generation || this.sessionId !== sessionId) return;
      if (started.sessionId !== sessionId) throw new Error('音声セッションが一致しません');
      this.started = started; this.phase = 'running'; this.lastEvent = this.now(); this.onChange();
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const sessionId = this.sessionId;
    ++this.generation; this.sessionId = null; this.observation = null; this.started = null;
    if (!sessionId) { this.phase = 'idle'; this.error = ''; this.onChange(); return Promise.resolve(); }
    this.phase = 'stopping'; this.onChange();
    this.stopping = (async()=>{
      try { await this.backend.stop(sessionId); this.phase = 'idle'; this.error = ''; }
      catch (error) { this.sessionId = sessionId; this.phase = 'error'; this.error = String(error instanceof Error ? error.message : error); }
      finally { this.onChange(); this.stopping = null; }
    })();
    return this.stopping;
  }
  private fail(error: unknown) {
    const id = this.sessionId; ++this.generation;
    this.phase = 'error'; this.observation = null; this.started = null; this.error = String(error instanceof Error ? error.message : error); this.onChange();
    if (id) void this.backend.stop(id).catch(() => {});
  }
  private consume(observation: AudioObservation) {
    if (observation.sessionId !== this.sessionId || !['starting','running'].includes(this.phase)) return;
    void this.backend.acknowledge(observation.sessionId,observation.sequence).catch(error => { if (observation.sessionId === this.sessionId && ['starting','running'].includes(this.phase)) this.fail(error); });
    if (observation.sequence <= this.sequence) return;
    if (observation.state === 'stopped') { ++this.generation; this.sessionId = null; this.observation = null; this.started = null; this.phase = 'idle'; this.onChange(); return; }
    if (observation.state === 'error') { this.sequence = observation.sequence; this.fail(observation.message ?? '音声入力が中断されました'); return; }
    if (!Number.isFinite(observation.audioTimeMs) || observation.audioTimeMs < this.lastAudioTime) return;
    if (!Number.isFinite(observation.levelDb) || !Number.isFinite(observation.confidence) || !Number.isFinite(observation.peak)
      || observation.frequency !== null && (!Number.isFinite(observation.frequency) || observation.frequency < 25 || observation.frequency > 1500)) { this.fail('音声の解析結果が不正です'); return; }
    // Onsets must be finite, in order, newer than the last ones and not after this observation's time.
    const onsets = observation.onsets ?? [];
    if (!Array.isArray(onsets) || onsets.length > 16 || onsets.some((onset, i) => !Number.isFinite(onset?.audioTimeMs) || !Number.isFinite(onset?.strengthDb)
      || onset.audioTimeMs <= this.lastOnsetTime || onset.audioTimeMs > observation.audioTimeMs + 1 || i > 0 && onset.audioTimeMs < onsets[i - 1].audioTimeMs)) { this.fail('音声の解析結果が不正です'); return; }
    if (onsets.length) this.lastOnsetTime = onsets.at(-1)!.audioTimeMs;
    observation = { ...observation, onsets };
    this.sequence = observation.sequence; this.lastAudioTime = observation.audioTimeMs; this.lastEvent = this.now();
    this.observation = observation.state === 'stable' ? observation : { ...observation, frequency: null };
    this.onObservation(this.observation);
    this.onChange();
  }
  tick() {
    if (!['starting','running'].includes(this.phase)) return;
    const age = this.now() - this.lastEvent;
    if (age > (this.phase === 'starting' ? 8000 : 2000)) { this.fail('入力の応答が途切れました。接続を確認して再開始してください'); return; }
    if (age > 500 && this.observation) { this.observation = null; this.onChange(); }
  }
}
