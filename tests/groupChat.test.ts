import { describe, expect, it } from 'vitest';
import { newCard, newEntry, newLorebook } from '@/lib/cardSpec';
import { newMessage } from '@/lib/chatPrompt';
import { castScene, directorMessages, groupGreetings, groupTurn, memberSummary, mentions, namedHistory, nextSpeaker, readDirector, trimGroupReply, type Member } from '@/lib/groupChat';
import type { ChatMessage, GroupSettings } from '@/types/project';

const card = (name: string, over: Partial<ReturnType<typeof newCard>['data']> = {}) => ({ ...newCard().data, name, description: `${name} is {{char}}, a knight.`, personality: `${name}'s brave.`, first_mes: `Hi, I'm ${name}.`, mes_example: `<START>\n{{char}}: ${name} speaks.`, ...over });
const members = (): Member[] => [
  { id: 'a', card: card('Ann', { nickname: 'Annie' }) },
  { id: 'b', card: card('Bob') },
  { id: 'c', card: card('Cid', { description: 'Cid is a very long-winded wizard. '.repeat(20) }), summary: 'The old wizard.' },
];
const said = (speaker: string | null, text: string): ChatMessage => ({ ...newMessage(speaker ? 'assistant' : 'user', text), ...(speaker ? { speaker } : {}) });
const s = (over: Partial<GroupSettings> = {}): GroupSettings => ({ strategy: 'cast', order: 'natural', ...over });

