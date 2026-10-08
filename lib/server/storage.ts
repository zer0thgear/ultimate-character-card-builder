import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanTagData, type AppTagData } from '@/lib/appTags';
import type { AppConfig, BankLorebook, CardProject, ChatSession, ChatSummary, Persona, ProjectSummary, StorySession, StorySummary, TrashedProject } from '@/types/project';
import { DEFAULT_CONFIG } from '@/types/project';
import type { AdventureSession, AdventureSummary } from '@/types/adventure';
import { newCard } from '@/lib/cardSpec';
import { normalizeCard, normalizeLorebook } from '@/lib/cardSpec';
import { notesSnippet } from '@/lib/cardSummary';
import { PackError, validatePack, type InstalledPack } from '@/lib/extensionPack';
import { countTokens } from 'gpt-tokenizer';
import { sumTallies, tallyChat, type ChatTally } from '@/lib/chatStats';
import { cardStats, type CardStats } from '@/lib/cardStats';

// Everything UCCB saves lives under data/ (gitignored):
//   data/config.json                    AppConfig
//   data/projects/<id>/project.json     CardProject
//   data/projects/<id>/avatar.png
//   data/projects/<id>/gallery/*.png    kept gens
//   data/projects/<id>/chats/<id>.json  test chats
//   data/projects/<id>/stories/<id>.json  Writing mode's stories
//   data/trash/<id>-<time>/             deleted projects, until restored or emptied
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

export const projectDir = (id: string) => path.join(PROJECTS, checkId(id));

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
  next.versionHistory = next.versionHistory !== false;
  next.versionsToKeep = Math.max(1, Math.min(500, Math.round(Number(next.versionsToKeep) || DEFAULT_CONFIG.versionsToKeep)));
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

/**
 * A copy of a project under a new id, named "… (copy)": the card, its
 * picture, notes, art prompts and kept gens, and its chats (with their
 * pictures) and stories if `chats` is set. Version history stays with the original.
 */
