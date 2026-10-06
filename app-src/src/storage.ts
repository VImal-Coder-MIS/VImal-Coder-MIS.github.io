/** Everything kept on the phone. Chrome keeps it for the installed app, so nobody is logged out. */
import { KEYS } from './config';
import type { EmpState, Job, Me, PendingReg, PublicConfig } from './types';

export function lsGet<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; }
}
export function lsSet(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full / private mode */ }
}

/** Keep identity in the address too (iPhone home-screen icons reopen this exact URL). */
export function setUrl(params: Record<string, string>): void {
  try {
    const q = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    history.replaceState(null, '', location.pathname + q);
  } catch { /* ignore */ }
}

export const loadMe = (): Me | null => {
  const v = lsGet<Me>(KEYS.me);
  return v && v.id && v.token ? v : null;
};
export function saveMe(me: Me): void {
  lsSet(KEYS.me, me);
  lsSet(KEYS.reg, null);
  setUrl({ e: me.id, t: me.token });
}
export function clearMe(): void {
  lsSet(KEYS.me, null);
  lsSet(KEYS.state, null);
  setUrl({});
}

export const loadReg = (): PendingReg | null => lsGet<PendingReg>(KEYS.reg);
export function saveReg(r: PendingReg | null): void {
  lsSet(KEYS.reg, r);
  setUrl(r ? { r: r.regId, t: r.token } : {});
}

export const loadQueue = (): Job[] => {
  const q = lsGet<Job[]>(KEYS.queue);
  return Array.isArray(q) ? q : [];
};
export const saveQueue = (q: Job[]): void => lsSet(KEYS.queue, q.length ? q : null);

export interface CachedState { id: string; s: EmpState; }
export const loadState = (): CachedState | null => lsGet<CachedState>(KEYS.state);
export const saveState = (id: string, s: EmpState): void => lsSet(KEYS.state, { id, s: { ...s, serverTs: 0 } });

export interface CachedPhoto { id?: string; reg?: string; photo: string; }
export const loadPhoto = (): CachedPhoto | null => lsGet<CachedPhoto>(KEYS.photo);
export const savePhoto = (p: CachedPhoto): void => lsSet(KEYS.photo, p);

export const loadCfg = (): Partial<PublicConfig> => lsGet<Partial<PublicConfig>>(KEYS.cfg) || {};
export const saveCfg = (c: Partial<PublicConfig>): void => lsSet(KEYS.cfg, c);

export function session(key: string, value?: string): string {
  try {
    if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key) || '';
  } catch { return ''; }
}