describe('group chats', () => {
  it('knows when a member is named (name or nickname, whole words)', () => {
    expect(mentions('Hey annie, look.', card('Ann', { nickname: 'Annie' }))).toBe(true);
    expect(mentions('Annex the hill.', card('Ann'))).toBe(false);
    expect(mentions('Bob!', card('Bob'))).toBe(true);
  });

  it('puts members in the scene who spoke or were named lately, and the rest off-stage', () => {
    const history = [said('b', 'Hello.'), said(null, 'Where is Cid?')];
    const cast = castScene(members(), 'a', history, s());
    expect(cast.map((p) => [p.id, p.tier])).toEqual([
      ['a', 'speaker'],
      ['b', 'scene'],
      ['c', 'scene'],
    ]);
    expect(cast[2].why).toBe('named in the last message');
    // Long gone: off-stage.
    const quiet = [said('b', 'Hello.'), ...Array.from({ length: 12 }, (_, i) => said(i % 2 ? 'a' : null, 'Mm.'))];
    expect(castScene(members(), 'a', quiet, s()).find((p) => p.id === 'b')?.tier).toBe('offstage');
    // Marked by hand.
    expect(castScene(members(), 'a', history, s(), { b: 'out', c: 'in' }).map((p) => p.tier)).toEqual(['speaker', 'offstage', 'scene']);
  });

  it('drops the least recently active to off-stage past the budget', () => {
    const history = [said(null, 'Cid?'), said('b', 'Yes.')];
    const cast = castScene(members(), 'a', history, s({ castBudget: 20 }), {}, (t) => t.length / 4);
    expect(cast.find((p) => p.id === 'b')?.tier).toBe('scene');
    expect(cast.find((p) => p.id === 'c')?.tier).toBe('offstage');
  });

  it("builds the Cast card: the speaker and the scene in blocks of their own, the rest as summaries", () => {
    const turn = groupTurn({ name: 'G', settings: s({ cacheLayout: false }) }, members(), 'a', [said('b', 'Hi.')]);
    expect(turn.card.name).toBe('Ann');
    expect(turn.card.description).toContain('<character name="Annie" speaking="yes">\nAnn is Annie, a knight.');
    expect(turn.card.description).toContain('<character name="Bob">\nBob is Bob, a knight.');
    expect(turn.card.description).toContain('- Cid: The old wizard.');
    // Only the speaker's examples.
    expect(turn.card.mes_example).toContain('Ann speaks.');
    expect(turn.turnNote).toContain("Write only Annie's next reply");
  });

  it('swaps to the speaker, or joins every card, and brings every lorebook', () => {
    const ms = members();
    ms[1].card.character_book = { ...newLorebook(), entries: [{ ...newEntry(), keys: ['sword'], content: "Bob's sword." }] };
    const swap = groupTurn({ name: 'G', settings: s({ strategy: 'swap' }), scenario: 'At the inn.' }, ms, 'a', []);
    expect(swap.card.description).toBe('Ann is {{char}}, a knight.');
    expect(swap.card.scenario).toBe('At the inn.');
    expect(swap.card.character_book?.entries.map((e) => e.content)).toEqual(["Bob's sword."]);
    const join = groupTurn({ name: 'G', settings: s({ strategy: 'join' }) }, ms, 'a', []);
    expect(join.card.description).toBe('### Annie\nAnn is Annie, a knight.\n\n### Bob\nBob is Bob, a knight.\n\n### Cid\n' + 'Cid is a very long-winded wizard. '.repeat(20).trim());
    const muted = groupTurn({ name: 'G', settings: s({ strategy: 'join' }) }, ms.map((m) => (m.id === 'c' ? { ...m, muted: true } : m)), 'a', []);
    expect(muted.card.description).not.toContain('Cid');
  });

  it('lays Cast out for prompt caches: the same start every turn, the speaker after the history', () => {
    const history = [said('b', 'Hi.')];
    const forAnn = groupTurn({ name: 'Lucky Star', settings: s(), scenario: 'School.' }, members(), 'a', history);
    const forBob = groupTurn({ name: 'Lucky Star', settings: s(), scenario: 'School.' }, members(), 'b', [...history, said('a', 'Yo.')]);
    // What comes before the history doesn't change with the speaker.
    for (const k of ['name', 'description', 'personality', 'scenario', 'mes_example', 'system_prompt'] as const) expect(forAnn.card[k]).toBe(forBob.card[k]);
    expect(forAnn.card.name).toBe('Lucky Star');
    expect(forAnn.card.description).toContain('- Cid: The old wizard.');
    // The speaker, the scene and the examples come last.
    expect(forAnn.turnNote).toContain('<character name="Annie" speaking="yes">');
    expect(forAnn.turnNote).toContain('<character name="Bob">');
    expect(forAnn.turnNote).toContain('How Annie talks:');
    expect(forAnn.turnNote.trim().endsWith("Write only Annie's next reply; don't write for the others or for {{user}}.]")).toBe(true);
  });

  it("puts each character's memory in their part", () => {
    const memories = { a: 'Bob owes her money.', b: 'Ann was rude yesterday.' };
    const cast = groupTurn({ name: 'G', settings: s() }, members(), 'a', [said('b', 'Hi.')], { memories });
    expect(cast.turnNote).toContain("Annie's memories of this chat so far:\nBob owes her money.");
    expect(cast.turnNote).toContain("Bob's memories of this chat so far:\nAnn was rude yesterday.");
    const swap = groupTurn({ name: 'G', settings: s({ strategy: 'swap' }) }, members(), 'a', [], { memories });
    expect(swap.card.description).toContain('Bob owes her money.');
    expect(swap.card.description).not.toContain('rude');
  });

  it("writes a member's summary from their description when there's none", () => {
    expect(memberSummary({ id: 'x', card: card('Dee', { description: 'Dee is {{char}}. Short.' }) })).toBe('Dee is Dee. Short.');
    expect(memberSummary(members()[2])).toBe('The old wizard.');
  });

  it('names who said what, and keeps a reply to its speaker', () => {
    const named = namedHistory([said(null, 'Hi'), said('b', 'Hello.'), said('a', 'Annie: Already named.')], members());
    expect(named.map((m) => m.swipes[0])).toEqual(['Hi', 'Bob: Hello.', 'Annie: Already named.']);
    expect(trimGroupReply('Annie: I draw my sword.\nBob: And I mine.', 'Annie', ['Bob', 'Cid', 'You'])).toBe('I draw my sword.');
  });

  it('picks who speaks next by the order', () => {
    const ms = members();
    const history = [said('a', 'Hi.'), said(null, 'Bob, your turn.')];
    expect(nextSpeaker(ms, history, s())).toBe('b');
    expect(nextSpeaker(ms, [said('a', 'Hi.')], s({ order: 'list' }))).toBe('b');
    expect(nextSpeaker(ms, [said('c', 'Hi.')], s({ order: 'list' }))).toBe('a');
    expect(nextSpeaker(ms, history, s({ order: 'manual' }))).toBeNull();
    // Pooled: whoever hasn't spoken since your message.
    expect(nextSpeaker(ms, [said(null, 'Go.'), said('a', '1'), said('b', '2')], s({ order: 'pooled' }), () => 0)).toBe('c');
    // Never yourself twice, unless allowed.
    expect(nextSpeaker([ms[0], ms[1]], [said('a', 'Ann again?')], s(), () => 0)).toBe('b');
    expect(nextSpeaker(ms.map((m) => ({ ...m, muted: m.id !== 'a' })), [said('a', 'x')], s())).toBe('a');
  });

  it('asks the model who speaks next, and reads its answer', () => {
    const ms = members();
    const ask = directorMessages(ms, [said('a', 'Hi.'), said(null, 'Hey Bob.')], s({ order: 'model' }), 'Max');
    expect(ask[1].content).toContain('- Bob: Bob is Bob, a knight.');
    expect(ask[1].content).toContain('Max: Hey Bob.');
    // Not the last speaker again (unless allowed); you're always a choice.
    expect(ask[1].content).toContain('Answer with one of: Bob, Cid, Max.');
    expect(readDirector('Bob', ms, 'Max')).toEqual({ speaker: 'b' });
    expect(readDirector('<think>Annie or Cid…</think>I think Cid should.', ms, 'Max')).toEqual({ speaker: 'c' });
    expect(readDirector('annie', ms, 'Max')).toEqual({ speaker: 'a' });
    expect(readDirector("It's Max's turn.", ms, 'Max')).toEqual({ user: true });
    expect(readDirector('Nobody.', ms, 'Max')).toBeNull();
  });

  it("opens with every member's greeting, or the first's", () => {
    const make = (m: Member, text: string) => said(m.id, text);
    expect(groupGreetings(members(), s(), make).map((m) => m.speaker)).toEqual(['a', 'b', 'c']);
    expect(groupGreetings(members(), s({ greetings: 'first' }), make).map((m) => m.speaker)).toEqual(['a']);
  });
});
