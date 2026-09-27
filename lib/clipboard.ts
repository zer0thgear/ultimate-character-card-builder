// Copies text. navigator.clipboard only exists on secure pages (https, or
// localhost), and UCCB is also opened over plain http from other devices, so
// fall back to the old select-and-copy there.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && globalThis.isSecureContext !== false) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand('copy')) throw new Error("This browser wouldn't copy.");
  } finally {
    area.remove();
  }
}
