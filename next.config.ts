import type { NextConfig } from "next";
import { existsSync } from "node:fs";
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

const nextConfig: NextConfig = {
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
