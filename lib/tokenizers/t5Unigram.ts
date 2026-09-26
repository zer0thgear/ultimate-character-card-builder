// Counts T5 (SentencePiece Unigram) tokens the way NovelAI's own prompt
// counter does for V4/V4.5, so the two agree token for token. The quirks are
// NovelAI's and are kept deliberately: emphasis syntax is stripped first, each
// run of whitespace becomes its own "▁"-prefixed word (so a leading or trailing
// space costs a token), the lattice walks UTF-16 code units, and the end-of-
// text token is included. See docs/REVERSE_ENGINEERING.md.

export interface T5Vocab {
  unkId: number;
  pieces: string[];
  scores: number[];
}

interface TrieNode {
  children: Map<string, TrieNode>;
  /** Vocab id of the piece ending here, or -1. */
  id: number;
}

const newNode = (): TrieNode => ({ children: new Map(), id: -1 });

export class T5Tokenizer {
  private readonly root = newNode();
  private readonly scores: number[];
  private readonly unkScore: number;

  constructor(vocab: T5Vocab) {
    this.scores = [...vocab.scores];
    this.unkScore = Math.min(...vocab.scores) - 10;
    this.scores[vocab.unkId] = this.unkScore;
    vocab.pieces.forEach((piece, id) => {
      let node = this.root;
      // Inserted by code point but searched by code unit, as NovelAI's is:
      // pieces with astral characters never match, and those characters fall
      // back to one unknown token per code unit.
      for (const ch of piece) {
        let next = node.children.get(ch);
        if (!next) node.children.set(ch, (next = newNode()));
        node = next;
      }
      node.id = id;
    });
  }

  /** Token count for one prompt, including the end-of-text token. */
  count(text: string): number {
    if (!text) return 1;
    const stripped = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '');
    let total = 1;
    for (const word of stripped.split(/\s+/)) total += this.countWord(word.startsWith('▁') ? word : `▁${word}`);
    return total;
  }

  /** Viterbi over the word's lattice, as NovelAI runs it: each node takes
   *  the first predecessor (in insertion order) with the highest
   *  `predecessor score + own score`. Summing before comparing matters —
   *  rounding can tie two predecessors for one node but not another. */
  private countWord(word: string): number {
    const len = word.length;
    // Nodes ending at each position, in insertion order (by start, then length).
    const endingAt: { start: number; score: number; best: number; count: number }[][] = Array.from(
      { length: len + 1 },
      () => [],
    );
    const startingAt: { start: number; end: number; score: number }[][] = Array.from({ length: len + 1 }, () => []);

    for (let start = 0; start < len; start++) {
      let node: TrieNode | undefined = this.root;
      let singleChar = false;
      for (let end = start + 1; end <= len && node; end++) {
        node = node.children.get(word[end - 1]);
        if (node && node.id >= 0) {
          startingAt[start].push({ start, end, score: this.scores[node.id] });
          if (end === start + 1) singleChar = true;
        }
      }
      if (!singleChar) startingAt[start].push({ start, end: start + 1, score: this.unkScore });
    }

    // Position 0 is reached by the (zero-score, uncounted) start node.
    const preds = (pos: number) => (pos === 0 ? [{ start: -1, score: 0, best: 0, count: 0 }] : endingAt[pos]);
    for (let pos = 0; pos < len; pos++) {
      const before = preds(pos);
      for (const node of startingAt[pos]) {
        let best = 0;
        let count = 0;
        let found = false;
        for (const p of before) {
          const total = p.best + node.score;
          if (!found || total > best) {
            best = total;
            count = p.count + 1;
            found = true;
          }
        }
        endingAt[node.end].push({ start: node.start, score: node.score, best, count });
      }
    }
    // The end node scores 0, so its predecessor is simply the first best path.
    let best = 0;
    let count = 0;
    let found = false;
    for (const p of preds(len)) {
      if (!found || p.best > best) {
        best = p.best;
        count = p.count;
        found = true;
      }
    }
    return count;
  }
}
