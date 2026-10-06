# Extension packs

An extension pack changes what UCCB asks the model, adds choices to its wizards, and can add UI of its own (tabs, buttons, dialogs) with code, without changing UCCB itself. A pack is one JSON file (`<id>.uccb.json`). Uninstalling it takes away everything it added.

A pack without code only adds text and choices. A pack with code runs it in a **sandbox**: it never sees your API keys or anything else in UCCB, except what the permissions you approve let it ask for (see [UI and code](#ui-and-code)).

Install, turn on or off, export and uninstall packs in **Settings → Extensions**. Packs are kept in `data/packs/`, so every device that opens this UCCB has the same ones.

Examples: [`docs/extensions/noir.uccb.json`](extensions/noir.uccb.json) (prompts and choices) and [`docs/extensions/name-ideas.uccb.json`](extensions/name-ideas.uccb.json) (a dock tab and a field button, with code).

## How packs fit with your own edits

For every prompt, UCCB uses the first of these it finds:

1. **Your edit** (Settings → Assistant → Prompts, or ⚙ Actors in Adventure mode).
2. **An enabled pack's version.** When two packs change the same prompt, the one installed later wins, and Settings → Extensions says they overlap.
3. **The built-in prompt.**

Nothing a pack adds is copied into your settings. So turning a pack off, or uninstalling it, puts things back the way they were, and your own edits stay on top the whole time. In the prompt editor, a prompt a pack changes shows **🧩 pack name**, and **↺ Default** goes back to the pack's wording.

Some things are only offered as starting points: Adventure actors and rule examples. Once you add one, it's yours and stays after the pack is gone.

## The file

```json
{
  "uccb": 1,
  "id": "noir",
  "name": "Noir",
  "version": "1.0.0",
  "author": "you",
  "description": "What it does, in a sentence.",
  "homepage": "https://example.com/noir",
  "contributes": { }
}
```

| Field | |
|---|---|
| `uccb` | The pack format. Always `1` for now. Required. |
| `permissions`, `network`, `ui`, `files` | Code and UI: see [UI and code](#ui-and-code). |
| `id` | Up to 64 letters, digits, `-` and `_`. Installing a pack whose id is already installed updates that pack. Required. |
| `name` | Shown in Settings → Extensions and on everything the pack adds. Required. |
| `version` | Any text. Shown when you update (`1.0.0` if left out). |
| `author`, `description`, `homepage` | Optional. `homepage` must be an `http(s)` link. |
| `contributes` | What the pack adds. All of its sections are optional. |

UCCB checks a pack when it's installed. It keeps what it understands and lists what it left out, such as an unknown prompt key or an actor with no prompt. A pack can be at most 5 MB, each text at most 50,000 characters, and each list at most 100 items.

## `contributes`

### `templates`: the writing assistant's prompts

These replace the built-in prompts by key. Every prompt in Settings → Assistant → Prompts shows its key next to its name, along with the `{{placeholders}}` it's filled with. The placeholders work the same in a pack. A paragraph whose placeholder comes out empty is left out, and `{{char}}` and `{{user}}` are sent as written.

```json
"templates": {
  "field.system": "You are an expert character card writer…",
  "loreWizard.planner": "…"
}
```

| Keys | Job |
|---|---|
| `field.system`, `field.user`, `field.reply`, `field.rewrite`, `field.draft`, `field.draftNotes`, `field.expand`, `field.shorten`, `field.polish`, `field.continue` | ✨ on any field |
| `greeting.system`, `greeting.user` | ✨ New greeting |
| `lorebook.system`, `lorebook.user` | ✨ Lorebook entry |
| `loreWizard.planner`, `loreWizard.plan`, `loreWizard.review`, `loreWizard.revise`, `loreWizard.writer`, `loreWizard.write` | 🧙 Lorebook wizard |
| `tags.system`, `tags.user` | ✨ Card tags |
| `review.system`, `review.user` | ✨ Card review |
| `appearance.system`, `appearance.user`, `entryAppearance.user` | Character prompts (art) |
| `scene.system`, `scene.user`, `cast.user` | Scene prompts (art) |
| `vision.system`, `vision.appearance`, `vision.greeting`, `vision.ask` | Write from an image |
| `references.user`, `references.art` | References |
| `brainstorm.system` | Brainstorm |

Keep reply formats the app reads back as they are. Examples are the lorebook entry's `NAME:` / `KEYS:` / `CONTENT:` lines and the lorebook wizard's JSON. Each prompt's note in Settings says when this applies.

### `adventurePrompts`: Adventure mode's actors

These work the same way, for the prompts in ⚙ Actors: `director`, `opening`, `narrator`, `cast` and `scout`. Keep the Director's `{{format}}` and the Scout's JSON so the app can read the replies.

### `loreWizard`: more choices in the lorebook wizard

```json
"loreWizard": {
  "focus": ["Precincts & beats", "Informants"],
  "sizes": [{ "id": "city", "label": "A whole city", "count": 45 }],
  "lengths": [{ "id": "case-file", "label": "Case file", "text": "about 40 to 70 words, in the clipped style of a police case file" }]
}
```

- `focus`: extra chips under **Focus on**.
- `sizes`: extra choices for **How many entries**. `count` (1 to 200) is how many entries the Planner is asked for.
- `lengths`: extra choices for **Entry length**. `text` is what the Writer is told about length.

A wizard session that used a pack's size or length falls back to the built-in medium once the pack is gone.

### `adventureActors`: actors to start from

These are offered under ⚙ Actors → **Start from**, marked 🧩. The fields are the same as an actor's in ⚙ Actors.

```json
"adventureActors": [{
  "name": "Snitch",
  "icon": "🐀",
  "about": "What it is, for the Director",
  "prompt": "Its system prompt. Macros work.",
  "brief": "What the Director tells it (empty: it runs every turn)",
  "when": "after",
  "private": false
}]
```

`name` and `prompt` are required. `when` is `"before"` or `"after"` the turn's beats (after if left out).

### `ruleExamples`: rules to start from

These are offered in 🌍 World → Rules → **Start from**: `[{ "label": "Heat", "text": "…" }]`.

## UI and code

A pack can add UI of its own. Each piece is an HTML page from the pack's `files`, shown where its `slot` says:

```json
{
  "uccb": 1,
  "id": "name-ideas",
  "name": "Name ideas",
  "permissions": ["card:read", "card:write", "llm"],
  "network": [],
  "ui": [
    { "id": "names", "slot": "dockTab", "label": "Names", "icon": "🏷", "entry": "names.html" },
    { "id": "stats", "slot": "fieldAction", "label": "Field stats", "icon": "📊", "entry": "stats.html", "fields": ["description", "first_mes"] }
  ],
  "files": {
    "names.html": "<button id=go>Suggest</button><script src=\"names.js\"></script>",
    "names.js": "document.getElementById('go').onclick = async () => { … }"
  },
  "contributes": {}
}
```

| Slot | Where it shows |
|---|---|
| `dockTab` | A tab in the dock (right side), filling it. Not on phones yet. |
| `editorTab` | A tab in the card editor. |
| `fieldAction` | A button (its `icon`) on the card's text fields, opening a dialog. `fields` limits it to some fields by path (`description`, `first_mes`, `alternate_greetings`…; a prefix covers the fields under it), and leaving it out means every text field. The dialog gets the field in `uccb.context.field`. |
| `command` | A button in the header, opening a dialog. |
| `brainstormWizard` | A button (its `icon` and `label`) in the ✨ Brainstorm tab. The wizard takes the tab's place until **← Brainstorm**, and keeps its place while you're back in the chat. Good for a guided process: steps that ask, call `uccb.llm.complete` and write the card with `uccb.card.setFields`. |
| `dialog` | A dialog the pack opens itself with `uccb.ui.openDialog(id, data)`; it gets `data` in `uccb.context.data`. |
| `settings` | A section under the pack in Settings → Extensions. |

`ui` ids are letters, digits, `-` and `_`. `files` are text: HTML, JavaScript and CSS. `<script src="x.js">` and `<link rel="stylesheet" href="x.css">` that name one of the pack's files are put inline; nothing else is loaded.

### The sandbox

Each page runs in a frame with `sandbox="allow-scripts"` and no same-origin access, so:

- It can't read UCCB's page, storage or cookies.
- It can't call UCCB's own API. The browser blocks it, and UCCB refuses requests from sandboxed pages.
- Its Content-Security-Policy allows no network at all, unless the pack lists hosts in `network` (`"api.example.com"`, `"*.example.com"`; https only).
- If it tries to load another page in its frame, UCCB stops it.

Installing a pack with code shows what it adds and what it may do, and you choose **Install with its code** or **Without its code** (its prompts and choices only). **Stop its code** / **Run its code…** in Settings → Extensions changes that later. An update that asks for more permissions or hosts asks again.

Be honest with yourself about one thing. The sandbox keeps your keys and the rest of UCCB away from the code, but anything you let it read (the card, say) it could send to a host it lists in `network`. A determined page could also leak it by navigating its frame away; UCCB stops the page when that happens, but the request has already gone. So only grant `card:read` to code you trust, especially alongside `network`.

### `uccb`: the API

Every page gets a `uccb` object. Calls return promises; a call without its permission fails with a message saying which permission it needs.

| Call | Permission | |
|---|---|---|
| `uccb.context` | | `{ pack, ui, granted, theme, field?, data? }` |
| `uccb.card.get()` | `card:read` | `{ id, data }` for the open card (the V3 card data), or `null` |
| `uccb.card.onChange(fn)` | `card:read` | Called when the card changes |
| `uccb.card.setFields({ path: value })` | `card:write` | Sets text fields by path (`description`, `first_mes`, `alternate_greetings.0`, `character_book.entries.2.content`…), `name`, `nickname`, `creator`, `character_version`, and the lists `tags` and `alternate_greetings`. It's one edit: undo, version history and lorebook sync work as for your own edits. |
| `uccb.lorebooks.list()` | `lorebooks:read` | The books in 📖 Lorebooks: `[{ id, name, book }]` |
| `uccb.lorebooks.add(book)` | `lorebooks:write` | Adds a lorebook (character_book format); returns `{ id }` |
| `uccb.llm.complete(messages, { label })` | `llm` | Sends `[{ role, content }]` to the writing assistant's connection; returns `{ text }`. Your keys are never shown to the page, and each request appears in Settings → Assistant → Recent requests. |
| `uccb.storage.get(key)` / `.set(key, value)` | | The pack's own data (JSON, up to 1 MB in all), kept on the server until it's uninstalled |
| `uccb.ui.toast(text, tone)` | | A message at the bottom (`info`, `success`, `error`) |
| `uccb.ui.openDialog(id, data)` / `uccb.ui.close()` | | Opens one of the pack's `dialog`s / closes the dialog it's in |
| `uccb.on('theme', fn)` | | The app's theme changed (`dark` or `light`); `<html data-theme>` follows by itself |

Pages start with plain styles matching the app. Buttons, inputs, `.muted` and `button.primary` are styled, and CSS variables `--uccb-bg`, `--uccb-panel`, `--uccb-text`, `--uccb-muted`, `--uccb-border` and `--uccb-accent` follow the theme. A frame sizes itself to its content, except a dock tab, which fills the dock.

## Sharing your own prompts

**Settings → Extensions → 🧩 Share my prompt edits as a pack…** turns what you've changed into a pack file. That covers your edited assistant prompts, your edited Adventure prompts and your Adventure actors. You pick which ones to include. Only prompts that differ from the built-in ones go in.

## Local extensions

For things the sandbox can't do (a server route, importing from another site, a button on pictures), there are also **local extensions** in a `local/` folder that isn't part of the repo. See `lib/extensions/types.ts`. They run with full access and are compiled into UCCB, so changing them means restarting it. They're for your own code, not for sharing.
