'use client';

import local from '@local/client';
import type { ClientExtension, ImageAction } from '@/lib/extensions/types';

// The local extensions installed in this copy (see types.ts), for the app's
// extension slots.

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export const clientExtensions: ClientExtension[] = local.filter((e) => ID_RE.test(e.id));

/** Every extension's image actions, in order. */
export const imageActions: (ImageAction & { extension: string })[] = clientExtensions.flatMap((e) => (e.imageActions ?? []).map((a) => ({ ...a, extension: e.id })));
