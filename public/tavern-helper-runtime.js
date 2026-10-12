// Tavern Helper (JS-Slash-Runner) for scripts running in UCCB's chat.
//
// Each script a preset or card carries runs in a sandboxed frame of its own
// (components/dock/TavernScripts.tsx), with this file loaded first. It gives
// the script Tavern Helper's API (getVariables, getChatMessages, eventOn,
// generate, getPreset, getTavernRegexes, injectPrompts, script buttons…),
// answered by the chat over postMessage. Tavern Helper's getters are
// synchronous, so the frame keeps a copy of what they read (the chat,
// variables, the preset and regexes), which the chat keeps up to date;
// writes change the copy at once and are sent to the chat to keep.
//
// What isn't here: SillyTavern itself (SillyTavern.getContext, its page
// and slash commands beyond a few), lorebooks, presets other than the one in
// use, and globals shared between scripts.

(() => {
  'use strict';
  const boot = window.__TH_BOOT || {};
  const host = window.parent;
  const state = boot.state || {};
  let buttons = Array.isArray(boot.buttons) ? boot.buttons : [];
  let seq = 0;
  const pending = new Map();

  const post = (m) => host.postMessage(Object.assign({ uccbTh: 1 }, m), '*');
  const call = (method, args) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      post({ id, method, args: plain(args) });
    });
  /** A copy that survives postMessage (functions and the like left out). */
  const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
  const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

  // ─── Small object helpers (what Tavern Helper does with lodash) ──────────

  const pathOf = (path) => (Array.isArray(path) ? path.map(String) : String(path).replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean));
  function getPath(obj, path) {
    let cur = obj;
    for (const k of pathOf(path)) {
      if (cur === null || typeof cur !== 'object' || !(k in cur)) return undefined;
      cur = cur[k];
    }
    return cur;
  }
  function unsetPath(obj, path) {
    const keys = pathOf(path);
    const last = keys.pop();
    const parent = keys.length ? getPath(obj, keys) : obj;
    if (parent === null || typeof parent !== 'object' || !(last in parent)) return false;
    if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else delete parent[last];
    return true;
  }
  function merge(target, source) {
    if (!isObj(source)) return target;
    for (const [k, v] of Object.entries(source)) {
      if (isObj(v) && isObj(target[k])) merge(target[k], v);
      else target[k] = clone(v);
    }
    return target;
  }
  function defaultsDeep(target, source) {
    if (!isObj(source)) return target;
    for (const [k, v] of Object.entries(source)) {
      if (!(k in target)) target[k] = clone(v);
      else if (isObj(v) && isObj(target[k])) defaultsDeep(target[k], v);
    }
    return target;
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  const listeners = new Map();
  function addListener(type, fn, first, once) {
    if (typeof fn !== 'function') throw new Error('A listener needs to be a function.');
    const list = listeners.get(type) || [];
    const entry = { fn, once };
    if (first) list.unshift(entry);
    else list.push(entry);
    listeners.set(type, list);
    return { stop: () => eventRemoveListener(type, fn) };
  }
  async function emitHere(type, args) {
    const list = (listeners.get(type) || []).slice();
    for (const l of list) {
      if (l.once) eventRemoveListener(type, l.fn);
      try {
        await l.fn(...args);
      } catch (err) {
        console.error(`[${boot.scriptName}] ${type} listener:`, err);
      }
    }
  }
  const eventOn = (type, fn) => addListener(type, fn, false, false);
  const eventMakeLast = (type, fn) => addListener(type, fn, false, false);
  const eventMakeFirst = (type, fn) => addListener(type, fn, true, false);
  const eventOnce = (type, fn) => addListener(type, fn, false, true);
  function eventRemoveListener(type, fn) {
    const list = listeners.get(type);
    if (list) listeners.set(type, list.filter((l) => l.fn !== fn));
  }
  const eventClearEvent = (type) => listeners.delete(type);
  const eventClearListener = (fn) => {
    for (const type of listeners.keys()) eventRemoveListener(type, fn);
  };
  const eventClearAll = () => listeners.clear();
  /** Other scripts hear it too (the chat passes it on). */
  async function eventEmit(type, ...args) {
    post({ method: 'emit', args: plain({ type, args }) });
    await emitHere(type, args);
  }
  const eventEmitAndWait = (type, ...args) => {
    void eventEmit(type, ...args);
  };
  const getButtonEvent = (name) => String(name);
  const eventOnButton = (name, fn) => eventOn(getButtonEvent(name), fn);

  const iframe_events = {
    MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
    MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
    GENERATION_REQUESTED: 'js_generation_requested',
    GENERATION_STARTED: 'js_generation_started',
    STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
    GENERATION_ENDED: 'js_generation_ended',
  };
  const tavern_events = {
    APP_READY: 'app_ready',
    EXTRAS_CONNECTED: 'extras_connected',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_UPDATED: 'message_updated',
    MESSAGE_FILE_EMBEDDED: 'message_file_embedded',
    MESSAGE_REASONING_EDITED: 'message_reasoning_edited',
    MESSAGE_REASONING_DELETED: 'message_reasoning_deleted',
    MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
    MORE_MESSAGES_LOADED: 'more_messages_loaded',
    IMPERSONATE_READY: 'impersonate_ready',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
    GENERATION_STARTED: 'generation_started',
    GENERATION_STOPPED: 'generation_stopped',
    GENERATION_ENDED: 'generation_ended',
    SD_PROMPT_PROCESSING: 'sd_prompt_processing',
    EXTENSIONS_FIRST_LOAD: 'extensions_first_load',
    EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
    SETTINGS_LOADED: 'settings_loaded',
    SETTINGS_UPDATED: 'settings_updated',
    MOVABLE_PANELS_RESET: 'movable_panels_reset',
    SETTINGS_LOADED_BEFORE: 'settings_loaded_before',
    SETTINGS_LOADED_AFTER: 'settings_loaded_after',
    CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed',
    CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed',
    OAI_PRESET_CHANGED_BEFORE: 'oai_preset_changed_before',
    OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after',
    OAI_PRESET_EXPORT_READY: 'oai_preset_export_ready',
    OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready',
    WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    CHARACTER_EDITOR_OPENED: 'character_editor_opened',
    CHARACTER_EDITED: 'character_edited',
    CHARACTER_PAGE_LOADED: 'character_page_loaded',
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    FORCE_SET_BACKGROUND: 'force_set_background',
    CHAT_DELETED: 'chat_deleted',
    CHAT_CREATED: 'chat_created',
    GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
    GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
    GENERATE_AFTER_DATA: 'generate_after_data',
    WORLD_INFO_ACTIVATED: 'world_info_activated',
    TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    CHARACTER_FIRST_MESSAGE_SELECTED: 'character_first_message_selected',
    CHARACTER_DELETED: 'characterDeleted',
    CHARACTER_DUPLICATED: 'character_duplicated',
    CHARACTER_RENAMED: 'character_renamed',
    CHARACTER_RENAMED_IN_PAST_CHAT: 'character_renamed_in_past_chat',
    SMOOTH_STREAM_TOKEN_RECEIVED: 'stream_token_received',
    STREAM_TOKEN_RECEIVED: 'stream_token_received',
    STREAM_REASONING_DONE: 'stream_reasoning_done',
    FILE_ATTACHMENT_DELETED: 'file_attachment_deleted',
    WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate',
    OPEN_CHARACTER_LIBRARY: 'open_character_library',
    ONLINE_STATUS_CHANGED: 'online_status_changed',
    IMAGE_SWIPED: 'image_swiped',
    CONNECTION_PROFILE_LOADED: 'connection_profile_loaded',
    CONNECTION_PROFILE_CREATED: 'connection_profile_created',
    CONNECTION_PROFILE_DELETED: 'connection_profile_deleted',
    CONNECTION_PROFILE_UPDATED: 'connection_profile_updated',
    TOOL_CALLS_PERFORMED: 'tool_calls_performed',
    TOOL_CALLS_RENDERED: 'tool_calls_rendered',
    CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown',
    SECRET_WRITTEN: 'secret_written',
    SECRET_DELETED: 'secret_deleted',
    SECRET_ROTATED: 'secret_rotated',
    SECRET_EDITED: 'secret_edited',
    PRESET_CHANGED: 'preset_changed',
    PRESET_DELETED: 'preset_deleted',
    PRESET_RENAMED: 'preset_renamed',
    PRESET_RENAMED_BEFORE: 'preset_renamed_before',
    MAIN_API_CHANGED: 'main_api_changed',
    WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
    WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
    MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
  };

  // ─── Chat messages ───────────────────────────────────────────────────────

  const chat = () => state.chat || [];
  const getLastMessageId = () => chat().length - 1;
  function range(r) {
    const last = getLastMessageId();
    const m = String(r).trim().match(/^(-?\d+)(?:\s*-\s*(-?\d+))?$/);
    if (!m || last < 0) return null;
    const at = (n) => (n < 0 ? last + 1 + n : n);
    let a = at(Number(m[1]));
    let b = m[2] === undefined ? a : at(Number(m[2]));
    if (a > b) [a, b] = [b, a];
    a = Math.max(0, a);
    b = Math.min(last, b);
    return a > b ? null : [a, b];
  }
  function getChatMessages(r, opt) {
    const o = opt || {};
    const span = range(r);
    if (!span) return [];
    return chat()
      .slice(span[0], span[1] + 1)
      .filter((m) => !o.role || o.role === 'all' || m.role === o.role)
      .filter((m) => !o.hide_state || o.hide_state === 'all' || (o.hide_state === 'hidden') === m.is_hidden)
      .map((m) =>
        clone(
          o.include_swipes
            ? { message_id: m.message_id, name: m.name, role: m.role, is_hidden: m.is_hidden, swipe_id: m.swipe_id, swipes: m.swipes, swipes_data: m.swipes_data, swipes_info: m.swipes.map(() => ({})) }
            : { message_id: m.message_id, name: m.name, role: m.role, is_hidden: m.is_hidden, message: m.message, data: m.data, extra: m.extra },
        ),
      );
  }
  async function setChatMessages(list, opt) {
    for (const change of list || []) {
      const m = chat()[change.message_id];
      if (!m) continue;
      if (typeof change.message === 'string') {
        m.message = change.message;
        m.swipes[m.swipe_id] = change.message;
      }
      if (isObj(change.data)) m.data = m.swipes_data[m.swipe_id] = clone(change.data);
      if (typeof change.is_hidden === 'boolean') m.is_hidden = change.is_hidden;
    }
    await call('setChatMessages', { messages: list, refresh: opt && opt.refresh });
  }
  const createChatMessages = (list, opt) => call('createChatMessages', { messages: list, insert_before: opt ? (opt.insert_before ?? opt.insert_at) : undefined });
  const deleteChatMessages = (ids) => call('deleteChatMessages', { ids });
  const rotateChatMessages = () => Promise.reject(new Error('rotateChatMessages is not supported in UCCB.'));

  // ─── Variables ───────────────────────────────────────────────────────────

  const vars = () => (state.vars = state.vars || {});
  function messageFor(id) {
    const last = getLastMessageId();
    const n = id === undefined || id === 'latest' ? last : Number(id) < 0 ? last + 1 + Number(id) : Number(id);
    return chat()[n];
  }
  function readVars(opt) {
    const type = (opt && opt.type) || 'chat';
    if (type === 'message') {
      const m = messageFor(opt.message_id);
      return m ? m.data || {} : {};
    }
    if (type === 'extension') return {};
    return vars()[type] || {};
  }
  function writeVars(opt, value) {
    const type = (opt && opt.type) || 'chat';
    const v = clone(value) || {};
    if (type === 'message') {
      const m = messageFor(opt.message_id);
      if (!m) throw new Error(`There's no message ${opt.message_id}.`);
      m.data = m.swipes_data[m.swipe_id] = v;
      post({ method: 'setVars', args: plain({ type, message_id: m.message_id, vars: v }) });
      return;
    }
    if (type === 'extension') throw new Error('Extension variables are not supported in UCCB.');
    vars()[type] = v;
    post({ method: 'setVars', args: plain({ type, vars: v }) });
  }
  const getVariables = (opt) => clone(readVars(opt));
  const replaceVariables = (value, opt) => writeVars(opt, value);
  function updateVariablesWith(updater, opt) {
    const current = getVariables(opt);
    const out = updater(current);
    if (out && typeof out.then === 'function')
      return out.then((v) => {
        writeVars(opt, v || current);
        return v || current;
      });
    writeVars(opt, out || current);
    return out || current;
  }
  const insertOrAssignVariables = (value, opt) => updateVariablesWith((v) => merge(v, value), opt);
  const insertVariables = (value, opt) => updateVariablesWith((v) => defaultsDeep(v, value), opt);
  function deleteVariable(path, opt) {
    let deleted = false;
    const variables = updateVariablesWith((v) => {
      deleted = unsetPath(v, path);
      return v;
    }, opt);
    return { variables, delete_occurred: deleted };
  }
  function getAllVariables() {
    const last = messageFor('latest');
    return [vars().global, vars().preset, vars().character, vars().script, vars().chat, last && last.data].reduce((acc, v) => merge(acc, v || {}), {});
  }
  const registerVariableSchema = () => {};

  // ─── Presets ─────────────────────────────────────────────────────────────

  const inUse = (name) => name === undefined || name === 'in_use' || name === state.presetName;
  function getPreset(name) {
    if (!inUse(name)) throw new Error(`Only the preset in use can be read in UCCB (asked for "${name}").`);
    if (!state.preset) throw new Error('No preset is in use.');
    return clone(state.preset);
  }
  async function replacePreset(name, preset) {
    if (inUse(name)) state.preset = clone(preset);
    await call('replacePreset', { name: inUse(name) ? 'in_use' : name, preset });
  }
  async function updatePresetWith(name, updater) {
    const next = await updater(getPreset(name));
    await replacePreset(name, next);
    return next;
  }
  const setPreset = (name, partial) => updatePresetWith(name, (p) => merge(p, partial));
  const getPresetNames = () => (state.presetNames || []).slice();
  const getLoadedPresetName = () => state.presetName || '';
  function loadPreset(name) {
    if (!getPresetNames().includes(name)) return false;
    post({ method: 'loadPreset', args: { name } });
    return true;
  }
  const unsupported = (what) => () => Promise.reject(new Error(`${what} is not supported in UCCB.`));
  const SYSTEM = ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'];
  const PLACE = ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'];
  const isPresetSystemPrompt = (p) => SYSTEM.includes(p.id);
  const isPresetPlaceholderPrompt = (p) => PLACE.includes(p.id);
  const isPresetNormalPrompt = (p) => !isPresetSystemPrompt(p) && !isPresetPlaceholderPrompt(p);

  // ─── Regex scripts ───────────────────────────────────────────────────────

  function regexKind(opt) {
    const o = opt || {};
    const t = o.type || o.scope;
    return t === 'preset' ? 'preset' : t === 'character' || t === 'all' ? 'character' : 'global';
  }
  const getTavernRegexes = (opt) => {
    const kind = regexKind(opt);
    return kind === 'global' ? [] : clone((state.regexes && state.regexes[kind]) || []);
  };
  async function replaceTavernRegexes(list, opt) {
    const kind = regexKind(opt);
    if (kind === 'global') throw new Error("UCCB has no global regex scripts; use the preset's or the character's.");
    state.regexes = state.regexes || {};
    state.regexes[kind] = clone(list);
    await call('replaceRegexes', { kind, regexes: list });
  }
  async function updateTavernRegexesWith(updater, opt) {
    const next = await updater(getTavernRegexes(opt));
    await replaceTavernRegexes(next, opt);
    return next;
  }
  const isCharacterTavernRegexesEnabled = () => state.cardRegexOn !== false;
  // Running regex scripts is the chat's job; text comes back as it went.
  const formatAsTavernRegexedString = (text) => text;

  // ─── Generating, prompts, the rest ───────────────────────────────────────

  const generate = (config) => call('generate', { config: config || {}, raw: false });
  const generateRaw = (config) => call('generate', { config: config || {}, raw: true });
  const stopAllGeneration = () => {
    post({ method: 'stop' });
    return true;
  };
  const stopGenerationById = () => stopAllGeneration();
  function injectPrompts(prompts, opt) {
    const list = (prompts || []).map((p) => ({ id: String(p.id), position: p.position === 'none' ? 'none' : 'in_chat', depth: Number(p.depth) || 0, role: p.role || 'system', content: String(p.content || '') }));
    post({ method: 'inject', args: { prompts: list, once: !!(opt && opt.once) } });
    return { uninject: () => uninjectPrompts(list.map((p) => p.id)) };
  }
  const uninjectPrompts = (ids) => post({ method: 'uninject', args: { ids: (ids || []).map(String) } });
  const triggerSlash = (command) => call('slash', { command: String(command) });
  function substitudeMacros(text) {
    const names = state.names || {};
    return String(text)
      .replace(/\{\{char\}\}/gi, names.char || '')
      .replace(/\{\{user\}\}/gi, names.user || '')
      .replace(/\{\{lastMessageId\}\}/gi, String(getLastMessageId()))
      .replace(/\{\{newline\}\}/gi, '\n')
      .replace(/\{\{getvar::([^}]+)\}\}/gi, (_, k) => fmt(getPath(vars().chat || {}, k.trim())))
      .replace(/\{\{getglobalvar::([^}]+)\}\}/gi, (_, k) => fmt(getPath(vars().global || {}, k.trim())));
  }
  const fmt = (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
  function errorCatched(fn) {
    const report = (err) => {
      toastr.error(String((err && err.message) || err));
      throw err;
    };
    return (...args) => {
      try {
        const out = fn(...args);
        return out && typeof out.then === 'function' ? out.catch(report) : out;
      } catch (err) {
        return report(err);
      }
    };
  }
  const say = (tone) => (text) => post({ method: 'toast', args: { tone, text: String(text) } });
  const toastr = { info: say('info'), success: say('success'), warning: say('info'), error: say('error'), clear() {}, remove() {} };

  // Script buttons, shown above the chat's message box.
  const getScriptButtons = () => clone(buttons);
  function replaceScriptButtons(list) {
    buttons = clone(list || []).map((b) => ({ name: String(b.name), visible: b.visible !== false }));
    post({ method: 'buttons', args: { buttons } });
  }
  function updateScriptButtonsWith(updater) {
    const out = updater(getScriptButtons());
    if (out && typeof out.then === 'function') return out.then((b) => (replaceScriptButtons(b), b));
    replaceScriptButtons(out);
    return out;
  }
  const appendInexistentScriptButtons = (list) => replaceScriptButtons([...buttons, ...(list || []).filter((b) => !buttons.some((x) => x.name === b.name))]);
  const getAllEnabledScriptButtons = () => ({ [boot.scriptId]: buttons.filter((b) => b.visible).map((b) => ({ button_id: b.name, button_name: b.name })) });

  const globals = {};
  const initializeGlobal = (name, value) => {
    globals[name] = value;
    window[name] = value;
  };
  const waitGlobalInitialized = (name) =>
    new Promise((resolve) => {
      const check = () => (name in globals ? resolve(globals[name]) : setTimeout(check, 200));
      check();
    });

  const TavernHelper = {
    getChatMessages, setChatMessages, createChatMessages, deleteChatMessages, rotateChatMessages, getLastMessageId,
    getVariables, replaceVariables, updateVariablesWith, insertOrAssignVariables, insertVariables, deleteVariable, getAllVariables, registerVariableSchema,
    eventOn, eventOnce, eventMakeFirst, eventMakeLast, eventEmit, eventEmitAndWait, eventRemoveListener, eventClearEvent, eventClearListener, eventClearAll, eventOnButton, getButtonEvent,
    tavern_events, iframe_events,
    getPreset, replacePreset, updatePresetWith, setPreset, getPresetNames, getLoadedPresetName, loadPreset,
    createPreset: unsupported('createPreset'), createOrReplacePreset: unsupported('createOrReplacePreset'), deletePreset: unsupported('deletePreset'), renamePreset: unsupported('renamePreset'),
    isPresetNormalPrompt, isPresetSystemPrompt, isPresetPlaceholderPrompt,
    getTavernRegexes, replaceTavernRegexes, updateTavernRegexesWith, isCharacterTavernRegexesEnabled, formatAsTavernRegexedString,
    generate, generateRaw, stopAllGeneration, stopGenerationById,
    injectPrompts, uninjectPrompts, triggerSlash, substitudeMacros, errorCatched,
    getScriptButtons, replaceScriptButtons, updateScriptButtonsWith, appendInexistentScriptButtons, getAllEnabledScriptButtons,
    getScriptId: () => boot.scriptId, getScriptName: () => boot.scriptName, getScriptInfo: () => boot.scriptInfo || '', replaceScriptInfo: () => {},
    getIframeName: () => `TH-script--${boot.scriptId}`, getCurrentMessageId: () => -1, getMessageId: () => -1,
    reloadIframe: () => post({ method: 'reload' }),
    registerMacroLike: () => ({ unregister() {} }), unregisterMacroLike: () => {},
    initializeGlobal, waitGlobalInitialized,
    builtin: {
      uuidv4: () => crypto.randomUUID(),
      copyText: (t) => navigator.clipboard && navigator.clipboard.writeText(String(t)).catch(() => {}),
      duringGenerating: () => !!state.busy,
      parseRegexFromString: (s) => {
        const m = String(s).match(/^\/([\s\S]+)\/([dgimsuvy]*)$/);
        try {
          return m ? new RegExp(m[1], m[2]) : null;
        } catch {
          return null;
        }
      },
      renderMarkdown: (t) => String(t),
    },
  };
  Object.assign(window, TavernHelper, { TavernHelper, toastr });

  // Pages written for SillyTavern reach for its page through `parent`; they
  // get a little page of their own instead (nothing in it is shown).
  const stand = new Proxy(
    {},
    {
      get(_, k) {
        if (k === 'document') return standDoc;
        if (k === 'window' || k === 'parent' || k === 'self') return stand;
        if (k === 'TavernHelper') return TavernHelper;
        if (k === 'toastr') return toastr;
        if (k === 'postMessage') return host.postMessage.bind(host);
        if (typeof k === 'string' && k in TavernHelper) return TavernHelper[k];
        // Anything else is this frame's own (addEventListener, setTimeout…).
        const own = window[k];
        return typeof own === 'function' ? own.bind(window) : own;
      },
    },
  );
  // A sandboxed frame has no storage of its own; scripts get one that lasts
  // as long as the frame.
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      void window[name];
    } catch {
      const mem = new Map();
      const storage = {
        getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
        setItem: (k, v) => void mem.set(String(k), String(v)),
        removeItem: (k) => void mem.delete(String(k)),
        clear: () => mem.clear(),
        key: (i) => [...mem.keys()][i] ?? null,
        get length() {
          return mem.size;
        },
      };
      Object.defineProperty(window, name, { configurable: true, value: storage });
    }
  }
  const standDoc = document.implementation.createHTMLDocument('SillyTavern');
  Object.defineProperty(window, 'parent', { configurable: true, value: stand });

  // ─── From the chat ───────────────────────────────────────────────────────

  window.addEventListener('message', async (e) => {
    if (e.source !== host) return;
    const m = e.data;
    if (!m || m.uccbTh !== 1) return;
    if (typeof m.result === 'number') {
      const p = pending.get(m.result);
      if (!p) return;
      pending.delete(m.result);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.value);
    } else if (m.state) {
      Object.assign(state, m.state);
    } else if (typeof m.event === 'string') {
      const args = Array.isArray(m.args) ? m.args : [];
      await emitHere(m.event, args);
      // An event the chat waits on (the prompt about to be sent): what the
      // listeners made of its data goes back.
      if (typeof m.ack === 'number') post({ ack: m.ack, value: plain(args[0]) });
    }
  });
})();
