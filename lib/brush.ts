// The pure parts of the canvas editor: where a stroke's stamps go, which
// cells a mask brush covers, and flood fill. Worked out from novelai.net's
// canvas (read 2026-09-24) so strokes and masks come out the way its do.

export interface Point {
  x: number;
  y: number;
}

export interface Stamp extends Point {
  /** Brush diameter at this stamp, in layer pixels. */
  size: number;
}

/**
 * The stamps that cover a stroke segment, as NovelAI lays them: one every
 * quarter of the brush size (at least one pixel apart), with the size
 * eased from one end to the other so pen pressure changes smoothly. Both
 * ends are included; a stroke passes its previous end in as `from`, so the
 * caller skips the first stamp after the stroke's opening one.
 *
 * Stamping every quarter-diameter is what keeps a fast stroke solid: the
 * pointer can move hundreds of pixels between two events, and one stamp per
 * event is what leaves the dotted trail.
 */
export function segmentStamps(from: Stamp, to: Stamp): Stamp[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const spacing = Math.max(1, ((from.size + to.size) / 2) * 0.25);
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing));
  const stamps: Stamp[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stamps.push({ x: from.x + dx * t, y: from.y + dy * t, size: from.size + (to.size - from.size) * t });
  }
  return stamps;
}

export type MaskShape = 'circle' | 'square';

/**
 * The cells a mask stamp fills: NovelAI's pixel-perfect rule, so a mask
 * drawn here covers the same latent cells one drawn there would. A cell is
 * in when the corner of it nearest the stamp's centre is within the radius
 * (for a square, when its centre is inside). Cells outside the layer are
 * left out.
 */
export function maskStampCells(
  cx: number,
  cy: number,
  size: number,
  shape: MaskShape,
  width: number,
  height: number,
): number[] {
  const radius = size / 2;
  const cells: number[] = [];
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // Offset of this cell's centre from the stamp's.
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      let inside: boolean;
      if (shape === 'square') {
        inside = Math.max(Math.abs(dx), Math.abs(dy)) < radius;
      } else {
        const ix = Math.max(0, Math.abs(dx) - 0.5);
        const iy = Math.max(0, Math.abs(dy) - 0.5);
        inside = Math.hypot(ix, iy) <= radius;
      }
      if (inside) cells.push(y * width + x);
    }
  }
  return cells;
}

/**
 * Scanline flood fill from (x, y): every pixel connected to it whose RGBA is
 * within `tolerance` of the start pixel's (straight-line distance over the
 * four channels, as NovelAI measures it). Returns one byte per pixel, 1 for
 * filled.
 */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
): Uint8Array {
  const filled = new Uint8Array(width * height);
  if (x < 0 || y < 0 || x >= width || y >= height) return filled;
  const start = (y * width + x) * 4;
  const [r0, g0, b0, a0] = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  const limit = tolerance * tolerance;
  const matches = (pixel: number) => {
    const i = pixel * 4;
    const dr = data[i] - r0;
    const dg = data[i + 1] - g0;
    const db = data[i + 2] - b0;
    const da = data[i + 3] - a0;
    return dr * dr + dg * dg + db * db + da * da <= limit;
  };

  const stack: number[] = [x, y];
  filled[y * width + x] = 1;
  while (stack.length > 0) {
    const sy = stack.pop()!;
    const sx = stack.pop()!;
    const row = sy * width;
    // Run left and right along this row as far as it matches.
    let left = sx;
    while (left > 0 && !filled[row + left - 1] && matches(row + left - 1)) filled[row + --left] = 1;
    let right = sx;
    while (right < width - 1 && !filled[row + right + 1] && matches(row + right + 1)) filled[row + ++right] = 1;
    // Seed the rows above and below wherever they match under this run.
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= height) continue;
      const nrow = ny * width;
      for (let nx = left; nx <= right; nx++) {
        if (filled[nrow + nx] || !matches(nrow + nx)) continue;
        filled[nrow + nx] = 1;
        stack.push(nx, ny);
      }
    }
  }
  return filled;
}

/** A 0–1 weight for a point `distance` from a soft brush's centre: full
 *  strength over the inner half, easing to nothing at the edge. Smudge and
 *  blur use it so their edges don't leave a hard ring. */
export function softFalloff(distance: number, radius: number): number {
  if (radius <= 0 || distance >= radius) return 0;
  const t = distance / radius;
  if (t <= 0.5) return 1;
  const u = (t - 0.5) / 0.5;
  return 1 - u * u * (3 - 2 * u);
}

/** The smallest rectangle covering some stamps, grown by `pad` and clipped
 *  to the layer — what a stroke touched, for undo and for partial redraws. */
export function stampBounds(
  stamps: Stamp[],
  pad: number,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  if (stamps.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of stamps) {
    const r = s.size / 2 + pad;
    x0 = Math.min(x0, s.x - r);
    y0 = Math.min(y0, s.y - r);
    x1 = Math.max(x1, s.x + r);
    y1 = Math.max(y1, s.y + r);
  }
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  const w = Math.min(width, Math.ceil(x1)) - x;
  const h = Math.min(height, Math.ceil(y1)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}
