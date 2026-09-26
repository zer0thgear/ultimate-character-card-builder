import { useRef, useState } from 'react';
import { extractImagesFromZip, getImageDimensions } from '@/lib/imageUtils';
import { finalizeRequest } from '@/lib/requestImage';
import { inpaintFinisher } from '@/lib/inpaintComposite';
import { fetchWithRetry, NovelAIError, novelAIError } from '@/lib/apiRetry';
import { useSessionStore } from '@/store/sessionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { NovelAIGenerateRequest, PromptSource, SweepCellInfo, WildcardPicks } from '@/types/novelai';
import type { SessionImage as GeneratedImage } from '@/store/sessionStore';

interface GenerateOptions {
  /** If this generation is an enhancement, the source image's ID and a fresh object URL. */
  sourceImageId?: string;
  sourceImageUrl?: string;
  /** Bypass the streaming-mode setting — required for multi-sample (n_samples > 1)
   *  requests, since the streaming endpoint only ever delivers one final image. */
  forceStandard?: boolean;
  /** Shared across every image from one "Copies" request so the gallery can
   *  clump them visually — a true batch's own samples, or one call in a
   *  queued sequence of separate single-image calls. */
  batchId?: string;
  /** Rolls that produced this request's prompts, stored on the resulting images. */
  wildcardPicks?: WildcardPicks;
  /** Grid cell this request fills, when it's part of an X/Y sweep. */
  sweep?: SweepCellInfo;
  /** The prompt as written, for Reuse (see PromptSource). */
  source?: PromptSource;
  /** The card open when it was requested. */
  projectId?: string;
}

interface UseGenerateReturn {
  /** The images added to the session, or null if the request failed. */
  generate: (request: NovelAIGenerateRequest, opts?: GenerateOptions) => Promise<GeneratedImage[] | null>;
  error: string | null;
  clearError: () => void;
  /** Whether the last failure is one there's no point carrying on past — a
   *  bad key, no Anlas, a request NovelAI rejected. A run that's making many
   *  images checks this to decide between stopping and skipping one image.
   *  It's a ref, not state, so it can be read straight after an await. */
  lastErrorWasFatal: () => boolean;
}

/** What's done to each image before it's shown: an inpaint's is pasted over
 *  the original, as NovelAI's client does. */
type Finish = (blob: Blob) => Promise<Blob>;