export async function duplicateProject(id: string, { chats = false }: { chats?: boolean } = {}): Promise<CardProject> {
  const src = await getProject(id);
  const newId = randomUUID();
  const to = projectDir(newId);
  await fs.mkdir(to, { recursive: true });
  for (const sub of ['avatar.png', 'gallery', ...(chats ? ['chats', 'chat-images', 'stories', 'adventures'] : [])]) {
    await fs.cp(path.join(projectDir(id), sub), path.join(to, sub), { recursive: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
  // Chat pictures are filed under their chat's id, which a copy keeps.
  const now = Date.now();
  const name = src.card.data.name.trim();
  const copy: CardProject = {
    ...structuredClone(src),
    id: newId,
    card: { ...structuredClone(src.card), data: { ...structuredClone(src.card.data), name: name ? `${name} (copy)` : '' } },
    createdAt: now,
    updatedAt: now,
  };
  return saveProject(copy);
}

// ─── Trash ───────────────────────────────────────────────────────────────────

const TRASH_RE = /^([a-zA-Z0-9_-]{1,64})-(\d{10,})$/;


export async function listTrash(): Promise<TrashedProject[]> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(TRASH);
  } catch {
    return [];
  }
  const out: TrashedProject[] = [];
  await Promise.all(
    dirs.map(async (entry) => {
      const m = entry.match(TRASH_RE);
      if (!m) return;
      const dir = path.join(TRASH, entry);
      const p = await readJson<CardProject>(path.join(dir, 'project.json')).catch(() => null);
      if (!p) return;
      const chats = await fs.readdir(path.join(dir, 'chats')).then((f) => f.filter((x) => x.endsWith('.json')).length, () => 0);
      const hasAvatar = await fs.stat(path.join(dir, 'avatar.png')).then(() => true, () => false);
      out.push({ entry, id: m[1], name: p.card?.data?.name ?? '', deletedAt: Number(m[2]), hasAvatar, chats });
    }),
  );
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

const trashDir = (entry: string) => {
  if (!TRASH_RE.test(entry)) throw new BadRequestError(`Bad trash entry: ${entry}`);
  return path.join(TRASH, entry);
};

export const trashAvatarPath = (entry: string) => path.join(trashDir(entry), 'avatar.png');

/** Puts a deleted project back (under a new id if its old one was reused). */
export async function restoreFromTrash(entry: string): Promise<CardProject> {
  const from = trashDir(entry);
  const p = await readJson<CardProject>(path.join(from, 'project.json'));
  if (!p) throw new NotFoundError(`Nothing in the trash called ${entry}`);
  let id = entry.match(TRASH_RE)![1];
  const taken = await fs.stat(projectDir(id)).then(() => true, () => false);
  if (taken) id = randomUUID();
  await fs.mkdir(PROJECTS, { recursive: true });
  await fs.rename(from, projectDir(id));
  return updateProject(id, (cur) => ({ ...cur, id }));
}

/** Deletes a trashed project for good. */
export async function deleteFromTrash(entry: string) {
  await fs.rm(trashDir(entry), { recursive: true, force: true });
}

export async function emptyTrash() {
  for (const t of await listTrash()) await deleteFromTrash(t.entry);
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

/** Every chat of a card, whole (a damaged one left out). */
async function readChats(projectId: string): Promise<ChatSession[]> {
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
  return chats.filter((c): c is ChatSession => !!c);
}

/** 📊 A card's numbers across its chats (lib/cardStats.ts). */
export async function projectStats(projectId: string): Promise<CardStats> {
  await getProject(projectId);
  return cardStats(await readChats(projectId), countText);
}

export async function listChats(projectId: string): Promise<ChatSummary[]> {
  return (await readChats(projectId))
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
  const { last, ...tally } = sumTallies(found);
  return { chats: found.length, messages: found.reduce((n, s) => n + s.messages, 0), ...(last ? { lastChat: last } : {}), ...tally };
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

// ─── Stories (Writing mode) ──────────────────────────────────────────────────

const storyPath = (projectId: string, storyId: string) => path.join(projectDir(projectId), 'stories', `${checkId(storyId)}.json`);

const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;

export async function listStories(projectId: string): Promise<StorySummary[]> {
  const dir = path.join(projectDir(projectId), 'stories');
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const stories = await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => readJson<StorySession>(path.join(dir, f)).catch(() => null)));
  return stories
    .filter((s): s is StorySession => !!s)
    .map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt, words: wordCount(s.text ?? '') }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getStory(projectId: string, storyId: string): Promise<StorySession> {
  const s = await readJson<StorySession>(storyPath(projectId, storyId));
  if (!s) throw new NotFoundError(`No story ${storyId}`);
  return s;
}

export async function saveStory(projectId: string, story: StorySession): Promise<StorySession> {
  if (typeof story.text !== 'string') throw new BadRequestError('A story needs its text');
  const saved = { ...story, updatedAt: Date.now() };
  await writeFileAtomic(storyPath(projectId, story.id), JSON.stringify(saved));
  return saved;
}

export async function deleteStory(projectId: string, storyId: string) {
  await removeJson(storyPath(projectId, storyId));
}

// ─── Adventures ──────────────────────────────────────────────────────────────
//   data/projects/<id>/adventures/<adventureId>.json   AdventureSession

const adventurePath = (projectId: string, adventureId: string) => path.join(projectDir(projectId), 'adventures', `${checkId(adventureId)}.json`);

export async function listAdventures(projectId: string): Promise<AdventureSummary[]> {
  const dir = path.join(projectDir(projectId), 'adventures');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  const all = await Promise.all(files.map((f) => readJson<AdventureSession>(path.join(dir, f)).catch(() => null)));
  return all
    .filter((a): a is AdventureSession => !!a)
    .map((a) => ({ id: a.id, name: a.name, createdAt: a.createdAt, updatedAt: a.updatedAt, turns: (Array.isArray(a.entries) ? a.entries : []).reduce((n, e) => Math.max(n, e.turn ?? 0), 0) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAdventure(projectId: string, adventureId: string): Promise<AdventureSession> {
  const a = await readJson<AdventureSession>(adventurePath(projectId, adventureId));
  if (!a) throw new NotFoundError(`No adventure ${adventureId}`);
  return a;
}

export async function saveAdventure(projectId: string, adventure: AdventureSession): Promise<AdventureSession> {
  if (!Array.isArray(adventure.entries)) throw new BadRequestError('An adventure needs its entries.');
  const saved = { ...adventure, updatedAt: Date.now() };
  await writeFileAtomic(adventurePath(projectId, adventure.id), JSON.stringify(saved));
  return saved;
}

export async function deleteAdventure(projectId: string, adventureId: string) {
  await removeJson(adventurePath(projectId, adventureId));
}

// ─── Personas ────────────────────────────────────────────────────────────────
//   data/personas/personas.json   Persona[]
//   data/personas/<id>.png        avatars

const PERSONAS = path.join(DATA_DIR, 'personas');

export async function listPersonas(): Promise<Persona[]> {
  return (await readJson<Persona[]>(path.join(PERSONAS, 'personas.json'))) ?? [];
}

export async function savePersonas(list: Persona[]): Promise<Persona[]> {
  const clean = list
    .filter((p) => ID_RE.test(p.id))
    .map((p) => ({ id: p.id, name: String(p.name ?? ''), description: String(p.description ?? ''), avatar: p.avatar, ...(typeof p.lorebookId === 'string' && p.lorebookId ? { lorebookId: p.lorebookId } : {}) }));
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

// ─── App tags ────────────────────────────────────────────────────────────────
//   data/tags.json   AppTagData (lib/appTags.ts): your tags, which cards have them

const TAGS_FILE = path.join(DATA_DIR, 'tags.json');

export async function readAppTags(): Promise<AppTagData> {
  return cleanTagData(await readJson<unknown>(TAGS_FILE));
}

export async function saveAppTags(data: unknown): Promise<AppTagData> {
  const clean = cleanTagData(data);
  await writeFileAtomic(TAGS_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

// ─── Lorebooks (the bank) ────────────────────────────────────────────────────
//   data/lorebooks/<id>.json   BankLorebook

const LOREBOOKS = path.join(DATA_DIR, 'lorebooks');
const lorebookPath = (id: string) => path.join(LOREBOOKS, `${checkId(id)}.json`);

export async function listLorebooks(): Promise<BankLorebook[]> {
  const files = await fs.readdir(LOREBOOKS).catch(() => [] as string[]);
  const books = await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => readJson<BankLorebook>(path.join(LOREBOOKS, f)).catch(() => null)));
  return books.filter((b): b is BankLorebook => !!b?.book).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getLorebook(id: string): Promise<BankLorebook> {
  const b = await readJson<BankLorebook>(lorebookPath(id));
  if (!b) throw new NotFoundError(`No lorebook ${id}`);
  return b;
}

export async function saveLorebook(b: BankLorebook): Promise<BankLorebook> {
  const book = normalizeLorebook(b?.book);
  if (!book) throw new BadRequestError('A lorebook needs its book');
  const now = Date.now();
  const clean: BankLorebook = {
    id: checkId(b.id),
    book,
    ...(b.fromCard && typeof b.fromCard.projectId === 'string' ? { fromCard: { projectId: b.fromCard.projectId, name: String(b.fromCard.name ?? '') } } : {}),
    createdAt: typeof b.createdAt === 'number' ? b.createdAt : now,
    updatedAt: now,
  };
  await writeFileAtomic(lorebookPath(clean.id), JSON.stringify(clean, null, 2));
  return clean;
}

export async function deleteLorebook(id: string) {
  await removeJson(lorebookPath(id));
}

// ─── Extension packs ─────────────────────────────────────────────────────────
//   data/packs/<id>.json   InstalledPack (lib/extensionPack.ts)

const PACKS = path.join(DATA_DIR, 'packs');
const packPath = (id: string) => path.join(PACKS, `${checkId(id)}.json`);

export async function listPacks(): Promise<InstalledPack[]> {
  const files = await fs.readdir(PACKS).catch(() => [] as string[]);
  const packs = await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => readJson<InstalledPack>(path.join(PACKS, f)).catch(() => null)));
  return packs.filter((p): p is InstalledPack => !!p?.pack?.id).sort((a, b) => a.installedAt - b.installedAt);
}

/** Installs a pack, or updates the one with its id (keeping when it was
 *  installed, so its place in the order stays). It's checked again here. */
export async function savePack(p: Partial<InstalledPack>): Promise<InstalledPack> {
  let pack;
  try {
    pack = validatePack(p?.pack).pack;
  } catch (err) {
    throw err instanceof PackError ? new BadRequestError(err.message) : err;
  }
  const before = await readJson<InstalledPack>(packPath(pack.id)).catch(() => null);
  const now = Date.now();
  const codeApproved = p.codeApproved === true && !!pack.ui?.length;
  const clean: InstalledPack = {
    pack,
    enabled: p.enabled !== false,
    ...(codeApproved ? { codeApproved, granted: (Array.isArray(p.granted) ? p.granted : []).filter((g) => pack.permissions?.includes(g as never)) } : {}),
    installedAt: before?.installedAt ?? (typeof p.installedAt === 'number' ? p.installedAt : now),
    updatedAt: now,
  };
  await writeFileAtomic(packPath(pack.id), JSON.stringify(clean, null, 2));
  return clean;
}

export async function deletePack(id: string) {
  await removeJson(packPath(id));
  await removeJson(packDataPath(id));
}

// An extension's own data (uccb.storage), one JSON object per pack:
//   data/pack-data/<id>.json
const PACK_DATA = path.join(DATA_DIR, 'pack-data');
const packDataPath = (id: string) => path.join(PACK_DATA, `${checkId(id)}.json`);
export const MAX_PACK_DATA_BYTES = 1_000_000;

export async function getPackData(id: string): Promise<Record<string, unknown>> {
  return (await readJson<Record<string, unknown>>(packDataPath(id))) ?? {};
}

export async function savePackData(id: string, data: unknown): Promise<Record<string, unknown>> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestError("An extension's data must be an object.");
  if (!(await readJson<InstalledPack>(packPath(id)))) throw new NotFoundError(`No extension ${id}`);
  const text = JSON.stringify(data);
  if (text.length > MAX_PACK_DATA_BYTES) throw new BadRequestError(`An extension can keep at most ${MAX_PACK_DATA_BYTES / 1_000_000} MB of data.`);
  await writeFileAtomic(packDataPath(id), text);
  return data as Record<string, unknown>;
}

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
