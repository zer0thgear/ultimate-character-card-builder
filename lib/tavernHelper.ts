import type { ChatMessage } from '@/types/project';
import { parseStPreset, toStPreset, type ChatPreset } from '@/lib/stPreset';
import { REGEX_PLACEMENT, parseRegexScripts } from '@/lib/regexScripts';

// Tavern Helper (JS-Slash-Runner) scripts, as SillyTavern presets and cards
// carry them, and the shapes its API hands them: chat messages, presets and
// regex scripts the way Tavern Helper's own functions describe them
// (getChatMessages, getPreset, getTavernRegexes…). The scripts run in
// sandboxed frames (public/tavern-helper-runtime.js) and the chat answers
// them (components/dock/TavernScripts.tsx); this file is the translation in
// between, kept free of React and the stores so it can be tested.

export interface ScriptButton {
  name: string;
  visible: boolean;
}

export interface TavernScript {
  /** The script's own id, as its file has it. */
  id: string;
  name: string;
  content: string;
  /** Its author's note on what it does. */
  info: string;
  /** Where it came from: the chat preset, or the card. */
  source: 'preset' | 'card';
  /** Buttons it puts above the message box (script buttons). */
  buttons: ScriptButton[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The switched-on scripts in a Tavern Helper script list: its current form
 *  (scripts and folders of them, `type` and `enabled`) and its older one
 *  (TavernHelper_scripts: no type, buttons as a plain list). */
export function scriptsFrom(raw: unknown, source: TavernScript['source']): TavernScript[] {
  if (!Array.isArray(raw)) return [];
  const out: TavernScript[] = [];
  for (const item of raw) {
    if (!isObject(item) || item.enabled === false) continue;
    if (item.type === 'folder') {
      out.push(...scriptsFrom(item.scripts, source));
      continue;
    }
    const content = str(item.content);
    if (!content.trim()) continue;
    const button = isObject(item.button) ? item.button : null;
    const list = button ? (button.enabled === false ? [] : button.buttons) : item.buttons;
    out.push({
      id: str(item.id) || str(item.name) || `script-${out.length}`,
      name: str(item.name) || 'Unnamed script',
      content,
      info: str(item.info),
      source,
      buttons: Array.isArray(list) ? list.filter(isObject).map((b) => ({ name: str(b.name), visible: b.visible !== false })).filter((b) => b.name) : [],
    });
  }
  return out;
}

/** A preset's scripts (in its extensions.tavern_helper). */
export function presetScripts(preset: Pick<ChatPreset, 'extra'> | null): TavernScript[] {
  const ext = preset?.extra?.extensions;
  const th = isObject(ext) ? ext.tavern_helper : undefined;
  return scriptsFrom(isObject(th) ? th.scripts : undefined, 'preset');
}

/** A card's scripts (extensions.tavern_helper, or the older TavernHelper_scripts). */
export function cardScripts(extensions: Record<string, unknown> | undefined): TavernScript[] {
  const th = extensions?.tavern_helper;
  if (isObject(th) && Array.isArray(th.scripts)) return scriptsFrom(th.scripts, 'card');
  return scriptsFrom(extensions?.TavernHelper_scripts, 'card');
}

/** What a script's approval is for: the script exactly as it is, so a
 *  changed script asks again. */
export function scriptKey(s: Pick<TavernScript, 'source' | 'id' | 'content'>): string {
  // FNV-1a over the text, twice with different seeds, as hex.
  const text = `${s.source}\u0000${s.id}\u0000${s.content}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${s.source}:${s.id}:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

// ─── Chat messages ──────────────────────────────────────────────────────────

/** A chat message as Tavern Helper gives it (ChatMessageSwiped too). */
export interface ThMessage {
  message_id: number;
  name: string;
  role: 'system' | 'assistant' | 'user';
  is_hidden: boolean;
  message: string;
  data: Record<string, unknown>;
  extra: Record<string, unknown>;
  swipe_id: number;
  swipes: string[];
  swipes_data: Record<string, unknown>[];
}

/** The chat as SillyTavern numbers it: the greeting is message 0 (when
 *  there is one), then UCCB's messages in order. */
export function thMessages(messages: ChatMessage[], greeting: string | null, names: { char: string; user: string }): ThMessage[] {
  const out: ThMessage[] = [];
  if (greeting !== null) {
    out.push({ message_id: 0, name: names.char, role: 'assistant', is_hidden: false, message: greeting, data: {}, extra: { uccb: 'greeting' }, swipe_id: 0, swipes: [greeting], swipes_data: [{}] });
  }
  for (const m of messages) {
    const data = m.swipes.map((_, i) => ({ ...(m.data?.[i] ?? {}) }));
    out.push({
      message_id: out.length,
      name: m.role === 'user' ? names.user : m.role === 'assistant' ? names.char : 'System',
      role: m.role,
      is_hidden: !!m.hidden,
      message: m.swipes[m.swipe] ?? '',
      data: data[m.swipe] ?? {},
      extra: { uccb: m.id },
      swipe_id: m.swipe,
      swipes: [...m.swipes],
      swipes_data: data,
    });
  }
  return out;
}

/** A Tavern Helper message range ("3", "-1", "0-5", "2--1"; negatives
 *  count from the end) as [first, last], or null. */
export function messageRange(range: string | number, lastId: number): [number, number] | null {
  const m = String(range).trim().match(/^(-?\d+)(?:\s*-\s*(-?\d+))?$/);
  if (!m) return null;
  const at = (n: number) => (n < 0 ? lastId + 1 + n : n);
  let a = at(Number(m[1]));
  let b = m[2] === undefined ? a : at(Number(m[2]));
  if (a > b) [a, b] = [b, a];
  a = Math.max(0, a);
  b = Math.min(lastId, b);
  return a > b ? null : [a, b];
}

// ─── Presets ────────────────────────────────────────────────────────────────

const PLACEHOLDERS = ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'];

/** A preset as Tavern Helper's getPreset gives it. */
export function thPreset(p: ChatPreset): Record<string, unknown> {
  const st = toStPreset(p);
  const prompt = (id: string, enabled: boolean) => {
    const x = p.prompts.find((q) => q.identifier === id)!;
    return {
      id,
      name: x.name,
      enabled,
      ...(x.systemPrompt && !PLACEHOLDERS.includes(id) && x.injectionPosition === 0 && ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'].includes(id)
        ? {}
        : { position: x.injectionPosition === 1 ? { type: 'in_chat', depth: x.injectionDepth, order: x.injectionOrder } : { type: 'relative' } }),
      role: x.role,
      ...(PLACEHOLDERS.includes(id) ? {} : { content: x.content }),
      ...(x.forbidOverrides ? { extra: { forbid_overrides: true } } : {}),
    };
  };
  const ordered = new Set(p.order.map((o) => o.identifier));
  return {
    settings: {
      max_context: st.openai_max_context ?? 0,
      max_completion_tokens: st.openai_max_tokens,
      reply_count: 1,
      should_stream: true,
      temperature: st.temperature,
      frequency_penalty: st.frequency_penalty,
      presence_penalty: st.presence_penalty,
      top_p: st.top_p,
      repetition_penalty: st.repetition_penalty,
      min_p: st.min_p,
      top_k: st.top_k,
      top_a: st.top_a,
      seed: st.seed,
      squash_system_messages: p.squashSystemMessages,
      reasoning_effort: p.samplers.reasoning_effort ?? 'auto',
      request_thoughts: true,
      request_images: false,
      enable_function_calling: false,
      enable_web_search: false,
      allow_sending_images: 'disabled',
      allow_sending_videos: false,
      character_name_prefix: (['none', 'default', 'completion', 'content'] as const)[p.namesBehavior + 1] ?? 'default',
      wrap_user_messages_in_quotes: false,
    },
    prompts: p.order.map((o) => prompt(o.identifier, o.enabled)),
    prompts_unused: p.prompts.filter((x) => !ordered.has(x.identifier)).map((x) => prompt(x.identifier, false)),
    extensions: structuredClone(isObject(p.extra?.extensions) ? p.extra.extensions : {}),
  };
}

/** A preset written back by a script (replacePreset), over the one it
 *  replaces: the same preset (id, name) with the script's prompts, order,
 *  settings and extensions. */
export function fromThPreset(raw: unknown, base: ChatPreset): ChatPreset {
  if (!isObject(raw)) throw new Error('A preset needs to be an object.');
  const st = toStPreset(base);
  const s = isObject(raw.settings) ? raw.settings : {};
  const num = (v: unknown, fallback: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const used = Array.isArray(raw.prompts) ? raw.prompts.filter(isObject) : [];
  const unused = Array.isArray(raw.prompts_unused) ? raw.prompts_unused.filter(isObject) : [];
  const old = new Map(base.prompts.map((x) => [x.identifier, x]));
  const toSt = (x: Record<string, unknown>) => {
    const id = str(x.id);
    const was = old.get(id);
    const pos = isObject(x.position) ? x.position : null;
    const inChat = pos ? pos.type === 'in_chat' : was?.injectionPosition === 1;
    return {
      identifier: id,
      name: str(x.name) || was?.name || id,
      role: x.role === 'user' || x.role === 'assistant' ? x.role : 'system',
      content: typeof x.content === 'string' ? x.content : (was?.content ?? ''),
      system_prompt: was?.systemPrompt ?? false,
      marker: was?.marker ?? PLACEHOLDERS.includes(id),
      injection_position: inChat ? 1 : 0,
      injection_depth: num(pos?.depth, was?.injectionDepth ?? 4),
      injection_order: num(pos?.order, was?.injectionOrder ?? 100),
      forbid_overrides: isObject(x.extra) && x.extra.forbid_overrides === true ? true : (was?.forbidOverrides ?? false),
    };
  };
  const prompts = [...used, ...unused].filter((x) => str(x.id)).map(toSt);
  const effort = typeof s.reasoning_effort === 'string' && s.reasoning_effort !== 'auto' ? s.reasoning_effort : undefined;
  const names = ['none', 'default', 'completion', 'content'].indexOf(str(s.character_name_prefix));
  const merged: Record<string, unknown> = {
    ...st,
    temperature: num(s.temperature, st.temperature),
    top_p: num(s.top_p, st.top_p),
    top_k: num(s.top_k, st.top_k),
    top_a: num(s.top_a, st.top_a),
    min_p: num(s.min_p, st.min_p),
    frequency_penalty: num(s.frequency_penalty, st.frequency_penalty),
    presence_penalty: num(s.presence_penalty, st.presence_penalty),
    repetition_penalty: num(s.repetition_penalty, st.repetition_penalty),
    openai_max_tokens: num(s.max_completion_tokens, st.openai_max_tokens),
    openai_max_context: num(s.max_context, st.openai_max_context),
    seed: num(s.seed, st.seed),
    squash_system_messages: typeof s.squash_system_messages === 'boolean' ? s.squash_system_messages : st.squash_system_messages,
    names_behavior: names >= 0 ? names - 1 : st.names_behavior,
    reasoning_effort: effort,
    prompts,
    prompt_order: [{ character_id: 100001, order: used.filter((x) => str(x.id)).map((x) => ({ identifier: str(x.id), enabled: x.enabled !== false })) }],
    extensions: isObject(raw.extensions) ? raw.extensions : (isObject(st.extensions) ? st.extensions : {}),
  };
  if (!effort) delete merged.reasoning_effort;
  const parsed = parseStPreset(merged, base.name);
  return { ...parsed, id: base.id, name: base.name, importedAt: base.importedAt };
}

// ─── Regex scripts ──────────────────────────────────────────────────────────

/** Regex scripts (as SillyTavern stores them) as Tavern Helper's
 *  TavernRegex. */
export function thRegexes(raw: unknown, scope: 'global' | 'character'): Record<string, unknown>[] {
  const scripts = parseRegexScripts(raw);
  return scripts.map((s, i) => ({
    id: s.id ?? `regex-${i}`,
    script_name: s.scriptName,
    enabled: !s.disabled,
    scope,
    find_regex: s.findRegex,
    replace_string: s.replaceString,
    trim_strings: s.trimStrings,
    source: {
      user_input: s.placement.includes(REGEX_PLACEMENT.userInput),
      ai_output: s.placement.includes(REGEX_PLACEMENT.aiOutput),
      slash_command: s.placement.includes(REGEX_PLACEMENT.slashCommand),
      world_info: s.placement.includes(REGEX_PLACEMENT.worldInfo),
      reasoning: s.placement.includes(REGEX_PLACEMENT.reasoning),
    },
    destination: { display: !s.promptOnly || s.markdownOnly, prompt: !s.markdownOnly || s.promptOnly },
    run_on_edit: true,
    min_depth: s.minDepth ?? null,
    max_depth: s.maxDepth ?? null,
  }));
}

/** Tavern Helper's TavernRegex list back as SillyTavern stores scripts. */
export function fromThRegexes(list: unknown): Record<string, unknown>[] {
  if (!Array.isArray(list)) throw new Error('Regexes need to be a list.');
  return list.filter(isObject).map((r) => {
    const src = isObject(r.source) ? r.source : {};
    const dst = isObject(r.destination) ? r.destination : { display: true, prompt: true };
    const display = dst.display !== false;
    const prompt = dst.prompt !== false;
    const placement = (
      [
        ['user_input', REGEX_PLACEMENT.userInput],
        ['ai_output', REGEX_PLACEMENT.aiOutput],
        ['slash_command', REGEX_PLACEMENT.slashCommand],
        ['world_info', REGEX_PLACEMENT.worldInfo],
        ['reasoning', REGEX_PLACEMENT.reasoning],
      ] as const
    )
      .filter(([k]) => src[k] === true)
      .map(([, n]) => n);
    return {
      id: str(r.id) || undefined,
      scriptName: str(r.script_name),
      findRegex: str(r.find_regex),
      replaceString: str(r.replace_string),
      trimStrings: Array.isArray(r.trim_strings) ? r.trim_strings.filter((t) => typeof t === 'string') : [],
      placement,
      disabled: r.enabled === false || (!display && !prompt),
      markdownOnly: display && !prompt,
      promptOnly: prompt && !display,
      runOnEdit: r.run_on_edit !== false,
      substituteRegex: 0,
      minDepth: typeof r.min_depth === 'number' ? r.min_depth : null,
      maxDepth: typeof r.max_depth === 'number' ? r.max_depth : null,
    };
  });
}

// ─── Script frames ──────────────────────────────────────────────────────────

/** The libraries Tavern Helper gives scripts (lodash's `_`, jQuery's `$`). */
const SCRIPT_LIBS = ['https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js'];

const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** The document a script runs in: what it reads at start (`boot`), the
 *  libraries, Tavern Helper's API (the runtime's text: a sandboxed frame
 *  isn't let load it from UCCB itself), then the script. */
export function scriptSrcdoc(script: TavernScript, boot: Record<string, unknown>, runtime: string): string {
  const libs = SCRIPT_LIBS.map((src) => `<script src="${src}"></script>`).join('');
  // The script's text can't end its own <script> early.
  const code = script.content.replace(/<\/(script)/gi, '<\\/$1');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><script>window.__TH_BOOT=${jsonForScript(boot)}</script>${libs}<script>${runtime.replace(/<\/(script)/gi, '<\\/$1')}</script></head><body><script>${code}\n</script></body></html>`;
}

/** generateRaw's prompt: its own order of placeholders and role prompts
 *  (or Tavern Helper's default order), filled from `parts`. */
export type RawPlaceholder = 'world_info_before' | 'persona_description' | 'char_description' | 'char_personality' | 'scenario' | 'world_info_after' | 'dialogue_examples' | 'chat_history' | 'user_input';
export const RAW_DEFAULT_ORDER: RawPlaceholder[] = ['world_info_before', 'persona_description', 'char_description', 'char_personality', 'scenario', 'world_info_after', 'dialogue_examples', 'chat_history', 'user_input'];

export function rawPrompt(
  ordered: unknown,
  parts: Partial<Record<Exclude<RawPlaceholder, 'chat_history' | 'user_input'>, string>> & { history: { role: 'system' | 'user' | 'assistant'; content: string }[]; userInput?: string },
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const list = Array.isArray(ordered) && ordered.length ? ordered : RAW_DEFAULT_ORDER;
  const out: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  for (const item of list) {
    if (isObject(item)) {
      const role = item.role === 'user' || item.role === 'assistant' ? item.role : 'system';
      if (str(item.content).trim()) out.push({ role, content: str(item.content) });
    } else if (item === 'chat_history') out.push(...parts.history);
    else if (item === 'user_input') {
      if (parts.userInput?.trim()) out.push({ role: 'user', content: parts.userInput });
    } else if (typeof item === 'string') {
      const text = parts[item as keyof typeof parts];
      if (typeof text === 'string' && text.trim()) out.push({ role: 'system', content: text });
    }
  }
  return out;
}

// ─── Prompt injections ──────────────────────────────────────────────────────

export interface ThInjection {
  id: string;
  /** 'none' keeps it out of the prompt (it's only for the lorebook's scan in SillyTavern). */
  position: 'in_chat' | 'none';
  depth: number;
  role: 'system' | 'assistant' | 'user';
  content: string;
}

/** Messages with injections put in at their depths (0: after the last). */
export function withInjections<T extends { role: string; content: unknown }>(messages: T[], injections: ThInjection[], make: (i: ThInjection) => T): T[] {
  const out = [...messages];
  // Deepest first, so each depth counts from the original end.
  const list = injections.filter((i) => i.position === 'in_chat' && i.content.trim()).sort((a, b) => b.depth - a.depth);
  for (const i of list) out.splice(Math.max(0, out.length - Math.max(0, i.depth)), 0, make(i));
  return out;
}
