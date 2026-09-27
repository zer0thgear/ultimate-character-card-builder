'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from '@/store/uiStore';
import { api, type NetworkStatus } from '@/lib/api';
import { Button, cx, inputClass } from '@/components/ui';

// Settings → Other devices: opening UCCB from a phone or another computer
// on the same network, by its LAN address (with a QR code) or by a
// dynamic-DNS name UCCB keeps pointed at that address.

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: '#0f172a', light: '#ffffff' } }).then((url) => live && setSrc(url), () => {});
    return () => {
      live = false;
    };
  }, [text]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={`QR code for ${text}`} className="h-36 w-36 rounded bg-white p-1" /> : <div className="h-36 w-36 rounded bg-slate-800" />;
}

function Address({ url, note }: { url: string; note?: string }) {
  return (
    <div className="flex items-center gap-4 rounded-md border border-slate-800 p-3">
      <Qr text={url} />
      <div className="flex min-w-0 flex-col gap-2">
        <code className="text-base break-all text-violet-200">{url}</code>
        {note && <span className="text-xs text-slate-500">{note}</span>}
        <Button size="sm" className="self-start" onClick={() => void navigator.clipboard.writeText(url).then(() => toast('Copied.', 'success'))}>
          Copy
        </Button>
      </div>
    </div>
  );
}

const ago = (t?: number) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString();
};

