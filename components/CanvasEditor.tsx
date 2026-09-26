'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  floodFill,
  maskStampCells,
  MaskShape,
  Point,
  segmentStamps,
  softFalloff,
  Stamp,
  stampBounds,
} from '@/lib/brush';
import type { EditorMode, EditorResult } from '@/lib/editorResult';

// One editor for both of NovelAI's canvases:
//   paint — "Edit Image": paint over the picture, which then goes out as an
//           Image2Image base. The picture sits on its own layer underneath,
//           so erasing brings it back rather than punching holes in it.
//   mask  — "Inpaint Image": mark what to regenerate. As on novelai.net, the
//           mask lives on the 8-pixel latent grid (a layer an eighth the size),
//           drawn with its pixel-perfect brush.
// Save hands the result back and closes; generating happens from the main
// screen, with the prompt and settings still to hand, as it does there.

interface Props {
  mode: EditorMode;
  /** The picture being worked on. */
  image: Blob;
  width: number;
  height: number;
  /** Work from last time, to carry on with: a layer this editor saved. */
  initialLayer?: Blob;
  onSave: (result: EditorResult) => void;
  onCancel: () => void;
}

type PaintTool = 'draw' | 'erase' | 'fill' | 'smudge' | 'blur' | 'picker';
type MaskTool = 'draw' | 'erase' | 'fill';
type Tool = PaintTool | MaskTool;
type Tip = 'round' | 'soft' | 'square';

/** NovelAI's mask layer is an eighth of the picture each way. */
const MASK_SCALE = 8;
/** What the mask is drawn in on its layer; the layer is shown at MASK_OPACITY. */
const MASK_COLOR: [number, number, number] = [255, 84, 84];
const UNDO_LIMIT = 40;

const TOOLS: Record<EditorMode, { tool: Tool; label: string; key: string; hint: string }[]> = {
  paint: [
    { tool: 'draw', label: 'Draw', key: 'B', hint: 'Paint over the picture' },
    { tool: 'erase', label: 'Erase', key: 'E', hint: 'Take paint off, back to the picture' },
    { tool: 'fill', label: 'Fill', key: 'G', hint: 'Fill a patch of similar colour' },
    { tool: 'smudge', label: 'Smudge', key: 'S', hint: 'Drag colour along like wet paint' },
    { tool: 'blur', label: 'Blur', key: 'R', hint: 'Soften what the brush passes over' },
    { tool: 'picker', label: 'Pick', key: 'I', hint: 'Take a colour from the picture (or hold Alt)' },
  ],
  mask: [
    { tool: 'draw', label: 'Draw Mask', key: 'B', hint: 'Mark what to regenerate' },
    { tool: 'erase', label: 'Erase Mask', key: 'E', hint: 'Unmark it' },
    { tool: 'fill', label: 'Fill', key: 'G', hint: 'Fill an area you’ve outlined' },
  ],
};

interface UndoStep {
  x: number;
  y: number;
  before: ImageData;
  after: ImageData;
}

