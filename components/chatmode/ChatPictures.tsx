'use client';

import { useState } from 'react';
import { hasActiveTidbits } from '@/lib/promptTidbits';
import { useChatStore } from '@/store/chatStore';
import { useProjectStore } from '@/store/projectStore';
import { useSettingsStore, type FormSettings } from '@/store/settingsStore';
import { activeImageConnection } from '@/store/imageConnections';
import { imageBlob } from '@/store/sessionStore';
import { toast } from '@/store/uiStore';
import { useLlmStream } from '@/hooks/useLlmStream';
import { useGenerate } from '@/hooks/useGenerate';
import { api } from '@/lib/api';
import { castSceneMessages, cleanTags, sceneTagsMessages, takeDatasetTags } from '@/lib/assist';
import { mergeCast, parseCast } from '@/lib/castPrompt';
import { buildBackendRequest, buildGenerateRequest } from '@/lib/genRequest';
import { isV3Model, randomSeed } from '@/lib/imageRequest';
import { maxCharacters } from '@/lib/models';
import { joinPromptParts } from '@/lib/promptText';
import { messageText } from '@/lib/chatPrompt';
import { uuid } from '@/lib/uuid';
import { AutoTextarea, Button, IconButton, Modal, cx, inputClass } from '@/components/ui';
import { openLightbox } from '@/components/Lightbox';
import { openSettings } from '@/components/SettingsDialog';
import type { CardData } from '@/types/card';
import type { ChatImage, ChatMessage } from '@/types/project';
import type { CharacterPromptEntry } from '@/types/novelai';

// Pictures in Chat mode: 🎨 draws the chat's latest moment (the assistant
// writes the prompt from the recent messages, as the Image tab's ✨ does
// from a greeting), or one you describe. They sit in the chat after the
// message they illustrate, but they're kept apart from the messages: never
// sent to the model, numbered or exported. They're drawn with the Image
// tab's settings (model, size, style and the card's character prompts)
// without changing them.

/** What a picture is drawn from. */
export interface DrawSpec {
  scene: string;
  characters: ChatImage['characters'];
  /** Dataset switches the writer asked for (NovelAI), or nsfw as a tag. */
  nsfw?: boolean;
  fur?: boolean;
}

/** The Image tab's character prompts, as a spec's. */
const formCharacters = (): DrawSpec['characters'] =>
  useSettingsStore
    .getState()
    .characters.filter((c) => c.enabled && !c.archived && (c.prompt.trim() || hasActiveTidbits(c.tidbits)))
    .map((c) => ({ label: c.label ?? '', prompt: c.prompt }));

/** The chat's latest moment, as the prompt writer reads it. */
function recentScene(card: CardData, greeting: string, messages: ChatMessage[], userName: string): string {
  const named = messages.slice(-6).map((m) => `${m.role === 'user' ? userName : card.name || 'Character'}: ${messageText(m)}`);
  const text = (messages.length < 3 && greeting.trim() ? [`${card.name || 'Character'}: ${greeting}`, ...named] : named).join('\n\n');
  // The end is what's being drawn; the writer only reads so much.
  return text.length > 3500 ? `…${text.slice(-3500)}` : text;
}

export interface Pending {
  after: string | null;
  /** Redrawing this picture (it's replaced when the new one's done). */
  replacing?: string;
  stage: 'writing' | 'drawing';
  error?: string;
}

