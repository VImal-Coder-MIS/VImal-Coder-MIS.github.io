/**
 * "Is there a human face in this selfie?" — runs on the phone, free, no server.
 *
 * TinyFaceDetector (190 KB model) + TensorFlow.js are loaded lazily the moment the
 * employee taps Check In, i.e. while the camera is open, so detection is ready when the
 * photo comes back. Everything is cached by the service worker after the first time.
 *
 * This is face DETECTION (a face is present), not recognition (whose face it is).
 * If the detector cannot run at all on a phone (very old phone / no memory), the check-in is
 * NOT blocked; it is sent with face = "SKIPPED" so admin can see it.
 */
import type { FaceMeta } from './types';
import { withTimeout } from './util';

type FaceApi = typeof import('@vladmandic/face-api');
/** The parts of TensorFlow.js used here (face-api's bundled typings leave them out). */
interface Tf {
  setBackend(name: string): Promise<boolean>;
  ready(): Promise<void>;
  getBackend(): string;
  setWasmPaths(prefix: string): void;
}
const tfOf = (api: FaceApi) => api.tf as unknown as Tf;

export const FACE = {
  /** Tried in this order until a face is found. One size alone misses some very close faces
   *  (tested: a clear selfie scored 0.52 at 320 but 0.99 at 416 / 0.87 at 224). ~50 ms each. */
  inputSizes: [416, 224, 320],
  scoreThreshold: 0.4,  // detector confidence (photos without a face score nothing at all, even at 0.1)
  minFaceRatio: 0.12,   // face box must be ≥12 % of the photo width (a selfie, not a far-away person)
  waitMs: 8000          // max wait for the detector after the photo is taken
} as const;

const MODEL_URL = new URL('models/', document.baseURI).href;
const WASM_URL = new URL('wasm/', document.baseURI).href;
let loading: Promise<FaceApi> | null = null;

/**
 * Backends, fastest first for ONE photo on a phone:
 *   wasm (SIMD)  ~50–150 ms — no GPU start-up cost
 *   webgl        fast once warm, but compiling GPU programs costs ~1 s and the GPU can be lost while the camera is open
 *   cpu          plain JavaScript, ~1 s, always works
 */
async function useBackend(api: FaceApi, name: 'wasm' | 'webgl' | 'cpu'): Promise<boolean> {
  try {
    if (!(await tfOf(api).setBackend(name))) return false;
    await tfOf(api).ready();
    return true;
  } catch { return false; }
}

/** Start loading now (safe to call many times). */
export function preloadFace(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const api = await import('@vladmandic/face-api');
      try { tfOf(api).setWasmPaths(WASM_URL); } catch { /* already set */ }
      for (const b of ['wasm', 'webgl', 'cpu'] as const) if (await useBackend(api, b)) break;
      await api.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      // warm-up: the first run compiles the GPU programs; do it now, not after the photo
      const warm = document.createElement('canvas');
      warm.width = warm.height = 64;
      try { await api.detectSingleFace(warm, opts(api)); } catch { await useBackend(api, 'cpu'); }
      return api;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

const opts = (api: FaceApi, inputSize: number = FACE.inputSizes[0]) =>
  new api.TinyFaceDetectorOptions({ inputSize, scoreThreshold: FACE.scoreThreshold });

export interface FaceResult { found: boolean | null; meta: FaceMeta; }

async function detect(canvas: HTMLCanvasElement): Promise<FaceResult> {
  const t0 = performance.now();
  const api = await preloadFace();
  let best = 0;
  for (const size of FACE.inputSizes) {
    let dets;
    try {
      dets = await api.detectAllFaces(canvas, opts(api, size));
    } catch {
      // backend failed (e.g. GPU lost while the camera app was open on a low-memory phone) → plain CPU
      await useBackend(api, 'cpu');
      dets = await api.detectAllFaces(canvas, opts(api, size));
    }
    for (const d of dets) if (d.box.width >= canvas.width * FACE.minFaceRatio) best = Math.max(best, d.score);
    if (best) break;
  }
  const ms = Math.round(performance.now() - t0);
  return { found: best > 0, meta: { face: 'OK', score: Math.round(best * 100) / 100, ms } };
}

/** found: true = face, false = no face (block), null = could not check (allow, flagged). */
export async function checkFace(canvas: HTMLCanvasElement): Promise<FaceResult> {
  const skipped: FaceResult = { found: null, meta: { face: 'SKIPPED' } };
  return withTimeout(detect(canvas), FACE.waitMs, skipped);
}
