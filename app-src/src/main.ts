/**
 * AAP Attendance — employee app (GitHub Pages PWA / Android TWA).
 * Boot never waits for the network: the right screen is on the glass in one frame,
 * the server is asked in the background.
 */
import { api } from './api';
import { onAction, onFaceCancel, onFaceRetake, onPhoto, flushQueue, retryNow } from './checkin';
import { TIMING } from './config';
import { $, $input, esc, showMsg } from './dom';
import { PERM_MSG, isDenied, onGeoChange, prewarm, startWatch, stopWatch } from './geo';
import { openMain, resume } from './session';
import { loadMe, loadReg, saveCfg, saveMe, saveReg, setUrl } from './storage';
import { store } from './store';
import { istDate, setServerTime } from './time';
import type { PublicConfig } from './types';
import { checkReg, isPolling, showPending, showWelcome, wireAuth } from './ui/auth';
import { checkVersion, initInstall } from './ui/install';
import { renderHeader, renderLoc, tick } from './ui/main-screen';

function wireMain(): void {
  $('btnAction').addEventListener('click', onAction);
  $input('cam').addEventListener('change', () => void onPhoto());
  $('faceRetake').addEventListener('click', onFaceRetake);
  $('faceCancel').addEventListener('click', onFaceCancel);
  $('locChip').addEventListener('click', () => {
    if (isDenied()) { showMsg(esc(PERM_MSG), 'error'); return; }
    startWatch();
  });
  onGeoChange(renderLoc);
  window.addEventListener('online', retryNow);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (!store.queue.length) stopWatch(); return; }
    tick();
    checkVersion();
    if (isPolling()) { void checkReg(false); return; }
    if (!store.me) return;
    if (store.queue.length) { void flushQueue(); return; }
    const s = store.state;
    if (!s) return;
    if (istDate() !== s.date) openMain(); // past midnight: new day on screen at once
    else if (Date.now() - store.lastLoad > TIMING.refreshAfterMs) void resume();
    else void prewarm(s.canIn || s.canOut);
  });
}

/** Company name / geofence settings: refreshed in the background, used next time. */
function refreshPublicConfig(): void {
  api<PublicConfig>('publicBoot').then(c => {
    const keep: PublicConfig = {
      companyName: c.companyName, geoCheck: c.geoCheck, officeLat: c.officeLat, officeLng: c.officeLng,
      radius: c.radius, maxAcc: c.maxAcc, locTol: c.locTol, selfieMode: c.selfieMode
    };
    saveCfg(keep);
    Object.assign(store.cfg, keep);
    if (!store.live) setServerTime(c.serverTs);
    renderHeader();
  }).catch(() => null);
}

function boot(): void {
  tick();
  setInterval(tick, 1000);
  renderHeader();
  wireAuth();
  wireMain();
  initInstall();

  const qs = new URLSearchParams(location.search);
  const e = qs.get('e');
  const t = qs.get('t');
  const r = qs.get('r');
  const storedMe = loadMe();
  const storedReg = loadReg();

  if (e && t) {
    // personal link / iPhone home-screen icon / page refresh — same instant path as the app icon
    const urlMe = { id: e.toUpperCase(), token: t };
    store.me = storedMe && storedMe.id === urlMe.id && storedMe.token === urlMe.token ? storedMe : urlMe;
    if (store.me === urlMe) saveMe(urlMe);
    openMain();
  } else if (storedMe) {
    store.me = storedMe;
    setUrl({ e: storedMe.id, t: storedMe.token });
    openMain();
  } else if (r && t) {
    const name = storedReg?.name || '';
    saveReg({ regId: r, token: t, name });
    showPending({ status: 'PENDING', name });
    void checkReg(false);
  } else if (storedReg?.regId) {
    setUrl({ r: storedReg.regId, t: storedReg.token });
    showPending({ status: 'PENDING', name: storedReg.name });
    void checkReg(false);
  } else {
    showWelcome();
  }

  // network work starts after the first paint
  requestAnimationFrame(() => setTimeout(() => {
    refreshPublicConfig();
    if (store.me && store.queue.length) void flushQueue();
  }, 0));
}

boot();
