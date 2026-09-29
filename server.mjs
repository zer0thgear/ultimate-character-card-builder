// UCCB's server: Next.js, behind a check on who's connecting. Only this
// computer and your Tailscale devices get in (plus the local network, if
// "Allow devices on the home network" is on in Settings → General). The
// check uses the connection's real address; other devices on the Wi-Fi get
// a 403 page saying why.
//
//   node server.mjs          production (after `next build`)
//   node server.mjs --dev    development, with hot reload

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAllowed, isTailscale, plainAddress } from './scripts/access.mjs';

const dev = process.argv.includes('--dev');
// Set before Next loads, which reads it as it starts.
process.env.NODE_ENV ??= dev ? 'development' : 'production';
const { default: next } = await import('next');
const port = Number(process.env.PORT) || 3210;
const dataDir = path.resolve(process.env.UCCB_DATA_DIR ?? path.join(process.cwd(), 'data'));

// The home-network switch lives in data/config.json; read it at most every
// few seconds, so turning it on or off takes effect without a restart.
let lanCache = { at: 0, allow: false };
function allowLan() {
  if (Date.now() - lanCache.at > 3000) {
    let allow = false;
    try {
      allow = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf8')).allowLan === true;
    } catch {
      /* no config yet: off */
    }
    lanCache = { at: Date.now(), allow };
  }
  return lanCache.allow;
}

const refused = new Set();
function allowed(socket) {
  const address = plainAddress(socket.remoteAddress);
  if (isAllowed(address, { allowLan: allowLan() })) return true;
  if (!refused.has(address)) {
    refused.add(address);
    console.log(`Refused a connection from ${address} (not this computer or a Tailscale device).`);
  }
  return false;
}

const DENIED = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UCCB</title><body style="font-family:system-ui;background:#020617;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:28rem;padding:1.5rem;line-height:1.5"><h1 style="font-size:1.2rem">UCCB isn't open to this device</h1>
<p>It only accepts connections from its own computer and from devices on its owner's Tailscale network.</p>
<p style="color:#94a3b8;font-size:.9rem">If this is your device, connect it to Tailscale and open UCCB by the computer's Tailscale name, or turn on "Allow devices on the home network" in UCCB's Settings on that computer.</p></div>`;

const app = next({ dev, turbopack: dev, hostname: 'localhost', port });
await app.prepare();
const handle = app.getRequestHandler();
const upgrade = app.getUpgradeHandler();

const server = createServer((req, res) => {
  if (!allowed(req.socket)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(DENIED);
    return;
  }
  void handle(req, res);
});
// Hot reload's websocket (dev) goes through the same check.
server.on('upgrade', (req, socket, head) => {
  if (!allowed(req.socket)) return socket.destroy();
  void upgrade(req, socket, head);
});

server.listen(port, () => {
  const tailscale = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && isTailscale(a.address))
    .map((a) => a.address);
  console.log(`UCCB ${dev ? '(dev) ' : ''}running at http://localhost:${port}`);
  // The machine's Tailscale name can differ from its hostname.
  let name = os.hostname().toLowerCase();
  try {
    name = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })).Self.DNSName.split('.')[0] || name;
  } catch {
    /* no Tailscale CLI: the hostname is the best guess */
  }
  if (tailscale.length) console.log(`  From your Tailscale devices: http://${name}:${port} (or http://${tailscale[0]}:${port})`);
  console.log(`  Other devices: ${allowLan() ? 'home network allowed too' : 'Tailscale only (home network off in Settings)'}`);
});
