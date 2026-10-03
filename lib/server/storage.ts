import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, CardProject, ChatSession, ChatSummary, Persona, ProjectSummary } from '@/types/project';
import { DEFAULT_CONFIG } from '@/types/project';
import { newCard } from '@/lib/cardSpec';
import { normalizeCard } from '@/lib/cardSpec';
import { notesSnippet } from '@/lib/cardSummary';
import { countTokens } from 'gpt-tokenizer';
import { sumTallies, tallyChat, type ChatTally } from '@/lib/chatStats';

// Everything UCCB saves lives under data/ (gitignored):
//   data/config.json                    AppConfig
//   data/projects/<id>/project.json     CardProject
//   data/projects/<id>/avatar.png
//   data/projects/<id>/gallery/*.png    kept gens
//   data/projects/<id>/chats/<id>.json  test chats
//   data/trash/<id>-<time>/             deleted projects, recoverable by hand
//   data/library-index.json             the gen library's metadata cache
//   data/recent-gens/<id>.png + .json   recent gens, until kept, cleared or expired

export const DATA_DIR = path.resolve(process.env.UCCB_DATA_DIR ?? path.join(process.cwd(), 'data'));
const PROJECTS = path.join(DATA_DIR, 'projects');
const TRASH = path.join(DATA_DIR, 'trash');

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}
/** A file that's there but can't be read (a crash mid-save), with no
 *  readable backup either. */
export class DamagedFileError extends Error {}

/** Ids come from URLs; anything else could walk out of the data folder. */
export function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new BadRequestError(`Bad id: ${id}`);
  return id;
}

const projectDir = (id: string) => path.join(PROJECTS, checkId(id));

/** The previous version of a JSON file, kept beside it (writeFileAtomic). */
export const backupOf = (file: string) => `${file}.bak`;

/**
 * A JSON file, or null if there's none. One that can't be read (a crash can
 * leave a file full of zeros) falls back to its backup, the version before;
 * with no readable backup either, it's a DamagedFileError.
 */
export async function readJson<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    try {
      const saved = JSON.parse(await fs.readFile(backupOf(file), 'utf8')) as T;
      console.warn(`${file} couldn't be read (damaged, probably by a crash); using its backup, ${backupOf(file)}.`);
      return saved;
    } catch {
      throw new DamagedFileError(`${path.relative(DATA_DIR, file)} is damaged (probably by a crash while it was being saved) and has no readable backup.`);
    }
  }
}

/** Deletes a JSON file and its backup. */
export async function removeJson(file: string) {
  await Promise.all([fs.rm(file, { force: true }), fs.rm(backupOf(file), { force: true })]);
}

/**
 * Written to a temp file, forced onto the disk, then renamed over the old
 * one, so a crash mid-write can't leave half a file (or, on Windows, a file
 * of zeros: without the flush, the rename can reach the disk before the
 * data does). A JSON file's previous version is kept as `<file>.bak` first,
 * so there's always one good copy to fall back on (readJson).
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array, { backup = file.endsWith('.json') }: { backup?: boolean } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (backup) {
    // Only a readable old version is worth keeping (never copy damage over the backup).
    try {
      JSON.parse(await fs.readFile(file, 'utf8'));
      await fs.copyFile(file, backupOf(file));
    } catch {
      /* no old version, or a damaged one */
    }
  }
  await fs.rename(tmp, file);
}

// ─── Config ──────────────────────────────────────────────────────────────────

export async function getConfig(): Promise<AppConfig> {
  return { ...DEFAULT_CONFIG, ...((await readJson<Partial<AppConfig>>(path.join(DATA_DIR, 'config.json'))) ?? {}) };
}

