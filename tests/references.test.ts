import { describe, expect, it } from 'vitest';
import { attachReferences, referenceBlock, withReferences, type Reference } from '@/lib/references';
import { setTemplateOverrides } from '@/lib/assist';
import { newCard } from '@/lib/cardSpec';

const card = (name: string, description: string) => ({ ...newCard().data, name, description });
const sister: Reference = { id: 'c1', kind: 'card', name: 'Ada', card: card('Ada', 'Tall, stern, a librarian.') };
const pic: Reference = { id: 'p1', kind: 'image', name: 'castle.png', image: { mediaType: 'image/jpeg', data: 'AAAA' }, thumb: 'data:,' };

describe('references', () => {
  it('sends cards as text and pictures with the message', () => {
    const m = attachReferences({ role: 'user', content: 'Write her sister.' }, [sister, pic]);
    expect(m.content).toContain('<reference_card name="Ada">');
    expect(m.content).toContain('Tall, stern, a librarian.');
    expect(m.content).toContain('One picture is attached: castle.png.');
    expect(m.content.endsWith('Write her sister.')).toBe(true);
    expect(m.images).toEqual([pic.image]);
  });

  it('leaves out what there is none of', () => {
    const block = referenceBlock([sister]);
    expect(block).not.toMatch(/picture/);
    expect(referenceBlock([])).toBe('');
    expect(attachReferences({ role: 'user', content: 'x' }, [sister]).images).toBeUndefined();
  });

  it('goes on the last user message of a job', () => {
    const msgs = withReferences([{ role: 'system', content: 's' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], [pic]);
    expect(msgs[1]).toEqual({ role: 'user', content: 'a' });
    expect(msgs[3].images).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: 'system', content: 's' });
  });

  it('uses your edited wording', () => {
    setTemplateOverrides({ 'references.user': 'REFS:\n\n{{cards}}' });
    expect(referenceBlock([sister])).toMatch(/^REFS:\n\n<reference_card/);
    setTemplateOverrides(undefined);
  });
});
