/** Welcome · Register / complete profile · Waiting for approval · Login · reference photo. */
import { api, cleanErr } from '../api';
import { TIMING } from '../config';
import { $, $input, boxMsg, overlay, show, showMsg, vibrate } from '../dom';
import { checkFace, preloadFace } from '../face';
import { loadRef, refJpeg } from '../image';
import { applyServer, forgetMe, handleAuthError } from '../session';
import { loadPhoto, loadReg, saveMe, savePhoto, saveReg } from '../storage';
import { store } from '../store';
import type { EmpState, Me, RegStatus } from '../types';
import { digits, phoneInfo, weakPin } from '../util';
import { onViewChange, renderHeader, renderMain, showView } from './main-screen';

let regMode: 'new' | 'profile' = 'new';
let profileFor: Record<string, string> | null = null;
let regPhoto = '';
let refMode: 'reg' | 'add' | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const NO_FACE_REF = 'No face detected in this photo. Take a clear photo of your face (good light, look at the camera).';

function leaveSession(): void {
  store.server = null;
  store.state = null;
  renderHeader();
}

/* ---------- welcome ---------- */
export function showWelcome(): void {
  leaveSession();
  showView('welcome');
}

/* ---------- register / complete profile ---------- */
export function showRegister(mode: 'new' | 'profile', info?: Record<string, string>): void {
  regMode = mode;
  profileFor = mode === 'profile' ? info || null : null;
  leaveSession();
  $('regTitle').textContent = mode === 'profile' ? 'Complete your profile' : 'Register';
  $('regSub').textContent = mode === 'profile'
    ? 'One-time step for everyone. Fill your details; admin will approve.'
    : 'Fill your details. Admin will approve your registration.';
  if (mode === 'profile' && info) {
    $input('fName').value = info.name || '';
    $input('fDept').value = info.dept || '';
  }
  show($('regBack'), mode !== 'profile');
  boxMsg('regMsg', '');
  renderRegPhoto();
  $input('fDob').max = new Date(Date.now() - 16 * 365.25 * 86400000).toISOString().slice(0, 10);
  showView('reg');
}

async function submitRegistration(ev: Event): Promise<void> {
  ev.preventDefault();
  if (store.busy) return;
  const d = {
    name: $input('fName').value.trim(),
    mobile: digits($input('fMobile').value).slice(-10),
    dob: $input('fDob').value,
    dept: $input('fDept').value.trim(),
    pin: $input('fPin').value,
    photo: regPhoto
  };
  const err =
    !/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(d.name) ? 'Enter your full name (letters only).' :
    !/^[6-9]\d{9}$/.test(d.mobile) ? 'Enter a valid 10-digit mobile number.' :
    !d.dob ? 'Enter your date of birth.' :
    !/^\d{4}$/.test(d.pin) ? 'PIN must be exactly 4 digits.' :
    d.pin !== $input('fPin2').value ? 'The two PINs do not match.' :
    weakPin(d.pin) ? 'This PIN is too easy to guess (like 1234 or 1111). Choose another.' :
    !d.photo ? 'Please add your photo (tap “Take photo”).' : '';
  if (err) { boxMsg('regMsg', err); vibrate([40, 60, 40]); return; }

  store.busy = true;
  overlay(true, 'Sending…');
  try {
    const link = regMode === 'profile' && profileFor ? [profileFor.id, profileFor.token] : [];
    const r = await api<{ regId: string; token: string; name: string }>('regSubmit', d, phoneInfo(), ...link);
    const empId = profileFor?.id || '';
    if (regMode === 'profile') forgetMe();
    saveReg({ regId: r.regId, token: r.token, name: r.name });
    savePhoto({ reg: r.regId, id: empId, photo: d.photo });
    ($('regForm') as HTMLFormElement).reset();
    regPhoto = '';
    renderRegPhoto();
    showPending({ status: 'PENDING', name: r.name });
    vibrate(60);
  } catch (e) {
    if (!handleAuthError(e)) boxMsg('regMsg', cleanErr(e));
  } finally {
    store.busy = false;
    overlay(false);
  }
}

/* ---------- reference photo (register / add once) ---------- */
function renderRegPhoto(): void {
  const has = !!regPhoto;
  $('regPhotoBox').classList.toggle('done', has);
  $('regPhotoPrev').innerHTML = has ? '<img alt="Your photo" src="' + regPhoto + '">' : '📷';
  $('regPhotoTitle').textContent = has ? 'Photo added ✓' : 'Add a clear photo of your face';
  $('regPhotoBtn').textContent = has ? '↻ Retake' : '📷 Take photo';
}

export function pickRefPhoto(mode: 'reg' | 'add'): void {
  refMode = mode;
  void preloadFace().catch(() => null);
  const cam = $input('refCam');
  cam.value = '';
  cam.click(); // must stay inside the tap handler so the camera can open
}

