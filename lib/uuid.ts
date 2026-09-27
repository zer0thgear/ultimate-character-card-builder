// A random v4 UUID. Browsers only offer crypto.randomUUID on secure pages
// (https, or localhost), and UCCB is also opened over plain http from other
// devices (a Tailscale address), so fall back to getRandomValues, which is
// available everywhere.
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function' && globalThis.isSecureContext !== false) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
