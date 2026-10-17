# Hosting UCCB on a server

UCCB is made to run on your own computer and reach your other devices over Tailscale (see the README). It can also run on a server (a VPS) and be opened from anywhere at an address like `https://uccb.example.com`, behind a sign-in. This page shows how to do that with a Cloudflare Tunnel.

## What's different on a server

- **There's a sign-in in front of everything.** You can use UCCB's own password, Cloudflare Access, or both (both is best). With `UCCB_HOSTED=1`, UCCB won't start without at least one of them. Without a sign-in, anyone who found the address could use your API keys and read and change your cards.
- **It's still one person's UCCB.** Everyone who signs in shares the same cards, chats, settings and keys. The sign-in keeps other people out; it doesn't give each person their own UCCB.
- **The server makes the calls, so backends on your home PC are out of reach.** LLM requests, A1111 and ComfyUI requests go through UCCB's server. A connection pointing at `localhost` or a home-network address (KoboldCpp, text-generation-webui, a local ComfyUI…) won't work from a VPS. Hosted services (OpenRouter, NovelAI, Anthropic, OpenAI-compatible APIs) work as usual. NovelAI images go straight from your browser and work too.
- **Folders in Settings → Folders are on the server**, inside the data folder's `files` folder. Type a name like `gens` and it goes to `data/files/gens`. Anything outside that folder is refused, so a signed-in browser can't read or write the rest of the server. The folder picker isn't available.
- **"Who can connect" goes away from Settings → General.** The address check that lets in this computer and Tailscale devices is off; the sign-in does that job instead. UCCB listens on `127.0.0.1` only, so only the tunnel on the same machine reaches it.

## 1. Install

You need Node.js 22 or newer, and git.

```bash
git clone https://github.com/zer0thgear/ultimate-character-card-builder.git uccb
cd uccb
npm ci
npm run build
```

To bring your cards and settings along, copy your `data` folder from your computer into `uccb/data` (or wherever `UCCB_DATA_DIR` points). It holds everything: cards, chats, presets, connections and their keys. Stop UCCB on your computer first, so nothing is half-written.

## 2. A password

```bash
npm run hash-password
```

Type the password twice. The command prints a line like `UCCB_PASSWORD_HASH=scrypt:16384:8:1:…`, which goes into the settings file in step 5. The password itself isn't stored anywhere. Signing in keeps a device signed in for 30 days. Changing the password signs every device out.

After 10 wrong passwords in 15 minutes from one address, that address has to wait. Behind a Cloudflare Tunnel, the address is the visitor's real one (Cloudflare's `CF-Connecting-IP`).

## 3. A Cloudflare Tunnel

The tunnel gives the server an HTTPS address on your domain without opening any ports. You need a domain on Cloudflare.

The quickest way is from the dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**. Name it and run the install command it shows on the server, then add a **public hostname**: `uccb.example.com`, service **HTTP**, URL `localhost:3210`.

Or from the command line on the server:

```bash
cloudflared tunnel login
cloudflared tunnel create uccb
cloudflared tunnel route dns uccb uccb.example.com
```

Then write `~/.cloudflared/config.yml`:

```yaml
tunnel: uccb
credentials-file: /home/you/.cloudflared/<tunnel id>.json
ingress:
  - hostname: uccb.example.com
    service: http://localhost:3210
  - service: http_status:404
```

and run it as a service with `sudo cloudflared service install`.

## 4. Cloudflare Access (recommended)

Access puts Cloudflare's own sign-in in front of the address (a code sent to your email, or Google or GitHub), so nobody else's requests even reach the server. UCCB checks every request's Access token itself too, so a misconfigured route can't skip it.

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. **Application domain:** `uccb.example.com`.
3. **Policy:** Allow, with an **Include** rule of **Emails** set to your own address (and anyone else's you'd let in).
4. Save it, then open the application again. On its **Overview** (or **Basic information**) tab, copy the **Application Audience (AUD) Tag**.
5. Your **team name** is the first part of your team domain, `<team>.cloudflareaccess.com`, under **Zero Trust → Settings → Custom Pages** (or **Team domain**).

To sign out of Access, open `https://uccb.example.com/cdn-cgi/access/logout`.

## 5. The settings

Put them in a file only you can read, say `/etc/uccb.env`:

```bash
UCCB_HOSTED=1
PORT=3210
UCCB_DATA_DIR=/home/you/uccb/data
UCCB_ALLOWED_HOSTS=uccb.example.com
UCCB_PASSWORD_HASH=scrypt:16384:8:1:…
UCCB_ACCESS_TEAM=yourteam
UCCB_ACCESS_AUD=…the AUD tag…
```

| Setting | What it does |
| --- | --- |
| `UCCB_HOSTED` | `1`: running on a server. A sign-in is required, UCCB listens on `127.0.0.1` only, the address check is off, and folders stay inside `data/files`. |
| `UCCB_ALLOWED_HOSTS` | The address you open UCCB by (several can be separated by commas). Other names are turned away, which stops other websites from reaching UCCB through your browser. |
| `UCCB_PASSWORD_HASH` | UCCB's own password, as `npm run hash-password` prints it. |
| `UCCB_PASSWORD` | The password itself, instead of its hash. Handy for a quick test; prefer the hash. |
| `UCCB_ACCESS_TEAM` | Your Cloudflare Access team name (or its `….cloudflareaccess.com` domain). |
| `UCCB_ACCESS_AUD` | The Access application's AUD tag (several can be separated by commas). Both Access settings are needed for the Access check. |
| `UCCB_SESSION_SECRET` | What sign-in cookies are signed with. Without it, UCCB makes one and keeps it in `data/.session-secret`. |
| `UCCB_BIND` | The address to listen on. Hosted, it's `127.0.0.1` unless this says otherwise (for example, inside a container whose tunnel runs in another container). |
| `UCCB_DATA_DIR` | Where UCCB keeps everything. Default: `data` in the folder it runs from. |
| `PORT` | Default `3210`. |

The password and Access settings also work without `UCCB_HOSTED`, for example to put a password on UCCB at home.

## 6. Run it as a service

`/etc/systemd/system/uccb.service`:

```ini
[Unit]
Description=Ultimate Character Card Builder
After=network.target

[Service]
User=you
WorkingDirectory=/home/you/uccb
EnvironmentFile=/etc/uccb.env
ExecStart=/usr/bin/node server.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo chmod 600 /etc/uccb.env
sudo systemctl daemon-reload
sudo systemctl enable --now uccb
journalctl -u uccb -f
```

The log's first line says how it's signing people in. Open `https://uccb.example.com`, sign in to Access and then with your password, and you're in. To sign out of UCCB's password on a device, use **Settings → General → Sign out on this device**.

## Keeping it going

- **Updating:** `git pull`, `npm ci`, `npm run build`, then `sudo systemctl restart uccb`.
- **Backups:** everything is in the data folder. Copy it somewhere else now and then, for example with a nightly `tar` or `rsync` from cron.
- **Long replies:** Cloudflare closes a response that sends nothing for about 100 seconds. While a model thinks quietly, UCCB sends an empty line every 15 seconds to keep the reply open.
- **Uploads:** Cloudflare's free plan accepts requests up to 100 MB, which is plenty for cards, pictures and chats.
