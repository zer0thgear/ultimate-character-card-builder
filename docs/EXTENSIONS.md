# Extension packs

An extension pack changes what UCCB asks the model and adds choices to its wizards, without changing UCCB itself. A pack is one JSON file (`<id>.uccb.json`) with no code in it, so it's safe to share and install, and uninstalling it takes away everything it added.

Install, turn on or off, export and uninstall packs in **Settings → Extensions**. Packs are kept in `data/packs/`, so every device that opens this UCCB has the same ones.

[`docs/extensions/noir.uccb.json`](extensions/noir.uccb.json) is a complete example.

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
| `id` | Up to 64 letters, digits, `-` and `_`. Installing a pack whose id is already installed updates that pack. Required. |
| `name` | Shown in Settings → Extensions and on everything the pack adds. Required. |
| `version` | Any text. Shown when you update (`1.0.0` if left out). |
| `author`, `description`, `homepage` | Optional. `homepage` must be an `http(s)` link. |
| `contributes` | What the pack adds. All of its sections are optional. |

UCCB checks a pack when it's installed. It keeps what it understands and lists what it left out, such as an unknown prompt key or an actor with no prompt. A pack can be at most 1 MB, each text at most 50,000 characters, and each list at most 100 items.

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

## Sharing your own prompts

**Settings → Extensions → 🧩 Share my prompt edits as a pack…** turns what you've changed into a pack file. That covers your edited assistant prompts, your edited Adventure prompts and your Adventure actors. You pick which ones to include. Only prompts that differ from the built-in ones go in.

## Local extensions

For features that need code (a button on pictures, a server route, importing from another site), there are also **local extensions** in a `local/` folder that isn't part of the repo. See `lib/extensions/types.ts`. Those are compiled into UCCB, so changing them means restarting it, and they're meant for your own copy rather than for sharing.
