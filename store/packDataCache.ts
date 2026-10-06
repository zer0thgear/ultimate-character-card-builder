'use client';

import { api } from '@/lib/api';

// Extensions' own data (uccb.storage), cached once read; forgotten when an
// extension is uninstalled (store/packStore.ts).

const cache = new Map<string, Record<string, unknown>>();
/** Data still to be saved (the latest only), and the save under way. */
const waiting = new Map<string, Record<string, unknown>>();
const saving = new Map<string, Promise<void>>();

export async function readPackData(id: string): Promise<Record<string, unknown>> {
  let d = cache.get(id);
  if (!d) {
    const read = await api.getPackData(id);
    // A change made while it was being read wins.
    d = cache.get(id) ?? read;
    cache.set(id, d);
  }
  return d;
}

/** Saves what's waiting, one save at a time; changes made meanwhile go
 *  together in the next. Fails if the last save did. */
async function drain(id: string) {
  let failed: unknown = null;
  for (let data = waiting.get(id); data; data = waiting.get(id)) {
    waiting.delete(id);
    try {
      await api.savePackData(id, data);
      failed = null;
    } catch (err) {
      failed = err;
    }
  }
  // Done, in the same step as finding nothing waiting: a change made after
  // this starts a save of its own.
  saving.delete(id);
  if (failed) throw failed;
}

/**
 * Changes an extension's data and saves it. The change is made on the
 * latest data at once (so quick calls build on each other rather than one
 * undoing another); saves go one at a time, in order, and a burst of
 * changes made during one goes to the server as a single save.
 */
export async function updatePackData(id: string, change: (data: Record<string, unknown>) => Record<string, unknown>) {
  await readPackData(id);
  const next = change(cache.get(id) ?? {});
  cache.set(id, next);
  waiting.set(id, next);
  let run = saving.get(id);
  if (!run) {
    run = drain(id);
    saving.set(id, run);
  }
  await run;
}

export const forgetPackData = (id: string) => cache.delete(id);
