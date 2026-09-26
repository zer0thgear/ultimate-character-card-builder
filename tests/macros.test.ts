import { describe, expect, it } from 'vitest';
import { expandMacros } from '@/lib/macros';

const ctx = { char: 'Ann', user: 'Bob', random: () => 0.99 };

describe('expandMacros', () => {
  it('replaces names in both styles', () => {
    expect(expandMacros('{{char}} greets {{User}}. <BOT>/<user>', ctx)).toBe('Ann greets Bob. Ann/Bob');
  });

  it('rolls {{random}} with either separator', () => {
    expect(expandMacros('{{random:a,b,c}}', ctx)).toBe('c');
    expect(expandMacros('{{random::x, y::z}}', ctx)).toBe('z');
  });

  it('drops comments and keeps unknown macros', () => {
    expect(expandMacros('a{{// note}}b {{unknown}}', ctx)).toBe('ab {{unknown}}');
  });

  it('fills {{original}} and rolls dice', () => {
    expect(expandMacros('{{original}} extra', { ...ctx, original: 'Base.' })).toBe('Base. extra');
    expect(expandMacros('{{roll:2d6}}', ctx)).toBe('12');
  });

  it('trims around {{trim}}', () => {
    expect(expandMacros('a   {{trim}}\n b', ctx)).toBe('ab');
  });
});
