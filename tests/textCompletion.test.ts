import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_SETTINGS, newMessage } from '@/lib/chatPrompt';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';
import { BUILTIN_CONTEXT, BUILTIN_INSTRUCT, buildTextPrompt, exportInstruct, messagesToText, parseTemplateFile, stopStrings } from '@/lib/textCompletion';

const chatml = BUILTIN_INSTRUCT.find((t) => t.name === 'ChatML')!;
const alpaca = BUILTIN_INSTRUCT.find((t) => t.name === 'Alpaca')!;
const llama3 = BUILTIN_INSTRUCT.find((t) => t.name === 'Llama 3 Instruct')!;
const defaultContext = BUILTIN_CONTEXT[0];

const card = () => {
  const c = newCard().data;
  c.name = 'Ann';
  c.description = '{{char}} is a knight.';
  c.personality = 'brave';
  c.scenario = 'A tavern.';
  c.mes_example = '<START>\n{{user}}: hi\n{{char}}: hello';
  c.character_book = { ...newLorebook(), entries: [{ ...newEntry(), keys: ['sword'], content: 'Her sword is named Dawn.', name: 'Sword', position: 'after_char' }] };
  return c;
};
const settings = { ...DEFAULT_CHAT_SETTINGS, userName: 'Bob', persona: 'A traveller.', mainPrompt: 'Write as {{char}}.', defaultPostHistory: '' };
const history = () => [{ ...newMessage('assistant', 'Welcome, {{user}}.'), id: 'greeting' }, newMessage('user', 'Nice sword.')];

describe('buildTextPrompt', () => {
  it('lays out the story string, examples, chat and reply marker in ChatML', () => {
    const built = buildTextPrompt(card(), history(), settings, chatml, defaultContext);
    expect(built.text).toBe(
      [
        '<|im_start|>system\n',
        "Write as Ann.\nAnn is a knight.\nAnn's personality: brave\nScenario: A tavern.\nHer sword is named Dawn.\nA traveller.",
        '<|im_end|>\n',
        // <START> becomes the example separator, as in SillyTavern.
        '***\nBob: hi\nAnn: hello\n',
        '***\n',
        '<|im_start|>assistant\nWelcome, Bob.\n<|im_end|>\n',
        '<|im_start|>user\nNice sword.\n<|im_end|>\n',
        '<|im_start|>assistant\n',
      ].join(''),
    );
    expect(built.stop).toEqual(['<|im_end|>', '<|im_start|>user', '<|im_start|>system', '<|im_start|>assistant', '\nBob:']);
    expect(built.parts.map((p) => p.label)).toContain('Story string');
  });

  it('names the speakers when the template always does', () => {
    const built = buildTextPrompt(card(), history(), settings, { ...alpaca, names_behavior: 'always' }, BUILTIN_CONTEXT[1]);
    expect(built.text).toContain('### Instruction:\nBob: Nice sword.\n\n');
    expect(built.text!.endsWith('### Response:\nAnn:\n')).toBe(true);
  });

  it('ends on the reply so far when continuing', () => {
    const h = [...history(), newMessage('assistant', 'Thank')];
    const built = buildTextPrompt(card(), h, settings, llama3, defaultContext, { mode: 'continue', continueText: 'Thank' });
    expect(built.text!.endsWith('<|start_header_id|>assistant<|end_header_id|>\n\nThank')).toBe(true);
    expect(built.text).not.toContain('Thank<|eot_id|>');
  });

  it('leaves out the oldest messages to fit the context size', () => {
    const long = [...history(), ...Array.from({ length: 40 }, (_, i) => newMessage(i % 2 ? 'assistant' : 'user', 'word '.repeat(50)))];
    const built = buildTextPrompt(card(), long, settings, chatml, defaultContext, { maxContext: 1500, maxTokens: 200 });
    expect(built.droppedHistory).toBeGreaterThan(0);
    expect(built.text!.length / 3.5).toBeLessThan(1500);
  });
});

describe('messagesToText', () => {
  it('wraps plain messages and leaves the reply open', () => {
    const r = messagesToText(
      [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
      ],
      chatml,
    );
    expect(r.prompt).toBe('<|im_start|>system\nBe brief.\n<|im_end|>\n<|im_start|>user\nHi\n<|im_end|>\n<|im_start|>assistant\n');
  });
  it('carries on a prefill', () => {
    const r = messagesToText(
      [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hel' },
      ],
      llama3,
      { prefill: true },
    );
    expect(r.prompt.endsWith('<|start_header_id|>assistant<|end_header_id|>\n\nHel')).toBe(true);
  });
});

describe('SillyTavern templates', () => {
  it('reads a master export with both templates, and an old-style instruct one', () => {
    const both = parseTemplateFile({ instruct: { ...exportInstruct(chatml), name: 'Mine' }, context: { name: 'Ctx', story_string: '{{description}}', chat_start: '', example_separator: '' }, sysprompt: {} });
    expect(both.instruct?.name).toBe('Mine');
    expect(both.instruct?.input_sequence).toBe('<|im_start|>user');
    expect(both.context?.story_string).toBe('{{description}}');

    const old = parseTemplateFile({ name: 'Old', input_sequence: 'A', output_sequence: 'B', separator_sequence: '</s>', names: true, system_sequence_prefix: '[SYS]', activation_regex: '' });
    expect(old.instruct).toMatchObject({ output_suffix: '</s>', names_behavior: 'always', story_string_prefix: '[SYS]', extra: { activation_regex: '' } });
    expect(old.context).toBeUndefined();
    expect(parseTemplateFile({ nope: 1 })).toEqual({ instruct: undefined, context: undefined });
  });

  it('exports what it imported, unknown keys included', () => {
    const t = parseTemplateFile({ name: 'X', input_sequence: 'U', output_sequence: 'A', activation_regex: 'x' }).instruct!;
    expect(exportInstruct(t)).toMatchObject({ name: 'X', input_sequence: 'U', activation_regex: 'x' });
    expect(exportInstruct(t)).not.toHaveProperty('id');
  });

  it('stop strings follow the template', () => {
    const m = (s: string) => s;
    expect(stopStrings({ ...chatml, sequences_as_stop_strings: false }, { ...defaultContext, names_as_stop_strings: false }, { m, user: 'Bob', char: 'Ann' })).toEqual(['<|im_end|>']);
    expect(stopStrings(alpaca, { ...defaultContext, use_stop_strings: true }, { m, user: 'Bob', char: 'Ann' })).toEqual(['### Instruction:', '### Response:', '\n***', '\nBob:']);
  });
});
