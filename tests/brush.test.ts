import { describe, expect, it } from 'vitest';
import { floodFill, maskStampCells, segmentStamps, softFalloff, stampBounds } from '@/lib/brush';

describe('segmentStamps', () => {
  it('stamps every quarter of the brush size, ends included', () => {
    const stamps = segmentStamps({ x: 0, y: 0, size: 20 }, { x: 100, y: 0, size: 20 });
    // 100px at 5px spacing: 20 steps, 21 stamps.
    expect(stamps).toHaveLength(21);
    expect(stamps[0]).toEqual({ x: 0, y: 0, size: 20 });
    expect(stamps[20]).toEqual({ x: 100, y: 0, size: 20 });
    expect(stamps[1].x - stamps[0].x).toBe(5);
  });

  it('never leaves a gap wider than a quarter of the brush, however far the pointer jumped', () => {
    // The skipping this replaces: one stamp per event, hundreds of px apart.
    const stamps = segmentStamps({ x: 10, y: 10, size: 12 }, { x: 610, y: 410, size: 12 });
    for (let i = 1; i < stamps.length; i++) {
      const gap = Math.hypot(stamps[i].x - stamps[i - 1].x, stamps[i].y - stamps[i - 1].y);
      expect(gap).toBeLessThanOrEqual(3 + 1e-9);
    }
  });

  it('keeps stamps at least a pixel apart for tiny brushes', () => {
    const stamps = segmentStamps({ x: 0, y: 0, size: 1 }, { x: 10, y: 0, size: 1 });
    expect(stamps).toHaveLength(11);
  });

  it('eases the size between the ends, for pen pressure', () => {
    const stamps = segmentStamps({ x: 0, y: 0, size: 10 }, { x: 40, y: 0, size: 30 });
    const sizes = stamps.map((s) => s.size);
    expect(sizes[0]).toBe(10);
    expect(sizes[sizes.length - 1]).toBe(30);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  });

  it('gives a single-point stroke two stamps on the same spot', () => {
    const stamps = segmentStamps({ x: 5, y: 5, size: 8 }, { x: 5, y: 5, size: 8 });
    expect(stamps).toEqual([{ x: 5, y: 5, size: 8 }, { x: 5, y: 5, size: 8 }]);
  });
});

describe('maskStampCells', () => {
  const grid = (cells: number[], w: number, h: number) =>
    Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => (cells.includes(y * w + x) ? '#' : '.')).join(''),
    );

  it('draws NovelAI’s default 4-cell mask brush as a rounded block', () => {
    // Centred on a cell corner, like a click in the middle of the canvas.
    const cells = maskStampCells(4, 4, 4, 'circle', 8, 8);
    expect(grid(cells, 8, 8)).toEqual([
      '........',
      '...##...',
      '..####..',
      '.######.',
      '.######.',
      '..####..',
      '...##...',
      '........',
    ]);
  });

  it('draws a square with the same reach', () => {
    const cells = maskStampCells(4, 4, 4, 'square', 8, 8);
    expect(grid(cells, 8, 8)).toEqual([
      '........',
      '........',
      '..####..',
      '..####..',
      '..####..',
      '..####..',
      '........',
      '........',
    ]);
  });

  it('includes cells exactly on the radius, as NovelAI’s ≤ does', () => {
    // A one-cell brush on a cell centre reaches the four edge neighbours'
    // near corners at exactly its radius, so it's a plus, not a dot. NovelAI's
    // smallest mask brush is 4, so this only shows at sizes it never uses.
    const cells = maskStampCells(2.5, 2.5, 1, 'circle', 5, 5);
    expect(grid(cells, 5, 5)).toEqual(['.....', '..#..', '.###.', '..#..', '.....']);
  });

  it('stays inside the layer', () => {
    const cells = maskStampCells(0, 0, 6, 'circle', 4, 4);
    expect(cells.every((c) => c >= 0 && c < 16)).toBe(true);
    expect(cells).toContain(0);
  });
});

