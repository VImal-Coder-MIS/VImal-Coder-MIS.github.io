/** Apps Script JSON API (doPost). text/plain = no CORS pre-flight = one round trip less. */
import { APP, TIMING } from './config';

export class ApiError extends Error {
  /** Network / server hiccup → safe to retry later. */
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

const RETRYABLE_SERVER = /Server is busy|Service (invoked too many times|unavailable)|Could not save the selfie|Internal error|timed? ?out/i;

export async function api<T>(fn: string, ...args: unknown[]): Promise<T> {
  if (!APP.API_URL) throw new ApiError('App is not connected to the server yet. Contact admin.', false);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMING.apiTimeoutMs);
  let res: Response;
  try {
    res = await fetch(APP.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args }),
      redirect: 'follow',
      signal: ctrl.signal
    });
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    throw new ApiError(aborted ? 'Request timed out' : 'No internet connection', true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError('Connection failure (HTTP ' + res.status + ')', true);
  let body: { ok: boolean; data?: T; error?: string };
  try { body = await res.json(); } catch { throw new ApiError('Connection failure (bad server answer)', true); }
  if (!body.ok) {
    const msg = body.error || 'Internal error';
    throw new ApiError(msg, RETRYABLE_SERVER.test(msg));
  }
  return body.data as T;
}

export const isRelink = (e: unknown) => /RELINK\|/.test((e as Error)?.message || '');
export const isProfile = (e: unknown) => /PROFILE\|/.test((e as Error)?.message || '');
export const isRetryable = (e: unknown) => e instanceof ApiError ? e.retryable : !navigator.onLine;
export const cleanErr = (e: unknown) =>
  String((e as Error)?.message || e).replace(/^.*(RELINK|PROFILE)\|/, '').replace(/^(Error|Exception):\s*/, '');
