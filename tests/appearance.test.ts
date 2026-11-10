import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, DEFAULT_LOOK, cleanLook, formatColor, isPlain, lookBase, lookCss, lookOf, matchesTheme, mix, parseColor, parseTheme, themeFile, toHex, type Look } from '@/lib/appearance';

const st = BUILT_IN_THEMES.find((t) => t.name === 'SillyTavern')!;
const look = (over: Partial<Look> = {}): Look => ({ ...DEFAULT_LOOK, ...over });

describe('appearance', () => {
  it('reads colours as themes write them', () => {
    expect(parseColor('rgba(220, 220, 210, 0.5)')).toEqual({ r: 220, g: 220, b: 210, a: 0.5 });
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0a141e80')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rebeccapurple')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(formatColor({ r: 1, g: 2, b: 3, a: 0.333 })).toBe('rgba(1, 2, 3, 0.33)');
    expect(toHex({ r: 255, g: 0, b: 16, a: 1 })).toBe('#ff0010');
    expect(mix({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 200, g: 100, b: 50, a: 1 }, 0.5)).toEqual({ r: 100, g: 50, b: 25, a: 0.5 });
  });

  it("leaves the app alone for UCCB's own looks", () => {
    expect(isPlain(DEFAULT_LOOK)).toBe(true);
    expect(lookCss(DEFAULT_LOOK, 'dark')).toBe('');
    expect(isPlain(look({ custom_css: 'a{}' }))).toBe(false);
  });

  it("makes SillyTavern's variables and UCCB's palette from a look", () => {
    const css = lookCss(look(lookOf(st)), 'dark');
    expect(css).toContain('--SmartThemeBodyColor: rgba(220, 220, 210, 1);');
    expect(css).toContain('--SmartThemeQuoteColor: rgba(225, 138, 36, 1);');
    expect(css).toContain('--SmartThemeBlurStrength: 10px;');
    // The slate scale runs from the UI background (see-through kept) to the text (solid).
    expect(css).toContain('--color-slate-950: rgba(23, 23, 23, 0.9);');
    expect(css).toContain('--color-slate-100: rgba(220, 220, 210, 1);');
    expect(css).toMatch(/--color-slate-800: rgba\(\d+, \d+, \d+, 0\.9\);/);
    expect(css).toMatch(/--color-slate-400: rgba\(\d+, \d+, \d+, 1\);/);
    // The chat's colours, tints and blur.
    expect(css).toContain('.chat-text { --chat-em: var(--SmartThemeEmColor); --chat-quote: var(--SmartThemeQuoteColor); }');
    expect(css).toContain('.mes[is_user="true"] .mes_block { background-color: var(--SmartThemeUserMesBlurTintColor); }');
    expect(css).toContain('#chat { background-color: var(--SmartThemeChatTintColor); }');
    expect(css).toContain('backdrop-filter: blur(var(--SmartThemeBlurStrength))');
    // Dialogs stay nearly solid over a see-through UI.
    expect(css).toMatch(/\[role="dialog"\][^{]*\{ background-color: rgba\(\d+, \d+, \d+, 0\.94\)/);
  });

  it('puts the accent, the font, the background and your CSS in', () => {
    const css = lookCss(look({ accent_color: '#ff0000', font_scale: 1.2, font_family: 'Georgia', background: { version: 7, fit: 'contain' }, custom_css: '.mes { color: red; }' }), 'dark', '/api/background?v=7');
    expect(css).toContain('--color-violet-600: rgba(255, 0, 0, 1);');
    expect(css).toContain('font-size: calc(100% * var(--fontScale));');
    expect(css).toContain('font-family: Georgia,');
    expect(css).toContain('background-image: url("/api/background?v=7"); background-size: contain;');
    // Yours comes last, so it wins.
    expect(css.trim().endsWith('.mes { color: red; }')).toBe(true);
    // Without a palette of its own, the slate scale is the base's.
    expect(css).not.toContain('--color-slate-950:');
  });

  it("can't be broken out of by a colour or a font", () => {
    const css = lookCss(look({ main_text_color: 'red; } body { display: none', font_family: 'x; } * { color: red' }), 'dark');
    expect(css).not.toContain('} body {');
    expect(css).toContain('--SmartThemeBodyColor: red  body  display: none;');
    expect(css).not.toMatch(/font-family: x; \}/);
  });

  it('tells a light look from a dark one', () => {
    expect(lookBase({ blur_tint_color: 'rgba(250, 250, 250, 1)', main_text_color: '' }, 'dark')).toBe('light');
    expect(lookBase({ blur_tint_color: '', main_text_color: '#eeeeee' }, 'light')).toBe('dark');
    expect(lookBase({ blur_tint_color: '', main_text_color: '' }, 'light')).toBe('light');
  });

  it('imports a SillyTavern theme file, and exports one', () => {
    const file = { name: 'Cozy', main_text_color: 'rgba(230, 220, 200, 1)', blur_tint_color: 'rgba(40, 30, 30, 0.8)', blur_strength: 12, shadow_width: 3, noShadows: true, font_scale: 1.1, chat_width: 55, avatar_style: 1, chat_display: 1, timestamps_enabled: false, custom_css: '#chat { padding: 4px; }', waifuMode: false, fast_ui_mode: true };
    const theme = parseTheme(file)!;
    expect(theme).toMatchObject({ name: 'Cozy', main_text_color: 'rgba(230, 220, 200, 1)', blur_strength: 12, font_scale: 1.1, chat_width: 55, avatar_style: 1, chat_display: 1, timestamps_enabled: false, custom_css: '#chat { padding: 4px; }', italics_text_color: '' });
    // SillyTavern's "no shadows" switch.
    expect(theme.shadow_width).toBe(0);
    expect(parseTheme({ some: 'json' })).toBeNull();
    expect(parseTheme([1, 2])).toBeNull();
    expect(parseTheme({ custom_css: 'a{}' }, 'From a file')?.name).toBe('From a file');

    const out = themeFile(look({ ...lookOf(theme), background: { version: 1, fit: 'cover' } }), { base: 'dark', chat_width: 55, avatar_style: 1 });
    expect(out).toMatchObject({ name: 'Cozy', blur_strength: 12, chat_width: 55, avatar_style: 1, noShadows: true });
    expect(out).not.toHaveProperty('background');
  });

  it('reads saved looks back soundly, and knows a changed one', () => {
    expect(cleanLook(undefined)).toEqual(DEFAULT_LOOK);
    // Chat mode's layout is the look's, not a theme's.
    expect(cleanLook({ layout: 'st' }).layout).toBe('st');
    expect(cleanLook({ layout: 'sideways' }).layout).toBe('uccb');
    expect(lookOf(cleanLook({ layout: 'st' }))).not.toHaveProperty('layout');
    const saved = cleanLook({ name: 'Mine', quote_text_color: '#ff0', font_scale: 9, blur_strength: 'lots', background: { version: 5, fit: 'tile' } });
    expect(saved).toMatchObject({ name: 'Mine', quote_text_color: '#ff0', font_scale: 1.5, blur_strength: 0, background: { version: 5, fit: 'cover' } });
    const mine = look(lookOf(st));
    expect(matchesTheme(mine, st)).toBe(true);
    expect(matchesTheme({ ...mine, quote_text_color: '#fff' }, st)).toBe(false);
  });
});
