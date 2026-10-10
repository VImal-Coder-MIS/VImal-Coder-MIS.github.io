/**
 * "My attendance" — month calendar opened from the Days Present card.
 * Shows the phone's saved copy at once (also offline), then refreshes from the server.
 * Today always reflects what is on the main screen, including a check-in still being sent.
 */
import { api, cleanErr } from '../api';
import { $, $btn, esc, show } from '../dom';
import { lsGet, lsSet } from '../storage';
import { handleAuthError } from '../session';
import { store } from '../store';
import { fmtDur, istDate, isLate, to12h } from '../time';
import type { MonthData, MonthDay } from '../types';

const KEY = 'aap_attendance_months_v1';
const FRESH_MS = 60000;            // this month: refresh if older than this
const OLD_MONTH_FRESH_MS = 3600000; // past months rarely change
const TZ = 'Asia/Kolkata';
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'long', year: 'numeric' });

interface Saved { id: string; months: Record<string, { at: number; data: MonthData }>; }

let isOpen = false;
let month = '';
let selected = '';
let view: MonthData | null = null;
let reqNo = 0;

/* ---------- phone cache ---------- */
function saved(): Saved {
  const s = lsGet<Saved>(KEY);
  return s && s.id === store.me?.id && s.months ? s : { id: store.me?.id || '', months: {} };
}
function savedMonth(ym: string) { return saved().months[ym] || null; }
function saveMonth(ym: string, data: MonthData): void {
  const s = saved();
  s.months[ym] = { at: Date.now(), data };
  const keep = Object.keys(s.months).sort().slice(-13);
  s.months = Object.fromEntries(keep.map(k => [k, s.months[k]]));
  lsSet(KEY, s);
}

/* ---------- helpers ---------- */
const thisMonth = () => istDate().slice(0, 7);
function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + by;
  return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
}
const noon = (date: string) => new Date(date + 'T12:00:00+05:30');
const minsOf = (h: string) => (h ? Math.round(Number(h) * 60) : 0);

/** Today from the main screen (it already includes a check-in that is still being sent). */
function withToday(d: MonthData): MonthData {
  const s = store.state;
  const today = istDate();
  if (!s || s.date !== today || d.month !== today.slice(0, 7)) return d;
  const days = d.days.map(x => {
    if (x.date !== today) return x;
    const sm = s.summary;
    return {
      ...x,
      status: sm.checkIn ? sm.status : 'Not yet',
      checkIn: sm.checkIn,
      checkOut: sm.checkOut,
      hours: sm.hours,
      late: isLate(sm.checkIn, s.lateAfter || d.lateAfter) ? 'Yes' : '',
      events: s.events.map(e => ({ action: e.action, time: e.time, dist: e.dist, notes: e.notes }))
    };
  });
  return { ...d, days };
}

/* ---------- open / close (Android back button closes it) ---------- */
export function openHistory(): void {
  if (!store.me || isOpen) return;
  isOpen = true;
  show($('histView'), true);
  document.documentElement.classList.add('no-scroll');
  try { history.pushState({ aapHist: 1 }, ''); } catch { /* ignore */ }
  selected = istDate();
  void load(selected.slice(0, 7));
}

export function closeHistory(fromBackButton = false): void {
  if (!isOpen) return;
  isOpen = false;
  show($('histView'), false);
  document.documentElement.classList.remove('no-scroll');
  if (!fromBackButton && (history.state as { aapHist?: number } | null)?.aapHist) history.back();
}

/* ---------- data ---------- */
async function load(ym: string): Promise<void> {
  const me = store.me;
  if (!me) return;
  month = ym;
  show($('histMsg'), false);
  const hit = savedMonth(ym);
  if (hit) render(withToday(hit.data)); else renderSkeleton(ym);
  const maxAge = ym === thisMonth() ? FRESH_MS : OLD_MONTH_FRESH_MS;
  if (hit && Date.now() - hit.at < maxAge) return;

  const n = ++reqNo;
  $('histView').classList.add('loading');
  try {
    const d = await api<MonthData>('empMonth', me.id, me.token, ym);
    saveMonth(ym, d);
    if (n === reqNo && isOpen && month === ym) render(withToday(d));
  } catch (e) {
    if (handleAuthError(e)) { closeHistory(); return; }
    if (n === reqNo && !hit) {
      const box = $('histMsg');
      const err = cleanErr(e);
      box.textContent = /Unknown request/i.test(err)
        ? 'The calendar is not switched on yet on the server. Please tell admin (Apps Script needs the new version).'
        : err + ' — check your internet and try again.';
      show(box, true);
    }
  } finally {
    if (n === reqNo) $('histView').classList.remove('loading');
  }
}

/* ---------- rendering ---------- */
function setNav(label: string, canPrev: boolean, canNext: boolean): void {
  $('histMonth').textContent = label;
  $btn('histPrev').disabled = !canPrev;
  $btn('histNext').disabled = !canNext;
}

function renderSkeleton(ym: string): void {
  view = null;
  setNav(monthFmt.format(noon(ym + '-15')), true, ym < thisMonth());
  $('histGrid').innerHTML = Array.from({ length: 35 }, () => '<span class="cal-cell skel-cell"></span>').join('');
  $('histDay').innerHTML = '<div class="skel-line"></div><div class="skel-line short"></div>';
  $('histTotals').innerHTML = '';
}

