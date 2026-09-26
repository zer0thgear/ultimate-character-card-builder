'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import type { NovelAISubscription } from '@/types/novelai';
import { useSessionStore } from '@/store/sessionStore';

// The NovelAI account's tier and Anlas balance (GET /user/subscription,
// which the persistent key can read), for cost estimates and the balance
// shown by the Generate button. Refreshed after each generation.

interface SubState {
  subscription: NovelAISubscription | null;
  forKey: string;
  refresh: () => Promise<void>;
}

export const useSubscriptionStore = create<SubState>((set) => ({
  subscription: null,
  forKey: '',
  refresh: async () => {
    const key = useSessionStore.getState().apiKey;
    if (!key) return set({ subscription: null, forKey: '' });
    try {
      const res = await fetch('https://api.novelai.net/user/subscription', { headers: { Authorization: `Bearer ${key}` } });
      if (res.ok) set({ subscription: (await res.json()) as NovelAISubscription, forKey: key });
    } catch {
      /* offline: estimates assume no Opus */
    }
  },
}));

export function useSubscription() {
  const apiKey = useSessionStore((s) => s.apiKey);
  const { subscription, forKey, refresh } = useSubscriptionStore();
  useEffect(() => {
    if (apiKey && useSubscriptionStore.getState().forKey !== apiKey) void refresh();
  }, [apiKey, refresh]);
  const s = apiKey && forKey === apiKey ? subscription : null;
  const anlas = s ? s.trainingStepsLeft.fixedTrainingStepsLeft + s.trainingStepsLeft.purchasedTrainingSteps : null;
  return { subscription: s, anlas, refresh };
}
