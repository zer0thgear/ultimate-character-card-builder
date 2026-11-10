'use client';

import { useEffect, useState } from 'react';
import { BUILT_IN_THEMES, COLOR_FIELDS, DEFAULT_LOOK, formatColor, isPlain, lookBase, lookCss, matchesTheme, parseColor, parseTheme, themeFile, toHex, type BackgroundFit, type ColorField, type Look } from '@/lib/appearance';
import type { AvatarShape, ChatStyle } from '@/lib/chatPrompt';
import { allThemes, chatDisplayNow, useLookStore } from '@/store/lookStore';
import { useLlmStore } from '@/store/llmStore';
import { toast, useUiStore } from '@/store/uiStore';
import { AutoTextarea, Button, IconButton, Select, choiceDialog, confirmDialog, cx, downloadBlob, inputClass, pickFiles, textDialog } from '@/components/ui';

// Appearance (lib/appearance.ts): LookApplier puts the look on the page,
// and AppearanceTab (Settings → Appearance) is where it's changed: themes
// (SillyTavern's import and export), colours, sizes, a background picture
// and custom CSS.

/** What the page keeps to look right before the settings have loaded (app/layout.tsx reads it). */
export const LOOK_CACHE_KEY = 'uccb-look-css';
const STYLE_ID = 'uccb-look';
export const backgroundUrl = (look: Pick<Look, 'background'>) => (look.background ? `/api/background?v=${look.background.version}` : undefined);

/** Applies the look to the page. Mounted once (Shell). */
export function LookApplier() {
  const look = useLookStore((s) => s.look);
  const theme = useUiStore((s) => s.theme);
  const chatWidth = useUiStore((s) => s.chatFullWidth);
  useEffect(() => {
    const base = lookBase(look, theme);
    const css = lookCss(look, base, backgroundUrl(look));
    const root = document.documentElement;
    root.dataset.theme = base;
    // SillyTavern's name for the chat's width, for custom CSS.
    root.style.setProperty('--sheldWidth', `${Math.round(chatWidth * 100)}vw`);
    if (css) root.dataset.look = '';
    else delete root.dataset.look;
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = css;
    try {
      if (css) localStorage.setItem(LOOK_CACHE_KEY, JSON.stringify({ css, base }));
      else localStorage.removeItem(LOOK_CACHE_KEY);
    } catch {
      /* private mode, or the CSS is too big to keep: it's applied once the settings load */
    }
  }, [look, theme, chatWidth]);
  return null;
}

/** Whether the look has colours of its own (so dark and light don't apply). */
export const useOwnColours = () => useLookStore((s) => !!(parseColor(s.look.blur_tint_color) || parseColor(s.look.main_text_color)));

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr] sm:gap-4">
      <div>
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

