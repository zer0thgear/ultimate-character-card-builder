import { describe, expect, it } from 'vitest';
import { mergeCast, parseCast } from '@/lib/castPrompt';
import type { CharacterPromptEntry } from '@/types/novelai';

const slot = (label: string, prompt = '', extra: Partial<CharacterPromptEntry> = {}): CharacterPromptEntry => ({ id: label, label, prompt, uc: '', center: { x: 0.5, y: 0.5 }, enabled: true, ...extra });

describe('parseCast', () => {
  it('reads the main prompt, each character and their positions', () => {
    const cast = parseCast(`SCENE: 2girls, cowboy shot, forest, sunlight
CHARACTER Edith: girl, red hair, {smile}, source#hug
POSITION Edith: B3
CHARACTER Betilla: girl, blonde hair, target#hug,
POSITION Betilla: d3`);
    expect(cast.scene).toBe('2girls, cowboy shot, forest, sunlight');
    expect(cast.characters).toEqual([
      { name: 'Edith', tags: 'girl, red hair, {smile}, source#hug', center: { x: 0.3, y: 0.5 } },
      { name: 'Betilla', tags: 'girl, blonde hair, target#hug', center: { x: 0.7, y: 0.5 } },
    ]);
  });

  it('copes with bullets, <names>, wrapped lines and code fences', () => {
    const cast = parseCast('```\n- SCENE: 1girl, indoors\n- CHARACTER <Edith>: girl, red hair,\n  green dress\n```');
    expect(cast.scene).toBe('1girl, indoors');
    expect(cast.characters).toEqual([{ name: 'Edith', tags: 'girl, red hair, green dress', center: undefined }]);
  });

  it('takes the dataset tags out wherever they are', () => {
    const cast = parseCast('SCENE: nsfw, 1boy, bedroom\nCHARACTER Rook: fur dataset, boy, anthro, wolf');
    expect(cast).toMatchObject({ scene: '1boy, bedroom', nsfw: true, fur: true });
    expect(cast.characters[0].tags).toBe('boy, anthro, wolf');
  });

  it('treats a reply with no markers as all scene', () => {
    expect(parseCast('cowboy shot, smile, tavern')).toEqual({ scene: 'cowboy shot, smile, tavern', characters: [], nsfw: false, fur: false });
  });
});

describe('mergeCast', () => {
  it('updates slots by name, adds new characters, and sets aside those not in the scene', () => {
    const existing = [slot('Edith', 'girl, red hair'), slot('Betilla Moonwhisper', 'girl, blonde hair'), slot('Guard', 'boy, armor')];
    const r = mergeCast(existing, [
      { name: 'Edith', tags: 'girl, red hair, smile' },
      { name: 'Betilla', tags: 'girl, blonde hair, wave' },
      { name: 'Frog', tags: 'other, frog' },
    ], { scene: true, max: 6 });
    expect(r.updated).toEqual(['Edith', 'Betilla']);
    expect(r.added).toEqual(['Frog']);
    expect(r.setAside).toEqual(['Guard']);
    expect(r.characters.map((c) => [c.label, c.prompt, c.enabled])).toEqual([
      ['Edith', 'girl, red hair, smile', true],
      ['Betilla Moonwhisper', 'girl, blonde hair, wave', true], // first-name match keeps the label
      ['Guard', 'boy, armor', false],
      ['Frog', 'other, frog', true],
    ]);
  });

  it('pairs a lone character with a lone slot, naming it if the name was a placeholder', () => {
    const r = mergeCast([slot('Character')], [{ name: 'Rook', tags: 'boy, anthro, wolf' }], { scene: false, max: 6 });
    expect(r.characters).toMatchObject([{ id: 'Character', label: 'Rook', prompt: 'boy, anthro, wolf' }]);
    const named = mergeCast([slot('Ann')], [{ name: 'Rook', tags: 'boy' }], { scene: false, max: 6, cardName: 'Rook' });
    expect(named.characters[0].label).toBe('Ann'); // a chosen label stays
  });

  it('only moves characters when positions were given, and leaves archived slots alone', () => {
    const r = mergeCast([slot('Edith', '', { center: { x: 0.1, y: 0.1 } }), slot('Old', 'x', { archived: true, enabled: false })], [{ name: 'Edith', tags: 'girl' }], { scene: true, max: 6 });
    expect(r.characters[0].center).toEqual({ x: 0.1, y: 0.1 });
    expect(r.characters[1]).toMatchObject({ archived: true, enabled: false });
    expect(r.setAside).toEqual([]);
  });

  it("doesn't set anyone aside when writing default looks", () => {
    const r = mergeCast([slot('Edith'), slot('Betilla')], [{ name: 'Edith', tags: 'girl' }], { scene: false, max: 6 });
    expect(r.characters.every((c) => c.enabled)).toBe(true);
  });

  it('stops at the model limit', () => {
    const r = mergeCast([slot('A')], [{ name: 'A', tags: 'girl' }, { name: 'B', tags: 'boy' }], { scene: true, max: 1 });
    expect(r.dropped).toEqual(['B']);
    expect(r.characters).toHaveLength(1);
  });

  it("gives a slot named after the card (one blended prompt from before) to the first newcomer", () => {
    const r = mergeCast([slot('Fairy Girlfriends', 'girl, red hair, blonde hair')], [{ name: 'Edith', tags: 'girl, red hair' }, { name: 'Betilla', tags: 'girl, blonde hair' }], { scene: false, max: 6, cardName: 'Fairy Girlfriends' });
    expect(r.characters.map((c) => [c.id, c.label, c.prompt])).toEqual([
      ['Fairy Girlfriends', 'Edith', 'girl, red hair'],
      [expect.any(String), 'Betilla', 'girl, blonde hair'],
    ]);
    expect(r).toMatchObject({ updated: ['Edith'], added: ['Betilla'] });
  });

  it("doesn't hand a named slot to someone else", () => {
    const r = mergeCast([slot('Guard', 'boy, armor')], [{ name: 'Edith', tags: 'girl' }, { name: 'Betilla', tags: 'girl' }], { scene: true, max: 6 });
    expect(r.characters.find((c) => c.label === 'Guard')).toMatchObject({ prompt: 'boy, armor', enabled: false });
  });
});

