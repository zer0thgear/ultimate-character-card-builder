'use client';

import { api } from '@/lib/api';

// Extensions' own data (uccb.storage), cached once read; forgotten when an
// extension is uninstalled (store/packStore.ts).

const cache = new Map<string, Record<string, unknown>>();

export async function readPackData(id: string): Promise<Record<string, unknown>> {
  let d = cache.get(id);
  if (!d) {
    d = await api.getPackData(id);
    cache.set(id, d);
  }
  return d;
}

export async function writePackData(id: string, data: Record<string, unknown>) {
  cache.set(id, await api.savePackData(id, data));
}

export const forgetPackData = (id: string) => cache.delete(id);
