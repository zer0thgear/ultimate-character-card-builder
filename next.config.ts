import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// UCCB runs as a local server (`npm run dev` / `npm start`): its API routes
// read and write card projects, gens and chats on disk, and proxy LLM calls.
// Don't deploy it anywhere public — the routes can read any folder you point
// the gen library at.

// Local extensions (lib/extensions/types.ts): local/client.tsx and
// local/server.ts when there's a local folder, empty stand-ins when not.
// Adding or removing the folder needs a restart.
const pick = (file: string, fallback: string) => (existsSync(path.join(process.cwd(), file)) ? `./${file}` : `./${fallback}`);
const extensions = {
  "@local/client": pick("local/client.tsx", "lib/extensions/fallback/client.ts"),
  "@local/server": pick("local/server.ts", "lib/extensions/fallback/server.ts"),
};

// In development, Next.js only serves its dev resources (hot reload) to
// pages opened at localhost unless told otherwise. Opening UCCB by this
// computer's name or address (from a phone over Tailscale, say) is the
// same app, so those are allowed: the hostname, its Tailscale name (which
// can differ, and its full *.ts.net form, as `tailscale serve` gives it),
// and every address this machine has. Who may connect at all is still
// server.mjs's check.
function tailscaleNames(): string[] {
  try {
    const status = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }));
    const full = String(status?.Self?.DNSName ?? "").replace(/\.$/, "").toLowerCase();
    return full ? [full, full.split(".")[0]] : [];
  } catch {
    return []; // no Tailscale here
  }
}
const host = os.hostname().toLowerCase();
const ownOrigins = [
  host,
  `${host}.*.ts.net`,
  ...tailscaleNames(),
  ...Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && !a.internal)
    .map((a) => (a.family === "IPv6" ? `[${a.address.split("%")[0]}]` : a.address)),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ownOrigins,
  // Off: in the phone layout it sat on the bottom bar. Errors still show.
  devIndicators: false,
  // sharp is a native module; keep it out of the server bundle.
  serverExternalPackages: ['sharp'],
  // A second copy (for testing beside a running one) builds elsewhere.
  distDir: process.env.UCCB_DIST_DIR || ".next",
  turbopack: { resolveAlias: extensions },
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, ...Object.fromEntries(Object.entries(extensions).map(([k, v]) => [k, path.resolve(v)])) };
    return config;
  },
};

export default nextConfig;
