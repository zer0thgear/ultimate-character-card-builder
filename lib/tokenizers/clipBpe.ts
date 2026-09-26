// Counts CLIP (byte-level BPE) tokens the way NovelAI's prompt counter does
// for V3. Its preprocessing is kept exactly: `[]{}` become spaces, HTML
// entities are decoded (twice, by the same `html-entities` library), runs of
// whitespace collapse, and everything is lowercased. Weight syntax is not
// stripped and no start/end tokens are counted. See docs/REVERSE_ENGINEERING.md.

// CLIP's word split (openai/CLIP simple_tokenizer), as NovelAI writes it.
const WORDS = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;
const SPECIAL = new Set(['<|startoftext|>', '<|endoftext|>']);
/** CLIP uses the first 48,894 merges of its vocabulary file. */
const MERGE_COUNT = 48894;

/** GPT-2's reversible byte → printable character mapping (CLIP reuses it). */
const BYTE_CHARS: string[] = (() => {
  const printable: number[] = [];
  for (let b = 0x21; b <= 0x7e; b++) printable.push(b);
  for (let b = 0xa1; b <= 0xac; b++) printable.push(b);
  for (let b = 0xae; b <= 0xff; b++) printable.push(b);
  const chars: string[] = [];
  let extra = 0;
  for (let b = 0; b < 256; b++) chars[b] = String.fromCharCode(printable.includes(b) ? b : 256 + extra++);
  return chars;
})();

const encoder = new TextEncoder();

export class ClipTokenizer {
  private readonly ranks = new Map<string, number>();
  private readonly cache = new Map<string, number>();
  private readonly decodeEntities: (text: string) => string;

  /** `merges` is CLIP's merges file ("#version" header, then "left right" per
   *  line in rank order). `decodeEntities` is html-entities' `decode`. */
  constructor(merges: string, decodeEntities: (text: string) => string) {
    this.decodeEntities = decodeEntities;
    const lines = merges.split(/\r?\n/);
    const start = lines[0]?.startsWith('#') ? 1 : 0;
    lines.slice(start, start + MERGE_COUNT).forEach((line, rank) => this.ranks.set(line, rank));
  }

  count(text: string): number {
    const spaced = text.replace(/[[\]{}]/g, ' ').trim();
    const decoded = this.decodeEntities(this.decodeEntities(spaced)).trim();
    const normalized = decoded.replace(/\s+/g, ' ').trim().toLowerCase();
    let total = 0;
    for (const [word] of normalized.matchAll(WORDS)) {
      total += SPECIAL.has(word) ? 1 : this.countWord(Array.from(encoder.encode(word), (b) => BYTE_CHARS[b]).join(''));
    }
    return total;
  }

  private countWord(word: string): number {
    const cached = this.cache.get(word);
    if (cached !== undefined) return cached;
    // The last symbol carries CLIP's end-of-word marker.
    let parts = [...word.slice(0, -1), `${word.slice(-1)}</w>`];
    while (parts.length > 1) {
      let bestRank = Infinity;
      let best = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const pair = `${parts[i]} ${parts[i + 1]}`;
        const rank = this.ranks.get(pair);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = pair;
        }
      }
      if (bestRank === Infinity) break;
      const [left, right] = best.split(' ');
      const merged: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === left && parts[i + 1] === right) {
          merged.push(left + right);
          i++;
        } else merged.push(parts[i]);
      }
      parts = merged;
    }
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(word, parts.length);
    return parts.length;
  }
}
