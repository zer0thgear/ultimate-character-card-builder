// Appearance: how UCCB looks, beyond dark and light. A look is a set of
// colours, sizes and custom CSS, with the field names SillyTavern's themes
// use, so its theme files import and export as they are. It's applied as
// CSS made here (lookCss): SillyTavern's own variables (--SmartTheme…),
// which its themes' custom CSS is written against, and UCCB's palette
// (Tailwind's slate and violet scales) worked out from the look's colours,
// so every part of the app follows without knowing about looks.

export type LookBase = 'dark' | 'light';
export type BackgroundFit = 'cover' | 'contain' | 'stretch' | 'center';
/** How Chat mode is laid out: UCCB's own way, or as SillyTavern (components/chatmode/StLayout.tsx). */
export type ChatLayout = 'uccb' | 'st';

/** SillyTavern's numbers for them. */
export const AVATAR_STYLES = { round: 0, rectangular: 1, square: 2, rounded: 3 } as const;
export const CHAT_DISPLAYS = { flat: 0, bubbles: 1, document: 2 } as const;

export interface Look {
  /** The theme it started from (changed since or not). */
  name: string;
  // Colours, as CSS ('' leaves the base palette's).
  main_text_color: string;
  italics_text_color: string;
  underline_text_color: string;
  quote_text_color: string;
  /** The UI's background (panels, bars, dialogs). */
  blur_tint_color: string;
  /** Behind the chat's messages. */
  chat_tint_color: string;
  user_mes_blur_tint_color: string;
  bot_mes_blur_tint_color: string;
  shadow_color: string;
  border_color: string;
  /** UCCB's own: buttons, links and highlights (violet unless set). */
  accent_color: string;
  /** Pixels of blur behind translucent panels. */
  blur_strength: number;
  /** Pixels of shadow around the chat's text. */
  shadow_width: number;
  /** The whole app's text size, times this. */
  font_scale: number;
  /** UCCB's own: a font to use instead of the app's ('' for the app's). */
  font_family: string;
  custom_css: string;
  /** The picture behind everything (not part of a theme, as in SillyTavern). */
  background: { version: number; fit: BackgroundFit } | null;
  /** Chat mode's layout (not part of a theme either). */
  layout: ChatLayout;
}

/** A saved look: SillyTavern's theme file, with the chat's display settings it carries. */
export interface Theme extends Omit<Look, 'background' | 'layout'> {
  /** The palette it sits on; worked out from its colours when it has them. */
  base?: LookBase;
  avatar_style?: number;
  chat_display?: number;
  /** The chat's messages' width, as a share of the window (percent; the chat's own slider). */
  chat_width?: number;
  timestamps_enabled?: boolean;
  mesIDDisplay_enabled?: boolean;
  /** Not to be changed or deleted (UCCB's own). */
  builtIn?: boolean;
}

const BLANK: Omit<Look, 'name' | 'background' | 'layout'> = {
  main_text_color: '',
  italics_text_color: '',
  underline_text_color: '',
  quote_text_color: '',
  blur_tint_color: '',
  chat_tint_color: '',
  user_mes_blur_tint_color: '',
  bot_mes_blur_tint_color: '',
  shadow_color: '',
  border_color: '',
  accent_color: '',
  blur_strength: 0,
  shadow_width: 0,
  font_scale: 1,
  font_family: '',
  custom_css: '',
};

export const DEFAULT_LOOK: Look = { name: 'UCCB Dark', ...BLANK, background: null, layout: 'uccb' };

