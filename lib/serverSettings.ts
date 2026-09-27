'use client';

import type { StateStorage } from 'zustand/middleware';

// Settings kept on UCCB's server (data/settings.json) instead of in the
// browser, so every device, and every address this one is opened at
// (localhost, the Tailscale name…), shares them. Browsers keep saved data
// per address, which is why localStorage alone didn't carry over.
//
// Stores persist through `serverStorage` under one of the section names.
// Nothing is written back until a section has been read, so a store's
// defaults can't overwrite the saved settings while the page is starting.

export type Section = 'gen' | 'llm' | 'naiKey';

/** What each section was called in localStorage, to bring it across once. */
const LEGACY_KEY: Record<Section, string> = { gen: 'uccb-gen-settings', llm: 'uccb-llm', naiKey: 'uccb-nai-key' };

let cache: Partial<Record<Section, unknown>> = {};
let loading: Promise<void> | null = null;
const loaded = new Set<Section>();
const timers = new Map<Section, ReturnType<typeof setTimeout>>();
/** What was last sent or received per section, to spot changes made elsewhere. */
const known = new Map<Section, string>();

export function loadSettings(force = false): Promise<void> {
  if (!loading || force) {
    loading = fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : {}))
      .then((all: Partial<Record<Section, unknown>>) => {
        cache = all ?? {};
      })
      .catch(() => {
        cache = {};
      });
  }
  return loading;
}

function send(section: Section, value: unknown) {
  known.set(section, JSON.stringify(value));
  const prev = timers.get(section);
  if (prev) clearTimeout(prev);
  timers.set(
    section,
    setTimeout(() => {
      timers.delete(section);
      void fetch(`/api/settings/${section}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    }, 400),
  );
}

function legacy(section: Section): string | null {
  try {
    return localStorage.getItem(LEGACY_KEY[section]);
  } catch {
    return null;
  }
}

/** The saved value for a section: the server's, or (the first time) the one
 *  this browser kept in localStorage, which is then saved to the server. */
export async function readSection(section: Section): Promise<unknown> {
  await loadSettings();
  let value = cache[section];
  if (value === undefined) {
    const old = legacy(section);
    if (old !== null) {
      try {
        value = section === 'naiKey' ? old : JSON.parse(old);
      } catch {
        value = undefined;
      }
      if (value !== undefined) send(section, value);
    }
  }
  loaded.add(section);
  if (value !== undefined) known.set(section, JSON.stringify(value));
  return value;
}

export function writeSection(section: Section, value: unknown) {
  if (!loaded.has(section)) return;
  cache[section] = value;
  send(section, value);
}

/** zustand/persist storage over a section (the store's persist `name`). */
export const serverStorage: StateStorage = {
  getItem: async (name) => {
    const v = await readSection(name as Section);
    return v === undefined ? null : JSON.stringify(v);
  },
  setItem: (name, value) => writeSection(name as Section, JSON.parse(value)),
  removeItem: (name) => writeSection(name as Section, null),
};

/**
 * Re-reads the settings (when the page comes back into focus, say) and
 * reports the sections another device changed meanwhile, for their stores
 * to reload. Sections with a write still pending are left alone.
 */
export async function changedElsewhere(): Promise<Section[]> {
  await loadSettings(true);
  const out: Section[] = [];
  for (const s of loaded) {
    if (timers.has(s)) continue;
    const now = JSON.stringify(cache[s]);
    if (cache[s] !== undefined && now !== known.get(s)) {
      known.set(s, now);
      out.push(s);
    }
  }
  return out;
}