function dayClass(d: MonthDay): string {
  const c = ['cal-cell'];
  if (d.future) c.push('future');
  if (d.today) c.push('today');
  if (d.off) c.push('off');
  if (d.date === selected) c.push('sel');
  if (d.checkIn) c.push(d.late === 'Yes' ? 'late' : 'present');
  else if (d.status === 'Absent') c.push('absent');
  if (d.status === 'Missing Check-out') c.push('missing');
  return c.join(' ');
}

function render(d: MonthData): void {
  view = d;
  setNav(d.label, d.canPrev, d.canNext);
  if (!d.days.some(x => x.date === selected)) {
    const withIn = d.days.filter(x => x.checkIn);
    selected = d.days.find(x => x.today)?.date || (withIn.length ? withIn[withIn.length - 1].date : d.days[0].date);
  }
  const blanks = Array.from({ length: d.firstDow }, () => '<span class="cal-cell blank"></span>').join('');
  $('histGrid').innerHTML = blanks + d.days.map(x =>
    '<button type="button" class="' + dayClass(x) + '" data-date="' + x.date + '"' + (x.future ? ' disabled' : '') +
    ' aria-label="' + esc(dayFmt.format(noon(x.date))) + (x.status ? ', ' + esc(x.status) : '') + '">' +
    '<span class="cal-n">' + x.day + '</span><span class="cal-dot"></span></button>').join('');

  // month totals (worked out here so today's pending check-in is counted too)
  const past = d.days.filter(x => !x.future);
  const present = past.filter(x => x.checkIn).length;
  const late = past.filter(x => x.late === 'Yes' && !x.off).length;
  const absent = past.filter(x => x.status === 'Absent').length;
  const mins = past.reduce((a, x) => a + minsOf(x.hours), 0);
  const ot = past.reduce((a, x) => a + minsOf(x.overtime), 0);
  // 3 per row: Present · Late · Absent, then Worked (wide) + Overtime
  $('histTotals').innerHTML = [
    ['Present', String(present), ''], ['Late', String(late), ''], ['Absent', String(absent), ''],
    ['Hours worked', mins ? fmtDur(mins) : '—', ot ? ' span2' : ' span3'], ...(ot ? [['Overtime', fmtDur(ot), '']] : [])
  ].map(([k, v, cls]) => '<div class="ht' + cls + '"><div class="ht-v">' + esc(v) + '</div><div class="ht-k">' + esc(k) + '</div></div>').join('');
  renderDay();
}

const BADGE: Record<string, string> = {
  'Present': 'b-present', 'Checked In': 'b-in', 'Missing Check-out': 'b-missing', 'Absent': 'b-absent', 'Weekly Off': 'b-off', 'Not yet': 'b-off'
};

function renderDay(): void {
  const d = view?.days.find(x => x.date === selected);
  if (!d) { $('histDay').innerHTML = ''; return; }
  const status = d.future ? 'Upcoming' : d.status;
  const lateTag = d.checkIn ? (d.late === 'Yes' && !d.off ? '<span class="t-late">Late</span>' : '<span class="t-ok">On time</span>') : '';
  const outSub = d.checkOut ? 'Done' : d.checkIn ? (d.today ? 'Not yet' : 'Not checked out') : '';
  const note =
    d.future ? 'This day has not come yet.' :
    !d.checkIn && d.status === 'Weekly Off' ? 'Weekly off.' :
    !d.checkIn && d.status === 'Not yet' ? 'You have not checked in yet today.' :
    !d.checkIn ? 'No check-in on this day.' : '';
  const extra = [
    d.hours ? 'Worked ' + fmtDur(minsOf(d.hours)) : '',
    d.overtime ? 'Overtime ' + fmtDur(minsOf(d.overtime)) : '',
    d.events.length > 2 ? d.events.length + ' check-ins/outs' : ''
  ].filter(Boolean).join(' · ');
  $('histDay').innerHTML =
    '<div class="row between" style="flex-wrap:nowrap;gap:10px"><div class="strong">' + esc(dayFmt.format(noon(d.date))) + '</div>' +
      (status ? '<span class="badge ' + (BADGE[status] || 'b-off') + '">' + esc(status) + '</span>' : '') + '</div>' +
    (note ? '<p class="muted" style="margin:12px 0 2px">' + esc(note) + '</p>' :
      '<div class="hist-times">' +
        '<div><div class="tile-top"><span class="ti ti-in">↘</span>Check In</div><div class="tile-v">' + esc(to12h(d.checkIn)) + '</div><div class="tile-s">' + lateTag + '</div></div>' +
        '<div><div class="tile-top"><span class="ti ti-out">↗</span>Check Out</div><div class="tile-v">' + esc(to12h(d.checkOut)) + '</div><div class="tile-s">' + esc(outSub) + '</div></div>' +
      '</div>' + (extra ? '<div class="muted small" style="margin-top:10px">' + esc(extra) + '</div>' : ''));
}

export function wireHistory(): void {
  $('daysTile').addEventListener('click', openHistory);
  $('histBack').addEventListener('click', () => closeHistory());
  $('histPrev').addEventListener('click', () => { if (view?.canPrev !== false) void load(shiftMonth(month, -1)); });
  $('histNext').addEventListener('click', () => { if (month < thisMonth()) void load(shiftMonth(month, 1)); });
  $('histGrid').addEventListener('click', ev => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]');
    if (!b || b.disabled) return;
    selected = b.dataset.date || '';
    $('histGrid').querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    renderDay();
  });
  window.addEventListener('popstate', () => closeHistory(true));
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeHistory(); });
}
