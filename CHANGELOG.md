# Changelog

## Unreleased

- **✍ Writing mode** in Chat mode: write a story together with the model in one document, as NovelAI's story mode does, with memory, an author's note, Dramatis Personae (a cast read like lorebook entries), the card's lorebook, versions of each part, and an optional proofreading pass for chat connections.
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