describe('floodFill', () => {
  /** A width×height RGBA image from rows of '.' (white) and '#' (black). */
  const image = (rows: string[]) => {
    const h = rows.length;
    const w = rows[0].length;
    const data = new Uint8ClampedArray(w * h * 4);
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const v = ch === '#' ? 0 : 255;
        data.set([v, v, v, 255], (y * w + x) * 4);
      }),
    );
    return { data, w, h };
  };
  const show = (filled: Uint8Array, w: number) =>
    Array.from({ length: filled.length / w }, (_, y) =>
      Array.from(filled.slice(y * w, y * w + w), (f) => (f ? 'o' : '.')).join(''),
    );

  it('fills the region connected to the start, stopping at edges', () => {
    const { data, w, h } = image(['.....', '.###.', '.#..#', '.###.', '.....']);
    expect(show(floodFill(data, w, h, 2, 2, 15), w)).toEqual(['.....', '.....', '..oo.', '.....', '.....']);
  });

  it('flows round a shape, but not across a closed one', () => {
    const { data, w, h } = image(['.....', '.###.', '.#.#.', '.###.', '.....']);
    const filled = show(floodFill(data, w, h, 0, 0, 15), w);
    expect(filled).toEqual(['ooooo', 'o...o', 'o...o', 'o...o', 'ooooo']);
  });

  it('takes nearby colours within the tolerance', () => {
    const data = new Uint8ClampedArray([200, 200, 200, 255, 210, 200, 200, 255, 240, 200, 200, 255]);
    expect([...floodFill(data, 3, 1, 0, 0, 15)]).toEqual([1, 1, 0]);
    expect([...floodFill(data, 3, 1, 0, 0, 40)]).toEqual([1, 1, 1]);
    expect([...floodFill(data, 3, 1, 0, 0, 0)]).toEqual([1, 0, 0]);
  });

  it('counts transparency as part of the colour', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]);
    expect([...floodFill(data, 2, 1, 0, 0, 15)]).toEqual([1, 0]);
  });

  it('does nothing for a start outside the image', () => {
    const { data, w, h } = image(['..', '..']);
    expect([...floodFill(data, w, h, 5, 5, 15)]).toEqual([0, 0, 0, 0]);
  });

  it('copes with a large open area', () => {
    const w = 400;
    const h = 300;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const filled = floodFill(data, w, h, 10, 10, 15);
    expect(filled.reduce((a, b) => a + b, 0)).toBe(w * h);
  });
});

describe('softFalloff', () => {
  it('is full strength at the centre, nothing at the edge, and never rises outward', () => {
    expect(softFalloff(0, 10)).toBe(1);
    expect(softFalloff(5, 10)).toBe(1);
    expect(softFalloff(10, 10)).toBe(0);
    expect(softFalloff(12, 10)).toBe(0);
    let last = 1;
    for (let d = 0; d <= 10; d += 0.5) {
      const w = softFalloff(d, 10);
      expect(w).toBeLessThanOrEqual(last);
      last = w;
    }
  });
});

describe('stampBounds', () => {
  it('covers every stamp and its padding, clipped to the layer', () => {
    const box = stampBounds(
      [
        { x: 10, y: 10, size: 4 },
        { x: 30, y: 20, size: 8 },
      ],
      1,
      100,
      100,
    );
    expect(box).toEqual({ x: 7, y: 7, w: 28, h: 18 });
    expect(stampBounds([{ x: 0, y: 0, size: 10 }], 0, 100, 100)).toEqual({ x: 0, y: 0, w: 5, h: 5 });
  });

  it('is nothing for no stamps, or stamps entirely off the layer', () => {
    expect(stampBounds([], 0, 10, 10)).toBeNull();
    expect(stampBounds([{ x: -50, y: -50, size: 4 }], 0, 10, 10)).toBeNull();
  });
});
