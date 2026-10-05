'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { PackUi } from '@/lib/extensionPack';
import { buildSrcdoc, callAllowed, METHOD_PERMISSION, PERMISSIONS, type SandboxContext } from '@/lib/extensionSandbox';
import { usePackStore } from '@/store/packStore';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { Modal, cx } from '@/components/ui';
import { CallError, cardView, handleCall } from '@/components/extensions/hostApi';

// One piece of an extension's UI, in a sandboxed frame (lib/extensionSandbox.ts),
// and the dialogs extensions open.

type FrameUi = PackUi & { packId: string; packName: string };

export function SandboxFrame({ ui, field, data, fill = false, onClose, className }: { ui: FrameUi; field?: SandboxContext['field']; data?: unknown; fill?: boolean; onClose?: () => void; className?: string }) {
  const installed = usePackStore((s) => s.packs.find((p) => p.pack.id === ui.packId));
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const [left, setLeft] = useState(false);
  const loads = useRef(0);
  const granted = useMemo(() => (installed?.codeApproved ? (installed.granted ?? []) : []), [installed]);

  // Built once per version of the pack: a theme change is sent as an
  // event, so the frame keeps its state.
  const srcdoc = useMemo(() => {
    if (!installed) return '';
    const p = installed.pack;
    return buildSrcdoc({
      html: p.files?.[ui.entry] ?? '',
      files: p.files,
      network: p.network,
      context: { pack: { id: p.id, name: p.name, version: p.version }, ui: { id: ui.id, slot: ui.slot, label: ui.label }, granted, theme: useUiStore.getState().theme, ...(field ? { field } : {}), ...(data !== undefined ? { data } : {}) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed?.updatedAt, installed?.codeApproved, granted, ui.id]);

  useEffect(() => {
    const post = (msg: unknown) => ref.current?.contentWindow?.postMessage(msg, '*');
    const onMessage = async (e: MessageEvent) => {
      // Only this frame's own messages; its origin is opaque ("null").
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const m = e.data as { uccb?: number; id?: number; method?: string; params?: unknown; resize?: number };
      if (!m || m.uccb !== 1) return;
      if (typeof m.resize === 'number') {
        setHeight(Math.max(40, Math.min(m.resize, 4000)));
        return;
      }
      if (typeof m.id !== 'number' || typeof m.method !== 'string') return;
      if (!callAllowed(m.method, granted)) {
        const need = METHOD_PERMISSION[m.method];
        post({ uccb: 1, id: m.id, error: need ? `This needs the "${need}" permission (${PERMISSIONS[need]}), which the extension doesn't have.` : `Unknown call ${m.method}.` });
        return;
      }
      try {
        const result = await handleCall({ packId: ui.packId, packName: ui.packName, openDialog: (id, d) => openExtDialog({ packId: ui.packId, uiId: id, data: d }), close: onClose }, m.method, m.params);
        post({ uccb: 1, id: m.id, result: result ?? null });
      } catch (err) {
        post({ uccb: 1, id: m.id, error: err instanceof CallError ? err.message : `Couldn't do that: ${(err as Error).message}` });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [granted, ui.packId, ui.packName, onClose]);

  // Events: the card changing (with card:read), and the theme.
  useEffect(() => {
    const post = (event: string, d: unknown) => ref.current?.contentWindow?.postMessage({ uccb: 1, event, data: d }, '*');
    const offTheme = useUiStore.subscribe((s, prev) => s.theme !== prev.theme && post('theme', s.theme));
    if (!granted.includes('card:read')) return offTheme;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offCard = useProjectStore.subscribe((s, prev) => {
      if (s.project?.card.data === prev.project?.card.data && s.project?.id === prev.project?.id) return;
      clearTimeout(timer);
      timer = setTimeout(() => post('card', cardView()), 300);
    });
    return () => {
      offTheme();
      offCard();
      clearTimeout(timer);
    };
  }, [granted]);

  if (!installed) return null;
  if (left)
    return <p className="p-3 text-xs text-amber-300/90">🧩 {ui.packName} tried to load another page in its frame, so it was stopped. Extensions must stay on their own page.</p>;
  return (
    <iframe
      ref={ref}
      title={`${ui.packName}: ${ui.label}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow=""
      srcDoc={srcdoc}
      onLoad={() => {
        // A second load means it navigated away from its own page.
        loads.current += 1;
        if (loads.current > 1) setLeft(true);
      }}
      className={cx('block w-full border-0 bg-transparent', fill && 'h-full', className)}
      style={fill ? undefined : { height }}
    />
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

interface ExtDialog {
  packId: string;
  uiId: string;
  field?: SandboxContext['field'];
  data?: unknown;
}

const useExtDialog = create<{ open: ExtDialog | null; set: (d: ExtDialog | null) => void }>((set) => ({ open: null, set: (open) => set({ open }) }));

/** Opens one of an extension's dialogs (a field action or command, or one
 *  the extension asks for). */
export const openExtDialog = (d: ExtDialog) => useExtDialog.getState().set(d);

/** Extensions' dialogs, mounted once (Shell). */
export function ExtDialogHost() {
  const open = useExtDialog((s) => s.open);
  const set = useExtDialog((s) => s.set);
  const ui = usePackStore((s) => (open ? s.layer.ui.find((u) => u.packId === open.packId && u.id === open.uiId) : undefined));
  if (!open || !ui) return null;
  const close = () => set(null);
  return (
    <Modal open onClose={close} title={`${ui.icon ? `${ui.icon} ` : ''}${ui.label}`} size="lg">
      <p className="mb-1 text-[11px] text-slate-500">🧩 {ui.packName}</p>
      <SandboxFrame key={`${open.packId}.${open.uiId}.${open.field?.path ?? ''}`} ui={ui} field={open.field} data={open.data} onClose={close} className="max-h-[70vh] overflow-auto" />
    </Modal>
  );
}
