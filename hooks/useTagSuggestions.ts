import { useEffect, useRef, useState } from 'react';
import { NovelAIModel } from '@/types/novelai';

// GET /ai/generate-image/suggest-tags?model=<model>&prompt=<partial tag text>
// Confirmed live 2026-09-17 (see memory/project_novelai_tag_autocomplete.md):
// works with the persistent API key, `prompt` is just the current partial
// tag being typed (not the whole prompt), response is a mix of exact
// prefix matches (count: 10000, confidence: 0) and semantically related
// tags (real count/confidence) — not documented anywhere but the Swagger
// spec at api.novelai.net/docs, which only lists the shape, not examples.
export interface TagSuggestion {
  tag: string;
  count: number;
  confidence: number;
}

// NovelAI's own client waits ~500ms of typing inactivity before firing a
// suggest-tags call (confirmed live 2026-09-17 by patching window.fetch and
// timing keystroke-to-request latency on novelai.net itself: ~498ms and
// ~501ms on two separate single-keystroke trials) — matched here rather
// than guessed.
const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 2;

export function useTagSuggestions(query: string, model: NovelAIModel, apiKey: string) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!apiKey || trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const thisRequestId = ++requestIdRef.current;
    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const url = `https://image.novelai.net/ai/generate-image/suggest-tags?model=${encodeURIComponent(model)}&prompt=${encodeURIComponent(trimmed)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (thisRequestId !== requestIdRef.current) return; // stale response
        if (!res.ok) { setSuggestions([]); return; }
        const data = await res.json();
        setSuggestions(Array.isArray(data.tags) ? data.tags.slice(0, 8) : []);
      } catch {
        if (thisRequestId === requestIdRef.current) setSuggestions([]);
      } finally {
        if (thisRequestId === requestIdRef.current) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, model, apiKey]);

  return { suggestions, isLoading };
}
