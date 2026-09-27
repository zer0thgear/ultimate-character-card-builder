// Recent gens as the server keeps them (app/api/recent-gens): each gen's
// details without what only lives in this page (its object URLs and the
// image itself, which goes alongside as a PNG).

/** Fields a gen can change after it's made, which are sent back as a patch. */
export const RECENT_PATCH_KEYS = ['savedPath', 'keptFile', 'pinned', 'parameters'] as const;

/** Strings longer than this in the request are images (an Img2Img base, a
 *  mask, reference images), not prompts, and aren't worth keeping. */
const MAX_STRING = 20_000;

function stripImages(value: unknown): unknown {
  if (typeof value === 'string') return value.length > MAX_STRING ? undefined : value;
  if (Array.isArray(value)) return value.map(stripImages).filter((v) => v !== undefined);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const kept = stripImages(v);
      if (kept !== undefined) out[k] = kept;
    }
    return out;
  }
  return value;
}

/** A gen's details for the server. */
export function toRecentMeta<T extends { id: string; timestamp: number }>(img: T): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...img };
  for (const k of ['url', 'blob', 'sourceImageUrl', 'stored']) delete rest[k];
  return stripImages(rest) as Record<string, unknown>;
}

/** The part of a patch the server keeps. */
export function recentPatch(patch: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const k of RECENT_PATCH_KEYS) if (k in patch) out[k] = stripImages(patch[k]) ?? null;
  return Object.keys(out).length ? out : null;
}
