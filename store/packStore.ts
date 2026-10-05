'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import { buildLayer, type ExtensionPack, type InstalledPack } from '@/lib/extensionPack';
import { emptyLayer, setPackLayer, type PackLayer } from '@/lib/packLayer';
import { forgetPackData } from '@/store/packDataCache';

// Installed extension packs (lib/extensionPack.ts), kept on the local server
// (data/packs/, one file each) so every device has the same ones. Whenever
// the list changes, the enabled packs are merged into the layer that the
// prompt builders read (lib/packLayer.ts).

interface PackState {
  packs: InstalledPack[];
  /** The enabled packs merged; also handed to lib/packLayer.ts. */
  layer: PackLayer;
  loaded: boolean;
  load: () => Promise<void>;
  /** Installs a pack (already checked), or updates the one with its id.
   *  `code`: whether you approved its code and permissions (unset: as before). */
  install: (pack: ExtensionPack, code?: boolean) => Promise<InstalledPack>;
  /** Approves (or stops) an installed pack's code and permissions. */
  setCodeApproved: (id: string, approved: boolean) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Uninstalls a pack: everything it added goes with it. */
  remove: (id: string) => Promise<void>;
}

export const usePackStore = create<PackState>((set, get) => {
  const apply = (packs: InstalledPack[]) => {
    const layer = buildLayer(packs);
    setPackLayer(layer);
    set({ packs, layer });
  };
  return {
    packs: [],
    layer: emptyLayer(),
    loaded: false,
    load: async () => {
      apply(await api.listPacks());
      set({ loaded: true });
    },
    install: async (pack, code) => {
      const before = get().packs.find((p) => p.pack.id === pack.id);
      const approved = code ?? !!before?.codeApproved;
      const saved = await api.installPack({ pack, enabled: before?.enabled ?? true, installedAt: before?.installedAt ?? Date.now(), updatedAt: Date.now(), ...(approved ? { codeApproved: true, granted: pack.permissions ?? [] } : {}) });
      apply(before ? get().packs.map((p) => (p.pack.id === pack.id ? saved : p)) : [...get().packs, saved]);
      return saved;
    },
    setEnabled: async (id, enabled) => {
      const p = get().packs.find((x) => x.pack.id === id);
      if (!p) return;
      apply(get().packs.map((x) => (x.pack.id === id ? { ...x, enabled } : x)));
      try {
        await api.savePack({ ...p, enabled });
      } catch (err) {
        apply(get().packs.map((x) => (x.pack.id === id ? p : x)));
        throw err;
      }
    },
    setCodeApproved: async (id, approved) => {
      const p = get().packs.find((x) => x.pack.id === id);
      if (!p) return;
      const rest: InstalledPack = { ...p };
      delete rest.codeApproved;
      delete rest.granted;
      const saved = await api.savePack(approved ? { ...rest, codeApproved: true, granted: p.pack.permissions ?? [] } : rest);
      apply(get().packs.map((x) => (x.pack.id === id ? saved : x)));
    },
    remove: async (id) => {
      await api.deletePack(id);
      forgetPackData(id);
      apply(get().packs.filter((p) => p.pack.id !== id));
    },
  };
});
