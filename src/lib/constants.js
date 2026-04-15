export const APP_DB_NAME = 'rolling-translations-cat-tool';
export const APP_DB_VERSION = 2;
export const USERS_STORE = 'users';
export const PROJECTS_STORE = 'projects';
export const APP_STATE_STORE = 'app-state';
export const APP_STATE_KEY = 'global-state';
export const LEGACY_SESSION_STORE = 'session';
export const LEGACY_SESSION_KEY = 'active-session';
export const AUTOSAVE_DELAY = 500;
export const MIN_FUZZY_MATCH = 70;

export const STATUS_META = {
  pending: {
    label: 'Pending',
    className: 'bg-violet-100 text-violet-700 border border-violet-200',
  },
  translated: {
    label: 'Translated',
    className: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  },
  autofilled: {
    label: 'Auto-filled',
    className: 'bg-sky-100 text-sky-700 border border-sky-200',
  },
  fuzzy: {
    label: 'Fuzzy',
    className: 'bg-amber-100 text-amber-700 border border-amber-200',
  },
  empty: {
    label: 'Empty',
    className: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
};
