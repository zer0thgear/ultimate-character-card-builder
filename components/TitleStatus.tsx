'use client';

import { useEffect, useRef } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useJobStore } from '@/store/jobStore';

// The page title says what's going on, as NovelAI's does for image gens, so
// another tab shows it: ⏳ while a gen or a reply is under way, and ✅ once
// it's done if you were away, until you come back.

const MARK = /^(⏳|✅) /;

export function TitleStatus() {
  const busy = useSessionStore((s) => s.generating) + useJobStore((s) => s.llm) > 0;
  const was = useRef(false);
  const done = useRef(false);
  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    const paint = () => {
      const base = document.title.replace(MARK, '');
      const mark = was.current ? '⏳ ' : done.current ? '✅ ' : '';
      if (document.title !== mark + base) document.title = mark + base;
    };
    paintRef.current = paint;
    const back = () => {
      if (document.hidden) return;
      done.current = false;
      paint();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, []);

  useEffect(() => {
    if (was.current && !busy && (document.hidden || !document.hasFocus())) done.current = true;
    if (busy) done.current = false;
    was.current = busy;
    paintRef.current();
  }, [busy]);

  return null;
}
