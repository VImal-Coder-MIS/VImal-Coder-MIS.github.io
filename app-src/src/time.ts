/** IST time helpers. The phone clock is corrected with the server clock (offset). */

const TZ = 'Asia/Kolkata';
const clockFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
export const hmsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const stampFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
const dateLabelFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

let offset = 0;
export function setServerTime(serverTs: number | undefined): void {
  if (serverTs) offset = serverTs - Date.now();
}
export const now = (): Date => new Date(Date.now() + offset);
export const nowMs = (): number => Date.now() + offset;

export const clockText = (): string => clockFmt.format(now());
export const dateLabel = (d: Date = now()): string => dateLabelFmt.format(d);
export const istDate = (ms: number = nowMs()): string => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
export const hms = (ms: number): string => hmsFmt.format(new Date(ms));

export function toSec(t: string): number {
  const [h, m, s] = String(t).split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

export function to12h(t?: string): string {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}

export function fmtDur(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

export function isLate(t: string | undefined, lateAfter = '10:15'): boolean {
  if (!t) return false;
  return toSec(t.length === 5 ? t + ':00' : t) > toSec(lateAfter + ':59');
}
