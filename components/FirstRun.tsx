'use client';

import { useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSessionStore } from '@/store/sessionStore';
import { useLlmStore } from '@/store/llmStore';
import { usePersonaStore } from '@/store/personaStore';
import { openSettings } from '@/components/SettingsDialog';
import { IconButton, cx } from '@/components/ui';

// Getting started, on the home screen until each step's done (or it's
// hidden): what UCCB needs set up, and a first card to chat with.

const HIDDEN_KEY = 'uccb-first-run-hidden';

function readHidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function FirstRunChecklist({ onNewCard }: { onNewCard: () => void }) {
  const [hidden, setHidden] = useState(readHidden);
  const { summaries, listed } = useProjectStore();
  const imageConnections = useSettingsStore((s) => s.imageConnections);
  const naiKey = useSessionStore((s) => s.apiKey);
  const llm = useLlmStore((s) => s.connections);
  const { personas, loaded: personasLoaded } = usePersonaStore();
  // Until everything's been read, nothing can be said to be missing.
  if (hidden || !listed || !personasLoaded) return null;

  const steps: { done: boolean; label: string; hint: string; action?: { label: string; run: () => void } }[] = [
    {
      done: imageConnections.length > 0 && !(imageConnections.some((c) => c.kind === 'novelai') && !naiKey),
      label: 'Set up image generation',
      hint: 'NovelAI (with your key), A1111 or ComfyUI, to draw your cards.',
      action: { label: 'Image settings', run: () => openSettings(imageConnections.some((c) => c.kind === 'novelai') && !naiKey ? 'general' : 'image') },
    },
    {
      done: llm.some((c) => !!c.model),
      label: 'Connect an LLM',
      hint: 'NovelAI, any OpenAI-compatible server (OpenRouter, KoboldCpp, llama.cpp…) or Claude, for the test chat and the writing assistant.',
      action: { label: 'LLM settings', run: () => openSettings('llm') },
    },
    {
      done: personas.length > 0,
      label: 'Say who you are (optional)',
      hint: 'A persona: your name and description in chats, as {{user}}. SillyTavern’s can be imported.',
      action: { label: 'Personas', run: () => openSettings('personas') },
    },
    {
      done: summaries.length > 0,
      label: 'Make or import your first card',
      hint: 'Start one here, import a PNG, JSON or CHARX card, or bring one in from Chub.',
      action: { label: '+ New card', run: onNewCard },
    },
    {
      done: summaries.some((s) => (s.chats ?? 0) > 0),
      label: 'Chat with it',
      hint: 'Open a card, then 💬 Test chat in the dock (or 💬 Switch to Chat) to see how it plays.',
    },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  const hide = () => {
    try {
      localStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      /* private mode: hidden for this visit */
    }
    setHidden(true);
  };
  return (
    <section aria-label="Getting started" className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Getting started</h2>
        <span className="text-xs text-slate-500">
          {steps.length - left} of {steps.length} done
        </span>
        <IconButton title="Hide this list (it won't come back on this device)" className="ml-auto" onClick={hide}>
          ✕
        </IconButton>
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 text-sm">
            <span className={cx('mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border text-[10px]', s.done ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : 'border-slate-600 text-transparent')}>✓</span>
            <span className="min-w-0 flex-1">
              <span className={cx(s.done ? 'text-slate-500 line-through' : 'text-slate-200')}>{s.label}</span>
              {!s.done && <span className="block text-xs text-slate-500">{s.hint}</span>}
            </span>
            {!s.done && s.action && (
              <button type="button" className="flex-shrink-0 rounded px-2 py-0.5 text-xs text-violet-300 hover:bg-violet-500/15" onClick={s.action.run}>
                {s.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