/** UCCB's own looks, and one in SillyTavern's default colours. */
export const BUILT_IN_THEMES: Theme[] = [
  { name: 'UCCB Dark', ...BLANK, base: 'dark', builtIn: true },
  { name: 'UCCB Light', ...BLANK, base: 'light', builtIn: true },
  {
    name: 'SillyTavern',
    ...BLANK,
    base: 'dark',
    builtIn: true,
    main_text_color: 'rgba(220, 220, 210, 1)',
    italics_text_color: 'rgba(145, 145, 145, 1)',
    underline_text_color: 'rgba(188, 231, 207, 1)',
    quote_text_color: 'rgba(225, 138, 36, 1)',
    blur_tint_color: 'rgba(23, 23, 23, 0.9)',
    chat_tint_color: 'rgba(23, 23, 23, 0.6)',
    user_mes_blur_tint_color: 'rgba(30, 30, 30, 0.9)',
    bot_mes_blur_tint_color: 'rgba(30, 30, 30, 0.9)',
    shadow_color: 'rgba(0, 0, 0, 1)',
    border_color: 'rgba(0, 0, 0, 0.5)',
    blur_strength: 10,
    shadow_width: 2,
    chat_width: 50,
    avatar_style: AVATAR_STYLES.rectangular,
    chat_display: CHAT_DISPLAYS.flat,
    timestamps_enabled: true,
    mesIDDisplay_enabled: true,
  },
];

export const COLOR_FIELDS = [
  ['main_text_color', 'Main text', 'Text everywhere'],
  ['italics_text_color', 'Italics', '*Actions* in the chat'],
  ['underline_text_color', 'Underlined', 'Underlined text in the chat'],
  ['quote_text_color', 'Quotes', '"Speech" in the chat'],
  ['blur_tint_color', 'UI background', 'Panels, bars and dialogs; make it see-through to show the background picture'],
  ['chat_tint_color', 'Chat background', "Behind the chat's messages"],
  ['user_mes_blur_tint_color', 'Your messages', "Your messages' background"],
  ['bot_mes_blur_tint_color', "Characters' messages", "The characters' messages' background"],
  ['shadow_color', 'Text shadow', "Around the chat's text, as wide as Shadow width"],
  ['border_color', 'Borders', "Around the chat's messages and the panels"],
  ['accent_color', 'Accent', 'Buttons, links and highlights (violet unless set)'],
] as const satisfies readonly (readonly [keyof Look, string, string])[];

export type ColorField = (typeof COLOR_FIELDS)[number][0];

