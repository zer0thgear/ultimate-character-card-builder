import { execFile } from 'node:child_process';
import { handle, jsonBody } from '@/lib/server/http';
import { isHosted } from '@/lib/server/hostedPaths';

// Opens the OS's own folder picker on this machine (UCCB is a local app),
// so folders don't have to be typed. Windows only; elsewhere the caller
// falls back to typing a path.
const PICKER = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = $env:UCCB_PICK_TITLE
$f.ShowNewFolderButton = $true
if ($env:UCCB_PICK_START) { $f.SelectedPath = $env:UCCB_PICK_START }
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($f.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($f.SelectedPath) }
`;

export async function POST(req: Request) {
  return handle(async () => {
    // On a server, a dialog would open on the server's own screen (if any).
    if (process.platform !== 'win32' || isHosted()) return Response.json({ path: '', unsupported: true });
    const { initial = '', title = 'Choose a folder' } = await jsonBody<{ initial?: string; title?: string }>(req).catch(() => ({} as { initial?: string; title?: string }));
    const picked = await new Promise<string>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-STA', '-Command', PICKER],
        { env: { ...process.env, UCCB_PICK_START: initial, UCCB_PICK_TITLE: title }, timeout: 600_000, windowsHide: true },
        (_err, stdout) => resolve((stdout ?? '').trim()),
      );
    });
    return Response.json({ path: picked });
  });
}
