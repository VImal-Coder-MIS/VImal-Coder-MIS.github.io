/**
 * Logged-in session: server state ⇄ screen.
 *
 * v15 rule: the screen NEVER waits for the server.
 *   cached screen (today)        → shown at once, refreshed in the background
 *   cached screen (an older day) → turned into a fresh empty "today" at once, refreshed in the background
 *   nothing cached (first open)  → skeleton at once, filled when the server answers
 */
import { api, cleanErr, isProfile, isRelink } from './api';
import { esc, hideMsg, showMsg } from './dom';
import { prewarm } from './geo';
import { clearMe, loadState, saveQueue, savePhoto, saveState } from './storage';
import { store } from './store';
import { dateLabel, hmsFmt, istDate, setServerTime, toSec } from './time';
import type { EmpState, Summary } from './types';
import { renderHeader, renderMain, renderSkeleton, setAvatarFetcher, showView } from './ui/main-screen';
import { showLogin, showRegister } from './ui/auth';

/** Yesterday's cached screen → today's empty screen (until the server answers, ~1–3 s). */
export function freshDay(s: EmpState, today: string): EmpState {
  const summary: Summary = { status: 'Absent', checkIn: '', checkOut: '', hours: '', late: '' };
  const sameMonth = s.date.slice(0, 7) === today.slice(0, 7);
  const week = (s.week || []).some(d => d.date === today)
    ? (s.week || []).map(d => ({
        ...d,
        present: d.present || (d.date === s.date && !!s.summary.checkIn),
        today: d.date === today,
        future: d.date > today
      }))
    : [];
  return {
    ...s,
    serverTs: 0,
    date: today,
    dateLabel: dateLabel(),
    canIn: true,
    canOut: false,
    events: [],
    summary,
    week,
    monthDays: sameMonth ? s.monthDays : 0
  };
}

export function applyServer(s: EmpState, cached = false): void {
  store.server = s;
  if (!cached) {
    store.live = true;
    store.lastLoad = Date.now();
    setServerTime(s.serverTs);
    if (store.me) saveState(store.me.id, s);
  }
  rebuild();
  showView('main');
  void prewarm(s.canIn || s.canOut || store.queue.length > 0);
}

/** Screen = server state + check-ins still waiting to be sent (optimistic). */
export function rebuild(): void {
  if (!store.server) return;
  const s: EmpState = JSON.parse(JSON.stringify(store.server));
  for (const j of store.queue) {
    if (j.emp !== store.me?.id || j.date !== s.date) continue;
    const time = hmsFmt.format(new Date(j.ts));
    s.events.push({ action: j.action, time, notes: j.notes, dist: j.dist == null ? '' : String(j.dist), pending: true });
    if (j.action === 'IN') {
      if (!s.summary.checkIn) s.summary.checkIn = time;
      s.summary.status = 'Checked In';
      s.canIn = false;
      s.canOut = true;
    } else {
      s.summary.checkOut = time;
      s.summary.status = 'Present';
      s.canIn = false;
      s.canOut = false;
      const firstIn = s.events.find(e => e.action === 'IN');
      if (firstIn) {
        const mins = (toSec(time) - toSec(firstIn.time)) / 60;
        if (mins > 0) s.summary.hours = (mins / 60).toFixed(2);
      }
    }
  }
  store.state = s;
  renderHeader();
  renderMain();
}

/** Show the main screen instantly from the phone, then refresh from the server. */
export function openMain(): void {
  const me = store.me;
  if (!me) return;
  const cs = loadState();
  const today = istDate();
  if (cs && cs.id === me.id && cs.s) applyServer(cs.s.date === today ? cs.s : freshDay(cs.s, today), true);
  else renderSkeleton();
  void resume();
}

let resumeRun: Promise<void> | null = null;
let resumeRetry: ReturnType<typeof setTimeout> | undefined;
let resumeFailed = false;

/** Fresh data from the server (background, de-duplicated). */
export function resume(): Promise<void> {
  if (!store.me) return Promise.resolve();
  if (resumeRun) return resumeRun;
  clearTimeout(resumeRetry);
  const me = store.me;
  resumeRun = (async () => {
    try {
      const s = await api<EmpState>('empResume', me.id, me.token);
      if (store.me?.id === me.id) applyServer(s);
      if (resumeFailed) { resumeFailed = false; hideMsg(); }
    } catch (e) {
      if (handleAuthError(e)) return;
      if (!store.server) {
        // first open and no connection: keep the skeleton, explain, retry by itself
        resumeFailed = true;
        showMsg(esc(cleanErr(e)) + ' — retrying…', 'error');
        resumeRetry = setTimeout(() => void resume(), 5000);
      }
    } finally {
      resumeRun = null;
    }
  })();
  return resumeRun;
}

export function forgetMe(): void {
  clearMe();
  store.me = null;
  store.server = null;
  store.state = null;
  store.live = false;
  store.queue = [];
  saveQueue([]);
}

/** "Log in again" / "Complete your profile" answers from the server. Returns true if handled. */
export function handleAuthError(e: unknown): boolean {
  if (isProfile(e)) {
    let info: Record<string, string> = {};
    try { info = JSON.parse(String((e as Error).message).replace(/^.*PROFILE\|/, '')); } catch { /* keep {} */ }
    showRegister('profile', { token: store.me?.token || '', ...info });
    return true;
  }
  if (isRelink(e)) {
    forgetMe();
    showLogin(cleanErr(e));
    return true;
  }
  return false;
}

/* Registration photo → avatar: downloaded once, then kept on the phone. */
let avatarAsked = '';
setAvatarFetcher(s => {
  const me = store.me;
  if (!me || avatarAsked === s.id) return;
  avatarAsked = s.id;
  api<string>('empPhoto', me.id, me.token).then(photo => {
    if (!photo || store.me?.id !== s.id) return;
    savePhoto({ id: s.id, photo });
    if (store.state?.id === s.id) renderMain();
  }).catch(() => { avatarAsked = ''; });
});
