import 'server-only';
import local from '@local/server';
import type { ServerExtension } from '@/lib/extensions/types';

// The local extensions' server halves (see types.ts), by id.

export const serverExtensions = new Map<string, ServerExtension>(local.map((e) => [e.id, e]));
