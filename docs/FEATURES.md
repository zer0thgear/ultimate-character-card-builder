# Features

A tour of what UCCB does. For setup, see the [README](../README.md).

## Cards

- **One project per card.** The left sidebar lists them with their pictures; **+ New card**, **Import**, or drop a PNG, JSON or CHARX card anywhere to import it as a new one. Deleting moves the project to `data/trash`.
- **Autosave.** Every change is saved to disk a moment later (Ctrl+S saves at once). The header shows Saved / Unsaved / Saving….
- **Undo and redo** for the whole card (↶ ↷ in the header, or Ctrl+Z / Ctrl+Y when you're not typing in a box; text boxes keep their own undo). Quick typing in one field is one step; every button action (delete, promote, macro, overwrite) is its own step.
- **Overwrite…** replaces the card's text with a card or JSON file and keeps the picture, gens and chats, like tavern-card-editor's "Overwrite with JSON".
- **Export**: PNG card (V3 in `ccv3` and V2 in `chara`, so V2-only frontends like Chub still read it), JSON (V3) or CHARX. A card with no picture gets a plain placeholder. The avatar's NovelAI generation metadata is stripped unless you ask to keep it (Settings → General), including the copy NovelAI hides in the picture's alpha channel.
- **Smaller card pictures** (Settings → General): exported cards can resize the picture to a longest edge and recompress it, losslessly or to a 256-colour palette (often a third of the size). The avatar kept in UCCB stays full quality. The export message says how big the card came out.
- **Nothing is lost on import.** Unknown fields and extensions from other frontends ride along untouched. V1 cards, V2, V3, SillyTavern's own world files and standalone `lorebook_v3` files are all read.

### The editor tabs

- **Character**: name, nickname (V3), description, personality, scenario, example messages.
- **Greetings**: the first message; alternate greetings you can drag to reorder, fold, duplicate, **promote to first message** (the old one becomes alternate #1), or delete; group-only greetings the same way. Each greeting has 💬 (start a test chat with it) and 🎨 (illustrate it, see below). **✨ New** writes a new alternate greeting with the assistant.
- **Lorebook**: attach, import (JSON, card PNG, CHARX; adds to an existing book if you like), export, remove. Entries drag to reorder, fold, filter, and toggle on and off. Name and comment are kept in step (Chub reads one, SillyTavern the other), and a banner offers to fill in mismatched ones on import. Keys and secondary keys are chips; `/regex/` keys work. **Try the keys**: type a message and see which entries it would fire, and why. **✨ Write one** drafts an entry (name, keys and content) from a topic.
- **Prompts**: the card's system prompt and post-history instructions, with `{{original}}`.
- **Creator**: creator, version, tags (✨ suggests some), creator's notes, source, and the card's size: how many tokens every message carries.
- **Notes**: your own notes, saved with the project and never exported, plus **✨ Review the card**: the assistant points out contradictions, gaps and likely misbehaviour.
- **Tools**: whole-card macros over the field groups you pick. **Find and replace** (match case, whole words, regex with `$1`), with a live count per field before you apply. **Name → {{char}}**, **Purge asterisks** (paired ones only), **Straighten quotes**, **Tidy whitespace**. Each shows what it will change and asks first; undo reverses it.

### On every text field

- A **token count** (an estimate from GPT's o200k tokenizer; your model may differ a little).
- **✨ Writing assistant**: Rewrite, Draft (treats what's there as notes), Expand, Tighten, Polish or Continue, with an optional instruction. It sees the whole card, shows its suggestion next to the current text, lets you edit it, then Replace or Append.
- **⤢ Large editor** for long fields.

## Art

The dock on the right starts on **🎨 Image**. Model, size, sampler and the other settings are global; the **prompts belong to the card**, so switching cards switches what's being drawn.

- **Scene** (the base prompt) and **Characters** (V4+, one prompt each, with a per-character negative and optional positions), with NovelAI's live tag suggestions, `{}`/`[]` emphasis on Ctrl+↑/↓, and NovelAI's own token meters.
- **✨ From description** writes the character's appearance prompt from the card. **✨ From greeting** (or 🎨 on any greeting in the editor) writes a scene prompt that illustrates that greeting.
- **Generate** (Ctrl+Enter from the form) with a cost estimate from NovelAI's own formulas and your Anlas balance; **Copies** makes several in a row. Quality tags, UC presets, Variety+, SMEA, transparency (V5), live streaming preview, and **Img2Img** (⎘ on any image) are all there.
- On each gen: **Set as avatar**, **☆ Keep** (saved with the card, shown in Gallery), **Save to folder**, download, ⎘ Img2Img base, 🖌 inpaint, use its seed, ♻ load its prompt back, remove.
- **Edit image and Inpaint**, NovelFrontEnd's canvas: paint over the base (draw, erase, fill, smudge, blur, colour pick, pen pressure) or mark what to regenerate on NovelAI's 8-pixel mask grid. Saving brings you back with the base updated; Generate then does an Image2Image or an inpaint (on the model's inpainting model, with its strength), and the result is pasted over the original through NovelAI's feathered edge. Paint and mask stay editable. Any gen, kept gen or library image can start one.
- **🖼 Gallery**: gens kept with this card (label them, e.g. "avatar v2", "angry"), and this session's gens, for this card or all of them.

## The gen library

**📚 Library** browses the folders set in Settings → Folders, subfolders included, reading NovelAI metadata (including the copy hidden in the alpha channel), A1111 `parameters`, and the image size. The first scan of a big folder takes a while and fills in as it goes; after that only new or changed files are read.

Search is GenBrowser's: comma-separated terms, all required; `-term` excludes; `a | b` is either; `char:`, `neg:`, `chars:2+`, `model:v4.5`, `seed:`, `file:`, `folder:`, `sampler:`, `type:img2img`. The **?** button has the cheat sheet. Open an image to see its prompt (click a tag to search for it), step with ←/→, then **Set as avatar**, **Reuse prompt** (or prompt and settings), use it as the Img2Img base, or copy it into the output folder.

## Test chat

**💬 Test chat** chats with the card through your chosen connection, building the prompt the way SillyTavern does: main prompt (or the card's system prompt, with `{{original}}`), lorebook entries before and after the character, description, personality, scenario, your persona, example messages, the chat, then post-history instructions. Macros (`{{char}}`, `{{user}}`, `{{random:…}}`, `{{roll:…}}`, `{{time}}`…) are expanded.

- **Personas** (Settings → Personas): a name ({{user}}), a description sent as your persona, and an optional picture shown on your messages. Pick the active one from the chat toolbar; it's used by every chat and by the writing assistant. 🔒 locks the current persona to a chat, which then keeps it whatever the active one is. With no persona, the plain name and description in the chat's ⚙ apply. **Import from SillyTavern folder…** brings over every persona from a SillyTavern install (browse to its folder or its `data/default-user`), pictures included; **Import file…** takes its `settings.json` or a Persona Management backup, with any avatar images picked alongside matched by file name. Personas already here (same name and description) are skipped.
- **🎭 Impersonate** writes your next message for you, into the box.
- The **greeting is read live from the card**: edit it and the chat shows the edit. Swipe ‹ › through every greeting.
- **Swipes** on the last reply (› generates another), **Regenerate**, **Continue**, edit or delete any message, or cut the chat after one.
- Reasoning from thinking models is shown folded, apart from the reply.
- **🔍 Prompt inspector**: every part of the prompt, labelled, with tokens, and which lorebook entries fired and why (or were dropped over budget).
- **⚙ Chat settings**: your name and persona, the main prompt, default post-history instructions, and whether to use the card's system prompt, post-history instructions, examples and lorebook.
- Chats are saved per card; start as many as you like.

### SillyTavern presets

**Settings → Chat preset** (or ⚙ in the chat) → **Import…** takes SillyTavern chat-completion presets (the JSON "Export preset" writes). The picked preset is global: every chat on every card uses it until you pick another, and the chat's toolbar shows which one is on. With one picked, the prompt is built by its prompt manager, as SillyTavern would:

- Its prompts, in its order, only the ones switched on; markers (description, personality, scenario, persona, world info before/after, examples, chat history) filled from the card, using its personality/scenario/world-info formats and its new-chat and example-chat separators.
- The card's system prompt and post-history instructions replace **Main Prompt** and **Post-History Instructions** (with `{{original}}`), unless the preset forbids overrides or you turn that off.
- In-chat prompts go in at their depth, as do the card's own note (`depth_prompt`) and lorebook entries placed at a depth.
- The history is trimmed to the preset's context size, oldest first (the inspector says how many were left out).
- **Continue** uses its continue nudge, or prefills when it says to; **🎭 Impersonate** uses its impersonation prompt and puts the result in your message box; **send if empty**, **squash system messages**, names in content, and the assistant prefill (Claude only, as in SillyTavern) are honoured.
- Macros include SillyTavern's variables (`{{setvar}}`, `{{getvar}}`, `{{addvar}}`, `{{incvar}}`…) and card fields (`{{description}}`, `{{lastUserMessage}}`…), shared across the whole prompt.
- **Use the preset's samplers** puts its temperature, top P/K/A, min P, penalties, max tokens and seed over the connection's (for Claude, only length and reasoning effort, since current models refuse the rest).
- **Prompts** opens its prompt manager: switch prompts on and off, drag to reorder, edit text, role and depth. Changes apply to UCCB's copy.

**The writing assistant can use a preset too** (Settings → Assistant), chosen separately from the chat's. Its samplers can apply, and its own prompts are wrapped around every assistant request (✨ on fields, new greetings, lorebook entries, tags, the review, the art prompts, Brainstorm): those ordered before Chat History go first, the rest after. The card is already in the request, so placeholders are skipped. Untick any prompt that fights a writing task, such as a roleplay "write {{char}}'s next reply"; that choice is the assistant's alone and doesn't touch the chat.

Text-completion (instruct/context) presets aren't supported yet.

## Brainstorm

**✨ Brainstorm** is a free-form chat with the writing assistant, which always sees the card as it is right now. Replies can be copied or added to the card's Notes.

## LLM connections

Settings → LLM connections:

- **NovelAI**: through its OpenAI-compatible API (`text.novelai.net/oa/v1`), with the NovelAI key from General unless you give it its own. Min P, top K, the unified sampler and thinking mode are there. **List** fetches the models your subscription has.
- **OpenAI-compatible**: any base URL (OpenRouter, DeepSeek, KoboldCpp, llama.cpp, LM Studio, vLLM…). Reasoning in `reasoning_content`, `reasoning` or `<think>` tags is shown apart from the reply. Extra body fields can be added as JSON.
- **Anthropic**: Claude through the official SDK, with prompt caching on (the card is the same at the start of every turn), adaptive thinking and effort. The chat is reshaped for Claude's rules (system prompt apart, alternating turns).

Each connection has its own max tokens, sampler settings and stop sequences, and a **Test connection** button. The test chat and the assistant each pick their own connection.

## Keyboard

- **Ctrl+Enter** in the image form generates.
- **Ctrl+Z / Ctrl+Y** undo and redo the card (outside text boxes). **Ctrl+S** saves now.
- **Enter** sends in chats (Shift+Enter for a new line); an empty Enter asks for a reply.
- **← / →** step through library images in the viewer. **Esc** closes dialogs.
