import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from '@/lib/uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes v4 UUIDs', () => {
    expect(uuid()).toMatch(V4);
  });

  it('works where crypto.randomUUID is missing (plain http from another device)', () => {
    vi.stubGlobal('isSecureContext', false);
    const ids = new Set(Array.from({ length: 50 }, uuid));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
  });
});
