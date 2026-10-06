/** Rendering of the header, views and the main (today) screen. Pure DOM writes, no network. */
import { $, $btn, esc, show } from '../dom';
import { fixDistance, freshFix, isDenied, isWatching } from '../geo';
import { loadPhoto } from '../storage';
import { geoSettings, store } from '../store';
import { clockText, dateLabel, fmtDur, hmsFmt, isLate, now, to12h, toSec } from '../time';
import type { EmpState } from '../types';
import { initials } from '../util';

export type View = 'welcome' | 'reg' | 'pending' | 'login' | 'main';
const VIEWS: View[] = ['welcome', 'reg', 'pending', 'login', 'main'];
const viewHooks: Array<(v: View) => void> = [];
export const onViewChange = (fn: (v: View) => void) => { viewHooks.push(fn); };

export function showView(name: View): void {
  if (!$(name + 'View').classList.contains('hidden') && name === 'main') return; // already there: no scroll jump
  VIEWS.forEach(v => show($(v + 'View'), v === name));
  show($('loadView'), false);
  show($('clockCard'), name === 'welcome');
  viewHooks.forEach(fn => fn(name));
  window.scrollTo(0, 0);
}

export function renderHeader(): void {
  $('company').textContent = (store.cfg.companyName || 'Atlantic Agro Plast') + ' · Attendance';
  $('dateLabel').textContent = store.state ? store.state.dateLabel : dateLabel();
}

const BADGE: Record<string, [string, string]> = {
  'Present': ['Checked out', 'b-present'],
  'Checked In': ['Checked in', 'b-in'],
  'Absent': ['Not checked in', 'b-off'],
  'Weekly Off': ['Weekly off', 'b-off'],
  'Missing Check-out': ['Missing check-out', 'b-missing']
};

/** Grey shimmer placeholders — shown only on the very first open (nothing cached yet). */
export function renderSkeleton(): void {
  $('mainView').classList.add('skel');
  ['empName', 'empMeta', 'sumIn', 'sumOut', 'sumHours', 'sumDays'].forEach(id => { $(id).textContent = '·'; });
  ['sumInSub', 'sumOutSub', 'sumHoursSub'].forEach(id => { $(id).textContent = ''; });
  $('statusBadge').textContent = '';
  $('statusBadge').className = 'badge hidden';
  $('empAvatar').textContent = '';
  show($('weekStrip'), false);
  show($('actionCard'), false);
  show($('doneCard'), false);
  show($('photoCard'), false);
  $('timeline').innerHTML = '';
  showView('main');
}

export function tick(): void {
  if (document.hidden) return;
  const t = clockText();
  $('clock').textContent = t;
  $('todayClock').textContent = t;
  const s = store.state;
  if (s?.summary.checkIn && !s.summary.checkOut && now().getSeconds() === 0) renderHours();
}

export function renderMain(): void {
  const s = store.state;
  if (!s) return;
  $('mainView').classList.remove('skel');
  $('empName').textContent = s.name;
  $('empMeta').textContent = [s.id, s.department].filter(Boolean).join(' · ');
  show($('photoCard'), s.hasPhoto === false);
  renderAvatar(s);
  renderWeek(s);

  const [label, cls] = BADGE[s.summary.status] || [s.summary.status, ''];
  $('statusBadge').textContent = label + (s.summary.late ? ' · Late' : '');
  $('statusBadge').className = 'badge ' + cls;

  const action = s.canIn ? 'IN' : s.canOut ? 'OUT' : null;
  const btn = $btn('btnAction');
  show($('actionCard'), !!action);
  show($('doneCard'), !action);
  if (action) {
    btn.textContent = action === 'IN' ? 'Check In' : 'Check Out';
    btn.className = 'btn btn-big ' + (action === 'IN' ? 'btn-in' : 'btn-out');
    btn.disabled = store.busy || store.queue.length > 0;
    btn.dataset.action = action;
  }

  const late = isLate(s.summary.checkIn, s.lateAfter);
  $('sumIn').textContent = to12h(s.summary.checkIn);
  $('sumInSub').innerHTML = s.summary.checkIn
    ? (late ? '<span class="t-late">Late</span>' : '<span class="t-ok">On time</span>') : 'Not yet';
  $('sumOut').textContent = to12h(s.summary.checkOut);
  $('sumOutSub').textContent = s.summary.checkOut ? 'Done for today' : 'Not yet';
  $('sumDays').textContent = s.monthDays != null ? String(s.monthDays) : '—';
  renderHours();
  renderTimeline(s);

  $('zoneText').textContent = s.geoCheck ? 'Allowed within ' + s.radius + ' m of office' : 'Location check is off';
  $('phoneLine').textContent = s.linkedSince
    ? '📱 This phone is linked since ' + s.linkedSince + (s.phoneInfo ? ' · ' + s.phoneInfo : '') : '';
  renderLoc();
}

