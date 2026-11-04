/** Sound output with Web Audio only: a metronome click and a simple synthesized note. No files, no libraries.
 * The AudioContext is created on the first user action (browsers require it) and suspended when not needed. */
export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.6;
  get available() { return typeof AudioContext !== 'undefined'; }
  /** Call from a click or key handler. */
  ensure(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = this.volume; this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }
  get now() { return this.context?.currentTime ?? 0; }
  setVolume(volume: number) { this.volume = Math.min(1, Math.max(0, volume)); if (this.master) this.master.gain.value = this.volume; }
  /** Short decaying blip, shorter than the note segmenter's minimum hold so it cannot be mistaken for a played note. */
  click(atSeconds: number, accent: boolean) {
    const context = this.ensure(), oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = accent ? 2000 : 1500; oscillator.type = 'square';
    gain.gain.setValueAtTime(0, atSeconds);
    gain.gain.linearRampToValueAtTime(accent ? .5 : .3, atSeconds + .002);
    gain.gain.exponentialRampToValueAtTime(.0001, atSeconds + .04);
    oscillator.connect(gain).connect(this.master!);
    oscillator.start(atSeconds); oscillator.stop(atSeconds + .05);
  }
  /** Plain synthesized note (triangle through a low-pass with an envelope) for ear training and motifs. */
  note(midi: number, atSeconds: number, durationSeconds: number, referenceHz = 440) {
    const context = this.ensure(), oscillator = context.createOscillator(), filter = context.createBiquadFilter(), gain = context.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.value = referenceHz * 2 ** ((midi - 69) / 12);
    filter.type = 'lowpass'; filter.frequency.value = 2500;
    const end = atSeconds + Math.max(.05, durationSeconds);
    gain.gain.setValueAtTime(0, atSeconds);
    gain.gain.linearRampToValueAtTime(.35, atSeconds + .01);
    gain.gain.exponentialRampToValueAtTime(.12, atSeconds + Math.min(.3, durationSeconds));
    gain.gain.setValueAtTime(.12, end - .03);
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(filter).connect(gain).connect(this.master!);
    oscillator.start(atSeconds); oscillator.stop(end + .01);
  }
  /** Sustained tones (a drone of root and fifth) until the returned stop is called. */
  drone(midis: number[], referenceHz = 440): () => void {
    const context = this.ensure(), gain = context.createGain(), filter = context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 1200;
    gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(.12, context.currentTime + .3);
    const oscillators = midis.map(midi => { const o = context.createOscillator(); o.type = 'sawtooth'; o.frequency.value = referenceHz * 2 ** ((midi - 69) / 12); o.connect(filter); o.start(); return o; });
    filter.connect(gain).connect(this.master!);
    let stopped = false;
    return () => {
      if (stopped) return; stopped = true;
      const end = context.currentTime + .3;
      gain.gain.setValueAtTime(gain.gain.value, context.currentTime); gain.gain.linearRampToValueAtTime(0, end);
      for (const o of oscillators) o.stop(end + .05);
    };
  }
  /** Plays timed groups of notes (chords sound together) starting shortly from now; returns when the last one ends, in seconds. */
  play(events: { midis: number[]; at: number; duration: number }[], referenceHz = 440, leadSeconds = .1) {
    const context = this.ensure(), start = context.currentTime + leadSeconds;
    for (const event of events) for (const midi of event.midis) this.note(midi, start + event.at, event.duration, referenceHz);
    return leadSeconds + Math.max(0, ...events.map(e => e.at + e.duration));
  }
  /** Performance-clock time (ms) when a context time is heard: now, plus the scheduling distance, plus the reported output latency.
   * The output timestamp is not used: around a suspend/resume it lagged by over a second in testing. Tap calibration absorbs the rest. */
  toPerformanceTime(contextSeconds: number) {
    const context = this.ensure();
    return performance.now() + (contextSeconds - context.currentTime + (context.outputLatency || 0)) * 1000;
  }
  suspend() { if (this.context?.state === 'running') void this.context.suspend(); }
  close() { const context = this.context; this.context = null; this.master = null; if (context) void context.close(); }
}

/** Look-ahead scheduler: every 25 ms it books the clicks of the next 100 ms on the audio clock, so timer jitter does not move them.
 * `clicks(fromMs, toMs)` must return each click once for consecutive windows. */
export class ClickScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduledUntilMs = 0;
  constructor(private engine: Pick<SoundEngine, 'now' | 'click'>, private startContextSeconds: number, private clicks: (fromMs: number, toMs: number) => { timeMs: number; accent: boolean }[],
    private lookAheadMs = 100, private intervalMs = 25) {}
  start() { this.stop(); this.tick(); this.timer = setInterval(() => this.tick(), this.intervalMs); }
  tick() {
    const nowMs = (this.engine.now - this.startContextSeconds) * 1000, untilMs = nowMs + this.lookAheadMs;
    if (untilMs <= this.scheduledUntilMs) return;
    for (const click of this.clicks(this.scheduledUntilMs, untilMs)) this.engine.click(this.startContextSeconds + click.timeMs / 1000, click.accent);
    this.scheduledUntilMs = untilMs;
  }
  stop() { if (this.timer !== null) { clearInterval(this.timer); this.timer = null; } }
}

/** One engine for the whole app, so only one AudioContext exists. */
export const sound = new SoundEngine();