/** A colour with how see-through it is: a swatch, a slider, and the CSS itself. */
function ColourInput({ field, label, hint }: { field: ColorField; label: string; hint: string }) {
  const value = useLookStore((s) => s.look[field]);
  const setLook = useLookStore((s) => s.setLook);
  const parsed = parseColor(value);
  const set = (v: string) => setLook({ [field]: v });
  return (
    <div className="flex items-center gap-1.5" title={hint}>
      <span className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded border border-slate-700 checker">
        <span className="absolute inset-0" style={{ background: value.trim() || 'transparent' }} />
        <input
          type="color"
          aria-label={`${label}: colour`}
          value={parsed ? toHex(parsed) : '#000000'}
          onChange={(e) => {
            const picked = parseColor(e.target.value);
            if (picked) set(formatColor({ ...picked, a: parsed?.a ?? 1 }));
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <span className="w-36 flex-shrink-0 truncate text-xs text-slate-300">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        aria-label={`${label}: how solid`}
        title="How solid it is (left: see-through)"
        disabled={!parsed}
        value={parsed?.a ?? 1}
        onChange={(e) => parsed && set(formatColor({ ...parsed, a: Number(e.target.value) }))}
        className="w-20 flex-shrink-0"
      />
      <input value={value} onChange={(e) => set(e.target.value)} placeholder="the base's" aria-label={`${label}: CSS colour`} className={cx(inputClass, 'min-w-0 flex-1 py-1 font-mono text-[11px]')} />
      <IconButton title="Back to the base's" disabled={!value} onClick={() => set('')}>
        ✕
      </IconButton>
    </div>
  );
}

function Slider({ field, label, min, max, step, unit, hint }: { field: 'blur_strength' | 'shadow_width' | 'font_scale'; label: string; min: number; max: number; step: number; unit: string; hint: string }) {
  const value = useLookStore((s) => s.look[field]);
  const setLook = useLookStore((s) => s.setLook);
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300" title={hint}>
      <span className="w-28 flex-shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => setLook({ [field]: Number(e.target.value) })} className="min-w-0 flex-1" />
      <span className="w-14 text-right tabular-nums text-slate-400">
        {field === 'font_scale' ? value.toFixed(2) : value}
        {unit}
      </span>
    </label>
  );
}

const FITS: { value: BackgroundFit; label: string }[] = [
  { value: 'cover', label: 'Fill the window' },
  { value: 'contain', label: 'Fit inside it' },
  { value: 'stretch', label: 'Stretch to it' },
  { value: 'center', label: 'Its own size, centred' },
];
const AVATARS: { value: AvatarShape; label: string }[] = [
  { value: 'circle', label: 'Circles' },
  { value: 'square', label: 'Squares' },
  { value: 'rectangle', label: 'Rectangles (portrait)' },
  { value: 'none', label: 'None' },
];
const STYLES: { value: ChatStyle; label: string }[] = [
  { value: 'bubbles', label: 'Bubbles' },
  { value: 'flat', label: 'Flat' },
];

export function AppearanceTab() {
  const { look, themes, setLook, applyTheme, saveTheme, addTheme, deleteTheme } = useLookStore();
  const { theme: base, setTheme, chatFullWidth: chatWidth, setChatFullWidth: setChatWidth } = useUiStore();
  const chat = useLlmStore((s) => s.chatSettings);
  const setChat = useLlmStore((s) => s.setChatSettings);
  const [busy, setBusy] = useState(false);
  const all = allThemes(themes);
  const current = all.find((t) => t.name.toLowerCase() === look.name.toLowerCase());
  const changed = !current || !matchesTheme(look, current);
  const ownColours = !!(parseColor(look.blur_tint_color) || parseColor(look.main_text_color));

  const pick = async (name: string) => {
    const next = all.find((t) => t.name === name);
    if (!next) return;
    if (changed && current && !(await confirmDialog({ title: `Switch to ${next.name}?`, body: `The changes you've made since ${current.name} aren't saved as a theme; switching drops them. (Save as… keeps them.)`, confirmLabel: 'Switch' }))) return;
    applyTheme(next);
  };
  const saveAs = async () => {
    const name = await textDialog({ title: 'Save this look as a theme', label: 'Its name', initial: current?.builtIn || !current ? '' : look.name, confirmLabel: 'Save' });
    if (!name?.trim()) return;
    if (BUILT_IN_THEMES.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) return toast(`${name.trim()} is one of UCCB's own; give yours another name.`, 'error');
    toast(`Saved the theme "${saveTheme(name).name}".`, 'success');
  };
  const importThemes = async () => {
    const files = await pickFiles('.json,application/json', true);
    let added = 0;
    for (const file of files) {
      try {
        const theme = parseTheme(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
        if (!theme) throw new Error("it isn't a theme");
        // One of UCCB's own names would be hidden behind it.
        if (BUILT_IN_THEMES.some((t) => t.name.toLowerCase() === theme.name.toLowerCase())) theme.name = `${theme.name} (imported)`;
        addTheme(theme);
        added++;
      } catch (err) {
        toast(`Couldn't read ${file.name}: ${(err as Error).message}`, 'error');
      }
    }
    if (added) toast(added === 1 ? `Imported and applied "${useLookStore.getState().look.name}".` : `Imported ${added} themes; the last one is applied.`, 'success');
  };
  const exportTheme = () => downloadBlob(JSON.stringify(themeFile(look, chatDisplayNow()), null, 4), `${look.name || 'theme'}.json`, 'application/json');
  const remove = async () => {
    if (!current || current.builtIn) return;
    if (!(await confirmDialog({ title: `Delete the theme "${current.name}"?`, body: 'The look stays as it is until you pick another.', confirmLabel: 'Delete', danger: true }))) return;
    deleteTheme(current.name);
  };

  const setBackground = async () => {
    const [file] = await pickFiles('image/png,image/jpeg,image/webp,image/gif,image/avif');
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch('/api/background', { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setLook({ background: { version: body.version, fit: look.background?.fit ?? 'cover' } });
    } catch (err) {
      toast(`Couldn't set the background: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const clearBackground = () => {
    setLook({ background: null });
    void fetch('/api/background', { method: 'DELETE' }).catch(() => {});
  };
  const seeThrough = (parseColor(look.blur_tint_color)?.a ?? 1) < 1;
  /** SillyTavern's layout; with its colours too, if the look is still UCCB's plain one and you say so. */
  const stLayout = async () => {
    setLook({ layout: 'st' });
    const st = BUILT_IN_THEMES.find((t) => t.name === 'SillyTavern');
    if (!st || !isPlain(look)) return;
    const answer = await choiceDialog({
      title: "Use SillyTavern's colours too?",
      body: 'The SillyTavern theme has its dark see-through panels, flat messages and portrait avatars. You can pick it (or any other) under Theme later.',
      choices: [
        { value: 'yes', label: 'Yes, the theme too' },
        { value: 'no', label: 'Just the layout' },
      ],
    });
    if (answer === 'yes') applyTheme(st);
  };

  return (
    <div className="flex flex-col gap-5">
      <Row label="Theme" hint="A saved look. SillyTavern's theme files import as they are, and Export writes one SillyTavern reads.">
        <div className="flex flex-wrap items-center gap-2">
          <select value={current?.name ?? ''} onChange={(e) => void pick(e.target.value)} className={cx(inputClass, '!w-56 py-1 text-sm')} aria-label="Theme">
            {!current && <option value="">{look.name || 'Unsaved look'}</option>}
            {all.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.builtIn ? '' : ' (yours)'}
              </option>
            ))}
          </select>
          {changed && <span className="text-xs text-amber-300">changed since</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {current && !current.builtIn && changed && (
            <Button size="sm" variant="primary" onClick={() => toast(`Saved "${saveTheme(current.name).name}".`, 'success')} title="Keep the changes in this theme">
              Save
            </Button>
          )}
          <Button size="sm" onClick={() => void saveAs()}>
            Save as…
          </Button>
          <Button size="sm" onClick={() => void importThemes()} title="SillyTavern theme files (User Settings → UI Theme → Export), or UCCB's">
            Import…
          </Button>
          <Button size="sm" onClick={exportTheme}>
            Export
          </Button>
          {current && !current.builtIn && (
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              Delete
            </Button>
          )}
          {changed && current && (
            <Button size="sm" variant="ghost" onClick={() => applyTheme(current)} title={`Drop the changes made since ${current.name}`}>
              Revert
            </Button>
          )}
        </div>
      </Row>

      <Row label="Base" hint="The palette under the look. A look with a UI background or main text colour of its own sets it by how light they are.">
        <div className="flex items-center gap-2">
          <Button size="sm" variant={!ownColours && base === 'dark' ? 'primary' : 'secondary'} disabled={ownColours} onClick={() => setTheme('dark')}>
            Dark
          </Button>
          <Button size="sm" variant={!ownColours && base === 'light' ? 'primary' : 'secondary'} disabled={ownColours} onClick={() => setTheme('light')}>
            Light
          </Button>
          {ownColours && <span className="text-xs text-slate-500">Set by this look&apos;s colours ({lookBase(look, base)}).</span>}
        </div>
      </Row>

      <Row label="Layout" hint="Chat mode's. SillyTavern's has its top bar of icons, each opening a drawer (the preset, connections, chat settings, lorebooks, appearance, extensions, personas, and your characters at the right), with the chat as a column in the middle. Builder stays as it is.">
        <div className="flex items-center gap-2">
          <Button size="sm" variant={look.layout === 'uccb' ? 'primary' : 'secondary'} onClick={() => setLook({ layout: 'uccb' })}>
            UCCB&apos;s
          </Button>
          <Button size="sm" variant={look.layout === 'st' ? 'primary' : 'secondary'} onClick={() => void stLayout()}>
            SillyTavern&apos;s
          </Button>
        </div>
      </Row>

      <Row label="Colours" hint="Leave one empty for the base's. The slider is how solid it is: a see-through UI background lets the background picture show.">
        {COLOR_FIELDS.map(([field, label, hint]) => (
          <ColourInput key={field} field={field} label={label} hint={hint} />
        ))}
      </Row>

      <Row label="Sizes">
        <Slider field="font_scale" label="Font scale" min={0.5} max={1.5} step={0.05} unit="×" hint="The whole app's text size" />
        <label className="flex items-center gap-2 text-xs text-slate-300" title="How wide the chat's messages are, as a share of the window (Chat mode, and the Builder's chat when it fills the window). This device's; the same slider is in the chat's header.">
          <span className="w-28 flex-shrink-0">Chat width</span>
          <input type="range" min={40} max={100} step={5} value={Math.round(chatWidth * 100)} onChange={(e) => setChatWidth(Number(e.target.value) / 100)} className="min-w-0 flex-1" />
          <span className="w-14 text-right tabular-nums text-slate-400">{Math.round(chatWidth * 100)}%</span>
        </label>
        <Slider field="blur_strength" label="Blur strength" min={0} max={30} step={1} unit="px" hint="Blur behind see-through panels and messages" />
        <Slider field="shadow_width" label="Shadow width" min={0} max={5} step={1} unit="px" hint="Shadow around the chat's text, in the Text shadow colour" />
        <label className="flex items-center gap-2 text-xs text-slate-300" title="A font on this device (or one your custom CSS loads), instead of the app's">
          <span className="w-28 flex-shrink-0">Font</span>
          <input value={look.font_family} onChange={(e) => setLook({ font_family: e.target.value })} placeholder={'the app\'s (e.g. "Noto Sans", Georgia)'} className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')} />
        </label>
      </Row>

      <Row label="Chat display" hint="Also in a chat's 🔧 settings. A theme sets them when it's picked, and carries them when saved.">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <label className="flex items-center gap-1.5">
            Avatars
            <Select value={chat.avatarShape ?? 'circle'} onChange={(avatarShape) => setChat({ avatarShape })} options={AVATARS} className="py-1 text-xs" />
          </label>
          <label className="flex items-center gap-1.5">
            Messages
            <Select value={chat.chatStyle ?? 'bubbles'} onChange={(chatStyle) => setChat({ chatStyle })} options={STYLES} className="py-1 text-xs" />
          </label>
        </div>
      </Row>

      <Row label="Background" hint="A picture behind the whole app. It shows where the UI background (and the chat's) is see-through.">
        <div className="flex flex-wrap items-center gap-2">
          {look.background && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={backgroundUrl(look)} alt="" className="h-12 w-20 rounded border border-slate-700 object-cover" />
          )}
          <Button size="sm" disabled={busy} onClick={() => void setBackground()}>
            {busy ? 'Uploading…' : look.background ? 'Change…' : 'Choose a picture…'}
          </Button>
          {look.background && (
            <>
              <Select value={look.background.fit} onChange={(fit) => setLook({ background: { ...look.background!, fit } })} options={FITS} className="py-1 text-xs" />
              <Button size="sm" variant="ghost" onClick={clearBackground}>
                Remove
              </Button>
            </>
          )}
        </div>
        {look.background && !seeThrough && (
          <p className="text-xs text-amber-300">
            The UI background is solid, so the picture is covered.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                const c = parseColor(look.blur_tint_color) ?? (lookBase(look, base) === 'light' ? { r: 248, g: 250, b: 252, a: 1 } : { r: 2, g: 6, b: 23, a: 1 });
                setLook({ blur_tint_color: formatColor({ ...c, a: 0.8 }), ...(look.blur_strength ? {} : { blur_strength: 8 }) });
              }}
            >
              Make it see-through
            </button>
          </p>
        )}
      </Row>

      <Row
        label="Custom CSS"
        hint="Applied last, as you type. The chat carries SillyTavern's names (#chat, .mes, .mes_block, .mes_text, .ch_name, .name_text, .avatar, .timestamp, #send_textarea, #send_but, #form_sheld, #sheld, #top-bar) and its --SmartTheme… variables, so the chat parts of a SillyTavern theme's CSS apply."
      >
        <AutoTextarea value={look.custom_css} onChange={(e) => setLook({ custom_css: e.target.value })} minRows={6} maxRows={24} spellCheck={false} placeholder={'.mes_text { font-family: Georgia, serif; }'} className="font-mono text-xs" />
      </Row>

      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (await confirmDialog({ title: 'Back to the plain look?', body: "Colours, sizes, the font and custom CSS go back to UCCB's own; themes you've saved stay, and so does the background picture's file until you remove it.", confirmLabel: 'Reset' })) {
              setLook({ ...DEFAULT_LOOK, name: base === 'light' ? 'UCCB Light' : 'UCCB Dark', background: null, layout: look.layout });
            }
          }}
        >
          Reset to UCCB&apos;s own look
        </Button>
      </div>
    </div>
  );
}
