// Who may connect to UCCB: this computer, and devices on your Tailscale
// network (and, if turned on in Settings, the local network too). Checked
// on the connection's real address, which, unlike a header, can't be faked.
// Plain JS so server.mjs can use it without a build step.

/** "::ffff:192.168.1.5" (IPv4 seen through an IPv6 socket) → "192.168.1.5". */
export function plainAddress(address) {
  const a = String(address ?? '').trim().toLowerCase();
  return a.startsWith('::ffff:') && a.includes('.') ? a.slice(7) : a;
}

const ipv4 = (a) => {
  const m = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m ? m.slice(1).map(Number) : null;
};

export function isLoopback(address) {
  const a = plainAddress(address);
  if (a === '::1') return true;
  const v4 = ipv4(a);
  return !!v4 && v4[0] === 127;
}

/** Tailscale hands out 100.64.0.0/10 (CGNAT space) and fd7a:115c:a1e0::/48. */
export function isTailscale(address) {
  const a = plainAddress(address);
  if (a.startsWith('fd7a:115c:a1e0:')) return true;
  const v4 = ipv4(a);
  return !!v4 && v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127;
}

/** Home-network addresses: 10/8, 172.16/12, 192.168/16, and IPv6 link-local / unique-local. */
export function isLocalNetwork(address) {
  const a = plainAddress(address);
  if (a.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(a)) return !isTailscale(a);
  const v4 = ipv4(a);
  if (!v4) return false;
  return v4[0] === 10 || (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) || (v4[0] === 192 && v4[1] === 168);
}

export function isAllowed(address, { allowLan = false } = {}) {
  return isLoopback(address) || isTailscale(address) || (allowLan && isLocalNetwork(address));
}
