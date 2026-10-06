/**
 * Location manager.
 * GPS is switched on early (screen open / button tap) so a good fix is usually ready
 * by the time the selfie is taken. It stops as soon as it is not needed (battery).
 */
import { GPS } from './config';
import { geoSettings } from './store';
import type { Fix } from './types';

export const PERM_MSG =
  'Location permission denied. Android: Chrome ⋮ → Settings → Site settings → Location → Allow. ' +
  'iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Then reload this page.';

const supported = 'geolocation' in navigator;
let fix: Fix | null = null;
let watchId: number | null = null;
let watchTimer: ReturnType<typeof setTimeout> | undefined;
let denied = false;
let permWatched = false;

interface Waiter { check(): void; fail(e: Error): void; }
const waiters: Waiter[] = [];
const listeners = new Set<() => void>();
export const onGeoChange = (fn: () => void): void => { listeners.add(fn); };
const emit = () => listeners.forEach(fn => fn());

export const isDenied = () => denied;
export const isWatching = () => watchId !== null;
export const clearFix = (): void => { fix = null; };
export const freshFix = (): Fix | null => (fix && Date.now() - fix.t <= GPS.fixMaxAgeMs ? fix : null);

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function fixDistance(f: Fix | null): number | null {
  const g = geoSettings();
  return f && g.officeLat != null && g.officeLng != null ? Math.round(distanceM(f.lat, f.lng, g.officeLat, g.officeLng)) : null;
}

function onPos(p: GeolocationPosition): void {
  const r: Fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
  const cur = freshFix();
  if (!cur || r.acc <= cur.acc || Date.now() - cur.t > 15000) fix = r;
  denied = false;
  emit();
  waiters.slice().forEach(w => w.check());
}

function onPosErr(err: GeolocationPositionError): void {
  if (err?.code === 1) {
    denied = true;
    stopWatch();
    waiters.slice().forEach(w => w.fail(new Error(PERM_MSG)));
  }
  emit();
}

export function startWatch(ms: number = GPS.prewarmMs): void {
  if (!supported) return;
  if (watchId === null) {
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  clearTimeout(watchTimer);
  watchTimer = setTimeout(stopWatch, ms);
  emit();
}

export function stopWatch(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearTimeout(watchTimer);
  emit();
}

/** Best fix within GPS.maxWaitMs: ≤20 m at once, ≤35 m after 6 s, otherwise the best one we got. */
export function getLocation(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!supported) { reject(new Error('This browser does not support location. Use Chrome (Android) or Safari (iPhone).')); return; }
    if (denied) { reject(new Error(PERM_MSG)); return; }
    const ready = freshFix();
    if (ready && ready.acc <= GPS.okAcc) { resolve(ready); return; }

    const t0 = Date.now();
    let finished = false;
    const done = (err: Error | null, val?: Fix) => {
      if (finished) return;
      finished = true;
      clearTimeout(settleTimer);
      clearTimeout(hardTimer);
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      if (err) reject(err); else resolve(val as Fix);
    };
    const w: Waiter = {
      check() {
        const f = freshFix();
        if (f && (f.acc <= GPS.goodAcc || (f.acc <= GPS.okAcc && Date.now() - t0 >= GPS.settleMs))) done(null, f);
      },
      fail: e => done(e)
    };
    const settleTimer = setTimeout(() => w.check(), GPS.settleMs);
    const hardTimer = setTimeout(() => {
      const f = freshFix();
      if (f) done(null, f); // weak fix — the server allows for GPS accuracy and decides
      else done(new Error('Could not get your location. Turn ON Location/GPS on your phone and try again.'));
    }, GPS.maxWaitMs);
    waiters.push(w);
    startWatch(GPS.maxWaitMs + 15000);
    w.check();
  });
}

/** Start GPS on screen open, but only if permission is already granted (no surprise prompt). */
export async function prewarm(needed: boolean): Promise<void> {
  if (!needed || !supported || !geoSettings().geoCheck) return;
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    if (p.state === 'granted') startWatch(GPS.prewarmMs);
    if (p.state === 'denied') { denied = true; emit(); }
    if (!permWatched) {
      permWatched = true;
      p.addEventListener('change', () => {
        denied = p.state === 'denied';
        if (p.state === 'granted') startWatch(GPS.prewarmMs);
        emit();
      });
    }
  } catch { /* no Permissions API: GPS starts on the first tap */ }
}
