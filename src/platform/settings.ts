import { invoke, isTauri } from '@tauri-apps/api/core';
import { forInstrument, type PracticeSettings } from '../domain/instruments/core';
import { normalize as normalizeStudy, type StudySettings } from '../domain/music/theory';
import { profileIds, defaultTuning, decodeTuning, type ProfileId, type TuningConfig } from '../domain/instruments/profiles';
import { defaultAudioSettings, decodeAudioSettings, type AudioSettings } from '../domain/tuner/settings';

export type { ProfileId } from '../domain/instruments/profiles';
export type InstrumentSettings = PracticeSettings & StudySettings;
/** Performance practice keeps its own range and tuning, separate from the fretboard study. */
export interface PlayOptions { toleranceCents: number; holdMs: number }
export const defaultPlayOptions = (): PlayOptions => ({ toleranceCents: 10, holdMs: 350 });
export function decodePlayOptions(input: unknown): PlayOptions {
  if (!object(input) || Object.keys(input).some(key => !['toleranceCents', 'holdMs'].includes(key)) || ![5, 10, 20].includes(input.toleranceCents as number) || ![200, 350, 500].includes(input.holdMs as number)) throw new Error('入力設定が不正です');
  return { toleranceCents: input.toleranceCents as number, holdMs: input.holdMs as number };
}
export interface PlaySettings { strings: number[]; frets: number[]; naturalOnly: boolean; tuning: TuningConfig }
export interface SettingsFile {
  schemaVersion: 3;
  lastInstrument: ProfileId;
  bassStringCount: number;
  profiles: Partial<Record<ProfileId, InstrumentSettings>>;
  instruments: Record<ProfileId, TuningConfig>;
  audio: AudioSettings;
  play: Partial<Record<ProfileId, PlaySettings>>;
  playOptions: PlayOptions;
}
export interface SettingsBackend {
  load(): Promise<{ settings: SettingsFile; recovered: boolean }>;
  save(settings: SettingsFile): Promise<void>;
}
export const defaults = (): SettingsFile => ({ schemaVersion: 3, lastInstrument: 'guitar', bassStringCount: 4, profiles: {}, instruments: { guitar: defaultTuning(), bass4: defaultTuning(), bass5: defaultTuning() }, audio: defaultAudioSettings(), play: {}, playOptions: defaultPlayOptions() });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const coreFor = (id: ProfileId, tuning?: TuningConfig) => forInstrument(id === 'guitar' ? 'guitar' : 'bass', id === 'bass5' ? 5 : 4, tuning);

export function decodePlay(input: unknown, id: ProfileId): PlaySettings {
  if (!object(input) || !Array.isArray(input.strings) || !Array.isArray(input.frets) || typeof input.naturalOnly !== 'boolean') throw new Error('演奏練習の設定が不正です');
  const tuning = decodeTuning(input.tuning, id), { strings, frets, naturalOnly } = coreFor(id, tuning).normalize(input);
  return { strings, frets, naturalOnly, tuning };
}

export function decodeSettings(input: unknown): SettingsFile {
  if (!object(input) || ![1, 2, 3].includes(input.schemaVersion as number)) throw new Error('対応するバージョンの設定ファイルではありません');
  if (!profileIds.includes(input.lastInstrument as ProfileId) || ![4, 5].includes(input.bassStringCount as number) || !object(input.profiles)) throw new Error('楽器の設定が不正です');
  const result: SettingsFile = { ...defaults(), lastInstrument: input.lastInstrument as ProfileId, bassStringCount: input.bassStringCount as number };
  if ((input.schemaVersion as number) >= 2) {
    if (!object(input.instruments) || Object.keys(input.instruments).some(id => !profileIds.includes(id as ProfileId))) throw new Error('楽器のチューニング設定が不正です');
    for (const id of profileIds) {
      if (!Object.hasOwn(input.instruments, id)) throw new Error('楽器のチューニング設定がありません');
      result.instruments[id] = decodeTuning(input.instruments[id], id);
    }
  } else if (Object.hasOwn(input, 'instruments')) throw new Error('旧バージョンの設定に未対応の項目があります');
  if (input.schemaVersion === 3) result.audio = decodeAudioSettings(input.audio);
  else if (Object.hasOwn(input, 'audio')) throw new Error('旧バージョンの設定に未対応の項目があります');
  if (Object.hasOwn(input, 'playOptions')) result.playOptions = decodePlayOptions(input.playOptions);
  if (Object.hasOwn(input, 'play')) {
    if (!object(input.play)) throw new Error('演奏練習の設定が不正です');
    for (const [id, play] of Object.entries(input.play)) {
      if (!profileIds.includes(id as ProfileId)) throw new Error('演奏練習の設定が不正です');
      result.play[id as ProfileId] = decodePlay(play, id as ProfileId);
    }
  }
  for (const [id, profile] of Object.entries(input.profiles)) {
    if (!profileIds.includes(id as ProfileId) || !object(profile) || !Array.isArray(profile.strings) || !Array.isArray(profile.frets)) throw new Error('練習設定が不正です');
    const core = coreFor(id as ProfileId, result.instruments[id as ProfileId]);
    result.profiles[id as ProfileId] = { ...core.normalize(profile), ...normalizeStudy(profile) };
  }
  return result;
}