// Decode a base64 string to a Uint8Array, tolerating whitespace in the input
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function useGenerate(): UseGenerateReturn {
  const [error, setError] = useState<string | null>(null);
  const { apiKey, addImages, updateImages, setStreamPreview, setRetryNotice } = useSessionStore();
  const streamingMode = useSettingsStore((s) => s.streamingMode);
  const fatalRef = useRef(false);

  /** Anything that isn't a NovelAIError (a decode failure, say) is treated as
   *  fatal: it's a fault in this request, not a blip worth skipping past. */
  const fail = (err: unknown) => {
    fatalRef.current = !(err instanceof NovelAIError) || err.fatal;
    setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    setRetryNotice(null);
    return null;
  };

  /** Reports a wait to the UI while a request is being retried. */
  const retryOptions = () => ({
    onRetry: ({ attempt, of, waitMs, reason }: { attempt: number; of: number; waitMs: number; reason: string }) =>
      setRetryNotice(`${reason} — retrying in ${Math.round(waitMs / 1000)}s (${attempt}/${of})`),
  });

  // ── Standard (non-streaming) generation ────────────────────────────────────

  const generateStandard = async (request: NovelAIGenerateRequest, finish: Finish | undefined, opts?: GenerateOptions): Promise<GeneratedImage[] | null> => {
    setError(null);
    fatalRef.current = false;
    try {
      const response = await fetchWithRetry(
        'https://image.novelai.net/ai/generate-image',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(request),
        },
        retryOptions(),
      );
      setRetryNotice(null);

      if (!response.ok) throw await novelAIError(response);

      const buffer = await response.arrayBuffer();
      const raw = await extractImagesFromZip(buffer);
      const blobs = finish ? await Promise.all(raw.map(finish)) : raw;

      const now = Date.now();
      const images: GeneratedImage[] = blobs.map((blob, i) => ({
        id: crypto.randomUUID(),
        url: URL.createObjectURL(blob),
        blob,
        prompt: request.input,
        negativePrompt: request.parameters.negative_prompt,
        model: request.model,
        parameters: request.parameters,
        timestamp: now + i,
        seed: request.parameters.seed + i,
        sourceImageId: opts?.sourceImageId,
        sourceImageUrl: opts?.sourceImageUrl,
        batchId: opts?.batchId,
        wildcardPicks: opts?.wildcardPicks,
        sweep: opts?.sweep,
        source: opts?.source,
        projectId: opts?.projectId,
      }));

      addImages(images);
      return images;
    } catch (err) {
      return fail(err);
    }
  };

  // ── Streaming (SSE) generation ─────────────────────────────────────────────

  const generateStreaming = async (request: NovelAIGenerateRequest, finish: Finish | undefined, opts?: GenerateOptions): Promise<GeneratedImage[] | null> => {
    setError(null);
    fatalRef.current = false;
    try {
      const response = await fetchWithRetry(
        'https://image.novelai.net/ai/generate-image-stream',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(request),
        },
        retryOptions(),
      );
      setRetryNotice(null);

      if (!response.ok) throw await novelAIError(response);

      if (!response.body) throw new Error('No response body from stream endpoint.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalImage: GeneratedImage | null = null;

      // Process one parsed SSE event.
      //
      // NAI format (confirmed):
      //   event: intermediate          ← SSE event: field (lowercase)
      //   data: {"event_type":"intermediate","image":"<base64-JPEG>","step_ix":N,...}
      //
      //   event: final (or similar)
      //   data: {"event_type":"final","image":"<base64>"}
      //
      // The data field is always JSON. Image mime type is detected from magic bytes.
      const handleEvent = async (sseEventType: string, rawData: string) => {
        let eventType = sseEventType; // from SSE `event:` field
        let imageB64 = rawData;

        // Always try to parse the data as JSON — NAI wraps everything in JSON.
        try {
          const json = JSON.parse(rawData) as Record<string, unknown>;
          // event_type in JSON is the authoritative field; fall back to event or SSE header
          if (typeof json.event_type === 'string') eventType = json.event_type;
          else if (typeof json.event === 'string') eventType = json.event;
          // Image payload — check in order of known NAI field names
          const payload = json.image ?? json.response ?? json.data ?? json.frame;
          if (typeof payload === 'string') imageB64 = payload;
        } catch { /* not JSON — rawData is raw base64 */ }

        const isIntermediate =
          eventType === 'intermediate' ||
          eventType === 'StreamingEventTypeIntermediate' ||
          eventType === 'newToken';
        const isFinal =
          eventType === 'final' ||
          eventType === 'done' ||
          eventType === 'StreamingEventTypeFinal';
        const isError =
          eventType === 'error' ||
          eventType === 'StreamingEventTypeError';

        if (isIntermediate) {
          // Live preview frame — show it in the gallery placeholder
          try {
            const bytes = base64ToBytes(imageB64);
            // Detect JPEG (FF D8) vs PNG (89 50) from magic bytes
            const mime =
              bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
            setStreamPreview(URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime })));
          } catch { /* ignore malformed preview frames */ }

        } else if (isFinal) {
          // Completed image — detect ZIP (PK) vs JPEG (FF D8) vs PNG (89 50)
          const bytes = base64ToBytes(imageB64);
          let imageBlob: Blob;

          if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
            // ZIP: extract the image inside
            const blobs = await extractImagesFromZip(bytes.buffer as ArrayBuffer);
            imageBlob = blobs[0];
          } else {
            const mime =
              bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
            imageBlob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
          }
          if (finish) imageBlob = await finish(imageBlob);

          finalImage = {
            id: crypto.randomUUID(),
            url: URL.createObjectURL(imageBlob),
            blob: imageBlob,
            prompt: request.input,
            negativePrompt: request.parameters.negative_prompt,
            model: request.model,
            parameters: request.parameters,
            timestamp: Date.now(),
            seed: request.parameters.seed,
            sourceImageId: opts?.sourceImageId,
            sourceImageUrl: opts?.sourceImageUrl,
            batchId: opts?.batchId,
            wildcardPicks: opts?.wildcardPicks,
            sweep: opts?.sweep,
            source: opts?.source,
            projectId: opts?.projectId,
          };
          addImages([finalImage]);
          setStreamPreview(null);

        } else if (isError) {
          throw new Error(`Stream error: ${rawData}`);
        }
        // Unknown / keep-alive events are silently ignored
      };

      // Read the SSE stream chunk by chunk
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line (\n\n or \r\n\r\n)
        const parts = buffer.split(/\n\n|\r\n\r\n/);
        buffer = parts.pop() ?? ''; // keep the incomplete trailing chunk

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = 'message';
          const dataLines: string[] = [];

          for (const line of part.split(/\r?\n/)) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }

          if (dataLines.length > 0) {
            await handleEvent(eventType, dataLines.join('\n'));
          }
        }
      }

      if (!finalImage) {
        // The stream closed without a recognised final event.
        // Surface as an error so the user knows something went wrong.
        throw new Error('Stream closed without delivering a final image. Check the browser console for raw SSE output.');
      }
      return [finalImage];
    } catch (err) {
      setStreamPreview(null);
      return fail(err);
    }
  };

  // ── Public generate function ────────────────────────────────────────────────

  const generate = async (request: NovelAIGenerateRequest, opts?: GenerateOptions): Promise<GeneratedImage[] | null> => {
    if (!apiKey) {
      fatalRef.current = true;
      setError('No API key set. Please enter your NovelAI API key.');
      return null;
    }
    // Prepare images and defaults exactly as NovelAI's client does.
    const sent = await finalizeRequest(request);
    const { image, mask } = sent.parameters;
    const finish = sent.action === 'infill' && image && mask ? inpaintFinisher(image, mask) : undefined;
    const images = await (streamingMode && !opts?.forceStandard
      ? generateStreaming(sent, finish, opts)
      : generateStandard(sent, finish, opts));
    // A Max enhance comes back larger than the size it asked for; record the
    // real size, which later actions and size checks go by.
    if (images && sent.parameters.upscaled_enhance) {
      return Promise.all(
        images.map(async (img) => {
          const { width, height } = await getImageDimensions(img.blob);
          const parameters = { ...img.parameters, width, height };
          updateImages([img.id], { parameters });
          return { ...img, parameters };
        }),
      );
    }
    return images;
  };

  return { generate, error, clearError: () => setError(null), lastErrorWasFatal: () => fatalRef.current };
}
