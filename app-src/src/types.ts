/** Shapes shared between the app and the Apps Script JSON API. */

export type Action = 'IN' | 'OUT';

export interface AppConfig {
  API_URL?: string;
  APK_URL?: string;
  ANDROID_PACKAGE?: string;
}

export interface GeoSettings {
  geoCheck: boolean;
  officeLat: number | null;
  officeLng: number | null;
  radius: number;
  maxAcc: number;
  locTol?: number;
  selfieMode: 'BOTH' | 'IN' | 'OFF';
}

export interface PublicConfig extends GeoSettings {
  companyName: string;
  serverTs?: number;
}

export interface DayEvent {
  action: Action;
  time: string;          // HH:mm:ss (IST)
  notes: string;
  dist: string;
  pending?: boolean;
}

export interface Summary {
  status: string;
  checkIn: string;
  checkOut: string;
  hours: string;
  late: string;
}

export interface WeekDay {
  date: string;
  day: number;
  label: string;
  today: boolean;
  future: boolean;
  off: boolean;
  present: boolean;
}

export interface EmpState extends GeoSettings {
  serverTs: number;
  id: string;
  name: string;
  department: string;
  mobileMasked: string;
  linkedSince: string;
  phoneInfo: string;
  hasPhoto?: boolean;
  companyName: string;
  date: string;          // yyyy-MM-dd (IST)
  dateLabel: string;
  canIn: boolean;
  canOut: boolean;
  events: DayEvent[];
  summary: Summary;
  week?: WeekDay[];
  monthDays?: number;
  lateAfter?: string;
}

export interface Me { id: string; token: string; }

export interface PendingReg { regId: string; token: string; name: string; }

export interface Loc { lat: number; lng: number; acc: number; }

export interface Fix extends Loc { t: number; }

export interface FaceMeta { face: 'OK' | 'SKIPPED'; score?: number; ms?: number; }

/** One check-in / check-out waiting to reach the server. */
export interface Job {
  rid: string;
  emp: string;
  date: string;
  action: Action;
  notes: string;
  selfie: string;
  ts: number;
  loc: Loc | null;
  dist: number | null;
  tries: number;
  geoTries?: number;
  meta?: FaceMeta;
}

export interface RegStatus {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REPLACED' | 'APPROVED_ELSEWHERE' | 'NOT_FOUND';
  name?: string;
  reason?: string;
  me?: Me;
  state?: EmpState;
}

export interface VersionInfo { web: string; notes?: string; minApk?: number; latestApk?: number; }

/** One day in the employee's month calendar (empMonth). */
export interface MonthDay {
  date: string;
  day: number;
  today: boolean;
  future: boolean;
  off: boolean;
  status: string;        // Present / Checked In / Missing Check-out / Absent / Weekly Off / Not yet / '' (future)
  checkIn: string;
  checkOut: string;
  hours: string;
  late: string;          // 'Yes' | ''
  overtime: string;      // hours, e.g. '1.50'
  events: Array<{ action: Action; time: string; dist: string; notes: string }>;
}

export interface MonthData {
  month: string;         // yyyy-MM
  label: string;         // October 2026
  firstDow: number;      // 0 = Monday
  canPrev: boolean;
  canNext: boolean;
  lateAfter: string;
  shiftEnd: string;
  days: MonthDay[];
  serverTs: number;
}
