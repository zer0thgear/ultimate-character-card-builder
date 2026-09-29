# A tour of UCCB

This walks through making one card from start to finish, to show where things are and how they fit together. It assumes UCCB is running and you've added at least one connection in Settings (see [First run](../README.md#first-run) in the README). Every feature is covered in more detail in the [feature reference](FEATURES.md).

## The screen

With a card open, the window has three parts:

- **The card list** on the left: every card you've made, with its picture. **+ New card** and **Import** are at the top, and you can drop a card file (PNG, JSON or CHARX) anywhere to import it.
- **The card editor** in the middle: the card's picture and name, then tabs for its parts (Character, Greetings, Lorebook, Prompts, Creator, Notes, Tools).
- **The dock** on the right: **🎨 Image** (make pictures), **🖼 Gallery** (the card's pictures), **📚 Library** (your old gens), **💬 Test chat** and **✨ Brainstorm**. Drag the bar between the editor and the dock to resize them.

The header has **⌂** (back to the home screen of all your cards), undo and redo, the save status, **Export**, and **⚙ Settings**.

Everything saves by itself a moment after you change it, and **undo** (↶, or Ctrl+Z outside a text box) steps back through every change to the card.

## 1. Start a card

Press **+ New card**, or import one you already have. Imported cards keep everything, including fields and extensions from other frontends that UCCB doesn't use itself, so exporting again loses nothing.

## 2. Write it

The **Character** tab has the core fields: name, description, personality, scenario and example messages. Each field shows its token count and has two buttons:

- **✨** opens the writing assistant for that field. Pick what it should do (**Draft** from notes, **Rewrite**, **Expand**, **Tighten**, **Polish** or **Continue**) and, if you like, say how ("more playful", "add her fear of water"). It reads the whole card, shows its suggestion beside what's there now, lets you edit it, then **Replace** or **Append**.
- **⤢** opens the field in a large editor, for long descriptions.

A few other things worth knowing:

- **Greetings**: the first message and any alternates. Drag them into order, or **promote** one to be the first message. **✨ New** writes a new alternate greeting, from a situation you describe if you like. Each greeting has **💬** to start a test chat with it and **🎨** to illustrate it.
- **Lorebook**: entries that are added to the prompt when their keywords come up. **✨ Write one** drafts an entry from a topic, and **Try the keys** shows which entries a message would set off, and why.
- **Notes**: your own notes, never exported. **✨ Review the card** asks the assistant for contradictions, gaps and things likely to go wrong in play.
- **Tools**: find and replace across the card, and cleanups like turning the character's name into `{{char}}`. Each shows what it will change first.

**📎 References** (on ✨ dialogs and Brainstorm) lets the assistant work from other cards or pictures: "write her sister", "match this card's style", "set a greeting in this place". Pick one of your cards, a gen, or a file, or paste a picture.

**✨ Brainstorm** in the dock is an open chat with the assistant about the card: names, backstory, "what would she wear to a funeral". It always sees the card as it is now, and any reply can be added to Notes.

## 3. Give it a face

Open **🎨 Image**. The prompt is split into parts:

- **Style**: artist and style tags, put first in every prompt. The assistant never changes this, so the look stays the same while the rest changes.
- **Scene**: framing, pose and setting.
- **Characters**: one prompt per character, for their look. On NovelAI V4 and later these are separate character prompts, which can be placed on a grid. With A1111 or ComfyUI they're added to the end of the prompt.

You don't have to write tags by hand:

- **✨ From description** writes each character's prompt from the card's description (one each for a duo or a group).
- **✨ From greeting** (or **🎨** on a greeting) writes the whole scene for that moment: the main prompt, plus each character's pose, expression and what they're doing.
- **📎 Art references** gives both writers pictures to work from, such as a character sheet or an outfit.

Press **Generate** (or Ctrl+Enter). On NovelAI the button shows the Anlas cost. On each picture you can:
- **Set as avatar**, the card's picture;
- **☆ Keep** it with the card, where it shows in **Gallery**;
- save it to your output folder;
- reuse its seed or prompt;
- open it full screen.

With NovelAI or A1111 you can also use a picture as an **Img2Img** base, and with NovelAI paint over it, **inpaint** part of it, or **✨ Enhance** it (a larger, more detailed re-render, as on novelai.net).

Pictures you haven't kept are saved as **recent gens** for a week (you can change that), so closing the tab doesn't lose them.

It works the other way around too: **✍ Write from this image** on a picture has a vision model write the character's physical description, or a greeting set in that moment, from what it sees.

## 4. Test it

Open **💬 Test chat** and start a chat. It builds the prompt the way SillyTavern would, from the card, the lorebook entries that fire, your persona and the chat so far. The greeting is read live from the card, so edits show up right away.

- **Swipe** (›) for another version of the last reply, or **Regenerate**, **Continue**, **🎭 Impersonate** (it writes your next message for you), and edit or delete any message.
- After a **Continue**, **↻** rerolls just the part it added and **↶** undoes it; **🌿** shows every continue you've tried as a tree, to go back down another path.
- **🧭** steers the next reply, swipe, continue or impersonation with an instruction ("she finally admits it"), used once unless you pin it.
- **🔍** shows exactly what the next reply would send, part by part with token counts, and which lorebook entries fired and why.
- **Personas** (Settings → Personas) set who you are in the chat. Pick one from the chat's toolbar.
- **SillyTavern presets**: import a chat-completion preset in Settings → Chat preset, and the chat uses its prompts, order and samplers.
- **⤢** at the end of the dock's tabs fills the window with it (the chat, or whichever tab is open), to try the card without the definitions in view; the card editor's own ⤢ does the same for the card.

## 5. Share it

**Export** in the header saves the card as a **PNG** (the picture with the card inside it, which most frontends and card sites take), **JSON** or **CHARX**. Settings → General can make exported pictures smaller, and strips generation details from them unless you ask to keep them.

## Old gens

**📚 Library** browses folders of pictures you've made before (set them in Settings → Folders), and reads the prompt and settings saved in each one. Search by tag (`long hair, -hat`), character count, model or seed. From a picture you can reuse its prompt, set it as the avatar, or start a new card from it (from the home screen).

## On your phone

Open UCCB over Tailscale (see the README) and it becomes one screen at a time: a bar along the bottom switches between the card and the dock's tabs. **☰** opens the card list. The page makes room for the keyboard while you type. Not sure what an icon does? **Hold it** for a moment to see its help.

## Seeing and changing what the assistant is told

Every assistant job has a **🔍 Prompt** link that shows exactly what was sent, and its reasoning when the model thinks first. In Settings → Assistant:
- **What each job sends** previews any job's prompt for the open card before you run it.
- **Prompts** lets you edit every instruction the assistant gets, with a button to put each back.
- The assistant can use a SillyTavern preset of its own too.
