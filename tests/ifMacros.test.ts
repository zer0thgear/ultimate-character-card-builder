import { describe, expect, it } from 'vitest';
import { expandMacros } from '@/lib/macros';
import { buildPresetPrompt } from '@/lib/presetPrompt';
import { buildChatPrompt, DEFAULT_CHAT_SETTINGS, newMessage } from '@/lib/chatPrompt';
import { parseStPreset } from '@/lib/stPreset';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';

const ctx = (fields: Record<string, string> = {}) => ({ char: 'Ann', user: 'Bob', fields });

describe('{{#if}} blocks', () => {
  it('keeps a block when its field has something, and drops it when not', () => {
    const t = 'A{{#if description}}[{{description}}]{{/if}}B';
    expect(expandMacros(t, ctx({ description: 'A knight.' }))).toBe('A[A knight.]B');
    expect(expandMacros(t, ctx({ description: '  ' }))).toBe('AB');
    expect(expandMacros(t, ctx())).toBe('AB');
  });

  it('does {{else}}, {{#unless}}, ! and nesting', () => {
    const f = ctx({ persona: 'A traveller.', scenario: '' });
    expect(expandMacros('{{#if scenario}}S{{else}}no scenario{{/if}}', f)).toBe('no scenario');
    expect(expandMacros('{{#unless scenario}}none{{/unless}}', f)).toBe('none');
    expect(expandMacros('{{#if !scenario}}none{{/if}}', f)).toBe('none');
    expect(expandMacros('{{#if persona}}P{{#if scenario}}+S{{else}}-S{{/if}}{{/if}}', f)).toBe('P-S');
  });

  it('takes the form without # too, and any case', () => {
    expect(expandMacros('{{if description}}yes{{/if}}|{{#IF Description}}yes{{/IF}}', ctx({ description: 'x' }))).toBe('yes|yes');
  });

  it('removes a tag on its own line with the line, as Handlebars does', () => {
    const t = 'Before\n{{#if mesExamples}}\nExamples:\n{{mesExamples}}\n{{/if}}\nAfter';
    expect(expandMacros(t, ctx({ mesExamples: 'ex' }))).toBe('Before\nExamples:\nex\nAfter');
    expect(expandMacros(t, ctx())).toBe('Before\nAfter');
  });

  it('reads variables, in order: set before counts, set in a skipped block never happens', () => {
    expect(expandMacros('{{setvar::mood::grim}}{{#if getvar::mood}}mood: {{getvar::mood}}{{/if}}', ctx())).toBe('mood: grim');
    expect(expandMacros('{{#if description}}{{setvar::x::1}}{{/if}}[{{getvar::x}}]', ctx())).toBe('[]');
    const vars = new Map([['count', '0'], ['flag', 'false']]);
    expect(expandMacros('{{#if count}}a{{/if}}{{#if flag}}b{{/if}}{{#if count2}}c{{/if}}', { ...ctx(), vars })).toBe('');
  });

  it('leaves tags that never close as written', () => {
    expect(expandMacros('{{#if description}}open', ctx({ description: 'x' }))).toBe('{{#if description}}open');
    expect(expandMacros('stray {{/if}} and {{else}}', ctx())).toBe('stray {{/if}} and {{else}}');
  });
});

describe('{{#if}} in a prompt', () => {
  const card = (withLore: boolean) => {
    const c = newCard().data;
    c.name = 'Ann';
    c.description = '{{char}} is a knight.';
    c.character_book = { ...newLorebook(), entries: withLore ? [{ ...newEntry(), keys: ['sword'], content: 'Her sword is Dawn.', name: 'Sword', position: 'before_char' }] : [] };
    return c;
  };
  const chat = [newMessage('user', 'Nice sword.')];

  it('knows which lorebook entries fired, in a preset', () => {
    const preset = parseStPreset({
      prompts: [
        { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system', content: '{{#if wiBefore}}\nLore follows.\n{{/if}}\nWrite {{char}}.' },
        { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
    });
    const main = (withLore: boolean) => buildPresetPrompt(card(withLore), chat, DEFAULT_CHAT_SETTINGS, preset).parts[0].content;
    expect(main(true)).toBe('Lore follows.\nWrite Ann.');
    expect(main(false)).toBe('Write Ann.');
  });

  it('and in the built-in prompt', () => {
    const settings = { ...DEFAULT_CHAT_SETTINGS, mainPrompt: '{{#if wiBefore}}[{{wiBefore}}] {{/if}}Write {{char}}.' };
    expect(buildChatPrompt(card(true), chat, settings).parts[0].content).toBe('[Her sword is Dawn.] Write Ann.');
    expect(buildChatPrompt(card(false), chat, settings).parts[0].content).toBe('Write Ann.');
  });
});
