/** Everything kept on the phone (localStorage), with a cookie backup of the login. */
import { KEYS } from './config';
import type { EmpState, Job, Me, PendingReg, PublicConfig } from './types';
import { uuid } from './util';

export function lsGet<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; }
}
export function lsSet(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full / private mode */ }
}

/**
 * Ask Chrome to keep this app's data permanently, so a phone that runs low on space does not
 * wipe the login. Chrome answers by itself (no pop-up); it says yes for installed / often-used
 * apps, so this is asked on every open until it is granted.
 */
let keepAsked: Promise<boolean> | null = null;
export function keepStorage(): Promise<boolean> {
  if (!keepAsked) {
    keepAsked = (async () => {
      try {
        const sm = navigator.storage;
        if (!sm || typeof sm.persist !== 'function') return false;
        if (await sm.persisted()) return true;
        return await sm.persist();
      } catch { return false; }
    })();
  }
  return keepAsked;
}

/** Keep identity in the address too (iPhone home-screen icons reopen this exact URL). */
export function setUrl(params: Record<string, string>): void {
  try {
    const q = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    history.replaceState(null, '', location.pathname + q);
  } catch { /* ignore */ }
}

/* ---------- backup copy of the login in a cookie ----------
 * Website storage can be wiped by Chrome on a phone that is short of space (or fail to save at
 * all when the phone is full). Cookies are kept separately, so the login is copied there too and
 * restored from it when the normal copy is gone. 400 days (Chrome's maximum), renewed on every open. */
const CK_ME = 'aap_me';
const CK_DEV = 'aap_dev';
const COOKIE_MAX_AGE = 400 * 86400;

function cookieGet(name: string): string {
  try {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  } catch { return ''; }
}
function cookieSet(name: string, value: string): void {
  try {
    document.cookie = name + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=' + (value ? COOKIE_MAX_AGE : 0) +
      '; SameSite=Strict' + (location.protocol === 'https:' ? '; Secure' : '');
  } catch { /* cookies blocked */ }
}
const meCookie = (me: Me) => me.id + '.' + me.token;

export const loadMe = (): Me | null => {
  const v = lsGet<Me>(KEYS.me);
  if (v && v.id && v.token) {
    if (cookieGet(CK_ME) !== meCookie(v)) cookieSet(CK_ME, meCookie(v)); // keep the backup fresh
    return v;
  }
  const m = /^(E\d+)\.([0-9a-f]{32,128})$/i.exec(cookieGet(CK_ME));
  if (!m) return null;
  const me: Me = { id: m[1].toUpperCase(), token: m[2] };
  lsSet(KEYS.me, me); // restored from the backup
  return me;
};
export function saveMe(me: Me): void {
  lsSet(KEYS.me, me);
  cookieSet(CK_ME, meCookie(me));
  lsSet(KEYS.reg, null);
  void keepStorage();
  setUrl({ e: me.id, t: me.token });
}
export function clearMe(): void {
  lsSet(KEYS.me, null);
  cookieSet(CK_ME, '');
  lsSet(KEYS.state, null);
  setUrl({});
}

/** Random ID of this phone (kept like the login). Lets the server tell "logged in again on the SAME
 *  phone" apart from "moved to another phone", so re-logins do not use up the weekly phone-change limit. */
export function deviceId(): string {
  let id = lsGet<string>('aap_attendance_dev') || cookieGet(CK_DEV);
  if (!/^[0-9a-f-]{16,40}$/i.test(id || '')) id = uuid();
  lsSet('aap_attendance_dev', id);
  if (cookieGet(CK_DEV) !== id) cookieSet(CK_DEV, id);
  return id;
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