// ─── Colours ─────────────────────────────────────────────────────────────────

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A colour as written in a theme (rgba(), rgb(), #hex), or null if it's some other kind (a name, hsl…). */
export function parseColor(text: string | undefined): Rgba | null {
  const s = (text ?? '').trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? Math.round((n(6) / 255) * 100) / 100 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (!fn) return null;
  const part = (v: string, max: number) => (v.endsWith('%') ? (parseFloat(v) / 100) * max : parseFloat(v));
  const [r, g, b] = [fn[1], fn[2], fn[3]].map((v) => clamp(Math.round(part(v, 255)), 0, 255));
  const a = fn[4] === undefined ? 1 : clamp(part(fn[4], 1), 0, 1);
  return [r, g, b, a].some(Number.isNaN) ? null : { r, g, b, a };
}

/** As SillyTavern writes them. */
export const formatColor = (c: Rgba) => `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 100) / 100})`;
export const toHex = (c: Rgba) => `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

/** `a` with `amount` (0 to 1) of `b` mixed in; the result is as see-through as `alpha` says (a's, unless given). */
export function mix(a: Rgba, b: Rgba, amount: number, alpha = a.a): Rgba {
  const ch = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b), a: alpha };
}

/** How light a colour is, 0 (black) to 1 (white). */
export const lightness = (c: Rgba) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;

const BASE_BG: Record<LookBase, Rgba> = { dark: { r: 2, g: 6, b: 23, a: 1 }, light: { r: 248, g: 250, b: 252, a: 1 } };
const BASE_FG: Record<LookBase, Rgba> = { dark: { r: 241, g: 245, b: 249, a: 1 }, light: { r: 15, g: 23, b: 42, a: 1 } };

/** The palette a look sits on: its UI background's (or its text's) lightness says, else `fallback`. */
export function lookBase(look: Pick<Look, 'blur_tint_color' | 'main_text_color'>, fallback: LookBase): LookBase {
  const bg = parseColor(look.blur_tint_color);
  if (bg) return lightness(bg) > 0.5 ? 'light' : 'dark';
  const fg = parseColor(look.main_text_color);
  if (fg) return lightness(fg) > 0.5 ? 'dark' : 'light';
  return fallback;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

/** Whether a look changes anything from the plain dark or light app. */
export function isPlain(look: Look): boolean {
  return (
    COLOR_FIELDS.every(([k]) => !look[k].trim()) && !look.blur_strength && !look.shadow_width && look.font_scale === 1 && !look.font_family.trim() && !look.custom_css.trim() && !look.background
  );
}

const SELECTOR = ':root:root[data-look]';
/** Text in a CSS string or url(): nothing that could end it. */
const quoted = (s: string) => s.replace(/[\\"\n\r]/g, '');
/** A colour (or font) as it goes in a declaration: nothing that could end it and start another. */
const value = (s: string) => s.replace(/[;{}<>]/g, '').trim();

/**
 * The CSS that makes the app look like `look`, on the `base` palette.
 * `backgroundUrl` is where the background picture is served.
 */
export function lookCss(look: Look, base: LookBase, backgroundUrl?: string): string {
  if (isPlain(look)) return '';
  const out: string[] = [];
  const vars: string[] = [];
  const set = (name: string, v: string) => vars.push(`  ${name}: ${v};`);

  const bg = parseColor(look.blur_tint_color);
  const fg = parseColor(look.main_text_color);
  const text = value(look.main_text_color) || 'var(--color-slate-200)';
  const ui = value(look.blur_tint_color) || 'var(--color-slate-950)';

  // SillyTavern's variables, which its themes' custom CSS uses.
  set('--SmartThemeBodyColor', text);
  set('--SmartThemeEmColor', value(look.italics_text_color) || 'var(--color-slate-400)');
  set('--SmartThemeUnderlineColor', value(look.underline_text_color) || text);
  set('--SmartThemeQuoteColor', value(look.quote_text_color) || 'var(--color-amber-200)');
  set('--SmartThemeBlurTintColor', ui);
  set('--SmartThemeChatTintColor', value(look.chat_tint_color) || 'transparent');
  set('--SmartThemeUserMesBlurTintColor', value(look.user_mes_blur_tint_color) || 'transparent');
  set('--SmartThemeBotMesBlurTintColor', value(look.bot_mes_blur_tint_color) || 'transparent');
  set('--SmartThemeShadowColor', value(look.shadow_color) || 'transparent');
  set('--SmartThemeBorderColor', value(look.border_color) || 'var(--color-slate-800)');
  set('--SmartThemeBlurStrength', `${clamp(look.blur_strength, 0, 30)}px`);
  set('--blurStrength', String(clamp(look.blur_strength, 0, 30)));
  set('--shadowWidth', String(clamp(look.shadow_width, 0, 5)));
  set('--fontScale', String(clamp(look.font_scale, 0.5, 1.5)));
  set('--mainFontSize', 'calc(var(--fontScale) * 15px)');

  // UCCB's palette, from the look's background and text: the slate scale
  // runs from the one to the other.
  if (bg || fg) {
    const b = bg ?? BASE_BG[base];
    const f = fg ?? BASE_FG[base];
    const solid = { ...b, a: 1 };
    set('--background', formatColor(solid));
    set('--foreground', formatColor(f));
    // Backgrounds keep the UI background's see-through; text is solid.
    const back = (amount: number) => formatColor(mix(solid, f, amount, b.a));
    const fore = (amount: number) => formatColor(mix(f, solid, amount, 1));
    set('--color-slate-950', formatColor(b));
    set('--color-slate-900', back(0.05));
    set('--color-slate-800', back(0.11));
    set('--color-slate-700', back(0.2));
    set('--color-slate-600', fore(0.62));
    set('--color-slate-500', fore(0.48));
    set('--color-slate-400', fore(0.32));
    set('--color-slate-300', fore(0.16));
    set('--color-slate-200', fore(0.06));
    set('--color-slate-100', formatColor(f));
    set('--color-slate-50', formatColor(f));
  }
  const accent = parseColor(look.accent_color);
  if (accent) {
    const b = { ...(bg ?? BASE_BG[base]), a: 1 };
    const f = fg ?? BASE_FG[base];
    const solid = { ...accent, a: 1 };
    const toText = (amount: number) => formatColor(mix(solid, f, amount));
    const toBack = (amount: number) => formatColor(mix(solid, b, amount));
    set('--color-violet-200', toText(0.7));
    set('--color-violet-300', toText(0.5));
    set('--color-violet-400', toText(0.3));
    set('--color-violet-500', toText(0.12));
    set('--color-violet-600', formatColor(solid));
    set('--color-violet-700', toBack(0.2));
    set('--color-violet-800', toBack(0.4));
    set('--color-violet-900', toBack(0.6));
    set('--color-violet-950', toBack(0.78));
  }
  out.push(`${SELECTOR} {\n${vars.join('\n')}\n}`);

  if (look.font_scale !== 1) out.push(`${SELECTOR} { font-size: calc(100% * var(--fontScale)); }`);
  if (look.font_family.trim()) out.push(`${SELECTOR} body { font-family: ${value(look.font_family)}, var(--font-geist-sans, Arial, sans-serif); }`);
  if (look.background && backgroundUrl) {
    const fit = { cover: 'cover', contain: 'contain', stretch: '100% 100%', center: 'auto' }[look.background.fit] ?? 'cover';
    out.push(`${SELECTOR} body { background-image: url("${quoted(backgroundUrl)}"); background-size: ${fit}; background-position: center; background-repeat: no-repeat; background-attachment: fixed; }`);
  }

  // What floats over the rest (dialogs, menus, tips: they carry a shadow)
  // stays readable over a see-through UI: solid. (Blur can't do it: inside
  // a blurred panel, a menu's own blur doesn't reach what's outside it.)
  if (bg && bg.a < 1) {
    const f = fg ?? BASE_FG[base];
    const floating = formatColor(mix({ ...bg, a: 1 }, f, 0.05, 1));
    out.push(
      `${SELECTOR} :is([role="dialog"], .shadow-lg, .shadow-xl, .shadow-2xl):is([class*="bg-slate-9"], [class*="bg-slate-8"]) { background-color: ${floating}; }`,
    );
  }

  // The chat.
  const chat: string[] = [];
  if (look.italics_text_color.trim()) chat.push('--chat-em: var(--SmartThemeEmColor);');
  if (look.quote_text_color.trim()) chat.push('--chat-quote: var(--SmartThemeQuoteColor);');
  if (chat.length) out.push(`${SELECTOR} .chat-text { ${chat.join(' ')} }`);
  if (look.underline_text_color.trim()) out.push(`${SELECTOR} .chat-text u { color: var(--SmartThemeUnderlineColor); }`);
  if (look.shadow_width > 0 && look.shadow_color.trim()) out.push(`${SELECTOR} .chat-text, ${SELECTOR} .name_text { text-shadow: 0 0 calc(var(--shadowWidth) * 1px) var(--SmartThemeShadowColor); }`);
  if (look.chat_tint_color.trim()) out.push(`${SELECTOR} #chat { background-color: var(--SmartThemeChatTintColor); }`);
  if (look.user_mes_blur_tint_color.trim()) out.push(`${SELECTOR} .mes[is_user="true"] .mes_block { background-color: var(--SmartThemeUserMesBlurTintColor); }`);
  if (look.bot_mes_blur_tint_color.trim()) out.push(`${SELECTOR} .mes[is_user="false"] .mes_block { background-color: var(--SmartThemeBotMesBlurTintColor); }`);
  if (look.border_color.trim()) out.push(`${SELECTOR} .mes, ${SELECTOR} .mes_block, ${SELECTOR} .ui-panel { border-color: var(--SmartThemeBorderColor); }`);
  if (look.blur_strength > 0) out.push(`${SELECTOR} .ui-panel, ${SELECTOR} .mes_block { -webkit-backdrop-filter: blur(var(--SmartThemeBlurStrength)); backdrop-filter: blur(var(--SmartThemeBlurStrength)); }`);

  // Yours last, so it wins.
  if (look.custom_css.trim()) out.push(look.custom_css);
  return out.join('\n');
}

