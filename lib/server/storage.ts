import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, CardProject, ChatSession, ChatSummary, Persona, ProjectSummary } from '@/types/project';
import { DEFAULT_CONFIG } from '@/types/project';
import { newCard } from '@/lib/cardSpec';
import { normalizeCard } from '@/lib/cardSpec';

// Everything UCCB saves lives under data/ (gitignored):
//   data/config.json                    AppConfig
//   data/projects/<id>/project.json     CardProject
//   data/projects/<id>/avatar.png
//   data/projects/<id>/gallery/*.png    kept gens
//   data/projects/<id>/chats/<id>.json  test chats
//   data/trash/<id>-<time>/             deleted projects, recoverable by hand
//   data/library-index.json             the gen library's metadata cache

export const DATA_DIR = path.resolve(process.env.UCCB_DATA_DIR ?? path.join(process.cwd(), 'data'));
const PROJECTS = path.join(DATA_DIR, 'projects');
const TRASH = path.join(DATA_DIR, 'trash');

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

/** Ids come from URLs; anything else could walk out of the data folder. */
export function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new BadRequestError(`Bad id: ${id}`);
  return id;
}

const projectDir = (id: string) => path.join(PROJECTS, checkId(id));

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Written to a temp file and renamed over, so a crash mid-write can't
 *  leave half a project behind. */
export async function writeFileAtomic(file: string, data: string | Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

// ─── Config ──────────────────────────────────────────────────────────────────

export async function getConfig(): Promise<AppConfig> {
  return { ...DEFAULT_CONFIG, ...((await readJson<Partial<AppConfig>>(path.join(DATA_DIR, 'config.json'))) ?? {}) };
}

export async function setConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = { ...(await getConfig()), ...patch };
  next.libraryFolders = [...new Set(next.libraryFolders.map((f) => f.trim()).filter(Boolean))];
  await writeFileAtomic(path.join(DATA_DIR, 'config.json'), JSON.stringify(next, null, 2));
  return next;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function blankProject(id: string = randomUUID()): CardProject {
  const now = Date.now();
  return {
    id,
    card: newCard(),
    gen: {
      basePrompts: [{ id: 'p-default', label: 'Prompt 1', text: '', selected: true }],
      characters: [],
      negativePrompt: '',
      negativeTidbits: [],
    },
    kept: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** Fills in anything an older or hand-edited project.json is missing. */
function withDefaults(p: CardProject): CardProject {
  const base = blankProject(p.id);
  return {
    ...base,
    ...p,
    card: normalizeCard(p.card) ?? base.card,
    gen: { ...base.gen, ...p.gen },
    kept: Array.isArray(p.kept) ? p.kept : [],
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(PROJECTS);
  } catch {
    return [];
  }
  const out: ProjectSummary[] = [];
  await Promise.all(
    dirs.filter((d) => ID_RE.test(d)).map(async (id) => {
      const p = await readJson<CardProject>(path.join(PROJECTS, id, 'project.json')).catch(() => null);
      if (!p) return;
      out.push({
        id,
        name: p.card?.data?.name ?? '',
        tags: p.card?.data?.tags ?? [],
        avatar: p.avatar,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    }),
  );
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<CardProject> {
  const p = await readJson<CardProject>(path.join(projectDir(id), 'project.json'));
  if (!p) throw new NotFoundError(`No project ${id}`);
  return withDefaults({ ...p, id });
}

export async function saveProject(p: CardProject): Promise<CardProject> {
  const saved = { ...p, updatedAt: Date.now() };
  await writeFileAtomic(path.join(projectDir(p.id), 'project.json'), JSON.stringify(saved, null, 2));
  return saved;
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Reads, changes and saves a project with no other change to it in between.
 * Card edits, kept gens and the avatar all save through here, so one can't
 * write back a stale copy over another.
 */
export async function updateProject(id: string, change: (p: CardProject) => CardProject | Promise<CardProject>): Promise<CardProject> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => saveProject(await change(await getProject(id))));
  locks.set(id, next);
  try {
    return await next;
  } finally {
    if (locks.get(id) === next) locks.delete(id);
  }
}

export async function createProject(init?: Partial<CardProject>): Promise<CardProject> {
  const p = { ...blankProject(), ...init, id: randomUUID() };
  return saveProject(withDefaults(p));
}

/** Moves the project to data/trash rather than deleting it outright. */
export async function trashProject(id: string) {
  const from = projectDir(id);
  await fs.mkdir(TRASH, { recursive: true });
  await fs.rename(from, path.join(TRASH, `${id}-${Date.now()}`));
}

// ─── Project files (avatar, kept gens) ───────────────────────────────────────

export const avatarPath = (id: string) => path.join(projectDir(id), 'avatar.png');

const FILE_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
export function galleryPath(id: string, file: string) {
  if (!FILE_RE.test(file) || file.includes('..')) throw new BadRequestError(`Bad file name: ${file}`);
  return path.join(projectDir(id), 'gallery', file);
}

// ─── Chats ───────────────────────────────────────────────────────────────────

const chatPath = (projectId: string, chatId: string) => path.join(projectDir(projectId), 'chats', `${checkId(chatId)}.json`);

export async function listChats(projectId: string): Promise<ChatSummary[]> {
  const dir = path.join(projectDir(projectId), 'chats');
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const chats = await Promise.all(
    files.filter((f) => f.endsWith('.json')).map((f) => readJson<ChatSession>(path.join(dir, f)).catch(() => null)),
  );
  return chats
    .filter((c): c is ChatSession => !!c)
    .map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(projectId: string, chatId: string): Promise<ChatSession> {
  const c = await readJson<ChatSession>(chatPath(projectId, chatId));
  if (!c) throw new NotFoundError(`No chat ${chatId}`);
  return c;
}

export async function saveChat(projectId: string, chat: ChatSession): Promise<ChatSession> {
  const saved = { ...chat, updatedAt: Date.now() };
  await writeFileAtomic(chatPath(projectId, chat.id), JSON.stringify(saved));
  return saved;
}

export async function deleteChat(projectId: string, chatId: string) {
  await fs.rm(chatPath(projectId, chatId), { force: true });
}

// ─── Personas ────────────────────────────────────────────────────────────────
//   data/personas/personas.json   Persona[]
//   data/personas/<id>.png        avatars

const PERSONAS = path.join(DATA_DIR, 'personas');

export async function listPersonas(): Promise<Persona[]> {
  return (await readJson<Persona[]>(path.join(PERSONAS, 'personas.json'))) ?? [];
}

export async function savePersonas(list: Persona[]): Promise<Persona[]> {
  const clean = list.filter((p) => ID_RE.test(p.id)).map((p) => ({ id: p.id, name: String(p.name ?? ''), description: String(p.description ?? ''), avatar: p.avatar }));
  await writeFileAtomic(path.join(PERSONAS, 'personas.json'), JSON.stringify(clean, null, 2));
  return clean;
}

let personaLock: Promise<unknown> = Promise.resolve();

/** Reads, changes and saves the persona list with no other change in
 *  between (the list and the avatars are written by different routes). */
export function updatePersonas(change: (list: Persona[]) => Persona[] | Promise<Persona[]>): Promise<Persona[]> {
  const next = personaLock.catch(() => {}).then(async () => savePersonas(await change(await listPersonas())));
  personaLock = next;
  return next;
}

export const personaAvatarPath = (id: string) => path.join(PERSONAS, `${checkId(id)}.png`);