/** Drawing pictures into the open chat. */
export function useChatPictures() {
  const { runAssist } = useLlmStream();
  const { generate, generateOn, error: genError } = useGenerate();
  const [pending, setPending] = useState<Pending | null>(null);

  /** Has the assistant write a spec for `scene` (the recent chat, or what
   *  you asked for). A string is an error. */
  const writeSpec = async (card: CardData, scene: string, instruction: string): Promise<DrawSpec | string> => {
    const form = useSettingsStore.getState();
    const nai = (activeImageConnection()?.kind ?? 'novelai') === 'novelai';
    // V3 has no character prompts: everything goes in the one prompt.
    if (nai && isV3Model(form.model)) {
      const r = await runAssist(sceneTagsMessages(card, scene, instruction), undefined, '🎨 Chat picture');
      if (r.error) return r.error;
      const { tags, nsfw, fur } = takeDatasetTags(cleanTags(r.text));
      return tags ? { scene: tags, characters: [], nsfw, fur } : "The assistant's reply had no prompt in it.";
    }
    const place = nai && form.placeCharacters;
    const r = await runAssist(castSceneMessages(card, scene, instruction, form.characters.filter((c) => !c.archived), place), undefined, '🎨 Chat picture');
    if (r.error) return r.error;
    const cast = parseCast(r.text);
    if (!cast.scene && !cast.characters.length) return "The assistant's reply had no prompts in it.";
    // Into the card's character slots (by name), as the Image tab would, but
    // only for this picture: the Image tab's own prompts aren't changed.
    const merged = cast.characters.length ? mergeCast(form.characters, cast.characters, { scene: true, max: maxCharacters(form.model), cardName: card.name }).characters : form.characters;
    const characters = merged.filter((c) => c.enabled && !c.archived && (c.prompt.trim() || hasActiveTidbits(c.tidbits))).map((c) => ({ label: c.label ?? '', prompt: c.prompt, ...(place && c.center ? { center: c.center } : {}) }));
    return { scene: cast.scene ?? '', characters, nsfw: cast.nsfw, fur: cast.fur };
  };

  /** Draws `spec` and puts it in the chat after `after` (or in place of
   *  `replacing`). */
  const draw = async (spec: DrawSpec, after: string | null, replacing?: ChatImage) => {
    const connection = activeImageConnection();
    const projectId = useProjectStore.getState().project?.id;
    const chatId = useChatStore.getState().chat?.id;
    if (!connection || !projectId || !chatId) {
      if (!connection) openSettings('image');
      return setPending(null);
    }
    setPending({ after, replacing: replacing?.id, stage: 'drawing' });
    const form = useSettingsStore.getState();
    const nai = connection.kind === 'novelai';
    // A character's own negative and tidbits (an outfit, say) come from the
    // Image tab's slot of that name, as they would there.
    const slot = (label: string) => form.characters.find((c) => !c.archived && (c.label ?? '').trim().toLowerCase() === label.trim().toLowerCase());
    const characters: CharacterPromptEntry[] = spec.characters.map((c, i) => {
      const own = slot(c.label);
      return { id: `chat-${i}`, label: c.label, prompt: c.prompt, uc: own?.uc ?? '', tidbits: own?.tidbits, ucTidbits: own?.ucTidbits, center: c.center ?? { x: 0.5, y: 0.5 }, enabled: true };
    });
    // Other backends have no dataset switches: nsfw goes in as a tag.
    const scene = !nai && spec.nsfw && !/(^|,)\s*nsfw\s*(,|$)/i.test(spec.scene) ? joinPromptParts('nsfw', spec.scene) : spec.scene;
    const f: FormSettings = {
      ...form,
      basePrompts: [{ id: 'chat-scene', label: 'Chat', text: scene, selected: true }],
      characters,
      nsfwMode: form.nsfwMode || !!spec.nsfw,
      furMode: form.furMode || !!spec.fur,
      useCoords: nai && spec.characters.some((c) => c.center) ? true : form.useCoords,
    };
    const seed = randomSeed();
    const { request, resolved } = buildGenerateRequest(f, seed);
    const made = nai ? await generate(request, { projectId, forceStandard: true }) : await generateOn(connection, buildBackendRequest(connection, f, resolved, seed), request, { projectId });
    if (!made?.[0]) return setPending((p) => (p ? { ...p, error: 'The picture failed.' } : p));
    try {
      const img = made[0];
      const file = `${chatId}-${uuid()}.png`;
      await api.putChatImage(projectId, file, await imageBlob(img));
      const store = useChatStore.getState();
      if (store.chat?.id !== chatId) {
        toast('The chat changed before the picture was done; it’s in the Gallery.', 'info');
        return setPending(null);
      }
      const picture: ChatImage = {
        id: replacing?.id ?? uuid(),
        after: replacing?.after ?? after,
        file,
        width: img.parameters.width,
        height: img.parameters.height,
        scene: spec.scene,
        characters: spec.characters,
        createdAt: Date.now(),
      };
      store.putImage(picture);
      if (replacing) void api.deleteChatImage(projectId, replacing.file).catch(() => {});
      setPending(null);
    } catch (err) {
      setPending((p) => (p ? { ...p, error: (err as Error).message } : p));
    }
  };

  /** One click: the assistant writes the prompt from the recent chat, then
   *  it's drawn after the last message. */
  const drawMoment = async (card: CardData, greeting: string, messages: ChatMessage[], userName: string) => {
    if (!activeImageConnection()) return openSettings('image');
    const after = messages.at(-1)?.id ?? null;
    setPending({ after, stage: 'writing' });
    const spec = await writeSpec(card, recentScene(card, greeting, messages, userName), '');
    if (typeof spec === 'string') return setPending({ after, stage: 'writing', error: spec });
    await draw(spec, after);
  };

  return {
    pending,
    genError,
    dismiss: () => setPending(null),
    drawMoment,
    draw,
    /** The assistant's spec for the recent chat, for the Describe dialog. */
    writeFromChat: (card: CardData, greeting: string, messages: ChatMessage[], userName: string, instruction: string) => writeSpec(card, recentScene(card, greeting, messages, userName), instruction),
    formCharacters,
  };
}

