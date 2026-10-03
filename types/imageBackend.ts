// Image generation connections: NovelAI (UCCB's own request builder, sent
// from the browser as NovelAI's client does), or a local or remote Stable
// Diffusion server, reached through UCCB's server (app/api/image/*):
// A1111's API (A1111, Forge, reForge, SD.Next) or ComfyUI's.

export type ImageBackendKind = 'novelai' | 'a1111' | 'comfyui';

/** A ComfyUI workflow in its API format ("Export (API)"): node id → node. */
export type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export interface ImageConnection {
  id: string;
  name: string;
  kind: ImageBackendKind;
  /** A1111 and ComfyUI: where the server is, e.g. http://127.0.0.1:7860. */
  baseUrl: string;
  /** A1111: `user:password` (its --api-auth). ComfyUI: a key sent as a
   *  Bearer token, for one behind a proxy. Blank for none. */
  auth: string;
  /** Picked from the server's lists; blank keeps the server's (A1111's
   *  loaded checkpoint, or a workflow's own). */
  checkpoint: string;
  sampler: string;
  scheduler: string;
  /** ComfyUI: your workflow, or null for UCCB's built-in txt2img one. */
  workflow: ComfyWorkflow | null;
  workflowName?: string;
}

/** One gen for A1111 or ComfyUI, built in the browser (lib/imageBackends.ts). */
export interface BackendGenRequest {
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  checkpoint: string;
  sampler: string;
  scheduler: string;
  /** Img2Img: the base as base64 PNG, and how much to change it. */
  init?: { image: string; strength: number };
}

/** What a server offers, for the pickers. */
export interface BackendOptions {
  checkpoints: string[];
  samplers: string[];
  schedulers: string[];
  /** A1111: the checkpoint it has loaded now. */
  current?: string;
}

/** Where a gen from another backend came from, kept with it. */
export interface BackendInfo {
  kind: Exclude<ImageBackendKind, 'novelai'>;
  connection: string;
  checkpoint?: string;
  sampler?: string;
  scheduler?: string;
}
