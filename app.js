/* AAP Attendance app (GitHub Pages / Android) v14.0.0 — talks to the Apps Script JSON API. */
const APP = window.APP_CONFIG || {};
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const CFG_KEY = 'aap_attendance_cfg_v9';
const BOOT = Object.assign(
  { companyName: 'Atlantic Agro Plast', geoCheck: true, officeLat: 28.655508, officeLng: 77.144102, radius: 100, maxAcc: 100, selfieMode: 'BOTH' },
  (function () { try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null') || {}; } catch (_) { return {}; } })(),
  { appUrl: APP_URL, serverTs: 0 });
(function () {
  'use strict';

  /* ---------- constants ---------- */
  const STORE_KEY = 'aap_attendance_v4';       // logged-in phone { id, token }
  const REG_KEY = 'aap_attendance_reg_v6';     // waiting registration { regId, token, name }
  const QUEUE_KEY = 'aap_attendance_queue_v5'; // unsent check-ins
  const STATE_KEY = 'aap_attendance_state_v9'; // last screen, shown instantly on open
  const PHOTO_KEY = 'aap_attendance_photo_v11'; // own reference photo, shown as the avatar
  const GOOD_ACC = 20;
  const SETTLE_MS = 6000;         // background: wait up to 6 s for a ≤20 m fix
  const MAX_WAIT_MS = 20000;      // then use the best fix we have (server allows for GPS accuracy)
  const OK_ACC = 35;              // a fix this good is used immediately
  const FIX_MAX_AGE_MS = 45000;
  const PREWARM_MS = 60000;
  const REFRESH_AFTER_MS = 60000;
  const POLL_MS = 15000;
  const SELFIE_MAX_AGE_MS = 120000;
  const SELFIE_MAX_SIDE = 400;
  const SELFIE_QUALITY = 0.6;
  const REF_MAX_SIDE = 480;      // reference photo (registration)
  const REF_QUALITY = 0.72;
  const RETRY_MS = [3000, 6000, 12000, 30000, 60000];
  const RETRYABLE = /NetworkError|Connection failure|HTTP 0|Failed to fetch|timed? ?out|Server is busy|Service (invoked too many times|unavailable)|Could not save the selfie|Internal error/i;
  const INAPP = /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|; wv\)/i;

  const BADGE = {
    'Present': ['Checked out', 'b-present'],
    'Checked In': ['Checked in', 'b-in'],
    'Absent': ['Not checked in', 'b-off'],
    'Weekly Off': ['Weekly off', 'b-off'],
    'Missing Check-out': ['Missing check-out', 'b-missing']
  };
  const PERM_MSG = 'Location permission denied. Android: Chrome ⋮ → Settings → Site settings → Location → Allow. ' +
    'iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Then reload this page.';

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const show = (node, on) => node.classList.toggle('hidden', !on);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const vibrate = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) {} };
  const clockFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const hmsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const stampFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const UA = navigator.userAgent;
  const IS_IOS = /iPhone|iPad|iPod/i.test(UA);
  const IS_ANDROID = /Android/i.test(UA);

  /** Calls the Apps Script JSON API (doPost). text/plain = no CORS preflight. */
  async function run(fn, ...args) {
    if (!APP.API_URL) throw new Error('App is not connected to the server yet. Contact admin.');
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 45000);
    let res;
    try {
      res = await fetch(APP.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ fn: fn, args: args }),
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'Request timed out' : 'NetworkError: ' + (e && e.message || e));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('Connection failure (HTTP ' + res.status + ')');
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('Connection failure (server did not answer correctly)'); }
    if (!j.ok) throw new Error(j.error || 'Internal error');
    return j.data;
  }

  function to12h(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
  }

  function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  const isRelink = e => /RELINK\|/.test(e && e.message || '');
  const isProfile = e => /PROFILE\|/.test(e && e.message || '');
  const isRetryable = e => RETRYABLE.test(e && e.message || '');
  const cleanErr = e => String(e && e.message || e).replace(/^.*(RELINK|PROFILE)\|/, '').replace(/^(Error|Exception):\s*/, '');

  function phoneInfo() {
    const os = /Android [\d.]+/.exec(UA) || /iPhone OS [\d_]+/.exec(UA) || /Windows NT [\d.]+/.exec(UA) || /Mac OS X [\d_]+/.exec(UA);
    const br = /Edg\/\d+/.exec(UA) || /SamsungBrowser\/\d+/.exec(UA) || /CriOS\/\d+/.exec(UA) || /Chrome\/\d+/.exec(UA) || /Version\/[\d.]+.*Safari/.exec(UA) || /Firefox\/\d+/.exec(UA);
    const model = (/;\s*([^;)]+)\s+Build\//.exec(UA) || [])[1] || '';
    const inapp = (INAPP.exec(UA) || [])[0];
    return [model, os && os[0].replace(/_/g, '.'), br && br[0].split(' ')[0], inapp && 'in ' + inapp.replace(/[;)\s]/g, '')].filter(Boolean).join(' · ');
  }

  const weakPin = p => /^(\d)\1{3}$/.test(p) || '0123456789012'.indexOf(p) !== -1 || '9876543210987'.indexOf(p) !== -1 ||
    ['1212', '2121', '1122', '6969', '1313', '2580', '0852', '1004', '2000', '2020', '1010', '0101'].indexOf(p) !== -1;
  const digits = v => String(v || '').replace(/\D/g, '');

  /* ---------- storage: identity in browser storage + page URL ---------- */
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function setUrl(params) {
    try {
      const q = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
      history.replaceState(null, '', location.pathname + q);
    } catch (_) {}
  }

  function loadMe() { const v = lsGet(STORE_KEY); return v && v.id && v.token ? v : null; }
  function saveMe(m) {
    lsSet(STORE_KEY, m);
    lsSet(REG_KEY, null);
    setUrl({ e: m.id, t: m.token }); // home-screen shortcut / bookmark keeps this phone logged in
  }
  function forgetMe() {
    lsSet(STORE_KEY, null);
    lsSet(STATE_KEY, null);
    setUrl({});
    me = null;
    queue = [];
    saveQueue();
  }
  function saveReg(r) { lsSet(REG_KEY, r); setUrl(r ? { r: r.regId, t: r.token } : {}); }
  function personalLink() {
    if (!BOOT.appUrl) return '';
    if (me) return BOOT.appUrl + '?e=' + encodeURIComponent(me.id) + '&t=' + encodeURIComponent(me.token);
    const r = lsGet(REG_KEY);
    return r ? BOOT.appUrl + '?r=' + encodeURIComponent(r.regId) + '&t=' + encodeURIComponent(r.token) : BOOT.appUrl;
  }

  function loadQueue() { const q = lsGet(QUEUE_KEY); return Array.isArray(q) ? q : []; }
  function saveQueue() { lsSet(QUEUE_KEY, queue.length ? queue : null); }

  /* ---------- state ---------- */
  let me = null;
  let server = null;
  let state = null;
  let busy = false;
  let lastLoad = Date.now();
  let clockOffset = BOOT.serverTs ? BOOT.serverTs - Date.now() : 0;
  let pendingAction = null;
  let queue = loadQueue();
  let flushing = false;
  let retryTimer = null;
  let retryStep = 0;
  let regMode = 'new';     // 'new' | 'profile'
  let profileFor = null;   // { id, token, name, dept }
  let pollTimer = null;
  let regPhoto = '';       // reference photo chosen on the Register form (JPEG data URL)
  let refMode = null;      // 'reg' | 'add'
  const cfg = BOOT;

  /* ---------- clock ---------- */
  function now() { return new Date(Date.now() + clockOffset); }
  function tick() {
    if (document.hidden) return;
    $('clock').textContent = clockFmt.format(now());
    if ($('todayClock')) $('todayClock').textContent = clockFmt.format(now());
    if (state && state.summary && state.summary.checkIn && !state.summary.checkOut && now().getSeconds() === 0) renderHours();
  }

  /* ---------- messages ---------- */
  function showMsg(html, type) {
    const el = $('msg');
    el.className = 'msg ' + (type || 'info');
    el.innerHTML = html;
  }
  function hideMsg() { $('msg').className = 'msg hidden'; }
  function boxMsg(id, text) { const el = $(id); el.textContent = text || ''; show(el, !!text); }
  function overlay(on, text) {
    $('overlayText').textContent = text || 'Please wait…';
    show($('overlay'), on);
  }
  function setSync(kind, text) {
    const el = $('syncLine');
    // v10: saving happens silently in the background — only problems are shown to the employee
    if (!kind || kind === 'busy' || kind === 'ok') { show(el, false); return; }
    el.className = 'sync sync-' + kind;
    el.innerHTML = (kind === 'busy' ? '<span class="mini-spin"></span>' : kind === 'ok' ? '✓ ' : '⚠ ') + esc(text);
  }

  /* ================================================================
   *  LOCATION MANAGER (pre-warm + early stop)
   * ================================================================ */
  const geoSupported = 'geolocation' in navigator;
  let fix = null;
  let watchId = null;
  let watchTimer = null;
  let geoDenied = false;
  const waiters = [];

  function geo() { return state || cfg; }
  function freshFix() { return fix && Date.now() - fix.t <= FIX_MAX_AGE_MS ? fix : null; }
  function fixDistance(f) {
    const g = geo();
    return f && g.officeLat != null ? Math.round(distanceM(f.lat, f.lng, g.officeLat, g.officeLng)) : null;
  }

  function onPos(p) {
    const r = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
    const cur = freshFix();
    if (!cur || r.acc <= cur.acc || Date.now() - cur.t > 15000) fix = r;
    geoDenied = false;
    renderLoc();
    waiters.slice().forEach(w => w.check());
  }
  function onPosErr(err) {
    if (err && err.code === 1) {
      geoDenied = true;
      stopWatch();
      waiters.slice().forEach(w => w.fail(new Error(PERM_MSG)));
    }
    renderLoc();
  }
  function startWatch(ms) {
    if (!geoSupported) return;
    if (watchId === null) watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    clearTimeout(watchTimer);
    watchTimer = setTimeout(stopWatch, ms || PREWARM_MS);
    renderLoc();
  }
  function stopWatch() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearTimeout(watchTimer);
    renderLoc();
  }
  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!geoSupported) { reject(new Error('This browser does not support location. Use Chrome (Android) or Safari (iPhone).')); return; }
      if (geoDenied) { reject(new Error(PERM_MSG)); return; }
      const maxAcc = geo().maxAcc;
      const ready = freshFix();
      if (ready && ready.acc <= OK_ACC) { resolve(ready); return; }
      const t0 = Date.now();
      let finished = false;
      const w = {
        check() {
          const f = freshFix();
          if (f && (f.acc <= GOOD_ACC || (f.acc <= OK_ACC && Date.now() - t0 >= SETTLE_MS))) done(null, f);
        },
        fail(e) { done(e); }
      };
      const settleTimer = setTimeout(() => w.check(), SETTLE_MS);
      const hardTimer = setTimeout(() => {
        const f = freshFix();
        if (f) done(null, f);   // best available (even if weak) — the server decides
        else done(new Error('Could not get your location. Turn ON Location/GPS on your phone and try again.'));
      }, MAX_WAIT_MS);
      function done(err, val) {
        if (finished) return;
        finished = true;
        clearTimeout(settleTimer);
        clearTimeout(hardTimer);
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        if (err) reject(err); else resolve(val);
      }
      waiters.push(w);
      startWatch(MAX_WAIT_MS + 15000);
      w.check();
    });
  }
  async function prewarm() {
    const g = geo();
    if (!g.geoCheck || !geoSupported || (state && !state.canIn && !state.canOut && !queue.length)) return;
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: 'geolocation' });
        if (p.state === 'granted') startWatch(PREWARM_MS);
        if (p.state === 'denied') { geoDenied = true; renderLoc(); }
        p.onchange = () => {
          geoDenied = p.state === 'denied';
          if (p.state === 'granted') startWatch(PREWARM_MS);
          renderLoc();
        };
      }
    } catch (_) { /* no Permissions API: GPS starts on first tap */ }
  }

  function renderLoc() {
    const g = geo();
    const f = freshFix();
    let cls = '';
    let text = 'Check my location';
    if (geoDenied) { cls = 'bad'; text = 'Location blocked · tap for help'; }
    else if (f && g.officeLat != null) {
      const d = fixDistance(f);
      const acc = Math.round(f.acc);
      cls = d > g.radius ? 'bad' : acc > g.maxAcc ? 'warn' : 'ok';
      text = d + ' m from office · ±' + acc + ' m';
    } else if (watchId !== null) text = 'Locating…';
    $('locChip').className = 'loc-chip ' + cls + (watchId !== null ? ' busy' : '') + (g.geoCheck ? '' : ' hidden');
    $('locText').textContent = text;
  }

    /* ================================================================
   *  VIEWS
   * ================================================================ */
  const VIEWS = ['welcome', 'reg', 'pending', 'login', 'load', 'main'];
  function showView(name) {
    VIEWS.forEach(v => show($(v + 'View'), v === name));
    show($('clockCard'), name === 'welcome' || name === 'load');
    if (name !== 'pending') stopPoll();
    window.scrollTo(0, 0);
  }
  function renderHeader() {
    $('company').textContent = (BOOT.companyName || 'Atlantic Agro Plast') + ' · Attendance';
    $('dateLabel').textContent = state ? state.dateLabel : dateFmt.format(now());
  }

  /** Central handling of "you must log in again" / "complete your profile". Returns true if handled. */
  function handleAuthError(e) {
    if (isProfile(e)) {
      let info = {};
      try { info = JSON.parse(String(e.message).replace(/^.*PROFILE\|/, '')); } catch (_) {}
      showRegister('profile', Object.assign({ token: me && me.token }, info));
      return true;
    }
    if (isRelink(e)) {
      forgetMe();
      showLogin(cleanErr(e));
      return true;
    }
    return false;
  }

  /* ---------- welcome ---------- */
  function showWelcome() {
    server = null;
    state = null;
    renderHeader();
    showView('welcome');
  }

  /* ---------- register / complete profile ---------- */
  function showRegister(mode, info) {
    regMode = mode === 'profile' ? 'profile' : 'new';
    profileFor = regMode === 'profile' ? info : null;
    server = null;
    state = null;
    renderHeader();
    $('regTitle').textContent = regMode === 'profile' ? 'Complete your profile' : 'Register';
    $('regSub').textContent = regMode === 'profile'
      ? 'One-time step for everyone. Fill your details; admin will approve.'
      : 'Fill your details. Admin will approve your registration.';
    if (regMode === 'profile' && info) {
      $('fName').value = info.name || '';
      $('fDept').value = info.dept || '';
    }
    show($('regBack'), regMode !== 'profile');
    boxMsg('regMsg', '');
    renderRegPhoto();
    const max = new Date(Date.now() - 16 * 365.25 * 86400000).toISOString().slice(0, 10);
    $('fDob').max = max;
    showView('reg');
  }

  async function submitRegistration(ev) {
    ev.preventDefault();
    if (busy) return;
    const d = {
      name: $('fName').value.trim(),
      mobile: digits($('fMobile').value).slice(-10),
      dob: $('fDob').value,
      dept: $('fDept').value.trim(),
      pin: $('fPin').value,
      photo: regPhoto
    };
    const err =
      !/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(d.name) ? 'Enter your full name (letters only).' :
      !/^[6-9]\d{9}$/.test(d.mobile) ? 'Enter a valid 10-digit mobile number.' :
      !d.dob ? 'Enter your date of birth.' :
      !/^\d{4}$/.test(d.pin) ? 'PIN must be exactly 4 digits.' :
      d.pin !== $('fPin2').value ? 'The two PINs do not match.' :
      weakPin(d.pin) ? 'This PIN is too easy to guess (like 1234 or 1111). Choose another.' :
      !d.photo ? 'Please add your photo (tap “Take photo”).' : '';
    if (err) { boxMsg('regMsg', err); vibrate([40, 60, 40]); return; }

    busy = true;
    overlay(true, 'Sending…');
    try {
      const link = regMode === 'profile' && profileFor ? [profileFor.id, profileFor.token] : [];
      const r = await run('regSubmit', d, phoneInfo(), ...link);
      if (regMode === 'profile') forgetMe();
      saveReg({ regId: r.regId, token: r.token, name: r.name });
      lsSet(PHOTO_KEY, { reg: r.regId, id: profileFor ? profileFor.id : '', photo: d.photo });
      $('regForm').reset();
      regPhoto = '';
      renderRegPhoto();
      showPending({ status: 'PENDING', name: r.name });
      vibrate(60);
    } catch (e) {
      if (!handleAuthError(e)) boxMsg('regMsg', cleanErr(e));
    } finally {
      busy = false;
      overlay(false);
    }
  }

  /* ---------- reference photo (register / add once) ---------- */
  function renderRegPhoto() {
    const has = !!regPhoto;
    $('regPhotoBox').classList.toggle('done', has);
    $('regPhotoPrev').innerHTML = has ? '<img alt="Your photo" src="' + regPhoto + '">' : '📷';
    $('regPhotoTitle').textContent = has ? 'Photo added ✓' : 'Add a clear photo of your face';
    $('regPhotoBtn').textContent = has ? '↻ Retake' : '📷 Take photo';
  }
  function pickRefPhoto(mode) {
    refMode = mode;
    const cam = $('refCam');
    cam.value = '';
    cam.click(); // must stay inside the tap handler so the camera can open
  }
  async function onRefPhoto() {
    const file = $('refCam').files && $('refCam').files[0];
    if (!file || !refMode) return;
    let photo;
    try {
      photo = await makeRefPhoto(file);
    } catch (e) {
      boxMsg(refMode === 'reg' ? 'regMsg' : 'photoMsg', 'Could not read the photo. Please try again.');
      return;
    }
    if (refMode === 'reg') {
      regPhoto = photo;
      renderRegPhoto();
      boxMsg('regMsg', '');
      return;
    }
    // existing employee adds a photo once
    if (busy || !me) return;
    busy = true;
    overlay(true, 'Saving photo…');
    try {
      applyServer(await run('empSetPhoto', me.id, me.token, photo));
      lsSet(PHOTO_KEY, { id: me.id, photo: photo });
      boxMsg('photoMsg', '');
      showMsg('✓ Reference photo saved. Thank you!', 'success');
      vibrate(60);
    } catch (e) {
      if (!handleAuthError(e)) boxMsg('photoMsg', cleanErr(e));
    } finally {
      busy = false;
      overlay(false);
      renderMain();
    }
  }

  /* ---------- waiting for approval ---------- */
  function showPending(st) {
    renderHeader();
    const s = st.status;
    const name = st.name || ((lsGet(REG_KEY) || {}).name) || '';
    $('pendIcon').textContent = s === 'REJECTED' ? '✗' : '⏳';
    $('pendTitle').textContent = s === 'REJECTED' ? 'Registration rejected'
      : s === 'REPLACED' ? 'This request was replaced'
      : s === 'APPROVED_ELSEWHERE' ? 'Approved — please log in' : 'Waiting for admin approval';
    $('pendText').textContent = s === 'REJECTED' ? (st.reason ? 'Reason: ' + st.reason : 'Contact admin for details.')
      : s === 'REPLACED' ? 'A newer registration was sent. Continue on the phone that sent it, or register again.'
      : s === 'APPROVED_ELSEWHERE' ? 'Your account is active. Log in with your mobile number and PIN.'
      : (name ? name + ', your' : 'Your') + ' request was sent. This screen opens automatically once admin approves.';
    show($('pendCheck'), s === 'PENDING');
    show($('pendAgain'), s === 'REJECTED' || s === 'REPLACED');
    show($('pendLogin'), s === 'APPROVED_ELSEWHERE');
    showView('pending');
    if (s === 'PENDING') startPoll();
  }

  async function checkReg(manual) {
    const r = lsGet(REG_KEY);
    if (!r) { showWelcome(); return; }
    if (manual) overlay(true, 'Checking…');
    try {
      const st = await run('regStatus', r.regId, r.token);
      if (st.status === 'APPROVED' && st.me) {
        const ph = lsGet(PHOTO_KEY);
        if (ph && ph.reg === r.regId) lsSet(PHOTO_KEY, { id: st.me.id, photo: ph.photo });
        me = st.me;
        saveMe(me);
        applyServer(st.state);
        showMsg('✓ <b>Approved!</b> You can check in now. Tip: tap <b>Install App</b> (top right).', 'success');
        vibrate([60, 80, 60]);
        return;
      }
      if (st.status === 'NOT_FOUND') { saveReg(null); showWelcome(); return; }
      showPending(st);
    } catch (e) {
      if (manual) boxMsg('regMsg', cleanErr(e));
    } finally {
      if (manual) overlay(false);
    }
  }
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => { if (!document.hidden) checkReg(false); }, POLL_MS);
  }
  function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  /* ---------- login ---------- */
  function showLogin(info) {
    server = null;
    state = null;
    renderHeader();
    boxMsg('loginMsg', '');
    boxMsg('loginInfo', info || '');
    showView('login');
  }

  async function submitLogin(ev) {
    ev.preventDefault();
    if (busy) return;
    const mobile = digits($('lMobile').value).slice(-10);
    const pin = $('lPin').value;
    if (!/^[6-9]\d{9}$/.test(mobile) || !/^\d{4}$/.test(pin)) { boxMsg('loginMsg', 'Enter your 10-digit mobile number and 4-digit PIN.'); return; }
    busy = true;
    overlay(true, 'Logging in…');
    try {
      const r = await run('empLogin', mobile, pin, phoneInfo());
      me = { id: r.id, token: r.token };
      saveMe(me);
      $('loginForm').reset();
      busy = false;
      applyServer(r.state);
      vibrate(60);
    } catch (e) {
      boxMsg('loginMsg', cleanErr(e));
      $('lPin').value = '';
      vibrate([40, 60, 40]);
    } finally {
      busy = false;
      overlay(false);
    }
  }

  /* ---------- install / keep logged in ---------- */
  function openInstall() {
    const steps = IS_IOS
      ? ['Open this page in <b>Safari</b> (not inside WhatsApp).', 'Tap the <b>Share</b> button <b>□↑</b> at the bottom.', 'Scroll and tap <b>Add to Home Screen</b> → <b>Add</b>.', 'Open the app from the new icon on your home screen.']
      : IS_ANDROID
        ? ['Open this page in <b>Chrome</b> (not inside WhatsApp).', 'Tap <b>⋮</b> (top right of Chrome).', 'Tap <b>Add to Home screen</b> → <b>Add</b> (or <b>Install</b>).', 'Open the app from the new icon on your home screen.']
        : ['On your phone, open this page in Chrome (Android) or Safari (iPhone).', 'Use the browser menu → <b>Add to Home Screen</b>.'];
    $('installSteps').innerHTML = steps.map(s => '<li>' + s + '</li>').join('');
    show($('apkBox'), IS_ANDROID && apkReady);
    show($('pwaInstall'), !!deferredPrompt);
    if (IS_ANDROID && apkReady) $('installSteps').innerHTML = '';
    const link = personalLink();
    show($('myLinkBox'), !!(me && link));
    if (me && link) {
      $('waLink').href = 'https://wa.me/?text=' + encodeURIComponent('My attendance app link (personal, do not share): ' + link);
    }
    boxMsg('installMsg', '');
    show($('installSheet'), true);
  }

  async function copyText(text, msgId) {
    try {
      await navigator.clipboard.writeText(text);
      if (msgId) boxMsg(msgId, 'Copied.');
    } catch (_) {
      window.prompt('Copy this link:', text);
    }
  }

  function setupInApp() {
    if (!INAPP.test(UA)) return;
    show($('inappCard'), true);
    const url = BOOT.appUrl || '';
    if (IS_ANDROID && url) {
      $('openChrome').href = 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
    } else {
      show($('openChrome'), false);
      show($('iosHint'), true);
      $('inappBrowser').textContent = IS_IOS ? 'Safari' : 'your browser';
    }
  }

  /* ---------- main (server state + optimistic pending jobs) ---------- */
  function applyServer(s, cached) {
    server = s;
    lastLoad = cached ? 0 : Date.now();
    if (s.serverTs && !cached) clockOffset = s.serverTs - Date.now();
    if (!cached && me) lsSet(STATE_KEY, { id: me.id, s: Object.assign({}, s, { serverTs: 0 }) });
    rebuild();
    showView('main');
    prewarm();
  }

  function rebuild() {
    if (!server) return;
    const s = JSON.parse(JSON.stringify(server));
    queue.filter(j => j.emp === (me && me.id) && j.date === s.date).forEach(j => {
      const time = hmsFmt.format(new Date(j.ts));
      s.events.push({ action: j.action, time: time, notes: j.notes, dist: j.dist == null ? '' : String(j.dist), pending: true });
      if (j.action === 'IN') {
        if (!s.summary.checkIn) s.summary.checkIn = time;
        s.summary.status = 'Checked In';
        s.canIn = false;
        s.canOut = true;
      } else {
        s.summary.checkOut = time;
        s.summary.status = 'Present';
        s.canOut = false;
        s.canIn = false;
        const firstIn = s.events.find(e => e.action === 'IN');
        if (firstIn) {
          const mins = (toSec(time) - toSec(firstIn.time)) / 60;
          if (mins > 0) s.summary.hours = (mins / 60).toFixed(2);
        }
      }
    });
    state = s;
    renderHeader();
    renderMain();
  }
  const toSec = t => { const [h, m, x] = String(t).split(':').map(Number); return h * 3600 + m * 60 + (x || 0); };

  function renderMain() {
    const s = state;
    if (!s) return;
    $('empName').textContent = s.name;
    $('empMeta').textContent = [s.id, s.department].filter(Boolean).join(' · ');
    show($('photoCard'), s.hasPhoto === false);
    renderAvatar(s);
    renderWeek(s);

    const b = BADGE[s.summary.status] || [s.summary.status, ''];
    $('statusBadge').textContent = b[0] + (s.summary.late ? ' · Late' : '');
    $('statusBadge').className = 'badge ' + b[1];

    const action = s.canIn ? 'IN' : s.canOut ? 'OUT' : null;
    const btn = $('btnAction');
    show($('actionCard'), !!action);
    show($('doneCard'), !action);
    if (action) {
      btn.textContent = action === 'IN' ? 'Check In' : 'Check Out';
      btn.className = 'btn btn-big ' + (action === 'IN' ? 'btn-in' : 'btn-out');
      btn.disabled = busy || queue.length > 0;
      btn.dataset.action = action;
    }

    const late = isLate(s.summary.checkIn, s);
    $('sumIn').textContent = to12h(s.summary.checkIn);
    $('sumInSub').innerHTML = s.summary.checkIn ? (late ? '<span class="t-late">Late</span>' : '<span class="t-ok">On time</span>') : 'Not yet';
    $('sumOut').textContent = to12h(s.summary.checkOut);
    $('sumOutSub').textContent = s.summary.checkOut ? 'Done for today' : s.summary.checkIn ? 'Pending' : 'Not yet';
    $('sumDays').textContent = s.monthDays != null ? s.monthDays : '—';
    renderHours();
    const firstIn = s.events.findIndex(e => e.action === 'IN');
    $('timeline').innerHTML = s.events.length
      ? s.events.slice().reverse().map(e => {
          const isIn = e.action === 'IN';
          const tag = isIn && s.events.indexOf(e) === firstIn ? (isLate(e.time, s) ? ' <span class="t-late">Late</span>' : ' <span class="t-ok">On time</span>') : '';
          return '<li><span class="ai ' + (isIn ? 'ai-in' : 'ai-out') + '">' + (isIn ? '↘' : '↗') + '</span>' +
            '<div class="a-body"><div class="strong">' + (isIn ? 'Check In' : 'Check Out') + tag + '</div>' +
            '<div class="muted small">' + esc(state.dateLabel || '') +
              (e.dist !== '' && e.dist != null ? ' · ' + esc(e.dist) + ' m from office' : '') +
              (e.notes ? ' · ' + esc(e.notes) : '') + '</div></div>' +
            '<span class="a-time">' + esc(to12h(e.time)) + '</span></li>';
        }).join('')
      : '<li class="muted" style="padding:14px 0">No activity yet today.</li>';

    $('zoneText').textContent = s.geoCheck ? 'Allowed within ' + s.radius + ' m of office' : 'Location check is off';
    $('phoneLine').textContent = s.linkedSince ? '📱 This phone is linked since ' + s.linkedSince + (s.phoneInfo ? ' · ' + s.phoneInfo : '') : '';
    renderLoc();
  }

  /* ---------- v11 main-screen helpers ---------- */
  function isLate(t, s) {
    if (!t) return false;
    const after = (s && s.lateAfter) || '10:15';
    return toSec(String(t).length === 5 ? t + ':00' : t) > toSec(after + ':59');
  }
  function fmtDur(mins) {
    mins = Math.max(0, Math.round(mins));
    return Math.floor(mins / 60) + 'h ' + String(mins % 60).padStart(2, '0') + 'm';
  }
  function renderHours() {
    const s = state;
    if (!s || !$('sumHours')) return;
    if (s.summary.checkIn && !s.summary.checkOut) {
      const nowSec = toSec(hmsFmt.format(now()));
      $('sumHours').textContent = fmtDur((nowSec - toSec(s.summary.checkIn)) / 60);
      $('sumHoursSub').textContent = 'Running';
    } else if (s.summary.hours) {
      $('sumHours').textContent = fmtDur(Number(s.summary.hours) * 60);
      $('sumHoursSub').textContent = 'Today';
    } else {
      $('sumHours').textContent = '—';
      $('sumHoursSub').textContent = 'Today';
    }
  }
  let avatarAsked = '';
  function renderAvatar(s) {
    const p = lsGet(PHOTO_KEY);
    const el = $('empAvatar');
    if (p && p.id === s.id && p.photo) { el.innerHTML = '<img alt="" src="' + p.photo + '">'; return; }
    el.textContent = String(s.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    // registration photo is on the server → fetch it once and keep it on this phone
    if (s.hasPhoto && me && avatarAsked !== s.id) {
      avatarAsked = s.id;
      run('empPhoto', me.id, me.token).then(photo => {
        if (!photo || !me || me.id !== s.id) return;
        lsSet(PHOTO_KEY, { id: s.id, photo: photo });
        if (state && state.id === s.id) renderAvatar(state);
      }).catch(() => { avatarAsked = ''; });
    }
  }
  function renderWeek(s) {
    const w = s.week || [];
    $('weekStrip').innerHTML = w.map(d => '<div class="wd' + (d.today ? ' today' : '') + (d.future ? ' future' : '') + '">' +
      '<span class="wd-l">' + esc(d.label) + '</span><span class="wd-n">' + d.day + '</span>' +
      '<span class="wd-dot ' + (d.present ? 'p' : d.off ? 'o' : d.future || d.today ? '' : 'a') + '"></span></div>').join('');
    show($('weekStrip'), w.length > 0);
  }

  async function resume(quiet) {
    if (!me) return;
    if (!quiet && !server) showView('load');
    try {
      applyServer(await run('empResume', me.id, me.token));
    } catch (e) {
      if (handleAuthError(e)) return;
      if (!server) { showView('main'); showMsg(esc(cleanErr(e)), 'error'); }
    }
  }

  /* ================================================================
   *  CHECK IN / OUT — optimistic
   *  tap → selfie → "✓ Checked in" on screen immediately →
   *  location + upload continue in the background (with retry).
   * ================================================================ */
  function selfieNeeded(action) {
    const m = geo().selfieMode;
    return m === 'BOTH' || (m === 'IN' && action === 'IN');
  }

  function onAction() {
    if (busy || !state || queue.length) return;
    const action = $('btnAction').dataset.action;
    if (!action) return;
    hideMsg();
    pendingAction = action;
    if (geo().geoCheck) startWatch(MAX_WAIT_MS + 30000);
    if (selfieNeeded(action)) {
      const cam = $('cam');
      cam.value = '';
      cam.click(); // must stay inside the tap handler so the camera can open
    } else {
      record(action, '');
    }
  }

  async function onPhoto() {
    const file = $('cam').files && $('cam').files[0];
    const action = pendingAction;
    if (!file || !action) return;
    if (file.lastModified && Math.abs(Date.now() - file.lastModified) > SELFIE_MAX_AGE_MS) {
      showMsg('Please take a NEW selfie with the camera. Old photos from the gallery are not allowed.', 'error');
      vibrate([40, 60, 40]);
      return;
    }
    busy = true;
    try {
      const t0 = performance.now();
      const selfie = await makeSelfie(file, action);
      window.__selfieMs = Math.round(performance.now() - t0);
      busy = false;
      record(action, selfie);
    } catch (e) {
      busy = false;
      showMsg('Could not read the photo. Please tap the button and try again.', 'error');
      renderMain();
    }
  }

  /** Decode a camera photo straight into a small canvas (max side `maxSide`). */
  async function loadScaled(file, maxSide) {
    let src = null;
    let cleanup = () => {};
    if (window.createImageBitmap) {
      try {
        // decode straight to small size when supported (much faster on big camera photos)
        src = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: maxSide, resizeQuality: 'medium' });
      } catch (_) {
        try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (__) { src = null; }
      }
    }
    if (!src) {
      const url = URL.createObjectURL(file);
      cleanup = () => URL.revokeObjectURL(url);
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    }
    const w = src.width || src.naturalWidth;
    const h = src.height || src.naturalHeight;
    const k = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.round(w * k);
    const ch = Math.round(h * k);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0, cw, ch);
    cleanup();
    if (src.close) src.close();
    return { c, g, cw, ch };
  }

  /** Reference photo: max 480 px, ~30–60 KB JPEG. */
  async function makeRefPhoto(file) {
    const { c } = await loadScaled(file, REF_MAX_SIDE);
    return c.toDataURL('image/jpeg', REF_QUALITY);
  }

  /** Resize to max 400 px, stamp name/action/time, return a ~20–40 KB JPEG data URL. */
  async function makeSelfie(file, action) {
    const { c, g, cw, ch } = await loadScaled(file, SELFIE_MAX_SIDE);

    const bar = Math.max(34, Math.round(ch * 0.1));
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillRect(0, ch - bar, cw, bar);
    g.fillStyle = '#fff';
    const fs = Math.round(bar * 0.34);
    g.font = '600 ' + fs + 'px system-ui, -apple-system, Roboto, Arial, sans-serif';
    g.fillText(state.name + ' · ' + (action === 'IN' ? 'Check In' : 'Check Out'), 8, ch - bar + fs + 4);
    g.font = Math.round(fs * 0.85) + 'px system-ui, -apple-system, Roboto, Arial, sans-serif';
    g.fillText(stampFmt.format(now()) + ' IST', 8, ch - 7);
    return c.toDataURL('image/jpeg', SELFIE_QUALITY);
  }

  /** Optimistic: show success now, upload in background. */
  function record(action, selfie) {
    const g = geo();
    const f = freshFix();
    // If we already KNOW the phone is outside the zone, say so now instead of a fake success.
    if (g.geoCheck && f && f.acc <= OK_ACC && fixDistance(f) - Math.min(f.acc, g.locTol || 0) > g.radius) {
      showMsg('You are ' + fixDistance(f) + ' m away from the office. Check In/Out is allowed only within ' + g.radius + ' m.', 'error');
      vibrate([40, 60, 40]);
      return;
    }
    const ts = Date.now() + clockOffset;
    const job = {
      rid: uuid(),
      emp: me.id,
      date: new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      action: action,
      notes: $('notes').value,
      selfie: selfie,
      ts: ts,
      loc: f && f.acc <= OK_ACC ? { lat: f.lat, lng: f.lng, acc: f.acc } : null,   // weak fix → get a better one in the background
      dist: f ? fixDistance(f) : null,
      tries: 0
    };
    queue.push(job);
    saveQueue();
    $('notes').value = '';
    $('noteBox').open = false;

    rebuild();                                   // ← UI flips to "Checked in" right here
    window.__shownAt = performance.now();
    const label = action === 'IN' ? 'Checked in' : 'Checked out';
    const thumb = selfie ? '<img class="thumb" src="' + selfie + '" alt="" style="float:right;margin-left:8px">' : '';
    const okHtml = thumb + '✓ <b>' + label + ' at ' + esc(to12h(hmsFmt.format(new Date(ts)))) + '</b>';
    if (state.canIn || state.canOut) showMsg(okHtml, 'success');
    else { $('doneMsg').innerHTML = okHtml; show($('doneMsg'), true); }
    setSync('busy', 'Saving…');
    vibrate(60);
    flushQueue();
  }

  /** Sends queued jobs in order. Network problems → retry later; real rejections → undo + explain. */
  async function flushQueue() {
    if (flushing || !me) return;
    flushing = true;
    clearTimeout(retryTimer);
    try {
      while (queue.length) {
        const job = queue[0];
        if (job.emp !== me.id) { queue.shift(); saveQueue(); continue; }
        setSync('busy', job.loc || !geo().geoCheck ? 'Saving…' : 'Getting location…');
        if (!job.loc && geo().geoCheck) {
          try {
            const f = await getLocation();
            job.loc = { lat: f.lat, lng: f.lng, acc: f.acc };
            job.dist = fixDistance(f);
            saveQueue();
            setSync('busy', 'Saving…');
          } catch (e) {
            reject(job, e);
            continue;
          }
        }
        try {
          job.tries++;
          const t0 = performance.now();
          const s = await run('empSubmit', me.id, me.token, job.action, job.notes, job.loc, job.selfie, navigator.userAgent, job.rid, job.ts);
          window.__serverMs = Math.round(performance.now() - t0);
          queue.shift();
          saveQueue();
          retryStep = 0;
          applyServer(s);
          setSync('ok', 'Saved' + (job.dist != null ? ' · ' + job.dist + ' m from office' : ''));
          setTimeout(() => { if (!queue.length) setSync(null); }, 4000);
          stopWatch();
        } catch (e) {
          if (handleAuthError(e)) return;
          // weak indoor GPS: silently try twice more with a fresh reading before telling the employee
          if (/away from the office|signal is weak/i.test(e.message) && (job.geoTries || 0) < 2 && job.loc && job.loc.acc > 20) {
            job.geoTries = (job.geoTries || 0) + 1;
            job.loc = null;
            fix = null;
            saveQueue();
            await new Promise(r => setTimeout(r, 4000));
            continue;
          }
          if (isRetryable(e) || !navigator.onLine) {
            const wait = RETRY_MS[Math.min(retryStep++, RETRY_MS.length - 1)];
            setSync('warn', 'No connection — will retry automatically. Keep this page open.');
            retryTimer = setTimeout(flushQueue, wait);
            return;
          }
          reject(job, e);
        }
      }
    } finally {
      flushing = false;
    }
  }

  function reject(job, e) {
    const i = queue.indexOf(job);
    if (i >= 0) queue.splice(i, 1);
    saveQueue();
    hideMsg();
    show($('doneMsg'), false);
    rebuild();
    showMsg('✗ ' + (job.action === 'IN' ? 'Check In' : 'Check Out') + ' NOT saved: ' + esc(cleanErr(e)), 'error');
    setSync('bad', 'Not saved');
    vibrate([40, 60, 40, 60, 40]);
    resume(true);
  }

    /* ---------- events ---------- */
  $('goRegister').addEventListener('click', () => showRegister('new'));
  $('goLogin').addEventListener('click', () => showLogin(''));
  $('toRegister').addEventListener('click', ev => { ev.preventDefault(); showRegister('new'); });
  $('regBack').addEventListener('click', showWelcome);
  $('regForm').addEventListener('submit', submitRegistration);
  $('loginForm').addEventListener('submit', submitLogin);
  $('pendCheck').addEventListener('click', () => checkReg(true));
  $('pendAgain').addEventListener('click', () => { saveReg(null); showRegister('new'); });
  $('pendLogin').addEventListener('click', () => { saveReg(null); showLogin(''); });
  ['fMobile', 'lMobile'].forEach(id => $(id).addEventListener('input', e => { e.target.value = digits(e.target.value).slice(-10); })); // "+91 98765 43210" → 9876543210
  ['fPin', 'fPin2', 'lPin'].forEach(id => $(id).addEventListener('input', e => { e.target.value = digits(e.target.value).slice(0, 4); }));
  $('installBtn').addEventListener('click', openInstall);
  $('pwaInstall').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    deferredPrompt = null;
    show($('installSheet'), false);
  });
  $('installClose').addEventListener('click', () => show($('installSheet'), false));
  $('installSheet').addEventListener('click', ev => { if (ev.target.id === 'installSheet') show($('installSheet'), false); });
  $('copyLink2').addEventListener('click', () => copyText(personalLink(), 'installMsg'));
  $('copyLink1').addEventListener('click', () => copyText(BOOT.appUrl || location.href, null));
  $('btnAction').addEventListener('click', onAction);
  $('cam').addEventListener('change', onPhoto);
  $('refCam').addEventListener('change', onRefPhoto);
  $('regPhotoBtn').addEventListener('click', () => pickRefPhoto('reg'));
  $('addPhotoBtn').addEventListener('click', () => pickRefPhoto('add'));
  $('locChip').addEventListener('click', () => {
    if (geoDenied) { showMsg(esc(PERM_MSG), 'error'); return; }
    startWatch(PREWARM_MS);
  });
  window.addEventListener('online', () => { if (queue.length) flushQueue(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (!queue.length) stopWatch(); return; }
    tick();
    if (pollTimer) { checkReg(false); return; }
    if (!me) return;
    if (queue.length) { flushQueue(); return; }
    if (!state) return;
    const today = now().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (today !== state.date || Date.now() - lastLoad > REFRESH_AFTER_MS) resume(true);
    else prewarm();
  });

  /* ---------- boot ---------- */
  tick();
  setInterval(tick, 1000);
  renderHeader();
  setupInApp();

  /* installed-app detection, install prompt, APK link */
  const APP_VERSION = '14.0.0';
  const qs0 = new URLSearchParams(location.search);
  const FROM_APK = String(document.referrer).indexOf('android-app://') === 0;
  try {
    if (FROM_APK) sessionStorage.setItem('aap_in_apk', '1');
    if (qs0.get('apk')) sessionStorage.setItem('aap_apk_v', qs0.get('apk'));
  } catch (_) {}
  const IN_APK = FROM_APK || (function () { try { return sessionStorage.getItem('aap_in_apk') === '1'; } catch (_) { return false; } })();
  const APK_V = Number((function () { try { return sessionStorage.getItem('aap_apk_v'); } catch (_) { return 0; } })() || 1);
  const STANDALONE = IN_APK || (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  /* full-screen "Install the app" (website) / "Update required" (old APK) */
  function showGate(kind) {
    const upd = kind === 'update';
    $('gateTitle').textContent = upd ? 'Update required' : 'Install AAP Attendance';
    $('gateText').textContent = upd ? 'A new version of the app is ready. Download and install it to continue.'
      : INAPP.test(UA) ? 'Open this link in Chrome first, then download the app.'
      : 'Use the app for check in / check out. It stays logged in and opens instantly.';
    show($('gateAndroid'), IS_ANDROID);
    show($('gateIos'), IS_IOS && !upd);
    show($('gateOther'), !IS_ANDROID && !IS_IOS);
    show($('gateOpenApp'), IS_ANDROID && !upd && !INAPP.test(UA) && !!APP.ANDROID_PACKAGE);
    show($('gateContinue'), !upd);
    $('gateApk').href = INAPP.test(UA) && IS_ANDROID ? $('openChrome').href : (APP.APK_URL || '#');
    $('gateApk').textContent = INAPP.test(UA) && IS_ANDROID ? 'Open in Chrome' : upd ? '⬇ Download update' : '⬇ Download app';
    if (APP.ANDROID_PACKAGE) $('gateOpenApp').href = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;package=' + APP.ANDROID_PACKAGE + ';end';
    show($('gate'), true);
  }
  $('gateContinue').addEventListener('click', () => {
    try { sessionStorage.setItem('aap_gate_skip', '1'); } catch (_) {}
    show($('gate'), false);
  });
  if (!STANDALONE && APP.API_URL) {
    let skip = false;
    try { skip = sessionStorage.getItem('aap_gate_skip') === '1'; } catch (_) {}
    if (!skip) showGate('install');
  }

  /* updates: screens update by themselves; an old APK gets a blocking "Update required" */
  function checkVersion() {
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).then(v => {
      if (v.web && v.web !== APP_VERSION) {
        let done = '';
        try { done = sessionStorage.getItem('aap_reloaded_for') || ''; } catch (_) {}
        if (done !== v.web) { offerUpdate(v); return; }   // (already updated once this session → never loop)
      }
      if (IN_APK && IS_ANDROID && v.minApk && APK_V < v.minApk) showGate('update');
    }).catch(() => {});
  }
  /* "Update available" pop-up: must tap Update now; waits while a check-in is still being saved */
  let updWanted = null;
  function offerUpdate(v) {
    updWanted = v;
    if (flushing || busy || queue.length) { setTimeout(() => { if (updWanted) offerUpdate(updWanted); }, 3000); return; }
    $('updNotes').textContent = v.notes || '';
    show($('updNotes'), !!v.notes);
    show($('updGate'), true);
  }
  $('updNow').addEventListener('click', () => {
    const v = updWanted || {};
    try { sessionStorage.setItem('aap_reloaded_for', v.web || ''); } catch (_) {}
    $('updNow').disabled = true;
    $('updNow').textContent = 'Updating…';
    const go = () => location.reload();
    const clear = window.caches ? caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))) : Promise.resolve();
    clear.catch(() => {}).then(() => navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration() : null)
      .then(r => r && r.update()).catch(() => {}).then(go);
  });
  checkVersion();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  let deferredPrompt = null;
  let apkReady = false;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
  if (STANDALONE) show($('installBtn'), false);
  if (APP.APK_URL && IS_ANDROID && !STANDALONE) {
    $('apkLink').href = APP.APK_URL;
    fetch(APP.APK_URL, { method: 'HEAD', cache: 'no-store' }).then(r => { apkReady = r.ok; }).catch(() => {});
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  /* settings (company name, geofence) refresh in the background */
  run('publicBoot').then(c => {
    const keep = { companyName: c.companyName, geoCheck: c.geoCheck, officeLat: c.officeLat, officeLng: c.officeLng, radius: c.radius, maxAcc: c.maxAcc, selfieMode: c.selfieMode };
    lsSet(CFG_KEY, keep);
    Object.assign(BOOT, keep);
    if (!server && c.serverTs) clockOffset = c.serverTs - Date.now();
    renderHeader();
  }).catch(() => {});

  const qs = new URLSearchParams(location.search);
  const storedMe = loadMe();
  const storedReg = lsGet(REG_KEY);
  const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (qs.get('e') && qs.get('t')) {
    me = { id: qs.get('e').toUpperCase(), token: qs.get('t') };   // personal link / iPhone home-screen icon
    saveMe(me);
    resume(false);
  } else if (qs.get('r') && qs.get('t')) {
    saveReg({ regId: qs.get('r'), token: qs.get('t'), name: (storedReg && storedReg.name) || '' });
    showPending({ status: 'PENDING', name: (storedReg && storedReg.name) || '' });
    checkReg(false);
  } else if (storedMe) {
    me = storedMe;
    setUrl({ e: me.id, t: me.token });
    const cs = lsGet(STATE_KEY);
    if (cs && cs.id === me.id && cs.s && cs.s.date === todayIst) {
      applyServer(cs.s, true);   // instant screen from last time …
      resume(true);              // … then fresh data from the server
    } else {
      resume(false);
    }
  } else if (storedReg && storedReg.regId) {
    setUrl({ r: storedReg.regId, t: storedReg.token });
    showPending({ status: 'PENDING', name: storedReg.name });
    checkReg(false);
  } else {
    showWelcome();
  }
  if (me && queue.length) {
    setSync('busy', 'Saving your last ' + (queue[0].action === 'IN' ? 'check-in' : 'check-out') + '…');
    flushQueue();
  }
})();
