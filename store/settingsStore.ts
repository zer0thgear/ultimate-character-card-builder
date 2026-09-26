import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  BasePrompt,
  CharacterPromptEntry,
  LibraryTidbit,
  NovelAIModel,
  NovelAISampler,
  NovelAINoiseSchedule,
  PromptMode,
  PromptTidbit,
} from '@/types/novelai';
import { QualityLevel, UcLevel } from '@/lib/naiPresets';

// The image generator's settings, in the same shape as NovelFrontEnd's so
// its request builder (lib/imageRequest.ts) works unchanged. The prompt
// fields (base prompts, characters, negative) belong to the open card and
// are swapped in and out with it (see store/projectStore.ts); the rest are
// global and persist in localStorage.

export interface FormSettings {
  basePrompts: BasePrompt[];
  promptMode: PromptMode;
  furMode: boolean;
  nsfwMode: boolean;
  transparentBg: boolean;
  qualityPreset: QualityLevel;
  ucPreset: UcLevel;
  negativePrompt: string;
  negativeTidbits: PromptTidbit[];
  model: NovelAIModel;
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: NovelAISampler;
  noiseSchedule: NovelAINoiseSchedule;
  seed: number;
  smea: boolean;
  smeaDyn: boolean;
  cfgRescale: number;
  variety: boolean;
  characters: CharacterPromptEntry[];
  useCoords: boolean;
  streamingMode: boolean;
  /** Reusable prompt pieces shared across every card (`__Label__`). */
  tidbitLibrary: LibraryTidbit[];
  /** How many images one Generate makes (queued one after another). */
  copies: number;
}

/** The fields that belong to a card rather than to the generator. */
export const PROJECT_GEN_KEYS = ['basePrompts', 'characters', 'negativePrompt', 'negativeTidbits'] as const;

interface SettingsState extends FormSettings {
  set: <K extends keyof FormSettings>(key: K, value: FormSettings[K]) => void;
  patch: (values: Partial<FormSettings>) => void;
}

export const DEFAULT_NEGATIVE =
  'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]';

export const GEN_DEFAULTS: FormSettings = {
  basePrompts: [{ id: 'p-default', label: 'Prompt 1', text: '', selected: true }],
  promptMode: 'single',
  furMode: false,
  nsfwMode: false,
  transparentBg: false,
  qualityPreset: 'standard',
  ucPreset: 'none',
  negativePrompt: DEFAULT_NEGATIVE,
  negativeTidbits: [],
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  scale: 6,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  seed: 0,
  smea: false,
  smeaDyn: false,
  cfgRescale: 0,
  variety: false,
  characters: [],
  useCoords: false,
  streamingMode: false,
  tidbitLibrary: [],
  copies: 1,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (setState) => ({
      ...GEN_DEFAULTS,
      set: (key, value) => setState((state) => ({ ...state, [key]: value })),
      patch: (values) => setState((state) => ({ ...state, ...values })),
    }),
    {
      name: 'uccb-gen-settings',
      storage: createJSONStorage(() => localStorage),
      // The card's prompt fields are saved with the card, not here.
      partialize: (s) =>
        Object.fromEntries(
          Object.entries(s).filter(([k, v]) => typeof v !== 'function' && !(PROJECT_GEN_KEYS as readonly string[]).includes(k)),
        ) as Partial<SettingsState>,
    },
  ),
);
