import { describe, expect, it } from 'vitest';
import { EXPIRY_WARNING_MS, expiresIn, shortTimeLeft } from '@/lib/recentGens';

const day = 86_400_000;

describe('recent gen expiry', () => {
  it('counts down from when it was made', () => {
    expect(expiresIn({ timestamp: 0 }, 7, 6 * day)).toBe(day);
    expect(expiresIn({ timestamp: 0 }, 7, 6.5 * day)! < EXPIRY_WARNING_MS).toBe(true);
    expect(expiresIn({ timestamp: 0 }, 7, 8 * day)).toBe(0);
  });
  it("doesn't for ones kept forever, kept with a card or saved", () => {
    expect(expiresIn({ timestamp: 0 }, 0, day)).toBeNull();
    expect(expiresIn({ timestamp: 0, keptFile: 'a.png' }, 7, day)).toBeNull();
    expect(expiresIn({ timestamp: 0, savedPath: '/x.png' }, 7, day)).toBeNull();
  });
  it('says the time left briefly', () => {
    expect(shortTimeLeft(5 * 3_600_000)).toBe('5h');
    expect(shortTimeLeft(40 * 60_000)).toBe('40m');
    expect(shortTimeLeft(0)).toBe('1m');
  });
});
