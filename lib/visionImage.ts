import type { LlmImage } from '@/types/llm';

// A picture ready to show a vision model: at most 1568px on its long side
// (what Anthropic recommends; bigger only costs more and is scaled down
// anyway) and JPEG, which keeps a full-size gen to a few hundred KB instead
// of several MB. Transparency is flattened onto white.

const MAX_SIDE = 1568;

export async function imageForVision(blob: Blob): Promise<LlmImage> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const url = canvas.toDataURL('image/jpeg', 0.9);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

export const imageDataUrl = (im: LlmImage) => `data:${im.mediaType};base64,${im.data}`;
