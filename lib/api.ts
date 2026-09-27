import type { AppConfig, CardProject, ChatSession, ChatSummary, KeptImage, Persona, ProjectSummary, AvatarInfo } from '@/types/project';
import type { LlmEvent, LlmRequest } from '@/types/llm';
import type { LibraryItem } from '@/lib/librarySearch';

// The browser side of the local API routes (app/api/*).

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  listProjects: () => call<ProjectSummary[]>('/api/projects'),
  createProject: (init: Partial<CardProject> = {}) => call<CardProject>('/api/projects', json('POST', init)),
  getProject: (id: string) => call<CardProject>(`/api/projects/${id}`),
  saveProject: (p: CardProject) => call<CardProject>(`/api/projects/${p.id}`, json('PUT', p)),
  deleteProject: (id: string) => call<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),

  avatarUrl: (id: string, avatar?: AvatarInfo) => (avatar ? `/api/projects/${id}/avatar?v=${avatar.version}` : null),
  setAvatar: (id: string, image: Blob) => call<AvatarInfo>(`/api/projects/${id}/avatar`, { method: 'PUT', body: image }),
  clearAvatar: (id: string) => call<{ ok: true }>(`/api/projects/${id}/avatar`, { method: 'DELETE' }),

  keptUrl: (id: string, file: string) => `/api/projects/${id}/kept/${file}`,
  keep: (id: string, image: Blob, meta: Omit<KeptImage, 'file'>) =>
    call<KeptImage>(`/api/projects/${id}/kept/${meta.id}.png`, {
      method: 'PUT',
      body: image,
      headers: { 'x-kept': encodeURIComponent(JSON.stringify(meta)) },
    }),
  patchKept: (id: string, file: string, patch: Partial<KeptImage>) => call<KeptImage>(`/api/projects/${id}/kept/${file}`, json('PATCH', patch)),
  unkeep: (id: string, file: string) => call<{ ok: true }>(`/api/projects/${id}/kept/${file}`, { method: 'DELETE' }),

  listChats: (id: string) => call<ChatSummary[]>(`/api/projects/${id}/chats`),
  getChat: (id: string, chatId: string) => call<ChatSession>(`/api/projects/${id}/chats/${chatId}`),
  saveChat: (id: string, chat: ChatSession) => call<ChatSession>(`/api/projects/${id}/chats/${chat.id}`, json('PUT', chat)),
  deleteChat: (id: string, chatId: string) => call<{ ok: true }>(`/api/projects/${id}/chats/${chatId}`, { method: 'DELETE' }),

  listPersonas: () => call<Persona[]>('/api/personas'),
  savePersonas: (list: Persona[]) => call<Persona[]>('/api/personas', json('PUT', list)),
  personaAvatarUrl: (p: Persona) => (p.avatar ? `/api/personas/${p.id}/avatar?v=${p.avatar.version}` : null),
  setPersonaAvatar: (id: string, image: Blob) => call<AvatarInfo>(`/api/personas/${id}/avatar`, { method: 'PUT', body: image }),
  clearPersonaAvatar: (id: string) => call<{ ok: true }>(`/api/personas/${id}/avatar`, { method: 'DELETE' }),

  importStPersonas: (folder: string) =>
    call<{ added: number; skipped: number; pictures: number; from: string; defaultName: string | null }>('/api/personas/import-st', json('POST', { folder })),

  getConfig: () => call<AppConfig>('/api/config'),
  setConfig: (patch: Partial<AppConfig>) => call<AppConfig>('/api/config', json('PUT', patch)),
  pickFolder: (initial = '', title?: string) => call<{ path: string; unsupported?: boolean }>('/api/pick-folder', json('POST', { initial, title })),

  saveGen: (image: Blob, filename: string, card: string) =>
    call<{ path: string }>('/api/gens/save', {
      method: 'POST',
      body: image,
      headers: { 'x-filename': encodeURIComponent(filename), 'x-card': encodeURIComponent(card) },
    }),

  library: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    return call<{ roots: string[]; folders: Record<string, number>; total: number; items: LibraryItem[]; scan: { scanning: boolean; done: number; total: number } }>(`/api/library/images?${q}`);
  },
  libraryThumb: (id: string) => `/api/library/thumb?id=${id}`,
  libraryFile: (id: string) => `/api/library/file?id=${id}`,

  llmModels: (connection: LlmRequest['connection']) => call<string[]>('/api/llm/models', json('POST', { connection, messages: [] })),
};

/**
 * Streams a completion through the local proxy, calling `onEvent` for each
 * event. Resolves when the stream ends; abort `signal` to stop it early.
 */
export async function streamLlm(req: LlmRequest, onEvent: (e: LlmEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/llm/chat', { ...json('POST', req), signal });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    onEvent({ type: 'error', message: body.error ?? `${res.status} ${res.statusText}` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as LlmEvent);
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as LlmEvent);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') throw err;
  }
}
