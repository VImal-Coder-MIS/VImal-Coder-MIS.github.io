/** Small pure helpers. */
import { INAPP_RE, UA } from './config';

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

const EASY_PINS = ['1212', '2121', '1122', '6969', '1313', '2580', '0852', '1004', '2000', '2020', '1010', '0101'];
export const weakPin = (p: string): boolean =>
  /^(\d)\1{3}$/.test(p) || '0123456789012'.includes(p) || '9876543210987'.includes(p) || EASY_PINS.includes(p);

/** "SM-A155F · Android 14 · Chrome/129" — shown to admin to identify the phone. */
export function phoneInfo(): string {
  const os = /Android [\d.]+/.exec(UA) || /iPhone OS [\d_]+/.exec(UA) || /Windows NT [\d.]+/.exec(UA) || /Mac OS X [\d_]+/.exec(UA);
  const br = /Edg\/\d+/.exec(UA) || /SamsungBrowser\/\d+/.exec(UA) || /CriOS\/\d+/.exec(UA) || /Chrome\/\d+/.exec(UA) ||
    /Version\/[\d.]+.*Safari/.exec(UA) || /Firefox\/\d+/.exec(UA);
  const model = (/;\s*([^;)]+)\s+Build\//.exec(UA) || [])[1] || '';
  const inapp = (INAPP_RE.exec(UA) || [])[0];
  return [model, os && os[0].replace(/_/g, '.'), br && br[0].split(' ')[0], inapp && 'in ' + inapp.replace(/[;)\s]/g, '')]
    .filter(Boolean).join(' · ');
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Resolves with the promise's value, or `fallback` after `ms`. */
export function withTimeout<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

export const initials = (name: string): string =>
  String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
