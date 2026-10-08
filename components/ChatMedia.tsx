'use client';

import { useState } from 'react';
import { youtubeId } from '@/lib/chatFormat';

// Links, sound and video in chat text (lib/chatFormat.ts): what cards on
// Chub put in their greetings. Nothing loads until it's played: players
// fetch no more than the file's length up front, and a YouTube video only
// loads once you ask for it here.

/** A link, opening in a new tab; a YouTube one can also play right here. */
export function ChatLink({ href, children }: { href: string; children: React.ReactNode }) {
  const video = youtubeId(href);
  const [playing, setPlaying] = useState(false);
  const link = (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-sky-400 underline decoration-sky-400/40 hover:decoration-sky-400" title={href}>
      {children}
    </a>
  );
  if (!video) return link;
  return (
    <>
      {link}{' '}
      <button type="button" onClick={() => setPlaying(!playing)} className="rounded bg-slate-800 px-1.5 text-xs text-slate-300 hover:bg-slate-700" title={playing ? 'Close the video' : 'Play it here (loads YouTube)'}>
        {playing ? '✕' : '▶ Play here'}
      </button>
      {playing && (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${video}?autoplay=1`}
          title="YouTube video"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="my-1 block aspect-video w-full max-w-xl rounded-md border-0"
        />
      )}
    </>
  );
}

/** A sound or video player. */
export function ChatMedia({ media, src, type, label }: { media: 'audio' | 'video'; src: string; type?: string; label?: string }) {
  return (
    <span className="my-1 block" title={label || src}>
      {media === 'audio' ? (
        <audio controls preload="metadata" className="block w-full max-w-md">
          <source src={src} {...(type ? { type } : {})} />
        </audio>
      ) : (
        <video controls preload="metadata" className="block max-h-96 max-w-full rounded-md">
          <source src={src} {...(type ? { type } : {})} />
        </video>
      )}
      {label && <span className="block text-[11px] text-slate-500">{label}</span>}
    </span>
  );
}

export function ChatRule() {
  return <hr className="my-2 border-0 border-t border-slate-700" />;
}
