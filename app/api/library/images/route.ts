import { getConfig } from '@/lib/server/storage';
import { libraryItems, scanLibrary } from '@/lib/server/library';
import { handle } from '@/lib/server/http';
import { searchLibrary } from '@/lib/librarySearch';

/**
 * GET /api/library/images?q=&root=&folder=&sub=1&sort=newest&offset=0&limit=200&rescan=1
 * The library's images matching a search, newest first by default, plus
 * each folder's image count for the folder list.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const q = url.searchParams;
    // A rescan on request; otherwise at most once a minute on its own.
    await scanLibrary(q.get('rescan') === '1' ? 0 : 60_000);
    const cfg = await getConfig();
    const all = await libraryItems();

    const folders: Record<string, number> = {};
    for (const i of all) {
      // Count each image in its folder and every folder above it.
      const parts = i.folder ? i.folder.split('/') : [];
      for (let d = 0; d <= parts.length; d++) {
        const key = `${i.root}:${parts.slice(0, d).join('/')}`;
        folders[key] = (folders[key] ?? 0) + 1;
      }
    }

    let items = all;
    const root = q.get('root');
    if (root !== null && root !== '') {
      const r = Number(root);
      const folder = q.get('folder') ?? '';
      const sub = q.get('sub') !== '0';
      items = items.filter((i) => i.root === r && (sub ? i.folder === folder || folder === '' || i.folder.startsWith(folder + '/') : i.folder === folder));
    }
    items = searchLibrary(items, q.get('q') ?? '');

    const sort = q.get('sort') ?? 'newest';
    if (sort === 'newest') items.sort((a, b) => b.mtime - a.mtime);
    else if (sort === 'oldest') items.sort((a, b) => a.mtime - b.mtime);
    else if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'random') {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    }

    const offset = Math.max(0, Number(q.get('offset') ?? 0) || 0);
    const limit = Math.min(1000, Math.max(1, Number(q.get('limit') ?? 200) || 200));
    return Response.json({
      roots: cfg.libraryFolders,
      folders,
      total: items.length,
      items: items.slice(offset, offset + limit),
    });
  });
}
