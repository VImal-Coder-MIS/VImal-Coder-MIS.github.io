/** The one place app state lives. */
import { DEFAULT_CFG } from './config';
import { loadCfg, loadQueue } from './storage';
import type { EmpState, GeoSettings, Job, Me, PublicConfig } from './types';

export const store = {
  me: null as Me | null,
  /** Last state from the server (or the phone's cache of it). */
  server: null as EmpState | null,
  /** `server` + check-ins still waiting in the queue = what the screen shows. */
  state: null as EmpState | null,
  /** true once the server answered in this session (false = cached screen). */
  live: false,
  cfg: { ...DEFAULT_CFG, ...loadCfg() } as PublicConfig,
  queue: loadQueue() as Job[],
  busy: false,
  flushing: false,
  lastLoad: 0
};

export const geoSettings = (): GeoSettings => store.state || store.cfg;
