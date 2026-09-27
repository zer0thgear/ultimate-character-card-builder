import { describe, expect, it } from 'vitest';
import { composeFinalPrompts, styleText } from '@/lib/imageRequest';
import { reuseFromMetadata, withoutStyle } from '@/lib/genRequest';
import { takeDatasetTags } from '@/lib/assist';
import { GEN_DEFAULTS } from '@/store/settingsStore';
import type { ParsedNaiMetadata } from '@/lib/naiMetadata';

const resolved = (baseText: string) => ({ baseText, negativePrompt: '', characters: [], picks: {} }) as unknown as Parameters<typeof composeFinalPrompts>[1];
const mods = { furMode: false, nsfwMode: false, transparentBg: false, model: 'nai-diffusion-4-5-full' as const, qualityPreset: 'none' as const, ucPreset: 'none' as const };

describe('the style field', () => {
  it('goes first, joined with single commas', () => {
    expect(composeFinalPrompts({ ...mods, stylePrompt: 'artist:foo, watercolor' }, resolved('cowboy shot, smile')).input).toBe('artist:foo, watercolor, cowboy shot, smile');
  });

  it('adds nothing when empty, and no stray commas however it is typed', () => {
    expect(composeFinalPrompts({ ...mods, stylePrompt: '' }, resolved('smile')).input).toBe('smile');
    expect(composeFinalPrompts({ ...mods, stylePrompt: ' , ' }, resolved('smile')).input).toBe('smile');
    expect(composeFinalPrompts({ ...mods, stylePrompt: 'artist:foo,, watercolor, ' }, resolved(', smile,')).input).toBe('artist:foo, watercolor, smile');
    // One per line, with or without commas at the line ends.
    expect(styleText('artist:foo,\nartist:bar\n\n0.8::artist:baz::')).toBe('artist:foo, artist:bar, 0.8::artist:baz::');
  });

  it('leaves the scene out when there is none', () => {
    expect(composeFinalPrompts({ ...mods, stylePrompt: 'artist:foo' }, resolved('')).input).toBe('artist:foo');
  });

  it('sits after the dataset switches and before the quality tags', () => {
    const out = composeFinalPrompts({ ...mods, furMode: true, qualityPreset: 'standard', stylePrompt: 'artist:foo' }, resolved('smile')).input;
    expect(out.startsWith('fur dataset, artist:foo, smile, ')).toBe(true);
    expect(out).not.toMatch(/,\s*,/);
  });
});

describe('Reuse and the style', () => {
  it("takes this card's style off the front of a reused prompt, so it isn't doubled", () => {
    expect(withoutStyle('artist:foo, watercolor, cowboy shot, smile', 'artist:foo, watercolor')).toBe('cowboy shot, smile');
    expect(withoutStyle('fur dataset, artist:foo, smile', 'artist:foo')).toBe('fur dataset, smile');
    expect(withoutStyle('Artist:Foo,  smile', 'artist:foo')).toBe('smile');
  });

  it('keeps a prompt that starts some other way as it is', () => {
    expect(withoutStyle('artist:other, smile', 'artist:foo')).toBe('artist:other, smile');
    expect(withoutStyle('smile, artist:foo', 'artist:foo')).toBe('smile, artist:foo');
    expect(withoutStyle('artist:foo, smile', '')).toBe('artist:foo, smile');
  });
});

describe('the dataset switches', () => {
  it("takes nsfw and fur dataset out of a writer's tags, to turn the switches on", () => {
    expect(takeDatasetTags('nsfw, fur dataset, 1girl, smile')).toEqual({ tags: '1girl, smile', nsfw: true, fur: true });
    expect(takeDatasetTags('{nsfw}, cowboy shot')).toEqual({ tags: 'cowboy shot', nsfw: true, fur: false });
    expect(takeDatasetTags('cowboy shot, nsfw')).toEqual({ tags: 'cowboy shot', nsfw: true, fur: false });
  });

  it('leaves text with neither exactly as it was', () => {
    expect(takeDatasetTags('1girl,  smile,\nfur trim')).toEqual({ tags: '1girl,  smile,\nfur trim', nsfw: false, fur: false });
  });

  it('moves them onto the switches on Reuse, so the switch adds them back once', () => {
    const form = { ...GEN_DEFAULTS, stylePrompt: 'artist:foo' };
    const meta = { prompt: 'fur dataset, nsfw, artist:foo, smile', characters: [], negativePrompt: '' } as unknown as ParsedNaiMetadata;
    const out = reuseFromMetadata(meta, form, { prompt: true, characters: false, negative: false, settings: false, seed: false });
    expect(out.basePrompts?.[0].text).toBe('smile');
    expect(out).toMatchObject({ nsfwMode: true, furMode: true });
  });
});

