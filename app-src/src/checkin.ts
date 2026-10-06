/**
 * CHECK IN / OUT — optimistic and offline-first.
 *
 *   tap → camera (GPS + face detector load meanwhile) → face check (~0.1–0.5 s)
 *       → "✓ Checked in" on screen immediately
 *       → location + upload continue in the background queue (kept on the phone, retried until saved).
 */
import { api, cleanErr, isRetryable } from './api';
import { GPS, TIMING } from './config';
import { $, $btn, $input, esc, hideMsg, show, showMsg, setSync, vibrate } from './dom';
import { checkFace, preloadFace } from './face';
import { clearFix, fixDistance, freshFix, getLocation, startWatch, stopWatch } from './geo';
import { loadSelfie, previewJpeg, stampSelfie } from './image';
import { applyServer, handleAuthError, rebuild, resume } from './session';
import { saveQueue } from './storage';
import { geoSettings, store } from './store';
import { hmsFmt, istDate, nowMs, stampFmt, to12h } from './time';
import type { Action, EmpState, FaceMeta, Job } from './types';
import { renderMain } from './ui/main-screen';
import { sleep, uuid } from './util';

let pendingAction: Action | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryStep = 0;

/** Timings of the last check-in (read by the tests, harmless in production). */
export const perf: Record<string, number> = {};
(window as unknown as { __aapPerf: typeof perf }).__aapPerf = perf;

const selfieNeeded = (a: Action) => {
  const m = geoSettings().selfieMode;
  return m === 'BOTH' || (m === 'IN' && a === 'IN');
};

function openCamera(): void {
  const cam = $input('cam');
  cam.value = '';
  cam.click(); // must stay inside the tap handler so the camera can open
}

export function onAction(): void {
  if (store.busy || !store.state || store.queue.length) return;
  const action = $btn('btnAction').dataset.action as Action | undefined;
  if (!action) return;
  hideMsg();
  pendingAction = action;
  if (geoSettings().geoCheck) startWatch(GPS.maxWaitMs + 30000);
  if (selfieNeeded(action)) {
    void preloadFace().catch(() => null); // loads while the camera is open
    openCamera();
  } else {
    record(action, '', undefined);
  }
}

function setChecking(on: boolean): void {
  store.busy = on;
  const btn = $btn('btnAction');
  btn.classList.toggle('checking', on);
  if (on) btn.textContent = 'Checking photo…';
  else renderMain();
}

export async function onPhoto(): Promise<void> {
  const file = $input('cam').files?.[0];
  const action = pendingAction;
  if (!file || !action || store.busy) return;
  if (file.lastModified && Math.abs(Date.now() - file.lastModified) > TIMING.selfieMaxAgeMs) {
    showMsg('Please take a NEW selfie with the camera. Old photos from the gallery are not allowed.', 'error');
    vibrate([40, 60, 40]);
    return;
  }
  setChecking(true);
  try {
    const t0 = performance.now();
    const img = await loadSelfie(file);
    perf.decodeMs = Math.round(performance.now() - t0);
    const face = await checkFace(img.c);
    perf.faceMs = Math.round(performance.now() - t0) - perf.decodeMs;
    if (face.found === false) {
      setChecking(false);
      showFaceGate(previewJpeg(img));
      return;
    }
    const st = store.state as EmpState;
    const selfie = stampSelfie(img,
      st.name + ' · ' + (action === 'IN' ? 'Check In' : 'Check Out'),
      stampFmt.format(new Date(nowMs())) + ' IST');
    perf.photoMs = Math.round(performance.now() - t0);
    setChecking(false);
    record(action, selfie, face.meta);
  } catch {
    setChecking(false);
    showMsg('Could not read the photo. Please tap the button and try again.', 'error');
  }
}

/* ---------- "No face detected" pop-up ---------- */
function showFaceGate(preview: string): void {
  const img = $('facePrev') as HTMLImageElement;
  img.src = preview;
  show(img, true);
  show($('faceGate'), true);
  vibrate([40, 60, 40]);
}
export function onFaceRetake(): void {
  show($('faceGate'), false);
  openCamera(); // still inside a tap → camera opens
}
export function onFaceCancel(): void {
  show($('faceGate'), false);
  pendingAction = null;
  stopWatch();
}

