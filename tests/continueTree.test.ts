import { describe, expect, it } from 'vitest';
import { activePath, addContinue, addReroll, branchCount, choose, pathDepth, pathText, rerollBase, startTree, undoContinue } from '@/lib/continueTree';

describe('continue tree', () => {
  const first = startTree('She smiles.');

  it('builds the reply from the first text and the continues on its path', () => {
    const t = addContinue(addContinue(first, ' "Hello."'), ' She waves.');
    expect(pathText(t)).toBe('She smiles. "Hello." She waves.');
    expect(pathDepth(t)).toBe(2);
    expect(pathText(first)).toBe('She smiles.'); // the original is untouched
  });

  it('rerolls the last continue as a sibling, keeping the old one', () => {
    const t = addContinue(first, ' "Hello."');
    expect(rerollBase(t)).toBe('She smiles.');
    const r = addReroll(t, ' "Hi there."');
    expect(pathText(r)).toBe('She smiles. "Hi there."');
    expect(r.children.map((c) => c.text)).toEqual([' "Hello."', ' "Hi there."']);
    expect(branchCount(r)).toBe(2);
    expect(rerollBase(first)).toBeNull();
  });

  it('undoes a continue without losing it, and can go back to any branch', () => {
    const t = addReroll(addContinue(first, ' A.'), ' B.');
    const undone = undoContinue(t);
    expect(pathText(undone)).toBe('She smiles.');
    expect(branchCount(undone)).toBe(2);
    const backToA = choose(undone, t.children[0].id);
    expect(pathText(backToA)).toBe('She smiles. A.');
    // Continuing from A starts a branch under A.
    const deeper = addContinue(backToA, ' C.');
    expect(activePath(deeper).map((n) => n.text)).toEqual(['She smiles.', ' A.', ' C.']);
  });

  it('choosing a node ends the path there', () => {
    const t = addContinue(addContinue(first, ' A.'), ' B.');
    expect(pathText(choose(t, t.children[0].id))).toBe('She smiles. A.');
    expect(pathText(choose(t, 'nope'))).toBe(pathText(t));
  });
});
