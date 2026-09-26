import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { GeneratedImage } from '@/types/novelai';

/** Raw base64 (no data: prefix), as NovelAI's image fields expect. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Extract all PNG blobs from a NovelAI response zip buffer. */
export async function extractImagesFromZip(zipBuffer: ArrayBuffer): Promise<Blob[]> {
  const zip = await JSZip.loadAsync(zipBuffer);

  const pngEntries = Object.values(zip.files)
    .filter((file) => !file.dir && file.name.endsWith('.png'))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (pngEntries.length === 0) {
    throw new Error('No images found in the response. The API may have returned an error zip.');
  }

  return Promise.all(pngEntries.map((file) => file.async('blob')));
}

/** Unwrap a single-image API response that may come back either as a zip
 *  (magic bytes 'PK') or as a raw image blob, e.g. /ai/upscale and
 *  /ai/augment-image, which aren't guaranteed to use the same wrapping. */
export async function extractSingleImageResponse(buffer: ArrayBuffer, contentType: string | null): Promise<Blob> {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // 'PK'
  if (isZip) {
    const [blob] = await extractImagesFromZip(buffer);
    return blob;
  }
  return new Blob([buffer], { type: contentType ?? 'image/png' });
}

/** Read the pixel dimensions of an image blob (e.g. an augment/upscale result,
 *  whose output size isn't known ahead of the request). */
export async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Download a single generated image as a PNG. */
export function downloadImage(image: GeneratedImage) {
  const date = new Date(image.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  saveAs(image.blob, `novelai_${date}_${image.seed}.png`);
}

/** Bundle all session images into a zip and download it. */
export async function downloadSessionAsZip(images: GeneratedImage[]) {
  if (images.length === 0) return;

  const zip = new JSZip();

  images.forEach((image) => {
    const date = new Date(image.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    zip.file(`novelai_${date}_${image.seed}.png`, image.blob);
  });

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const sessionDate = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  saveAs(zipBlob, `novelai_session_${sessionDate}.zip`);
}
