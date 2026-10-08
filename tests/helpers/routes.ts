// Sends a request to the app's own route handlers (app/api/*), as Next
// would, without a server: `routeFetch` stands in for fetch(), so the
// stores' saves go through the same routes and onto the same disk as in
// the app. Set UCCB_DATA_DIR before the first request; route modules (and
// the storage they use) are only imported then.

// A handler takes its own params; `never` lets any of them in here.
type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
type RouteModule = Partial<Record<string, Handler>>;

/** Each route's path as its folder spells it (`[id]` is `:id`). */
const ROUTES: [string, () => Promise<RouteModule>][] = [
  ['/api/projects', () => import('@/app/api/projects/route')],
  ['/api/projects/:id', () => import('@/app/api/projects/[id]/route')],
  ['/api/projects/:id/lorebook', () => import('@/app/api/projects/[id]/lorebook/route')],
  ['/api/projects/:id/duplicate', () => import('@/app/api/projects/[id]/duplicate/route')],
  ['/api/projects/:id/versions', () => import('@/app/api/projects/[id]/versions/route')],
  ['/api/projects/:id/versions/:vid', () => import('@/app/api/projects/[id]/versions/[vid]/route')],
  ['/api/trash', () => import('@/app/api/trash/route')],
  ['/api/trash/:entry', () => import('@/app/api/trash/[entry]/route')],
  ['/api/projects/:id/avatar', () => import('@/app/api/projects/[id]/avatar/route')],
  ['/api/projects/:id/kept/:file', () => import('@/app/api/projects/[id]/kept/[file]/route')],
  ['/api/projects/:id/library-gens', () => import('@/app/api/projects/[id]/library-gens/route')],
  ['/api/library/images', () => import('@/app/api/library/images/route')],
  ['/api/projects/:id/chats', () => import('@/app/api/projects/[id]/chats/route')],
  ['/api/projects/:id/chats/:chatId', () => import('@/app/api/projects/[id]/chats/[chatId]/route')],
  ['/api/projects/:id/stories', () => import('@/app/api/projects/[id]/stories/route')],
  ['/api/projects/:id/stories/:storyId', () => import('@/app/api/projects/[id]/stories/[storyId]/route')],
  ['/api/projects/:id/adventures', () => import('@/app/api/projects/[id]/adventures/route')],
  ['/api/projects/:id/adventures/:adventureId', () => import('@/app/api/projects/[id]/adventures/[adventureId]/route')],
  ['/api/projects/:id/chat-images/:file', () => import('@/app/api/projects/[id]/chat-images/[file]/route')],
  ['/api/personas', () => import('@/app/api/personas/route')],
  ['/api/tags', () => import('@/app/api/tags/route')],
  ['/api/lorebooks', () => import('@/app/api/lorebooks/route')],
  ['/api/lorebooks/:id', () => import('@/app/api/lorebooks/[id]/route')],
  ['/api/packs', () => import('@/app/api/packs/route')],
  ['/api/packs/:id', () => import('@/app/api/packs/[id]/route')],
  ['/api/packs/:id/data', () => import('@/app/api/packs/[id]/data/route')],
  ['/api/personas/:id/avatar', () => import('@/app/api/personas/[id]/avatar/route')],
  ['/api/settings', () => import('@/app/api/settings/route')],
  ['/api/settings/:section', () => import('@/app/api/settings/[section]/route')],
  ['/api/config', () => import('@/app/api/config/route')],
  ['/api/gens/save', () => import('@/app/api/gens/save/route')],
];

const compiled = ROUTES.map(([pattern, load]) => {
  const names: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, name: string) => (names.push(name), '([^/]+)'))}$`);
  return { re, names, load };
});

/** Every request that reached a route, in order (`PUT /api/projects/x`). */
export const routeLog: string[] = [];

export async function routeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = new Request(typeof input === 'string' ? new URL(input, 'http://localhost') : input, init);
  const { pathname } = new URL(req.url);
  for (const { re, names, load } of compiled) {
    const m = re.exec(pathname);
    if (!m) continue;
    const handler = (await load())[req.method];
    if (!handler) return new Response(null, { status: 405 });
    routeLog.push(`${req.method} ${pathname}`);
    const params = Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(m[i + 1])]));
    return handler(req, { params: Promise.resolve(params as never) });
  }
  return new Response(null, { status: 404 });
}

/** A JSON request body, as lib/api.ts sends one. */
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
