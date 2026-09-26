// Retrying the NovelAI calls that are worth retrying.
//
// A sweep or a chain can be dozens of requests over several minutes, and a
// single rate limit or gateway blip used to end the whole run. These are the
// failures that mean "try again in a moment" rather than "this request is
// wrong", so they're retried with a growing wait; everything else is reported
// straight away, and the run stops.

/** 429, plus the gateway errors Cloudflare puts in front of the API. 500 is
 *  left out on purpose: NovelAI answers a request it can't render with one
 *  (an off-grid size, say), and repeating it would only waste the wait. */
const RETRY_STATUSES = new Set([429, 502, 503, 504, 520, 521, 522, 523, 524]);
/** Waits before the 2nd, 3rd and 4th attempt. */
const BACKOFF_MS = [2000, 5000, 12000];
/** A Retry-After longer than this is treated as "not worth waiting for". */
const MAX_RETRY_AFTER_MS = 60000;

export interface RetryNotice {
  /** Which retry this is, 1-based. */
  attempt: number;
  /** How many there will be at most. */
  of: number;
  waitMs: number;
  /** Short reason, for the UI: "Rate limited" or "Server error (503)". */
  reason: string;
}

export interface RetryOptions {
  /** Called before each wait, so the UI can say what's happening. */
  onRetry?: (notice: RetryNotice) => void;
  /** Checked before each retry; true abandons it (the run was stopped). */
  shouldStop?: () => boolean;
  /** Test seam: how the wait is performed. */
  wait?: (ms: number) => Promise<void>;
  /** Test seam: overrides the number of retries. */
  retries?: number;
}

/** An API failure, with whether retrying could ever help. */
export class NovelAIError extends Error {
  readonly status: number;
  /** True for a failure no retry can fix: a bad key, no Anlas, a bad request. */
  readonly fatal: boolean;

  constructor(message: string, status: number, fatal: boolean) {
    super(message);
    this.name = 'NovelAIError';
    this.status = status;
    this.fatal = fatal;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The wait a 429 asked for, if it gave one we're willing to honour. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = seconds * 1000;
  return ms <= MAX_RETRY_AFTER_MS ? ms : null;
}

const reasonFor = (status: number) =>
  status === 429 ? 'Rate limited' : status === 0 ? "Couldn't reach NovelAI" : `Server error (${status})`;

/**
 * fetch, retrying a rate limit, a gateway error or a dropped connection.
 * Returns the response as soon as one arrives that isn't worth retrying —
 * including an error response, which the caller still has to check.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { onRetry, shouldStop, wait = sleep, retries = BACKOFF_MS.length }: RetryOptions = {},
): Promise<Response> {
  let lastNetworkError: unknown;
  for (let attempt = 0; ; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(url, init);
      if (!RETRY_STATUSES.has(response.status)) return response;
      lastNetworkError = undefined;
    } catch (err) {
      // A dropped connection or DNS failure — worth one more go. An aborted
      // request is the user stopping, so it goes straight back.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      lastNetworkError = err;
    }

    const status = response?.status ?? 0;
    if (attempt >= retries || shouldStop?.()) {
      if (response) return response;
      throw lastNetworkError instanceof Error ? lastNetworkError : new Error('Network request failed.');
    }

    const waitMs = (response && retryAfterMs(response)) ?? BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    onRetry?.({ attempt: attempt + 1, of: retries, waitMs, reason: reasonFor(status) });
    await wait(waitMs);
    if (shouldStop?.()) {
      if (response) return response;
      throw lastNetworkError instanceof Error ? lastNetworkError : new Error('Network request failed.');
    }
  }
}

/**
 * Turns a failed response into the error to show, saying whether the run can
 * carry on. A 429 or gateway error that gets this far has already been
 * retried, so it's out of patience but not the user's fault — the run keeps
 * going and skips this image.
 */
export async function novelAIError(response: Response, what = 'Generation'): Promise<NovelAIError> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  const detail = data.error ?? data.message ?? '';
  const status = response.status;
  if (status === 401) return new NovelAIError('Invalid API key.', status, true);
  if (status === 402) return new NovelAIError('Insufficient Anlas. Please top up your account.', status, true);
  if (status === 429) {
    return new NovelAIError('Rate limited, and still limited after retrying. Give it a minute.', status, false);
  }
  if (RETRY_STATUSES.has(status)) {
    return new NovelAIError(`NovelAI is not responding (${status}). It kept failing after retries.`, status, false);
  }
  return new NovelAIError(`${what} failed (${status}): ${detail}`, status, true);
}
