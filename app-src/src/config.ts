import type { AppConfig, PublicConfig } from './types';

declare const __APP_VERSION__: string;
declare global { interface Window { APP_CONFIG?: AppConfig; } }

/** Injected at build time (package.json "version"). */
export const APP_VERSION: string = __APP_VERSION__;

/** config.js (not bundled, so the server URL can change without a rebuild). */
export const APP: AppConfig = window.APP_CONFIG || {};

export const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');

export const UA = navigator.userAgent;
export const IS_IOS = /iPhone|iPad|iPod/i.test(UA);
export const IS_ANDROID = /Android/i.test(UA);
export const INAPP_RE = /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|; wv\)/i;
export const IS_INAPP = INAPP_RE.test(UA);

/** Storage keys (kept from earlier versions so nobody is logged out by this update). */
export const KEYS = {
  me: 'aap_attendance_v4',
  reg: 'aap_attendance_reg_v6',
  queue: 'aap_attendance_queue_v5',
  state: 'aap_attendance_state_v9',
  photo: 'aap_attendance_photo_v11',
  cfg: 'aap_attendance_cfg_v9'
} as const;

export const TIMING = {
  apiTimeoutMs: 30000,
  regPollMs: 15000,
  refreshAfterMs: 60000,
  retryMs: [2000, 5000, 10000, 20000, 40000, 60000],
  selfieMaxAgeMs: 120000
} as const;

export const GPS = {
  goodAcc: 20,         // accept immediately
  okAcc: 35,           // accept after settleMs
  settleMs: 6000,
  maxWaitMs: 20000,    // then use the best fix we have — the server allows for GPS accuracy
  fixMaxAgeMs: 45000,
  prewarmMs: 60000
} as const;

export const IMAGE = {
  selfieMaxSide: 400,
  selfieQuality: 0.6,
  refMaxSide: 480,
  refQuality: 0.72
} as const;

export const DEFAULT_CFG: PublicConfig = {
  companyName: 'Atlantic Agro Plast',
  geoCheck: true,
  officeLat: 28.655508,
  officeLng: 77.144102,
  radius: 100,
  maxAcc: 100,
  locTol: 50,
  selfieMode: 'BOTH'
};
