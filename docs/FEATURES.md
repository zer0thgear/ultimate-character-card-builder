# Features

A tour of what UCCB does. For setup, see the [README](../README.md).

## Cards

- **The home screen** (⌂ in the header closes the open card and comes back here, and stays here on the next visit): your cards as a grid of pictures, and the **Gen library**, usable without a card open. From the library, **New card from this image** starts a card with that picture as its avatar and its prompt in the art settings.
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

- **Style**: the card's artist and style tags, put first in every prompt (after only NovelAI's fur dataset / nsfw switches), so the look holds while ✨ writes the scene and character prompts, which never touch it (their default instructions leave artist and style tags out). One tag run or one per line; it's joined with single commas however it's typed, and adds nothing when empty. It's saved with the card, and a new card starts with the style that's showing. **Reuse prompt** takes it back off the front of a picture's prompt, so it isn't doubled.
- **NSFW** and **Fur dataset** switches, under Scene and saved with the card, put `nsfw` / `fur dataset` first in the prompt. ✨ writing the scene or character prompt turns them on when it judges the picture needs them (it's told to tag nudity or sexual content, and anthro or furry characters), taking the tags out of what it wrote, and says so; it never turns them off. **Reuse prompt** moves those tags from a picture's prompt onto the switches too, so they aren't doubled.
- **Known characters**: when a card is plainly about an established character (Princess Peach, Hatsune Miku), ✨ puts their Danbooru character and series tags in that character's prompt (`princess peach, super mario bros.`), keeping the look tags that matter, especially where the card's version differs. Original characters get no name tags, only their look.
- **Scene** (the base prompt) and **Characters** (V4+, one prompt each, with a per-character negative and optional positions), with NovelAI's live tag suggestions, `{}`/`[]` emphasis on Ctrl+↑/↓, and NovelAI's own token meters.
- **✨ From description** writes each character's appearance prompt from the card: one for a card about one character, one each for a duo or group, into the character slot of that name (new slots for new names).
- **✨ From greeting** (or 🎨 on any greeting in the editor) illustrates that greeting. On V4 and later it writes the whole cast: the main prompt (count tags like `1girl, 1boy` first, then framing and setting) and a prompt for each character in the moment, keeping their current look and adding their pose, expression and action, with NovelAI's interaction tags (`source#hug` / `target#hug` / `mutual#…`) when they interact. Characters are matched to slots by name (or first name); new ones get slots, and slots for characters who aren't in the scene are switched off, not deleted. **Place characters too** (in its menu, off by default) also puts each on NovelAI's grid and turns Positions on; off, NovelAI decides. On V3, which has no character prompts, it writes the one prompt.
- **Generate** (Ctrl+Enter from the form) with a cost estimate from NovelAI's own formulas ("free" when Opus covers it); **Copies** makes several in a row. Under it, and in Settings → General, your **Anlas** balance and, on Opus, how much of the free V5 allowance is left (with NovelAI's image estimate, refill rate and time to full; click the Anlas line to collapse it). Quality tags, UC presets, Variety+, SMEA, transparency (V5), live streaming preview, and **Img2Img** (⎘ on any image) are all there.
- On each gen: ⛶ **full screen** (or tap the picture), **Set as avatar**, **☆ Keep** (saved with the card, shown in Gallery), **Save to folder**, download, ⎘ Img2Img base, 🖌 inpaint, use its seed, ♻ load its prompt back, remove.
- **Edit image and Inpaint**, NovelFrontEnd's canvas: paint over the base (draw, erase, fill, smudge, blur, colour pick, pen pressure) or mark what to regenerate on NovelAI's 8-pixel mask grid. Saving brings you back with the base updated; Generate then does an Image2Image or an inpaint (on the model's inpainting model, with its strength), and the result is pasted over the original through NovelAI's feathered edge. Paint and mask stay editable. Any gen, kept gen or library image can start one.
- **🖼 Gallery**: gens kept with this card (label them, e.g. "avatar v2", "angry"), and **recent gens**, for this card or all of them.
- **Recent gens** are saved on this computer (`data/recent-gens`) as they arrive, so a reload, a closed tab or a phone freezing the page doesn't lose them, and every device sees the same ones (a device picks up the others' when you come back to it). They're deleted after the days set in Settings → Folders (1 to 30, or until you clear them), counted from when each was made; Settings shows how many there are and how much room they take. Keep them with the card or save them to a folder to hold on to them for good.
  - **Select** (or long-press a picture) to pick several, then act on them from the bar at the bottom: recent gens can be **☆ Kept** with the card, **saved to the output folder**, **downloaded** (several come as one zip) or **removed** (from every device); kept gens can be saved, downloaded or deleted. **All**/**None** toggle the section, and **Done** or Esc stops selecting.
- **Full screen**: tap the picture in a gen, kept gen or library image. Swipe sideways (or ←/→, or the ‹ › buttons with a mouse) through the card's gens, the kept gens or the library results, with a count at the top; closing leaves the view underneath on the picture you ended on. Pinch or scroll to zoom, drag to pan, double-tap to zoom in and back out; swipe down, Back, Esc or ✕ closes it. On a phone it also takes the browser fullscreen (⛶ toggles that anywhere it's supported).

## The gen library

**📚 Library** browses the folders set in Settings → Folders, subfolders included, reading NovelAI metadata (including the copy hidden in the alpha channel), A1111 `parameters`, and the image size. The first scan of a big folder takes a while and fills in as it goes; after that only new or changed files are read.

Search is GenBrowser's: comma-separated terms, all required; `-term` excludes; `a | b` is either; `char:`, `neg:`, `chars:2+`, `model:v4.5`, `seed:`, `file:`, `folder:`, `sampler:`, `type:img2img`. The **?** button has the cheat sheet. Open an image to see its prompt (click a tag to search for it), step with ←/→, then **Set as avatar**, **Reuse prompt** (or prompt and settings), use it as the Img2Img base, or copy it into the output folder.

## Test chat

**💬 Test chat** chats with the card through your chosen connection, building the prompt the way SillyTavern does: main prompt (or the card's system prompt, with `{{original}}`), lorebook entries before and after the character, description, personality, scenario, your persona, example messages, the chat, then post-history instructions. Macros (`{{char}}`, `{{user}}`, `{{random:…}}`, `{{roll:…}}`, `{{time}}`…) are expanded.

- **Personas** (Settings → Personas): a name ({{user}}), a description sent as your persona, and an optional picture shown on your messages. Pick the active one from the chat toolbar; it's used by every chat and by the writing assistant. 🔒 locks the current persona to a chat, which then keeps it whatever the active one is. With no persona, the plain name and description in the chat's ⚙ apply. **Import from SillyTavern folder…** brings over every persona from a SillyTavern install (browse to its folder or its `data/default-user`), pictures included; **Import file…** takes its `settings.json` or a Persona Management backup, with any avatar images picked alongside matched by file name. Personas already here (same name and description) are skipped. The list sorts by name (A–Z or Z–A) or by when personas were added, and past six it can be searched; the chat's persona dropdown follows the same order.
- **🎭 Impersonate** writes your next message for you, into the box.
- The **greeting is read live from the card**: edit it and the chat shows the edit. Swipe ‹ › through every greeting.
- **Swipes** on the last reply (› generates another), **Regenerate**, **Continue**, edit or delete any message, or cut the chat after one.
- **Message numbers**, as SillyTavern shows them: #0 is the greeting, #1 your first message, and so on, on each message's bottom line (beside the swipes on the last reply). Chat settings → Show message numbers turns them off.
- **⤢ Full window** (in the chat's top row, not on a phone, where the chat is a screen of its own already): the chat fills the window, the card and the card list make way, and the messages widen to fill it (up to about 1150px, so lines stay readable on a very wide screen). ⤡ puts things back. It only applies while the Test chat tab is open: other dock tabs show beside the card as usual, and it's remembered on this device.
- Reasoning from thinking models is shown folded, apart from the reply.
- Messages show *actions* in italics, **bold**, and "speech" highlighted, nested either way: italics inside quotes keep the speech's colour, as in SillyTavern. Pictures embedded in the greeting or messages, as `![alt](url)` or `<img src="url">`, are shown (web and inline images only).
- While a reply streams, the chat follows it only until the reply's start reaches the top, so you read it from the beginning; scroll up and it stays where you put it. **↓** jumps to the end (and keeps following it for the rest of that reply).
- **🔍 Prompt inspector**: every part of the prompt, labelled, with tokens, and which lorebook entries fired and why (or were dropped over budget).
- **⚙ Chat settings**: your name and persona, the main prompt, default post-history instructions, and whether to use the card's system prompt, post-history instructions, examples and lorebook.
- Chats are saved per card; start as many as you like.
- **⬇ Export** a chat as a SillyTavern chat file (`.jsonl`, which Chub imports too): the greeting first with every greeting as its swipes, your persona's name on your messages, swipes, reasoning and the model kept, `{{char}}`/`{{user}}` filled in. Or as plain text.

### SillyTavern presets

**Settings → Chat preset** (or ⚙ in the chat) → **Import…** takes SillyTavern chat-completion presets (the JSON "Export preset" writes). The picked preset is global: every chat on every card uses it until you pick another, and the chat's toolbar shows which one is on. With one picked, the prompt is built by its prompt manager, as SillyTavern would:

- Its prompts, in its order, only the ones switched on; markers (description, personality, scenario, persona, world info before/after, examples, chat history) filled from the card, using its personality/scenario/world-info formats and its new-chat and example-chat separators.
- The card's system prompt and post-history instructions replace **Main Prompt** and **Post-History Instructions** (with `{{original}}`), unless the preset forbids overrides or you turn that off.
- In-chat prompts go in at their depth, as do the card's own note (`depth_prompt`) and lorebook entries placed at a depth.
- The history is trimmed to the preset's context size, oldest first (the inspector says how many were left out).
- **Continue** uses its continue nudge, or prefills when it says to; **🎭 Impersonate** uses its impersonation prompt and puts the result in your message box; **send if empty**, **squash system messages**, names in content, and the assistant prefill (Claude only, as in SillyTavern) are honoured.
- Macros include SillyTavern's variables (`{{setvar}}`, `{{getvar}}`, `{{addvar}}`, `{{incvar}}`…) and card fields (`{{description}}`, `{{lastUserMessage}}`…), shared across the whole prompt.
- **Conditionals**: `{{#if description}}…{{/if}}`, with `{{else}}`, `{{#unless x}}`, `!x` and nesting, as SillyTavern's presets use them. A condition is a field (`description`, `personality`, `scenario`, `persona`, `mesExamples`), the lorebook entries that fired this turn (`wiBefore`, `wiAfter`, also usable as `{{wiBefore}}` / `{{wiAfter}}`), a macro such as `getvar::mood`, or a variable's name; it's true unless that's empty, `false` or `0`. A tag on a line of its own takes the line with it, so a block that's left out leaves no gap, and blocks resolve in reading order, so a `{{setvar}}` inside a block that's left out doesn't happen. They work in card fields and the built-in prompt too.
- **Use the preset's samplers** puts its temperature, top P/K/A, min P, penalties, max tokens and seed over the connection's (for Claude, only length and reasoning effort, since current models refuse the rest).
- **Prompts** opens its prompt manager: switch prompts on and off, drag to reorder, edit text, role and depth. Changes apply to UCCB's copy.

**The writing assistant can use a preset too** (Settings → Assistant), chosen separately from the chat's. Its samplers can apply, and its own prompts are wrapped around every assistant request (✨ on fields, new greetings, lorebook entries, tags, the review, the art prompts, Brainstorm): those ordered before Chat History go first, the rest after. The card is already in the request, so placeholders are skipped. Untick any prompt that fights a writing task, such as a roleplay "write {{char}}'s next reply"; that choice is the assistant's alone and doesn't touch the chat.

Text-completion (instruct/context) presets aren't supported yet.

## Brainstorm

**✨ Brainstorm** is a free-form chat with the writing assistant, which always sees the card as it is right now. Replies can be copied or added to the card's Notes.

## References

**📎 References** attaches other cards and pictures to an assistant request, for "write her sister", "match this card's style" or "set a greeting here". It's on ✨ for fields, ✨ New greeting, ✨ Lorebook entry and Brainstorm. The picker offers your other cards, this card's kept gens and your recent gens, or a file: a PNG, JSON or CHARX card, or any picture. You can also paste a picture into the request's text box, or drop files on 📎.

- **Cards** go in as text, the way the card being worked on is sent (8,000 characters each, shared out when there are several), under a note saying they're for reference, not the card itself. A PNG counts as a card when it has card data in it; otherwise it's a picture.
- **Pictures** go with the message, scaled like Write from image, and a request with pictures goes to the **Vision model** instead of the assistant's (the tray says which).
- In Brainstorm, references stay with the message they were sent with, so later turns still see them. A thread with pictures in it keeps going to the vision model until you Clear it.

**Art references** (📎 in the Image tab, between Style and Scene) do the same for the art prompt writers: ✨ From greeting and ✨ From description take the card's references into account, with a note to describe what the pictures show as tags (hair, eyes, build, outfit, setting) and let the card fill in the rest. A reference card there is another character who may appear. Art references are kept per card until you reload, and with a picture attached ✨ From description works even before the card has a description.

The wording of both notes is editable in Settings → Assistant → Prompts (📎 References).

## Writing from an image

**✨ Write from this image** hands a picture to a vision model: ✍ on a gen in the Image tab, **✨ Write from image** on a kept gen or a library image, or **✍ Write from picture** under the card's avatar. Pick what to write, add guidance if you like, and edit the result before using it:

- **👤 Physical description**: how the character looks in it (build, face, hair, eyes, notable features, outfit), to **append to** or **replace** the description.
- **💬 Greeting from the scene**: a new greeting that opens on the pictured moment, **added as a greeting** (or used as the first message if the card has none).
- **❓ Ask about it**: any question (names that fit the look, a backstory idea…), with the answer **added to Notes** or copied.

The picture is sent scaled to at most 1568px on its long side, as JPEG. It has its own **Vision model** connection, remembered, which starts as the assistant's; NovelAI's text models can't see images, so a NovelAI connection is flagged and nothing is sent. A model that can't take pictures usually refuses, and the error says so with a pointer to vision models (a few servers quietly ignore the picture instead). The three prompts are editable with the others, and the inspector shows the picture that was sent.

## What the assistant was asked

Every assistant job shows its **reasoning** (folded, and live while it thinks) and a **🔍 Prompt** link to exactly what was sent: ✨ on fields, new greetings, lorebook entries, the card review and Brainstorm show both inline; the quick buttons (card tags, the character and scene prompts) get a 🔍 (🧠 when there's reasoning) once they've run. The inspector lists the connection, model, preset, effort and time, the reasoning, the reply, and every message sent, with tokens, and copies it as JSON.

Settings → Assistant also has **Recent requests** (this session's, newest first, each openable the same way) and **What each job sends**: pick a job to see its full prompt for the open card, wrapped in the assistant's preset if one is on, before running it. **Prompts** there are editable: every job's system prompt and request, plus the field tools' action texts and reply rule, grouped by job. `{{placeholders}}` (`{{card}}`, `{{field}}`, `{{instruction}}`…, listed beside each) are filled in per request, and a paragraph whose placeholder comes out empty is left out; `{{char}}` and `{{user}}` are sent as written. Each shows when it's edited and has **↺ Default**; **↺ Restore all** puts every one back. Edits are saved with the LLM settings, so every device uses them.

## LLM connections

Settings → LLM connections:

- **NovelAI**: through its OpenAI-compatible API (`text.novelai.net/oa/v1`), with the NovelAI key from General unless you give it its own. Min P, top K, the unified sampler and thinking mode are there (NovelAI's API has thinking on or off, with no effort level). **List** fetches the models your subscription has.
- **OpenAI-compatible**: any base URL (OpenRouter, DeepSeek, KoboldCpp, llama.cpp, LM Studio, vLLM…). Reasoning in `reasoning_content`, `reasoning` or `<think>` tags is shown apart from the reply. **Reasoning effort** (none to xhigh) is sent as `reasoning_effort`, or as `reasoning.effort` to OpenRouter; a SillyTavern preset's effort applies when its samplers are on. Extra body fields can be added as JSON.
- **Anthropic**: Claude through the official SDK, with prompt caching on (the card is the same at the start of every turn), adaptive thinking and effort. The chat is reshaped for Claude's rules (system prompt apart, alternating turns).

Each connection has its own max tokens, sampler settings and stop sequences, and a **Test connection** button. The test chat, the assistant and Write from image each pick their own connection (**Use for chat / assistant / vision**).

**OpenRouter prices**: an OpenRouter connection shows its model's price (input and output, in US dollars, from OpenRouter's public model list) in the connection list, under its model (with the cached-input price where there is one), beside each model **List** fetches, and in the model pickers around the app. Settings → LLM connections switches between per **1M tokens** and per **1K tokens**. Free models say so; OpenRouter's routers, whose price depends on the model they pick, say it varies.

## On a phone

On a narrow screen (or a phone on its side) UCCB becomes one screen at a time, as NovelFrontEnd does: a bar along the bottom switches between the **Card** and the dock's **Image**, **Gallery**, **Library**, **Chat** and **Ideas** (Brainstorm). Both stay loaded, so a generation or a reply carries on while you look at the other. Anything that opens a dock tab (🎨 or 💬 on a greeting, Img2Img, Inpaint) switches to it.

- ☰ opens the card list as a drawer; picking a card or swiping it left closes it, and **⌂ Home** at its top closes the open card.
- The header keeps what fits: undo/redo, Export (which gains **Overwrite from a file…**) and Settings; the theme switch is in Settings → General.
- Controls that otherwise show on hover (deleting a card, message actions, thumbnail actions) are always shown on a touch screen. Drag handles don't scroll the page.
- Dialogs, the Edit/Inpaint canvas included, fill the screen; text fields are 16px so iPhone Safari doesn't zoom in.
- Pictures open full screen with pinch-zoom (see Image generation), and the phone's Back closes them.
- The chat's header is one row: the chat, **+ New**, **⋯** (rename, export, the next or last prompt, delete) and **⚙** (model, persona, preset and the rest). Its buttons wrap rather than run off the edge, and greetings keep their actions inside the unfolded greeting.
- **Typing**: the page shrinks to fit above the on-screen keyboard (Chrome), the field you're in scrolls back into view, and while the keyboard is up the header, the chat's header and the bottom bar hide to give the text room. Enter adds a new line; **Send** sends.

To use it from your phone, run UCCB on your computer and open it over Tailscale (see the README's section on other devices).

## Keyboard

- **Ctrl+Enter** in the image form generates.
- **Ctrl+Z / Ctrl+Y** undo and redo the card (outside text boxes). **Ctrl+S** saves now.
- **Enter** sends in chats and Brainstorm (Shift+Enter for a new line); an empty Enter asks for a reply. On a touch screen Enter is a new line instead.
- **← / →** step through library images in the viewer. **Esc** closes the dialog on top.
