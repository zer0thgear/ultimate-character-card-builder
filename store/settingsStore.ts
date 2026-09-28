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
import { serverStorage } from '@/lib/serverSettings';
import type { ImageConnection } from '@/types/imageBackend';

// The image generator's settings, in the shape the request builder
// (lib/imageRequest.ts) reads. The prompt
// fields (base prompts, characters, negative) belong to the open card and
// are swapped in and out with it (see store/projectStore.ts); the rest are
// global, kept on the server so every device shares them (lib/serverSettings.ts).

export interface FormSettings {
  /** Style and artist tags, in front of the prompt on every gen (the card's;
   *  lib/imageRequest.ts composeFinalPrompts). The ✨ prompt writers leave
   *  it alone, so the style holds whatever they write. */
  stylePrompt: string;
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
  /** ✨ From greeting also places the characters (grid positions). Off,
   *  NovelAI decides where they go. */
  placeCharacters: boolean;
  /** Where gens are made: NovelAI, A1111 or ComfyUI connections
   *  (store/imageConnections.ts). None, and the generator is locked. */
  imageConnections: ImageConnection[];
  imageConnectionId: string | null;
  /** Set once an existing NovelAI setup has been given its connection. */
  imageConnectionsMigrated: boolean;
}

/** The fields that belong to a card rather than to the generator. */
export const PROJECT_GEN_KEYS = ['stylePrompt', 'nsfwMode', 'furMode', 'basePrompts', 'characters', 'negativePrompt', 'negativeTidbits'] as const;

interface SettingsState extends FormSettings {
  set: <K extends keyof FormSettings>(key: K, value: FormSettings[K]) => void;
  patch: (values: Partial<FormSettings>) => void;
}

export const DEFAULT_NEGATIVE =
  'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]';

export const GEN_DEFAULTS: FormSettings = {
  stylePrompt: '',
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
  placeCharacters: false,
  imageConnections: [],
  imageConnectionId: null,
  imageConnectionsMigrated: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (setState) => ({
      ...GEN_DEFAULTS,
      set: (key, value) => setState((state) => ({ ...state, [key]: value })),
      patch: (values) => setState((state) => ({ ...state, ...values })),
    }),
    {
      name: 'gen',
      storage: createJSONStorage(() => serverStorage),
      // Loaded by lib/hydrate.ts before the app renders.
      skipHydration: true,
      // The card's prompt fields are saved with the card, not here.
      partialize: (s) =>
        Object.fromEntries(
          Object.entries(s).filter(([k, v]) => typeof v !== 'function' && !(PROJECT_GEN_KEYS as readonly string[]).includes(k)),
        ) as Partial<SettingsState>,
    },
  ),
);
