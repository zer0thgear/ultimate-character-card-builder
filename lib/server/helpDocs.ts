import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { HelpDocs } from '@/lib/helpDesk';

// The docs the home screen's helper answers from, read from the app's own
// folder, so it always knows the version that's running.

// Each path spelled out, so the build traces just these files.
const read = (file: string) => readFile(file, 'utf8').catch(() => '');

export async function getHelpDocs(): Promise<HelpDocs> {
  const [tour, features, readme] = await Promise.all([
    read(path.join(process.cwd(), 'docs', 'TOUR.md')),
    read(path.join(process.cwd(), 'docs', 'FEATURES.md')),
    read(path.join(process.cwd(), 'README.md')),
  ]);
  return { tour, features, readme };
}
