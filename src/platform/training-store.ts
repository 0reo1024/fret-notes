import { invoke, isTauri } from '@tauri-apps/api/core';
import { clearPlayDay, decodeTrainingData, emptyTrainingData, limits, record, type Attempt, type TrainingData } from '../domain/training/records';
import type { ProfileId } from '../domain/instruments/profiles';
import { targetFor, targetsOf } from '../domain/training/analysis';
import { addPlayPosition, type PlayPositionDay } from '../domain/practice/weak-positions';

export interface TrainingBackend {
  load(): Promise<{ data: unknown | null; recovered: boolean }>;
  save(data: TrainingData): Promise<void>;
}
export type NewAttempt = Omit<Attempt, 'at'>;
export const autosaveMs = 30000;

/** Practice records in their own file. Attempts are batched: saved 30 s after a change, on `flush`, and before closing. */
export class TrainingRepository {
  current = emptyTrainingData();
  recovered = false;
  /** Receives a failure message, or an empty string once saving works again. */
  onStatus: (message: string) => void = () => {};
  onChange: () => void = () => {};
  private queue = Promise.resolve();
  private error: Error | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private backend: TrainingBackend, private now = () => new Date(),
    // Wrapped so the timers are not called with the repository as `this` (browsers reject that).
    private schedule: (run: () => void, ms: number) => ReturnType<typeof setTimeout> = (run, ms) => setTimeout(run, ms),
    private cancel: (timer: ReturnType<typeof setTimeout>) => void = timer => clearTimeout(timer)) {}

  async load() {
    const loaded = await this.backend.load();
    this.current = loaded.data === null ? emptyTrainingData() : decodeTrainingData(loaded.data);
    this.recovered = loaded.recovered;
  }
  add(attempt: NewAttempt) {
    const now = this.now();
    // The goal set in the records tab applies from this answer on; earlier boxes are not recomputed.
    this.current = record(this.current, { ...attempt, at: now.toISOString() }, now, targetFor(targetsOf(this.current.preferences), attempt.method));
    this.changed();
  }
  /** Adds one question to the single-note practice per day and asked position. */
  addPlayPosition(entry: PlayPositionDay) {
    this.current = { ...this.current, playPositions: addPlayPosition(this.current.playPositions, entry) };
    this.changed();
  }
  /** Clears one day's single-note practice for an instrument and saves right away. */
  async clearPlayDay(date: string, instrument: ProfileId) {
    this.current = clearPlayDay(this.current, date, instrument);
    this.changed();
    await this.flush();
  }
  preference(key: string): unknown { return structuredClone(this.current.preferences[key]); }
  updatePreferences(key: string, value: unknown) {
    this.current = { ...this.current, preferences: { ...this.current.preferences, [key]: structuredClone(value) } };
    this.changed();
  }
  /** Stores latency calibration (tap or input offset in ms; null clears it). */
  updateCalibration(patch: Partial<TrainingData['calibration']>) {
    this.current = { ...this.current, calibration: { ...this.current.calibration, ...patch } };
    this.changed();
  }
  /** Replaces the user's saved progressions (validated by the progression trainer before saving). */
  updateProgressions(list: unknown[]) {
    this.current = { ...this.current, progressions: structuredClone(list) };
    this.changed();
  }
  /** Keeps a practice take (pitches and times only); the oldest is dropped beyond the limit, whichever trainer made it. */
  addTake(take: unknown) {
    this.current = { ...this.current, takes: [...this.current.takes, structuredClone(take)].slice(-limits.takes) };
    this.changed();
  }
  private changed() {
    this.dirty = true; this.onChange();
    this.timer ??= this.schedule(() => { this.timer = null; void this.persist(); }, autosaveMs);
  }
  private persist() {
    if (this.timer !== null) { this.cancel(this.timer); this.timer = null; }
    if (!this.dirty) return this.queue;
    const snapshot = structuredClone(this.current); this.dirty = false;
    this.queue = this.queue.then(async () => {
      try {
        await this.backend.save(snapshot);
        this.error = null;
        this.onStatus('');
      } catch (error) {
        // Keep the change pending so the next flush retries it.
        this.dirty = true;
        this.error = error instanceof Error ? error : new Error(String(error));
        this.onStatus(`学習記録を保存できません：${this.error.message}`);
      }
    });
    return this.queue;
  }
  async flush() { await this.persist(); if (this.error) throw this.error; }
  /** Replaces all records (import or clear). The previous data is restored if the save fails. */
  async replace(input: unknown) {
    const decoded = decodeTrainingData(input), previous = this.current;
    await this.queue;
    this.current = decoded; this.dirty = true;
    await this.persist();
    if (this.error) { this.current = previous; throw this.error; }
    this.onChange();
  }
  clear() { return this.replace(emptyTrainingData()); }
  exportJson() { return JSON.stringify(this.current, null, 2); }
}

export function trainingBackend(): TrainingBackend {
  if (isTauri()) return {
    load: () => invoke('load_training_data'),
    save: data => invoke('save_training_data', { data }),
  };
  // This adapter is for UI development. The desktop application uses the Rust store.
  const key = 'fret-notes-training-preview-v1';
  return {
    async load() { const stored = localStorage.getItem(key); return { data: stored ? JSON.parse(stored) : null, recovered: false }; },
    async save(data) { localStorage.setItem(key, JSON.stringify(data)); },
  };
}
