import { describe, expect, it } from 'vitest';
import type { Lorebook, LorebookEntry } from '@/types/card';
import type { BankLorebook, ChatMessage } from '@/types/project';
import { bankName, cardLoreName, combineLorebooks, copyFromCard, entryBook, lorebooksInPlay, newBankLorebook, withAttachedLore } from '@/lib/lorebookBank';
import { describeEntry, scanLorebook } from '@/lib/lorebookScan';
import { buildChatPrompt, DEFAULT_CHAT_SETTINGS, newMessage } from '@/lib/chatPrompt';
import { newCard } from '@/lib/cardSpec';

const entry = (keys: string[], content: string, patch: Partial<LorebookEntry> = {}): LorebookEntry => ({ keys, content, extensions: {}, enabled: true, insertion_order: 100, use_regex: false, ...patch });
const book = (name: string, entries: LorebookEntry[], patch: Partial<Lorebook> = {}): Lorebook => ({ name, extensions: {}, entries, ...patch });
const bank = (id: string, b: Lorebook, patch: Partial<BankLorebook> = {}): BankLorebook => ({ id, book: b, createdAt: 0, updatedAt: 0, ...patch });

describe('the lorebook bank', () => {
  const chatBook = bank('chat', book('Chat lore', [entry(['ship'], 'The ship is old.')]));
  const personaBook = bank('persona', book('Persona lore', [entry(['sword'], 'Your sword hums.')]));
  const globalBook = bank('global', book('World', [entry(['north'], 'The north is cold.')]));
  const cardCopy = bank('copy', book("Ann's Lorebook", [entry(['ann'], 'Ann again.')]), { fromCard: { projectId: 'card1', name: 'Ann' } });
  const all = [chatBook, personaBook, globalBook, cardCopy];

  it('names books, and a card lorebook as SillyTavern names it on import', () => {
    expect(bankName(bank('x', book('  ', [])))).toBe('Unnamed lorebook');
    expect(cardLoreName({ name: 'Ann', character_book: book('', []) })).toBe("Ann's Lorebook");
    expect(cardLoreName({ name: 'Ann', character_book: book('Ann lore', []) })).toBe('Ann lore');
    expect(newBankLorebook(book('a', []), {}, 7)).toMatchObject({ createdAt: 7, updatedAt: 7, book: { name: 'a' } });
    expect(copyFromCard(all, 'card1')?.id).toBe('copy');
  });

  it("brings in the chat's, the persona's and the global books, in that order, each once", () => {
    const got = lorebooksInPlay(all, { chatLorebookId: 'chat', personaLorebookId: 'persona', globalIds: ['global', 'chat', 'gone'] });
    expect(got.map((a) => [a.id, a.source])).toEqual([
      ['chat', 'chat'],
      ['persona', 'persona'],
      ['global', 'global'],
    ]);
    // A persona book that's also the chat's is read once, as the chat's.
    expect(lorebooksInPlay(all, { chatLorebookId: 'chat', personaLorebookId: 'chat' }).map((a) => a.source)).toEqual(['chat']);
  });

  it("skips the bank copy of the chat's own card's lorebook", () => {
    expect(lorebooksInPlay(all, { projectId: 'card1', globalIds: ['copy', 'global'] }).map((a) => a.id)).toEqual(['global']);
    expect(lorebooksInPlay(all, { projectId: 'card2', globalIds: ['copy'] }).map((a) => a.id)).toEqual(['copy']);
  });

  it("orders entries chat, persona, card, global, and marks where they're from", () => {
    const cardBook = book('Card', [entry(['ann'], 'Ann is a knight.')], { scan_depth: 6 });
    const attached = lorebooksInPlay(all, { chatLorebookId: 'chat', personaLorebookId: 'persona', globalIds: ['global'] });
    const combined = combineLorebooks(cardBook, attached)!;
    expect(combined.entries.map((e) => e.content)).toEqual(['The ship is old.', 'Your sword hums.', 'Ann is a knight.', 'The north is cold.']);
    expect(combined.entries.map(entryBook)).toEqual(['Chat lore', 'Persona lore', undefined, 'World']);
    expect(combined.scan_depth).toBe(6);
    // The books themselves are untouched.
    expect(entryBook(chatBook.book.entries[0])).toBeUndefined();
  });

  it('takes settings from the first book that has them, and recursion from any', () => {
    const attached = lorebooksInPlay([bank('a', book('A', [entry(['x'], 'x')], { token_budget: 300, recursive_scanning: true }))], { globalIds: ['a'] });
    expect(combineLorebooks(undefined, attached)).toMatchObject({ token_budget: 300, recursive_scanning: true, scan_depth: undefined });
    expect(combineLorebooks(undefined, [])).toBeUndefined();
  });

  it('scans the combined book as one, naming the book in the inspector', () => {
    const attached = lorebooksInPlay(all, { globalIds: ['global'] });
    const combined = combineLorebooks(book('Card', [entry(['ann'], 'Ann is a knight.')]), attached);
    const r = scanLorebook(combined, ['Ann rides north.']);
    expect(r.active.map(describeEntry)).toEqual(['Entry 1', 'Entry 2 [World]']);
  });

  it("puts the attached books' entries in the chat prompt, leaving the card alone", () => {
    const card = { ...newCard().data, name: 'Ann', description: 'A knight.' };
    const attached = lorebooksInPlay(all, { chatLorebookId: 'chat', globalIds: ['global'] });
    const loreCard = withAttachedLore(card, attached);
    expect(card.character_book).toBeUndefined();
    const history: ChatMessage[] = [newMessage('user', 'Is the ship ready to sail north?')];
    const built = buildChatPrompt(loreCard, history, DEFAULT_CHAT_SETTINGS);
    const labels = built.parts.map((p) => p.label);
    expect(labels).toContain('Lorebook: Entry 1 [Chat lore]');
    expect(labels).toContain('Lorebook: Entry 2 [World]');
    expect(built.parts.find((p) => p.label === 'Lorebook: Entry 2 [World]')?.content).toBe('The north is cold.');
    expect(withAttachedLore(card, [])).toBe(card);
  });
});