/* ---------- optimistic record + background queue ---------- */
export function record(action: Action, selfie: string, meta: FaceMeta | undefined): void {
  const me = store.me;
  if (!me) return;
  const g = geoSettings();
  const f = freshFix();
  const dist = fixDistance(f);
  // Already KNOWN to be outside the zone (good fix)? Say so now instead of a fake success.
  if (g.geoCheck && f && dist != null && f.acc <= GPS.okAcc && dist - Math.min(f.acc, g.locTol || 0) > g.radius) {
    showMsg('You are ' + dist + ' m away from the office. Check In/Out is allowed only within ' + g.radius + ' m.', 'error');
    vibrate([40, 60, 40]);
    return;
  }
  const ts = nowMs();
  const job: Job = {
    rid: uuid(),
    emp: me.id,
    date: istDate(ts),
    action,
    notes: $input('notes').value,
    selfie,
    ts,
    loc: f && f.acc <= GPS.okAcc ? { lat: f.lat, lng: f.lng, acc: f.acc } : null, // weak fix → better one in the background
    dist,
    tries: 0,
    meta
  };
  store.queue.push(job);
  saveQueue(store.queue);
  pendingAction = null;
  $input('notes').value = '';
  ($('noteBox') as HTMLDetailsElement).open = false;

  rebuild(); // ← the screen flips to "Checked in" right here
  perf.shownAt = performance.now();
  const label = action === 'IN' ? 'Checked in' : 'Checked out';
  const thumb = selfie ? '<img class="thumb" src="' + selfie + '" alt="" style="float:right;margin-left:8px">' : '';
  const okHtml = thumb + '✓ <b>' + label + ' at ' + esc(to12h(hmsFmt.format(new Date(ts)))) + '</b>';
  const st = store.state as EmpState;
  if (st.canIn || st.canOut) showMsg(okHtml, 'success');
  else { $('doneMsg').innerHTML = okHtml; show($('doneMsg'), true); }
  vibrate(60);
  void flushQueue();
}

/** Sends queued jobs in order. Network problems → retry later; real rejections → undo + explain. */
export async function flushQueue(): Promise<void> {
  const me = store.me;
  if (store.flushing || !me) return;
  store.flushing = true;
  clearTimeout(retryTimer);
  try {
    while (store.queue.length) {
      const job = store.queue[0];
      if (job.emp !== me.id) { store.queue.shift(); saveQueue(store.queue); continue; }
      if (!job.loc && geoSettings().geoCheck) {
        try {
          const f = await getLocation();
          job.loc = { lat: f.lat, lng: f.lng, acc: f.acc };
          job.dist = fixDistance(f);
          saveQueue(store.queue);
        } catch (e) {
          reject(job, e);
          continue;
        }
      }
      try {
        job.tries++;
        const t0 = performance.now();
        const s = await api<EmpState>('empSubmit', me.id, me.token, job.action, job.notes, job.loc, job.selfie,
          navigator.userAgent, job.rid, job.ts, job.meta || null);
        perf.serverMs = Math.round(performance.now() - t0);
        store.queue.shift();
        saveQueue(store.queue);
        retryStep = 0;
        setSync(null);
        applyServer(s);
        stopWatch();
      } catch (e) {
        if (handleAuthError(e)) return;
        // weak indoor GPS: silently try twice more with a fresh reading before telling the employee
        const msg = (e as Error).message || '';
        if (/away from the office|signal is weak/i.test(msg) && (job.geoTries || 0) < 2 && job.loc && job.loc.acc > GPS.goodAcc) {
          job.geoTries = (job.geoTries || 0) + 1;
          job.loc = null;
          clearFix();
          saveQueue(store.queue);
          await sleep(4000);
          continue;
        }
        if (isRetryable(e) || !navigator.onLine) {
          const wait = TIMING.retryMs[Math.min(retryStep++, TIMING.retryMs.length - 1)];
          setSync('warn', 'No internet — saved on this phone, will send automatically.');
          retryTimer = setTimeout(() => void flushQueue(), wait);
          return;
        }
        reject(job, e);
      }
    }
  } finally {
    store.flushing = false;
  }
}

function reject(job: Job, e: unknown): void {
  const i = store.queue.indexOf(job);
  if (i >= 0) store.queue.splice(i, 1);
  saveQueue(store.queue);
  show($('doneMsg'), false);
  rebuild();
  showMsg('✗ ' + (job.action === 'IN' ? 'Check In' : 'Check Out') + ' NOT saved: ' + esc(cleanErr(e)), 'error');
  setSync('bad', 'Not saved');
  vibrate([40, 60, 40, 60, 40]);
  void resume();
}

export function retryNow(): void {
  if (store.queue.length) { retryStep = 0; void flushQueue(); }
}
