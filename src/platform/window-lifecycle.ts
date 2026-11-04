import type { CloseRequestedEvent } from '@tauri-apps/api/window';

/** Waits for every store, even when one fails, then reports the first failure. */
export function flushAll(...flushes: (() => Promise<void>)[]) {
  return async () => {
    const results = await Promise.allSettled(flushes.map(flush => flush()));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
  };
}

/** Tauri awaits this handler, then destroys the window unless closing was prevented. */
export function createCloseHandler(flush: () => Promise<void>, onSaveError: (error: unknown) => void) {
  let state: 'idle' | 'saving' | 'ready' | 'failed' = 'idle';
  return async (event: Pick<CloseRequestedEvent, 'preventDefault'>) => {
    // A second deliberate close after an error lets the user exit without saving.
    if (state === 'failed') return;
    if (state !== 'idle') { event.preventDefault(); return; }
    state = 'saving';
    try {
      await flush();
      state = 'ready';
    } catch (error) {
      event.preventDefault();
      state = 'failed';
      onSaveError(error);
    }
  };
}
