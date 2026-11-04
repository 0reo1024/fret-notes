export interface AudioSettings { deviceId: string | null; channel: number; referenceHz: number; gateDb: number }
export const defaultAudioSettings = (): AudioSettings => ({ deviceId: null, channel: 0, referenceHz: 440, gateDb: -55 });
export function decodeAudioSettings(input: unknown): AudioSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('音声入力の設定が不正です');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['deviceId','channel','referenceHz','gateDb'].includes(key))
    || !(value.deviceId === null || typeof value.deviceId === 'string' && value.deviceId.length > 0 && new TextEncoder().encode(value.deviceId).length <= 1024)
    || typeof value.channel !== 'number' || !Number.isInteger(value.channel) || value.channel < 0 || value.channel >= 64
    || typeof value.referenceHz !== 'number' || !Number.isFinite(value.referenceHz) || value.referenceHz < 400 || value.referenceHz > 480
    || typeof value.gateDb !== 'number' || !Number.isFinite(value.gateDb) || value.gateDb < -80 || value.gateDb > -20) throw new Error('入力チャンネル・基準周波数・感度を確認してください');
  return { deviceId: value.deviceId as string | null, channel: value.channel, referenceHz: value.referenceHz, gateDb: value.gateDb };
}
