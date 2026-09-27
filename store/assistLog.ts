'use client';

import { create } from 'zustand';
import type { LlmMessage, SamplerParams } from '@/types/llm';

// The writing assistant's recent requests, exactly as sent (the job's
// prompt, wrapped in the assistant's preset if one is on), with what came
// back: reasoning and reply, live while streaming. Every assistant surface
// can show its own run's reasoning and prompt from here, and Settings →
// Assistant lists them all. Kept for the session only.

export interface AssistRun {
  id: string;
  /** What asked: "✨ Description", "Card tags"… */
  label: string;
  at: number;
  connection: string;
  model: string;
  messages: LlmMessage[];
  params: Partial<SamplerParams>;
  /** The preset it was wrapped in, if any. */
  preset?: string;
  text: string;
  reasoning: string;
  running: boolean;
  error?: string;
}

const KEEP = 30;

interface AssistLogState {
  runs: AssistRun[];
  add: (run: AssistRun) => void;
  update: (id: string, patch: Partial<AssistRun>) => void;
  /** The run a surface is showing (its "🔍"), or null. */
  inspecting: string | null;
  inspect: (id: string | null) => void;
}

export const useAssistLog = create<AssistLogState>((set) => ({
  runs: [],
  add: (run) => set((s) => ({ runs: [run, ...s.runs].slice(0, KEEP) })),
  update: (id, patch) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  inspecting: null,
  inspect: (inspecting) => set({ inspecting }),
}));

export const useAssistRun = (id: string | null | undefined) => useAssistLog((s) => (id ? (s.runs.find((r) => r.id === id) ?? null) : null));
