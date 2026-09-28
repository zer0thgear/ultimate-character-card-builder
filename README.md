# Ultimate Character Card Builder

A workbench for roleplay character cards. Write the card, draw it, and chat with it to see how it plays, all in one window. The card sits on the left; image generation, your gens, a gen library and a test chat sit on the right, so the words and the art get worked on together.

- **A full card editor**: every V1/V2/V3 field, alternate and group greetings, lorebooks, find and replace, cleanup macros, undo/redo and autosave. Cards import and export as PNG, JSON or CHARX, and nothing another frontend stored is lost.
- **Art for the card**: NovelAI (the full generator: character prompts, positions, Img2Img, inpainting), A1111 / Forge, or ComfyUI (with its built-in workflow or your own). The writing assistant turns the card's description or a greeting into prompts.
- **A writing assistant** on every field, for greetings, lorebook entries, tags and a card review, plus a free-form Brainstorm chat. It can take other cards and pictures as references, and a vision model can write from a gen. Every prompt it sends can be viewed and edited.
- **A test chat** that builds the prompt the way SillyTavern does, SillyTavern chat-completion presets included, with personas, swipes, lorebook activation and a prompt inspector.
- **A gen library** that searches folders of old gens by prompt, model or seed, to reuse a prompt or pick an existing picture.
- **Works on a phone** over Tailscale, one screen at a time.

New here? **[Take the tour](docs/TOUR.md)**. For everything in detail, see the **[feature reference](docs/FEATURES.md)**.

## Running it

Needs [Node.js](https://nodejs.org) 20.9 or newer.

```bash
npm install
npm run dev
```

Then open <http://localhost:3210>. On Windows you can double-click **run.bat** instead, which installs what's needed the first time and opens the browser.

For a faster server: `npm run build` once, then `npm start`. Either way the app runs through `server.mjs`, which decides who may connect (see below). Set `PORT` to use another port.

## First run

Open **Settings** (⚙, top right):

1. **Image**: add where gens are made. NovelAI uses your persistent API key (`pst-…`, from General). **A1111 / Forge** (also reForge and SD.Next) needs to be started with `--api`. **ComfyUI** works with its built-in txt2img workflow, or one you export with Workflow → Export (API). The Image tab stays locked until there's one.
2. **LLM connections**: add a model for the test chat and the writing assistant. The choices are NovelAI, any OpenAI-compatible server (OpenRouter, KoboldCpp, llama.cpp, LM Studio, vLLM…) or Anthropic. Each job can use its own connection: chat, assistant, and a vision model for writing from pictures.
3. **Folders** (optional): an output folder for saved gens, and folders of old gens for the Library to browse.
4. **Personas** (optional): who you are in the test chat. They can be imported from SillyTavern.

Then make a card (**+ New card**), or import one: **Import**, or drop a PNG, JSON or CHARX file anywhere on the page.

## From your other devices

Install [Tailscale](https://tailscale.com) on this computer and on your phone or laptop, then open `http://<this computer's name>:3210`. The server prints the address when it starts. That works at home or away. For HTTPS, which browsers need for some features (copying to the clipboard, for one), run `tailscale serve --bg 3210` once and use the `https://….ts.net` address it gives you.

UCCB only accepts connections from this computer and your Tailscale devices; anything else on your network gets a page saying so. To let in other devices on your home network too, use Settings → General → **Also allow devices on the home network**. The check goes by the connection's real address, not a header, so it can't be faked.

## Privacy and where things are kept

Everything stays on this machine, under `data/` (which git ignores):

```
data/config.json                     output folder, library folders, home-network access
data/settings.json                   keys, connections, presets, generator and chat settings
data/projects/<id>/project.json      the card, its image prompts, notes
data/projects/<id>/avatar.png        the card's picture
data/projects/<id>/gallery/          gens kept with the card
data/projects/<id>/chats/            test chats
data/recent-gens/                    new gens, deleted after a set number of days
data/personas/                       chat personas and their pictures
data/trash/                          deleted cards (recover one by moving it back)
data/library-index.json, thumbs/     the gen library's cache (safe to delete)
```

Settings are shared by every device and address you open UCCB from; layout (theme, panel sizes, tabs) is kept per device. New gens are saved to `data/recent-gens` as they arrive, so a reload or a frozen phone tab doesn't lose them. They're cleaned up after 7 days by default (Settings → Folders). To hold on to one, keep it with its card or save it to the output folder.

API keys are only sent to the service they're for. NovelAI image requests go straight from the browser to NovelAI. A1111, ComfyUI and LLM requests go through UCCB's own server, which avoids browser CORS limits. **This is a local app**: anyone who can reach it can use your keys and read and change your cards, which is why it only lets in this computer and your Tailscale devices by default.

## Development

```bash
npm run typecheck
npm run lint
npm test
```

The tests cover `lib/`, the parts with no UI:
- card import and export (PNG chunks, V2/V3, CHARX, SillyTavern world files);
- lorebook activation, macros, and chat and preset prompt assembly;
- the assistant's prompts;
- the NovelAI request builder, presets and token counters;
- the A1111 and ComfyUI request builders;
- library search, and metadata parsing, including NovelAI's copy hidden in the alpha channel.

Built with Next.js, React, Zustand and Tailwind.

```
server.mjs          starts Next.js behind the connection check (scripts/access.mjs)
app/api/            the local server: cards, avatars, kept and recent gens, chats,
                    personas, settings, config, library, image backends, LLM proxy
components/         the shell, settings, and shared UI
components/editor/  the card editor tabs, field assistant and large editor
components/dock/    Image, Gallery, Library, Test chat, Brainstorm
lib/                card formats, prompts and macros, lorebook scanning, the
                    assistant, NovelAI's request builder and tokenizers, A1111
                    and ComfyUI requests, library search
lib/server/         disk storage, the library index, LLM and image backends
store/              Zustand stores: the card (with undo), generator settings and
                    image connections, recent gens, LLM connections, chats, UI
tests/              Vitest
```

### Local extensions

Features you'd rather not publish can live in a `local/` folder beside the app. Keep it out of git by adding `/local/` to `.git/info/exclude`, which stays on your machine, rather than to `.gitignore`, which is published. `local/client.tsx` default-exports a list of client extensions and `local/server.ts` a list of server ones (see `lib/extensions/types.ts`); either can be left out. An extension can add:
- actions on pictures (gens, kept gens, library images, the avatar);
- a section in Settings → Extensions;
- its own dialogs;
- an API under `/api/ext/<id>/`, with private storage in `data/ext/<id>/`.

Without the folder, the app runs as usual. Restart after adding or removing it.
