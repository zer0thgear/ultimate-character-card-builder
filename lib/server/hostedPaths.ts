import path from 'node:path';

// On a server (UCCB_HOSTED, docs/HOSTING.md), the folders settings name
// (where gens are saved, the folders the gen library browses) stay inside
// one folder of the data folder: whoever's signed in can use UCCB, not read
// or write the rest of the server's files. Relative names are taken from
// there ("gens" → <data>/files/gens).

export const isHosted = (env: NodeJS.ProcessEnv = process.env) => /^(1|true|yes|on)$/i.test(String(env.UCCB_HOSTED ?? '').trim());

/** `folder` inside `root` (relative names from root), or null if it leads out of it. */
export function confineFolder(folder: string, root: string): string | null {
  const f = folder.trim();
  if (!f) return null;
  const resolved = path.resolve(root, f);
  const rel = path.relative(root, resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) ? resolved : null;
}