// ─── Themes ──────────────────────────────────────────────────────────────────

const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A saved look or a SillyTavern theme file, made sound; null if it isn't one. */
export function parseTheme(raw: unknown, fallbackName = 'Imported theme'): Theme | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  // Something of a theme's has to be there.
  if (!COLOR_FIELDS.some(([k]) => typeof o[k] === 'string') && typeof o.custom_css !== 'string' && typeof o.font_scale !== 'number') return null;
  const theme: Theme = {
    name: str(o.name).trim() || fallbackName,
    main_text_color: str(o.main_text_color),
    italics_text_color: str(o.italics_text_color),
    underline_text_color: str(o.underline_text_color),
    quote_text_color: str(o.quote_text_color),
    blur_tint_color: str(o.blur_tint_color),
    chat_tint_color: str(o.chat_tint_color),
    user_mes_blur_tint_color: str(o.user_mes_blur_tint_color),
    bot_mes_blur_tint_color: str(o.bot_mes_blur_tint_color),
    shadow_color: str(o.shadow_color),
    border_color: str(o.border_color),
    accent_color: str(o.accent_color),
    blur_strength: num(o.blur_strength, 0, 0, 30),
    shadow_width: num(o.shadow_width, 0, 0, 5),
    font_scale: num(o.font_scale, 1, 0.5, 1.5),
    font_family: str(o.font_family),
    custom_css: str(o.custom_css),
  };
  // SillyTavern's switch for no shadows.
  if (o.noShadows === true) theme.shadow_width = 0;
  if (o.base === 'dark' || o.base === 'light') theme.base = o.base;
  if (typeof o.avatar_style === 'number') theme.avatar_style = o.avatar_style;
  if (typeof o.chat_display === 'number') theme.chat_display = o.chat_display;
  if (typeof o.chat_width === 'number' && Number.isFinite(o.chat_width)) theme.chat_width = clamp(o.chat_width, 25, 100);
  if (typeof o.timestamps_enabled === 'boolean') theme.timestamps_enabled = o.timestamps_enabled;
  if (typeof o.mesIDDisplay_enabled === 'boolean') theme.mesIDDisplay_enabled = o.mesIDDisplay_enabled;
  return theme;
}

