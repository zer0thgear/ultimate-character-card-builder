import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CardVersion, CardVersionInfo, VersionReason } from '@/types/project';
import type { CharacterCard } from '@/types/card';
import { BadRequestError, NotFoundError, checkId, getConfig, projectDir, readJson, removeJson, writeFileAtomic } from '@/lib/server/storage';

// Earlier versions of a card, one file each in data/projects/<id>/versions/.
// The editor keeps one at the start of each editing session and before a
// change to many fields at once (lib/versionHistory.ts says when); one can
// also be saved by hand, with a name. Past Settings' limit, the oldest
// unnamed ones go first; named ones are kept.

const versionsDir = (id: string) => path.join(projectDir(id), 'versions');
const versionFile = (id: string, vid: string) => path.join(versionsDir(id), `${checkId(vid)}.json`);

const REASONS: VersionReason[] = ['session', 'overwrite', 'macro', 'assistant', 'restore', 'manual'];

async function readAll(id: string): Promise<CardVersion[]> {
  let files: string[];
  try {
    files = await fs.readdir(versionsDir(id));
  } catch {
    return [];
  }
  const out: CardVersion[] = [];
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const v = await readJson<CardVersion>(path.join(versionsDir(id), f)).catch(() => null);
    if (v?.card) out.push(v);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

const info = (v: CardVersion): CardVersionInfo => {
  const { card, ...rest } = v;
  return { ...rest, name: card.data?.name ?? '', bytes: JSON.stringify(card).length };
};

/** The card's versions, newest first, without their cards. */
export async function listVersions(id: string): Promise<CardVersionInfo[]> {
  return (await readAll(id)).map(info);
}

export async function getVersion(id: string, vid: string): Promise<CardVersion> {
  const v = await readJson<CardVersion>(versionFile(id, vid));
  if (!v) throw new NotFoundError(`No version ${vid}`);
  return v;
}

const same = (a: CharacterCard, b: CharacterCard) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Keeps `card` as a version, unless history is off or it's the same as the
 * newest one (a version saved by hand is kept anyway, to carry its name).
 * Returns it, or null if it wasn't kept.
 */
export async function addVersion(id: string, input: { card: CharacterCard; reason: VersionReason; label?: string }): Promise<CardVersionInfo | null> {
  if (!input?.card?.data) throw new BadRequestError('A version needs a card.');
  const reason = REASONS.includes(input.reason) ? input.reason : 'manual';
  const config = await getConfig();
  if (!config.versionHistory && reason !== 'manual') return null;
  const all = await readAll(id);
  const label = input.label?.trim() || undefined;
  if (!label && all[0] && same(all[0].card, input.card)) return null;
  const v: CardVersion = { id: randomUUID(), createdAt: Date.now(), reason, ...(label ? { label } : {}), card: input.card };
  await fs.mkdir(versionsDir(id), { recursive: true });
  await writeFileAtomic(versionFile(id, v.id), JSON.stringify(v), { backup: false });
  await prune(id, config.versionsToKeep, [v, ...all]);
  return info(v);
}

/** Drops the oldest unnamed versions past `keep`. */
async function prune(id: string, keep: number, all: CardVersion[]) {
  let extra = all.length - keep;
  for (const v of [...all].reverse()) {
    if (extra <= 0) break;
    if (v.label) continue;
    await removeJson(versionFile(id, v.id));
    extra--;
  }
}

/** Names (or unnames, with '') a version. */
export async function renameVersion(id: string, vid: string, label: string): Promise<CardVersionInfo> {
  const v = await getVersion(id, vid);
  const next: CardVersion = { ...v, label: label.trim() || undefined };
  if (!next.label) delete next.label;
  await writeFileAtomic(versionFile(id, vid), JSON.stringify(next), { backup: false });
  return info(next);
}

export async function deleteVersion(id: string, vid: string) {
  await removeJson(versionFile(id, vid));
}
