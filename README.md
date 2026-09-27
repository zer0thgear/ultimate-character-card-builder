# Ultimate Character Card Builder

Write a character card, draw it with NovelAI, and chat with it to test it, all in one window. The card text sits on the left; image generation, your gens, your old gen library and a test chat sit on the right, so the words and the art are worked on together instead of in three different apps.

It brings together three earlier projects:

- **tavern-card-editor**: the card editor itself (every V1/V2/V3 field, alternate and group greetings with drag-to-reorder and promote, lorebooks with name/comment sync, find/replace and asterisk macros, autosave), now with undo/redo.
- **NovelFrontEnd**: its NovelAI image code is reused as-is (request builder, presets, token counters, tag autocomplete, emphasis keys, metadata reader), so gens match novelai.net's exactly.
- **GenBrowser**: a built-in browser over any folders of old gens (GenBrowser's `library/` included), with the same search syntax, for inspiration or picking an existing picture.

See [`docs/FEATURES.md`](docs/FEATURES.md) for the full tour.

## Running it

Needs [Node.js](https://nodejs.org) 20+.

Double-click **run.bat**, or:

```bash
npm install
npm run dev
```

Then open <http://localhost:3210>. For a faster production server: `npm run build` once, then `npm start`. Both run `server.mjs`, which starts Next.js behind a check on who's connecting (see below).

### From your other devices

Install [Tailscale](https://tailscale.com) on this computer and your phone or laptop, and open `http://<this computer's name>:3210` (MagicDNS; the server prints the name when it starts), at home or away. For HTTPS, which the browser needs for things like the Copy buttons, run `tailscale serve --bg 3210` once and use the `https://…ts.net` address it gives.

UCCB only accepts connections from this computer and your Tailscale devices; other devices on the Wi-Fi get a page saying so. Settings → General → **Also allow devices on the home network** lets them in too. The check is on the connection's real address, not a header, so it can't be faked.

Your settings (NovelAI key, LLM connections, presets, models, chat and assistant settings) are kept on this computer and shared by every device and address you open UCCB at. Layout (theme, panels, tabs) stays per device.

In **Settings** (⚙, top right):

1. **General**: your NovelAI persistent API key (`pst-…`), used for images, tag suggestions and NovelAI's text models.
2. **Folders**: an output folder for saved gens (optional), and the folders the Library browses.
3. **LLM connections**: add NovelAI, any OpenAI-compatible server (OpenRouter, KoboldCpp, llama.cpp, LM Studio…) or Anthropic, and choose which one the test chat and the writing assistant use.

## Where things are kept

Everything is on this machine, under `data/` (gitignored):

```
data/config.json                     output folder, library folders, home-network access
data/settings.json                   keys, connections, presets, gen/chat settings (shared by your devices)
data/projects/<id>/project.json      the card, its image prompts, notes
data/projects/<id>/avatar.png        the card's picture
data/projects/<id>/gallery/          gens you kept with the card
data/projects/<id>/chats/            test chats
data/personas/                       your chat personas and their pictures
data/trash/                          deleted cards (recover by moving them back)
data/library-index.json, thumbs/     the gen library's cache (safe to delete)
```

New gens go to `data/recent-gens` as they arrive, so a reload or a frozen phone tab doesn't lose them and every device sees them, and they're deleted after a number of days you choose (Settings → Folders; 7 by default). To keep one for good, **keep** it with a card or **save** it to the output folder (or turn on auto-save). The page only warns before closing while a gen is still uploading.

API keys are kept on this computer, in data/settings.json. NovelAI image calls go straight from the browser to NovelAI, as in NovelFrontEnd; LLM calls go through UCCB's local server (which avoids CORS problems) and on to the provider. **This is a local app**: anyone who can reach it can use your keys, read and change your cards, and see the library folders, which is why it only lets in this computer and your Tailscale devices unless you allow the home network.

## Development

```bash
npm run typecheck && npm run lint && npm test
```

The tests cover `lib/`: card import/export (PNG chunks, V2/V3, CHARX, SillyTavern world files), lorebook activation, macros, prompt assembly, library search, metadata parsing (including NovelAI's alpha-channel copy), the text tools, and NovelFrontEnd's suite for the NovelAI code.

### Layout

```
app/api/            local server: projects, avatar, kept gens, chats, config,
                    gen saving, library scan/search/thumbs, LLM proxy, folder picker
components/editor/  the card editor tabs, field assistant and focus editor
components/dock/    Image, Gallery, Library, Test chat, Brainstorm
lib/                card spec and files, prompts, lorebook scanning, macros,
                    library search, assistant prompts, NovelAI (ported)
lib/server/         disk storage, library index, LLM providers
store/              Zustand stores (project + undo, gen settings, recent gens,
                    LLM connections, chats, UI)
```
