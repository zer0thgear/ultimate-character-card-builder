import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, cardTagsMessages, setTemplateOverrides, templateText } from '@/lib/assist';
import { buildLayer, describeContributions, packConflicts, packFromEdits, packIdFrom, parsePack, validatePack, PackError, type ExtensionPack, type InstalledPack } from '@/lib/extensionPack';
import { setPackLayer } from '@/lib/packLayer';
import { entryCount, focusOptions, lengthOptions, lengthText, newSession, planMessages, sizeOptions, writeMessages } from '@/lib/loreWizard';
import { scoutMessages } from '@/lib/adventure';
import { newCard } from '@/lib/cardSpec';

const pack = (over: Partial<ExtensionPack> = {}): ExtensionPack => ({ uccb: 1, id: 'noir', name: 'Noir', version: '1.0.0', contributes: {}, ...over });
const installed = (p: ExtensionPack, at: number, enabled = true): InstalledPack => ({ pack: p, enabled, installedAt: at, updatedAt: at });

afterEach(() => {
  setPackLayer(undefined);
  setTemplateOverrides({});
});

describe('validatePack', () => {
  it('keeps what the app understands and notes what it left out', () => {
    const { pack: p, warnings } = validatePack({
      uccb: 1,
      id: 'noir',
      name: ' Noir ',
      author: 'someone',
      homepage: 'javascript:alert(1)',
      junk: true,
      contributes: {
        templates: { 'field.system': 'Write like Chandler.', 'nope.key': 'x', 'tags.user': 5 },
        adventurePrompts: { narrator: 'Rain on neon.' },
        loreWizard: { focus: ['Precincts', '', 3], sizes: [{ id: 'huge', label: 'Loads', count: 50 }, { id: 'bad', label: 'Bad', count: 0 }], lengths: [{ id: 'vignette', label: 'Vignette', text: 'about 500 words' }] },
        adventureActors: [{ name: 'Snitch', prompt: 'You whisper tips.', when: 'before' }, { name: 'No prompt' }],
        ruleExamples: [{ label: 'Heat', text: 'Track police heat.' }],
      },
    });
    expect(p).toMatchObject({ id: 'noir', name: 'Noir', author: 'someone', version: '1.0.0' });
    expect(p).not.toHaveProperty('junk');
    expect(p).not.toHaveProperty('homepage');
    expect(p.contributes.templates).toEqual({ 'field.system': 'Write like Chandler.' });
    expect(p.contributes.adventurePrompts).toEqual({ narrator: 'Rain on neon.' });
    expect(p.contributes.loreWizard).toEqual({ focus: ['Precincts'], sizes: [{ id: 'huge', label: 'Loads', count: 50 }], lengths: [{ id: 'vignette', label: 'Vignette', text: 'about 500 words' }] });
    expect(p.contributes.adventureActors).toEqual([{ name: 'Snitch', icon: '✦', about: '', prompt: 'You whisper tips.', brief: '', when: 'before' }]);
    expect(warnings.join(' ')).toMatch(/nope\.key/);
    expect(warnings.join(' ')).toMatch(/tags\.user/);
    expect(warnings).toHaveLength(4);
  });

  it('refuses what is not a pack', () => {
    expect(() => validatePack([])).toThrow(PackError);
    expect(() => validatePack({ id: 'x', name: 'X' })).toThrow(/uccb/);
    expect(() => validatePack({ uccb: 2, id: 'x', name: 'X' })).toThrow(/newer/);
    expect(() => validatePack({ uccb: 1, id: '../x', name: 'X' })).toThrow(/id/);
    expect(() => validatePack({ uccb: 1, id: 'x', name: ' ' })).toThrow(/name/);
    expect(() => parsePack('{nope')).toThrow(/JSON/);
  });

  it('reads the example pack in docs/ with nothing left out', () => {
    const { pack: p, warnings } = parsePack(readFileSync('docs/extensions/noir.uccb.json', 'utf8'));
    expect(warnings).toEqual([]);
    expect(describeContributions(p.contributes)).toHaveLength(6);
  });

  it('warns about a pack that adds nothing', () => {
    expect(validatePack({ uccb: 1, id: 'x', name: 'X', contributes: {} }).warnings).toEqual(["It doesn't add anything this version of UCCB understands."]);
  });
});

