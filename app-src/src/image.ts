/** Camera photo → small JPEG. Decoding straight to a small size keeps this ~50–150 ms even for 12 MP photos. */
import { IMAGE } from './config';

export interface Scaled { c: HTMLCanvasElement; g: CanvasRenderingContext2D; w: number; h: number; }

async function decode(file: Blob, maxSide: number): Promise<{ src: CanvasImageSource; w: number; h: number; done(): void }> {
  if (typeof createImageBitmap === 'function') {
    for (const opts of [
      { imageOrientation: 'from-image', resizeWidth: maxSide, resizeQuality: 'medium' },
      { imageOrientation: 'from-image' }
    ] as ImageBitmapOptions[]) {
      try {
        const b = await createImageBitmap(file, opts);
        return { src: b, w: b.width, h: b.height, done: () => b.close() };
      } catch { /* try the next way */ }
    }
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

export async function loadScaled(file: Blob, maxSide: number): Promise<Scaled> {
  const d = await decode(file, maxSide);
  const k = Math.min(1, maxSide / Math.max(d.w, d.h));
  const w = Math.max(1, Math.round(d.w * k));
  const h = Math.max(1, Math.round(d.h * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) { d.done(); throw new Error('Canvas not supported'); }
  g.drawImage(d.src, 0, 0, w, h);
  d.done();
  return { c, g, w, h };
}

/** Reference photo (registration): max 480 px, ~30–60 KB. */
export const loadRef = (file: Blob) => loadScaled(file, IMAGE.refMaxSide);
export const refJpeg = (s: Scaled) => s.c.toDataURL('image/jpeg', IMAGE.refQuality);

/** Check-in selfie: max 400 px. */
export const loadSelfie = (file: Blob) => loadScaled(file, IMAGE.selfieMaxSide);

/** Stamp name / action / time on the bottom of the selfie and return a ~20–40 KB JPEG. */
export function stampSelfie(s: Scaled, line1: string, line2: string): string {
  const { c, g, w, h } = s;
  const bar = Math.max(34, Math.round(h * 0.1));
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillRect(0, h - bar, w, bar);
  g.fillStyle = '#fff';
  const fs = Math.round(bar * 0.34);
  g.font = `600 ${fs}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
  g.fillText(line1, 8, h - bar + fs + 4);
  g.font = `${Math.round(fs * 0.85)}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
  g.fillText(line2, 8, h - 7);
  return c.toDataURL('image/jpeg', IMAGE.selfieQuality);
}

/** Small preview for the "No face detected" pop-up. */
export const previewJpeg = (s: Scaled) => s.c.toDataURL('image/jpeg', 0.5);
