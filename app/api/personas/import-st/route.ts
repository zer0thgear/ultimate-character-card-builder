import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { personaAvatarPath, updatePersonas, writeFileAtomic, BadRequestError } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';
import { parseStPersonas, samePersona } from '@/lib/stPersonas';
import type { Persona } from '@/types/project';

// POST /api/personas/import-st { folder } — imports every persona from a
// SillyTavern install (or its data/default-user folder), pictures included.

/** Where settings.json can be, from the folder given: the install root
 *  (current and older layouts) or the user's data folder itself. */
const SETTINGS_CANDIDATES = ['settings.json', 'data/default-user/settings.json', 'default-user/settings.json', 'public/settings.json'];

async function exists(p: string) {
  return fs.stat(p).then(() => true, () => false);
}

export async function POST(req: Request) {
  return handle(async () => {
    const { folder = '' } = await jsonBody<{ folder?: string }>(req);
    if (!folder.trim()) throw new BadRequestError('Choose the SillyTavern folder.');
    let settingsFile: string | null = null;
    for (const c of SETTINGS_CANDIDATES) {
      const p = path.join(folder, c);
      if (await exists(p)) {
        settingsFile = p;
        break;
      }
    }
    if (!settingsFile) throw new BadRequestError(`No SillyTavern settings.json found in ${folder} (looked for ${SETTINGS_CANDIDATES.join(', ')}).`);
    const found = parseStPersonas(JSON.parse(await fs.readFile(settingsFile, 'utf8')));
    const dir = path.dirname(settingsFile);
    const avatarDirs = [path.join(dir, 'User Avatars'), path.join(dir, 'User avatars'), path.join(folder, 'public', 'User Avatars')];

    let skipped = 0;
    let pictures = 0;
    const added: Persona[] = [];
    await updatePersonas(async (current) => {
      for (const st of found) {
        if (current.some((p) => samePersona(p, st)) || added.some((p) => samePersona(p, st))) {
          skipped++;
          continue;
        }
        const persona: Persona = { id: randomUUID(), name: st.name, description: st.description };
        for (const d of avatarDirs) {
          const file = path.join(d, path.basename(st.file));
          if (!(await exists(file))) continue;
          try {
            const png = await sharp(file).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
            const { width = 0, height = 0 } = await sharp(png).metadata();
            await writeFileAtomic(personaAvatarPath(persona.id), png);
            persona.avatar = { width, height, version: Date.now() };
            pictures++;
          } catch {
            /* an unreadable picture: import the persona without it */
          }
          break;
        }
        added.push(persona);
      }
      return [...current, ...added];
    });
    return Response.json({ added: added.length, skipped, pictures, from: settingsFile, defaultName: found.find((p) => p.isDefault)?.name ?? null });
  });
}
