import { uuid } from '@/lib/uuid';

// Continues as a tree, after SillyTavern's More Flexible Continues: a
// reply's text is its first generation followed by the continues along the
// chosen path. Every continue ever made from a point is kept as a branch,
// so one can be rerolled (a new sibling), undone (the path stops before
// it, the branch stays), or picked again later from the tree.

export interface ContinueNode {
  id: string;
  /** This part's text: the reply as first written (the root), or what one
   *  continue added, with its joining space. */
  text: string;
  children: ContinueNode[];
  /** The child the path goes on through; none, and the path ends here. */
  active?: number;
}

export const startTree = (text: string): ContinueNode => ({ id: uuid(), text, children: [] });

/** The nodes along the chosen path, root first. */
export function activePath(root: ContinueNode): ContinueNode[] {
  const path = [root];
  let node = root;
  while (node.active !== undefined && node.children[node.active]) {
    node = node.children[node.active];
    path.push(node);
  }
  return path;
}

/** The reply's text: the parts along the chosen path. */
export const pathText = (root: ContinueNode) => activePath(root).map((n) => n.text).join('');

/** How many continues are on the chosen path (0: just the first text). */
export const pathDepth = (root: ContinueNode) => activePath(root).length - 1;

/** Every continue in the tree, chosen or not. */
export const branchCount = (root: ContinueNode): number => root.children.reduce((n, c) => n + 1 + branchCount(c), 0);

const clone = (n: ContinueNode): ContinueNode => ({ ...n, children: n.children.map(clone) });

/** A continue added at the end of the chosen path, which now goes through it. */
export function addContinue(root: ContinueNode, text: string): ContinueNode {
  const out = clone(root);
  const end = activePath(out).at(-1)!;
  end.children.push({ id: uuid(), text, children: [] });
  end.active = end.children.length - 1;
  return out;
}

/** The text a reroll continues from: the path without its last continue.
 *  Null when there's no continue to reroll. */
export function rerollBase(root: ContinueNode): string | null {
  const path = activePath(root);
  return path.length > 1 ? path.slice(0, -1).map((n) => n.text).join('') : null;
}

/** A reroll of the last continue: a sibling of it, now the chosen one. */
export function addReroll(root: ContinueNode, text: string): ContinueNode {
  const out = clone(root);
  const path = activePath(out);
  const parent = path.at(-2);
  if (!parent) return addContinue(out, text);
  parent.children.push({ id: uuid(), text, children: [] });
  parent.active = parent.children.length - 1;
  return out;
}

/** Takes the last continue off the chosen path (it stays in the tree). */
export function undoContinue(root: ContinueNode): ContinueNode {
  const out = clone(root);
  const parent = activePath(out).at(-2);
  if (parent) parent.active = undefined;
  return out;
}

/** The path through `id`, ending there. */
export function choose(root: ContinueNode, id: string): ContinueNode {
  const out = clone(root);
  const walk = (node: ContinueNode): boolean => {
    if (node.id === id) {
      node.active = undefined;
      return true;
    }
    const i = node.children.findIndex(walk);
    if (i < 0) return false;
    node.active = i;
    return true;
  };
  return walk(out) ? out : root;
}

/** Whether a node is on the chosen path. */
export const onPath = (root: ContinueNode, id: string) => activePath(root).some((n) => n.id === id);
