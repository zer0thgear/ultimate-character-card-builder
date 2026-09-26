// Counts Qwen 3.5 (byte-level BPE) tokens, the tokenizer NovelAI's prompt
// counter uses for V5. Unlike its T5 counter, NovelAI counts V5 text as
// written: emphasis syntax is not stripped and no end-of-text token is added.
// See docs/REVERSE_ENGINEERING.md.

// Qwen's pre-tokenizer pattern, with `\s` spelled out as Unicode White_Space
// (what the original Rust regex means by it; JS's `\s` differs slightly) and
// the case-insensitive contractions written out, since `(?i:…)` groups are
// too new to rely on.
const WS = '\\t-\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const SPLIT = new RegExp(
  [
    "'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])",
    '[^\\r\\n\\p{L}\\p{N}]?[\\p{L}\\p{M}]+',
    '\\p{N}',
    ` ?[^${WS}\\p{L}\\p{M}\\p{N}]+[\\r\\n]*`,
    `[${WS}]*[\\r\\n]+`,
    `[${WS}]+(?![^${WS}])`,
    `[${WS}]+`,
  ].join('|'),
  'gu',
);

// Control tokens that count as one token when typed literally.
const SPECIAL_TOKENS = [
  '<|endoftext|>', '<|im_start|>', '<|im_end|>', '<|object_ref_start|>', '<|object_ref_end|>',
  '<|box_start|>', '<|box_end|>', '<|quad_start|>', '<|quad_end|>', '<|vision_start|>',
  '<|vision_end|>', '<|vision_pad|>', '<|image_pad|>', '<|video_pad|>', '<tool_call>',
  '</tool_call>', '<|fim_prefix|>', '<|fim_middle|>', '<|fim_suffix|>', '<|fim_pad|>',
  '<|repo_name|>', '<|file_sep|>', '<tool_response>', '</tool_response>', '<think>', '</think>',
];
const SPECIAL_SPLIT = new RegExp(
  `(${[...SPECIAL_TOKENS]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[|\\/<>]/g, '\\$&'))
    .join('|')})`,
);

/** GPT-2's reversible byte → printable character mapping. */
const BYTE_CHARS: string[] = (() => {
  const printable: number[] = [];
  for (let b = 0x21; b <= 0x7e; b++) printable.push(b);
  for (let b = 0xa1; b <= 0xac; b++) printable.push(b);
  for (let b = 0xae; b <= 0xff; b++) printable.push(b);
  const chars: string[] = [];
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    chars[b] = String.fromCharCode(printable.includes(b) ? b : 256 + extra++);
  }
  return chars;
})();

const encoder = new TextEncoder();

export class QwenTokenizer {
  /** Merge rank by "left right" (byte-level tokens never contain a space). */
  private readonly ranks = new Map<string, number>();
  private readonly cache = new Map<string, number>();

  /** `merges` is Qwen's merges.txt: one "left right" pair per line, in rank order. */
  constructor(merges: string) {
    let rank = 0;
    for (const line of merges.split(/\r?\n/)) if (line) this.ranks.set(line, rank++);
  }

  count(text: string): number {
    let total = 0;
    for (const [i, part] of text.normalize('NFC').split(SPECIAL_SPLIT).entries()) {
      if (i % 2 === 1) total += 1;
      else for (const [word] of part.matchAll(SPLIT)) total += this.countWord(word);
    }
    return total;
  }

  private countWord(word: string): number {
    const cached = this.cache.get(word);
    if (cached !== undefined) return cached;
    let parts = Array.from(encoder.encode(word), (b) => BYTE_CHARS[b]);
    // Standard BPE: repeatedly merge every occurrence of the best-ranked pair.
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
