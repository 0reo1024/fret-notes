import type { AudioController, AudioObservation } from '../../platform/audio';

/** A feature that judges live input. Only the visible one receives observations. */
export interface AudioConsumer { consume(observation: AudioObservation): void; sync(): void; pause(): void }

/** Owns the controller's callbacks so one input serves every feature without opening twice. */
export class AudioHub {
  private active: AudioConsumer | null = null;
  private listeners = new Set<() => void>();
  constructor(readonly controller: AudioController) {
    controller.onObservation = observation => this.active?.consume(observation);
    controller.onChange = () => { this.active?.sync(); for (const listener of this.listeners) listener(); };
  }
  get activeConsumer() { return this.active; }
  /** The previous consumer is paused so it keeps its question but drops pitch evidence. */
  setActiveConsumer(next: AudioConsumer | null) {
    if (next === this.active) return;
    const previous = this.active; this.active = next;
    previous?.pause();
  }
  onChange(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}

/** Hides the other features before showing the selected one: hiding releases the shared input
 * (consumer and audio panel), which would otherwise undo what the newly shown feature just claimed. */
export function switchFeatures(features: { selected: boolean; show(show: boolean): void }[]) {
  for (const feature of features) if (!feature.selected) feature.show(false);
  for (const feature of features) if (feature.selected) feature.show(true);
}
