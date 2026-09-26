import type { NextConfig } from "next";

// UCCB runs as a local server (`npm run dev` / `npm start`): its API routes
// read and write card projects, gens and chats on disk, and proxy LLM calls.
// Don't deploy it anywhere public — the routes can read any folder you point
// the gen library at.
const nextConfig: NextConfig = {
  devIndicators: { position: 'bottom-left' },
  // sharp is a native module; keep it out of the server bundle.
  serverExternalPackages: ['sharp'],
};

export default nextConfig;