const LOOK_KEYS = ['name', ...COLOR_FIELDS.map(([k]) => k), 'blur_strength', 'shadow_width', 'font_scale', 'font_family', 'custom_css'] as const;

/** A theme's (or a look's) own look: without its background, or the chat display it carries. */
export function lookOf(from: Theme | Look): Omit<Look, 'background' | 'layout'> {
  return Object.fromEntries(LOOK_KEYS.map((k) => [k, from[k]])) as Omit<Look, 'background' | 'layout'>;
}

/** A saved look, made sound (settings read back, or anything else). */
export function cleanLook(raw: unknown): Look {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const theme: Theme = parseTheme({ font_scale: 1, ...o }, DEFAULT_LOOK.name) ?? { ...DEFAULT_LOOK };
  const b = o.background as { version?: unknown; fit?: unknown } | null | undefined;
  const fit = (['cover', 'contain', 'stretch', 'center'] as const).find((f) => f === b?.fit) ?? 'cover';
  return { ...lookOf(theme), background: b && typeof b.version === 'number' ? { version: b.version, fit } : null, layout: o.layout === 'st' ? 'st' : 'uccb' };
}

/** The look as a theme file (SillyTavern reads it; UCCB's own fields ride along). */
export function themeFile(look: Look, extra: Pick<Theme, 'base' | 'avatar_style' | 'chat_display' | 'chat_width' | 'timestamps_enabled' | 'mesIDDisplay_enabled'>): Theme & { noShadows: boolean } {
  return { ...lookOf(look), ...extra, noShadows: look.shadow_width === 0 };
}

/** Whether the look is still as its theme left it. */
export function matchesTheme(look: Look, theme: Theme): boolean {
  return COLOR_FIELDS.every(([k]) => look[k].trim() === theme[k].trim()) && (['blur_strength', 'shadow_width', 'font_scale'] as const).every((k) => look[k] === theme[k]) && look.font_family.trim() === theme.font_family.trim() && look.custom_css === theme.custom_css;
}
