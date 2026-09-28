// What the Edit / Inpaint canvas hands back, and how it becomes the image
// panel's Image2Image base. The base type lives here rather than in a store.

export type EditorMode = 'paint' | 'mask';

export interface EditorResult {
  /** The layer on its own, to reopen the editor with later: the paint (full
   *  size, transparent where untouched) or the mask (an eighth the size). */
  layer: Blob;
  /** Paint: the picture with the paint on it, ready to send. */
  composite?: Blob;
  /** Mask: black and white at full size, white where to regenerate. */
  mask?: Blob;
  /** Whether nothing was painted or masked at all. */
  empty: boolean;
}

/** The image panel's Image2Image / inpainting base. */
export interface Img2ImgSource {
  /** What gets sent: the picture, with any paint from Edit Image on it. */
  blob: Blob;
  url: string;
  width: number;
  height: number;
  /** Edit Image keeps the picture and its paint apart, so reopening it
   *  carries on with the paint still editable. */
  original?: Blob;
  paint?: Blob;
  /** Inpainting: the mask as its editor keeps it (an eighth the size), the
   *  full-size black and white one sent, and a preview of it. */
  mask?: { layer: Blob; full: Blob; url: string };
}

/** Folds what the canvas saved into a base. An empty layer removes the paint
 *  or mask rather than keeping a blank one. */
export function applyEditorResult(src: Img2ImgSource, mode: EditorMode, result: EditorResult): Img2ImgSource {
  if (mode === 'paint') {
    const original = src.original ?? src.blob;
    if (result.empty || !result.composite) {
      return { ...src, blob: original, url: URL.createObjectURL(original), original: undefined, paint: undefined };
    }
    return { ...src, blob: result.composite, url: URL.createObjectURL(result.composite), original, paint: result.layer };
  }
  if (result.empty || !result.mask) return { ...src, mask: undefined };
  return { ...src, mask: { layer: result.layer, full: result.mask, url: URL.createObjectURL(result.layer) } };
}
