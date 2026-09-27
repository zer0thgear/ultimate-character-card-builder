import { SETTINGS_SECTIONS, setSettingsSection, type SettingsSection } from '@/lib/server/storage';
import { BadRequestError } from '@/lib/server/storage';
import { handle, jsonBody } from '@/lib/server/http';

type Ctx = { params: Promise<{ section: string }> };

/** Replaces one section (the browser sends the whole store it keeps). */
export async function PUT(req: Request, { params }: Ctx) {
  const { section } = await params;
  return handle(async () => {
    if (!(SETTINGS_SECTIONS as readonly string[]).includes(section)) throw new BadRequestError(`No settings section ${section}`);
    await setSettingsSection(section as SettingsSection, await jsonBody<unknown>(req));
    return Response.json({ ok: true });
  });
}