function renderTimeline(s: EmpState): void {
  const firstIn = s.events.findIndex(e => e.action === 'IN');
  $('timeline').innerHTML = s.events.length
    ? s.events.map((e, i) => {
        const isIn = e.action === 'IN';
        const tag = isIn && i === firstIn
          ? (isLate(e.time, s.lateAfter) ? ' <span class="t-late">Late</span>' : ' <span class="t-ok">On time</span>') : '';
        return '<li><span class="ai ' + (isIn ? 'ai-in' : 'ai-out') + '">' + (isIn ? '↘' : '↗') + '</span>' +
          '<div class="a-body"><div class="strong">' + (isIn ? 'Check In' : 'Check Out') + tag + '</div>' +
          '<div class="muted small">' + esc(s.dateLabel || '') +
            (e.dist !== '' && e.dist != null ? ' · ' + esc(e.dist) + ' m from office' : '') +
            (e.notes ? ' · ' + esc(e.notes) : '') + '</div></div>' +
          '<span class="a-time">' + esc(to12h(e.time)) + '</span></li>';
      }).reverse().join('')
    : '<li class="muted" style="padding:14px 0">No activity yet today.</li>';
}

export function renderHours(): void {
  const s = store.state;
  if (!s) return;
  const v = $('sumHours');
  const sub = $('sumHoursSub');
  if (s.summary.checkIn && !s.summary.checkOut) {
    v.textContent = fmtDur((toSec(hmsFmt.format(now())) - toSec(s.summary.checkIn)) / 60);
    sub.textContent = 'Running';
  } else {
    v.textContent = s.summary.hours ? fmtDur(Number(s.summary.hours) * 60) : '—';
    sub.textContent = 'Today';
  }
}

/** Avatar = the photo taken at registration (kept on the phone after the first download). */
let avatarFetch: ((s: EmpState) => void) | null = null;
export const setAvatarFetcher = (fn: (s: EmpState) => void) => { avatarFetch = fn; };

export function renderAvatar(s: EmpState): void {
  const p = loadPhoto();
  const el = $('empAvatar');
  if (p && p.id === s.id && p.photo) {
    const img = el.querySelector('img');
    if (img?.getAttribute('src') !== p.photo) el.innerHTML = '<img alt="" src="' + p.photo + '">';
    return;
  }
  el.textContent = initials(s.name);
  if (s.hasPhoto) avatarFetch?.(s);
}

function renderWeek(s: EmpState): void {
  const w = s.week || [];
  $('weekStrip').innerHTML = w.map(d =>
    '<div class="wd' + (d.today ? ' today' : '') + (d.future ? ' future' : '') + '">' +
    '<span class="wd-l">' + esc(d.label) + '</span><span class="wd-n">' + d.day + '</span>' +
    '<span class="wd-dot ' + (d.present ? 'p' : d.off ? 'o' : d.future || d.today ? '' : 'a') + '"></span></div>').join('');
  show($('weekStrip'), w.length > 0);
}

export function renderLoc(): void {
  const g = geoSettings();
  const f = freshFix();
  let cls = '';
  let text = 'Check my location';
  if (isDenied()) { cls = 'bad'; text = 'Location blocked · tap for help'; }
  else if (f && g.officeLat != null) {
    const d = fixDistance(f) ?? 0;
    const acc = Math.round(f.acc);
    cls = d > g.radius ? 'bad' : acc > g.maxAcc ? 'warn' : 'ok';
    text = d + ' m from office · ±' + acc + ' m';
  } else if (isWatching()) text = 'Locating…';
  $('locChip').className = 'loc-chip ' + cls + (isWatching() ? ' busy' : '') + (g.geoCheck ? '' : ' hidden');
  $('locText').textContent = text;
}
