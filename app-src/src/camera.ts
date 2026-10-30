/**
 * In-app selfie camera.
 *
 * The photo is taken INSIDE the app page (live camera preview + shutter button) instead of opening
 * the phone's separate camera app. With the separate camera app, Android often closes Chrome in the
 * background on low-memory phones ("Unable to complete previous operation due to low memory") and
 * the photo is lost — the employee had to try 2–3 times. Here Chrome stays on screen the whole time.
 *
 * If the in-app camera cannot start (no permission, camera busy, very old phone) the screen offers
 * "Use phone camera", which falls back to the old way.
 */
import { IMAGE } from './config';
import { $, $btn, show } from './dom';
import type { Scaled } from './image';

export interface CameraHandlers {
  onShot(img: Scaled): void;
  onCancel(): void;
  onFallback(): void; // called inside the tap on "Use phone camera" (so the camera app may open)
}

const START_TIMEOUT_MS = 10000;

let stream: MediaStream | null = null;
let handlers: CameraHandlers | null = null;
let startTimer: ReturnType<typeof setTimeout> | undefined;
let openSeq = 0;
/** true after the in-app camera failed once — the phone camera is used for the rest of this visit. */
export let useFileCamera = false;

const video = () => $('camVideo') as HTMLVideoElement;

export const liveCameraSupported = (): boolean =>
  window.isSecureContext && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

export const isCameraOpen = (): boolean => handlers !== null;

function stopStream(): void {
  clearTimeout(startTimer);
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  try { video().srcObject = null; } catch { /* ignore */ }
}

function finish(): CameraHandlers | null {
  openSeq++;
  stopStream();
  show($('camView'), false);
  document.documentElement.classList.remove('no-scroll');
  const h = handlers;
  handlers = null;
  return h;
}

function failed(text: string): void {
  stopStream();
  useFileCamera = true;
  show($('camWait'), false);
  $btn('camShot').disabled = true;
  $('camMsgText').textContent = text;
  show($('camMsg'), true);
}

function reason(e: unknown): string {
  const n = (e as { name?: string } | null)?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    return 'Camera permission is off for this app. Tap "Use phone camera" now. To use the in-app camera next time, allow Camera in Chrome → ⋮ → Settings → Site settings → Camera.';
  }
  if (n === 'NotReadableError' || n === 'AbortError') return 'The camera is busy (another app is using it). Close other apps, or tap "Use phone camera".';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No front camera found. Tap "Use phone camera".';
  return 'The camera did not start. Tap "Use phone camera".';
}

/** Opens the full-screen camera. Must be called from a tap. */
export function openLiveCamera(title: string, h: CameraHandlers): void {
  if (handlers) finish();
  handlers = h;
  const seq = ++openSeq;
  $('camTitle').textContent = title;
  show($('camMsg'), false);
  show($('camWait'), true);
  $btn('camShot').disabled = true;
  show($('camView'), true);
  document.documentElement.classList.add('no-scroll');

  startTimer = setTimeout(() => { if (seq === openSeq && !stream) failed(reason(null)); }, START_TIMEOUT_MS);
  void (async () => {
    try {
      // resizeMode 'none' = the camera's own picture size. Asking for a portrait size made Chrome
      // CROP the landscape sensor picture and blow it up (very zoomed-in preview, v15.2.0).
      const want: MediaTrackConstraints & { resizeMode?: string } = {
        facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 }, resizeMode: 'none'
      };
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: want });
      if (seq !== openSeq) { s.getTracks().forEach(t => t.stop()); return; } // closed meanwhile
      stream = s;
      const v = video();
      v.srcObject = s;
      await v.play().catch(() => null);
      if (!v.videoWidth) await new Promise<void>(res => v.addEventListener('loadeddata', () => res(), { once: true }));
      if (seq !== openSeq) return;
      fitFrame();
      clearTimeout(startTimer);
      show($('camWait'), false);
      $btn('camShot').disabled = false;
    } catch (e) {
      if (seq === openSeq) failed(reason(e));
    }
  })();
}

/** Preview box = the camera picture's own shape, so nothing is cut off or zoomed. */
function fitFrame(): void {
  const v = video();
  if (v.videoWidth && v.videoHeight) $('camFrame').style.setProperty('--ar', String(v.videoWidth / v.videoHeight));
}

/** Current video frame → small canvas (max IMAGE.selfieMaxSide, not mirrored). */
function grab(): Scaled | null {
  const v = video();
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return null;
  const k = Math.min(1, IMAGE.selfieMaxSide / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * k));
  const hgt = Math.max(1, Math.round(vh * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(v, 0, 0, w, hgt);
  return { c, g, w, h: hgt };
}

/** Closes the camera without a photo (app hidden, page leaving…). */
export function closeLiveCamera(): void {
  if (!handlers) return;
  finish()?.onCancel();
}

export function wireCamera(): void {
  $('camShot').addEventListener('click', () => {
    const img = grab();
    if (!img) return;
    finish()?.onShot(img);
  });
  $('camCancel').addEventListener('click', () => closeLiveCamera());
  video().addEventListener('resize', fitFrame); // phone turned
  $('camFallback').addEventListener('click', () => finish()?.onFallback());
}
