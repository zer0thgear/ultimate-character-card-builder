import { describe, expect, it } from 'vitest';
import { newCard, newEntry } from '@/lib/cardSpec';
import {
  applyChanges,
  cleanEntryText,
  draftContext,
  keyWarnings,
  newSession,
  parsePlan,
  parseRevision,
  planMessages,
  reviseMessages,
  saveToBook,
  toWrite,
  writeMessages,
  writtenContext,
  type WizardEntry,
} from '@/lib/loreWizard';

const entry = (name: string, extra: Partial<WizardEntry> = {}): WizardEntry => ({ id: name, name, keys: [name.toLowerCase()], brief: `about ${name}`, content: '', ...extra });

describe('reading the Planner', () => {
  it('reads a plan, with or without a fence, and drops nameless and repeated entries', () => {
    const reply = 'Here you go:\n```json\n{"message":"Planned four.","entries":[{"name":"Ashford","category":"place","keys":["Ashford","the town"],"brief":"A mill town."},{"name":""},{"name":"ashford","keys":[]},{"name":"The Order","keys":"Order, knights","always":true,"brief":"Knights."}]}\n```';
    const p = parsePlan(reply);
    expect(p.parsed).toBe(true);
    expect(p.message).toBe('Planned four.');
    expect(p.entries.map((e) => e.name)).toEqual(['Ashford', 'The Order']);
    expect(p.entries[0]).toMatchObject({ category: 'place', keys: ['Ashford', 'the town'], brief: 'A mill town.', content: '' });
    expect(p.entries[1]).toMatchObject({ keys: ['Order', 'knights'], always: true });
  });

  it('keeps a reply that is not JSON as the message', () => {
    expect(parsePlan('What genre is it?')).toEqual({ message: 'What genre is it?', entries: [], parsed: false });
  });

  it('reads changes: adds, edits (with a rename) and removals', () => {
    const r = parseRevision(
      JSON.stringify({
        message: 'Done.',
        changes: [
          { op: 'add', name: 'The Duke', keys: ['Duke', 'his grace'], brief: 'Ruler.' },
          { op: 'edit', entry: 'Ashford', name: 'Ashford Mill', keys: ['Ashford'], rewrite: 'Make it grimmer.' },
          { op: 'edit', entry: 'Order', always: 'false' },
          { op: 'remove', entry: 'Gods' },
          { op: 'shrug' },
        ],
      }),
    );
    expect(r.message).toBe('Done.');
    expect(r.changes).toHaveLength(4);
    expect(r.changes[0]).toMatchObject({ op: 'add', entry: { name: 'The Duke', keys: ['Duke', 'his grace'] } });
    expect(r.changes[1]).toEqual({ op: 'edit', entry: 'Ashford', name: 'Ashford Mill', keys: ['Ashford'], rewrite: 'Make it grimmer.' });
    expect(r.changes[2]).toEqual({ op: 'edit', entry: 'Order', always: false });
    expect(r.changes[3]).toEqual({ op: 'remove', entry: 'Gods' });
  });
});

describe('applying changes', () => {
  const draft = [entry('Ashford', { content: 'A mill town.' }), entry('The Order'), entry('Gods')];

  it('adds, removes and edits, and queues a rewrite of a written entry', () => {
    const r = parseRevision(
      JSON.stringify({
        changes: [
          { op: 'add', name: 'The Duke', keys: ['Duke'] },
          { op: 'add', name: 'gods' },
          { op: 'edit', entry: 'ashford', rewrite: 'Grimmer.' },
          { op: 'edit', entry: 'Order', brief: 'Knights who hunt witches.', always: true },
          { op: 'remove', entry: 'Gods' },
          { op: 'remove', entry: 'Nobody' },
        ],
      }),
    );
    const { entries, notes } = applyChanges(draft, r.changes);
    expect(entries.map((e) => e.name)).toEqual(['Ashford', 'The Order', 'The Duke']);
    expect(entries[0].rewrite).toBe('Grimmer.');
    expect(entries[0].content).toBe('A mill town.');
    expect(entries[1]).toMatchObject({ brief: 'Knights who hunt witches.', always: true });
    expect(notes).toEqual(['+ The Duke', '"gods" is already there', '✎ Ashford: to rewrite', '✎ The Order: always on, plan', '− Gods', 'couldn\'t find "Nobody"']);
    // Unwritten and rewrites wait for the Writer.
    expect(toWrite(entries).map((e) => e.name)).toEqual(['Ashford', 'The Order', 'The Duke']);
  });

  it('folds a change to an unwritten entry into its plan', () => {
    const { entries } = applyChanges(draft, [{ op: 'edit', entry: 'The Order', rewrite: 'They wear grey.' }]);
    expect(entries[1].brief).toBe('about The Order They wear grey.');
    expect(entries[1].rewrite).toBeUndefined();
  });

  it('finds an entry by part of its name when only one matches', () => {
    expect(applyChanges(draft, [{ op: 'remove', entry: 'Order' }]).entries.map((e) => e.name)).toEqual(['Ashford', 'Gods']);
  });
});

describe('keys', () => {
  it('flags missing, shared, common and short keys', () => {
    const w = keyWarnings([entry('A', { keys: [] }), entry('B', { keys: ['Duke', 'the'] }), entry('C', { keys: ['duke', 'xy'] }), entry('D', { keys: [], always: true }), entry('E', { keys: ['/the/'] })]);
    expect(w.A).toEqual(['no keys, so it never fires']);
    expect(w.B).toEqual(['"Duke" also fires C', '"the" is too common']);
    expect(w.C).toEqual(['"duke" also fires B', '"xy" is too common']);
    expect(w.D).toBeUndefined();
    expect(w.E).toBeUndefined();
  });
});