describe('the pack layer', () => {
  it('sits between the built-in prompts and your edits', () => {
    expect(templateText('tags.system')).toBe(DEFAULT_TEMPLATES['tags.system']);
    setPackLayer(buildLayer([installed(pack({ contributes: { templates: { 'tags.system': 'From the pack.' } } }), 1)]));
    expect(templateText('tags.system')).toBe('From the pack.');
    expect(cardTagsMessages(newCard().data)[0].content).toBe('From the pack.');
    setTemplateOverrides({ 'tags.system': 'Mine.' });
    expect(templateText('tags.system')).toBe('Mine.');
    setPackLayer(undefined);
    setTemplateOverrides({});
    expect(templateText('tags.system')).toBe(DEFAULT_TEMPLATES['tags.system']);
  });

  it('lays packs on in install order and leaves out disabled ones', () => {
    const a = pack({ id: 'a', name: 'A', contributes: { templates: { 'tags.system': 'A' }, loreWizard: { focus: ['Ships', 'Places'] } } });
    const b = pack({ id: 'b', name: 'B', contributes: { templates: { 'tags.system': 'B' }, loreWizard: { focus: ['Ships'] } } });
    expect(buildLayer([installed(b, 2), installed(a, 1)]).templates['tags.system']).toEqual({ text: 'B', from: 'B' });
    expect(buildLayer([installed(b, 2, false), installed(a, 1)]).templates['tags.system']).toEqual({ text: 'A', from: 'A' });
    expect(buildLayer([installed(a, 1), installed(b, 2)]).loreFocus).toEqual(['Ships', 'Places']);
    expect(packConflicts([installed(a, 1), installed(b, 2)])).toEqual({ a: ['b'], b: ['a'] });
    expect(packConflicts([installed(a, 1), installed(b, 2, false)])).toEqual({});
  });

  it("adds to the lorebook wizard's choices, and falls back when a pack's choice is gone", () => {
    const p = pack({ contributes: { loreWizard: { focus: ['Precincts', 'Places'], sizes: [{ id: 'huge', label: 'Loads', count: 50 }], lengths: [{ id: 'vignette', label: 'Vignette', text: 'about 500 words' }] } } });
    setPackLayer(buildLayer([installed(p, 1)]));
    expect(focusOptions().filter((f) => f === 'Places')).toHaveLength(1);
    expect(focusOptions()).toContain('Precincts');
    expect(sizeOptions().at(-1)).toEqual({ id: 'noir:huge', label: 'Loads (about 50)', count: 50 });
    expect(lengthOptions().at(-1)?.id).toBe('noir:vignette');
    const s = { ...newSession(false), size: 'noir:huge', length: 'noir:vignette', pitch: 'A city' };
    expect(planMessages(s, undefined).at(-1)!.content).toContain('50');
    const entry = { id: 'e', name: 'Docks', keys: ['docks'], brief: 'The docks', content: '' };
    expect(writeMessages({ ...s, entries: [entry] }, undefined, entry).at(-1)!.content).toContain('about 500 words');
    setPackLayer(undefined);
    expect(entryCount('noir:huge')).toBe(15);
    expect(lengthText('noir:vignette')).toBe('about 80 to 180 words');
  });

  it("changes Adventure mode's prompts under yours", () => {
    const card = newCard().data;
    setPackLayer(buildLayer([installed(pack({ contributes: { adventurePrompts: { scout: 'Scout from the pack.' } } }), 1)]));
    expect(scoutMessages(card)[0].content).toBe('Scout from the pack.');
    expect(scoutMessages(card, { scout: 'My scout.' })[0].content).toBe('My scout.');
  });
});

describe('sharing your edits', () => {
  it('makes a pack of edited prompts and actors, leaving out unchanged and unknown ones', () => {
    const p = packFromEdits(
      { name: 'My Prompts!', author: 'me' },
      {
        templates: { 'tags.system': 'Mine.', 'field.system': DEFAULT_TEMPLATES['field.system'], 'gone.key': 'x' },
        adventurePrompts: { narrator: 'Terse.' },
        actors: [{ name: 'Muse', icon: '🎵', about: '', prompt: 'Sing.', brief: '', when: 'after' }, { name: '', icon: '', about: '', prompt: '', brief: '', when: 'after' }],
      },
    );
    expect(p).toEqual({
      uccb: 1,
      id: 'my-prompts',
      name: 'My Prompts!',
      version: '1.0.0',
      author: 'me',
      contributes: { templates: { 'tags.system': 'Mine.' }, adventurePrompts: { narrator: 'Terse.' }, adventureActors: [{ name: 'Muse', icon: '🎵', about: '', prompt: 'Sing.', brief: '', when: 'after' }] },
    });
    // It reads back as the same pack.
    expect(validatePack(JSON.parse(JSON.stringify(p))).pack).toEqual(p);
    expect(describeContributions(p.contributes)).toEqual(['1 assistant prompt', '1 Adventure prompt', '1 Adventure actor']);
    expect(packIdFrom('  ')).toBe('my-pack');
  });
});
