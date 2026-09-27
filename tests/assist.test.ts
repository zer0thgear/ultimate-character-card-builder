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
