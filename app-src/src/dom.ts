/** Tiny DOM helpers — no framework, so the app starts in milliseconds. */

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('Missing element #' + id);
  return el;
}
export const $input = (id: string) => $(id) as HTMLInputElement;
export const $btn = (id: string) => $(id) as HTMLButtonElement;
export const $a = (id: string) => $(id) as HTMLAnchorElement;

export function show(el: HTMLElement, on: boolean): void {
  el.classList.toggle('hidden', !on);
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(v: unknown): string {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC[c]);
}

export function vibrate(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

/** Main message box under the action button. */
export function showMsg(html: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const el = $('msg');
  el.className = 'msg ' + type;
  el.innerHTML = html;
}
export function hideMsg(): void { $('msg').className = 'msg hidden'; }

/** Plain-text message box (register / login / photo). */
export function boxMsg(id: string, text: string): void {
  const el = $(id);
  el.textContent = text || '';
  show(el, !!text);
}

export function overlay(on: boolean, text = 'Please wait…'): void {
  $('overlayText').textContent = text;
  show($('overlay'), on);
}

/** Background-sync line: silent while working, visible only for problems. */
export function setSync(kind: 'warn' | 'bad' | null, text = ''): void {
  const el = $('syncLine');
  if (!kind) { show(el, false); return; }
  el.className = 'sync sync-' + kind;
  el.textContent = '⚠ ' + text;
}
