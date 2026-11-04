import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TauriEvent } from '@tauri-apps/api/event';
import { createCloseHandler } from '../src/platform/window-lifecycle';
import { SettingsRepository, defaults } from '../src/platform/settings';
import { normalize as practiceSettings } from '../src/domain/instruments/core';
import { normalize as studySettings } from '../src/domain/music/theory';

test('native close waits for settings and has permission to destroy the window', async t => {
  const permissions = JSON.parse(await readFile(new URL('../src-tauri/capabilities/main.json', import.meta.url), 'utf8')).permissions as string[];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const mockWindow = { crypto: globalThis.crypto, __TAURI_INTERNALS__: {} as { callbacks: Map<number, (event: unknown) => Promise<void>> } };
  Object.defineProperty(globalThis, 'window', { value: mockWindow, configurable: true });
  try {
    async function register(flush: () => Promise<void>, onError: (error: unknown) => void) {
      let listenerId = 0;
      const commands: string[] = [];
      mockIPC((command, args) => {
        if (command === 'plugin:event|listen') { listenerId = (args as { handler: number }).handler; return 1; }
        // Model the native ACL, so a missing allow-destroy reproduces the original failure.
        if (command.startsWith('plugin:window|')) {
          const action = command.split('|')[1];
          if (!permissions.includes(`core:window:allow-${action}`)) throw new Error(`Window permission denied: ${action}`);
          commands.push(action);
          return;
        }
        throw new Error(`Unexpected command: ${command}`);
      });
      mockWindows('main');
      await getCurrentWindow().onCloseRequested(createCloseHandler(flush, onError));
      const callback = mockWindow.__TAURI_INTERNALS__.callbacks.get(listenerId)!;
      assert.ok(callback);
      return { commands, close: () => callback({ event: TauriEvent.WINDOW_CLOSE_REQUESTED, id: 1, payload: null }) };
    }

    await t.test('X waits for a queued save, then destroys exactly once', async () => {
      let finishSave!: () => void;
      const pendingSave = new Promise<void>(resolve => { finishSave = resolve; });
      const repository = new SettingsRepository({
        async load() { return { settings: defaults(), recovered: false }; },
        async save() { await pendingSave; },
      });
      await repository.load();
      repository.update('guitar', { ...practiceSettings(), ...studySettings() }, 'guitar', 4);
      const native = await register(() => repository.flush(), error => { throw error; });
      const firstClose = native.close();
      await native.close(); // A second click while saving cannot bypass the save.
      assert.deepEqual(native.commands, []);
      finishSave();
      await firstClose;
      assert.deepEqual(native.commands, ['destroy']);
      await native.close();
      assert.deepEqual(native.commands, ['destroy']);
    });

    await t.test('X closes when there are no outstanding writes', async () => {
      const native = await register(async () => {}, error => { throw error; });
      await native.close();
      assert.deepEqual(native.commands, ['destroy']);
    });

    await t.test('a failed save keeps the window for export; the next X exits', async () => {
      const errors: unknown[] = [];
      const failure = new Error('disk full');
      const native = await register(async () => { throw failure; }, error => { errors.push(error); });
      await native.close();
      assert.deepEqual(native.commands, []);
      assert.deepEqual(errors, [failure]);
      await native.close();
      assert.deepEqual(native.commands, ['destroy']);
    });
  } finally {
    clearMocks();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
