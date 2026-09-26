import { describe, expect, it } from 'vitest';
import { BRACE_FACTOR, findWeightTarget, parseWeighted, stepWeight, withWeight } from '@/lib/emphasis';

describe('parseWeighted', () => {
  it('reads plain text as weight 1', () => {
    expect(parseWeighted('blue hair')).toEqual({ inner: 'blue hair', kind: 'plain', level: 0, weight: 1 });
  });

  it('counts stacked braces up and brackets down', () => {
    expect(parseWeighted('{{blue hair}}')).toMatchObject({ inner: 'blue hair', kind: 'brace', level: 2 });
    expect(parseWeighted('[blue hair]')).toMatchObject({ inner: 'blue hair', kind: 'brace', level: -1 });
    expect(parseWeighted('{{x}}').weight).toBeCloseTo(BRACE_FACTOR ** 2);
    expect(parseWeighted('[x]').weight).toBeCloseTo(1 / BRACE_FACTOR);
  });

  it('reads NovelAI’s explicit weights, including negatives', () => {
    expect(parseWeighted('1.5::blue hair::')).toEqual({
      inner: 'blue hair',
      kind: 'numeric',
      level: 0,
      weight: 1.5,
    });
    expect(parseWeighted('-2::upscaled, blurry::').weight).toBe(-2);
  });

  it('does not treat two neighbouring groups as one', () => {
    expect(parseWeighted('{a}{b}')).toMatchObject({ kind: 'plain', inner: '{a}{b}' });
  });
});

describe('stepWeight', () => {
  it('adds and removes braces', () => {
    expect(stepWeight('blue hair', 1)).toBe('{blue hair}');
    expect(stepWeight('{blue hair}', 1)).toBe('{{blue hair}}');
    expect(stepWeight('blue hair', -1)).toBe('[blue hair]');
  });

  it('passes back through neutral, dropping the syntax', () => {
    expect(stepWeight('{blue hair}', -1)).toBe('blue hair');
    expect(stepWeight('[blue hair]', 1)).toBe('blue hair');
  });

  it('moves an explicit weight by 0.05 and drops it at 1', () => {
    expect(stepWeight('1.5::x::', 1)).toBe('1.55::x::');
    expect(stepWeight('1.05::x::', -1)).toBe('x');
  });
});

describe('withWeight', () => {
  it('writes NovelAI’s syntax, rounded, and nothing at 1', () => {
    expect(withWeight('x', 1.3)).toBe('1.3::x::');
    expect(withWeight('x', 1.2345)).toBe('1.23::x::');
    expect(withWeight('x', 1)).toBe('x');
    expect(withWeight('x', 0)).toBe('0::x::');
  });
});

describe('findWeightTarget', () => {
  const at = (text: string, caret: number) => {
    const span = findWeightTarget(text, caret, caret);
    return span && text.slice(span.start, span.end);
  };

  it('takes the tag the caret is in, not the whole field', () => {
    expect(at('1girl, blue hair, smile', 10)).toBe('blue hair');
  });

  it('splits on newlines as well as commas', () => {
    expect(at('1girl\nblue hair', 8)).toBe('blue hair');
  });

  it('takes the group around the caret', () => {
    expect(at('1girl, {blue hair}, smile', 12)).toBe('{blue hair}');
    expect(at('1girl, 1.5::blue hair::, smile', 15)).toBe('1.5::blue hair::');
  });

  it('takes the innermost group, with identical wrappers stacked on it', () => {
    expect(at('{{blue hair}}', 5)).toBe('{{blue hair}}');
    expect(at('{a, [b], c}', 5)).toBe('[b]');
  });

  it('widens a selection to swallow the wrappers around it', () => {
    const text = '{blue hair}';
    const span = findWeightTarget(text, 1, 10)!;
    expect(text.slice(span.start, span.end)).toBe('{blue hair}');
  });

  it('trims whitespace off a selection, and gives nothing for only whitespace', () => {
    const text = 'a,  blue hair  , b';
    const span = findWeightTarget(text, 2, 15)!;
    expect(text.slice(span.start, span.end)).toBe('blue hair');
    expect(findWeightTarget('a,   , b', 2, 5)).toBeNull();
  });

  it('gives nothing when there is no tag at the caret', () => {
    expect(findWeightTarget('1girl, , smile', 7, 7)).toBeNull();
  });
});
