import { describe, expect, it } from 'vitest';
import { addAutoText, hasAutoText, stripAutoText } from '@/lib/autoText';
import { CharacterPrompt } from '@/types/novelai';

// V5's client turns quoted text into a "teXt:" section just before sending.
// This port was checked against NovelAI's own functions on 20,000 random
// prompts; these cases pin the behaviour those runs agreed on.

const character = (prompt: string, x = 0.5, y = 0.5): CharacterPrompt => ({
  prompt,
  uc: '',
  enabled: true,
  center: { x, y },
});

describe('hasAutoText', () => {
  it('is a V5-only step', () => {
    expect(hasAutoText('nai-diffusion-5-full')).toBe(true);
    expect(hasAutoText('nai-diffusion-5-curated')).toBe(true);
    expect(hasAutoText('nai-diffusion-4-5-full')).toBe(false);
    expect(hasAutoText('nai-diffusion-3')).toBe(false);
  });
});

describe('addAutoText', () => {
  it('collects quoted text onto the end of the prompt', () => {
    expect(addAutoText('a sign that says "Hello World"', [], false)).toBe(
      'a sign that says "Hello World", teXt: Hello World',
    );
  });

  it('adds nothing when there is no quoted text', () => {
    expect(addAutoText('1girl, smile', [], false)).toBe('1girl, smile');
  });

  it('leaves a prompt that already has its own text: section alone', () => {
    expect(addAutoText('a sign saying "Hi", text: Hi', [], false)).toBe('a sign saying "Hi", text: Hi');
  });

  it('stands down if any character prompt writes text: itself', () => {
    const chars = [character('holding a sign, text: Hi')];
    expect(addAutoText('a sign that says "Hello"', chars, false)).toBe('a sign that says "Hello"');
  });

  it('accepts curly, corner and single quotes', () => {
    expect(addAutoText('“Alpha” and 「Beta」', [], false)).toContain('teXt: Alpha\n\nBeta');
    expect(addAutoText("a sign saying 'Gamma'", [], false)).toContain('teXt: Gamma');
  });

  it('treats an apostrophe as part of the word, not a quote', () => {
    expect(addAutoText("a girl who don't care", [], false)).toBe("a girl who don't care");
  });

  it('takes the base prompt first, then the characters', () => {
    const chars = [character('sign reading "Two"'), character('sign reading "Three"')];
    expect(addAutoText('a poster saying "One"', chars, false)).toBe(
      'a poster saying "One", teXt: One\n\nTwo\n\nThree',
    );
  });

  it('skips characters that are off or empty', () => {
    const chars = [{ ...character('sign reading "Two"'), enabled: false }, character('')];
    expect(addAutoText('a poster saying "One"', chars, false)).toBe('a poster saying "One", teXt: One');
  });

  it('reads characters in reading order when coordinates are used', () => {
    // Listed bottom-right first; reading order is top row left to right.
    const chars = [character('sign reading "C"', 0.8, 0.8), character('sign reading "A"', 0.2, 0.1), character('sign reading "B"', 0.7, 0.1)];
    expect(addAutoText('', chars, true)).toBe('teXt: A\n\nB\n\nC');
    // Without coordinates it keeps the list order.
    expect(addAutoText('', chars, false)).toBe('teXt: C\n\nA\n\nB');
  });

  it('only touches the first prompt-mix part', () => {
    expect(addAutoText('a sign saying "Hi"|1boy', [], false)).toBe('a sign saying "Hi", teXt: Hi|1boy');
  });

  it('trims a trailing comma before appending', () => {
    expect(addAutoText('a sign saying "Hi", ', [], false)).toBe('a sign saying "Hi", teXt: Hi');
  });

  it('reverses the order for mostly-CJK text', () => {
    const out = addAutoText('看板に「一」と「二」', [], false);
    expect(out.endsWith('teXt: 二\n\n一')).toBe(true);
  });
});

describe('stripAutoText', () => {
  it('undoes exactly what addAutoText added', () => {
    for (const prompt of [
      'a sign that says "Hello World"',
      'a poster saying "One", and "Two"',
      'a sign saying "Hi"|1boy',
      '1girl, smile',
    ]) {
      expect(stripAutoText(addAutoText(prompt, [], false))).toBe(prompt);
    }
  });

  it('keeps a teXt: section that is not what we would have added', () => {
    const handWritten = '1girl, teXt: something else entirely';
    expect(stripAutoText(handWritten)).toBe(handWritten);
  });

  it('leaves a normal text: section alone', () => {
    expect(stripAutoText('1girl, text: Hello')).toBe('1girl, text: Hello');
  });

  it('needs the same characters to recognise their strings', () => {
    const chars = [character('sign reading "Two"')];
    const added = addAutoText('a poster saying "One"', chars, false);
    expect(stripAutoText(added, chars, false)).toBe('a poster saying "One"');
    // Without them the section no longer matches, so it stays.
    expect(stripAutoText(added, [], false)).toBe(added);
  });
});