export class SettingsRepository {
  current = defaults();
  recovered = false;
  private queue = Promise.resolve();
  private error: Error | null = null;
  /** Receives a failure message, or an empty string once saving works again. */
  onStatus: (message: string) => void = () => {};
  constructor(private backend: SettingsBackend) {}

  async load() {
    const loaded = await this.backend.load();
    this.current = decodeSettings(loaded.settings);
    this.recovered = loaded.recovered;
  }
  update(id: ProfileId, settings: InstrumentSettings, lastInstrument: string, bassStringCount: number, tuning?: TuningConfig) {
    const config = decodeTuning(tuning ?? this.current.instruments[id], id);
    this.current.profiles[id] = structuredClone(settings);
    this.current.instruments[id] = config;
    this.current.lastInstrument = profileIds.includes(lastInstrument as ProfileId) ? lastInstrument as ProfileId : 'guitar';
    this.current.bassStringCount = bassStringCount;
    return this.persist();
  }
  /** Starts from the study tuning and the whole board until performance practice saves its own. */
  play(id: ProfileId): PlaySettings {
    const saved = this.current.play[id];
    if (saved) return structuredClone(saved);
    const tuning = structuredClone(this.current.instruments[id]), { strings, frets } = coreFor(id, tuning).normalize();
    return { strings, frets, naturalOnly: false, tuning };
  }
  updatePlayOptions(options: PlayOptions) { this.current.playOptions = decodePlayOptions(options); return this.persist(); }
  updatePlay(id: ProfileId, settings: PlaySettings) { this.current.play[id] = decodePlay(settings, id); return this.persist(); }
  updateAudio(settings: AudioSettings) { this.current.audio = decodeAudioSettings(settings); return this.persist(); }
  private persist() {
    const snapshot = structuredClone(this.current);
    this.queue = this.queue.then(async () => {
      try {
        await this.backend.save(snapshot);
        this.error = null;
        this.onStatus('');
      } catch (error) {
        this.error = error instanceof Error ? error : new Error(String(error));
        this.onStatus(`設定を保存できません：${this.error.message}`);
      }
    });
    return this.queue;
  }
  async flush() { await this.queue; if (this.error) throw this.error; }
  async replace(input: unknown) {
    const decoded = decodeSettings(input);
    const previous = structuredClone(this.current);
    await this.flush();
    this.current = decoded;
    await this.persist();
    if (this.error) { this.current = previous; throw this.error; }
  }
  async exportJson() { return JSON.stringify(this.current, null, 2); }
}

export function settingsBackend(): SettingsBackend {
  if (isTauri()) return {
    load: () => invoke('load_settings'),
    save: settings => invoke('save_settings', { settings }),
  };
  // This adapter is for UI development. The desktop application uses the Rust store.
  const key = 'fret-notes-desktop-preview-v1';
  return {
    async load() { const stored = localStorage.getItem(key); return { settings: stored ? decodeSettings(JSON.parse(stored)) : defaults(), recovered: false }; },
    async save(settings) { localStorage.setItem(key, JSON.stringify(settings)); },
  };
}
