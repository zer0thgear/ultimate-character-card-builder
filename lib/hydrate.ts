'use client';

import { useSettingsStore } from '@/store/settingsStore';
import { useLlmStore } from '@/store/llmStore';
import { useSessionStore } from '@/store/sessionStore';
import { changedElsewhere, loadSettings, readSection } from '@/lib/serverSettings';
import { migrateImageConnections } from '@/store/imageConnections';

// Loads the settings every device shares before the app first renders, and
// picks up changes made on another device (settings, recent gens) when this
// one comes back into focus.

async function loadNaiKey() {
  const key = await readSection('naiKey');
  useSessionStore.getState().loadApiKey(typeof key === 'string' ? key : '');
}

export async function hydrateSettings() {
  await loadSettings();
  await Promise.all([useSettingsStore.persist.rehydrate(), useLlmStore.persist.rehydrate(), loadNaiKey()]);
  migrateImageConnections();
  // Recent gens come in behind the first render; they're only pictures.
  void useSessionStore.getState().syncStored();

  const refresh = async () => {
    void useSessionStore.getState().syncStored();
    for (const s of await changedElsewhere()) {
      if (s === 'gen') void useSettingsStore.persist.rehydrate();
      else if (s === 'llm') void useLlmStore.persist.rehydrate();
      else void loadNaiKey();
    }
  };
  window.addEventListener('focus', () => void refresh());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refresh());
}
