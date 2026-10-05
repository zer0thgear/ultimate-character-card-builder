# Changelog

## Unreleased

- **📖 Lorebooks**, a bank of lorebooks like SillyTavern's World Info: make, import, edit and export lorebooks of their own, then use them in every chat (global, any number), as a chat's own lorebook, or with a persona (one each, as in SillyTavern). They're scanned with the card's lorebook in SillyTavern's order, and Writing and Adventure modes use the global and persona ones too. Importing a card with a lorebook asks whether to add it to the bank, as SillyTavern does.
- **🧙 Lorebook wizard** on the Lorebook tab: draft a whole lorebook in a guided session. A Planner lists the entries from your description (and the card) and asks questions, a Writer writes each one with the rest in view, and you edit any entry by hand or tell the Planner what to change, after which the changed entries are rewritten. It can also start from the card's lorebook, to review its entries, rewrite them and add to them. It flags keys that never fire, collide or are too common, and saves into the card's lorebook, updating entries in place, or into a new lorebook in 📖 Lorebooks. Lorebooks in 📖 Lorebooks have a 🧙 Wizard of their own.
- **Library gens in a card's gallery**: from 📚 Library, ☆ Add to gallery keeps an image (or several, with ☑ select) with the open card, so it shows in the card's 🖼 Gallery. ★ marks library images the card already has, and the same picture is never kept twice, whether it comes from the library or the generator.
- **✍ Writing mode** in Chat mode: write a story together with the model in one document, as NovelAI's story mode does, with memory, an author's note, a Cast (characters read like lorebook entries, with a scan that suggests new ones), the card's lorebook, versions of each part, and an optional proofreading pass for chat connections.
- **🎲 Adventure mode** in Chat mode: a roleplay run like a tabletop game. A Director plans each turn and briefs a Narrator and a cast (one call per acting character), the app rolls real dice for uncertain actions, and the story can open from a greeting or a bespoke scenario. Each card gets a 🌍 World of Cast members (its dramatis personae), settings and rules, listed by a Scout from its definitions and lorebook, changeable per adventure. Each actor can use its own connection, and every turn shows what its calls took and cost. Newcomers the Director brings in join the adventure's Cast by themselves, and the setup screen picks which persona you play. Turns play out in order as beats: only characters with something to add act, they can answer each other within a turn with narration between them, and the Narrator no longer writes the parts of characters who act after it. ⚙ Actors edits each actor's prompt (with reset to defaults) and adds actors of your own, each with a prompt and an optional field in the Director's plan that briefs it.
- **🛎 Helper** on the home screen: ask how anything in UCCB works (buttons, settings, macros, setup) and it answers from the app's own guide, in a personality of your choice (dry wit, teasing brat, mommy, bored, tsundere, hype, villain, or your own).

## 1.0.0 (2026-10-03)

The first stable release.

### Security
- UCCB now only answers to names that point at it (localhost, the computer's name or IP address, its Tailscale name, `.local` names, or ones listed in `UCCB_ALLOWED_HOSTS`). Changes are only accepted from UCCB's own pages. Before this, a website open in your browser could create or change cards, and read your settings and API keys through DNS rebinding.

### What's in it
- **Card editor**: every V1/V2/V3 field, alternate and group greetings, lorebooks with SillyTavern's rules (secondary-key logic, trigger %, inclusion groups, sticky / cooldown / delay, recursion), the Character's Note, regex scripts, find and replace, cleanup macros, undo/redo and autosave. PNG, JSON and CHARX import and export.
- **Card management**: duplicate, trash with restore, tag filter on the home screen, and version history with diff and restore.
- **Image generation**: NovelAI (character prompts, Img2Img, inpainting), A1111 / Forge, and ComfyUI (built-in or your own workflow, now with Img2Img), a gen library and recent gens.
- **Writing assistant** on every field, Brainstorm, and writing from pictures with a vision model.
- **Test chat and Chat mode**: SillyTavern-style prompt assembly with chat-completion presets and text-completion (instruct / context) templates, personas, swipes, the continue tree, author's note and summaries, search within a chat, hiding messages from the prompt, comparing two connections side by side, and importing chats from SillyTavern and Chub.
- **Polish**: a getting-started list, a keyboard shortcuts dialog (`?`), a page-title marker while a job runs, and a warning before recent gens expire.