/** A picture in the chat. */
export function ChatPictureBubble({ image, projectId, busy, onRedraw, onEdit }: { image: ChatImage; projectId: string; busy: boolean; onRedraw: () => void; onEdit: () => void }) {
  const removeImage = useChatStore((s) => s.removeImage);
  const keep = useProjectStore((s) => s.keep);
  const url = api.chatImageUrl(projectId, image.file);
  const keepIt = async () => {
    try {
      const blob = await (await fetch(url)).blob();
      await keep(blob, { id: uuid(), width: image.width, height: image.height, createdAt: Date.now(), prompt: image.scene });
      toast('Kept with the card (Builder’s Gallery tab).', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="group flex flex-col items-center gap-1">
      <button type="button" onClick={() => openLightbox(url)} className="cursor-zoom-in overflow-hidden rounded-lg border border-slate-800" title={image.scene}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={image.scene} className="max-h-[28rem] max-w-full" style={{ aspectRatio: `${image.width} / ${image.height}` }} loading="lazy" />
      </button>
      <div className="flex items-center gap-0.5 text-[11px] text-slate-500">
        <span title="Pictures stay in the chat, but the model never sees them">🎨 not sent to the model</span>
        <IconButton title="Draw it again (a new seed, the same prompt)" disabled={busy} onClick={onRedraw}>
          ↻
        </IconButton>
        <IconButton title="Change its prompt and draw it again" disabled={busy} onClick={onEdit}>
          ✎
        </IconButton>
        <IconButton title="Keep it with the card (Builder's Gallery)" onClick={() => void keepIt()}>
          ★
        </IconButton>
        <IconButton title="Remove the picture" tone="danger" onClick={() => removeImage(image.id)}>
          🗑
        </IconButton>
      </div>
    </div>
  );
}

/** Where a picture is on its way. */
export function PendingPicture({ pending, genError, onDismiss }: { pending: Pending; genError: string | null; onDismiss: () => void }) {
  const error = pending.error && (genError ?? pending.error);
  return (
    <div className={cx('mx-auto flex w-full max-w-sm items-center gap-2 rounded-lg border px-3 py-2 text-xs', error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-slate-800 bg-slate-900 text-slate-400')}>
      <span className={cx(!error && 'animate-pulse')}>🎨</span>
      <span className="flex-1">{error ?? (pending.stage === 'writing' ? 'Writing the picture’s prompt from the chat…' : 'Drawing…')}</span>
      {error && (
        <IconButton title="Dismiss" onClick={onDismiss}>
          ✕
        </IconButton>
      )}
    </div>
  );
}

/** The composer's 🎨: draw the latest moment, or describe a picture. */
export function DrawButton({ phone, disabled, onMoment, onDescribe }: { phone: boolean; disabled: boolean; onMoment: () => void; onDescribe: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" disabled={disabled} onClick={() => setOpen(!open)} title="Draw a picture into the chat (it isn't sent to the model)">
        <span className={cx(phone && 'px-0.5 text-base leading-none')}>🎨</span>
        {!phone && ' Picture'}
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {[
            { label: '🎨 Draw this moment', hint: 'The assistant writes the prompt from the last few messages, then it’s drawn', run: onMoment },
            { label: '✎ Describe a picture…', hint: 'Write the prompt yourself (or have it written, then change it)', run: onDescribe },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              className="block w-full rounded px-3 py-1.5 text-left hover:bg-slate-800"
              onClick={() => {
                setOpen(false);
                o.run();
              }}
            >
              <span className="block text-sm text-slate-200">{o.label}</span>
              <span className="block text-[11px] text-slate-500">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Write or change a picture's prompt, then draw it. */
export function DescribeDialog({ initial, redrawing, onWrite, onDraw, onClose }: { initial: DrawSpec; redrawing: boolean; onWrite: (instruction: string) => Promise<DrawSpec | string>; onDraw: (spec: DrawSpec) => void; onClose: () => void }) {
  const [spec, setSpec] = useState<DrawSpec>(initial);
  const [instruction, setInstruction] = useState('');
  const [writing, setWriting] = useState(false);
  const write = async () => {
    setWriting(true);
    const r = await onWrite(instruction);
    setWriting(false);
    if (typeof r === 'string') toast(r, 'error');
    else setSpec(r);
  };
  const setCharacter = (i: number, patch: Partial<DrawSpec['characters'][number]>) => setSpec((s) => ({ ...s, characters: s.characters.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const canDraw = !!spec.scene.trim() || spec.characters.some((c) => c.prompt.trim());
  return (
    <Modal
      open
      onClose={onClose}
      title={redrawing ? 'Change the picture' : 'Describe a picture'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canDraw || writing}
            onClick={() => {
              onDraw({ ...spec, characters: spec.characters.filter((c) => c.prompt.trim()) });
              onClose();
            }}
          >
            🎨 {redrawing ? 'Draw it again' : 'Draw'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">Tags work best (the picture uses the Image tab&apos;s model, size and style). The picture goes after the last message; the model never sees it.</p>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 p-2">
          <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Optional: what to show, e.g. “close-up of her face”" className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')} />
          <Button size="sm" disabled={writing} onClick={() => void write()} title="The assistant writes the prompts from the last few messages (and what you asked for)">
            {writing ? 'Writing…' : '✨ Write it from the chat'}
          </Button>
        </div>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Scene (framing, pose, setting)
          <AutoTextarea value={spec.scene} onChange={(e) => setSpec({ ...spec, scene: e.target.value })} minRows={2} maxRows={8} className="font-mono text-xs" placeholder="cowboy shot, sitting, cafe, window light, smile" />
        </label>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            Characters
            <Button size="sm" variant="ghost" onClick={() => setSpec({ ...spec, characters: [...spec.characters, { label: '', prompt: '' }] })}>
              + Character
            </Button>
          </div>
          {spec.characters.length === 0 && <p className="text-[11px] text-slate-500">None: everything goes in the scene.</p>}
          {spec.characters.map((c, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-md border border-slate-800 p-2">
              <div className="flex items-center gap-2">
                <input value={c.label} onChange={(e) => setCharacter(i, { label: e.target.value })} placeholder="Name" className={cx(inputClass, 'w-40 py-0.5 text-xs')} />
                <IconButton title="Leave this character out" tone="danger" className="ml-auto" onClick={() => setSpec({ ...spec, characters: spec.characters.filter((_, j) => j !== i) })}>
                  ✕
                </IconButton>
              </div>
              <AutoTextarea value={c.prompt} onChange={(e) => setCharacter(i, { prompt: e.target.value })} minRows={2} maxRows={6} className="font-mono text-xs" placeholder="1girl, long hair, red dress" />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
