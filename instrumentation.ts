// Runs once when the server starts: keeps the dynamic-DNS name (if one is
// set up in Settings → Other devices) pointing at this machine's address.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startDdnsLoop } = await import('./lib/server/network');
    startDdnsLoop();
  }
}
