/** Install gate (website → app), "Update available" pop-up, old-APK gate, service worker, install sheet. */
import { APP, APP_URL, APP_VERSION, IS_ANDROID, IS_INAPP, IS_IOS } from '../config';
import { $, $a, $btn, boxMsg, show } from '../dom';
import { loadReg, session } from '../storage';
import { store } from '../store';
import type { VersionInfo } from '../types';

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<unknown>; }

const qs0 = new URLSearchParams(location.search);
const FROM_APK = document.referrer.startsWith('android-app://');
if (FROM_APK) session('aap_in_apk', '1');
if (qs0.get('apk')) session('aap_apk_v', qs0.get('apk') || '');
const IN_APK = FROM_APK || session('aap_in_apk') === '1';
const APK_V = Number(session('aap_apk_v') || 1);
export const STANDALONE = IN_APK || matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

let deferredPrompt: InstallPrompt | null = null;
let apkReady = false;
let updWanted: VersionInfo | null = null;

function personalLink(): string {
  if (store.me) return APP_URL + '?e=' + encodeURIComponent(store.me.id) + '&t=' + encodeURIComponent(store.me.token);
  const r = loadReg();
  return r ? APP_URL + '?r=' + encodeURIComponent(r.regId) + '&t=' + encodeURIComponent(r.token) : APP_URL;
}

async function copyText(text: string, msgId: string | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (msgId) boxMsg(msgId, 'Copied.');
  } catch {
    window.prompt('Copy this link:', text);
  }
}

function openInstall(): void {
  const steps = IS_IOS
    ? ['Open this page in <b>Safari</b> (not inside WhatsApp).', 'Tap the <b>Share</b> button <b>□↑</b> at the bottom.',
       'Scroll and tap <b>Add to Home Screen</b> → <b>Add</b>.', 'Open the app from the new icon on your home screen.']
    : IS_ANDROID
      ? ['Open this page in <b>Chrome</b> (not inside WhatsApp).', 'Tap <b>⋮</b> (top right of Chrome).',
         'Tap <b>Add to Home screen</b> → <b>Add</b> (or <b>Install</b>).', 'Open the app from the new icon on your home screen.']
      : ['On your phone, open this page in Chrome (Android) or Safari (iPhone).', 'Use the browser menu → <b>Add to Home Screen</b>.'];
  $('installSteps').innerHTML = IS_ANDROID && apkReady ? '' : steps.map(s => '<li>' + s + '</li>').join('');
  show($('apkBox'), IS_ANDROID && apkReady);
  show($('pwaInstall'), !!deferredPrompt);
  const link = personalLink();
  show($('myLinkBox'), !!store.me);
  if (store.me) $a('waLink').href = 'https://wa.me/?text=' + encodeURIComponent('My attendance app link (personal, do not share): ' + link);
  boxMsg('installMsg', '');
  show($('installSheet'), true);
}

function setupInApp(): void {
  if (!IS_INAPP) return;
  show($('inappCard'), true);
  if (IS_ANDROID) {
    $a('openChrome').href = 'intent://' + APP_URL.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
  } else {
    show($('openChrome'), false);
    show($('iosHint'), true);
    $('inappBrowser').textContent = IS_IOS ? 'Safari' : 'your browser';
  }
}

/** Full-screen "Install the app" (website) / "Update required" (old APK). */
function showGate(kind: 'install' | 'update'): void {
  const upd = kind === 'update';
  $('gateTitle').textContent = upd ? 'Update required' : 'Install AAP Attendance';
  $('gateText').textContent = upd ? 'A new version of the app is ready. Download and install it to continue.'
    : IS_INAPP ? 'Open this link in Chrome first, then download the app.'
    : 'Use the app for check in / check out. It stays logged in and opens instantly.';
  show($('gateAndroid'), IS_ANDROID);
  show($('gateIos'), IS_IOS && !upd);
  show($('gateOther'), !IS_ANDROID && !IS_IOS);
  show($('gateOpenApp'), IS_ANDROID && !upd && !IS_INAPP && !!APP.ANDROID_PACKAGE);
  show($('gateContinue'), !upd);
  const inChromeLink = IS_INAPP && IS_ANDROID;
  $a('gateApk').href = inChromeLink ? $a('openChrome').href : APP.APK_URL || '#';
  $a('gateApk').textContent = inChromeLink ? 'Open in Chrome' : upd ? '⬇ Download update' : '⬇ Download app';
  if (APP.ANDROID_PACKAGE) {
    $a('gateOpenApp').href = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;package=' + APP.ANDROID_PACKAGE + ';end';
  }
  show($('gate'), true);
}

/* ---------- updates ---------- */
export function checkVersion(): void {
  fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json() as Promise<VersionInfo>)
    .then(v => {
      if (v.web && v.web !== APP_VERSION && session('aap_reloaded_for') !== v.web) offerUpdate(v); // never loops
      if (IN_APK && IS_ANDROID && v.minApk && APK_V < v.minApk) showGate('update');
    })
    .catch(() => { /* offline: try again next time */ });
}

/** "Update available" pop-up: must tap Update now; waits while a check-in is still being saved. */
function offerUpdate(v: VersionInfo): void {
  updWanted = v;
  if (store.flushing || store.busy || store.queue.length) {
    setTimeout(() => { if (updWanted) offerUpdate(updWanted); }, 3000);
    return;
  }
  $('updNotes').textContent = v.notes || '';
  show($('updNotes'), !!v.notes);
  show($('updGate'), true);
}

async function updateNow(): Promise<void> {
  session('aap_reloaded_for', updWanted?.web || '');
  const b = $btn('updNow');
  b.disabled = true;
  b.textContent = 'Updating…';
  try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch { /* no Cache API */ }
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* offline */ }
  location.reload();
}

export function initInstall(): void {
  setupInApp();
  $('installBtn').addEventListener('click', openInstall);
  $('pwaInstall').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    void deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch { /* dismissed */ }
    deferredPrompt = null;
    show($('installSheet'), false);
  });
  $('installClose').addEventListener('click', () => show($('installSheet'), false));
  $('installSheet').addEventListener('click', ev => { if ((ev.target as HTMLElement).id === 'installSheet') show($('installSheet'), false); });
  $('copyLink2').addEventListener('click', () => void copyText(personalLink(), 'installMsg'));
  $('copyLink1').addEventListener('click', () => void copyText(APP_URL, null));
  $('gateContinue').addEventListener('click', () => { session('aap_gate_skip', '1'); show($('gate'), false); });
  $('updNow').addEventListener('click', () => void updateNow());
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e as InstallPrompt; });

  if (!STANDALONE && APP.API_URL && session('aap_gate_skip') !== '1') showGate('install');
  if (STANDALONE) show($('installBtn'), false);
  if (APP.APK_URL && IS_ANDROID && !STANDALONE) {
    $a('apkLink').href = APP.APK_URL;
    fetch(APP.APK_URL, { method: 'HEAD', cache: 'no-store' }).then(r => { apkReady = r.ok; }).catch(() => null);
  }
  if ('serviceWorker' in navigator) {
    const reg = () => navigator.serviceWorker.register('sw.js').catch(() => null);
    if (document.readyState === 'complete') void reg(); else window.addEventListener('load', () => void reg());
  }
  $('appVer').textContent = 'Version ' + APP_VERSION;
  checkVersion();
}