const loadBitmap = async (blob: Blob) => createImageBitmap(blob);
const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the canvas'))), 'image/png'),
  );

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export function CanvasEditor({ mode, image, width, height, initialLayer, onSave, onCancel }: Props) {
  const isMask = mode === 'mask';
  const layerW = isMask ? Math.ceil(width / MASK_SCALE) : width;
  const layerH = isMask ? Math.ceil(height / MASK_SCALE) : height;

  const wrapRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>('draw');
  const [paintSize, setPaintSize] = useState(20);
  const [maskSize, setMaskSize] = useState(4);
  const [opacity, setOpacity] = useState(100);
  const [tip, setTip] = useState<Tip>('round');
  const [maskShape, setMaskShape] = useState<MaskShape>('circle');
  const [color, setColor] = useState('#e05050');
  const [tolerance, setTolerance] = useState(15);
  const [smudgeStrength, setSmudgeStrength] = useState(60);
  const [blurIntensity, setBlurIntensity] = useState(50);
  const [pressure, setPressure] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(50);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [saving, setSaving] = useState(false);
  // Held Alt turns the paint brush into the colour picker for a moment.
  const [altHeld, setAltHeld] = useState(false);

  const size = isMask ? maskSize : paintSize;
  const activeTool: Tool = !isMask && altHeld && (tool === 'draw' || tool === 'fill') ? 'picker' : tool;

  // Everything the pointer handlers read goes through a ref, so a stroke in
  // progress never sees a stale value and moving the pointer never re-renders.
  const settings = useRef({ activeTool, size, opacity, tip, maskShape, color, tolerance, smudgeStrength, blurIntensity, pressure });
  useLayoutEffect(() => {
    settings.current = { activeTool, size, opacity, tip, maskShape, color, tolerance, smudgeStrength, blurIntensity, pressure };
  });

  /** The picture's pixels, for tools that read what's under the brush. */
  const baseData = useRef<ImageData | null>(null);
  const undoStack = useRef<UndoStep[]>([]);
  const redoStack = useRef<UndoStep[]>([]);

  // ── Setup ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const url = URL.createObjectURL(image);
    // An object URL's lifetime is an external resource: made and revoked here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    let live = true;
    (async () => {
      const layer = layerRef.current;
      const stroke = strokeRef.current;
      if (!layer || !stroke) return;
      layer.width = layerW;
      layer.height = layerH;
      stroke.width = layerW;
      stroke.height = layerH;
      const lctx = layer.getContext('2d', { willReadFrequently: true })!;
      lctx.clearRect(0, 0, layerW, layerH);

      if (!isMask) {
        const bitmap = await loadBitmap(image);
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const cctx = c.getContext('2d', { willReadFrequently: true })!;
        cctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        baseData.current = cctx.getImageData(0, 0, width, height);
      }
      if (initialLayer) {
        const bitmap = await loadBitmap(initialLayer);
        if (!live) return;
        lctx.imageSmoothingEnabled = false;
        lctx.drawImage(bitmap, 0, 0, layerW, layerH);
        bitmap.close();
      }
      undoStack.current = [];
      redoStack.current = [];
      setCanUndo(false);
      setCanRedo(false);
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [image, initialLayer, isMask, layerW, layerH, width, height]);

  // ── Undo ──────────────────────────────────────────────────────────────────

  /** The layer as it was when the current stroke began. */
  const strokeBefore = useRef<ImageData | null>(null);
  /** What the current stroke has touched so far, in layer pixels. */
  const dirty = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const markDirty = (box: { x: number; y: number; w: number; h: number } | null) => {
    if (!box) return;
    const d = dirty.current;
    dirty.current = d
      ? { x0: Math.min(d.x0, box.x), y0: Math.min(d.y0, box.y), x1: Math.max(d.x1, box.x + box.w), y1: Math.max(d.y1, box.y + box.h) }
      : { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h };
  };

  const beginStep = () => {
    const ctx = layerRef.current!.getContext('2d', { willReadFrequently: true })!;
    strokeBefore.current = ctx.getImageData(0, 0, layerW, layerH);
    dirty.current = null;
  };

  const commitStep = () => {
    const before = strokeBefore.current;
    const d = dirty.current;
    strokeBefore.current = null;
    dirty.current = null;
    if (!before || !d) return;
    const ctx = layerRef.current!.getContext('2d', { willReadFrequently: true })!;
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    const crop = new ImageData(w, h);
    for (let row = 0; row < h; row++) {
      const from = ((d.y0 + row) * layerW + d.x0) * 4;
      crop.data.set(before.data.subarray(from, from + w * 4), row * w * 4);
    }
    undoStack.current.push({ x: d.x0, y: d.y0, before: crop, after: ctx.getImageData(d.x0, d.y0, w, h) });
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const undo = useCallback(() => {
    const step = undoStack.current.pop();
    if (!step) return;
    layerRef.current!.getContext('2d')!.putImageData(step.before, step.x, step.y);
    redoStack.current.push(step);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const step = redoStack.current.pop();
    if (!step) return;
    layerRef.current!.getContext('2d')!.putImageData(step.after, step.x, step.y);
    undoStack.current.push(step);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  const clearLayer = () => {
    beginStep();
    layerRef.current!.getContext('2d')!.clearRect(0, 0, layerW, layerH);
    markDirty({ x: 0, y: 0, w: layerW, h: layerH });
    commitStep();
  };

  // ── Reading pixels ────────────────────────────────────────────────────────

  /** The picture with the paint over it, for a rectangle of the layer. */
  const compositeRegion = (x: number, y: number, w: number, h: number, paint: ImageData): Uint8ClampedArray<ArrayBuffer> => {
    const base = baseData.current!;
    const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const o = (row * w + col) * 4;
        const b = ((y + row) * width + (x + col)) * 4;
        const a = paint.data[o + 3] / 255;
        out[o] = paint.data[o] * a + base.data[b] * (1 - a);
        out[o + 1] = paint.data[o + 1] * a + base.data[b + 1] * (1 - a);
        out[o + 2] = paint.data[o + 2] * a + base.data[b + 2] * (1 - a);
        out[o + 3] = 255;
      }
    }
    return out;
  };

  const pickColor = (p: Point) => {
    const x = Math.min(width - 1, Math.max(0, Math.floor(p.x)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(p.y)));
    const paint = layerRef.current!.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, 1, 1);
    const c = compositeRegion(x, y, 1, 1, paint);
    setColor(rgbToHex(c[0], c[1], c[2]));
  };

  // ── Tools ─────────────────────────────────────────────────────────────────

  /** Round, soft or square stamps for Draw and Erase. */
  const stampShape = (ctx: CanvasRenderingContext2D, s: Stamp, tipKind: Tip, rgb: string) => {
    const r = Math.max(0.5, s.size / 2);
    if (tipKind === 'square') {
      ctx.fillStyle = rgb;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    } else if (tipKind === 'soft') {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, rgb);
      g.addColorStop(0.5, rgb);
      g.addColorStop(1, rgb.replace('rgb(', 'rgba(').replace(')', ', 0)'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = rgb;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  /** Mask Draw / Erase: NovelAI's pixel-perfect cells, straight onto the layer. */
  const stampMask = (stamps: Stamp[], erase: boolean) => {
    const ctx = layerRef.current!.getContext('2d', { willReadFrequently: true })!;
    const box = stampBounds(stamps, 1, layerW, layerH);
    if (!box) return;
    const region = ctx.getImageData(box.x, box.y, box.w, box.h);
    const shape = settings.current.maskShape;
    for (const s of stamps) {
      for (const cell of maskStampCells(s.x - box.x, s.y - box.y, s.size, shape, box.w, box.h)) {
        const o = cell * 4;
        if (erase) {
          region.data[o + 3] = 0;
        } else {
          region.data[o] = MASK_COLOR[0];
          region.data[o + 1] = MASK_COLOR[1];
          region.data[o + 2] = MASK_COLOR[2];
          region.data[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(region, box.x, box.y);
    markDirty(box);
  };

  /** The colour Smudge is dragging, sampled where the stroke began. */
  const smudgeCarry = useRef<Float32Array | null>(null);

  const smudge = (stamps: Stamp[]) => {
    const ctx = layerRef.current!.getContext('2d', { willReadFrequently: true })!;
    const box = stampBounds(stamps, 1, layerW, layerH);
    if (!box) return;
    const paint = ctx.getImageData(box.x, box.y, box.w, box.h);
    const comp = compositeRegion(box.x, box.y, box.w, box.h, paint);
    const strength = settings.current.smudgeStrength / 100;
    for (const s of stamps) {
      const r = Math.max(1, s.size / 2);
      const d = Math.ceil(r) * 2 + 1;
      const half = (d - 1) / 2;
      const cx = Math.round(s.x);
      const cy = Math.round(s.y);
      let carry = smudgeCarry.current;
      if (!carry || carry.length !== d * d * 4) {
        // Start the carry from whatever's under the first stamp.
        carry = new Float32Array(d * d * 4);
        for (let j = 0; j < d; j++) {
          for (let i = 0; i < d; i++) {
            const px = Math.min(box.w - 1, Math.max(0, cx - half + i - box.x));
            const py = Math.min(box.h - 1, Math.max(0, cy - half + j - box.y));
            const o = (py * box.w + px) * 4;
            carry.set([comp[o], comp[o + 1], comp[o + 2], 255], (j * d + i) * 4);
          }
        }
        smudgeCarry.current = carry;
      }
      for (let j = 0; j < d; j++) {
        for (let i = 0; i < d; i++) {
          const w = softFalloff(Math.hypot(i - half, j - half), r) * strength;
          if (w <= 0) continue;
          const px = cx - half + i - box.x;
          const py = cy - half + j - box.y;
          if (px < 0 || py < 0 || px >= box.w || py >= box.h) continue;
          const o = (py * box.w + px) * 4;
          const k = (j * d + i) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const mixed = comp[o + ch] * (1 - w) + carry[k + ch] * w;
            comp[o + ch] = mixed;
            paint.data[o + ch] = mixed;
            // The carry picks up what it passes over, so it fades as it goes.
            carry[k + ch] = carry[k + ch] * (1 - 0.35 * (1 - strength)) + mixed * 0.35 * (1 - strength);
          }
          paint.data[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(paint, box.x, box.y);
    markDirty(box);
  };

  const blur = (stamps: Stamp[]) => {
    const ctx = layerRef.current!.getContext('2d', { willReadFrequently: true })!;
    const sigma = Math.max(1, (settings.current.size * settings.current.blurIntensity) / 400);
    const box = stampBounds(stamps, Math.ceil(sigma * 3) + 1, layerW, layerH);
    if (!box) return;
    const paint = ctx.getImageData(box.x, box.y, box.w, box.h);
    const comp = compositeRegion(box.x, box.y, box.w, box.h, paint);
    // The browser's own blur filter does the heavy lifting.
    const src = document.createElement('canvas');
    src.width = box.w;
    src.height = box.h;
    src.getContext('2d')!.putImageData(new ImageData(comp, box.w, box.h), 0, 0);
    const dst = document.createElement('canvas');
    dst.width = box.w;
    dst.height = box.h;
    const dctx = dst.getContext('2d', { willReadFrequently: true })!;
    dctx.filter = `blur(${sigma}px)`;
    dctx.drawImage(src, 0, 0);
    const blurred = dctx.getImageData(0, 0, box.w, box.h).data;
    for (const s of stamps) {
      const r = Math.max(1, s.size / 2);
      const x0 = Math.max(0, Math.floor(s.x - r - box.x));
      const x1 = Math.min(box.w - 1, Math.ceil(s.x + r - box.x));
      const y0 = Math.max(0, Math.floor(s.y - r - box.y));
      const y1 = Math.min(box.h - 1, Math.ceil(s.y + r - box.y));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const w = softFalloff(Math.hypot(px + box.x + 0.5 - s.x, py + box.y + 0.5 - s.y), r) * 0.5;
          if (w <= 0) continue;
          const o = (py * box.w + px) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const v = comp[o + ch] * (1 - w) + blurred[o + ch] * w;
            comp[o + ch] = v;
            paint.data[o + ch] = v;
          }
          paint.data[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(paint, box.x, box.y);
    markDirty(box);
  };

  const fillAt = (p: Point) => {
    const ctx = layerRef.current!.getContext('2d', { willReadFrequently: true })!;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= layerW || y >= layerH) return;
    beginStep();
    const layer = ctx.getImageData(0, 0, layerW, layerH);
    // Paint fills a patch of the picture as it looks; the mask fills the
    // area you've outlined on the mask itself, as NovelAI's does.
    const source = isMask ? layer.data : compositeRegion(0, 0, layerW, layerH, layer);
    const filled = floodFill(source, layerW, layerH, x, y, settings.current.tolerance);
    const [r, g, b] = isMask ? MASK_COLOR : hexToRgb(settings.current.color);
    const a = isMask ? 1 : settings.current.opacity / 100;
    let x0 = layerW, y0 = layerH, x1 = 0, y1 = 0;
    for (let i = 0; i < filled.length; i++) {
      if (!filled[i]) continue;
      const o = i * 4;
      const oldA = layer.data[o + 3] / 255;
      const outA = a + oldA * (1 - a);
      layer.data[o] = (r * a + layer.data[o] * oldA * (1 - a)) / (outA || 1);
      layer.data[o + 1] = (g * a + layer.data[o + 1] * oldA * (1 - a)) / (outA || 1);
      layer.data[o + 2] = (b * a + layer.data[o + 2] * oldA * (1 - a)) / (outA || 1);
      layer.data[o + 3] = outA * 255;
      const px = i % layerW;
      const py = (i / layerW) | 0;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
    ctx.putImageData(layer, 0, 0);
    if (x1 >= x0) markDirty({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    commitStep();
  };

  // ── Pointer ───────────────────────────────────────────────────────────────

  const lastStamp = useRef<Stamp | null>(null);
  const drawing = useRef(false);
  const penPressure = useRef(1);

  /** Pointer position in layer pixels. */
  const toLayer = (clientX: number, clientY: number): Point => {
    const rect = layerRef.current!.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * layerW, y: ((clientY - rect.top) / rect.height) * layerH };
  };

  const stampSize = (e: PointerEvent) => {
    const { size: base, pressure: usePressure } = settings.current;
    // Pressure only means something from a pen; a mouse reports 0.5 when down.
    if (usePressure && e.pointerType === 'pen') penPressure.current = e.pressure || penPressure.current;
    else penPressure.current = 1;
    return Math.max(1, base * penPressure.current);
  };

  const applyStamps = (stamps: Stamp[]) => {
    const t = settings.current.activeTool;
    if (isMask) {
      stampMask(stamps, t === 'erase');
      return;
    }
    if (t === 'draw') {
      const sctx = strokeRef.current!.getContext('2d')!;
      const [r, g, b] = hexToRgb(settings.current.color);
      for (const s of stamps) stampShape(sctx, s, settings.current.tip, `rgb(${r}, ${g}, ${b})`);
      markDirty(stampBounds(stamps, 2, layerW, layerH));
    } else if (t === 'erase') {
      const ctx = layerRef.current!.getContext('2d', { willReadFrequently: true })!;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = settings.current.opacity / 100;
      for (const s of stamps) stampShape(ctx, s, settings.current.tip, 'rgb(0, 0, 0)');
      ctx.restore();
      markDirty(stampBounds(stamps, 2, layerW, layerH));
    } else if (t === 'smudge') {
      smudge(stamps);
    } else if (t === 'blur') {
      blur(stamps);
    }
  };

  const moveCursor = (clientX: number, clientY: number) => {
    const cursor = cursorRef.current;
    const wrap = wrapRef.current;
    if (!cursor || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    cursor.style.transform = `translate(${clientX - rect.left}px, ${clientY - rect.top}px) translate(-50%, -50%)`;
    cursor.style.display = 'block';
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ready || e.button !== 0) return;
    // Keeps the stroke going if the pointer leaves the canvas mid-drag.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every pointer can be captured; the stroke still works without.
    }
    const p = toLayer(e.clientX, e.clientY);
    const t = settings.current.activeTool;
    if (t === 'picker') {
      pickColor(p);
      drawing.current = true;
      return;
    }
    if (t === 'fill') {
      fillAt(p);
      return;
    }
    drawing.current = true;
    beginStep();
    smudgeCarry.current = null;
    const first: Stamp = { ...p, size: stampSize(e.nativeEvent) };
    lastStamp.current = first;
    applyStamps([first]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    moveCursor(e.clientX, e.clientY);
    if (!drawing.current) return;
    if (settings.current.activeTool === 'picker') {
      pickColor(toLayer(e.clientX, e.clientY));
      return;
    }
    // Every position the pointer passed through since the last frame, not
    // just the latest: at speed that's most of them.
    const native = e.nativeEvent;
    const samples = native.getCoalescedEvents?.() ?? [];
    const events = samples.length > 0 ? samples : [native];
    const stamps: Stamp[] = [];
    for (const ev of events) {
      const next: Stamp = { ...toLayer(ev.clientX, ev.clientY), size: stampSize(ev) };
      const from = lastStamp.current ?? next;
      stamps.push(...segmentStamps(from, next).slice(1));
      lastStamp.current = next;
    }
    if (stamps.length) applyStamps(stamps);
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    lastStamp.current = null;
    smudgeCarry.current = null;
    if (settings.current.activeTool === 'picker') return;
    if (!isMask && settings.current.activeTool === 'draw') {
      // The stroke was drawn solid on its own canvas, so overlapping stamps
      // don't darken; it goes onto the layer once, at the chosen opacity.
      const ctx = layerRef.current!.getContext('2d', { willReadFrequently: true })!;
      ctx.save();
      ctx.globalAlpha = settings.current.opacity / 100;
      ctx.drawImage(strokeRef.current!, 0, 0);
      ctx.restore();
      strokeRef.current!.getContext('2d')!.clearRect(0, 0, layerW, layerH);
    }
    commitStep();
  };

  // ── Keys ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(e.type === 'keydown');
      if (e.type !== 'keydown') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && (target as HTMLInputElement).type !== 'range') return;
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.key === '[' || e.key === ']') {
        const step = e.key === ']' ? 1 : -1;
        if (isMask) setMaskSize((s) => Math.min(50, Math.max(1, s + step)));
        else setPaintSize((s) => Math.min(200, Math.max(1, s + step * Math.max(1, Math.round(s / 10)))));
        return;
      }
      const hit = TOOLS[mode].find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (hit) setTool(hit.tool);
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [mode, isMask, onCancel, undo, redo]);

  // ── Display size, for the cursor ──────────────────────────────────────────

  const [displayScale, setDisplayScale] = useState(1);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const observer = new ResizeObserver(() => setDisplayScale(layer.getBoundingClientRect().width / layerW));
    observer.observe(layer);
    return () => observer.disconnect();
  }, [layerW]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = async () => {
    const layer = layerRef.current;
    if (!layer) return;
    setSaving(true);
    try {
      const data = layer.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, layerW, layerH).data;
      let empty = true;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) {
          empty = false;
          break;
        }
      }
      const layerBlob = await toBlob(layer);
      if (isMask) {
        // White where the mask is, black elsewhere, blown up to full size
        // cell by cell, as NovelAI's request prep does.
        const small = document.createElement('canvas');
        small.width = layerW;
        small.height = layerH;
        const sctx = small.getContext('2d')!;
        const bw = sctx.createImageData(layerW, layerH);
        for (let i = 0; i < data.length; i += 4) {
          const v = data[i + 3] > 0 ? 255 : 0;
          bw.data[i] = v;
          bw.data[i + 1] = v;
          bw.data[i + 2] = v;
          bw.data[i + 3] = 255;
        }
        sctx.putImageData(bw, 0, 0);
        const full = document.createElement('canvas');
        full.width = width;
        full.height = height;
        const fctx = full.getContext('2d')!;
        fctx.imageSmoothingEnabled = false;
        fctx.drawImage(small, 0, 0, layerW * MASK_SCALE, layerH * MASK_SCALE);
        onSave({ layer: layerBlob, mask: await toBlob(full), empty });
      } else {
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        const octx = out.getContext('2d')!;
        octx.putImageData(baseData.current!, 0, 0);
        octx.drawImage(layer, 0, 0);
        onSave({ layer: layerBlob, composite: await toBlob(out), empty });
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const tools = TOOLS[mode];
  const usesSize = activeTool !== 'fill' && activeTool !== 'picker';
  const cursorSize = Math.max(4, size * displayScale);
  const btn = (on: boolean) =>
    `rounded px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
      on ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
    }`;
  const label = 'text-[10px] font-semibold uppercase tracking-wider text-slate-500';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2.5">
        <span className="text-sm font-semibold text-slate-200">{isMask ? 'Inpaint Image' : 'Edit Image'}</span>
        <span className="text-xs text-slate-500 phone:hidden">
          {isMask
            ? 'Mark what to regenerate, then save and generate from the main screen.'
            : 'Paint over the picture, then save and generate from the main screen.'}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!ready || saving}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* On a phone the tools sit under the picture, in two columns. */}
      <div className="flex min-h-0 flex-1 phone:flex-col-reverse">
        {/* Tools */}
        <div className="flex w-48 flex-shrink-0 flex-col gap-4 overflow-y-auto border-r border-slate-700 bg-slate-900/90 p-3 phone:grid phone:h-48 phone:w-full phone:grid-cols-2 phone:content-start phone:gap-3 phone:border-r-0 phone:border-t phone:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-1">
            <span className={label}>Tool</span>
            <div className="grid grid-cols-2 gap-1">
              {tools.map((t) => (
                <button
                  key={t.tool}
                  type="button"
                  onClick={() => setTool(t.tool)}
                  title={`${t.hint} (${t.key})`}
                  className={btn(activeTool === t.tool)}
                >
                  {t.label} <span className="opacity-50 touch:hidden">{t.key}</span>
                </button>
              ))}
            </div>
          </div>

          {usesSize && (
            <label className="flex flex-col gap-1">
              <span className={label}>
                Size — {size}
                {isMask ? ` (${size * MASK_SCALE}px)` : 'px'}
              </span>
              <input
                type="range"
                min={1}
                max={isMask ? 50 : 200}
                value={size}
                onChange={(e) => (isMask ? setMaskSize : setPaintSize)(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </label>
          )}

          {isMask && (activeTool === 'draw' || activeTool === 'erase') && (
            <div className="flex flex-col gap-1">
              <span className={label}>Shape</span>
              <div className="grid grid-cols-2 gap-1">
                {(['circle', 'square'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setMaskShape(s)} className={btn(maskShape === s)}>
                    {s === 'circle' ? 'Circle' : 'Square'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isMask && (activeTool === 'draw' || activeTool === 'erase') && (
            <div className="flex flex-col gap-1">
              <span className={label}>Tip</span>
              <div className="grid grid-cols-3 gap-1">
                {(['round', 'soft', 'square'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTip(t)} className={btn(tip === t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isMask && (activeTool === 'draw' || activeTool === 'erase' || activeTool === 'fill') && (
            <label className="flex flex-col gap-1">
              <span className={label}>Opacity — {opacity}%</span>
              <input
                type="range"
                min={1}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </label>
          )}

          {!isMask && (activeTool === 'draw' || activeTool === 'fill' || activeTool === 'picker') && (
            <label className="flex items-center justify-between gap-2">
              <span className={label}>Colour</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-12 cursor-pointer rounded border border-slate-700 bg-transparent"
              />
            </label>
          )}

          {activeTool === 'fill' && (
            <label className="flex flex-col gap-1">
              <span className={label}>Tolerance — {tolerance}</span>
              <input
                type="range"
                min={0}
                max={150}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </label>
          )}

          {activeTool === 'smudge' && (
            <label className="flex flex-col gap-1">
              <span className={label}>Strength — {smudgeStrength}%</span>
              <input
                type="range"
                min={5}
                max={100}
                value={smudgeStrength}
                onChange={(e) => setSmudgeStrength(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </label>
          )}

          {activeTool === 'blur' && (
            <label className="flex flex-col gap-1">
              <span className={label}>Intensity — {blurIntensity}</span>
              <input
                type="range"
                min={5}
                max={100}
                value={blurIntensity}
                onChange={(e) => setBlurIntensity(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </label>
          )}

          {!isMask && usesSize && (
            <label className="flex items-center justify-between gap-2 text-xs text-slate-400" title="Pen pressure changes the size (pens only)">
              Pen pressure
              <input
                type="checkbox"
                checked={pressure}
                onChange={(e) => setPressure(e.target.checked)}
                className="h-4 w-4 accent-violet-500"
              />
            </label>
          )}

          {isMask && (
            <label className="flex flex-col gap-1">
              <span className={label}>Mask opacity — {maskOpacity}%</span>
              <input
                type="range"
                min={10}
                max={90}
                value={maskOpacity}
                onChange={(e) => setMaskOpacity(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </label>
          )}

          <div className="mt-auto flex flex-col gap-1.5 phone:order-first phone:mt-0">
            <div className="grid grid-cols-2 gap-1">
              <button type="button" onClick={undo} disabled={!canUndo} className={`${btn(false)} disabled:opacity-40`} title="Ctrl+Z">
                Undo
              </button>
              <button type="button" onClick={redo} disabled={!canRedo} className={`${btn(false)} disabled:opacity-40`} title="Ctrl+Shift+Z or Ctrl+Y">
                Redo
              </button>
            </div>
            <button type="button" onClick={clearLayer} className={btn(false)}>
              {isMask ? 'Clear mask' : 'Clear paint'}
            </button>
            <p className="text-[10px] leading-snug text-slate-600 touch:hidden">[ and ] change the size.</p>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-slate-950 p-4 phone:p-2">
          <div ref={wrapRef} className="relative select-none">
            {imageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imageUrl}
                alt="Picture being edited"
                draggable={false}
                className="block max-h-[calc(100dvh-7rem)] max-w-full phone:max-h-[calc(100dvh-18rem)]"
                style={{ aspectRatio: `${width} / ${height}` }}
              />
            )}
            <canvas
              ref={layerRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={isMask ? { imageRendering: 'pixelated', opacity: maskOpacity / 100 } : undefined}
            />
            <canvas
              ref={strokeRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ opacity: opacity / 100 }}
            />
            <div
              className="absolute inset-0"
              style={{ touchAction: 'none', cursor: activeTool === 'fill' || activeTool === 'picker' ? 'crosshair' : 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={() => {
                if (cursorRef.current) cursorRef.current.style.display = 'none';
              }}
            />
            <div
              ref={cursorRef}
              className="pointer-events-none absolute left-0 top-0 hidden border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
              style={{
                width: usesSize ? cursorSize : 0,
                height: usesSize ? cursorSize : 0,
                borderRadius: (isMask ? maskShape === 'square' : tip === 'square') ? 0 : '50%',
              }}
            />
          </div>
          {!ready && <p className="absolute text-xs text-slate-500">Loading…</p>}
        </div>
      </div>
    </div>
  );
}
