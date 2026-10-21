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
    if (inUse(name)) {
      if (!state.preset) throw new Error('No preset is in use.');
      return clone(state.preset);
    }
    const p = (state.allPresets || {})[name];
    if (!p) throw new Error(`There's no preset "${name}".`);
    return clone(p);
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
    createPreset: (name, preset) => call('createPreset', { name, preset, replace: false }),
    createOrReplacePreset: (name, preset) => call('createPreset', { name, preset, replace: true }),
    deletePreset: (name) => call('deletePreset', { name }),
    renamePreset: (name, newName) => call('renamePreset', { name, newName }),
    get default_preset() {
      return clone(state.defaultPreset);
    },
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
  Object.defineProperty(window, 'default_preset', { configurable: true, get: () => clone(state.defaultPreset) });

  // A sandboxed frame has no storage of its own. A script's localStorage is
  // kept by the chat (with its settings, per script) and comes back the next
  // time it runs; its sessionStorage lasts as long as the frame.
  function makeStorage(initial, onChange) {
    const mem = new Map(Object.entries(initial || {}).map(([k, v]) => [String(k), String(v)]));
    const changed = () => onChange && onChange(Object.fromEntries(mem));
    return {
      getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
      setItem: (k, v) => {
        mem.set(String(k), String(v));
        changed();
      },
      removeItem: (k) => {
        if (mem.delete(String(k))) changed();
      },
      clear: () => {
        mem.clear();
        changed();
      },
      key: (i) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size;
      },
    };
  }
  let storageTimer = null;
  const keepStorage = (items) => {
    clearTimeout(storageTimer);
    storageTimer = setTimeout(() => post({ method: 'storage', args: { items } }), 400);
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: makeStorage(boot.storage, keepStorage) });
  try {
    void window.sessionStorage;
  } catch {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: makeStorage({}, null) });
  }

  // ─── SillyTavern's server ────────────────────────────────────────────────
  //
  // Scripts call SillyTavern's own server (/api/…) with fetch or jQuery's
  // ajax. A sandboxed frame can't reach UCCB's, so those calls go to the
  // chat instead, which answers the ones it can as SillyTavern would (the
  // model list, world info, the character, the chat, settings) and says
  // which it can't.

  const appOrigin = (() => {
    try {
      return new URL(document.baseURI).origin;
    } catch {
      return '';
    }
  })();
  function apiPath(input) {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url ? input.url : String(input);
      const u = new URL(raw, document.baseURI);
      return u.origin === appOrigin && u.pathname.startsWith('/api/') ? u.pathname : null;
    } catch {
      return null;
    }
  }
  const parseBody = (body) => {
    if (typeof body !== 'string') return body === undefined ? undefined : null;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  };
  const answerApi = (path, method, body) =>
    call('stApi', { path, method: String(method || 'GET').toUpperCase(), body }).catch((err) => ({ status: 500, body: { error: String((err && err.message) || err) } }));
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const path = apiPath(input);
    if (!path) return realFetch(input, init);
    let body = init && init.body;
    if (body === undefined && input instanceof Request) body = await input.clone().text();
    const method = (init && init.method) || (input instanceof Request ? input.method : 'GET');
    const r = await answerApi(path, method, parseBody(body));
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? null);
    return new Response(text, { status: r.status || 200, headers: { 'Content-Type': typeof r.body === 'string' ? 'text/plain' : 'application/json' } });
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const path = apiPath(url);
    this.__uccbApi = path ? { method, path } : null;
    if (!path) return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (...args) {
    if (!this.__uccbApi) return xhrHeader.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const req = this.__uccbApi;
    if (!req) return xhrSend.call(this, body);
    void answerApi(req.path, req.method, parseBody(body)).then((r) => {
      const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? null);
      const set = (k, v) => Object.defineProperty(this, k, { configurable: true, value: v });
      set('readyState', 4);
      set('status', r.status || 200);
      set('statusText', (r.status || 200) < 400 ? 'OK' : 'Error');
      set('responseText', text);
      set('response', this.responseType === 'json' ? parseBody(text) : text);
      this.getResponseHeader = (h) => (/content-type/i.test(h) ? 'application/json' : null);
      this.getAllResponseHeaders = () => 'content-type: application/json\r\n';
      for (const type of ['readystatechange', 'load', 'loadend']) this.dispatchEvent(new Event(type));
    });
  };

  // ─── Lorebooks (Tavern Helper's worldbooks) ──────────────────────────────
  //
  // The card's lorebook and those in UCCB's Lorebooks bank, by name. Names
  // and bindings are kept here (they're read synchronously); entries are
  // asked of the chat each time.

  const wb = () => state.worldbooks || { names: [], global: [], charPrimary: null, charAdditional: [], chat: null };
  const getWorldbookNames = () => wb().names.slice();
  const getGlobalWorldbookNames = () => wb().global.slice();
  const getCharWorldbookNames = () => ({ primary: wb().charPrimary, additional: (wb().charAdditional || []).slice() });
  const getChatWorldbookName = () => wb().chat;
  const rebindGlobalWorldbooks = (names) => call('bindGlobalWorldbooks', { names });
  const rebindChatWorldbook = (_chat, name) => call('bindChatWorldbook', { name });
  const rebindCharWorldbooks = () => Promise.reject(new Error("In UCCB the character's lorebook is the card's own; it can't be swapped for another."));
  const getOrCreateChatWorldbook = async (_chat, name) => wb().chat || call('getOrCreateChatWorldbook', { name });
  const getWorldbook = (name) => call('getWorldbook', { name });
  const replaceWorldbook = (name, entries) => call('replaceWorldbook', { name, entries });
  const createWorldbook = async (name, entries) => (await call('createWorldbook', { name, entries: entries || [], replace: false })) === true;
  const createOrReplaceWorldbook = async (name, entries) => (await call('createWorldbook', { name, entries: entries || [], replace: true })) === true;
  const deleteWorldbook = async (name) => (await call('deleteWorldbook', { name })) === true;
  async function updateWorldbookWith(name, updater) {
    await replaceWorldbook(name, await updater(await getWorldbook(name)));
    return getWorldbook(name);
  }
  async function createWorldbookEntries(name, entries) {
    const book = await getWorldbook(name);
    const before = new Set(book.map((e) => e.uid));
    const fresh = (entries || []).map((e) => {
      const c = Object.assign({}, e);
      delete c.uid;
      return c;
    });
    await replaceWorldbook(name, [...book, ...fresh]);
    const after = await getWorldbook(name);
    return { worldbook: after, new_entries: after.filter((e) => !before.has(e.uid)) };
  }
  async function deleteWorldbookEntries(name, predicate) {
    const book = await getWorldbook(name);
    const gone = book.filter((e) => predicate(e));
    await replaceWorldbook(name, book.filter((e) => !gone.includes(e)));
    return { worldbook: await getWorldbook(name), deleted_entries: gone };
  }

  // The older lorebook functions, on top of the worldbook ones.
  function toLorebookEntry(w, i) {
    const p = w.position.type;
    return {
      uid: w.uid,
      display_index: i,
      comment: w.name,
      enabled: w.enabled,
      type: w.strategy.type,
      position: p === 'at_depth' ? `at_depth_as_${w.position.role}` : p === 'outlet' ? 'before_character_definition' : p,
      depth: p === 'at_depth' ? w.position.depth : null,
      order: w.position.order,
      probability: w.probability,
      keys: w.strategy.keys,
      logic: w.strategy.keys_secondary.logic,
      filters: w.strategy.keys_secondary.keys,
      scan_depth: w.strategy.scan_depth,
      case_sensitive: 'same_as_global',
      match_whole_words: 'same_as_global',
      use_group_scoring: 'same_as_global',
      automation_id: null,
      exclude_recursion: w.recursion.prevent_incoming,
      prevent_recursion: w.recursion.prevent_outgoing,
      delay_until_recursion: w.recursion.delay_until ?? false,
      content: w.content,
      group: '',
      group_prioritized: false,
      group_weight: 100,
      sticky: w.effect.sticky,
      cooldown: w.effect.cooldown,
      delay: w.effect.delay,
    };
  }
  function fromLorebookEntry(o) {
    const w = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(o, k);
    if (has('uid')) w.uid = o.uid;
    if (has('comment')) w.name = o.comment;
    if (has('enabled')) w.enabled = o.enabled;
    if (has('content')) w.content = o.content;
    if (has('probability')) w.probability = o.probability;
    const strategy = {};
    if (has('type')) strategy.type = o.type;
    if (has('keys')) strategy.keys = o.keys;
    if (has('logic') || has('filters')) strategy.keys_secondary = Object.assign({}, has('logic') ? { logic: o.logic } : {}, has('filters') ? { keys: o.filters } : {});
    if (has('scan_depth')) strategy.scan_depth = o.scan_depth;
    if (Object.keys(strategy).length) w.strategy = strategy;
    const position = {};
    if (has('position')) {
      const m = /^at_depth_as_(system|user|assistant)$/.exec(o.position);
      Object.assign(position, m ? { type: 'at_depth', role: m[1] } : { type: o.position });
    }
    if (has('depth') && o.depth !== null) position.depth = o.depth;
    if (has('order')) position.order = o.order;
    if (Object.keys(position).length) w.position = position;
    const recursion = {};
    if (has('exclude_recursion')) recursion.prevent_incoming = o.exclude_recursion;
    if (has('prevent_recursion')) recursion.prevent_outgoing = o.prevent_recursion;
    if (has('delay_until_recursion')) recursion.delay_until = o.delay_until_recursion === true ? 1 : o.delay_until_recursion || null;
    if (Object.keys(recursion).length) w.recursion = recursion;
    const effect = {};
    for (const k of ['sticky', 'cooldown', 'delay']) if (has(k)) effect[k] = o[k];
    if (Object.keys(effect).length) w.effect = effect;
    return w;
  }
  const getLorebookEntries = async (name) => (await getWorldbook(name)).map(toLorebookEntry);
  const replaceLorebookEntries = (name, entries) => replaceWorldbook(name, (entries || []).map(fromLorebookEntry));
  async function updateLorebookEntriesWith(name, updater) {
    await replaceLorebookEntries(name, await updater(await getLorebookEntries(name)));
    return getLorebookEntries(name);
  }
  async function setLorebookEntries(name, partials) {
    const byUid = new Map((partials || []).map((p) => [p.uid, p]));
    const book = await getWorldbook(name);
    await replaceWorldbook(name, book.map((w) => (byUid.has(w.uid) ? fromLorebookEntry(byUid.get(w.uid)) : { uid: w.uid })));
    return getLorebookEntries(name);
  }
  async function createLorebookEntries(name, entries) {
    const r = await createWorldbookEntries(name, (entries || []).map(fromLorebookEntry));
    return { entries: r.worldbook.map(toLorebookEntry), new_uids: r.new_entries.map((e) => e.uid) };
  }
  async function deleteLorebookEntries(name, uids) {
    const r = await deleteWorldbookEntries(name, (e) => (uids || []).includes(e.uid));
    return { entries: r.worldbook.map(toLorebookEntry), delete_occurred: r.deleted_entries.length > 0 };
  }
  const getLorebookSettings = () => clone(state.loreSettings || {});
  const setLorebookSettings = (patch) => post({ method: 'loreSettings', args: plain({ patch }) });
  const lorebookFunctions = {
    getWorldbookNames, getGlobalWorldbookNames, rebindGlobalWorldbooks, getCharWorldbookNames, rebindCharWorldbooks, getChatWorldbookName, rebindChatWorldbook, getOrCreateChatWorldbook,
    getWorldbook, createWorldbook, createOrReplaceWorldbook, deleteWorldbook, replaceWorldbook, updateWorldbookWith, createWorldbookEntries, deleteWorldbookEntries,
    getLorebooks: getWorldbookNames,
    getCharLorebooks: (o) => {
      const c = getCharWorldbookNames();
      const type = (o && o.type) || 'all';
      return type === 'primary' ? { primary: c.primary, additional: [] } : type === 'additional' ? { primary: null, additional: c.additional } : c;
    },
    getCurrentCharPrimaryLorebook: () => wb().charPrimary,
    setCurrentCharLorebooks: () => rebindCharWorldbooks(),
    getChatLorebook: getChatWorldbookName,
    setChatLorebook: (name) => rebindChatWorldbook('current', name),
    getOrCreateChatLorebook: (name) => getOrCreateChatWorldbook('current', name),
    createLorebook: (name) => createWorldbook(name),
    deleteLorebook: deleteWorldbook,
    getLorebookEntries, replaceLorebookEntries, updateLorebookEntriesWith, setLorebookEntries, createLorebookEntries, deleteLorebookEntries,
    getLorebookSettings, setLorebookSettings,
  };
  Object.assign(TavernHelper, lorebookFunctions);
  Object.assign(window, lorebookFunctions);

  // ─── SillyTavern's page ──────────────────────────────────────────────────
  //
  // Scripts written for SillyTavern reach for its page through `parent`
  // (Tavern Helper runs them in a frame of SillyTavern's own). Here this
  // frame is that page: `parent` is this window, the few parts of
  // SillyTavern's page scripts look for are in it (hidden), and what a
  // script shows on it (a floating button, a panel) is shown over UCCB's
  // chat: the frame covers the window, and the chat clips it to what's
  // showing, so clicks anywhere else go through (see report() below).

  Object.defineProperty(window, 'parent', { configurable: true, value: window });

  const box = document.getElementById('send_textarea');
  if (box) {
    const val = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(box, 'value', {
      configurable: true,
      get: () => val.get.call(box),
      set: (v) => {
        val.set.call(box, v);
        post({ method: 'input', args: { text: String(v) } });
      },
    });
    box.addEventListener('input', () => post({ method: 'input', args: { text: box.value } }));
  }
  const sendButton = document.getElementById('send_but');
  if (sendButton) sendButton.addEventListener('click', () => post({ method: 'submit', args: { text: box ? box.value : '' } }));

  /** SillyTavern's #chat (hidden), for scripts that read messages from it.
   *  What a script writes into a message's .mes_text there is shown in
   *  UCCB's chat in its place (see watchDisplays below). */
  let rendering = false;
  function renderChat() {
    const el = document.getElementById('chat');
    if (!el) return;
    rendering = true;
    el.textContent = '';
    for (const m of chat()) {
      const d = document.createElement('div');
      d.className = 'mes';
      d.setAttribute('mesid', String(m.message_id));
      d.setAttribute('is_user', String(m.role === 'user'));
      d.setAttribute('is_system', String(m.is_hidden));
      d.setAttribute('ch_name', m.name);
      const text = document.createElement('div');
      text.className = 'mes_text';
      text.textContent = m.message;
      d.appendChild(text);
      el.appendChild(d);
    }
    // The observer hears these after this returns; they're ours.
    setTimeout(() => {
      rendering = false;
    }, 0);
  }

  // A script changing how a message looks (its .mes_text in #chat), as
  // Tavern Helper scripts change SillyTavern's: the chat shows it instead.
  const changedDisplays = new Set();
  let displayTimer = null;
  function watchDisplays() {
    const el = document.getElementById('chat');
    if (!el) return;
    new MutationObserver((records) => {
      if (rendering) return;
      for (const r of records) {
        const node = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        const mes = node && node.closest ? node.closest('.mes') : null;
        if (mes) changedDisplays.add(mes);
      }
      clearTimeout(displayTimer);
      displayTimer = setTimeout(() => {
        for (const mes of changedDisplays) {
          const id = Number(mes.getAttribute('mesid'));
          const text = mes.querySelector('.mes_text');
          const m = chat()[id];
          if (text && m && mes.isConnected) post({ method: 'display', args: { message_id: id, html: text.innerHTML, text: m.message } });
        }
        changedDisplays.clear();
      }, 50);
    }).observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
  }
  /** A message's .mes_text, as Tavern Helper gives it (with jQuery). */
  function retrieveDisplayedMessage(id) {
    const el = document.querySelector(`#chat .mes[mesid="${Number(id)}"] .mes_text`);
    return window.jQuery ? window.jQuery(el || []) : el ? [el] : [];
  }
  /** Text as the chat shows a message: *italics*, **bold**, line breaks. */
  function formatAsDisplayedMessage(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/"([^"\n]*)"/g, '<q>"$1"</q>')
      .replace(/\n/g, '<br>');
  }
  /** Shows a message as it is again (drops what a script made of its look). */
  function refreshOneMessage(id) {
    post({ method: 'display', args: { message_id: Number(id), html: null } });
    const m = chat()[Number(id)];
    const text = document.querySelector(`#chat .mes[mesid="${Number(id)}"] .mes_text`);
    if (m && text) {
      rendering = true;
      text.textContent = m.message;
      setTimeout(() => {
        rendering = false;
      }, 0);
    }
    return Promise.resolve();
  }
  const saveChatDebounced = () => void saveChat().catch((err) => console.error(err));
  Object.assign(TavernHelper, { retrieveDisplayedMessage, formatAsDisplayedMessage, refreshOneMessage });
  Object.assign(window, { retrieveDisplayedMessage, formatAsDisplayedMessage, refreshOneMessage, saveChatDebounced });
  /** SillyTavern's prompt manager list (hidden), from the preset in use. */
  function renderPromptList() {
    const el = document.getElementById('completion_prompt_manager_list');
    if (!el) return;
    el.textContent = '';
    for (const p of (state.preset && state.preset.prompts) || []) {
      const li = document.createElement('li');
      li.className = 'completion_prompt_manager_prompt' + (p.enabled ? '' : ' completion_prompt_manager_prompt_disabled');
      li.setAttribute('data-pm-identifier', p.id);
      const name = document.createElement('span');
      name.setAttribute('data-pm-name', p.name);
      name.textContent = p.name;
      li.appendChild(name);
      el.appendChild(li);
    }
  }

  // SillyTavern's chat as its scripts change it: messages edited in place,
  // then saveChat() to keep them.
  const stChat = [];
  let stBase = [];
  const stMessage = (m) => ({
    name: m.name,
    is_user: m.role === 'user',
    is_system: m.is_hidden,
    mes: m.message,
    swipes: m.swipes.slice(),
    swipe_id: m.swipe_id,
    extra: {},
    variables: m.swipes_data.map((d) => clone(d) || {}),
    send_date: '',
  });
  function syncStChat() {
    stChat.length = 0;
    for (const m of chat()) stChat.push(stMessage(m));
    stBase = clone(stChat);
  }
  async function saveChat() {
    const changes = [];
    stChat.forEach((m, i) => {
      const b = stBase[i];
      if (!b || !m) return;
      const change = { message_id: i };
      let changed = false;
      if (JSON.stringify(m.swipes) !== JSON.stringify(b.swipes)) {
        change.swipes = m.swipes;
        change.swipe_id = m.swipe_id;
        changed = true;
      } else if (m.swipe_id !== b.swipe_id) {
        change.swipe_id = m.swipe_id;
        changed = true;
      }
      if (m.mes !== b.mes) {
        change.message = m.mes;
        changed = true;
      }
      if (!!m.is_system !== !!b.is_system) {
        change.is_hidden = !!m.is_system;
        changed = true;
      }
      if (JSON.stringify(m.variables) !== JSON.stringify(b.variables)) {
        change.swipes_data = m.variables;
        changed = true;
      }
      if (changed) changes.push(change);
    });
    const before = stBase.length;
    const after = stChat.length;
    const added = stChat.slice(before);
    stBase = clone(stChat);
    if (changes.length) await setChatMessages(changes);
    if (after > before) await createChatMessages(added.map((m) => ({ role: m.is_user ? 'user' : m.is_system ? 'system' : 'assistant', message: m.mes, is_hidden: !!m.is_system })));
    else if (after < before) await deleteChatMessages(Array.from({ length: before - after }, (_, i) => after + i));
  }

  // The preset as SillyTavern's settings (oai_settings), and its preset manager.
  let lastSaved = '';
  let saveTimer = null;
  function saveSettings() {
    const settings = state.stPreset;
    if (!settings) return Promise.resolve();
    const json = JSON.stringify(settings);
    if (json === lastSaved) return Promise.resolve();
    lastSaved = json;
    return call('saveStPreset', { name: 'in_use', settings });
  }
  const saveSettingsDebounced = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveSettings().catch((err) => console.error(err)), 500);
  };
  const presetManager = {
    getSelectedPresetName: () => state.presetName || '',
    getSelectedPreset: () => state.presetName || '',
    getAllPresets: () => getPresetNames(),
    getPresetList: () => ({ presets: [], preset_names: getPresetNames() }),
    findPreset: (name) => (getPresetNames().includes(name) ? name : undefined),
    getCompletionPresetByName: (name) => (name === state.presetName ? clone(state.stPreset) : clone((state.allStPresets || {})[name])),
    selectPreset: (name) => loadPreset(name),
    savePreset: (name, settings) => call('saveStPreset', { name: name || 'in_use', settings: settings || state.stPreset }),
  };
  const eventSource = {
    on: eventOn,
    once: eventOnce,
    makeFirst: eventMakeFirst,
    makeLast: eventMakeLast,
    removeListener: eventRemoveListener,
    emit: eventEmit,
  };
  const chatMetadata = {};
  function getContext() {
    const c = state.card || {};
    chatMetadata.variables = vars().chat || {};
    return {
      chat: stChat,
      chatMetadata,
      saveMetadata: async () => writeVars({ type: 'chat' }, chatMetadata.variables || {}),
      saveChat,
      saveChatDebounced,
      characters: [Object.assign({ data: clone(c) }, clone(c))],
      characterId: '0',
      this_chid: 0,
      groupId: null,
      chatId: state.chatId || '',
      getCurrentChatId: () => state.chatId || '',
      name1: (state.names && state.names.user) || 'User',
      name2: (state.names && state.names.char) || 'Character',
      onlineStatus: 'connected',
      mainApi: state.preset ? 'openai' : 'textgenerationwebui',
      chatCompletionSettings: state.stPreset || null,
      maxContext: (state.stPreset && state.stPreset.openai_max_context) || 0,
      getChatCompletionModel: () => state.model || '',
      getPresetManager: () => presetManager,
      saveSettings,
      saveSettingsDebounced,
      extensionSettings: {},
      eventSource,
      eventTypes: tavern_events,
      event_types: tavern_events,
      substituteParams: substitudeMacros,
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      generateQuietPrompt: (arg) => generate({ user_input: String(typeof arg === 'object' && arg ? arg.quietPrompt || '' : arg) }),
      generateRaw: (arg) => {
        const o = typeof arg === 'object' && arg ? arg : { prompt: String(arg) };
        return generateRaw({ ordered_prompts: [...(o.systemPrompt ? [{ role: 'system', content: String(o.systemPrompt) }] : []), { role: 'user', content: String(o.prompt || '') }] });
      },
      callPopup: async (text, type) => (type === 'confirm' ? window.confirm(String(text)) : (window.alert(String(text)), true)),
      toastr,
    };
  }
  window.SillyTavern = { getContext };
  Object.assign(window, { eventSource, event_types: tavern_events, saveSettingsDebounced });

  // What the script shows: the boxes of what it put on the page (the parts
  // SillyTavern's own page would show it over), so the chat clips this
  // frame to them. While a pointer is down in it (a drag), it takes the
  // whole window, so the drag doesn't slip out.
  let lastRects = '';
  let grabbing = false;
  let queued = false;
  function report() {
    queued = false;
    const rects = [];
    const consider = (el) => {
      if (el.id === 'uccb-st' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
      if (cs.position === 'fixed' || cs.position === 'absolute' || cs.position === 'sticky') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) rects.push([Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width) + 1, Math.ceil(r.height) + 1]);
        return;
      }
      // A plain box doesn't show over the chat, but what's pinned inside it might.
      for (const child of el.children) consider(child);
    };
    if (document.body) for (const el of document.body.children) consider(el);
    const key = JSON.stringify(rects);
    if (key === lastRects) return;
    lastRects = key;
    post({ method: 'overlay', args: { rects, grab: grabbing } });
  }
  const schedule = () => {
    if (queued) return;
    queued = true;
    // Not requestAnimationFrame: the browser holds those back in a frame
    // that shows nothing yet, which is how this one starts.
    setTimeout(report, 16);
  };
  const grab = (on) => {
    if (grabbing === on) return;
    grabbing = on;
    post({ method: 'overlay', args: { rects: JSON.parse(lastRects || '[]'), grab: on } });
  };
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    schedule();
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('transitionend', schedule, true);
  window.addEventListener('animationend', schedule, true);
  // Animations and the like the observer can't see.
  setInterval(schedule, 500);
  window.addEventListener('pointerdown', () => grab(true), true);
  window.addEventListener('pointerup', () => (grab(false), schedule()), true);
  window.addEventListener('pointercancel', () => grab(false), true);
  window.addEventListener('blur', () => grab(false));
  // ─── From the chat ───────────────────────────────────────────────────────

  syncStChat();
  renderChat();
  renderPromptList();
  watchDisplays();

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
      if (m.state.chat) {
        syncStChat();
        renderChat();
      }
      if (m.state.preset) renderPromptList();
      if (typeof m.state.input === 'string' && box) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, m.state.input);
    } else if (typeof m.event === 'string') {
      const args = Array.isArray(m.args) ? m.args : [];
      await emitHere(m.event, args);
      // An event the chat waits on (the prompt about to be sent): what the
      // listeners made of its data goes back.
      if (typeof m.ack === 'number') post({ ack: m.ack, value: plain(args[0]) });
    }
  });
})();