describe('prompts', () => {
  const card = { ...newCard().data, name: 'Mira', description: 'A witch in hiding.', character_book: { extensions: {}, entries: [{ ...newEntry(), name: 'Old Mill', keys: ['mill'], content: 'It burned.' }] } };

  it('plans from the brief, the card and its lorebook', () => {
    const s = { ...newSession(), pitch: 'A grim witch-hunt town', focus: ['Places', 'Factions'], size: 'small' as const };
    const [system, user] = planMessages(s, card);
    expect(system.role).toBe('system');
    expect(system.content).toContain('Reply with JSON only');
    expect(user.content).toContain('A witch in hiding.');
    expect(user.content).toContain('- Old Mill (keys: mill)');
    expect(user.content).not.toContain('It burned.');
    expect(user.content).toContain('The creator\'s pitch: A grim witch-hunt town');
    expect(user.content).toContain('Focus on: Places, Factions');
    expect(user.content).toContain('Plan about 8 entries.');
  });

  it('leaves the card out when asked to', () => {
    const [, user] = planMessages({ ...newSession(), useCard: false, pitch: 'Space pirates' }, card);
    expect(user.content).not.toContain('witch');
    expect(user.content).not.toContain('<card>');
    expect(user.content).not.toContain('Focus on');
  });

  it('sends the draft and the conversation with your message', () => {
    const s = { ...newSession(), entries: [entry('Ashford', { content: 'A mill town.' }), entry('The Order')], chat: [{ role: 'user' as const, text: 'Make it grim' }, { role: 'wizard' as const, text: 'Sure.' }] };
    const [, user] = reviseMessages(s, card, 'Add a duke');
    expect(user.content).toContain('<entry name="Ashford" keys="ashford">\nA mill town.\n</entry>');
    expect(user.content).toContain('(planned) about The Order');
    expect(user.content).toContain('Creator: Make it grim\nYou: Sure.');
    expect(user.content).toContain('The creator says: Add a duke');
  });

  it('writes an entry with the plan and the others, and rewrites with the change', () => {
    const s = { ...newSession(), length: 'short' as const, entries: [entry('Ashford', { content: 'A mill town.', rewrite: 'Grimmer.' }), entry('The Order', { content: 'Knights.' }), entry('Gods')] };
    const [, first] = writeMessages(s, card, s.entries[2]);
    expect(first.content).toContain('- Gods: about Gods');
    expect(first.content).toContain('<entry name="Ashford">\nA mill town.\n</entry>');
    expect(first.content).not.toContain('<current_text>');
    expect(first.content).not.toContain('What to change');
    expect(first.content).toContain('Write the entry "Gods" (keys: gods). It covers: about Gods');
    expect(first.content).toContain('Length: under 80 words.');
    const [, again] = writeMessages(s, card, s.entries[0], 'And shorter.');
    expect(again.content).toContain('<current_text>\nA mill town.\n</current_text>');
    expect(again.content).toContain('What to change: Grimmer.\nAnd shorter.');
    expect(again.content).not.toContain('<entry name="Ashford">');
  });

  it('cuts written entries evenly when they are too long together', () => {
    const long = [entry('A', { content: 'x'.repeat(1000) }), entry('B', { content: 'y'.repeat(1000) })];
    expect(writtenContext(long, undefined, 400)).toContain(`${'x'.repeat(200)}…`);
    expect(draftContext([])).toBe('(nothing planned yet)');
  });

  it('cleans the Writer\'s reply', () => {
    expect(cleanEntryText('```\nContent: The town.\n```')).toBe('The town.');
    expect(cleanEntryText('"The town."')).toBe('The town.');
    expect(cleanEntryText('The "old" town.')).toBe('The "old" town.');
  });
});

describe('saving', () => {
  const written = [entry('Ashford', { content: 'A mill town. ', keys: ['Ashford'] }), entry('Gods'), entry('The Order', { content: 'Knights.', always: true })];

  it('starts a lorebook with the written entries only', () => {
    const r = saveToBook(undefined, written, { name: 'Ashford lore' });
    expect(r).toMatchObject({ added: 2, replaced: 0 });
    expect(r.book.name).toBe('Ashford lore');
    expect(r.book.entries.map((e) => [e.name, e.comment, e.content, e.constant, e.id])).toEqual([
      ['Ashford', 'Ashford', 'A mill town.', false, 0],
      ['The Order', 'The Order', 'Knights.', true, 1],
    ]);
  });

  it('adds after what is there, or replaces entries of the same name', () => {
    const book = { name: 'Mine', extensions: {}, entries: [{ ...newEntry(), id: 5, name: 'ashford', comment: 'ashford', keys: ['old'], content: 'Old.', insertion_order: 300, extensions: { sticky: 2 } }] };
    const added = saveToBook(book, written);
    expect(added.book.entries.map((e) => e.id)).toEqual([5, 6, 7]);
    expect(added.book.name).toBe('Mine');
    const replaced = saveToBook(book, written, { replace: true });
    expect(replaced).toMatchObject({ added: 1, replaced: 1 });
    expect(replaced.book.entries[0]).toMatchObject({ id: 5, name: 'ashford', keys: ['Ashford'], content: 'A mill town.', insertion_order: 300, extensions: { sticky: 2 } });
    expect(replaced.book.entries[1]).toMatchObject({ name: 'The Order', insertion_order: 301 });
  });
});
