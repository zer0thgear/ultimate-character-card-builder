import { describe, expect, it } from 'vitest';
import {
  addMissingTags,
  composeNegativeWithUc,
  composeWithQuality,
  getAvailableQualityLevels,
  getAvailableUcLevels,
  getModelFamily,
  getQualityText,
  insertTags,
} from '@/lib/naiPresets';

describe('getModelFamily', () => {
  it('separates Full from Curated, and V4.5 from V4', () => {
    expect(getModelFamily('nai-diffusion-5-full')).toBe('v5');
    expect(getModelFamily('nai-diffusion-5-curated')).toBe('v5');
    expect(getModelFamily('nai-diffusion-4-5-full')).toBe('v45full');
    expect(getModelFamily('nai-diffusion-4-5-curated')).toBe('v45curated');
    expect(getModelFamily('nai-diffusion-4-full')).toBe('v4full');
    expect(getModelFamily('nai-diffusion-4-curated-preview')).toBe('v4curated');
    expect(getModelFamily('nai-diffusion-3')).toBe('v3anime');
    expect(getModelFamily('nai-diffusion-furry-3')).toBe('v3furry');
  });
});

describe('the preset menus', () => {
  it('offers the levels each model actually has', () => {
    expect(getAvailableQualityLevels('nai-diffusion-5-full')).toContain('standard');
    expect(getAvailableUcLevels('nai-diffusion-3')).toContain('heavy');
    // Human Focus is an anime-model preset, not a furry one.
    expect(getAvailableUcLevels('nai-diffusion-furry-3')).not.toContain('humanFocus');
  });
});

describe('insertTags', () => {
  const V5 = 'nai-diffusion-5-full';

  it('appends to the end of a plain prompt', () => {
    expect(insertTags('1girl', V5, 'best quality')).toBe('1girl, best quality');
  });

  it('never doubles a comma or leaves a trailing one', () => {
    expect(insertTags('1girl, ', V5, 'best quality')).toBe('1girl, best quality');
    expect(insertTags('1girl', V5, '')).toBe('1girl');
  });

  it('goes before a text: section, so the tags are not rendered as text', () => {
    expect(insertTags('1girl, text: Hello', V5, 'best quality')).toBe('1girl, best quality, text: Hello');
  });

  it('only touches the first prompt-mix part on V4+', () => {
    expect(insertTags('1girl|1boy', V5, 'best quality')).toBe('1girl, best quality|1boy');
  });

  it('ignores bars inside a random group', () => {
    expect(insertTags('||a|b||', V5, 'best quality')).toBe('||a|b||, best quality');
  });

  it('adds to every part on V3, keeping each part’s weight last', () => {
    expect(insertTags('1girl:1.2|1boy', 'nai-diffusion-3', 'best quality')).toBe(
      '1girl, best quality:1.2|1boy, best quality',
    );
  });
});

describe('composeWithQuality', () => {
  it('puts transparent background ahead of the quality tags on V5', () => {
    const out = composeWithQuality('1girl', 'nai-diffusion-5-full', 'standard', true);
    const quality = getQualityText('nai-diffusion-5-full', 'standard').replace(/^[\s,]+/, '');
    expect(out).toBe(`1girl, transparent background, ${quality}`);
  });

  it('ignores transparency on models that do not support it', () => {
    const out = composeWithQuality('1girl', 'nai-diffusion-4-5-full', 'standard', true);
    expect(out).not.toContain('transparent background');
  });

  it('adds nothing at level none', () => {
    expect(composeWithQuality('1girl', 'nai-diffusion-5-full', 'none')).toBe('1girl');
  });
});

describe('addMissingTags', () => {
  const V5 = 'nai-diffusion-5-full';

  it('adds only the tags that are not there yet', () => {
    expect(addMissingTags('1girl, smile', V5, 'smile, wink')).toBe('1girl, smile, wink');
  });

  it('matches case-insensitively and ignores spacing, leaving the text untouched', () => {
    expect(addMissingTags('1girl,  Smile ', V5, 'smile')).toBe('1girl,  Smile ');
  });

  it('drops duplicates within its own list', () => {
    expect(addMissingTags('1girl', V5, 'wink, wink')).toBe('1girl, wink');
  });

  it('looks in every mix part for what is already there', () => {
    expect(addMissingTags('1girl|smile', V5, 'smile')).toBe('1girl|smile');
  });
});

describe('composeNegativeWithUc', () => {
  it('prepends the preset to the negative prompt', () => {
    const out = composeNegativeWithUc('bad hands', 'nai-diffusion-5-curated', 'light', '1girl');
    expect(out.endsWith('bad hands')).toBe(true);
    expect(out.length).toBeGreaterThan('bad hands'.length);
  });

  it('adds nsfw on Full models unless the prompt asks for it', () => {
    const withNsfw = composeNegativeWithUc('', 'nai-diffusion-5-full', 'light', '1girl');
    expect(withNsfw.startsWith('nsfw, ')).toBe(true);
    const asked = composeNegativeWithUc('', 'nai-diffusion-5-full', 'light', '1girl, nsfw');
    expect(asked.startsWith('nsfw, ')).toBe(false);
  });

  it('never adds nsfw on Curated models', () => {
    const out = composeNegativeWithUc('', 'nai-diffusion-5-curated', 'light', '1girl');
    expect(out.startsWith('nsfw, ')).toBe(false);
  });

  it('does nothing at level none, even on a Full model', () => {
    expect(composeNegativeWithUc('bad hands', 'nai-diffusion-5-full', 'none', '1girl')).toBe('bad hands');
  });
});