export async function onRefPhoto(): Promise<void> {
  const file = $input('refCam').files?.[0];
  const mode = refMode;
  if (!file || !mode) return;
  const msgId = mode === 'reg' ? 'regMsg' : 'photoMsg';
  overlay(true, 'Checking photo…');
  let photo: string;
  try {
    const img = await loadRef(file);
    const face = await checkFace(img.c);
    if (face.found === false) {
      overlay(false);
      boxMsg(msgId, NO_FACE_REF);
      vibrate([40, 60, 40]);
      return;
    }
    photo = refJpeg(img);
  } catch {
    overlay(false);
    boxMsg(msgId, 'Could not read the photo. Please try again.');
    return;
  }
  overlay(false);
  if (mode === 'reg') {
    regPhoto = photo;
    renderRegPhoto();
    boxMsg('regMsg', '');
    return;
  }
  // existing employee adds a photo once
  const me = store.me;
  if (store.busy || !me) return;
  store.busy = true;
  overlay(true, 'Saving photo…');
  try {
    applyServer(await api<EmpState>('empSetPhoto', me.id, me.token, photo));
    savePhoto({ id: me.id, photo });
    boxMsg('photoMsg', '');
    showMsg('✓ Reference photo saved. Thank you!', 'success');
    vibrate(60);
  } catch (e) {
    if (!handleAuthError(e)) boxMsg('photoMsg', cleanErr(e));
  } finally {
    store.busy = false;
    overlay(false);
    renderMain();
  }
}

/* ---------- waiting for approval ---------- */
export function showPending(st: Pick<RegStatus, 'status' | 'name' | 'reason'>): void {
  renderHeader();
  const s = st.status;
  const name = st.name || loadReg()?.name || '';
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

export async function checkReg(manual: boolean): Promise<void> {
  const r = loadReg();
  if (!r) { showWelcome(); return; }
  if (manual) overlay(true, 'Checking…');
  try {
    const st = await api<RegStatus>('regStatus', r.regId, r.token);
    if (st.status === 'APPROVED' && st.me && st.state) {
      const ph = loadPhoto();
      if (ph && ph.reg === r.regId) savePhoto({ id: st.me.id, photo: ph.photo });
      store.me = st.me;
      saveMe(st.me);
      applyServer(st.state);
      showMsg('✓ <b>Approved!</b> You can check in now.', 'success');
      vibrate([60, 80, 60]);
      return;
    }
    if (st.status === 'NOT_FOUND') { saveReg(null); showWelcome(); return; }
    showPending(st);
  } catch (e) {
    if (manual) $('pendText').textContent = cleanErr(e);
  } finally {
    if (manual) overlay(false);
  }
}

function startPoll(): void {
  stopPoll();
  pollTimer = setInterval(() => { if (!document.hidden) void checkReg(false); }, TIMING.regPollMs);
}
function stopPoll(): void {
  clearInterval(pollTimer);
  pollTimer = undefined;
}
export const isPolling = () => pollTimer !== undefined;
onViewChange(v => { if (v !== 'pending') stopPoll(); });

/* ---------- login ---------- */
export function showLogin(info: string): void {
  leaveSession();
  boxMsg('loginMsg', '');
  boxMsg('loginInfo', info || '');
  showView('login');
}

async function submitLogin(ev: Event): Promise<void> {
  ev.preventDefault();
  if (store.busy) return;
  const mobile = digits($input('lMobile').value).slice(-10);
  const pin = $input('lPin').value;
  if (!/^[6-9]\d{9}$/.test(mobile) || !/^\d{4}$/.test(pin)) {
    boxMsg('loginMsg', 'Enter your 10-digit mobile number and 4-digit PIN.');
    return;
  }
  store.busy = true;
  overlay(true, 'Logging in…');
  try {
    const r = await api<Me & { state: EmpState }>('empLogin', mobile, pin, phoneInfo());
    store.me = { id: r.id, token: r.token };
    saveMe(store.me);
    ($('loginForm') as HTMLFormElement).reset();
    store.busy = false;
    applyServer(r.state);
    vibrate(60);
  } catch (e) {
    boxMsg('loginMsg', cleanErr(e));
    $input('lPin').value = '';
    vibrate([40, 60, 40]);
  } finally {
    store.busy = false;
    overlay(false);
  }
}

export function wireAuth(): void {
  $('goRegister').addEventListener('click', () => showRegister('new'));
  $('goLogin').addEventListener('click', () => showLogin(''));
  $('toRegister').addEventListener('click', ev => { ev.preventDefault(); showRegister('new'); });
  $('regBack').addEventListener('click', showWelcome);
  $('regForm').addEventListener('submit', ev => void submitRegistration(ev));
  $('loginForm').addEventListener('submit', ev => void submitLogin(ev));
  $('pendCheck').addEventListener('click', () => void checkReg(true));
  $('pendAgain').addEventListener('click', () => { saveReg(null); showRegister('new'); });
  $('pendLogin').addEventListener('click', () => { saveReg(null); showLogin(''); });
  for (const id of ['fMobile', 'lMobile']) {
    $(id).addEventListener('input', e => { const t = e.target as HTMLInputElement; t.value = digits(t.value).slice(-10); });
  }
  for (const id of ['fPin', 'fPin2', 'lPin']) {
    $(id).addEventListener('input', e => { const t = e.target as HTMLInputElement; t.value = digits(t.value).slice(0, 4); });
  }
  $input('refCam').addEventListener('change', () => void onRefPhoto());
  $('regPhotoBtn').addEventListener('click', () => pickRefPhoto('reg'));
  $('addPhotoBtn').addEventListener('click', () => pickRefPhoto('add'));
}
