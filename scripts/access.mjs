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

// Which names UCCB may be opened by. A web page you visit can't connect from
// another machine, but it can make your browser send requests here: either
// straight to localhost from its own page (cross-site requests), or by
// pointing its own domain at 127.0.0.1 once the page has loaded (DNS
// rebinding), which would let it read the responses, keys included. So the
// Host a request was sent to, and the Origin of the page that sent it, must
// be names only this machine, your tailnet or your home network can answer
// for: an IP address UCCB lets in, localhost, a bare machine name ("pc"),
// a Tailscale name (….ts.net), a .local name, or one listed in
// UCCB_ALLOWED_HOSTS (comma-separated).

/** "Name.example:3210" / "[::1]:3210" / "1.2.3.4" → "name.example" / "::1" / "1.2.3.4". */
export function hostName(host) {
  const h = String(host ?? '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') < 0 ? undefined : h.indexOf(']'));
  // A bare IPv6 address has several colons; "name:port" has one.
  return (h.split(':').length > 2 ? h : h.split(':')[0]).replace(/\.$/, '');
}

const isIpLiteral = (h) => !!ipv4(h) || h.includes(':');

/**
 * @param {string | undefined} host
 * @param {{ allowLan?: boolean, extra?: string[] }} [opts]
 */
export function isAllowedHost(host, { allowLan = false, extra = [] } = {}) {
  const h = hostName(host);
  if (!h) return false;
  if (isIpLiteral(h)) return isAllowed(h, { allowLan });
  if (extra.map(hostName).includes(h)) return true;
  if (!/^[a-z0-9_.-]+$/.test(h)) return false;
  return !h.includes('.') || h === 'localhost' || ['.localhost', '.ts.net', '.local'].some((end) => h.endsWith(end));
}

/**
 * Whether a request may go through, judged by its Host and, for anything
 * that can change things (not GET/HEAD/OPTIONS), the page it came from.
 * Returns null if it may, or why not.
 * @param {{ method?: string, host?: string, origin?: string, fetchSite?: string }} req
 * @param {{ allowLan?: boolean, extra?: string[] }} [opts]
 */
export function refuseRequest({ method = 'GET', host, origin, fetchSite }, opts = {}) {
  if (!isAllowedHost(host, opts)) return 'host';
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())) return null;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      /* "null" and other opaque origins */
    }
    return originHost && isAllowedHost(originHost, opts) ? null : 'origin';
  }
  // No Origin (older browsers, curl): the browser's own label still says where it came from.
  return fetchSite === 'cross-site' ? 'origin' : null;
}