export async function setConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = { ...(await getConfig()), ...patch };
  next.libraryFolders = [...new Set(next.libraryFolders.map((f) => f.trim()).filter(Boolean))];
  next.recentGensDays = Math.max(0, Math.round(Number(next.recentGensDays) || 0));
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
      const p = await readJson<CardProject>(path.join(PROJECTS, id, 'project.json')).catch((err) => {
        if (err instanceof DamagedFileError) console.warn(err.message);
        return null;
      });
      if (!p) return;
      out.push({
        id,
        name: p.card?.data?.name ?? '',
        tags: p.card?.data?.tags ?? [],
        avatar: p.avatar,
        ...(p.chatOnly ? { chatOnly: true } : {}),
        ...(p.card?.data?.creator?.trim() ? { creator: p.card.data.creator.trim() } : {}),
        ...(notesSnippet(p.card?.data?.creator_notes) ? { notes: notesSnippet(p.card?.data?.creator_notes) } : {}),
        ...(await chatStats(id)),
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
export async function updateProject(id: string, change: (p: CardProject) => CardProject | Promise<CardProject>, ifDamaged?: CardProject): Promise<CardProject> {
  const prev = locks.get(id) ?? Promise.resolve();
  const current = async () => {
    try {
      return await getProject(id);
    } catch (err) {
      // A tab that still has the card open can save it back over a file a
      // crash damaged (it's the only copy left).
      if (err instanceof DamagedFileError && ifDamaged) return withDefaults({ ...ifDamaged, id });
      throw err;
    }
  };
  const next = prev.catch(() => {}).then(async () => saveProject(await change(await current())));
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

/** A picture drawn in a chat. Named after its chat (`<chatId>-…`), so a
 *  deleted chat's pictures go with it. */
export function chatImagePath(id: string, file: string) {
  if (!FILE_RE.test(file) || file.includes('..')) throw new BadRequestError(`Bad file name: ${file}`);
  return path.join(projectDir(id), 'chat-images', file);
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
    .map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length, ...tallyChat(c.messages, countText) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The same estimate the editor's token counts make (lib/textTokens.ts). */
const countText = (text: string) => (text ? countTokens(text) : 0);

/** Each chat file's message counts, tokens and time, kept while the file's
 *  unchanged, so listing cards doesn't read every chat every time. */
const chatStatCache = new Map<string, { mtime: number; messages: number; updatedAt: number } & ChatTally>();

/** A card's chats in sum, for the card lists (none: nothing). */
async function chatStats(projectId: string): Promise<Pick<ProjectSummary, 'chats' | 'messages' | 'lastChat' | 'sent' | 'received' | 'tokens'>> {
  const dir = path.join(projectDir(projectId), 'chats');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  const stats = await Promise.all(
    files.map(async (f) => {
      const file = path.join(dir, f);
      try {
        const { mtimeMs } = await fs.stat(file);
        const hit = chatStatCache.get(file);
        if (hit?.mtime === mtimeMs) return hit;
        const c = await readJson<ChatSession>(file);
        if (!c) return null;
        const messages = Array.isArray(c.messages) ? c.messages : [];
        const stat = { mtime: mtimeMs, messages: messages.length, updatedAt: c.updatedAt ?? 0, ...tallyChat(messages, countText) };
        chatStatCache.set(file, stat);
        return stat;
      } catch {
        return null;
      }
    }),
  );
  const found = stats.filter((s) => !!s);
  if (!found.length) return {};
  return { chats: found.length, messages: found.reduce((n, s) => n + s.messages, 0), lastChat: Math.max(...found.map((s) => s.updatedAt)), ...sumTallies(found) };
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
  await removeJson(chatPath(projectId, chatId));
  const dir = path.join(projectDir(projectId), 'chat-images');
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => f.startsWith(`${checkId(chatId)}-`)).map((f) => fs.rm(path.join(dir, f), { force: true })));
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

// ─── Settings shared by every device ─────────────────────────────────────────
//   data/settings.json   { gen, llm, naiKey }: what browsers used to keep in
//   localStorage, kept here so every device (and every address this one is
//   opened at) shares them. Layout preferences stay in each browser.

export const SETTINGS_SECTIONS = ['gen', 'llm', 'naiKey'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
let settingsLock: Promise<unknown> = Promise.resolve();

export async function getSettings(): Promise<Partial<Record<SettingsSection, unknown>>> {
  return (await readJson<Partial<Record<SettingsSection, unknown>>>(SETTINGS_FILE)) ?? {};
}

export function setSettingsSection(section: SettingsSection, value: unknown) {
  const next = settingsLock.catch(() => {}).then(async () => {
    const all = await getSettings();
    all[section] = value;
    await writeFileAtomic(SETTINGS_FILE, JSON.stringify(all, null, 2));
  });
  settingsLock = next;
  return next;
}

// ─── Recent gens ─────────────────────────────────────────────────────────────
// Each gen as it arrives, so a closed, reloaded or frozen tab doesn't lose it
// and every device sees it. The details are the browser's own (lib/api.ts
// strips the Img2Img images out); only the id and timestamp matter here.
// Gens older than config.recentGensDays are deleted when the list is read.

const RECENT = path.join(DATA_DIR, 'recent-gens');

export interface RecentGenMeta {
  id: string;
  timestamp: number;
  [key: string]: unknown;
}

export const recentGenPath = (id: string) => path.join(RECENT, `${checkId(id)}.png`);
const recentMetaPath = (id: string) => path.join(RECENT, `${checkId(id)}.json`);

export async function deleteRecentGens(ids: string[]) {
  await Promise.all(ids.map((id) => Promise.all([fs.rm(recentGenPath(id), { force: true }), removeJson(recentMetaPath(id))])));
}

/** Every recent gen, newest first, after deleting expired ones. */
export async function listRecentGens(): Promise<RecentGenMeta[]> {
  const { recentGensDays } = await getConfig();
  let files: string[];
  try {
    files = await fs.readdir(RECENT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const metas = (
    await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => readJson<RecentGenMeta>(path.join(RECENT, f)).catch(() => null)))
  ).filter((m): m is RecentGenMeta => !!m && typeof m.id === 'string' && ID_RE.test(m.id));
  const cutoff = recentGensDays > 0 ? Date.now() - recentGensDays * 86_400_000 : -Infinity;
  const expired = metas.filter((m) => m.timestamp < cutoff);
  if (expired.length) await deleteRecentGens(expired.map((m) => m.id));
  return metas.filter((m) => m.timestamp >= cutoff).sort((a, b) => b.timestamp - a.timestamp);
}

export async function addRecentGen(meta: RecentGenMeta, png: Uint8Array) {
  checkId(meta.id);
  if (typeof meta.timestamp !== 'number') throw new BadRequestError('A recent gen needs a timestamp.');
  await writeFileAtomic(recentGenPath(meta.id), png);
  await writeFileAtomic(recentMetaPath(meta.id), JSON.stringify(meta));
}

/** Merges into a gen's details; a gen that's gone (cleared elsewhere) is left gone. */
export async function patchRecentGen(id: string, patch: Record<string, unknown>) {
  const meta = await readJson<RecentGenMeta>(recentMetaPath(id));
  if (!meta) return null;
  const next = { ...meta, ...patch, id: meta.id, timestamp: meta.timestamp };
  await writeFileAtomic(recentMetaPath(id), JSON.stringify(next));
  return next;
}

/** How many there are and how much room they take. */
export async function recentGenStats(): Promise<{ count: number; bytes: number }> {
  let files: string[];
  try {
    files = await fs.readdir(RECENT);
  } catch {
    return { count: 0, bytes: 0 };
  }
  const sizes = await Promise.all(files.map((f) => fs.stat(path.join(RECENT, f)).then((s) => s.size, () => 0)));
  return { count: files.filter((f) => f.endsWith('.png')).length, bytes: sizes.reduce((a, b) => a + b, 0) };
}

// ─── Local extensions ────────────────────────────────────────────────────────

/** A local extension's own folder under data/ (lib/extensions/types.ts). */
export async function extensionDataDir(id: string): Promise<string> {
  const dir = path.join(DATA_DIR, 'ext', checkId(id));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
