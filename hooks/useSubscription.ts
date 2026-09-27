'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import type { NovelAISubscription } from '@/types/novelai';
import { useSessionStore } from '@/store/sessionStore';

// The NovelAI account's tier, Anlas balance and Opus allowance
// (GET /user/subscription, which the persistent key can read), for cost
// estimates and the balance shown by the Generate button and in Settings.
// Refreshed after each generation. NovelAI serves it from the image host
// now; api.novelai.net answers third-party tools with a 400.

const SUBSCRIPTION_URL = 'https://image.novelai.net/user/subscription';

interface SubState {
  subscription: NovelAISubscription | null;
  forKey: string;
  /** Why the last read failed, if it did. */
  error: string | null;
  refresh: () => Promise<void>;
}

export const useSubscriptionStore = create<SubState>((set) => ({
  subscription: null,
  forKey: '',
  error: null,
  refresh: async () => {
    const key = useSessionStore.getState().apiKey;
    if (!key) return set({ subscription: null, forKey: '', error: null });
    try {
      const res = await fetch(SUBSCRIPTION_URL, { headers: { Authorization: `Bearer ${key}` } });
      if (res.ok) return set({ subscription: (await res.json()) as NovelAISubscription, forKey: key, error: null });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      set({ forKey: key, error: body?.message || `NovelAI answered ${res.status}` });
    } catch {
      set({ forKey: key, error: "Couldn't reach NovelAI" });
    }
  },
}));

export function useSubscription() {
  const apiKey = useSessionStore((s) => s.apiKey);
  const { subscription, forKey, error, refresh } = useSubscriptionStore();
  useEffect(() => {
    if (apiKey && useSubscriptionStore.getState().forKey !== apiKey) void refresh();
  }, [apiKey, refresh]);
  const current = apiKey && forKey === apiKey;
  const s = current ? subscription : null;
  const anlas = s ? s.trainingStepsLeft.fixedTrainingStepsLeft + s.trainingStepsLeft.purchasedTrainingSteps : null;
  return { subscription: s, anlas, error: current ? error : null, refresh };
}