export function NetworkTab() {
  const [s, setS] = useState<NetworkStatus | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [provider, setProvider] = useState<'off' | 'duckdns' | 'custom'>('off');
  const [domain, setDomain] = useState('');
  const [token, setToken] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: NetworkStatus) => {
    setS(next);
    setProvider(next.ddns.provider);
    setDomain(next.ddns.domain);
    setCustomUrl(next.ddns.customUrl);
    setHostname(next.ddns.provider === 'custom' ? next.ddns.hostname : '');
  }, []);

  useEffect(() => {
    api.network().then(show, (err: Error) => toast(err.message, 'error'));
  }, [show]);

  if (!s) return <p className="text-sm text-slate-500">Looking up this computer&apos;s addresses…</p>;

  const lanUrl = s.primary ? `http://${s.primary}:${s.port}` : null;
  const d = s.ddns;
  const nameUrl = d.hostname ? `http://${d.hostname}:${s.port}` : null;
  const others = s.addresses.filter((a) => a.address !== s.primary && (showAll || !a.virtual));

  const save = async () => {
    setBusy(true);
    try {
      show(await api.saveNetwork({ provider, domain, token, customUrl, hostname }));
      setToken('');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const updateNow = async () => {
    setBusy(true);
    try {
      show(await api.updateNetwork());
    } finally {
      setBusy(false);
    }
  };

  const resolved = d.resolvesTo;
  const matches = !!resolved && resolved === s.primary;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-200">On this network</h3>
        <p className="text-xs text-slate-500">
          Open this on a phone or another computer on the same Wi-Fi (scan the code). It changes if the router gives this computer a new address; the name below doesn&apos;t.
        </p>
        {lanUrl ? <Address url={lanUrl} note="This computer's address on the network, right now." /> : <p className="text-sm text-amber-300">This computer doesn&apos;t seem to be on a local network.</p>}
        {others.length > 0 && (
          <div className="text-xs text-slate-500">
            Also reachable at: {others.map((a) => `${a.address} (${a.name})`).join(', ')}
          </div>
        )}
        {s.addresses.some((a) => a.virtual) && (
          <button type="button" className="self-start text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Hide' : 'Show'} virtual adapters (VMs, VPNs)
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-200">A name that follows the address</h3>
        <p className="text-xs text-slate-500">
          A free dynamic-DNS name, kept pointing at this computer&apos;s address on your network: UCCB checks every few minutes and updates it when the address changes. It points at a private address, which only devices on the same network can reach, so it opens nothing to the internet. No router settings needed.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['off', 'Off'],
              ['duckdns', 'DuckDNS (free)'],
              ['custom', 'Another provider'],
            ] as const
          ).map(([v, label]) => (
            <Button key={v} size="sm" variant={provider === v ? 'primary' : 'secondary'} onClick={() => setProvider(v)}>
              {label}
            </Button>
          ))}
        </div>

        {provider === 'duckdns' && (
          <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-3">
            <ol className="list-decimal pl-5 text-xs text-slate-400">
              <li>
                Sign in at{' '}
                <a href="https://www.duckdns.org" target="_blank" rel="noreferrer" className="text-violet-300 underline">
                  duckdns.org
                </a>{' '}
                (with Google, GitHub, etc.).
              </li>
              <li>Add a sub domain, e.g. &quot;my-uccb&quot;. Leave its IP as it is; UCCB sets it.</li>
              <li>Copy the token shown at the top of the page, and paste both here.</li>
            </ol>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Sub domain
                <div className="flex items-center gap-1">
                  <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="my-uccb" className={inputClass} />
                  <span className="text-slate-500">.duckdns.org</span>
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Token
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={d.hasToken ? 'saved (leave blank to keep it)' : 'paste your token'} className={inputClass} autoComplete="off" />
              </label>
            </div>
          </div>
        )}
        {provider === 'custom' && (
          <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-3">
            <p className="text-xs text-slate-400">
              Any provider with an update link (Dynu, FreeDNS, No-IP…). Put <code className="text-slate-200">{'{ip}'}</code> where the address goes; UCCB opens the link whenever the address changes.
            </p>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Update URL
              <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://provider.example/update?hostname=me&myip={ip}&password=…" className={cx(inputClass, 'font-mono text-xs')} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              The name it sets
              <input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="me.example.net" className={inputClass} />
            </label>
          </div>
        )}
        {(provider !== d.provider || provider !== 'off') && (
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Updating…' : provider === 'off' ? 'Turn off' : 'Save and update'}
            </Button>
            {d.provider !== 'off' && provider === d.provider && (
              <Button disabled={busy} onClick={() => void updateNow()}>
                Update now
              </Button>
            )}
          </div>
        )}

        {d.provider !== 'off' && (
          <div className="flex flex-col gap-2">
            <div className={cx('rounded-md px-3 py-2 text-xs', d.lastResult === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : d.lastResult ? 'bg-red-500/10 text-red-300' : 'bg-slate-800 text-slate-400')}>
              {d.lastResult === 'ok' ? `Pointing at ${d.lastIp}, updated ${ago(d.lastUpdated)}.` : (d.lastResult ?? 'Not updated yet.')}
            </div>
            {nameUrl && d.lastResult === 'ok' && (
              <>
                <Address url={nameUrl} note="Bookmark this on your phone: it keeps working when the address changes." />
                <div className={cx('rounded-md px-3 py-2 text-xs', matches ? 'text-slate-500' : 'bg-amber-500/10 text-amber-200')}>
                  {matches ? (
                    <>From this computer, {d.hostname} finds {resolved}. </>
                  ) : resolved ? (
                    <>From this computer, {d.hostname} still finds {resolved}; DNS can take a few minutes to catch up. </>
                  ) : (
                    <>
                      From this computer, {d.hostname} doesn&apos;t resolve. That&apos;s usually the router refusing names that point at local addresses (&quot;rebind protection&quot;).{' '}
                    </>
                  )}
                  If the phone can&apos;t open it, set the phone&apos;s own DNS: Android Settings → Network → <b>Private DNS</b> → &quot;dns.google&quot; (or &quot;one.one.one.one&quot;). That skips the router&apos;s DNS, with no router access needed.
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1.5 text-xs text-slate-500">
        <h3 className="text-sm font-semibold text-slate-200">If another device can&apos;t connect</h3>
        <p>
          • Windows asks the first time whether to let Node.js through the firewall: allow it on <b>private</b> networks. If you missed it, Windows Security → Firewall → Allow an app → Node.js → Private.
        </p>
        <p>• Windows has to see this Wi-Fi as a private network (Settings → Network → your connection → Private).</p>
        <p>
          • Anyone on this network can open UCCB and read or change your cards, chats and personas. API keys stay in each device&apos;s own browser, so another device can&apos;t use yours. On a network you don&apos;t trust, keep UCCB to this computer.
        </p>
      </section>
    </div>
  );
}
