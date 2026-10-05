import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELPER_PERSONALITIES, chunkDoc, helperMessages, outline, pickChunks, searchTerms, type HelpDocs } from '@/lib/helpDesk';

const docs: HelpDocs = {
  tour: readFileSync('docs/TOUR.md', 'utf8'),
  features: readFileSync('docs/FEATURES.md', 'utf8'),
  readme: readFileSync('README.md', 'utf8'),
};

describe('helper docs', () => {
  it('splits a doc at its headings, titling each chunk with them', () => {
    const chunks = chunkDoc('Doc', '# Top\nintro\n## A\nalpha\n### A1\nnested\n## B\nbeta');
    expect(chunks.map((c) => [c.title, c.text])).toEqual([
      ['Doc', 'intro'],
      ['Doc › A', 'alpha'],
      ['Doc › A › A1', 'nested'],
      ['Doc › B', 'beta'],
    ]);
  });

  it('keeps long sections in chunks of whole list items', () => {
    const items = Array.from({ length: 40 }, (_, i) => `- item ${i} ${'x'.repeat(200)}`).join('\n');
    const chunks = chunkDoc('Doc', `## Long\n${items}`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(2500);
      expect(c.text.startsWith('- item')).toBe(true);
    }
    expect(chunks.map((c) => c.text).join('\n')).toBe(items);
  });

  it('drops common words from a question', () => {
    expect(searchTerms('How do I use the lorebooks?')).toEqual(['lorebook']);
  });

  it('finds the parts of the reference a question is about', () => {
    const chunks = chunkDoc('Feature reference', docs.features);
    const picked = pickChunks(chunks, 'How do I set up a ComfyUI workflow?', 6000);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.some((c) => /comfyui/i.test(c.text))).toBe(true);
    expect(picked.reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(6000);
    expect(pickChunks(chunks, 'the and how', 6000)).toEqual([]);
  });

  it('finds prompt tidbits and wildcards', () => {
    const chunks = chunkDoc('Feature reference', docs.features);
    expect(pickChunks(chunks, 'How do prompt tidbits work?', 6000).some((c) => /Tidbit Library/.test(c.text))).toBe(true);
    expect(pickChunks(chunks, 'Can I use wildcards?', 6000).some((c) => /__Name__/.test(c.text))).toBe(true);
  });

  it('finds the lorebook wizard', () => {
    const chunks = chunkDoc('Feature reference', docs.features);
    expect(pickChunks(chunks, 'Can the assistant write a whole lorebook for me?', 6000).some((c) => c.title.includes('Lorebook wizard'))).toBe(true);
  });

  it('outlines the reference by its headings', () => {
    const o = outline(docs.features);
    expect(o).toContain('- Test chat');
    expect(o).toContain('  - SillyTavern presets');
  });
});

describe('helper request', () => {
  it('sends the guide, the macros and the voice, then the conversation', () => {
    const thread = [{ role: 'user' as const, content: 'Where do I add an author’s note?' }];
    const [system, ...rest] = helperMessages(docs, thread, HELPER_PERSONALITIES.find((p) => p.id === 'brat')!.prompt);
    expect(system.role).toBe('system');
    expect(system.content).toContain('{{random:a,b,c}}');
    expect(system.content).toContain('A tour of UCCB');
    expect(system.content).toContain('smug, teasing brat');
    expect(system.content).toMatch(/Author's note/);
    expect(rest).toEqual(thread);
  });

  it('falls back to the plain voice when a custom one is empty', () => {
    const [system] = helperMessages(docs, [{ role: 'user', content: 'hi' }], '  ');
    expect(system.content).toContain(HELPER_PERSONALITIES[0].prompt);
  });

  it('gives every personality a greeting and a voice', () => {
    expect(new Set(HELPER_PERSONALITIES.map((p) => p.id)).size).toBe(HELPER_PERSONALITIES.length);
    for (const p of HELPER_PERSONALITIES) expect(p.prompt && p.greeting && p.label).toBeTruthy();
  });
});
