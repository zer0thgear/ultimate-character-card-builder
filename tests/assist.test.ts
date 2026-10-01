import { afterEach, describe, expect, it } from 'vitest';
import { ASSIST_TEMPLATES, DEFAULT_TEMPLATES, cardTagsMessages, fieldActionMessages, fillTemplate, setTemplateOverrides } from '@/lib/assist';
import { newCard } from '@/lib/cardSpec';

const card = () => ({ ...newCard().data, name: 'Edith', description: 'A fairy.' });

describe('fillTemplate', () => {
  it('fills placeholders and keeps other macros', () => {
    expect(fillTemplate('Hi {{field}}, says {{char}} to {{user}}.', { field: 'Description' })).toBe('Hi Description, says {{char}} to {{user}}.');
  });

  it('drops a paragraph whose placeholder is empty, and only that paragraph', () => {
    expect(fillTemplate('Task.\n\nThe instruction: {{instruction}}\n\nReply.', { instruction: '  ' })).toBe('Task.\n\nReply.');
    expect(fillTemplate('Task.\n\nThe instruction: {{instruction}}', { instruction: 'cuter' })).toBe('Task.\n\nThe instruction: cuter');
  });

  it("doesn't mistake an object key for a placeholder", () => {
    expect(fillTemplate('{{constructor}} {{toString}}', {})).toBe('{{constructor}} {{toString}}');
  });
});

describe('editable prompts', () => {
  afterEach(() => setTemplateOverrides({}));

  it('has a default for every template, with no duplicate keys', () => {
    const keys = ASSIST_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(DEFAULT_TEMPLATES[k]?.trim()).toBeTruthy();
  });

  it('uses your edits, and the default again once they are cleared', () => {
    setTemplateOverrides({ 'tags.user': 'Tags for {{card}}, please.', 'tags.system': '' });
    const edited = cardTagsMessages(card());
    expect(edited).toHaveLength(1); // an emptied system prompt is left out
    expect(edited[0].content).toMatch(/^Tags for <name>Edith<\/name>/);
    setTemplateOverrides({});
    expect(cardTagsMessages(card())[0]).toMatchObject({ role: 'system' });
  });

  it('edits the action texts and the reply rule separately', () => {
    setTemplateOverrides({ 'field.polish': 'Fix the {{field}}.', 'field.reply': 'Only the {{field}}, nothing else.' });
    const user = fieldActionMessages(card(), 'description', 'polish', '')[1].content;
    expect(user).toContain('Fix the Description.\n\nOnly the Description, nothing else.');
    // Continue has no reply rule.
    expect(fieldActionMessages(card(), 'description', 'continue', '')[1].content).not.toContain('nothing else');
  });
});

describe('the lorebook in the card context', () => {
  const withBook = async (entries: { content: string; keys?: string[]; name?: string; enabled?: boolean; constant?: boolean }[]) => {
    const { newCard, newLorebook, newEntry } = await import('@/lib/cardSpec');
    const book = newLorebook();
    book.entries = entries.map((e, i) => ({ ...newEntry(), id: i, keys: e.keys ?? ['k'], content: e.content, name: e.name, comment: e.name, enabled: e.enabled ?? true, constant: e.constant }));
    return { ...newCard().data, name: 'Mira', character_book: book };
  };

  it('sends every switched-on entry in full when they fit, with keys and always-on', async () => {
    const { lorebookContext } = await import('@/lib/assist');
    const card = await withBook([
      { name: 'Saltmarrow', keys: ['lighthouse', 'tower'], content: 'A lonely tower on the Greywater coast.' },
      { name: 'Wren', content: 'The keeper.', constant: true },
      { name: 'Secret', content: 'Not used.', enabled: false },
    ]);
    const out = lorebookContext(card, undefined, 5000);
    expect(out).toContain('<entry name="Saltmarrow" keys="lighthouse, tower">\nA lonely tower on the Greywater coast.\n</entry>');
    expect(out).toContain('keys="always on"');
    expect(out).not.toContain('Not used.');
    expect(out).toContain('(1 more entry is switched off.)');
  });

  it('trims evenly when the lorebook is over its share, leaving none out', async () => {
    const { lorebookContext } = await import('@/lib/assist');
    const card = await withBook(Array.from({ length: 40 }, (_, i) => ({ name: `E${i}`, content: `${i}:${'x'.repeat(1000)}` })));
    const out = lorebookContext(card, undefined, 8000);
    expect(out.match(/<entry /g)).toHaveLength(40);
    expect(out.length).toBeLessThan(8000 + 40 * 60);
  });

  it("leaves out the entry being edited", async () => {
    const { lorebookContext } = await import('@/lib/assist');
    const card = await withBook([{ name: 'A', content: 'first' }, { name: 'B', content: 'second' }]);
    const out = lorebookContext(card, 'character_book.entries.1.content', 5000);
    expect(out).toContain('first');
    expect(out).not.toContain('second');
  });
});

describe('character prompt from a lorebook entry', () => {
  it("sends the entry's text and name, with the art system prompt", async () => {
    const { entryAppearanceMessages } = await import('@/lib/assist');
    const card = newCard().data;
    card.name = 'New Eridu';
    const [system, user] = entryAppearanceMessages(card, { name: 'Belle', content: 'Short silver hair, green eyes.' }, '', ['Wise']);
    expect(system.role).toBe('system');
    expect(system.content).toContain('image-generation prompts');
    expect(user.content).toContain('<lorebook_entry name="Belle">\nShort silver hair, green eyes.');
    expect(user.content).toContain('named: Wise');
    expect(user.content).toContain('CHARACTER <name>: <tags>');
  });
});
